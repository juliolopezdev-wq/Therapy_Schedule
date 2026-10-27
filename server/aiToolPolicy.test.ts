import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createAiProposal: vi.fn() }));
vi.mock("./aiReview", () => ({ createAiProposal: mocks.createAiProposal }));
vi.mock("./aiPrivacy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiPrivacy")>();
  return {
    ...actual,
    loadAiPseudonymizer: async (referenceDate: Date) =>
      new actual.AiPseudonymizer([{ id: 12, name: "Jane Doe", roomNumber: "204", mrn: "MRN88231" }], ["Alex Rivera"], referenceDate),
  };
});
vi.mock("./_core/env", () => ({
  ENV: {
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "test",
    aiRemoteApproved: false,
  },
}));
import { runToolLoop } from "./ollama";
import { ENV } from "./_core/env";
const tool = {
  type: "function",
  function: {
    name: "create_session",
    description: "Propose a session",
    parameters: { type: "object", properties: {} },
  },
};
beforeEach(() => {
  mocks.createAiProposal
    .mockReset()
    .mockResolvedValue({ id: "proposal", changes: [], expiresAt: new Date() });
});
afterEach(() => vi.unstubAllGlobals());
it("turns model-selected writes into proposals rather than executing them", async () => {
  const call = {
    function: {
      name: "create_session",
      arguments: { patientId: 1, confirmed: true },
    },
  };
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ message: { tool_calls: [call] } }),
    });
  vi.stubGlobal("fetch", fetch);
  const result = await runToolLoop([], [tool] as never, new Date(), "", {
    id: 1,
    email: "admin@example.com",
  });
  expect(result.actionsTaken).toEqual([]);
  expect(result.proposal?.id).toBe("proposal");
  expect(mocks.createAiProposal).toHaveBeenCalledWith(
    [call],
    { id: 1, email: "admin@example.com" },
    expect.any(Date)
  );
});
it("rejects hallucinated tools and writes attempted through a read-only tool set", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            tool_calls: [
              {
                function: {
                  name: "cancel_session",
                  arguments: { sessionId: 1, confirmed: true },
                },
              },
            ],
          },
        }),
      })
  );
  const result = await runToolLoop([], [tool] as never, new Date(), "", {
    id: 1,
    email: "admin@example.com",
  });
  expect(result.usedFallback).toBe(true);
  expect(mocks.createAiProposal).not.toHaveBeenCalled();
});
it("blocks remote endpoints that are not HTTPS", async () => {
  const original = ENV.ollamaBaseUrl;
  ENV.ollamaBaseUrl = "http://remote.example.com";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    const result = await runToolLoop([], [tool] as never, new Date(), "");
    expect(result.usedFallback).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    ENV.ollamaBaseUrl = original;
  }
});
it("sends remote models only patient codes and decodes the reply", async () => {
  const original = ENV.ollamaBaseUrl;
  ENV.ollamaBaseUrl = "https://remote.example.com";
  let sent = "";
  const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
    sent = init.body;
    const code = /P-[A-Z2-9]{4}(?=,)/.exec(sent)![0];
    return { ok: true, json: async () => ({ message: { content: `${code} needs PT today+1 09:00.` } }) };
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const result = await runToolLoop(
      [
        { role: "system", content: "prompt" },
        { role: "system", content: "- [id 12] Room 204 (Jane Doe), admitted 2026-10-20, MRN88231" },
        { role: "user", content: "When can jane in 204 get PT?" },
      ],
      [tool] as never,
      new Date(2026, 9, 27, 8),
      ""
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(sent).not.toMatch(/jane|doe|204|88231|2026-10/i);
    expect(result.answer).toBe("Room 204 (Jane Doe) needs PT Wed, Oct 28 9:00 AM.");
  } finally {
    ENV.ollamaBaseUrl = original;
  }
});
