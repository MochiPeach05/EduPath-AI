import { describe, expect, it } from "vitest";
import { mailGrantKey, openGrant, sealGrant } from "./grant-crypto.js";

// Made-up secrets and caches only.
const key = mailGrantKey("test-session-secret-that-is-longer-than-32-characters");

describe("the stored permission to send mail (2026-11-23)", () => {
  it("is sealed with a key of its own and opens only with that key", () => {
    expect(key).toHaveLength(32);
    expect(mailGrantKey("test-session-secret-that-is-longer-than-32-characters").equals(key)).toBe(true);
    expect(mailGrantKey("another-session-secret-that-is-longer-than-32-chars").equals(key)).toBe(false);
    const cache = JSON.stringify({ RefreshToken: { one: { secret: "made-up-refresh-token" } } });
    const sealed = sealGrant(cache, key);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("made-up-refresh-token");
    // A new IV every time: the same cache never seals the same way twice.
    expect(sealGrant(cache, key)).not.toBe(sealed);
    expect(openGrant(sealed, key)).toBe(cache);
    expect(openGrant(sealed, mailGrantKey("another-session-secret-that-is-longer-than-32-chars"))).toBeNull();
  });

  it("refuses a changed or foreign value", () => {
    const sealed = sealGrant("{}", key);
    const [version, iv, tag, body] = sealed.split(".");
    expect(openGrant(`${version}.${iv}.${tag}.${body!.slice(0, -2)}AA`, key)).toBeNull();
    expect(openGrant(`v2.${iv}.${tag}.${body}`, key)).toBeNull();
    expect(openGrant(`${sealed}.extra`, key)).toBeNull();
    expect(openGrant("not sealed", key)).toBeNull();
  });
});
