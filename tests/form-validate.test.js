import { describe, it, expect, beforeEach } from "vitest";
import { flagInvalid, clearInvalid, isFilled, isValidEmail, isStrongPassword, attachAutoClear } from "../js/form-validate.js";

/* These helpers run in real browsers normally, so vitest runs them
 * against a minimal stub: a fake input that exposes classList,
 * setAttribute/getAttribute/removeAttribute, addEventListener, and
 * a `type` / `value` / `valueAsNumber` / `checked` / `dataset`. The
 * stub mimics enough of HTMLInputElement for the helpers to behave
 * identically to the browser. */
function makeInput({ type = "text", value = "", checked = false } = {}) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  const dataset = {};
  return {
    type,
    value,
    checked,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; },
    addEventListener: (ev, fn) => {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    dataset,
    /* Test-only helpers — fire the wired listener for a given event. */
    _fire(ev) { (listeners[ev] || []).forEach((fn) => fn()); },
    _hasClass(c) { return classes.has(c); },
    _attr(k) { return attrs[k]; },
    _listenerCount(ev) { return (listeners[ev] || []).length; },
    get valueAsNumber() {
      if (this.type !== "number") return NaN;
      if (this.value === "") return NaN;
      const n = Number(this.value);
      return Number.isFinite(n) ? n : NaN;
    },
  };
}

describe("flagInvalid", () => {
  it("sets both the .is-invalid class and aria-invalid='true'", () => {
    const input = makeInput();
    flagInvalid(input);
    expect(input._hasClass("is-invalid")).toBe(true);
    expect(input._attr("aria-invalid")).toBe("true");
  });
  it("is a no-op on null/undefined (defensive — never throws)", () => {
    expect(() => flagInvalid(null)).not.toThrow();
    expect(() => flagInvalid(undefined)).not.toThrow();
  });
});

describe("clearInvalid", () => {
  it("removes both the class and the attribute", () => {
    const input = makeInput();
    flagInvalid(input);
    clearInvalid(input);
    expect(input._hasClass("is-invalid")).toBe(false);
    expect(input._attr("aria-invalid")).toBeUndefined();
  });
  it("is idempotent when called on a clean field", () => {
    const input = makeInput();
    expect(() => clearInvalid(input)).not.toThrow();
    expect(input._hasClass("is-invalid")).toBe(false);
  });
  it("is a no-op on null/undefined", () => {
    expect(() => clearInvalid(null)).not.toThrow();
  });
});

describe("isFilled", () => {
  describe("text inputs", () => {
    it("rejects empty and whitespace-only values", () => {
      expect(isFilled(makeInput({ value: "" }))).toBe(false);
      expect(isFilled(makeInput({ value: "   " }))).toBe(false);
      expect(isFilled(makeInput({ value: "\t\n" }))).toBe(false);
    });
    it("accepts any non-empty trimmed value", () => {
      expect(isFilled(makeInput({ value: "a" }))).toBe(true);
      expect(isFilled(makeInput({ value: "  Sol Ring  " }))).toBe(true);
    });
  });

  describe("number inputs", () => {
    it("rejects empty value (even though valueAsNumber would be NaN)", () => {
      expect(isFilled(makeInput({ type: "number", value: "" }))).toBe(false);
    });
    it("accepts 0 (a legitimate value, not 'empty')", () => {
      expect(isFilled(makeInput({ type: "number", value: "0" }))).toBe(true);
    });
    it("accepts positive integers and decimals", () => {
      expect(isFilled(makeInput({ type: "number", value: "1" }))).toBe(true);
      expect(isFilled(makeInput({ type: "number", value: "3.14" }))).toBe(true);
    });
    it("rejects non-numeric content", () => {
      expect(isFilled(makeInput({ type: "number", value: "abc" }))).toBe(false);
    });
  });

  describe("checkbox / radio", () => {
    it("uses checked, not value", () => {
      expect(isFilled(makeInput({ type: "checkbox", checked: true }))).toBe(true);
      expect(isFilled(makeInput({ type: "checkbox", checked: false }))).toBe(false);
      expect(isFilled(makeInput({ type: "radio", checked: true }))).toBe(true);
    });
  });

  it("is false for null/undefined (no input to inspect)", () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts standard addresses", () => {
    expect(isValidEmail("jean.dupont@example.com")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("alice+tag@sub.example.co.uk")).toBe(true);
  });
  it("accepts addresses with unicode in the local-part", () => {
    expect(isValidEmail("étienne@example.fr")).toBe(true);
    expect(isValidEmail("名前@example.jp")).toBe(true);
  });
  it("rejects missing @", () => {
    expect(isValidEmail("jeanexample.com")).toBe(false);
    expect(isValidEmail("jean")).toBe(false);
  });
  it("rejects missing dot in the domain", () => {
    expect(isValidEmail("jean@example")).toBe(false);
    expect(isValidEmail("jean@localhost")).toBe(false);
  });
  it("rejects 1-char TLD", () => {
    expect(isValidEmail("a@b.c")).toBe(false);
  });
  it("rejects empty local-part or empty domain part", () => {
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("jean@.com")).toBe(false);
    expect(isValidEmail("jean@example.")).toBe(false);
  });
  it("rejects whitespace inside the value", () => {
    expect(isValidEmail("jean @example.com")).toBe(false);
    expect(isValidEmail("jean@ex ample.com")).toBe(false);
  });
  it("rejects empty / null / undefined", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
  it("trims surrounding whitespace before checking", () => {
    expect(isValidEmail("  jean@example.com  ")).toBe(true);
  });
});

describe("isStrongPassword", () => {
  it("requires at least 8 characters", () => {
    expect(isStrongPassword("a1")).toBe(false);
    expect(isStrongPassword("abc12")).toBe(false);
    expect(isStrongPassword("abcdefg1")).toBe(true); // exactly 8
  });
  it("requires at least one digit", () => {
    expect(isStrongPassword("abcdefgh")).toBe(false); // 8 chars, no digit
    expect(isStrongPassword("abcdefgh1")).toBe(true);
    expect(isStrongPassword("12345678")).toBe(true);  // all digits is fine
  });
  it("accepts long mixed passphrases", () => {
    expect(isStrongPassword("correct horse battery staple 1")).toBe(true);
  });
  it("rejects empty / null / undefined / non-strings", () => {
    expect(isStrongPassword("")).toBe(false);
    expect(isStrongPassword(null)).toBe(false);
    expect(isStrongPassword(undefined)).toBe(false);
    expect(isStrongPassword(12345678)).toBe(true); // toString -> "12345678" passes
  });
});

describe("attachAutoClear", () => {
  it("clears the invalid state when the input fires 'input'", () => {
    const input = makeInput();
    attachAutoClear(input);
    flagInvalid(input);
    input._fire("input");
    expect(input._hasClass("is-invalid")).toBe(false);
    expect(input._attr("aria-invalid")).toBeUndefined();
  });
  it("also responds to 'change' (for selects/checkboxes)", () => {
    const input = makeInput({ type: "checkbox" });
    attachAutoClear(input);
    flagInvalid(input);
    input._fire("change");
    expect(input._hasClass("is-invalid")).toBe(false);
  });
  it("is idempotent — calling twice does not stack listeners", () => {
    const input = makeInput();
    attachAutoClear(input);
    attachAutoClear(input);
    expect(input._listenerCount("input")).toBe(1);
    expect(input._listenerCount("change")).toBe(1);
    expect(input.dataset.fvAutoClear).toBe("1");
  });
  it("is a no-op on null/undefined", () => {
    expect(() => attachAutoClear(null)).not.toThrow();
  });
});
