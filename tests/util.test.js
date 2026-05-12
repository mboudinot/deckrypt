import { describe, it, expect } from "vitest";
import { pluralFr } from "../js/util.js";

describe("pluralFr", () => {
  it("singular for 1", () => {
    expect(pluralFr(1, "carte")).toBe("1 carte");
    expect(pluralFr(1, "terrain")).toBe("1 terrain");
  });

  it("plural for n > 1 (adds an 's')", () => {
    expect(pluralFr(2, "carte")).toBe("2 cartes");
    expect(pluralFr(99, "permanent")).toBe("99 permanents");
  });

  it("singular for 0 (French convention: 0 ou 1 → singulier)", () => {
    expect(pluralFr(0, "carte")).toBe("0 carte");
  });

  it("singular for negative numbers (defensive — not expected in UI)", () => {
    expect(pluralFr(-1, "carte")).toBe("-1 carte");
  });
});
