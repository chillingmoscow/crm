import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY_ENV = "INTEGRATIONS_ENCRYPTION_KEY";

function getKey(): Buffer {
  const value = process.env[KEY_ENV];
  if (!value) throw new Error(`${KEY_ENV} is not set`);

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be a base64-encoded 32-byte key`);
  }

  return key;
}

export function encryptSecret(secret: string): {
  encrypted: string;
  iv: string;
  tag: string;
} {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(payload: {
  encrypted: string;
  iv: string;
  tag: string;
}): string {
  const key = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
