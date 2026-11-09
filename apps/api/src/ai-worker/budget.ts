// The day's neuron budget of Cloudflare Workers AI (user 2026-11-09: a free account that went over its 10,000 daily
// neurons stayed blocked with error 4006 long after the 00:00 UTC reset, while its dashboard said 0/10k). Every chat,
// embedding and Gemma OCR call adds what Workers AI reports it spent (usage.neurons, else an estimate from the tokens) to
// ai_daily_usage (migration 059); before taking new work the AI worker and the transcript reader ask whether the day still
// has room. Without the table (a test schema) the count stays in memory.
import type { DatabasePool } from "../db/pool.js";

/** Workers AI prices in neurons per token (2026-11-08: Gemma 4 26B $0.10 / $0.30 per M tokens, BGE-M3 $0.0118; 1,000 neurons = $0.011). */
export const NEURONS_PER_TOKEN = {
  chatIn: 0.10 / 0.011 / 1000,
  chatOut: 0.30 / 0.011 / 1000,
  embed: 0.0118 / 0.011 / 1000,
} as const;
/** The default day's limit: room under the free 10,000 for what is already running when it is reached. */
export const DEFAULT_DAILY_NEURONS = 9_000;
/** What one more job may cost at most: a roadmap or a comment with its retry, a scanned transcript. */
export const JOB_RESERVE = 600;

export interface NeuronBudget {
  /** Whether work that may cost `reserve` neurons can start now (always true without a limit). */
  allows(reserve?: number): Promise<boolean>;
  /** Adds what one call spent. */
  spend(neurons: number): Promise<void>;
  /** The day's limit, null when there is none (AI_DAILY_NEURONS=off, a paid account). */
  readonly limit: number | null;
}

/** "2026-11-09": the day of Workers AI's daily allocation (UTC). */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

type Queryable = Pick<DatabasePool, "query">;

/**
 * The budget over ai_daily_usage. The day's total is read again at most every `refreshMs` (other processes, such as a
 * second loop or the transcript reader, add to it too) and every spend is added at once.
 */
export function createNeuronBudget(options: { limit: number | null; db?: Queryable | null | undefined; now?: () => Date; refreshMs?: number; log?: Pick<Console, "warn"> }): NeuronBudget {
  const now = options.now ?? (() => new Date());
  const refreshMs = options.refreshMs ?? 30_000;
  const log = options.log ?? console;
  let day = "";
  let used = 0;
  let readAt = Number.NEGATIVE_INFINITY;
  let tableMissing = !options.db;
  const roll = () => {
    const today = utcDay(now());
    if (today !== day) {
      day = today;
      used = 0;
      readAt = Number.NEGATIVE_INFINITY;
    }
    return today;
  };
  const refresh = async () => {
    const today = roll();
    if (tableMissing || now().getTime() - readAt < refreshMs) return;
    try {
      const result = await options.db!.query<{ neurons: number }>("SELECT neurons FROM ai_daily_usage WHERE day=$1", [today]);
      used = Math.max(used, Number(result.rows[0]?.neurons ?? 0));
      readAt = now().getTime();
    } catch {
      tableMissing = true;
      log.warn("[AI] ai_daily_usage unavailable: counting neurons in memory");
    }
  };
  return {
    limit: options.limit,
    async allows(reserve = JOB_RESERVE) {
      if (options.limit === null) return true;
      await refresh();
      return used + reserve <= options.limit;
    },
    async spend(neurons) {
      if (!(neurons > 0) || !Number.isFinite(neurons)) return;
      const today = roll();
      used += neurons;
      if (tableMissing) return;
      try {
        const result = await options.db!.query<{ neurons: number }>(
          `INSERT INTO ai_daily_usage(day,neurons,requests,updated_at) VALUES($1,$2,1,now())
           ON CONFLICT(day) DO UPDATE SET neurons=ai_daily_usage.neurons+EXCLUDED.neurons,requests=ai_daily_usage.requests+1,updated_at=now()
           RETURNING neurons`, [today, neurons]);
        used = Math.max(used, Number(result.rows[0]?.neurons ?? used));
      } catch {
        tableMissing = true;
        log.warn("[AI] ai_daily_usage unavailable: counting neurons in memory");
      }
    }
  };
}

/** A budget that never stops anything (no Cloudflare, or tests). */
export const UNLIMITED_BUDGET: NeuronBudget = { limit: null, allows: async () => true, spend: async () => undefined };

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
