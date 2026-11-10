import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { PoolClient } from "pg";

/**
 * Reference data kept in memory between requests (2026-11-10, user: "career-guidance mất 3–7 s", "overview 1–3 s"): the rows
 * that are the same for every student (CTĐT, KHĐT, graduation standards, the skill configuration, the career catalog), which
 * the student pages read again on every request, each query one network round trip from Render to the database.
 *
 * Exact for every change made through the app: every write request to the admin API (invalidateOnWrite; the admin API is the
 * only code that writes REFERENCE_TABLES) empties the cache when it starts and again when it ends, after its commit. A change
 * made outside the app (a script, the database console) shows after at most maxAgeMs.
 *
 * A page creates its reader before its transaction starts: what a reader loads is kept only when nothing was written since
 * the reader was created, so rows of an older snapshot are never kept after a newer write. Every read returns its own copy,
 * so no caller can change what another one reads.
 */
export type ReferenceReader = {
  /** The cached value of `key` when current, else `load()` (kept for the next readers when nothing changed meanwhile). */
  read<T>(key: string, load: () => Promise<T>): Promise<T>;
};

export type ReferenceCache = {
  /** A reader for one request: create it before the request's transaction (its snapshot) starts. */
  reader(): ReferenceReader;
  /** Forgets everything (a write to the reference data). */
  invalidate(): void;
  /** Middleware for the admin API: a request that may write invalidates when it starts and when it ends. */
  invalidateOnWrite: RequestHandler;
  /** For tests: the number of values kept. */
  size(): number;
};

type Entry = { generation: number; storedAt: number; value: unknown };

/** A deep copy of query rows (plain objects, arrays, dates, buffers), so no caller changes what another one reads. */
export function copyOf<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) return value.map(copyOf) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) copy[key] = copyOf(item);
  return copy as T;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createReferenceCache(options: { maxAgeMs?: number; maxEntries?: number; now?: () => number } = {}): ReferenceCache {
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  let generation = 0;

  const invalidate = () => {
    generation += 1;
    entries.clear();
  };

  const reader = (): ReferenceReader => {
    const startGeneration = generation;
    const startedAt = now();
    return {
      async read<T>(key: string, load: () => Promise<T>): Promise<T> {
        const entry = entries.get(key);
        if (entry && entry.generation === generation && now() - entry.storedAt < maxAgeMs) return copyOf(entry.value) as T;
        const value = await load();
        if (generation === startGeneration) {
          entries.delete(key);
          entries.set(key, { generation: startGeneration, storedAt: startedAt, value: copyOf(value) });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        }
        return value;
      },
    };
  };

  const invalidateOnWrite: RequestHandler = (request, response, next) => {
    if (!READ_METHODS.has(request.method)) {
      invalidate();
      let done = false;
      const ended = () => { if (!done) { done = true; invalidate(); } };
      response.once("finish", ended);
      response.once("close", ended);
    }
    next();
  };

  return { reader, invalidate, invalidateOnWrite, size: () => entries.size };
}

/**
 * The tables only the admin API writes (curricula/, plans/, graduation/, competencies/, careers/ repositories and routers,
 * and their triggers; course_catalog only by curricula imports and migrations), checked 2026-11-10. Never a student's rows.
 */
export const REFERENCE_TABLES: ReadonlySet<string> = new Set([
  "curricula", "curriculum_revisions", "curriculum_courses", "curriculum_relations",
  "training_plans", "training_plan_revisions", "training_plan_items",
  "graduation_standards", "graduation_revisions",
  "ad_comp_courses", "ad_comp_course_configs", "ad_comp_course_links", "ad_comp_skills", "ad_comp_groups", "ad_comp_skill_groups",
  "career_fields", "career_positions", "career_requirements", "career_skills",
  "course_catalog",
]);
/** Set-returning built-ins a reference read may take rows from (FROM/JOIN). */
const ROW_FUNCTIONS = new Set(["jsonb_array_elements", "jsonb_array_elements_text", "json_array_elements", "json_array_elements_text",
  "jsonb_to_recordset", "json_to_recordset", "jsonb_each", "jsonb_each_text", "unnest", "generate_series"]);
/** What a SELECT may call whose answer is not the same in every snapshot (time, randomness, sessions, sequences, own functions). */
const VOLATILE = /\b(?:now|clock_timestamp|statement_timestamp|transaction_timestamp|timeofday|random|setseed|gen_random_uuid|uuid_generate_\w+|nextval|currval|setval|lastval|pg_\w+|txid_\w+|set_config|current_setting|inet_\w+|ad_comp_\w+|edupath_\w+|assign_\w+)\s*\(|\b(?:current_date|current_time|current_timestamp|localtime|localtimestamp|current_user|session_user|current_role|current_schema|user)\b/i;
/** What ends a FROM list at its depth (not ON or USING: a comma after a join condition still adds a relation). */
const CLAUSE_END = /^(?:where|group|having|order|limit|offset|fetch|union|except|intersect|window|returning|for)$/i;

/** The statement's words and punctuation, without comments and string literals (quoted names keep their quotes). */
function tokens(text: string): string[] {
  const plain = text.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, " '' ");
  return plain.match(/"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*|\$\d+|::|[(),.;]|[^\sA-Za-z0-9_(),.;"]+|\d+(?:\.\d+)?/g) ?? [];
}
const nameOf = (token: string) => (token.startsWith("\"") ? token.slice(1, -1).replace(/""/g, "\"") : token).toLowerCase();
const isWord = (token: string | undefined) => token !== undefined && /^[A-Za-z_"]/.test(token);

/**
 * Whether a statement only reads REFERENCE_TABLES (its rows are then those of any snapshot taken after the last write to
 * them): one SELECT or WITH, no lock, nothing volatile, and every relation after FROM, JOIN or a comma of a FROM list is a
 * reference table, a CTE of the statement, a subquery (checked for its own FROM) or a set-returning built-in. Anything it
 * cannot read that way counts as not reference (read from the transaction).
 */
export function readsOnlyReference(text: string): boolean {
  const list = tokens(text);
  if (!list.length || !/^(?:select|with)$/i.test(list[0]!)) return false;
  if (list.includes(";") || VOLATILE.test(text)) return false;
  if (list.some((token) => /^(?:insert|update|delete|merge|truncate|copy|lock|share|nowait)$/i.test(token))) return false;
  const ctes = new Set<string>();
  for (let index = 1; index + 2 < list.length; index++) {
    if (/^as$/i.test(list[index]!) && isWord(list[index - 1]) && /^(?:with|recursive|,)$/i.test(list[index - 2] ?? "")) {
      let next = index + 1;
      if (/^not$/i.test(list[next]!)) next += 1;
      if (/^materialized$/i.test(list[next] ?? "")) next += 1;
      if (list[next] === "(") ctes.add(nameOf(list[index - 1]!));
    }
  }
  let tables = 0;
  /** Checks the relation that starts at `start`; false when it is not a reference one. */
  const relation = (start: number): boolean => {
    let index = start;
    while (/^(?:lateral|only)$/i.test(list[index] ?? "")) index += 1;
    const token = list[index];
    if (token === "(") return true;
    if (!isWord(token)) return false;
    let name = nameOf(token!);
    if (list[index + 1] === "." && isWord(list[index + 2])) { name = nameOf(list[index + 2]!); index += 2; }
    if (list[index + 1] === "(") return ROW_FUNCTIONS.has(name);
    if (REFERENCE_TABLES.has(name)) tables += 1;
    return REFERENCE_TABLES.has(name) || ctes.has(name);
  };
  for (let index = 0; index < list.length; index++) {
    const word = list[index]!.toLowerCase();
    if (word === "join") { if (!relation(index + 1)) return false; continue; }
    if (word !== "from") continue;
    if (!relation(index + 1)) return false;
    // The rest of this FROM list, at its depth: every relation after a comma.
    let depth = 0;
    for (let next = index + 1; next < list.length; next++) {
      const token = list[next]!;
      if (token === "(") { depth += 1; continue; }
      if (token === ")") { if (depth === 0) break; depth -= 1; continue; }
      if (depth > 0) continue;
      if (CLAUSE_END.test(token)) break;
      if (token === "," && !relation(next + 1)) return false;
    }
  }
  // A statement that reads no table is not reference data.
  return tables > 0;
}

type Db = Pick<PoolClient, "query">;
type Rows = { rows: unknown[]; rowCount: number | null; command: string };

/** The reference cache's key of a query: its exact text and parameters. */
const queryKey = (text: string, values: unknown) =>
  `sql:${createHash("sha256").update(JSON.stringify([text, values ?? null])).digest("base64url")}`;

/**
 * The client of a REPEATABLE READ READ ONLY transaction for its reads (Định hướng nghề nghiệp, Tổng quan): a read of reference
 * tables only (readsOnlyReference) answers from `reader` when current; any other plain read is asked once per snapshot (the
 * same statement and parameters give the same rows in it: the profile, the transcript and the saved plan were read three or
 * four times by the parts of Tổng quan); every other statement goes to the client. Each caller gets its own copy of the rows.
 * A SAVEPOINT is sent only once a statement reaches the database after it: one that nothing reached is released or rolled
 * back to without a word to the database (Tổng quan's planner facts, all answered here, cost two round trips for nothing).
 * Only for a transaction opened with BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY.
 */
export function snapshotReads(client: Db, reader?: ReferenceReader): Db {
  const seen = new Map<string, Promise<Rows>>();
  /** SAVEPOINT statements not sent yet, oldest first, with their names. */
  const savepoints: { name: string; text: string }[] = [];
  const send = async (text: string, values?: unknown) => {
    for (const savepoint of savepoints.splice(0)) await client.query(savepoint.text);
    return values === undefined ? client.query(text) : client.query(text, values as unknown[]);
  };
  const run = async (text: string, values: unknown): Promise<Rows> => {
    const result = await send(text, values);
    return { rows: result.rows, rowCount: result.rowCount, command: result.command };
  };
  const skipped = (command: string): Rows => ({ rows: [], rowCount: null, command });
  const savepointName = (text: string, pattern: RegExp) => pattern.exec(text)?.[1]?.toLowerCase() ?? null;
  const query = async (config: unknown, values?: unknown) => {
    if (typeof config !== "string" || (values !== undefined && !Array.isArray(values))) {
      for (const savepoint of savepoints.splice(0)) await client.query(savepoint.text);
      return (client.query as (...args: unknown[]) => unknown)(config, values);
    }
    if (reader && readsOnlyReference(config)) return reader.read(queryKey(config, values), () => run(config, values));
    const plainRead = /^\s*(?:select|with)\b/i.test(config) && !/\bfor\s+(?:update|share|no\s+key|key)\b/i.test(config)
      && !/\b(?:clock_timestamp|statement_timestamp|timeofday|random|gen_random_uuid|nextval|setval|lastval)\s*\(/i.test(config)
      && !/\b(?:insert|update|delete|merge)\b/i.test(config);
    if (!plainRead) {
      // A savepoint keeps the snapshot (the reads stay); anything else might not, so they are asked again after it.
      const opened = values === undefined ? savepointName(config, /^\s*savepoint\s+([a-z_][a-z0-9_]*)\s*$/i) : null;
      if (opened) { savepoints.push({ name: opened, text: config }); return skipped("SAVEPOINT"); }
      const released = values === undefined ? savepointName(config, /^\s*release\s+(?:savepoint\s+)?([a-z_][a-z0-9_]*)\s*$/i) : null;
      const rolledBack = values === undefined ? savepointName(config, /^\s*rollback\s+to\s+(?:savepoint\s+)?([a-z_][a-z0-9_]*)\s*$/i) : null;
      const unsent = savepoints.findIndex((savepoint) => savepoint.name === (released ?? rolledBack));
      if (unsent >= 0) {
        // Never sent, so nothing ran inside it: RELEASE drops it and the later ones, ROLLBACK TO keeps it and drops the later ones.
        savepoints.splice(released ? unsent : unsent + 1);
        return skipped(released ? "RELEASE" : "ROLLBACK");
      }
      if (released || rolledBack) savepoints.splice(0);
      else seen.clear();
      return released || rolledBack ? client.query(config) : send(config, values);
    }
    const key = JSON.stringify([config, values ?? null]);
    let pending = seen.get(key);
    if (!pending) {
      pending = run(config, values).then((rows) => copyOf(rows));
      seen.set(key, pending);
      pending.catch(() => seen.delete(key));
    }
    return pending.then((rows) => copyOf(rows));
  };
  return { query: query as unknown as Db["query"] };
}
