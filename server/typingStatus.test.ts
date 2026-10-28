import { describe, expect, it } from "vitest";
import { isTyping, setTyping } from "./typingStatus";

describe("typing status", () => {
  it("shows typing only to the person being typed to", () => {
    setTyping(1, 2, true, 1000);
    expect(isTyping(1, 2, 2000)).toBe(true);
    expect(isTyping(2, 1, 2000)).toBe(false);
    expect(isTyping(1, 3, 2000)).toBe(false);
  });

  it("stops after a few seconds without a keystroke", () => {
    setTyping(4, 5, true, 1000);
    expect(isTyping(4, 5, 8000)).toBe(false);
  });

  it("stops right away when the message is sent", () => {
    setTyping(6, 7, true, 1000);
    setTyping(6, 7, false, 1500);
    expect(isTyping(6, 7, 2000)).toBe(false);
  });
});
