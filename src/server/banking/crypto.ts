import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for provider credentials at rest (on top of any
 * database/disk encryption the host provides). The key is derived from
 * TOKEN_ENCRYPTION_KEY, which must be set in production and kept out of the database.
 */

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY is required to store bank credentials");
    return createHash("sha256").update("ledger-dev-only-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
