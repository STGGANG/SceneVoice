// 골라서 백업·복원: which bot card each record belongs to, so a backup can be saved and restored
// a bot card and a kind at a time. A chosen card's chosen kinds are replaced; the rest stay.
import { emptyDatabase } from "./store.js";

export const COMMON = "common";
// People shared by several cards (and their calls, texts and states), and people no longer
// registered whose chat can't be told.
export const GLOBAL = "global";
export const BACKUP_ITEMS = [
  ["people", "인물 설정", "목소리·말투 메모·월드인포 참고"],
  ["records", "생성 기록·보관함", "채팅 대사 음성과 보관함"],
  ["phone", "통화·문자", "통화 기록·문자·단체방"],
  ["states", "상태", "현재 상태와 변화 기록"],
];
const ITEM_KEYS = BACKUP_ITEMS.map(([key]) => key);

// Records kept in lists: [kind, list, the person a row belongs to].
const LISTS = [
  ["records", "generations", (row) => [row.speaker_key, row.speaker_name, row.chat_id]],
  ["records", "favorites", (row) => [row.speaker_key, row.speaker_name, row.chat_id]],
  ["phone", "sessions", (row) => [row.character_key, row.character_name, row.chat_id]],
  ["phone", "messages", (row) => [row.character_key, row.character_name, row.chat_id, row.thread_key]],
  ["phone", "groups", (row) => ["", "", row.chat_id, `group:${row.id}`]],
  ["states", "stateHistory", (row) => [row.character_key, row.character_name, row.chat_id]],
];
// Records kept by key: [kind, the map, the person an entry belongs to, counted in the summary].
const MAPS = [
  ["records", (data) => (data.lineEdits ||= {}), (key, edit) => [edit?.value?.speaker_key, "", edit?.chat_id], true],
  // A round record (who was asked in the last update) has no person of its own.
  ["states", (data) => (data.states ||= {}), (key, state) => [state?.character_key || state?.state?.asked?.[0], state?.character_name, state?.chat_id], true],
  ["people", (data) => (data.settings.character_voices ||= {}), (key) => [key], true],
  ["people", (data) => (data.settings.character_notes ||= {}), (key) => [key], false],
  ["people", (data) => ((data.settings.phone ||= {}).world_info_choice ||= {}), (key) => [key], false],
];

/** Tells the scope (a bot card's key or GLOBAL) of every record in `data`, as it stands now. */
function scopeContext(data) {
  // A copy: a restore changes the people while it still asks about the records as they were.
  const voices = { ...(data.settings?.character_voices || {}) };
  const byName = new Map();
  for (const [key, entry] of Object.entries(voices))
    if (entry?.name && !byName.has(entry.name)) byName.set(entry.name, key);
  const own = (key) => (key.startsWith("character:") ? key : voices[key]?.card || GLOBAL);
  const known = (key, name) => {
    key = String(key || "");
    if (key.startsWith("character:") || voices[key]) return own(key);
    const named = byName.get(String(name || ""));
    return named ? own(named) : "";
  };
  const groups = new Map();
  for (const group of data.groups || []) {
    const scopes = (group.members || []).map((member) => known(member?.key, member?.name));
    groups.set(`group:${group.id}`, scopes.find((scope) => scope && scope !== GLOBAL) || (scopes.includes(GLOBAL) ? GLOBAL : ""));
  }
  // A chat belongs to one bot card: records whose person is gone follow the others there.
  const chats = new Map();
  for (const [, list, person] of LISTS)
    for (const row of data[list] || []) {
      const [key, name, chat, thread] = person(row);
      const scope = thread ? groups.get(thread) : known(key, name);
      if (chat && scope && scope !== GLOBAL && !chats.has(chat)) chats.set(chat, scope);
    }
  const scopeOf = ([key, name, chat, thread]) =>
    (thread ? groups.get(thread) : known(key, name)) || chats.get(chat) || GLOBAL;
  return {
    row: (person, row) => scopeOf(person(row)),
    entry: (person, key, value) => scopeOf(person(key, value)),
  };
}

/** Every record that can point to an audio file: rows, call lines, and their earlier versions. */
export function audioHolders(data) {
  return [
    ...(data.generations || []),
    ...(data.favorites || []),
    ...(data.messages || []),
    ...(data.sessions || []).flatMap((session) => session.turns || []),
  ].flatMap((row) => [row, ...(Array.isArray(row.versions) ? row.versions : [])]);
}

const audioNames = (data) => audioHolders(data).map((row) => row.audio_filename).filter(Boolean);

/** Per scope, how many records of each kind it has: Map(scope → {people, records, phone, states}). */
export function backupSummary(data) {
  const context = scopeContext(data);
  const summary = new Map();
  const add = (scope, kind) => {
    if (!summary.has(scope)) summary.set(scope, Object.fromEntries(ITEM_KEYS.map((key) => [key, 0])));
    summary.get(scope)[kind]++;
  };
  for (const [kind, list, person] of LISTS)
    for (const row of data[list] || []) add(context.row(person, row), kind);
  for (const [kind, map, person, counted] of MAPS)
    if (counted) for (const [key, value] of Object.entries(map(data))) add(context.entry(person, key, value), kind);
  return summary;
}

/** What a backup file holds; a file made before backups could be chosen holds everything. */
export function backupContents(input, data) {
  const contents = input?.contents;
  const scopes = [...backupSummary(data).keys()];
  if (!contents || typeof contents !== "object") return { common: true, scopes, items: [...ITEM_KEYS] };
  const listed = new Set(Array.isArray(contents.scopes) ? contents.scopes.map(String) : []);
  return {
    common: contents.common === true,
    // Scopes the file was made with, even ones it holds nothing for (restoring them clears them).
    scopes: [...new Set([...scopes.filter((scope) => listed.has(scope)), ...listed])].filter(
      (scope) => scope === GLOBAL || scope.startsWith("character:"),
    ),
    items: ITEM_KEYS.filter((key) => Array.isArray(contents.items) && contents.items.includes(key)),
  };
}

/** The choice takes everything the file holds (then even unused audio entries come back). */
export function wholeChoice(choice, contents) {
  return (
    Boolean(choice?.common) === Boolean(contents.common) &&
    contents.scopes.every((scope) => choice.scopes.includes(scope)) &&
    contents.items.every((item) => choice.items.includes(item))
  );
}

const choiceSets = (choice) => ({
  scopes: new Set(choice?.scopes || []),
  items: new Set((choice?.items || []).filter((item) => ITEM_KEYS.includes(item))),
});

/** A copy of `data` with only the chosen scopes and kinds (common settings only when chosen). */
export function pickBackup(data, choice) {
  const { scopes, items } = choiceSets(choice);
  const context = scopeContext(data);
  const picked = emptyDatabase();
  if (choice?.common) picked.settings = structuredClone(data.settings);
  for (const [, map] of MAPS.filter(([kind]) => kind === "people")) {
    const target = map(picked);
    for (const key of Object.keys(target)) delete target[key];
  }
  for (const [kind, list, person] of LISTS)
    picked[list] = items.has(kind)
      ? structuredClone((data[list] || []).filter((row) => scopes.has(context.row(person, row))))
      : [];
  for (const [kind, map, person] of MAPS) {
    if (!items.has(kind)) continue;
    const target = map(picked);
    for (const [key, value] of Object.entries(map(data)))
      if (scopes.has(context.entry(person, key, value))) target[key] = structuredClone(value);
  }
  const used = new Set(audioNames(picked));
  picked.audioFiles = Object.fromEntries(
    Object.entries(data.audioFiles || {}).filter(([name]) => used.has(name)),
  );
  return picked;
}

/**
 * Restores the chosen scopes and kinds of `incoming` into `current` (changed in place): what
 * `current` has there goes, what the file has there comes in. Scopes and kinds not chosen stay.
 */
export function applyBackup(current, incoming, choice) {
  const { scopes, items } = choiceSets(choice);
  const was = scopeContext(current);
  const from = scopeContext(incoming);
  if (choice?.common) {
    // Common settings only; the people in them follow 인물 설정, card by card.
    const settings = structuredClone(incoming.settings);
    settings.character_voices = current.settings.character_voices;
    settings.character_notes = current.settings.character_notes;
    (settings.phone ||= {}).world_info_choice = current.settings.phone?.world_info_choice || {};
    current.settings = settings;
  }
  const added = [];
  for (const [kind, list, person] of LISTS) {
    if (!items.has(kind)) continue;
    const coming = structuredClone((incoming[list] || []).filter((row) => scopes.has(from.row(person, row))));
    // The same record kept under another scope now is replaced too, never doubled.
    const ids = new Set(coming.map((row) => row.id));
    current[list] = (current[list] || [])
      .filter((row) => !scopes.has(was.row(person, row)) && !ids.has(row.id))
      .concat(coming);
    added.push(...coming);
  }
  for (const [kind, map, person] of MAPS) {
    if (!items.has(kind)) continue;
    const target = map(current);
    for (const [key, value] of Object.entries(target))
      if (scopes.has(was.entry(person, key, value))) delete target[key];
    for (const [key, value] of Object.entries(map(incoming)))
      if (scopes.has(from.entry(person, key, value))) target[key] = structuredClone(value);
  }
  const used = new Set(audioNames({ generations: added, sessions: added.filter((row) => row.turns) }));
  current.audioFiles ||= {};
  for (const [name, file] of Object.entries(incoming.audioFiles || {}))
    if (used.has(name)) current.audioFiles[name] = file;
  return current;
}
