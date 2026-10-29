// Evaluation of Trợ lý AI (STU-CHAT-01..05, phase 3 "đánh giá chất lượng", 2026-10-28). Run from apps/api:
//   npx tsx eval/assistant/run.ts --out=<directory for the raw JSON>
// Options: --skip-generation (index, questions and retrieval only), --ids=a,b (only these questions), --limit=N (the first
// N questions), --fresh (answer again what an earlier run of the same prompt already answered), --raw (add A0, the bare
// question), --no-report.
//
// 1. Reads DATABASE_URL of apps/api/.env and refuses any host but this machine (the URL is never printed).
// 2. Rebuilds the knowledge index (refreshKnowledge) and embeds the chunks without a vector directly with Ollama
//    (EmbeddingGemma on the CPU, batches of 32, documentEmbeddingText), storing them in ai_knowledge_chunks of that
//    local database: the only rows it writes.
// 3. Retrieval, no generation: recall@k and MRR of words only, meaning only and both (RRF), per question with
//    expectSources, the search prepareAssistantAnswer runs (general k = 6, or the student's own standard k = 2).
// 4. Generation: (A) no context, the same system prompt with an empty data block, no thinking; (B) full RAG, the
//    synthetic student's sources plus the knowledge search, assembled like prepareAssistantAnswer (chat.ts), no thinking;
//    (C) the same prompt as B with thinking, the shipped configuration (assistant-v2: think true, num_predict 8192);
//    (A0, only with --raw) the bare question without any system prompt. Gemma via /api/chat, num_gpu 38, stream false;
//    each answer scored (score.ts).
// 5. Writes the raw results as JSON to --out, then docs/assistant-evaluation.md (report.ts).
// The student is the synthetic K29 fixture (roadmap/test-fixture.ts): no student table is read.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { studentSources, type AssistantSourceKind, type ContextSource } from "../../src/assistant/facts.js";
import { detectIntents, isFollowUp } from "../../src/assistant/intent.js";
import { refreshKnowledge } from "../../src/assistant/knowledge.js";
import {
  ASSISTANT_OPTIONS, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_THINK, buildAssistantPrompt, HISTORY_MESSAGES, numberSources, type AssistantPrompt,
} from "../../src/assistant/prompt.js";
import { ASSISTANT_PROMPT_VERSION, documentEmbeddingText, EMBEDDING_MODEL, KNOWLEDGE_BATCH, queryEmbeddingText } from "../../src/assistant/protocol.js";
import { loadKnowledgeIndex, MIN_COSINE, RRF_K, type KnowledgeHit, type KnowledgeIndex } from "../../src/assistant/search.js";
import { addressesIn, codesIn, type AnswerContext } from "../../src/assistant/validate.js";
import type { DatabasePool } from "../../src/db/pool.js";
import type { RoadmapRow } from "../../src/roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "../../src/roadmap/test-fixture.js";
import { TRANSCRIPT_POLICY_VERSION } from "../../src/student/consent.js";
import { buildQuestions, SYNTHETIC_ROADMAP_OUTPUT, type EvalQuestion, type SourceRef } from "./questions.js";
import { writeReport } from "./report.js";
import { scoreAnswer, type AnswerScore } from "./score.js";

type Db = Pick<DatabasePool, "query">;

/* ------------------------------------------------------------------------ */
/* Settings (the production values of chat.ts and the worker) */

const OLLAMA_URL = "http://127.0.0.1:11434";
const CHAT_MODEL = "gemma4:e4b";
/** Layers of Gemma 4 E4B on the 4 GB GPU (docs/assistant.md); the embedding model runs on the CPU. */
const CHAT_NUM_GPU = 38;
const EMBED_NUM_GPU = 0;
const EMBED_KEEP_ALIVE = "10m";
/** The worker's keep_alive (ai-worker/ollama.ts), so the eval does not unload the model the worker uses. */
const CHAT_KEEP_ALIVE = "15m";
/** chat.ts: knowledge chunks per answer, resource chunks for the skills still to build, parts of the student's standard. */
const KNOWLEDGE_RESULTS = 6;
const RESOURCE_RESULTS = 2;
const OWN_STANDARD_RESULTS = 2;
/** The GPU is shared (the worker, other tests): an answer may wait in Ollama's queue. */
const CHAT_TIMEOUT_MS = 20 * 60_000;
const CHAT_ATTEMPTS = 3;
const SYNTHETIC_USER = "11111111-1111-4111-8111-111111111111";
const DEFAULT_OUT = join(tmpdir(), "edupath-assistant-eval");
const DOC_FILE = new URL("../../../../docs/assistant-evaluation.md", import.meta.url);
const CHAT_SOURCE = new URL("../../src/assistant/chat.ts", import.meta.url);
const RESOURCES_FILE = new URL("../../src/assistant/learning-resources.json", import.meta.url);

/** Lines of prepareAssistantAnswer (chat.ts) this runner repeats; a missing one means the assembly changed. */
const ASSEMBLY_LINES = [
  "const KNOWLEDGE_RESULTS = 6;", "const RESOURCE_RESULTS = 2;", "const OWN_STANDARD_RESULTS = 2;",
  "index.search({ text: input.retrievalText, vector, k: 60, kinds: [\"graduation\"] })",
  "index.search({ text: input.retrievalText, vector, k: KNOWLEDGE_RESULTS, excludeKinds: [\"graduation\"] })",
  "intents.includes(\"graduation\") ? [...own, ...general] : [...general, ...own]",
  "index.search({ text: `${student.gapSkills.join(\", \")} ${question}`, vector: null, k: RESOURCE_RESULTS, kinds: [\"resource\"] })",
];

type Args = { out: string; skipGeneration: boolean; ids: Set<string> | null; limit: number | null; fresh: boolean; report: boolean; raw: boolean };
function parseArgs(argv: readonly string[]): Args {
  const value = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const ids = value("ids");
  const limit = value("limit");
  return {
    out: value("out") ?? DEFAULT_OUT,
    skipGeneration: argv.includes("--skip-generation"),
    ids: ids ? new Set(ids.split(",").map((id) => id.trim()).filter(Boolean)) : null,
    limit: limit ? Math.max(1, Number(limit)) : null,
    fresh: argv.includes("--fresh"),
    report: !argv.includes("--no-report"),
    raw: argv.includes("--raw"),
  };
}

const log = (line: string) => console.log(`[${new Date().toLocaleTimeString("vi-VN", { hour12: false })}] ${line}`);
const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** DATABASE_URL of apps/api/.env; only a database on this machine is accepted. */
async function localDatabaseUrl(): Promise<string> {
  const env = await readFile(new URL("../../.env", import.meta.url), "utf8");
  const raw = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error("apps/api/.env has no DATABASE_URL");
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("DATABASE_URL is not a database on this machine: the evaluation only runs locally");
  return raw;
}

/* ------------------------------------------------------------------------ */
/* Ollama */

async function ollamaJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ollama ${path} ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** EmbeddingGemma vectors on the CPU, rounded to 6 decimals like the worker's. */
async function embed(inputs: readonly string[]): Promise<number[][]> {
  const result = await ollamaJson<{ embeddings: number[][] }>("/api/embed",
    { model: EMBEDDING_MODEL, input: inputs, truncate: true, options: { num_gpu: EMBED_NUM_GPU }, keep_alive: EMBED_KEEP_ALIVE }, 5 * 60_000);
  if (result.embeddings.length !== inputs.length) throw new Error("embedding count mismatch");
  return result.embeddings.map((vector) => vector.map((value) => Math.round(value * 1e6) / 1e6));
}

type ChatMetrics = {
  wallMs: number; totalMs: number | null; loadMs: number | null; promptTokens: number | null; promptMs: number | null;
  /** Tokens written, thinking included. */
  outputTokens: number | null; outputMs: number | null; doneReason: string | null;
  /** Characters of the thinking (never kept). */
  thinkingChars: number;
};
type ChatResponse = {
  message?: { content?: string; thinking?: string }; done_reason?: string; total_duration?: number; load_duration?: number;
  prompt_eval_count?: number; prompt_eval_duration?: number; eval_count?: number; eval_duration?: number;
};
const ms = (ns: number | undefined) => (typeof ns === "number" ? Math.round(ns / 1e4) / 100 : null);

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
/** The messages the worker sends for a prompt: the system prompt, then the user message with the data and the question. */
const promptMessages = (prompt: AssistantPrompt): ChatMessage[] => [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }];
/** (A0) The bare question as a chat: no system prompt, no data; a follow-up keeps its earlier turns as messages. */
const rawMessages = (question: EvalQuestion): ChatMessage[] => [...question.history.map((turn) => ({ role: turn.role, content: turn.content })), { role: "user", content: question.question }];

/**
 * How each condition asks Gemma. C is the shipped configuration (assistant-v2 since 2026-10-29: thinking on, num_predict
 * 8192); A, B and A0 answer without thinking, with the num_predict of assistant-v1 (2048), which a short answer never reaches.
 */
type Generation = { think: boolean; options: Record<string, number> };
const WITHOUT_THINKING: Generation = { think: false, options: { ...ASSISTANT_OPTIONS, num_predict: 2048 } };
const SHIPPED: Generation = { think: ASSISTANT_THINK, options: { ...ASSISTANT_OPTIONS } };
const GENERATION: Record<Condition, Generation> = { A: WITHOUT_THINKING, B: WITHOUT_THINKING, C: SHIPPED, A0: WITHOUT_THINKING };
/** What an answer was written from; an answer of the same hash is reused by the next run. Without thinking the hash is assistant-v1's. */
const jobHash = (messages: readonly ChatMessage[], generation: Generation) => {
  const system = messages.find((message) => message.role === "system");
  const base = system && messages.length === 2
    ? sha(`${CHAT_MODEL}\n${system.content}\n${messages[1]!.content}\n${JSON.stringify(generation.options)}`)
    : sha(`${CHAT_MODEL}\n${JSON.stringify(messages)}\n${JSON.stringify(generation.options)}`);
  return generation.think ? `${base}+think` : base;
};

/** One answer of Gemma, as the worker asks for it (no JSON schema), without streaming; the thinking text is only measured. */
async function chat(messages: readonly ChatMessage[], generation: Generation): Promise<{ content: string; metrics: ChatMetrics; attempts: number }> {
  const body = {
    model: CHAT_MODEL, messages,
    think: generation.think, stream: false, truncate: false, keep_alive: CHAT_KEEP_ALIVE,
    options: { ...generation.options, num_gpu: CHAT_NUM_GPU },
  };
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= CHAT_ATTEMPTS; attempt++) {
    const started = performance.now();
    try {
      const result = await ollamaJson<ChatResponse>("/api/chat", body, CHAT_TIMEOUT_MS);
      return {
        content: result.message?.content ?? "",
        attempts: attempt,
        metrics: {
          wallMs: Math.round(performance.now() - started), totalMs: ms(result.total_duration), loadMs: ms(result.load_duration),
          promptTokens: result.prompt_eval_count ?? null, promptMs: ms(result.prompt_eval_duration),
          outputTokens: result.eval_count ?? null, outputMs: ms(result.eval_duration), doneReason: result.done_reason ?? null,
          thinkingChars: result.message?.thinking?.length ?? 0,
        },
      };
    } catch (error) {
      lastError = error;
      log(`  chat attempt ${attempt} failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      if (attempt < CHAT_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("chat failed");
}

/* ------------------------------------------------------------------------ */
/* Knowledge index */

/** Embeds every chunk without a vector of EMBEDDING_MODEL (or whose text changed since), like a knowledge_embedding job. */
async function embedChunks(db: Db): Promise<{ embedded: number; batches: number; ms: number }> {
  const missing = await db.query<{ id: string; hash: string; title: string; content: string }>(
    `SELECT id,content_hash AS hash,title,content FROM ai_knowledge_chunks
      WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1 ORDER BY source_kind,source_key,id`, [EMBEDDING_MODEL]);
  const started = performance.now();
  let embedded = 0;
  let batches = 0;
  for (let start = 0; start < missing.rows.length; start += KNOWLEDGE_BATCH) {
    const batch = missing.rows.slice(start, start + KNOWLEDGE_BATCH);
    const vectors = await embed(batch.map((chunk) => documentEmbeddingText(chunk.title, chunk.content).slice(0, 8000)));
    const stored = await db.query(
      `UPDATE ai_knowledge_chunks c SET embedding=v.embedding,embedding_model=$2,updated_at=now()
        FROM (SELECT x.id,x.hash,(SELECT array_agg(e.value::real ORDER BY e.n) FROM jsonb_array_elements_text(x.vector) WITH ORDINALITY AS e(value,n)) AS embedding
          FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,hash text,vector jsonb)) v
        WHERE c.id=v.id AND c.content_hash=v.hash`,
      [JSON.stringify(batch.map((chunk, index) => ({ id: chunk.id, hash: chunk.hash, vector: vectors[index] }))), EMBEDDING_MODEL]);
    embedded += stored.rowCount ?? 0;
    batches += 1;
    log(`  embedded ${Math.min(start + KNOWLEDGE_BATCH, missing.rows.length)}/${missing.rows.length} chunks`);
  }
  return { embedded, batches, ms: Math.round(performance.now() - started) };
}

/* ------------------------------------------------------------------------ */
/* The synthetic student and the prompt (prepareAssistantAnswer of chat.ts) */

/** The synthetic student's newest AI roadmap (completed), with the invented output of questions.ts. */
const syntheticRoadmap = (): RoadmapRow => ({
  id: "44444444-4444-4444-8444-444444444444", assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null,
  createdAt: new Date("2026-10-24T03:00:00Z"), completedAt: new Date("2026-10-24T03:05:00Z"), model: CHAT_MODEL,
  facts: syntheticRoadmapFacts(), recent: false, output: SYNTHETIC_ROADMAP_OUTPUT,
});

/** The student tables as studentSources reads them, answered with the fixture (assistant/facts.test.ts does the same). */
function syntheticStudentDb(): Db {
  const query = async (sql: string) => {
    const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.includes("FROM stu_comp_assessments")) return rows([{ id: ROADMAP_ASSESSMENT, createdAt: new Date("2026-10-24T01:00:00Z"), computed: syntheticRoadmapResult() }]);
    if (sql.includes("FROM stu_profile_surveys")) return rows([syntheticSurveyRow()]);
    if (sql.includes("FROM data_consents")) return rows([{ policy_version: TRANSCRIPT_POLICY_VERSION }]);
    if (sql.includes("FROM stu_roadmaps")) return rows([syntheticRoadmap()]);
    // No transcript (assistant-v4 reads it): the 48 questions keep the data they were written for.
    if (sql.includes("FROM student_transcripts")) return rows([]);
    throw new Error(`unexpected query of the synthetic student: ${sql.replace(/\s+/g, " ").slice(0, 80)}`);
  };
  return { query } as unknown as Db;
}

const knowledgeKind = (kind: string): AssistantSourceKind =>
  (["course", "skill", "career", "curriculum", "plan", "graduation", "resource", "guide"] as const).find((item) => item === kind)
  ?? (kind === "field" ? "career" : "guide");

/** The text searched (chat.ts retrievalText): a follow-up goes with the previous question of the conversation. */
function retrievalTextOf(question: EvalQuestion): string {
  const previous = [...question.history].reverse().find((turn) => turn.role === "user")?.content ?? null;
  return previous && isFollowUp(question.question) ? `${previous}\n${question.question}` : question.question;
}

type Prepared = {
  prompt: AssistantPrompt; context: AnswerContext; intents: string[];
  sources: { n: number; kind: string; title: string; link: string | null }[];
  knowledge: { kind: string; key: string; via: string[] }[];
};

/** (B) The prompt of prepareAssistantAnswer for the synthetic student: same order, same searches, same check context. */
async function preparedPrompt(index: KnowledgeIndex, question: EvalQuestion, retrievalText: string, vector: number[] | null, ownStandard: string | null): Promise<Prepared> {
  const history = question.history.slice(-HISTORY_MESSAGES);
  const intents = detectIntents(retrievalText);
  const student = await studentSources(syntheticStudentDb(), SYNTHETIC_USER, question.question, intents, ROADMAP_NOW);
  const own = ownStandard === null ? [] : index.search({ text: retrievalText, vector, k: 60, kinds: ["graduation"] })
    .filter((chunk) => chunk.sourceKey === ownStandard || chunk.sourceKey.startsWith(`${ownStandard}#`)).slice(0, OWN_STANDARD_RESULTS);
  const general = index.search({ text: retrievalText, vector, k: KNOWLEDGE_RESULTS, excludeKinds: ["graduation"] });
  const found: KnowledgeHit[] = intents.includes("graduation") ? [...own, ...general] : [...general, ...own];
  if ((intents.includes("resources") || intents.includes("gaps")) && student.gapSkills.length) {
    for (const chunk of index.search({ text: `${student.gapSkills.join(", ")} ${question.question}`, vector: null, k: RESOURCE_RESULTS, kinds: ["resource"] })) {
      if (!found.some((item) => item.id === chunk.id)) found.push(chunk);
    }
  }
  const knowledge: ContextSource[] = found.map((chunk) => ({ kind: knowledgeKind(chunk.sourceKind), title: chunk.title, link: chunk.link, text: chunk.content }));
  const sources = numberSources([...student.sources, ...knowledge]);
  const prompt = buildAssistantPrompt({ sources, history, question: question.question });
  const texts = sources.map((source) => source.text).join("\n");
  return {
    prompt, intents,
    context: { sourceCount: sources.length, allowedUrls: addressesIn(texts), knownCodes: codesIn([texts, question.question, ...history.map((turn) => turn.content)].join("\n")) },
    sources: sources.map(({ n, kind, title, link }) => ({ n, kind, title, link })),
    knowledge: found.map((chunk) => ({ kind: chunk.sourceKind, key: chunk.sourceKey, via: chunk.via })),
  };
}

/** (A) No context: the same system prompt, an empty data block, the question (and the conversation of a follow-up). */
function bareprompt(question: EvalQuestion): Prepared {
  const history = question.history.slice(-HISTORY_MESSAGES);
  const prompt = buildAssistantPrompt({ sources: [], history, question: question.question });
  return {
    prompt, intents: detectIntents(retrievalTextOf(question)), sources: [], knowledge: [],
    context: { sourceCount: 0, allowedUrls: [], knownCodes: codesIn([question.question, ...history.map((turn) => turn.content)].join("\n")) },
  };
}

/* ------------------------------------------------------------------------ */
/* Retrieval comparison */

type Mode = "lexical" | "vector" | "hybrid";
const MODES: readonly Mode[] = ["lexical", "vector", "hybrid"];
export type RetrievalRow = {
  id: string; function: string; scope: string; variant: string; k: number; retrievalText: string; expect: SourceRef[];
  modes: Record<Mode, { rank: number | null; returned: number; keys: string[] }>;
  /** An expected chunk is among the sources of the full prompt (B). */
  inContext: boolean | null;
};

/** The search of prepareAssistantAnswer that should find the answer, by words only, meaning only or both. */
function searchMode(index: KnowledgeIndex, question: EvalQuestion, text: string, vector: number[] | null, mode: Mode, ownStandard: string | null): KnowledgeHit[] {
  const query = { text: mode === "vector" ? null : text, vector: mode === "lexical" ? null : vector };
  if (question.scope === "own_standard") {
    if (ownStandard === null) return [];
    return index.search({ ...query, k: 60, kinds: ["graduation"] })
      .filter((chunk) => chunk.sourceKey === ownStandard || chunk.sourceKey.startsWith(`${ownStandard}#`)).slice(0, OWN_STANDARD_RESULTS);
  }
  return index.search({ ...query, k: KNOWLEDGE_RESULTS, excludeKinds: ["graduation"] });
}

const keyOf = (kind: string, key: string) => `${kind}:${key}`;

/* ------------------------------------------------------------------------ */
/* Generation results */

/**
 * A: same system prompt, empty data, no thinking; B: full RAG without thinking; C: full RAG with thinking, the shipped
 * configuration (assistant-v2); A0: the bare question without any system prompt (only with --raw).
 */
export type Condition = "A" | "B" | "C" | "A0";
export type GenerationRow = {
  id: string; condition: Condition; promptHash: string; promptChars: number; answer: string; score: AnswerScore; metrics: ChatMetrics;
  attempts: number; at: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const files = {
    meta: join(args.out, "meta.json"), questions: join(args.out, "questions.json"), retrieval: join(args.out, "retrieval.json"),
    prompts: join(args.out, "prompts.json"), generation: join(args.out, "generation.json"),
  };
  const startedAt = new Date();
  log(`output: ${args.out}`);

  // Ollama and the assembly this runner repeats.
  const tags = await ollamaJson<{ models: { name: string; digest: string; details?: { parameter_size?: string; quantization_level?: string } }[] }>("/api/tags", undefined, 10_000);
  const version = (await ollamaJson<{ version: string }>("/api/version", undefined, 10_000)).version;
  const model = (name: string) => tags.models.find((item) => item.name === name || item.name === `${name}:latest`);
  if (!model(CHAT_MODEL) || !model(EMBEDDING_MODEL)) throw new Error(`Ollama needs ${CHAT_MODEL} and ${EMBEDDING_MODEL}`);
  const chatSource = await readFile(CHAT_SOURCE, "utf8");
  const drift = ASSEMBLY_LINES.filter((line) => !chatSource.includes(line));
  if (drift.length) log(`WARNING: prepareAssistantAnswer (chat.ts) changed; the runner repeats lines it no longer has: ${drift.join(" | ")}`);

  const pool = new pg.Pool({ connectionString: await localDatabaseUrl(), max: 4 });
  try {
    // Index: rebuild from the catalogs, embed what has no vector, then read it once for the whole run.
    let started = performance.now();
    const refresh = await refreshKnowledge(pool);
    const refreshMs = Math.round(performance.now() - started);
    log(`knowledge index: ${refresh.total} chunks (${refresh.inserted} new, ${refresh.updated} changed, ${refresh.deleted} removed) in ${refreshMs} ms`);
    const embedding = await embedChunks(pool);
    log(`embedded ${embedding.embedded} chunks in ${embedding.batches} batches, ${embedding.ms} ms`);
    const index = await loadKnowledgeIndex(pool, EMBEDDING_MODEL);
    const kinds = (await pool.query<{ kind: string; chunks: number; embedded: number }>(
      `SELECT source_kind AS kind,count(*)::int AS chunks,count(*) FILTER (WHERE embedding_model=$1)::int AS embedded
        FROM ai_knowledge_chunks GROUP BY 1 ORDER BY 1`, [EMBEDDING_MODEL])).rows;

    // Questions (catalog read only) and their search texts and vectors.
    const built = await buildQuestions(pool);
    let questions = built.questions;
    if (args.ids) questions = questions.filter((item) => args.ids!.has(item.id));
    if (args.limit) questions = questions.slice(0, args.limit);
    const ownStandard = built.ownStandard?.id ?? null;
    log(`${questions.filter((item) => item.generate).length} questions to answer, ${questions.filter((item) => !item.generate).length} retrieval-only variants; `
      + `synthetic student's own standard: ${ownStandard ?? "none"}`);
    const texts = questions.map(retrievalTextOf);
    started = performance.now();
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += KNOWLEDGE_BATCH) {
      vectors.push(...await embed(texts.slice(start, start + KNOWLEDGE_BATCH).map((text) => queryEmbeddingText(text.slice(0, 2000)))));
    }
    const queryEmbedMs = Math.round(performance.now() - started);
    // One question alone, as the worker embeds it, for the latency of a real answer.
    const single: number[] = [];
    for (const text of texts.slice(0, 5)) {
      const at = performance.now();
      await embed([queryEmbeddingText(text)]);
      single.push(performance.now() - at);
    }

    // Retrieval comparison of every question, and the two prompts of the questions Gemma answers.
    const retrieval: RetrievalRow[] = [];
    const prompts: Record<string, { A: Prepared; B: Prepared; retrievalText: string; prepareMs: number }> = {};
    for (const [at, item] of questions.entries()) {
      const vector = vectors[at] ?? null;
      const text = texts[at]!;
      let B: Prepared | null = null;
      if (item.generate) {
        const t0 = performance.now();
        B = await preparedPrompt(index, item, text, vector, ownStandard);
        prompts[item.id] = { A: bareprompt(item), B, retrievalText: text, prepareMs: Math.round((performance.now() - t0) * 10) / 10 };
      }
      const expected = new Set(item.expectSources.map((source) => keyOf(source.kind, source.key)));
      const modes = Object.fromEntries(MODES.map((mode) => {
        const hits = searchMode(index, item, text, vector, mode, ownStandard);
        const keys = hits.map((hit) => keyOf(hit.sourceKind, hit.sourceKey));
        const position = keys.findIndex((key) => expected.has(key));
        return [mode, { rank: position >= 0 ? position + 1 : null, returned: hits.length, keys }];
      })) as RetrievalRow["modes"];
      retrieval.push({
        id: item.id, function: item.function, scope: item.scope, variant: item.variant, k: item.scope === "own_standard" ? OWN_STANDARD_RESULTS : KNOWLEDGE_RESULTS,
        retrievalText: text, expect: item.expectSources, modes,
        inContext: expected.size && B ? B.knowledge.some((chunk) => expected.has(keyOf(chunk.kind, chunk.key))) : null,
      });
    }
    // Checks behind the report's remarks, computed so a later fix of the code shows in the next report.
    const gapSkills = (await studentSources(syntheticStudentDb(), SYNTHETIC_USER, "tài liệu tự học", ["resources"], ROADMAP_NOW)).gapSkills;
    const gapQuestion = questions.find((item) => item.id === "c05-gaps")?.question ?? "Gợi ý giúp mình tài liệu tự học cho các kỹ năng mình còn thiếu.";
    const resourceKeys = (text: string) => index.search({ text, vector: null, k: RESOURCE_RESULTS, kinds: ["resource"] }).map((hit) => hit.sourceKey);
    const intentProbes = ["Danh sách học phần của nhóm TC309 gồm những môn nào?", "Tại sao Cơ sở lập trình lại nằm trong danh sách cần học lại của mình?"];
    const diagnostics = {
      gapSkills,
      resourceSearch: { question: gapQuestion, withQuestion: resourceKeys(`${gapSkills.join(", ")} ${gapQuestion}`), namesOnly: resourceKeys(gapSkills.join(", ")) },
      intentProbes: intentProbes.map((text) => ({ text, intents: detectIntents(text) })),
      testCareers: built.catalog.careers.filter((career) => /\btest\b/i.test(career.nameVi)).map((career) => `${career.code} ${career.nameVi}`),
    };
    const resources = await readFile(RESOURCES_FILE, "utf8").then((text) => {
      const parsed = JSON.parse(text.replace(/^﻿/, "")) as { checkedAt?: string; skills?: { resources?: unknown[] }[] };
      return { present: true, checkedAt: parsed.checkedAt ?? null, skills: parsed.skills?.length ?? 0,
        resources: (parsed.skills ?? []).reduce((total, entry) => total + (entry.resources?.length ?? 0), 0), sha: sha(text) };
    }).catch(() => ({ present: false, checkedAt: null, skills: 0, resources: 0, sha: null }));

    const meta = {
      startedAt: startedAt.toISOString(), promptVersion: ASSISTANT_PROMPT_VERSION, systemPromptSha: sha(ASSISTANT_SYSTEM_PROMPT), assemblyDrift: drift,
      ollama: { version, chat: { name: CHAT_MODEL, digest: model(CHAT_MODEL)!.digest.slice(0, 12), ...model(CHAT_MODEL)!.details },
        embedding: { name: EMBEDDING_MODEL, digest: model(EMBEDDING_MODEL)!.digest.slice(0, 12), ...model(EMBEDDING_MODEL)!.details } },
      options: { A: GENERATION.A, B: GENERATION.B, C: GENERATION.C, numGpu: CHAT_NUM_GPU, stream: false, embedNumGpu: EMBED_NUM_GPU },
      search: { knowledgeResults: KNOWLEDGE_RESULTS, resourceResults: RESOURCE_RESULTS, ownStandardResults: OWN_STANDARD_RESULTS, rrfK: RRF_K, minCosine: MIN_COSINE },
      index: { ...index.stats(), refresh, refreshMs, embedding, kinds },
      catalog: {
        curricula: built.catalog.curricula.map((row) => row.cohortCode), plans: built.catalog.plans.map((row) => row.cohortCode),
        standards: built.catalog.standards.length, standardCohorts: [...new Set(built.catalog.standards.map((row) => row.cohortCode))].sort(),
        careers: built.catalog.careers.length, skills: built.catalog.skills.length, fields: built.catalog.fields.length,
        ownStandard: built.ownStandard ? { id: built.ownStandard.id, name: (built.ownStandard.data as { name?: string }).name ?? null } : null,
      },
      resources,
      queryEmbedding: { questions: texts.length, batchMs: queryEmbedMs, singleMs: single.map((value) => Math.round(value)) },
      student: { fixture: "roadmap/test-fixture.ts (synthetic K29)", now: ROADMAP_NOW.toISOString() },
      diagnostics,
      hardware: { gpu: "NVIDIA GeForce RTX 3050 Laptop GPU 4 GB", cpu: "Intel Core i7-12700H", ramGb: 15.6 },
    };
    await writeJson(files.meta, meta);
    await writeJson(files.questions, questions);
    await writeJson(files.retrieval, retrieval);
    await writeJson(files.prompts, Object.fromEntries(Object.entries(prompts).map(([id, value]) => [id, {
      retrievalText: value.retrievalText, prepareMs: value.prepareMs, intents: value.B.intents, sources: value.B.sources, knowledge: value.B.knowledge,
      allowedUrls: value.B.context.allowedUrls, knownCodes: value.B.context.knownCodes, hashA: jobHash(promptMessages(value.A.prompt), GENERATION.A), hashB: jobHash(promptMessages(value.B.prompt), GENERATION.B),
      hashC: jobHash(promptMessages(value.B.prompt), GENERATION.C),
      userA: value.A.prompt.user, userB: value.B.prompt.user,
    }])));
    const hits = (mode: Mode) => retrieval.filter((row) => row.expect.length && row.modes[mode].rank !== null).length;
    const scored = retrieval.filter((row) => row.expect.length).length;
    log(`retrieval (${scored} questions with expected chunks): ${MODES.map((mode) => `${mode} ${hits(mode)}/${scored}`).join(", ")}`);

    // Generation: A then B for each question; earlier answers of the same prompt are kept unless --fresh.
    if (!args.skipGeneration) {
      const previous = args.fresh ? [] : (await readJson<GenerationRow[]>(files.generation)) ?? [];
      const results = new Map(previous.map((row) => [`${row.id}|${row.condition}`, row]));
      let done = 0;
      const answered = questions.filter((item) => item.generate);
      // C (shipped) and B of every question first, paired under the same load; then A; then A0 when asked for (--raw).
      const jobs = [
        ...answered.flatMap((item) => (["C", "B"] as const).map((condition) => ({ item, condition }))),
        ...answered.map((item) => ({ item, condition: "A" as const })),
        ...(args.raw ? answered.map((item) => ({ item, condition: "A0" as const })) : []),
      ];
      for (const { item, condition } of jobs) {
        const prepared = condition === "A0" ? null : prompts[item.id]![condition === "A" ? "A" : "B"];
        const messages = prepared ? promptMessages(prepared.prompt) : rawMessages(item);
        const promptHash = jobHash(messages, GENERATION[condition]);
        const context = prepared ? prepared.context : bareprompt(item).context;
        const key = `${item.id}|${condition}`;
        done += 1;
        if (results.get(key)?.promptHash === promptHash) continue;
        const answer = await chat(messages, GENERATION[condition]);
        const score = scoreAnswer(item, answer.content, context, condition === "A" || condition === "A0");
        results.set(key, {
          id: item.id, condition, promptHash, promptChars: messages.reduce((sum, message) => sum + message.content.length, 0), answer: answer.content, score,
          metrics: answer.metrics, attempts: answer.attempts, at: new Date().toISOString(),
        });
        await writeJson(files.generation, [...results.values()]);
        const verdict = score.correct === null ? (score.refused ? "refused" : "NOT refused") : score.correct ? "correct" : `missing ${score.missing.join(",")}`;
        log(`[${done}/${jobs.length}] ${item.id} ${condition}: ${(answer.metrics.wallMs / 1000).toFixed(1)} s, `
          + `${answer.metrics.promptTokens ?? "?"}→${answer.metrics.outputTokens ?? "?"} tokens, ${verdict}`
          + `${score.inventedLinks.length ? `, ${score.inventedLinks.length} invented links` : ""}${score.unknownCodes.length ? `, unknown ${score.unknownCodes.join(" ")}` : ""}`);
      }
      // Rows of questions no longer in the set (an earlier run of other questions) are dropped.
      const ids = new Set(built.questions.map((item) => item.id));
      await writeJson(files.generation, [...results.values()].filter((row) => ids.has(row.id)));
    }
    await writeJson(files.meta, { ...meta, finishedAt: new Date().toISOString() });
    if (args.report) {
      await writeReport(args.out, DOC_FILE);
      log(`report written: docs/assistant-evaluation.md`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
