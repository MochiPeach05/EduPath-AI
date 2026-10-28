// Wakes a worker's held /claim (wait: true) when a question is queued in this API process, so the answer starts at
// once instead of on the worker's next poll. Render runs one instance of the API; with more, a held claim times out
// after CLAIM_WAIT_MS and the worker claims again.
import { EventEmitter } from "node:events";

const events = new EventEmitter();
events.setMaxListeners(100);

export function notifyAssistantWork(): void {
  events.emit("work");
}

/** Resolves true when work was queued within ms, false on timeout or abort. */
export function waitForAssistantWork(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    const finish = (value: boolean) => {
      clearTimeout(timer);
      events.off("work", onWork);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onWork = () => finish(true);
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    events.on("work", onWork);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
