import { describe, expect, it } from "vitest";
import { refreshDue } from "./use-live-data";

describe("refreshDue", () => {
  it("refreshes a visible page at most every 5 s", () => {
    expect(refreshDue({ visible: true, inFlight: false, sinceRequestMs: 5_000 })).toBe(true);
    expect(refreshDue({ visible: true, inFlight: false, sinceRequestMs: 4_999 })).toBe(false);
    expect(refreshDue({ visible: false, inFlight: false, sinceRequestMs: 60_000 })).toBe(false);
  });

  // 2026-11-10: the focus coming back cancelled a slow answer still loading, for a new request.
  it("never cuts off a request still on its way, unless it has hung for a minute", () => {
    expect(refreshDue({ visible: true, inFlight: true, sinceRequestMs: 7_000 })).toBe(false);
    expect(refreshDue({ visible: true, inFlight: true, sinceRequestMs: 59_999 })).toBe(false);
    expect(refreshDue({ visible: true, inFlight: true, sinceRequestMs: 60_000 })).toBe(true);
  });
});
