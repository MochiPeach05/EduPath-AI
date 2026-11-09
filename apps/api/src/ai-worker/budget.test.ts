import { describe, expect, it } from "vitest";
import { chatNeurons, createNeuronBudget, embedNeurons, NEURONS_PER_TOKEN, UNLIMITED_BUDGET, utcDay } from "./budget.js";

// The day's neuron budget of Workers AI (user 2026-11-09: a free account over 10,000 neurons stayed blocked after the reset).
describe("the day's neuron budget", () => {
  it("lets work start while the day's neurons plus a job's reserve stay under the limit, and starts again the next UTC day", async () => {
    let now = new Date("2026-11-09T22:00:00Z");
    const budget = createNeuronBudget({ limit: 1_000, now: () => now });
    expect(await budget.allows(300)).toBe(true);
    await budget.spend(650);
    expect(await budget.allows(300)).toBe(true);
    await budget.spend(100);
    expect(await budget.allows(300)).toBe(false);
    // 00:00 UTC (07:00 in Vietnam): a new day.
    now = new Date("2026-11-10T00:00:01Z");
    expect(await budget.allows(300)).toBe(true);
    expect(utcDay(now)).toBe("2026-11-10");
  });

  it("adds every spend to ai_daily_usage and reads what other processes spent", async () => {
    const rows = new Map<string, number>();
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        const day = String(params[0]);
        if (sql.startsWith("SELECT")) return { rows: rows.has(day) ? [{ neurons: rows.get(day) }] : [] } as never;
        rows.set(day, (rows.get(day) ?? 0) + Number(params[1]));
        return { rows: [{ neurons: rows.get(day) }] } as never;
      },
    };
    let clock = new Date("2026-11-09T10:00:00Z");
    const worker = createNeuronBudget({ limit: 1_000, db, now: () => clock, refreshMs: 1_000 });
    const reader = createNeuronBudget({ limit: 1_000, db, now: () => clock, refreshMs: 1_000 });
    await worker.spend(400);
    await reader.spend(300);
    expect(rows.get("2026-11-09")).toBe(700);
    clock = new Date("2026-11-09T10:00:05Z");
    // The worker sees the reader's 300 once it reads the table again.
    expect(await worker.allows(301)).toBe(false);
    expect(await worker.allows(300)).toBe(true);
  });

  it("counts in memory when the table is missing, and never stops anything without a limit", async () => {
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
