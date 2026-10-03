import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/** Development fallback key is derived from a constant and is NOT secret — production requires APP_ENCRYPTION_KEY. */
function key(): Buffer {
  if (env.APP_ENCRYPTION_KEY) {
    const k = Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
    if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64).");
    return k;
  }
  return createHash("sha256").update("deflink-development-only-key").digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1") throw new Error("Unsupported ciphertext version");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
