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
    generations: [],
    favorites: [],
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
  // Files written before group conversations have none.
  data.groups ||= [];
  return data;
}
export const validAudioName = (name) =>
  typeof name === "string" &&
  /^(?:[a-f0-9]{64}|fav_[a-f0-9]{32})\.(?:mp3|wav)$/.test(name);
/** A saved voice's type: mp3 from the engines, WAV for a phone line with its sounds mixed in. */
export const audioType = (name) => (String(name).endsWith(".wav") ? "audio/wav" : "audio/mpeg");
