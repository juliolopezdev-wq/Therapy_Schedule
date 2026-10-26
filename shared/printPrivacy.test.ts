import { describe, expect, it } from "vitest";
import { nameWithoutTrailingInitial } from "./printPrivacy";

describe("nameWithoutTrailingInitial", () => {
  it("removes a trailing last initial", () => {
    expect(nameWithoutTrailingInitial("Colleen M")).toBe("Colleen");
    expect(nameWithoutTrailingInitial("Colleen M.")).toBe("Colleen");
  });

  it("preserves compact uppercase patient identifiers", () => {
    expect(nameWithoutTrailingInitial("MAG")).toBe("MAG");
  });

  it("preserves full names that do not end in an initial", () => {
    expect(nameWithoutTrailingInitial("Colleen Miller")).toBe("Colleen Miller");
  });
});
