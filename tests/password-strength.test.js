import { describe, it, expect } from "vitest";
import { strengthEstimate, COMMON_PASSWORDS, STRENGTH_LABELS } from "../js/password-strength.js";

describe("strengthEstimate", () => {
  it("returns an empty result for empty input (meter stays hidden)", () => {
    expect(strengthEstimate("")).toEqual({ score: 0, label: "", hints: [] });
    expect(strengthEstimate(null)).toEqual({ score: 0, label: "", hints: [] });
    expect(strengthEstimate(undefined)).toEqual({ score: 0, label: "", hints: [] });
  });

  it("flags too-short passwords with a length hint, score 0", () => {
    const r = strengthEstimate("abc");
    expect(r.score).toBe(0);
    expect(r.label).toBe("Très faible");
    expect(r.hints.some((h) => /trop court/i.test(h))).toBe(true);
  });

  it("clamps to 'Très faible' for common passwords regardless of length", () => {
    /* `password123` is 11 chars, 2 classes — would otherwise score ~2.
     * The common-list override forces it to 0 and surfaces the hint
     * first so the user reads it before any other suggestion. */
    const r = strengthEstimate("password123");
    expect(r.score).toBe(0);
    expect(r.label).toBe("Très faible");
    expect(r.hints[0]).toMatch(/trop courant/i);
  });

  it("matches common passwords case-insensitively", () => {
    expect(strengthEstimate("PASSWORD").score).toBe(0);
    expect(strengthEstimate("AzErTy").score).toBe(0);
  });

  it("rates a long single-class passphrase as at least 'Fort' (length-first)", () => {
    /* NIST guidance: length beats composition. `correcthorsebattery`
     * is one character class but 19 chars → score 3. */
    const r = strengthEstimate("correcthorsebattery");
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it("rates a 12-char varied password as 'Fort' or 'Très fort'", () => {
    const r = strengthEstimate("MyD3ckRulez!");
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it("suggests variety when a long password uses only one class", () => {
    const r = strengthEstimate("abcdefghij");
    expect(r.hints.some((h) => /varie/i.test(h))).toBe(true);
  });

  it("caps the score at 1 when the password contains the email local-part", () => {
    const r = strengthEstimate("johndoeIsMyPasswd1!", { email: "johndoe@example.com" });
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.hints.some((h) => /email/i.test(h))).toBe(true);
  });

  it("caps the score at 1 when the password contains the display name", () => {
    const r = strengthEstimate("MboudinotPass1!", { displayName: "Mboudinot" });
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.hints.some((h) => /pseudo/i.test(h))).toBe(true);
  });

  it("ignores email local-parts shorter than 4 chars (false-positive guard)", () => {
    const r = strengthEstimate("ablongerpassword!", { email: "ab@example.com" });
    expect(r.hints.some((h) => /email/i.test(h))).toBe(false);
  });

  it("returns a label for every score 0..4", () => {
    expect(STRENGTH_LABELS).toHaveLength(5);
    for (const lbl of STRENGTH_LABELS) {
      expect(typeof lbl).toBe("string");
      expect(lbl.length).toBeGreaterThan(0);
    }
  });

  it("includes the canonical leak-list staples", () => {
    /* Spot-checks — if this fails, the list lost coverage in a refactor. */
    expect(COMMON_PASSWORDS.has("password")).toBe(true);
    expect(COMMON_PASSWORDS.has("azerty")).toBe(true);
    expect(COMMON_PASSWORDS.has("12345678")).toBe(true);
    expect(COMMON_PASSWORDS.has("deckrypt")).toBe(true);
  });
});
