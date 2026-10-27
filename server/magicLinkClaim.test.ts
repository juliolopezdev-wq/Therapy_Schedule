import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createClient> | null }));
vi.mock("@libsql/client/http", () => ({ createClient: () => state.client }));

import { markMagicLinkUsed } from "./db";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "http://unused.invalid");
  state.client = createClient({ url: "file::memory:" });
  await state.client.executeMultiple(`
    CREATE TABLE magicLinks (id INTEGER PRIMARY KEY, expiresAt INTEGER NOT NULL, usedAt INTEGER);
    INSERT INTO magicLinks VALUES (1, 4102444800, NULL), (2, 1, NULL), (3, 4102444800, 1);
  `);
});

afterAll(() => {
  state.client?.close();
  vi.unstubAllEnvs();
});

it("allows only one concurrent claim of an unused link", async () => {
  const results = await Promise.all([markMagicLinkUsed(1), markMagicLinkUsed(1)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await markMagicLinkUsed(1)).toBe(false);
});

it("cannot claim expired, used, or nonexistent links", async () => {
  expect(await markMagicLinkUsed(2)).toBe(false);
  expect(await markMagicLinkUsed(3)).toBe(false);
  expect(await markMagicLinkUsed(404)).toBe(false);
});
