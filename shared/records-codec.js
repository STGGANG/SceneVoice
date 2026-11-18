// How records are written to their files: fields that only say again what another field says are
// left out, and put back when the file is read. The records in memory are always whole.
import { normalizeTags, tagEmotion } from "./providers.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plainOf = (script) =>
  String(script)
    .replace(/\[[^\[\]\r\n]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
// What each letter of a record's "_" mark stands for, and how the field comes back.
const DERIVED = {
  t: ["tags", (item) => normalizeTags({ script: item.script })],
  d: ["direction", (item) => item.tags.join(", ")],
  e: ["emotion", (item) => tagEmotion(item.tags)],
  a: ["applied_control", (item) => item.script.slice(0, 400)],
  x: ["text", (item) => plainOf(item.script)],
  n: ["needs_confirmation", () => false],
  c: ["speaker_confidence", () => 0],
};
const ORDER = "tdeaxnc";

/**
 * A spoken line's record without the fields that can be worked out again. `fields`: which letters
 * may go for this kind of record. Only a field equal to what would be put back is dropped, so the
 * round trip is exact; "_" lists what was dropped.
 */
export function slimSpeech(item, fields = ORDER) {
  if (!item || typeof item !== "object" || Array.isArray(item) || "_" in item)
    return item;
  const whole = { ...item };
  const out = { ...item };
  let dropped = "";
  // In the order they come back: tags first, as direction and emotion are read from them.
  for (const letter of ORDER) {
    if (!fields.includes(letter)) continue;
    const [field, derive] = DERIVED[letter];
    if (!(field in whole)) continue;
    const needsScript = "tax".includes(letter);
    if (needsScript && (typeof whole.script !== "string" || !whole.script))
      continue;
    if ("de".includes(letter) && !Array.isArray(whole.tags)) continue;
    if (!same(whole[field], derive(whole))) continue;
    delete out[field];
    dropped += letter;
  }
  return dropped ? { ...out, _: dropped } : item;
}

/** The record as it was before slimSpeech. */
export function fullSpeech(item) {
  if (!item || typeof item !== "object" || typeof item._ !== "string")
    return item;
  const { _: dropped, ...out } = item;
  for (const letter of ORDER) {
    if (!dropped.includes(letter)) continue;
    const [field, derive] = DERIVED[letter];
    // A mark that doesn't fit its record (a file edited by hand) is passed over, not thrown at.
    if ("tax".includes(letter) && typeof out.script !== "string") continue;
    if ("de".includes(letter) && !Array.isArray(out.tags)) continue;
    out[field] = derive(out);
  }
  return out;
}

const eachSpeech = (name, value, change) => {
  if (!value || typeof value !== "object") return value;
  if (name === "media") {
    // A voice's words stay in its record (lists show them without the tagged line).
    const lines = (list) =>
      Array.isArray(list) ? list.map((item) => change(item, "tdea")) : list;
    return {
      ...value,
      generations: lines(value.generations),
      favorites: lines(value.favorites),
    };
  }
  if (name === "analyses" && value.analyses)
    return {
      ...value,
      analyses: Object.fromEntries(
        Object.entries(value.analyses).map(([key, record]) => [
          key,
          Array.isArray(record?.analyses)
            ? {
                ...record,
                analyses: record.analyses.map((item) => change(item, ORDER)),
              }
            : record,
        ]),
      ),
    };
  return value;
};
/** A part of the records as it is written to its file. */
export const slimPart = (name, value) => eachSpeech(name, value, slimSpeech);
/** A part read from its file, whole again. */
export const fullPart = (name, value) => eachSpeech(name, value, fullSpeech);
