import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "msgenc:v1:";
const ENCRYPTED_MESSAGE_PREFIX = "msgenc:";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = NONCE_BYTES + AUTH_TAG_BYTES;

// Explicit temporary rollout opt-out for instances sharing an unmigrated database.
// With no override, encryption is required and missing keys fail closed.
export function storeMessage(value: string, context: string): string {
  return process.env.MESSAGE_ENCRYPTION_ENABLED === "false"
    ? value
    : encryptMessage(value, context);
}

export function readMessage(value: string, context: string): string {
  const allowLegacy =
    process.env.MESSAGE_ENCRYPTION_ENABLED === "false" ||
    process.env.MESSAGE_ENCRYPTION_ALLOW_LEGACY_READS === "true";
  if (allowLegacy && !value.startsWith(ENCRYPTED_MESSAGE_PREFIX)) return value;
  return decryptMessage(value, context);
}

export function messageEncryptionKey(): Buffer {
  const value = process.env.MESSAGE_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
    );
  }
  return key;
}

export function encryptMessage(value: string, context: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, messageEncryptionKey(), nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return (
    PREFIX +
    Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
  );
}

export function decryptMessage(value: string, context: string): string {
  const key = messageEncryptionKey();
  try {
    if (!value.startsWith(PREFIX)) throw new Error();
    const encoded = value.slice(PREFIX.length);
    const payload = Buffer.from(encoded, "base64");
    if (payload.length < HEADER_BYTES || payload.toString("base64") !== encoded)
      throw new Error();
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      payload.subarray(0, NONCE_BYTES)
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(payload.subarray(NONCE_BYTES, HEADER_BYTES));
    return Buffer.concat([
      decipher.update(payload.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Never include message content or key material in errors/logs.
    throw new Error(
      "Stored message could not be decrypted. Check the encryption key and migration status."
    );
  }
}

export const boardMessageContext = (
  authorUserId: number,
  field: "title" | "body"
) => `staffMessages:${authorUserId}:${field}`;
export const directMessageContext = (
  senderUserId: number,
  recipientUserId: number
) => `staffDirectMessages:${senderUserId}:${recipientUserId}:body`;

/** Migration only: validate existing ciphertext rather than encrypting it twice. */
export function migrateMessage(value: string, context: string): string {
  if (value.startsWith(ENCRYPTED_MESSAGE_PREFIX)) {
    decryptMessage(value, context);
    return value;
  }
  return encryptMessage(value, context);
}
