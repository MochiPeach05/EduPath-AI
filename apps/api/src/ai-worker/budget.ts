// The neuron budget of Cloudflare Workers AI (user 2026-11-09: "Hết limit rồi mà ta"). A free account has 10,000
// neurons, and Workers AI counts them over the last 24 hours rather than from 00:00 UTC: the test account answered 4006
// ("used up your daily free allocation") at 05:45 UTC after about 4,300 neurons that UTC day, with about 5,000 more spent
// the evening before, and the main account stayed blocked long after 00:00 UTC while its dashboard said 0/10k. So every
// chat, embedding and Gemma OCR call adds what Workers AI reports it spent (usage.neurons, else an estimate from the
// tokens) to its hour in ai_usage_hours (migration 060), and new work starts only while the last 24 hours plus its
// reserve stay under the limit. A 4006 answer all the same (neurons spent elsewhere, or counted differently) stops every
// Workers AI call of this server for BLOCK_MS (ai_quota_block) instead of asking again and again. The AI worker and the
// transcript reader share both through the tables; without them (a test schema) each counts in memory.
import type { DatabasePool } from "../db/pool.js";

/** Workers AI prices in neurons per token (2026-11-08: Gemma 4 26B $0.10 / $0.30 per M tokens, BGE-M3 $0.0118; 1,000 neurons = $0.011). */
export const NEURONS_PER_TOKEN = {
  chatIn: 0.10 / 0.011 / 1000,
  chatOut: 0.30 / 0.011 / 1000,
  embed: 0.0118 / 0.011 / 1000,
} as const;
/** The default limit over 24 hours: room under the free 10,000 for what is already running when it is reached. */
export const DEFAULT_DAILY_NEURONS = 9_000;
/** What one more job may cost at most: a roadmap or a comment with its retry, a scanned transcript. */
export const JOB_RESERVE = 600;
/** How long a 4006 answer stops every Workers AI call. */
export const BLOCK_MS = 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const WINDOW_MS = 24 * HOUR_MS;

export interface NeuronBudget {
  /** Whether work that may cost `reserve` neurons can start now: not blocked, and room in the last 24 hours (always without a limit). */
  allows(reserve?: number): Promise<boolean>;
  /** Adds what one call spent. */
  spend(neurons: number): Promise<void>;
  /** Workers AI answered 4006 (its free neurons are used up): no call for BLOCK_MS. */
  block(reason: string): Promise<void>;
  /** The limit over 24 hours, null when there is none (AI_DAILY_NEURONS=off, a paid account). */
  readonly limit: number | null;
}

/** The start of the (UTC) hour of `time`: the key of its row in ai_usage_hours. */
export const hourOf = (time: Date) => new Date(Math.floor(time.getTime() / HOUR_MS) * HOUR_MS);

type Queryable = Pick<DatabasePool, "query">;

/**
 * The budget over ai_usage_hours and ai_quota_block. Both are read again at most every `refreshMs` (other processes, such
 * as the transcript reader, add to them too) and every spend and block is written at once.
 */
export function createNeuronBudget(options: { limit: number | null; db?: Queryable | null | undefined; now?: () => Date; refreshMs?: number; log?: Pick<Console, "warn"> }): NeuronBudget {
  const now = () => (options.now ?? (() => new Date()))().getTime();
  const refreshMs = options.refreshMs ?? 30_000;
  const log = options.log ?? console;
  /** Hour start (ms) → neurons spent in it, as far as this process knows. */
  const hours = new Map<number, number>();
  let blockedUntil = 0;
  let readAt = Number.NEGATIVE_INFINITY;
  let tablesMissing = !options.db;
  const missing = () => {
    if (tablesMissing) return;
    tablesMissing = true;
    log.warn("[AI] ai_usage_hours unavailable: counting neurons in memory");
  };
  // An hour counts while any part of it is within the last 24 hours, so up to 25 hours are summed: never fewer.
  const oldest = () => now() - WINDOW_MS - HOUR_MS;
  const used = () => {
    let sum = 0;
    for (const [hour, neurons] of hours) {
      if (hour > oldest()) sum += neurons;
      else hours.delete(hour);
    }
    return sum;
  };
  const refresh = async () => {
    if (tablesMissing || now() - readAt < refreshMs) return;
    try {
      const usage = await options.db!.query<{ hour: Date | string; neurons: number }>("SELECT hour, neurons FROM ai_usage_hours WHERE hour > $1", [new Date(oldest())]);
      for (const row of usage.rows) {
        const hour = new Date(row.hour).getTime();
        hours.set(hour, Math.max(hours.get(hour) ?? 0, Number(row.neurons)));
      }
      const block = await options.db!.query<{ blocked_until: Date | string }>("SELECT blocked_until FROM ai_quota_block");
      if (block.rows[0]) blockedUntil = Math.max(blockedUntil, new Date(block.rows[0].blocked_until).getTime());
      readAt = now();
    } catch {
      missing();
    }
  };
  return {
    limit: options.limit,
    async allows(reserve = JOB_RESERVE) {
      await refresh();
      if (now() < blockedUntil) return false;
      return options.limit === null || used() + reserve <= options.limit;
    },
    async spend(neurons) {
      if (!(neurons > 0) || !Number.isFinite(neurons)) return;
      const hour = hourOf(new Date(now()));
      const key = hour.getTime();
      hours.set(key, (hours.get(key) ?? 0) + neurons);
      if (tablesMissing) return;
      try {
        const result = await options.db!.query<{ neurons: number }>(
          `INSERT INTO ai_usage_hours(hour,neurons,requests,updated_at) VALUES($1,$2,1,now())
           ON CONFLICT(hour) DO UPDATE SET neurons=ai_usage_hours.neurons+EXCLUDED.neurons,requests=ai_usage_hours.requests+1,updated_at=now()
           RETURNING neurons`, [hour, neurons]);
        hours.set(key, Math.max(hours.get(key) ?? 0, Number(result.rows[0]?.neurons ?? 0)));
      } catch {
        missing();
      }
    },
    async block(reason) {
      const until = now() + BLOCK_MS;
      blockedUntil = Math.max(blockedUntil, until);
      log.warn(`[AI] Workers AI refused: free neurons used up (${reason.slice(0, 60)}); no call until ${new Date(blockedUntil).toISOString()}`);
      if (tablesMissing) return;
      try {
        await options.db!.query(
          `INSERT INTO ai_quota_block(id,blocked_until,reason,updated_at) VALUES(true,$1,$2,now())
           ON CONFLICT(id) DO UPDATE SET blocked_until=GREATEST(ai_quota_block.blocked_until,EXCLUDED.blocked_until),reason=EXCLUDED.reason,updated_at=now()`,
          [new Date(until), reason.slice(0, 60) || "4006"]);
      } catch {
        missing();
      }
    }
  };
}

/** A budget that never stops anything (no Cloudflare, or tests). */
export const UNLIMITED_BUDGET: NeuronBudget = { limit: null, allows: async () => true, spend: async () => undefined, block: async () => undefined };

/** Neurons of a chat call: Workers AI's usage.neurons, else its tokens at Gemma's prices. */
export function chatNeurons(usage: Record<string, unknown> | null | undefined, fallback: { promptChars: number; outputChars: number }): number {
  const reported = Number(usage?.neurons);
  if (Number.isFinite(reported) && reported >= 0) return reported;
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  const promptTokens = Number.isFinite(prompt) ? prompt : fallback.promptChars / 3;
  const completionTokens = Number.isFinite(completion) ? completion : fallback.outputChars / 3;
  return promptTokens * NEURONS_PER_TOKEN.chatIn + completionTokens * NEURONS_PER_TOKEN.chatOut;
}

/** Neurons of an embedding call: usage.neurons, else its prompt tokens (or characters / 3) at BGE-M3's price. */
export function embedNeurons(usage: Record<string, unknown> | null | undefined, inputChars: number): number {
  const reported = Number(usage?.neurons);
  if (Number.isFinite(reported) && reported >= 0) return reported;
  const tokens = Number(usage?.prompt_tokens);
  return (Number.isFinite(tokens) ? tokens : inputChars / 3) * NEURONS_PER_TOKEN.embed;
}
