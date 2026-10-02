import { describe, it, expect } from "vitest";
import { oracleText } from "../js/card-text.js";

describe("oracleText", () => {
  it("returns the top-level oracle_text for single-face cards", () => {
    expect(oracleText({ oracle_text: "Flying" })).toBe("Flying");
  });

  it("joins every face when there's no top-level text", () => {
    expect(oracleText({
      card_faces: [{ oracle_text: "Flying" }, { oracle_text: "Draw a card." }],
    })).toBe("Flying\nDraw a card.");
  });

  it("skips faces without text (vanilla front side)", () => {
    expect(oracleText({
      card_faces: [{ oracle_text: "" }, { oracle_text: "Draw a card." }],
    })).toBe("Draw a card.");
  });

  it("returns an empty string for missing data", () => {
    expect(oracleText(null)).toBe("");
    expect(oracleText({})).toBe("");
  });
});
