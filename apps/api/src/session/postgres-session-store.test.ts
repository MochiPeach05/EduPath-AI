import express from "express";
import session, { MemoryStore } from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { throttleTouch } from "./postgres-session-store.js";

function store(fail = false) {
  const base = new MemoryStore();
  const touch = vi.fn((_sid: string, _sess: unknown, callback?: (error?: unknown) => void) => callback?.(fail ? new Error("db down") : undefined));
  const destroy = vi.fn((_sid: string, callback?: (error?: unknown) => void) => callback?.());
  Object.assign(base, { touch, destroy });
  return { base, touch, destroy };
}

describe("throttleTouch", () => {
  it("writes a session's expiry at most once per interval, and answers the other touches at once", () => {
    let clock = 0;
    const { base, touch } = store();
    const throttled = throttleTouch(base, 60_000, () => clock);
    const done = vi.fn();
    throttled.touch!("a", {} as never, done);
    throttled.touch!("a", {} as never, done);
    throttled.touch!("b", {} as never, done);
    clock = 59_999;
    throttled.touch!("a", {} as never, done);
    expect(touch.mock.calls.map(([sid]) => sid)).toEqual(["a", "b"]);
    clock = 60_000;
    throttled.touch!("a", {} as never, done);
    expect(touch).toHaveBeenCalledTimes(3);
    expect(done).toHaveBeenCalledTimes(5);
  });

  it("tries a failed write again on the next response, and a destroyed session from scratch", () => {
    const failing = store(true);
    const throttled = throttleTouch(failing.base, 60_000, () => 0);
    const errors: unknown[] = [];
    throttled.touch!("a", {} as never, ((error?: unknown) => errors.push(error)) as never);
    throttled.touch!("a", {} as never, ((error?: unknown) => errors.push(error)) as never);
    expect(failing.touch).toHaveBeenCalledTimes(2);
    expect(errors.every((error) => error instanceof Error)).toBe(true);
    const working = store();
    const other = throttleTouch(working.base, 60_000, () => 0);
    other.touch!("s", {} as never, () => undefined);
    other.destroy("s", () => undefined);
    other.touch!("s", {} as never, () => undefined);
    expect(working.touch).toHaveBeenCalledTimes(2);
    expect(working.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the rolling cookie on every response while the store is touched once (express-session)", async () => {
    const { base, touch } = store();
    const app = express();
    app.use(session({ store: throttleTouch(base, 60_000), secret: "test-secret", resave: false, saveUninitialized: false, rolling: true, name: "sid" }));
    app.get("/login", (req, res) => { (req.session as unknown as { user: string }).user = "u"; res.json({ ok: true }); });
    app.get("/data", (_req, res) => { res.json({ big: "x".repeat(10_000) }); });
    const login = await request(app).get("/login").expect(200);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    for (let index = 0; index < 3; index++) {
      const response = await request(app).get("/data").set("Cookie", cookie).expect(200);
      expect(response.headers["set-cookie"]?.[0]).toMatch(/^sid=/);
      expect(response.body.big).toHaveLength(10_000);
    }
    expect(touch).toHaveBeenCalledTimes(1);
  });
});
