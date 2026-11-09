import { describe, expect, it } from "vitest";
import { accountTag, BLOCK_MS, chatNeurons, createNeuronBudget, embedNeurons, hourOf, NEURONS_PER_TOKEN, UNLIMITED_BUDGET } from "./budget.js";

/** A stand-in for ai_usage_hours and ai_quota_block, per account (the SQL of budget.ts, by its first words). */
function fakeTables() {
  const hours = new Map<string, number>();
  const blocks = new Map<string, Date>();
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT hour")) {
        const [account, after] = params as [string, Date];
        return { rows: [...hours].map(([key, neurons]) => ({ key: key.split("|"), neurons }))
          .filter(({ key }) => key[0] === account && Number(key[1]) > after.getTime()).map(({ key, neurons }) => ({ hour: new Date(Number(key[1])), neurons })) } as never;
      }
      if (sql.startsWith("SELECT blocked_until")) {
        const until = blocks.get(params[0] as string);
        return { rows: until ? [{ blocked_until: until }] : [] } as never;
      }
      if (sql.includes("INSERT INTO ai_usage_hours")) {
        const key = `${params[0]}|${(params[1] as Date).getTime()}`;
        hours.set(key, (hours.get(key) ?? 0) + Number(params[2]));
        return { rows: [{ neurons: hours.get(key) }] } as never;
      }
      if (sql.includes("INSERT INTO ai_quota_block")) {
        const [account, until] = params as [string, Date];
        if (!blocks.has(account) || until > blocks.get(account)!) blocks.set(account, until);
        return { rows: [] } as never;
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 40)}`);
    },
  };
  return { db, hours, blocks };
}
const ACCOUNT_OLD = "0123456789abcdef0123456789abcdef";
const ACCOUNT_NEW = "fedcba9876543210fedcba9876543210";

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
    const worker = createNeuronBudget({ limit: 1_000, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000 });
    const reader = createNeuronBudget({ limit: 1_000, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000 });
    await worker.spend(400);
    await reader.spend(300);
    expect(hours.get(`${accountTag(ACCOUNT_OLD)}|${Date.parse("2026-11-09T10:00:00Z")}`)).toBe(700);
    clock = new Date("2026-11-09T11:30:05Z");
    await reader.spend(50);
    expect(hours.get(`${accountTag(ACCOUNT_OLD)}|${Date.parse("2026-11-09T11:00:00Z")}`)).toBe(50);
    // The worker sees the reader's 350 once it reads the table again.
    expect(await worker.allows(251)).toBe(false);
    expect(await worker.allows(250)).toBe(true);
  });

  it("stops every Workers AI call of both processes for an hour after a 4006 answer, whatever the count says", async () => {
    const { db } = fakeTables();
    let clock = new Date("2026-11-09T05:45:00Z");
    const warnings: string[] = [];
    const worker = createNeuronBudget({ limit: 9_000, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000, log: { warn: (message: string) => warnings.push(message) } });
    const reader = createNeuronBudget({ limit: null, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000 });
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

  it("keeps the stop and the count per account: new keys start at once, with an empty count", async () => {
    const { db, blocks } = fakeTables();
    let clock = new Date("2026-11-09T06:35:00Z");
    const quiet = { warn: () => undefined };
    const old = createNeuronBudget({ limit: 1_000, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000, log: quiet });
    await old.spend(900);
    await old.block("cloudflare_daily_limit");
    expect(await old.allows(100)).toBe(false);
    // The server restarts with the new account's keys (user 2026-11-09: "Tôi đã đổi key rồi nhưng sao nó k chạy nhỉ").
    clock = new Date("2026-11-09T07:10:00Z");
    const fresh = createNeuronBudget({ limit: 1_000, account: ACCOUNT_NEW, db, now: () => clock, refreshMs: 1_000, log: quiet });
    expect(await fresh.allows(1_000)).toBe(true);
    // Deleting an account's stop by hand lifts it within refreshMs, without a restart.
    const again = createNeuronBudget({ limit: null, account: ACCOUNT_OLD, db, now: () => clock, refreshMs: 1_000, log: quiet });
    expect(await again.allows()).toBe(false);
    blocks.delete(accountTag(ACCOUNT_OLD));
    clock = new Date(clock.getTime() + 2_000);
    expect(await again.allows()).toBe(true);
    // The tables never hold an account id, only its tag.
    expect(accountTag(ACCOUNT_OLD)).toMatch(/^[0-9a-f]{16}$/);
    expect(accountTag(ACCOUNT_OLD)).not.toContain(ACCOUNT_OLD.slice(0, 8));
    expect(accountTag(` ${ACCOUNT_OLD.toUpperCase()} `)).toBe(accountTag(ACCOUNT_OLD));
    expect(accountTag(null)).toBe("none");
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
