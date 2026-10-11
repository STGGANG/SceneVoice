import { checkDatabase, emptyDatabase, validAudioName } from "./store.js";
import { validateSettings, UserError } from "./settings.js";

// Imports only accept this extension's data format. File paths are reconstructed by STFileStore.
export function validateBackup(input) {
  const fail = () => {
    throw new UserError("씬보이스 목록 백업 형식이 올바르지 않습니다.");
  };
  if (input?.format !== "scenevoice-catalog-v2") fail();
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail();
      walk(child);
    }
  };
  walk(input);
  const raw = checkDatabase(structuredClone(input.data));
  const data = emptyDatabase();
  data.settings = validateSettings(data.settings, raw.settings);
  for (const engine of ["fish", "elevenlabs"])
    data.settings[engine].api_key = "";
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const rows = (items) => {
    for (const item of items) {
      if (!object(item) || typeof item.id !== "string") fail();
      if (item.audio_filename && !validAudioName(item.audio_filename)) fail();
      delete item.audio_url;
    }
    return items;
  };
  for (const key of [
    "generations",
    "favorites",
    "messages",
    "sessions",
    "stateHistory",
  ])
    data[key] = rows(raw[key]);
  data.groups = rows(raw.groups);
  for (const group of data.groups) if (!Array.isArray(group.members)) fail();
  for (const session of data.sessions) {
    if (!Array.isArray(session.turns)) fail();
    rows(session.turns);
  }
  if (!object(raw.states) || !object(raw.lineEdits) || !object(raw.analyses))
    fail();
  for (const state of Object.values(raw.states)) if (!object(state)) fail();
  for (const [key, edit] of Object.entries(raw.lineEdits)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !object(edit) ||
      typeof edit.chat_id !== "string" ||
      !object(edit.value)
    )
      fail();
    if (edit.value.speaker_key && typeof edit.value.speaker_key !== "string")
      fail();
    if (edit.value.performance && !object(edit.value.performance)) fail();
  }
  data.states = raw.states;
  data.lineEdits = raw.lineEdits;
  // Reusable model results can be recomputed. Do not import arbitrary nested cache data.
  data.analyses = {};
  data.audioFiles = {};
  for (const [name, row] of Object.entries(raw.audioFiles || {})) {
    if (
      !validAudioName(name) ||
      !object(row) ||
      !Number.isFinite(row.size) ||
      row.size < 0 ||
      !Number.isFinite(row.created)
    )
      fail();
    data.audioFiles[name] = {
      name,
      nativePath: `user/files/scenevoice_audio_${name}`,
      size: row.size,
      created: row.created,
    };
  }
  return data;
}
