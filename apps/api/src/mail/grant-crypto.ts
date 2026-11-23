// The stored permission to send mail (ad_mail_senders.token_cache, migration 066) is encrypted at rest: AES-256-GCM with a
// key derived from SESSION_SECRET by HKDF, so a copy of the database alone cannot send mail. Changing SESSION_SECRET makes
// every stored permission unreadable; the senders then allow EduPath AI again once (approved plan, 2026-11-23).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

/** The 32-byte key of the stored permissions, derived from the session secret for this one use. */
export function mailGrantKey(sessionSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret, "edupath-mail-grant", "ad_mail_senders.token_cache v1", 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function sealGrant(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The plain text of a sealed permission; null when it was sealed with another key or changed. */
export function openGrant(sealed: string, key: Buffer): string | null {
  const [version, iv, tag, body, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined || rest.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
