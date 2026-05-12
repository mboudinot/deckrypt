/* Deck export — pure formatters that turn a deckDef into a string.
 *
 * The "moxfield" and "list" outputs round-trip through `parseDecklist`
 * (parser.js) — i.e. exporting then importing yields the same deck.
 * The "plain" output expands by qty (one line per copy) which is
 * lossy on quantities but conventional for Discord-style sharing.
 * The "json" output is a verbatim dump of the deck definition,
 * trimmed to the fields the app actually uses.
 */

const EXPORT_FORMATS = [
  {
    key: "plain",
    label: "Texte simple (noms uniquement)",
    description: "Une ligne par exemplaire, qty dépliée. Pratique pour Discord, e-mail.",
    extension: "txt",
  },
  {
    key: "list",
    label: "Liste avec quantités",
    description: "« 1 Sol Ring » par ligne. Format minimal réimportable.",
    extension: "txt",
  },
  {
    key: "moxfield",
    label: "MTGA / Moxfield (avec éditions)",
    description: "« 1 Sol Ring (CMD) 259 », sections // Commanders et // Mainboard.",
    extension: "txt",
  },
  {
    key: "json",
    label: "JSON (sauvegarde complète)",
    description: "Définition brute du deck, ré-importable, pour backup.",
    extension: "json",
  },
];

/* --- formatters --- */

function exportPlainNames(def) {
  const lines = [];
  for (const c of def.commanders || []) {
    const qty = c.qty || 1;
    for (let i = 0; i < qty; i++) lines.push(c.name);
  }
  for (const c of def.cards || []) {
    const qty = c.qty || 1;
    for (let i = 0; i < qty; i++) lines.push(c.name);
  }
  return lines.join("\n");
}

function exportListWithQty(def) {
  const lines = [];
  if ((def.commanders || []).length > 0) {
    lines.push("// Commanders");
    for (const c of def.commanders) lines.push(`${c.qty || 1} ${c.name}`);
    lines.push("");
  }
  if ((def.cards || []).length > 0) {
    lines.push("// Mainboard");
    for (const c of def.cards) lines.push(`${c.qty} ${c.name}`);
  }
  return lines.join("\n").trim();
}

function _moxfieldLine(entry, qty) {
  let line = `${qty} ${entry.name}`;
  if (entry.set && entry.collector_number) {
    line += ` (${String(entry.set).toUpperCase()}) ${entry.collector_number}`;
  }
  return line;
}

function exportMoxfield(def) {
  const lines = [];
  if ((def.commanders || []).length > 0) {
    lines.push("// Commanders");
    for (const c of def.commanders) lines.push(_moxfieldLine(c, c.qty || 1));
    lines.push("");
  }
  if ((def.cards || []).length > 0) {
    lines.push("// Mainboard");
    for (const c of def.cards) lines.push(_moxfieldLine(c, c.qty));
  }
  return lines.join("\n").trim();
}

function exportJson(def) {
  // Trim to the canonical fields the app uses — strips any junk that
  // localStorage might have accumulated. Pretty-printed for a backup
  // file the user might want to read.
  const trim = (e) => {
    const out = { name: e.name };
    if (e.set) out.set = e.set;
    if (e.collector_number) out.collector_number = e.collector_number;
    if (typeof e.qty === "number") out.qty = e.qty;
    return out;
  };
  const payload = {
    name: def.name,
    format: def.format || "commander",
    commanders: (def.commanders || []).map(trim),
    cards: (def.cards || []).map(trim),
  };
  return JSON.stringify(payload, null, 2);
}

/* --- public dispatcher --- */

function exportDeck(def, formatKey) {
  if (!def) return "";
  switch (formatKey) {
    case "plain":    return exportPlainNames(def);
    case "list":     return exportListWithQty(def);
    case "moxfield": return exportMoxfield(def);
    case "json":     return exportJson(def);
    default:
      throw new Error(`Unknown export format: ${formatKey}`);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EXPORT_FORMATS,
    exportPlainNames, exportListWithQty, exportMoxfield, exportJson,
    exportDeck,
  };
}
