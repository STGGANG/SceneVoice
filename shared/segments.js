const escaped = (text, index) => {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count++;
  return count % 2 === 1;
};
// What gets a play button: text between a start and an end mark. "dialogue" regions are
// spoken lines; "thought" regions (inner thoughts, actions) use a person's thought voice.
export const READING_KINDS = ["dialogue", "thought"];
// Double quotes are read out of the box; single quotes (often inner thoughts) are thoughts.
export const DEFAULT_READING_RULES = [
  { id: "double-curly", open: "“", close: "”", kind: "dialogue", enabled: true },
  { id: "double-straight", open: '"', close: '"', kind: "dialogue", enabled: true },
  { id: "corner", open: "「", close: "」", kind: "dialogue", enabled: false },
  { id: "white-corner", open: "『", close: "』", kind: "dialogue", enabled: false },
  { id: "single-curly", open: "‘", close: "’", kind: "thought", enabled: false },
  { id: "single-straight", open: "'", close: "'", kind: "thought", enabled: false },
  { id: "asterisk", open: "*", close: "*", kind: "thought", enabled: true },
  { id: "paren", open: "(", close: ")", kind: "thought", enabled: false },
];
// An apostrophe inside a word (don't, it’s) neither opens nor closes a quote.
const WORD = /[\p{L}\p{N}]/u;
const apostrophe = (text, index, marker, opening) =>
  ["'", "‘", "’"].includes(marker) &&
  (opening ? WORD.test(text[index - 1] || "") : WORD.test(text[index + 1] || ""));

/** Accepts the reading settings or a rule list. */
export function readingRules(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.rules)) return source.rules;
  return DEFAULT_READING_RULES.filter((rule) => rule.kind === "dialogue");
}

export function extractSegments(text, reading) {
  text = String(text || "");
  const excluded = [...text.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g)].map(
    (match) => [match.index, match.index + match[0].length],
  );
  const ranges = [];
  const pairs = readingRules(reading)
    .filter((rule) => rule?.enabled !== false && rule?.open && rule?.close)
    .map((rule) => [
      rule.open,
      rule.close,
      rule.kind === "thought" ? "thought" : "dialogue",
    ]);
  for (const [open, close, kind] of pairs) {
    // A single * next to another * is Markdown bold, not a marked region.
    const valid = (index, marker, opening) =>
      !escaped(text, index) &&
      !apostrophe(text, index, marker, opening) &&
      !excluded.some(([a, b]) => index < b && index + marker.length > a) &&
      !(
        marker === "*" &&
        (text[index - 1] === "*" || text[index + 1] === "*")
      );
    const next = (marker, offset, opening) => {
      let index = text.indexOf(marker, offset);
      while (index !== -1 && !valid(index, marker, opening))
        index = text.indexOf(marker, index + marker.length);
      return index;
    };
    let offset = 0;
    while (offset < text.length) {
      const start = next(open, offset, true);
      if (start === -1) break;
      const finish = next(close, start + open.length, false);
      if (finish === -1) break;
      const end = finish + close.length;
      offset = end;
      const inner = text.slice(start + open.length, finish).trim();
      if (
        !inner ||
        inner.length > 5000 ||
        excluded.some(([a, b]) => start < b && end > a)
      )
        continue;
      ranges.push({
        start,
        end,
        text: inner,
        marked: text.slice(start, end),
        kind,
      });
    }
  }
  const result = [];
  for (const range of ranges.sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    if (result.some((x) => range.start < x.end && range.end > x.start))
      continue;
    result.push(range);
  }
  return result;
}
