/* OCR text parsing for the camera card-scanner — pure string logic,
 * no DOM / no I/O, so it's unit-testable in isolation (see
 * tests/scan-parse.test.js). Loaded as a <script> before scan-page.js in
 * scan.html, which consumes these as globals.
 *
 * Both functions take RAW Tesseract output (noisy, multi-line) and distil
 * the two signals we hand to Scryfall:
 *   parseBottom → { set, cn } from the bottom-left info line (authoritative
 *     exact lookup /cards/:set/:cn).
 *   cleanTitle  → the card name from the title band (fuzzy fallback).
 */

/* Language trigraphs sometimes sit next to the set code on the bottom line
 * ("FDN • EN" prints "EN", but OCR noise or older layouts can surface the
 * three-letter form). Excluded so they're never mistaken for a set code. */
const SCAN_LANG_CODES = new Set(
  ["ENG", "FRA", "DEU", "ESP", "ITA", "POR", "JPN", "KOR", "RUS", "ZHS", "ZHT", "PHY"],
);

/* Bottom-left block, e.g. "0123/0456 R" + "FDN • EN" → { set:"fdn", cn:"123" }.
 * cn is the LEFT side of the fraction (this card's number), leading zeros
 * stripped. The set code is the first 3-4 char token that contains a letter
 * and isn't a language trigraph — pure-digit tokens (the collector numbers)
 * are skipped by the letter test. Returns nulls when nothing usable is read;
 * the caller then falls back to the title. */
function parseBottom(raw) {
  const up = (raw || "").toUpperCase();
  let cn = null, set = null;
  const frac = up.match(/(\d{1,5})\s*\/\s*\d{1,5}/);
  if (frac) cn = String(parseInt(frac[1], 10));
  const toks = up.match(/[A-Z0-9]{3,4}/g) || [];
  for (const t of toks) {
    if (!/[A-Z]/.test(t)) continue;            // pure-digit token (a number) → not a set code
    if (SCAN_LANG_CODES.has(t)) continue;      // language trigraph
    set = t.toLowerCase();
    break;
  }
  return { set, cn };
}

/* Title band → best-guess card name. OCR emits stray glyphs and sometimes
 * splits the name across lines; we strip anything outside a name's alphabet
 * (letters incl. accents, apostrophe, period, hyphen, space), collapse
 * whitespace, drop sub-3-char fragments, and keep the longest surviving line
 * (the name outweighs typeline/artist noise that can leak into the crop). */
function cleanTitle(raw) {
  const lines = (raw || "").split(/\n+/).map((l) =>
    l.replace(/[^A-Za-zÀ-ÿ',.\- ]/g, " ").replace(/\s+/g, " ").trim(),
  ).filter((l) => l.length >= 3);
  lines.sort((a, b) => b.length - a.length);
  return lines[0] || "";
}

/* CommonJS export for tests — no-op in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseBottom, cleanTitle, SCAN_LANG_CODES };
}
