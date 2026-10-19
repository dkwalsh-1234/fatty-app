import "server-only";

// AES-256-GCM sealing for each person's AI key, with a dedicated server secret.
// Sealed form: base64url(iv).base64url(tag).base64url(ciphertext).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { keyEncryptionSecret } from "../server-env";

function boxKey(secret = keyEncryptionSecret()): Buffer {
  return createHash("sha256").update(`fatty-key-box:${secret}`).digest();
}

export function seal(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", boxKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string, secret?: string): string | null {
  try {
    const [iv, tag, ct] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", boxKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
