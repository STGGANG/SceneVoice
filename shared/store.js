// The shape of the records database.
import { DEFAULT_SETTINGS } from "./settings.js";
export function emptyDatabase() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    analyses: {},
    lineEdits: {},
    states: {},
    stateHistory: [],
    sessions: [],
    messages: [],
    // Group conversations in the messaging app.
    groups: [],
    // 음성 메모: what characters recorded for themselves.
    memos: [],
    // 라디오: shows written whole, each with its lines.
    radio: [],
    generations: [],
    favorites: [],
    // Where each chat came from (see shared/lineage.js); the chat file keeps the original.
    lines: {},
  };
}
export function checkDatabase(data) {
  if (
    data?.version !== 1 ||
    !data.settings ||
    typeof data.settings !== "object" ||
    Array.isArray(data.settings) ||
    !["generations", "sessions", "messages", "favorites", "stateHistory"].every(
      (key) => Array.isArray(data[key]),
    ) ||
    !data.analyses ||
    typeof data.analyses !== "object" ||
    Array.isArray(data.analyses) ||
    !data.states ||
    typeof data.states !== "object" ||
    Array.isArray(data.states) ||
    (data.groups !== undefined && !Array.isArray(data.groups)) ||
    (data.memos !== undefined && !Array.isArray(data.memos)) ||
    (data.radio !== undefined && !Array.isArray(data.radio)) ||
    (data.lineEdits !== undefined &&
      (!data.lineEdits ||
        typeof data.lineEdits !== "object" ||
        Array.isArray(data.lineEdits)))
  ) {
    throw new Error(
      "SceneVoice 저장 파일 형식이 올바르지 않습니다. 기존 파일을 덮어쓰지 않았습니다.",
    );
  }
  data.lineEdits ||= {};
  if (
    !data.lines ||
    typeof data.lines !== "object" ||
    Array.isArray(data.lines)
  )
    data.lines = {};
  // Files written before group conversations (or voice memos) have none.
  data.groups ||= [];
  data.memos ||= [];
  data.radio ||= [];
  return data;
}
/** One emoji (with its skin tone, joined parts or flag pair), as a reaction on a text. */
export const validReaction = (value) =>
  typeof value === "string" &&
  value.length <= 24 &&
  /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\ufe0f|\p{Emoji_Modifier})*(?:\u200d\p{Extended_Pictographic}(?:\ufe0f|\p{Emoji_Modifier})*)*)$/u.test(
    value,
  );
export const validAudioName = (name) =>
  typeof name === "string" &&
  /^(?:[a-f0-9]{64}|fav_[a-f0-9]{32})\.(?:mp3|wav)$/.test(name);
/** A saved voice's type: mp3 from the engines, WAV for a phone line with its sounds mixed in. */
export const audioType = (name) =>
  String(name).endsWith(".wav") ? "audio/wav" : "audio/mpeg";
