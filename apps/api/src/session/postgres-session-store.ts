import connectPgSimple from "connect-pg-simple";
import session, { type Store } from "express-session";
import type { DatabasePool } from "../db/pool.js";

const PostgresSessionStore = connectPgSimple(session);

/** How often a session's stored expiry is moved on at most (throttleTouch). */
export const TOUCH_EVERY_MS = 60_000;

export function createPostgresSessionStore(pool: DatabasePool): Store {
  return throttleTouch(new PostgresSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60
  }), TOUCH_EVERY_MS);
}

/**
 * express-session with rolling cookies touches the session on every response, and holds the response's last byte until
 * the store has written the new expiry: one more round trip to the database on every API call, and a wait for a free
 * connection whenever the pool is busy (2026-11-10: a response looked cut off while several requests ran). The stored
 * expiry of a session is now moved on at most once every `everyMs` per server; the cookie still rolls on every response.
 * The stored expiry trails the cookie by less than `everyMs`, against a session of SESSION_MAX_AGE_MS (8 hours by default).
 * A failed write is tried again on the next response.
 */
export function throttleTouch<S extends Store>(store: S, everyMs: number, now: () => number = () => Date.now(), maxSessions = 10_000): S {
  const touch = store.touch?.bind(store);
  if (!touch) return store;
  const touched = new Map<string, number>();
  store.touch = (sid, sess, callback) => {
    // express-session passes the store's error on (its types declare no argument).
    const done = callback as ((error?: unknown) => void) | undefined;
    const at = now();
    const last = touched.get(sid);
    if (last !== undefined && at - last < everyMs) { done?.(); return; }
    touched.delete(sid);
    touched.set(sid, at);
    while (touched.size > maxSessions) touched.delete(touched.keys().next().value!);
    (touch as (sid: string, sess: unknown, callback: (error?: unknown) => void) => void)(sid, sess, (error?: unknown) => {
      if (error) touched.delete(sid);
      done?.(error);
    });
  };
  // A destroyed session (sign-out) is touched again at once if its id ever comes back.
  const destroy = store.destroy.bind(store);
  store.destroy = (sid, callback) => { touched.delete(sid); destroy(sid, callback); };
  return store;
}
