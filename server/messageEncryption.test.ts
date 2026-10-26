import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptMessage, decryptMessage, migrateMessage, boardMessageContext, directMessageContext, storeMessage, readMessage } from "./messageEncryption";

describe("stored message encryption", () => {
  beforeEach(() => {
    vi.stubEnv("MESSAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("MESSAGE_ENCRYPTION_ALLOW_LEGACY_READS", "false");
  });
  afterEach(() => vi.unstubAllEnvs());
  const context = directMessageContext(1, 2);

  it("round trips Unicode and empty messages with randomized ciphertext", () => {
    for (const body of ["", "Private handoff 🏥 café", "x".repeat(1200)]) {
      const first = encryptMessage(body, context);
      expect(first).not.toBe(encryptMessage(body, context));
      expect(decryptMessage(first, context)).toBe(body);
    }
  });
  it("rejects tampering, wrong keys, and changes to recipients or fields", () => {
    const value = encryptMessage("private", context);
    const payload = Buffer.from(value.slice("msgenc:v1:".length), "base64");
    for (const offset of [0, 12, 28]) {
      const changed = Buffer.from(payload);
      changed[offset] ^= 1;
      expect(() => decryptMessage("msgenc:v1:" + changed.toString("base64"), context)).toThrow();
    }
    expect(() => decryptMessage(value, directMessageContext(1, 3))).toThrow();
    const title = encryptMessage("private", boardMessageContext(1, "title"));
    expect(() => decryptMessage(title, boardMessageContext(1, "body"))).toThrow();
    vi.stubEnv("MESSAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptMessage(value, context)).toThrow();
  });
  it("fails closed without a valid key or encrypted data", () => {
    for (const value of ["plaintext", "msgenc:v2:abc", "msgenc:v1:garbage"]) {
      expect(() => decryptMessage(value, context)).toThrow();
    }
    for (const key of ["", "invalid", randomBytes(16).toString("base64")]) {
      vi.stubEnv("MESSAGE_ENCRYPTION_KEY", key);
      expect(() => encryptMessage("private", context)).toThrow();
    }
  });
  it("migrates plaintext once and validates previously encrypted values", () => {
    const value = migrateMessage("legacy", context);
    expect(decryptMessage(value, context)).toBe("legacy");
    expect(migrateMessage(value, context)).toBe(value);
    expect(() => migrateMessage("msgenc:v1:broken", context)).toThrow();
  });

  it("requires encryption by default and only permits plaintext with an explicit rollout opt-out", () => {
    vi.stubEnv("MESSAGE_ENCRYPTION_ENABLED", "");
    expect(readMessage(storeMessage("private", context), context)).toBe("private");
    expect(() => readMessage("plaintext", context)).toThrow();
    vi.stubEnv("MESSAGE_ENCRYPTION_ENABLED", "false");
    expect(storeMessage("legacy", context)).toBe("legacy");
    expect(readMessage("legacy", context)).toBe("legacy");
    expect(() => readMessage("msgenc:v1:broken", context)).toThrow();
  });

  it("encrypts new writes while temporarily allowing legacy reads during deployment", () => {
    vi.stubEnv("MESSAGE_ENCRYPTION_ENABLED", "true");
    vi.stubEnv("MESSAGE_ENCRYPTION_ALLOW_LEGACY_READS", "true");
    expect(readMessage("legacy", context)).toBe("legacy");
    expect(storeMessage("new message", context)).toMatch(/^msgenc:v1:/);
    expect(() => readMessage("msgenc:v1:broken", context)).toThrow();
  });
});
