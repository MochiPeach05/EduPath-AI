import { describe, expect, it } from "vitest";
import { BLOCK_MS, chatNeurons, createNeuronBudget, embedNeurons, hourOf, NEURONS_PER_TOKEN, UNLIMITED_BUDGET } from "./budget.js";

/** A stand-in for ai_usage_hours and ai_quota_block (the SQL of budget.ts, by its first words). */
function fakeTables() {
  const hours = new Map<number, number>();
  let blockedUntil: Date | null = null;
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT hour")) {
        const after = (params[0] as Date).getTime();
        return { rows: [...hours].filter(([hour]) => hour > after).map(([hour, neurons]) => ({ hour: new Date(hour), neurons })) } as never;
      }
      if (sql.startsWith("SELECT blocked_until")) return { rows: blockedUntil ? [{ blocked_until: blockedUntil }] : [] } as never;
      if (sql.includes("INSERT INTO ai_usage_hours")) {
        const hour = (params[0] as Date).getTime();
        hours.set(hour, (hours.get(hour) ?? 0) + Number(params[1]));
        return { rows: [{ neurons: hours.get(hour) }] } as never;
      }
      if (sql.includes("INSERT INTO ai_quota_block")) {
        const until = params[0] as Date;
        if (!blockedUntil || until > blockedUntil) blockedUntil = until;
        return { rows: [] } as never;
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 40)}`);
    },
  };
  return { db, hours };
}

// The neuron budget of Workers AI over the last 24 hours (user 2026-11-09: a free account answered 4006 after 4,300
// neurons since 00:00 UTC, with 5,000 more the evening before).
describe("the neuron budget over the last 24 hours", () => {
  it("counts what the evening before spent after 00:00 UTC, and frees it once it is more than a day old", async () => {
    let now = new Date("2026-11-08T16:00:00Z");
    const budget = createNeuronBudget({ limit: 1_000, now: () => now });
    await budget.spend(600);
    // 00:00 UTC (07:00 in Vietnam) is no reset: the evening's 600 still count.
    now = new Date("2026-11-09T05:00:00Z");
    expect(await budget.allows(300)).toBe(true);
    await budget.spend(200);
    expect(await budget.allows(300)).toBe(false);
    // A whole day after the evening's hour ended, only the morning's 200 are left.
    now = new Date("2026-11-09T17:00:01Z");
    expect(await budget.allows(300)).toBe(true);
    expect(await budget.allows(800)).toBe(true);
    expect(await budget.allows(801)).toBe(false);
    expect(hourOf(new Date("2026-11-09T05:59:59Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });

  it("adds every spend to its hour in ai_usage_hours and reads what the other process spent", async () => {
    const { db, hours } = fakeTables();
    let clock = new Date("2026-11-09T10:00:00Z");
    const worker = createNeuronBudget({ limit: 1_000, db, now: () => clock, refreshMs: 1_000 });
    const reader = createNeuronBudget({ limit: 1_000, db, now: () => clock, refreshMs: 1_000 });
    await worker.spend(400);
    await reader.spend(300);
    expect(hours.get(Date.parse("2026-11-09T10:00:00Z"))).toBe(700);
    clock = new Date("2026-11-09T11:30:05Z");
    await reader.spend(50);
    expect(hours.get(Date.parse("2026-11-09T11:00:00Z"))).toBe(50);
    // The worker sees the reader's 350 once it reads the table again.
    expect(await worker.allows(251)).toBe(false);
    expect(await worker.allows(250)).toBe(true);
  });

  it("stops every Workers AI call of both processes for an hour after a 4006 answer, whatever the count says", async () => {
    const { db } = fakeTables();
    let clock = new Date("2026-11-09T05:45:00Z");
    const warnings: string[] = [];
    const worker = createNeuronBudget({ limit: 9_000, db, now: () => clock, refreshMs: 1_000, log: { warn: (message: string) => warnings.push(message) } });
    const reader = createNeuronBudget({ limit: null, db, now: () => clock, refreshMs: 1_000 });
    expect(await reader.allows()).toBe(true);
    await worker.block("cloudflare_daily_limit");
    expect(await worker.allows()).toBe(false);
    clock = new Date(clock.getTime() + 5_000);
    // The reader learns of it from ai_quota_block, even without a limit of its own.
    expect(await reader.allows()).toBe(false);
    clock = new Date(Date.parse("2026-11-09T05:45:00Z") + BLOCK_MS + 1_000);
    expect(await worker.allows()).toBe(true);
    expect(await reader.allows()).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cloudflare_daily_limit");
  });

  it("counts in memory when the tables are missing, and never stops anything without a limit or a block", async () => {
    const warnings: string[] = [];
    const broken = { query: async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); } };
    const budget = createNeuronBudget({ limit: 500, db: broken, log: { warn: (message: string) => warnings.push(message) } });
    await budget.spend(400);
    expect(await budget.allows(200)).toBe(false);
    expect(warnings).toHaveLength(1);
    const unlimited = createNeuronBudget({ limit: null });
    await unlimited.spend(1e9);
    expect(await unlimited.allows(1e9)).toBe(true);
    expect(await UNLIMITED_BUDGET.allows()).toBe(true);
    await UNLIMITED_BUDGET.block("x");
    expect(await UNLIMITED_BUDGET.allows()).toBe(true);
  });

  it("takes the neurons Workers AI reports, else prices the tokens, else the characters", () => {
    expect(chatNeurons({ neurons: 12.5, prompt_tokens: 9_999 }, { promptChars: 0, outputChars: 0 })).toBe(12.5);
    expect(chatNeurons({ prompt_tokens: 1_000, completion_tokens: 500 }, { promptChars: 0, outputChars: 0 }))
      .toBeCloseTo(1_000 * NEURONS_PER_TOKEN.chatIn + 500 * NEURONS_PER_TOKEN.chatOut);
    expect(chatNeurons(null, { promptChars: 3_000, outputChars: 1_500 })).toBeCloseTo(1_000 * NEURONS_PER_TOKEN.chatIn + 500 * NEURONS_PER_TOKEN.chatOut);
    // 1,000 tokens of Gemma's prompt ≈ 9 neurons, of its answer ≈ 27; 1M tokens of BGE-M3 ≈ 1,073.
    expect(1_000 * NEURONS_PER_TOKEN.chatIn).toBeCloseTo(9.09, 1);
    expect(1_000 * NEURONS_PER_TOKEN.chatOut).toBeCloseTo(27.27, 1);
    expect(embedNeurons({ prompt_tokens: 1_000_000 }, 0)).toBeCloseTo(1_072.7, 0);
    expect(embedNeurons({ neurons: 0.4 }, 99)).toBe(0.4);
    expect(embedNeurons(undefined, 3_000)).toBeCloseTo(1_000 * NEURONS_PER_TOKEN.embed);
  });
});
