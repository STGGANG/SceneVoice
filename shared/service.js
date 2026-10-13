// The service behind every /api/plugins/scenevoice path: records, voice generation and its
// cache, calls, messages and states. Storage and engines are passed in (see transport.js).
import { resolveVoice } from "./casting.js";
import {
  EMOTIONS,
  UserError,
  publicSettings,
  validateSettings,
  settingsWithDefaults,
  text,
  validModel,
} from "./settings.js";
import { buildSpeechRequest, normalizeSpeech, withAlwaysTags } from "./providers.js";
import { newId, contentKey, sha256 } from "./hash.js";
import { WorkQueue, throwIfAborted } from "./queue.js";
import { validAudioName, audioType } from "./store.js";
export const API = "/api/plugins/scenevoice";
// How much of the reusable records is kept: analyses of the most recent messages, and each
// person's latest state changes. Older ones go first.
const ANALYSIS_KEEP = 70;
const STATE_HISTORY_KEEP = 20;
const now = () => new Date().toISOString();
const required = (value, label, max = 500) => {
  const result = text(value, max);
  if (!result) throw new UserError(`${label} 값이 필요합니다.`);
  return result;
};
const find = (items, id) => {
  const item = items.find((row) => row.id === id);
  if (!item) throw new UserError("기록을 찾을 수 없습니다.", 404);
  return item;
};
const audioItem = (item, favorite = false) => ({
  ...item,
  ...(item.audio_filename
    ? {
        audio_url: `${API}/${favorite ? "favorite-audio" : "audio"}/${item.audio_filename}`,
      }
    : {}),
});
// 답변 재생성 keeps the earlier answers of a message as versions to page through; the one shown
// is the record's own fields (what prompts and the chat memory use).
const VERSION_FIELDS = [
  "kind",
  "text",
  "script",
  "translation",
  "tags",
  "emotion",
  "direction",
  "language",
  "intensity",
  "generation_id",
  "audio_filename",
  "mime_type",
  "applied_control",
  "audio_filtered",
  "sounds_mixed",
  "edited_at",
  "should_end",
  // 통화 중 옆 사람: who said it (handed the phone), and a remark in the background.
  "speaker_key",
  "speaker_name",
  "aside",
];
const MAX_VERSIONS = 10;
// Set aside for at most 10 minutes: if the page was closed before a new answer came, it shows again.
const stashedNow = (item) => Boolean(item.stashed) && Date.now() - Date.parse(item.stashed) < 600000;
const versionOf = (item) =>
  Object.fromEntries(VERSION_FIELDS.filter((field) => item[field] !== undefined).map((field) => [field, item[field]]));
const forwardOf = (value) =>
  value && typeof value === "object"
    ? {
        type: ["call", "voice", "memo"].includes(value.type) ? value.type : "voice",
        title: text(value.title, 200),
        lines: (Array.isArray(value.lines) ? value.lines : [])
          .slice(0, 40)
          .map((line) => ({ from: text(line?.from, 120), text: text(line?.text, 800) }))
          .filter((line) => line.text),
        source_id: text(value.source_id, 64),
        ...(value.note ? { note: true } : {}),
      }
    : null;
// A live call's line said by someone other than the one called: who, and whether in the
// background (not into the phone).
const nearbySpeaker = (body) => ({
  ...(body.role !== "user" && text(body.speaker_key)
    ? { speaker_key: text(body.speaker_key), speaker_name: text(body.speaker_name, 300) }
    : {}),
  ...(body.role !== "user" && body.aside === true ? { aside: true } : {}),
});
const radioItem = (show) => ({ ...show, lines: (show.lines || []).map((line) => audioItem(line)) });
// The extra people on a written call (beyond its first one or two), at most three.
const callPeople = (value) =>
  (Array.isArray(value) ? value : [])
    .map((person) => ({ key: text(person?.key), name: text(person?.name, 300) }))
    .filter((person) => person.key || person.name)
    .slice(0, 3);
/**
 * Every exact string in `swap` (a card's key, a chat's id under it) replaced, in values and in
 * object keys; a key already there keeps its own entry (the newer one wins over the moved one).
 */
function rekey(value, swap) {
  if (typeof value === "string") return swap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rekey(item, swap));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) if (!swap.has(key)) out[key] = rekey(item, swap);
  for (const [key, item] of Object.entries(value))
    if (swap.has(key) && !Object.hasOwn(out, swap.get(key))) out[swap.get(key)] = rekey(item, swap);
  return out;
}
// Records that belong to a chat (under a bot card) or name a person by key.
const CARD_LISTS = ["sessions", "messages", "groups", "memos", "radio", "stateHistory", "generations", "favorites"];
// A written call's lines added in order: mine as mine, everyone else's with who said them.
function writtenLines(session, lines, mine, part, stamp) {
  for (const line of lines) {
    const speech = normalizeSpeech(line);
    const user = mine && line.role === "user";
    session.turns.push({
      id: newId(),
      session_id: session.id,
      turn_index: session.turns.length,
      role: user ? "user" : "character",
      ...(user ? {} : { speaker_key: text(line.speaker_key), speaker_name: text(line.speaker_name, 300) }),
      text: speech.text,
      script: speech.script,
      translation: text(line.translation, 5000),
      tags: speech.tags,
      emotion: speech.emotion,
      direction: speech.direction,
      language: speech.language,
      intensity: speech.intensity,
      ...(part ? { part } : {}),
      created_at: stamp,
    });
  }
}
const sessionItem = (session) => ({
  ...session,
  turns: session.turns.map((turn) => audioItem(turn)),
});
const limitOf = (query, fallback = 100) =>
  Math.max(1, Math.min(1000, Number(query.limit) || fallback));
const newest = (items, query, field = "created_at") =>
  [...items]
    .filter(
      (item) =>
        (!query.chat_id || item.chat_id === query.chat_id) &&
        (!query.speaker_key || item.speaker_key === query.speaker_key),
    )
    .sort((a, b) => String(b[field]).localeCompare(String(a[field])))
    .slice(0, limitOf(query));
const identity = (body) => ({
  chat_id: required(body.chat_id, "채팅"),
  anchor_message_id: text(body.anchor_message_id, 100),
  character_key: text(body.character_key),
  character_name: text(body.character_name, 300),
  anchor_fingerprint: text(body.anchor_fingerprint, 100),
  // The mark left on that chat message (a later part of the chat taken back loses it).
  ...(text(body.anchor_tag, 40) ? { anchor_tag: text(body.anchor_tag, 40) } : {}),
  // The swipe of that message then showing; another swipe doesn't show the record.
  ...(Number.isInteger(body.anchor_swipe) && body.anchor_swipe >= 0 && body.anchor_swipe < 100000
    ? { anchor_swipe: body.anchor_swipe }
    : {}),
});
// A group conversation's name and people; two to twelve, each once.
const groupFields = (body) => {
  const members = (Array.isArray(body.members) ? body.members : [])
    .map((member) => ({ key: text(member?.key, 300), name: text(member?.name, 120) }))
    .filter(
      (member, index, list) =>
        member.key &&
        !member.key.startsWith("group:") &&
        list.findIndex((other) => other.key === member.key) === index,
    )
    .slice(0, 12);
  if (members.length < 2)
    throw new UserError("단체방에는 두 명 이상이 필요합니다.");
  // A room without the user: the members talk among themselves, on a button press
  // (burst_min to burst_max messages) and, if auto_chat, now and then by themselves.
  const whole = (value, min, max, fallback) =>
    Math.round(Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback)));
  const burstMin = whole(body.burst_min, 1, 30, 6);
  return {
    name:
      text(body.name, 60) ||
      members
        .map((member) => member.name)
        .join(", ")
        .slice(0, 60),
    members,
    without_user: body.without_user === true,
    auto_chat: body.without_user === true && body.auto_chat === true,
    auto_every: whole(body.auto_every, 1, 50, 6),
    // At most this many times a day by itself (0 = no limit).
    auto_daily_max: whole(body.auto_daily_max, 0, 100, 5),
    burst_min: burstMin,
    burst_max: Math.max(burstMin, whole(body.burst_max, 1, 30, 15)),
  };
};
const GROUP_THREAD = /^group:[a-f0-9]{32}$/;
const checkChat = (item, body) => {
  if (body.chat_id && item.chat_id !== body.chat_id)
    throw new UserError("다른 채팅의 기록은 변경할 수 없습니다.", 409);
};

export class SceneService {
  queue = new WorkQueue();
  constructor(store, environment) {
    this.store = store;
    this.env = environment;
  }
  async handle(method, path, query = {}, body = {}, signal) {
    throwIfAborted(signal);
    if (method === "POST" && path === "/generate")
      return this.generate(body, signal);
    if (method === "POST" && path === "/audio/mix") return { json: await this.saveMixedAudio(body) };
    if (method === "GET" && /^\/(?:favorite-audio|audio)\//.test(path)) {
      const name = path.split("/").at(-1);
      if (!validAudioName(name))
        throw new UserError("허용되지 않는 파일입니다.");
      const bytes = await this.store.getAudio(name);
      if (!bytes)
        throw new UserError(
          "음성 파일이 정리되었습니다. 다시 생성해 주세요.",
          404,
        );
      return {
        bytes,
        headers: {
          "Content-Type": audioType(name),
          "Content-Disposition": `inline; filename="${name}"`,
        },
      };
    }
    if (
      (path === "/cache/cleanup" && method === "POST") ||
      (path === "/cache" && method === "DELETE")
    )
      return {
        json: await this.queue.run(
          () => this.prune(method === "DELETE"),
          signal,
        ),
      };
    if (path === "/cache" && method === "GET")
      return { json: await this.stats() };
    if (path === "/health" && method === "GET")
      return {
        json: {
          status: "ok",
          mode: this.env.mode,
          available_engines: this.env.engines,
          cache: await this.stats(),
          version: "1.2.2",
        },
      };
    // A person's phone picture, already shrunk by the browser: a file under ST's user files
    // when the store can keep one, otherwise kept inline as a data URL.
    if (method === "POST" && path === "/avatars") {
      const type = ["image/webp", "image/jpeg", "image/png"].includes(body.type) ? body.type : "";
      const data = String(body.data || "");
      if (!type || !data || data.length > 400000 || !/^[A-Za-z0-9+/=]+$/.test(data))
        throw new UserError("사진 형식이 올바르지 않거나 너무 큽니다.");
      if (!this.store.uploadImage)
        return { json: { url: `data:${type};base64,${data}` } };
      const extension = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const name = `scenevoice_avatar_${sha256(data).slice(0, 24)}.${extension}`;
      return { json: { url: await this.store.uploadImage(name, bytes) } };
    }
    if (method === "GET" && path === "/engine-check")
      return {
        json: (await this.env.checkEngine?.(
          query.engine,
          (await this.store.read()).settings,
          signal,
        )) || { ok: false, message: "이 환경에서는 연결을 확인할 수 없습니다." },
      };
    if (method === "GET" && path === "/voices")
      return {
        json: (await this.env.voices?.(
          query.engine,
          (await this.store.read()).settings,
          signal,
        )) || { items: [] },
      };
    if (path === "/settings") {
      if (method === "POST") {
        const prepared = (await this.env.prepareSettings?.(body)) || body;
        const updated = await this.store.transaction((data) => {
          data.settings = validateSettings(data.settings, prepared);
          return data.settings;
        });
        await this.env.enrichSettings?.(updated);
        return {
          json: { status: "success", settings: publicSettings(updated) },
        };
      }
      const data = await this.store.read();
      const settings = settingsWithDefaults(data.settings);
      await this.env.enrichSettings?.(settings);
      return {
        json: {
          settings: publicSettings(settings),
          available_emotions: EMOTIONS,
          available_engines: this.env.engines,
          storage_mode: this.env.mode,
          favorites_path: this.env.storageLabel,
        },
      };
    }
    if (method === "GET")
      return { json: this.readRoute(path, query, await this.store.read()) };
    if (path.startsWith("/favorites/") || path.startsWith("/history/")) {
      return {
        json: await this.queue.run(
          () => this.mediaMutation(method, path, body),
          signal,
        ),
      };
    }
    return {
      json: await this.store.transaction((data) =>
        this.writeRoute(method, path, body, data),
      ),
    };
  }
  readRoute(path, query, data) {
    // Bot card keys the records name (a card renamed in 실리태번 leaves its old one behind).
    if (path === "/cards/keys") {
      const found = new Map();
      const note = (key, label = "") => {
        if (typeof key !== "string" || !key.startsWith("character:")) return;
        const entry = found.get(key) || { key, name: "", count: 0 };
        entry.count += 1;
        entry.name ||= label;
        found.set(key, entry);
      };
      for (const [key, entry] of Object.entries(data.settings.character_voices || {})) {
        note(key, key.startsWith("character:") ? entry?.name : "");
        note(entry?.card);
      }
      for (const list of CARD_LISTS)
        for (const row of data[list] || []) {
          note(row?.character_key, row?.character_name);
          note(row?.speaker_key, row?.speaker_name);
        }
      return { items: [...found.values()] };
    }
    if (path === "/line-state") {
      const edits = Object.fromEntries(
        Object.entries(data.lineEdits || {}).filter(
          ([, edit]) => edit.chat_id === query.chat_id,
        ),
      );
      const audio = {};
      // Each line's edit key once (lines can have many voices made over time).
      const editKeys = new Map();
      const editKey = (lineKey) => {
        if (!editKeys.has(lineKey)) editKeys.set(lineKey, contentKey(edits[lineKey]?.value || {}));
        return editKeys.get(lineKey);
      };
      for (const item of data.generations) {
        if (
          item.chat_id !== query.chat_id ||
          (item.config_key || "") !== (query.config_key || "") ||
          !item.line_key ||
          !item.audio_filename
        )
          continue;
        if (item.edit_key !== editKey(item.line_key)) continue;
        if (
          !audio[item.line_key] ||
          audio[item.line_key].created_at <= item.created_at
        )
          audio[item.line_key] = audioItem(item);
      }
      return { edits, audio };
    }
    if (path === "/message-analysis") {
      const item = Object.hasOwn(data.analyses, query.analysis_key)
        ? data.analyses[query.analysis_key]
        : null;
      return item ? { found: true, ...item } : { found: false };
    }
    if (path === "/state") {
      const item = Object.hasOwn(data.states, query.state_key)
        ? data.states[query.state_key]
        : null;
      return item ? { found: true, ...item } : { found: false };
    }
    // A chat's people with a saved state (whose key, under what name): to find a person's state
    // saved under the key they had before being made again.
    if (path === "/states")
      return {
        items: Object.values(data.states)
          .filter((item) => item.chat_id === query.chat_id && !String(item.state_key).startsWith("state-round-"))
          .map(({ state_key, character_key, character_name, updated_at }) => ({
            state_key,
            character_key,
            character_name,
            updated_at,
          })),
      };
    if (path === "/state/history")
      return {
        items: newest(
          data.stateHistory.filter((x) => x.state_key === query.state_key),
          query,
        ),
      };
    if (path === "/phone/sessions")
      return {
        items: newest(data.sessions, query, "started_at").map(sessionItem),
      };
    if (/^\/phone\/sessions\/[^/]+$/.test(path))
      return { session: sessionItem(find(data.sessions, path.split("/")[3])) };
    // A message set aside while its answer is asked for again is not shown (nor sent to prompts).
    if (path === "/voice-messages")
      return {
        items: newest(
          data.messages.filter((item) => !stashedNow(item) && (query.hidden === "1" || !item.hidden)),
          query,
        ).map((item) => audioItem(item)),
      };
    if (path === "/message-groups")
      return { items: newest(data.groups, query) };
    if (path === "/phone/memos")
      return { items: newest(data.memos || [], query).map((item) => audioItem(item)) };
    if (path === "/phone/radio")
      return { items: newest(data.radio || [], query).map(radioItem) };
    if (path === "/history") {
      const speakers = [
        ...new Map(
          data.generations.map((x) => [
            x.speaker_key || "",
            { key: x.speaker_key || "", name: x.speaker_name || "기본 화자" },
          ]),
        ).values(),
      ];
      const queryText = String(query.q || "").toLocaleLowerCase();
      const matched = data.generations
        .filter(
          (item) =>
            (!query.speaker_key || item.speaker_key === query.speaker_key) &&
            (!query.mode || (item.mode || "dialogue") === query.mode) &&
            (!query.chat_id || item.chat_id === query.chat_id) &&
            (!query.from ||
              String(item.created_at).slice(0, 10) >= query.from) &&
            (!query.to || String(item.created_at).slice(0, 10) <= query.to) &&
            (!queryText ||
              [item.text, item.speaker_name, item.applied_control]
                .join(" ")
                .toLocaleLowerCase()
                .includes(queryText)),
        )
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        );
      const limit = limitOf(query, 50);
      const offset = Math.min(
        Math.max(0, Math.floor(Number(query.offset) || 0)),
        Math.max(0, Math.ceil(matched.length / limit) - 1) * limit,
      );
      const favorites = new Map(
        data.favorites.map((f) => [f.generation_id, f.id]),
      );
      return {
        total: matched.length,
        offset,
        limit,
        speakers,
        items: matched.slice(offset, offset + limit).map((item) => ({
          ...audioItem(item),
          favorite_id: favorites.get(item.id) || "",
        })),
      };
    }
    if (path === "/favorites")
      return {
        items: newest(data.favorites, query).map((item) => ({
          ...audioItem(item, true),
          download_name: item.audio_filename,
        })),
        path: this.env.storageLabel,
      };
    throw new UserError("지원하지 않는 기능입니다.", 404);
  }
  writeRoute(method, path, body, data) {
    const stamp = now();
    if (path === "/line-edits" && ["POST", "DELETE"].includes(method)) {
      if (!/^[a-f0-9]{64}$/.test(body.line_key || ""))
        throw new UserError("대사 식별값이 올바르지 않습니다.");
      data.lineEdits ||= {};
      const chat_id = required(body.chat_id, "채팅");
      if (
        data.lineEdits[body.line_key] &&
        data.lineEdits[body.line_key].chat_id !== chat_id
      )
        throw new UserError("다른 채팅의 대사입니다.", 409);
      if (method === "DELETE") delete data.lineEdits[body.line_key];
      else {
        const value = {};
        if (body.value?.speaker_key)
          value.speaker_key = text(body.value.speaker_key, 300);
        if (body.value?.performance) {
          const { text: ignored, ...performance } = normalizeSpeech(
            { ...body.value.performance, text: "manual" },
            { matchScript: false },
          );
          value.performance = performance;
        }
        if (Object.keys(value).length)
          data.lineEdits[body.line_key] = { chat_id, value, updated_at: stamp };
        else delete data.lineEdits[body.line_key];
      }
      return { value: data.lineEdits[body.line_key]?.value || {} };
    }
    if (path === "/message-analysis" && method === "POST") {
      const key = required(body.analysis_key, "분석 ID", 160);
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new UserError("허용되지 않는 분석 ID입니다.");
      if (!Array.isArray(body.analyses) || body.analyses.length > 100)
        throw new UserError("분석 결과가 올바르지 않습니다.");
      data.analyses[key] = {
        analyses: body.analyses.map((item, index) => ({
          ...normalizeSpeech({ ...item, text: item.text || " " }),
          speaker_key: text(item.speaker_key, 300),
          speaker_confidence: Number(item.speaker_confidence) || 0,
          needs_confirmation: Boolean(item.needs_confirmation),
          index: Number(item.index ?? index),
        })),
        updated_at: stamp,
        profile_id: text(body.profile_id),
      };
      // Bound only the reusable analysis cache (the most recent messages stay; a voice
      // already made doesn't need its analysis again); never trim saved conversations here.
      const keys = Object.keys(data.analyses);
      if (keys.length > ANALYSIS_KEEP)
        keys
          .sort((a, b) =>
            data.analyses[a].updated_at.localeCompare(
              data.analyses[b].updated_at,
            ),
          )
          .slice(0, keys.length - ANALYSIS_KEEP)
          .forEach((key) => delete data.analyses[key]);
      return { status: "success" };
    }
    // A bot card renamed in 실리태번 (its file, and so its key, changed): everything kept under the
    // old key moves to the new one. `chats`: the card's chat ids, under which its records were kept.
    if (path === "/cards/relink" && method === "POST") {
      const from = required(body.from, "이전 봇카드");
      const to = required(body.to, "봇카드");
      if (!from.startsWith("character:") || !to.startsWith("character:") || from === to)
        throw new UserError("옮길 봇카드가 올바르지 않습니다.");
      const chats = (Array.isArray(body.chats) ? body.chats : []).map((id) => text(id, 500)).filter(Boolean).slice(0, 5000);
      const chatSwap = new Map(
        chats.map((chatId) => [contentKey({ chatId, character: from }), contentKey({ chatId, character: to })]),
      );
      const swap = new Map([[from, to], ...chatSwap]);
      const name = text(body.name, 300);
      const renamed = (row) => {
        // The card's own lines and calls take its new name.
        if (!name || !row || typeof row !== "object") return row;
        for (const [keyField, nameField] of [["character_key", "character_name"], ["speaker_key", "speaker_name"]])
          if (row[keyField] === to && row[nameField]) row[nameField] = name;
        return row;
      };
      let records = 0;
      for (const list of CARD_LISTS) {
        const rows = data[list] || [];
        records += rows.filter((row) => chatSwap.has(row?.chat_id)).length;
        data[list] = rekey(rows, swap).map(renamed);
      }
      // A person's state is kept under a key made from the chat and the person.
      const stateMoves = new Map();
      const states = {};
      for (const [key, item] of Object.entries(data.states || {})) {
        const moved = renamed(rekey(item, swap));
        let target = key;
        if (chatSwap.has(item?.chat_id)) {
          target = key.startsWith("state-round-")
            ? `state-round-${sha256(moved.chat_id)}`
            : `state-${sha256(`${moved.chat_id}|${moved.character_key || ""}`)}`;
          if (moved.state_key) moved.state_key = target;
          stateMoves.set(key, target);
        }
        const kept = states[target];
        if (kept && String(kept.updated_at || "") > String(moved.updated_at || "")) continue;
        states[target] = moved;
      }
      data.states = states;
      for (const item of data.stateHistory || []) if (stateMoves.has(item.state_key)) item.state_key = stateMoves.get(item.state_key);
      data.lineEdits = rekey(data.lineEdits || {}, swap);
      const people = Object.values(data.settings.character_voices || {}).filter((entry) => entry?.card === from).length;
      data.settings = rekey(data.settings, swap);
      return { status: "success", moved: { records, states: stateMoves.size, people } };
    }
    // A person made again (a new key): the state and its history saved under the old key move to
    // the new one.
    if (path === "/state/adopt" && method === "POST") {
      const from = required(body.from, "상태 ID");
      const to = required(body.to, "상태 ID");
      const old = Object.hasOwn(data.states, from) ? data.states[from] : null;
      if (!old || old.chat_id !== body.chat_id || Object.hasOwn(data.states, to))
        throw new UserError("옮길 상태가 없습니다.", 409);
      const moved = { character_key: text(body.character_key), character_name: text(body.character_name, 300), state_key: to };
      data.states[to] = { ...old, ...moved };
      delete data.states[from];
      for (const item of data.stateHistory) if (item.state_key === from) Object.assign(item, moved);
      return { status: "success" };
    }
    if (path === "/state" && method === "POST") {
      const key = required(body.state_key, "상태 ID");
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new UserError("허용되지 않는 상태 ID입니다.");
      if (
        !body.state ||
        typeof body.state !== "object" ||
        JSON.stringify(body.state).length > 20000
      )
        throw new UserError("상태 정보가 올바르지 않습니다.");
      const item = {
        ...identity(body),
        state_key: key,
        source_message_id: text(body.source_message_id, 250),
        state: body.state,
        updated_at: stamp,
        created_at: stamp,
      };
      data.states[key] = item;
      // history: false keeps only the current record (the chat's update-round marker).
      if (body.history === false)
        return { status: "success", state: item.state, updated_at: stamp };
      data.stateHistory.push({ ...item, id: newId() });
      const own = data.stateHistory
        .filter((x) => x.state_key === key)
        .slice(-STATE_HISTORY_KEEP);
      data.stateHistory = data.stateHistory
        .filter((x) => x.state_key !== key)
        .concat(own);
      return { status: "success", state: item.state, updated_at: stamp };
    }
    // Removes chosen history entries; the newest one left becomes the current state.
    if (path === "/state/history" && method === "DELETE") {
      const key = required(body.state_key, "상태 ID");
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new UserError("허용되지 않는 상태 ID입니다.");
      if (!Array.isArray(body.ids) || body.ids.length > 200)
        throw new UserError("지울 상태 기록이 올바르지 않습니다.");
      const ids = new Set(body.ids.map((id) => text(id, 100)));
      data.stateHistory = data.stateHistory.filter(
        (x) => x.state_key !== key || !ids.has(x.id),
      );
      const latest = data.stateHistory
        .filter((x) => x.state_key === key)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (latest) {
        const { id: ignored, ...item } = latest;
        data.states[key] = item;
      } else delete data.states[key];
      return { status: "success", found: Boolean(latest) };
    }
    if (path === "/state" && method === "DELETE") {
      const key = required(body.state_key, "상태 ID");
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new UserError("허용되지 않는 상태 ID입니다.");
      delete data.states[key];
      data.stateHistory = data.stateHistory.filter((x) => x.state_key !== key);
      return { status: "success" };
    }
    if (path === "/phone/sessions" && method === "POST") {
      const who = identity(body);
      const previous = data.sessions.find(
        (x) =>
          x.chat_id === who.chat_id && ["active", "ringing"].includes(x.status),
      );
      if (previous) return { status: "exists", session: sessionItem(previous) };
      const status = body.status === "ringing" ? "ringing" : "active";
      // 단체 통화: more people on the same live call.
      const others = callPeople(body.others);
      const session = {
        ...who,
        id: newId(),
        status,
        ...(others.length ? { others } : {}),
        call_direction: body.direction === "incoming" ? "incoming" : "outgoing",
        situation: text(body.situation, 4000),
        started_at: stamp,
        answered_at: status === "active" ? stamp : null,
        ended_at: null,
        turns: [],
      };
      data.sessions.push(session);
      return { status: "success", session: sessionItem(session) };
    }
    // My call that went to their voicemail (they were busy): what I left there, if anything.
    if (path === "/phone/voicemail-left" && method === "POST") {
      const who = identity(body);
      const session = {
        ...who,
        id: newId(),
        status: "missed",
        call_direction: "outgoing",
        situation: "",
        started_at: stamp,
        answered_at: null,
        ended_at: stamp,
        turns: [],
      };
      const said = text(body.text, 2000)
        ? normalizeSpeech({ text: body.text, script: body.script, language: body.language })
        : null;
      if (said?.text)
        session.turns.push({
          id: newId(),
          session_id: session.id,
          turn_index: 0,
          role: "user",
          voicemail: true,
          text: said.text,
          script: said.script,
          translation: "",
          tags: said.tags,
          emotion: said.emotion,
          direction: said.direction,
          language: said.language,
          intensity: said.intensity,
          created_at: stamp,
        });
      data.sessions.push(session);
      return { status: "success", session: sessionItem(session) };
    }
    const turnPath = path.match(/^\/phone\/sessions\/([^/]+)\/turns$/);
    if (turnPath && method === "POST") {
      const session = find(data.sessions, turnPath[1]);
      checkChat(session, body);
      if (session.status !== "active")
        throw new UserError("현재 통화가 진행 중이 아닙니다.", 409);
      const speech = normalizeSpeech(body);
      const turn = {
        id: newId(),
        session_id: session.id,
        turn_index: session.turns.length,
        role: body.role === "user" ? "user" : "character",
        ...nearbySpeaker(body),
        text: speech.text,
        script: speech.script,
        translation: text(body.translation, 5000),
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        language: speech.language,
        intensity: speech.intensity,
        should_end: Boolean(body.should_end),
        created_at: stamp,
      };
      session.turns.push(turn);
      return {
        status: "success",
        turn_id: turn.id,
        session: sessionItem(session),
      };
    }
    // 엿듣는 통화 · 통화 맡기기: a call written whole by the helper model (its voices are made when
    // it is listened to). With `user_side` the user's character is one of them: it is kept as
    // their own call, made or taken, with their lines as theirs. `others`: more people on the same
    // call. `open`: written a part at a time (이어 가며 듣기) until it is closed; each line keeps
    // its part.
    if (path === "/phone/overheard" && method === "POST") {
      const who = identity(body);
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 30);
      if (!lines.length) throw new UserError("통화 대사가 없습니다.");
      const mine = ["caller", "callee"].includes(body.user_side);
      const others = callPeople(body.others);
      const session = {
        ...who,
        id: newId(),
        status: "ended",
        call_direction: mine ? (body.user_side === "caller" ? "outgoing" : "incoming") : "overheard",
        ...(mine ? {} : { callee_key: text(body.callee_key), callee_name: text(body.callee_name, 300) }),
        ...(others.length ? { others } : {}),
        ...(body.open ? { continuing: true } : {}),
        situation: text(body.situation, 4000),
        started_at: stamp,
        answered_at: stamp,
        ended_at: stamp,
        turns: [],
      };
      writtenLines(session, lines, mine, 0, stamp);
      data.sessions.push(session);
      return { status: "success", session: sessionItem(session) };
    }
    // The next part of a call written a part at a time; `replace` writes its last part again,
    // `close` ends it (with this last part, or with none).
    const callPart = path.match(/^\/phone\/overheard\/([^/]+)\/part$/);
    if (callPart && method === "POST") {
      const session = find(data.sessions, callPart[1]);
      checkChat(session, body);
      if (!session.continuing) throw new UserError("이미 끝난 통화입니다.", 409);
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 30);
      const last = Math.max(0, ...session.turns.map((turn) => turn.part || 0));
      if (body.replace) session.turns = session.turns.filter((turn) => (turn.part || 0) !== last);
      if (session.turns.length + lines.length > 400) throw new UserError("통화가 너무 길어졌습니다. 마무리해 주세요.", 409);
      const mine = session.call_direction !== "overheard";
      writtenLines(session, lines, mine, body.replace ? last : last + 1, stamp);
      if (body.close) delete session.continuing;
      session.ended_at = stamp;
      return { status: "success", session: sessionItem(session) };
    }
    // 음성 사서함: a call of the character's that went unanswered (declined, or not picked up in
    // time) gets the one message they left after it.
    const voicemailPath = path.match(/^\/phone\/sessions\/([^/]+)\/voicemail$/);
    if (voicemailPath && method === "POST") {
      const session = find(data.sessions, voicemailPath[1]);
      checkChat(session, body);
      if (
        session.call_direction !== "incoming" ||
        !["rejected", "missed"].includes(session.status) ||
        session.turns.length
      )
        throw new UserError("받지 않은 수신 전화에만 음성 사서함을 남길 수 있습니다.", 409);
      const speech = normalizeSpeech(body);
      session.turns.push({
        id: newId(),
        session_id: session.id,
        turn_index: 0,
        role: "character",
        voicemail: true,
        text: speech.text,
        script: speech.script,
        translation: text(body.translation, 5000),
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        language: speech.language,
        intensity: speech.intensity,
        should_end: true,
        created_at: stamp,
      });
      return { status: "success", session: sessionItem(session) };
    }
    const statusPath = path.match(/^\/phone\/sessions\/([^/]+)\/status$/);
    if (statusPath && method === "POST") {
      const session = find(data.sessions, statusPath[1]);
      checkChat(session, body);
      const allowed = {
        ringing: ["active", "rejected", "missed"],
        active: ["ended"],
      };
      if (
        body.status !== session.status &&
        !allowed[session.status]?.includes(body.status)
      )
        throw new UserError(
          "이미 종료되었거나 허용되지 않는 통화 상태입니다.",
          409,
        );
      session.status = body.status;
      if (body.status === "active") session.answered_at ||= stamp;
      if (["ended", "rejected", "missed"].includes(body.status))
        session.ended_at ||= stamp;
      return { status: "success", session: sessionItem(session) };
    }
    // The messaging app: texts from either side and the character's voice messages.
    // role: who sent it; kind: text or voice; origin: "incoming" when the character reached out
    // first (decided by the state analysis), "reply" when it answered the user's texts.
    if (path === "/voice-messages" && method === "POST") {
      const role = body.role === "user" ? "user" : "character";
      const kind = role === "user" || body.kind === "text" ? "text" : "voice";
      // The character's texts keep their tagged line for listening; the user's own texts don't.
      const speech = normalizeSpeech({
        ...body,
        script: role === "user" ? "" : body.script,
        tags: role === "user" ? [] : body.tags,
      });
      // In a group conversation the message also names the group it was sent in.
      const thread = String(body.thread_key || "");
      if (thread && !GROUP_THREAD.test(thread))
        throw new UserError("단체방 정보가 올바르지 않습니다.");
      if (thread)
        checkChat(find(data.groups, thread.slice("group:".length)), body);
      // 음성 전달: a call, voice message or memo I pass on, with what was said in it (its voice
      // file shared when it has one).
      const forward = role === "user" ? forwardOf(body.forward) : null;
      const item = {
        ...identity(body),
        ...(thread ? { thread_key: thread } : {}),
        ...(forward ? { forward } : {}),
        ...(forward && validAudioName(body.audio_filename) ? { audio_filename: body.audio_filename } : {}),
        id: newId(),
        role,
        kind,
        origin: body.origin === "reply" ? "reply" : "incoming",
        // Why the character reached out; kept so the message can be written again.
        reason: text(body.reason, 500),
        text: speech.text,
        script: speech.script,
        translation: text(body.translation, 5000),
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        language: speech.language,
        intensity: speech.intensity,
        // A group's round of answers, and the answers asked for in its place (답변 재생성).
        ...(text(body.round, 64) ? { round: text(body.round, 64) } : {}),
        ...(text(body.family, 64) ? { family: text(body.family, 64) } : {}),
        created_at: stamp,
      };
      // A new answer for a message set aside (답변 재생성): the earlier answers come along as
      // versions, and the old record goes.
      const old = body.replaces
        ? data.messages.find((x) => x.id === String(body.replaces) && x.stashed)
        : null;
      if (old) {
        checkChat(old, body);
        const earlier = old.versions?.length
          ? old.versions.map((version, index) => (index === old.version ? versionOf(old) : version))
          : [versionOf(old)];
        item.versions = [...earlier, versionOf(item)].slice(-MAX_VERSIONS);
        item.version = item.versions.length - 1;
        data.messages = data.messages.filter((x) => x.id !== old.id);
      }
      data.messages.push(item);
      return { status: "success", id: item.id, created_at: stamp, ...(old ? { versions: item.versions.length } : {}) };
    }
    const attach = path.match(
      /^\/(phone\/turns|voice-messages|phone\/memos)\/([^/]+)\/audio$/,
    );
    if (attach && method === "PUT") {
      const parent =
        attach[1] === "phone/turns"
          ? data.sessions.find((s) => s.turns.some((t) => t.id === attach[2]))
          : null;
      const item = find(parent?.turns || (attach[1] === "phone/memos" ? data.memos : data.messages), attach[2]);
      checkChat(parent || item, body);
      const generation = find(data.generations, body.generation_id);
      if (
        generation.chat_id !== (parent || item).chat_id ||
        generation.text !== item.text
      )
        throw new UserError("이 대사에 해당하는 음성이 아닙니다.", 409);
      Object.assign(item, {
        generation_id: generation.id,
        audio_filename: generation.audio_filename,
        mime_type: audioType(generation.audio_filename),
        applied_control: generation.applied_control,
        audio_filtered: false,
        // Its sound effects are in the file (not played around it).
        sounds_mixed: Boolean(generation.sounds?.length),
      });
      return {
        status: "success",
        ...(parent ? { session: sessionItem(parent) } : { item: audioItem(item) }),
      };
    }
    // Group conversations: made, renamed or given other members, and left (with their messages).
    if (path === "/message-groups" && method === "POST") {
      const group = {
        id: newId(),
        chat_id: required(body.chat_id, "채팅"),
        ...groupFields(body),
        created_at: stamp,
      };
      data.groups.push(group);
      return { status: "success", group };
    }
    const groupPath = path.match(/^\/message-groups\/([^/]+)$/);
    if (groupPath && method === "PUT") {
      const group = find(data.groups, groupPath[1]);
      checkChat(group, body);
      Object.assign(group, groupFields(body), { updated_at: stamp });
      return { status: "success", group };
    }
    // A room without the user talking by itself counts its runs per day (the user's day).
    const autoRun = path.match(/^\/message-groups\/([^/]+)\/auto-run$/);
    if (autoRun && method === "POST") {
      const group = find(data.groups, autoRun[1]);
      checkChat(group, body);
      const day = text(body.day, 10);
      if (group.auto_day !== day) Object.assign(group, { auto_day: day, auto_runs: 0 });
      const cap = Number(group.auto_daily_max ?? 5);
      if (cap > 0 && group.auto_runs >= cap) return { status: "success", allowed: false };
      group.auto_runs += 1;
      return { status: "success", allowed: true, runs: group.auto_runs };
    }
    if (groupPath && method === "DELETE") {
      const group = find(data.groups, groupPath[1]);
      checkChat(group, body);
      data.groups = data.groups.filter((x) => x.id !== group.id);
      // Voice files of its messages stay in the audio history.
      data.messages = data.messages.filter(
        (x) => !(x.thread_key === `group:${group.id}` && x.chat_id === group.chat_id),
      );
      return { status: "success" };
    }
    // 미적용 기억 → 모두 지우기: several messages at once; their voice files stay in the audio history.
    if (path === "/voice-messages/delete" && method === "POST") {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id)));
      const items = data.messages.filter((x) => ids.has(x.id));
      items.forEach((item) => checkChat(item, body));
      data.messages = data.messages.filter((x) => !ids.has(x.id));
      return { status: "success", removed: items.length };
    }
    // 음성 메모: one a character recorded for themselves (asked for, or on their own).
    if (path === "/phone/memos" && method === "POST") {
      const speech = normalizeSpeech(body);
      const memo = {
        ...identity(body),
        id: newId(),
        text: speech.text,
        script: speech.script,
        translation: text(body.translation, 5000),
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        language: speech.language,
        intensity: speech.intensity,
        about: text(body.about, 600),
        origin: body.origin === "auto" ? "auto" : "asked",
        created_at: stamp,
      };
      (data.memos ||= []).push(memo);
      return { status: "success", item: audioItem(memo) };
    }
    // 라디오: a show written whole (who was on air, how it was asked for, and its lines).
    if (path === "/phone/radio" && method === "POST") {
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 40);
      if (!lines.length) throw new UserError("방송 대사가 없습니다.");
      const show = {
        ...identity(body),
        id: newId(),
        title: text(body.title, 120),
        mode: body.mode === "story" ? "story" : "talk",
        hosts: callPeople(body.hosts),
        story: text(body.story, 2000),
        lines: lines.map((line) => {
          const speech = normalizeSpeech(line);
          return {
            id: newId(),
            speaker_key: text(line.speaker_key),
            speaker_name: text(line.speaker_name, 300),
            text: speech.text,
            script: speech.script,
            translation: text(line.translation, 5000),
            tags: speech.tags,
            emotion: speech.emotion,
            direction: speech.direction,
            language: speech.language,
            intensity: speech.intensity,
          };
        }),
        created_at: stamp,
      };
      (data.radio ||= []).push(show);
      return { status: "success", item: radioItem(show) };
    }
    const removeShow = path.match(/^\/phone\/radio\/([^/]+)$/);
    if (removeShow && method === "DELETE") {
      const show = find(data.radio || [], removeShow[1]);
      checkChat(show, body);
      data.radio = data.radio.filter((x) => x.id !== show.id);
      return { status: "success" };
    }
    // 고치기 on a show's line: its words change and its old voice no longer goes with it.
    const radioEdit = path.match(/^\/phone\/radio-lines\/([^/]+)$/);
    if (radioEdit && method === "PUT") {
      const show = (data.radio || []).find((x) => x.lines.some((line) => line.id === radioEdit[1]));
      if (!show) throw new UserError("기록을 찾을 수 없습니다.", 404);
      checkChat(show, body);
      const line = show.lines.find((x) => x.id === radioEdit[1]);
      const speech = normalizeSpeech({
        text: body.text,
        script: body.script,
        tags: body.tags,
        language: body.language || line.language,
        intensity: line.intensity,
      });
      for (const field of ["generation_id", "audio_filename", "mime_type", "sounds_mixed"]) delete line[field];
      Object.assign(line, {
        text: speech.text,
        script: speech.script,
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        translation: text(body.translation, 5000),
        edited_at: stamp,
      });
      return { status: "success", item: radioItem(show) };
    }
    const radioLine = path.match(/^\/phone\/radio-lines\/([^/]+)\/audio$/);
    if (radioLine && method === "PUT") {
      const show = (data.radio || []).find((x) => x.lines.some((line) => line.id === radioLine[1]));
      if (!show) throw new UserError("기록을 찾을 수 없습니다.", 404);
      checkChat(show, body);
      const line = show.lines.find((x) => x.id === radioLine[1]);
      const generation = find(data.generations, body.generation_id);
      if (generation.chat_id !== show.chat_id || generation.text !== line.text)
        throw new UserError("이 대사에 해당하는 음성이 아닙니다.", 409);
      Object.assign(line, {
        generation_id: generation.id,
        audio_filename: generation.audio_filename,
        mime_type: audioType(generation.audio_filename),
        sounds_mixed: Boolean(generation.sounds?.length),
      });
      return { status: "success", item: radioItem(show) };
    }
    const removeMemo = path.match(/^\/phone\/memos\/([^/]+)$/);
    if (removeMemo && method === "DELETE") {
      const item = find(data.memos || [], removeMemo[1]);
      checkChat(item, body);
      data.memos = data.memos.filter((x) => x.id !== item.id);
      return { status: "success" };
    }
    // A message is deleted; its voice file stays in the audio history.
    const removeMessage = path.match(/^\/voice-messages\/([^/]+)$/);
    if (removeMessage && method === "DELETE") {
      const item = find(data.messages, removeMessage[1]);
      checkChat(item, body);
      data.messages = data.messages.filter((x) => x.id !== item.id);
      return { status: "success" };
    }
    // A group's rounds: one hidden while another of its versions is shown (답변 재생성, ‹ ›).
    if (path === "/voice-messages/visibility" && method === "PUT") {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id)));
      for (const item of data.messages.filter((x) => ids.has(x.id))) {
        checkChat(item, body);
        if (body.hidden) item.hidden = true;
        else delete item.hidden;
        if (text(body.round, 64) && !item.round) item.round = text(body.round, 64);
        if (text(body.family, 64) && !item.family) item.family = text(body.family, 64);
      }
      return { status: "success" };
    }
    // 답변 재생성: the message is set aside (hidden) until its new answer replaces it, or comes
    // back if none came. 버전 넘기기: another of its answers becomes the one shown.
    const versioned = path.match(/^\/voice-messages\/([^/]+)\/(stash|version)$/);
    if (versioned && method === "PUT") {
      const item = find(data.messages, versioned[1]);
      checkChat(item, body);
      if (versioned[2] === "stash") {
        if (body.stashed) item.stashed = stamp;
        else delete item.stashed;
        return { status: "success" };
      }
      const list = Array.isArray(item.versions) ? item.versions : [];
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= list.length)
        throw new UserError("그 답을 찾을 수 없습니다.", 404);
      // The one shown now keeps what it gained meanwhile (a voice made, an edit).
      list[Number.isInteger(item.version) ? item.version : list.length - 1] = versionOf(item);
      for (const field of VERSION_FIELDS) delete item[field];
      Object.assign(item, list[index]);
      item.version = index;
      return { status: "success", item: audioItem(item) };
    }
    // 미적용 기억 → 모두 지우기: several finished calls at once (one going on stays).
    if (path === "/phone/sessions/delete" && method === "POST") {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id)));
      const sessions = data.sessions.filter(
        (x) => ids.has(x.id) && !["active", "ringing"].includes(x.status),
      );
      sessions.forEach((session) => checkChat(session, body));
      const removed = new Set(sessions.map((session) => session.id));
      data.sessions = data.sessions.filter((x) => !removed.has(x.id));
      return { status: "success", removed: removed.size };
    }
    // A finished call is removed from the call history; its voice files stay in the audio history.
    const removeSession = path.match(/^\/phone\/sessions\/([^/]+)$/);
    if (removeSession && method === "DELETE") {
      const session = find(data.sessions, removeSession[1]);
      checkChat(session, body);
      if (["active", "ringing"].includes(session.status))
        throw new UserError("진행 중인 통화는 지울 수 없습니다. 먼저 끊어 주세요.", 409);
      data.sessions = data.sessions.filter((x) => x.id !== session.id);
      return { status: "success" };
    }
    // 답변 재생성 on a call: the new answer takes the last line's place and the earlier ones stay
    // as versions to page through (‹ 1/2 ›); `version` shows another one.
    const callAnswer = path.match(/^\/phone\/turns\/([^/]+)\/(answer|version)$/);
    if (callAnswer && method === "PUT") {
      const session = data.sessions.find((s) => s.turns.some((x) => x.id === callAnswer[1]));
      if (!session) throw new UserError("기록을 찾을 수 없습니다.", 404);
      checkChat(session, body);
      const turn = session.turns.at(-1);
      if (session.status !== "active" || turn?.id !== callAnswer[1] || turn.role !== "character")
        throw new UserError("진행 중인 통화의 마지막 대사만 바꿀 수 있습니다.", 409);
      const list = Array.isArray(turn.versions) && turn.versions.length ? turn.versions : [versionOf(turn)];
      list[Number.isInteger(turn.version) ? turn.version : list.length - 1] = versionOf(turn);
      let index = Number(body.index);
      if (callAnswer[2] === "answer") {
        const speech = normalizeSpeech(body);
        if (!speech.text) throw new UserError("대사가 비어 있습니다.");
        list.push({
          text: speech.text,
          script: speech.script,
          translation: text(body.translation, 5000),
          tags: speech.tags,
          emotion: speech.emotion,
          direction: speech.direction,
          language: speech.language,
          intensity: speech.intensity,
          should_end: Boolean(body.should_end),
          ...nearbySpeaker(body),
        });
        while (list.length > MAX_VERSIONS) list.shift();
        index = list.length - 1;
      } else if (!Number.isInteger(index) || index < 0 || index >= list.length)
        throw new UserError("그 답을 찾을 수 없습니다.", 404);
      for (const field of VERSION_FIELDS) delete turn[field];
      Object.assign(turn, list[index]);
      turn.versions = list;
      turn.version = index;
      return { status: "success", session: sessionItem(session) };
    }
    // The last line of an active call is taken back to be written again.
    const removeTurn = path.match(/^\/phone\/turns\/([^/]+)$/);
    if (removeTurn && method === "DELETE") {
      const session = data.sessions.find((s) => s.turns.some((x) => x.id === removeTurn[1]));
      if (!session) throw new UserError("기록을 찾을 수 없습니다.", 404);
      checkChat(session, body);
      if (session.status !== "active" || session.turns.at(-1)?.id !== removeTurn[1])
        throw new UserError("진행 중인 통화의 마지막 대사만 다시 쓸 수 있습니다.", 409);
      session.turns.pop();
      return { status: "success", session: sessionItem(session) };
    }
    // The user rewrites a call line or voice message; its old voice no longer fits. In a call
    // still going only the other side's lines; in a past one (a call written whole) mine too.
    const rewrite = path.match(/^\/(phone\/turns|voice-messages|phone\/memos)\/([^/]+)$/);
    if (rewrite && method === "PUT") {
      const parent =
        rewrite[1] === "phone/turns"
          ? data.sessions.find((s) => s.turns.some((t) => t.id === rewrite[2]))
          : null;
      const item = find(parent?.turns || (rewrite[1] === "phone/memos" ? data.memos : data.messages), rewrite[2]);
      checkChat(parent || item, body);
      if (parent && item.role === "user" && ["active", "ringing"].includes(parent.status))
        throw new UserError("통화 중에는 상대의 대사만 고칠 수 있습니다.", 409);
      const speech = normalizeSpeech({
        text: body.text,
        script: body.script,
        tags: body.tags,
        language: body.language || item.language,
        intensity: item.intensity,
      });
      for (const field of [
        "generation_id",
        "audio_filename",
        "mime_type",
        "applied_control",
        "audio_filtered",
      ])
        delete item[field];
      Object.assign(item, {
        text: speech.text,
        script: speech.script,
        tags: speech.tags,
        emotion: speech.emotion,
        direction: speech.direction,
        // A translation of the old words would be wrong now.
        translation: text(body.translation, 5000),
        edited_at: stamp,
      });
      return {
        status: "success",
        ...(parent ? { session: sessionItem(parent) } : { item: audioItem(item) }),
      };
    }
    throw new UserError("지원하지 않는 기능입니다.", 404);
  }
  /**
   * A phone line's voice with its sound effects mixed in (made in the page from the voice just
   * made): saved as a WAV file that the voice's record then points to, so the line keeps its
   * sounds wherever it is played or kept (기록, 보관함). The same voice and sounds give the same
   * file; the plain voice stays in the cache for the next time it is made.
   */
  async saveMixedAudio(raw) {
    const data = await this.store.read();
    const base = find(data.generations, raw.generation_id);
    const encoded = String(raw.data || "");
    if (!encoded || encoded.length > 40 * 1024 * 1024)
      throw new UserError("효과음을 섞은 음성이 올바르지 않습니다.");
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF")
      throw new UserError("효과음을 섞은 음성이 올바르지 않습니다.");
    const sounds = (Array.isArray(raw.sounds) ? raw.sounds : [])
      .map((name) => text(name, 60))
      .filter(Boolean)
      .slice(0, 8);
    const key = contentKey({ base: base.cache_key, sounds, overlay: Boolean(raw.overlay) });
    const filename = `${key}.wav`;
    let audioMetadata;
    if (!(await this.store.getAudio(filename))) {
      if (this.store.stageAudio) audioMetadata = await this.store.stageAudio(filename, bytes);
      else await this.store.writeAudio(filename, bytes);
    }
    const record = await this.store.transaction((db) => {
      if (audioMetadata) db.audioFiles[filename] = audioMetadata;
      else if (db.audioFiles && !db.audioFiles[filename])
        db.audioFiles[filename] = { name: filename, size: bytes.byteLength, created: Date.now() };
      const item = find(db.generations, base.id);
      Object.assign(item, { audio_filename: filename, mime_type: "audio/wav", sounds });
      return item;
    });
    return { status: "success", id: record.id, audio_filename: filename };
  }

  async generate(raw, signal) {
    const data = await this.store.read();
    const base = settingsWithDefaults(data.settings);
    // MultiCast 확장's voice settings, when the phone follows it (채팅 대사 읽기 off).
    const borrowed = raw.engine_settings && typeof raw.engine_settings === "object" ? raw.engine_settings : null;
    if (borrowed) {
      const unit = (value, min, max) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : undefined);
      base.engine = "elevenlabs";
      base.elevenlabs = {
        ...base.elevenlabs,
        ...(validModel("elevenlabs", borrowed.model) ? { model: borrowed.model } : {}),
        ...Object.fromEntries(
          [
            ["stability", unit(borrowed.stability, 0, 1)],
            ["similarity_boost", unit(borrowed.similarity_boost, 0, 1)],
            ["style", unit(borrowed.style, 0, 1)],
            ["speed", unit(borrowed.speed, 0.7, 1.2)],
          ].filter(([, value]) => value !== undefined),
        ),
      };
    }
    const resolved = resolveVoice(base, raw);
    const settings = resolved.settings;
    if (settings.active === false)
      throw new UserError("씬보이스가 꺼져 있습니다.", 409);
    // The phone with 채팅 대사 읽기 off: the default voices (a chat setting) aren't borrowed; a
    // contact without a voice of their own is texted only.
    if (raw.own_voice_only && resolved.voice_from === "default")
      throw new UserError(
        `‘${resolved.speaker_name || "이 인물"}’에게 목소리가 없어 음성을 만들지 않습니다. 설정 → 캐릭터별 목소리에서 정해 주세요.`,
      );
    if (!this.env.engines.includes(settings.engine))
      throw new UserError(
        "선택한 음성 엔진을 현재 연결에서 사용할 수 없습니다.",
        409,
      );
    const request = buildSpeechRequest(settings, withAlwaysTags(raw, resolved.always_tags));
    const key = contentKey({
      version: 1,
      engine: request.engine,
      voice: request.voice,
      body: request.body,
      headers: request.headers,
      variation:
        text(raw.variation_token, 100) || (raw.force_regenerate ? newId() : ""),
    });
    const filename = `${key}.mp3`;
    return this.queue.run(async () => {
      let bytes = raw.force_regenerate
        ? null
        : await this.store.getAudio(filename);
      const hit = Boolean(bytes);
      let audioMetadata;
      if (!bytes) {
        bytes = await this.env.synthesize(request, settings, signal);
        if (!bytes?.byteLength || bytes.byteLength > 50 * 1024 * 1024)
          throw new UserError("음성 응답 크기가 올바르지 않습니다.", 502);
        throwIfAborted(signal);
        if (this.store.stageAudio)
          audioMetadata = await this.store.stageAudio(filename, bytes);
        else await this.store.writeAudio(filename, bytes);
      }
      const stamp = now();
      const record = await this.store.transaction((db) => {
        if (audioMetadata) db.audioFiles[filename] = audioMetadata;
        else if (db.audioFiles && !db.audioFiles[filename])
          db.audioFiles[filename] = {
            name: filename,
            size: bytes.byteLength,
            created: Date.now(),
          };
        // A cache file may be shared; each chat gets its own provenance record.
        let item = db.generations.find(
          (x) =>
            x.cache_key === key &&
            x.chat_id === text(raw.chat_id) &&
            x.message_id === text(raw.message_id, 100) &&
            (x.line_key || "") === text(raw.line_key, 64) &&
            x.speaker_key === resolved.speaker_key &&
            x.utterance_kind === resolved.utterance_kind,
        );
        const fields = {
          cache_key: key,
          engine: request.engine,
          model_name: request.model,
          voice_id: request.voice,
          speaker_key: resolved.speaker_key,
          speaker_name: resolved.speaker_name,
          utterance_kind: resolved.utterance_kind,
          script: request.input.script,
          tags: request.input.tags,
          emotion: request.input.emotion,
          direction: request.input.direction,
          language: request.input.language,
          text: request.input.text,
          chat_id: text(raw.chat_id),
          message_id: text(raw.message_id, 100),
          quote_index: Number(raw.quote_index) || 0,
          line_key: text(raw.line_key, 64),
          config_key: text(raw.config_key, 64),
          edit_key: text(raw.edit_key, 64),
          audio_filename: filename,
          mime_type: "audio/mpeg",
          // Made again: plain voice until its sounds are mixed in once more.
          sounds: [],
          applied_control: request.control,
          mode: raw.phone_mode
            ? "phone"
            : raw.voice_message_mode
              ? "voice_message"
              : "dialogue",
          created_at: stamp,
          size: bytes.byteLength,
        };
        if (item) Object.assign(item, fields);
        else {
          item = { id: newId(), ...fields };
          db.generations.push(item);
        }
        return item;
      });
      // How full the cache is after this file, for the "almost full" notice.
      let usage = "";
      if (!hit) {
        const pruned = await this.prune(false, filename);
        usage = String(Math.round((pruned.size_bytes / (pruned.max_size_mb * 1048576)) * 100) / 100);
      }
      return {
        bytes,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Audio-Filename": filename,
          "X-SceneVoice-History-ID": record.id,
          "X-SceneVoice-Emotion": request.input.emotion,
          "X-SceneVoice-Applied": encodeURIComponent(request.control),
          "X-SceneVoice-Cache": hit ? "hit" : "new",
          ...(usage ? { "X-SceneVoice-Storage": usage } : {}),
        },
      };
    }, signal);
  }
  async stats(files = null) {
    files ||= await this.store.listAudio();
    const size = files.reduce((sum, x) => sum + x.size, 0);
    return {
      file_count: files.length,
      size_bytes: size,
      size_mb: Math.round((size / 1048576) * 100) / 100,
      queue: { waiting: this.queue.waiting, active: this.queue.active },
      favorites_path: this.env.storageLabel,
    };
  }
  /** Deletes audio files, then drops them from the records in one write. */
  async removeFiles(names) {
    for (const name of names) await this.store.deleteAudio(name, { listed: false });
    await this.store.transaction((data) => {
      if (data.audioFiles) for (const name of names) delete data.audioFiles[name];
      data.generations = data.generations.filter(
        (x) => !names.has(x.audio_filename),
      );
      for (const item of [
        ...data.messages,
        ...(data.memos || []),
        ...(data.radio || []).flatMap((show) => show.lines || []),
        ...data.sessions.flatMap((s) => s.turns),
      ])
        for (const version of [item, ...(item.versions || [])])
          if (names.has(version.audio_filename)) {
            delete version.audio_filename;
            delete version.audio_url;
            delete version.generation_id;
          }
    });
  }
  async prune(all = false, protect = "") {
    const snapshot = await this.store.read();
    const settings = settingsWithDefaults(snapshot.settings);
    const available = snapshot.audioFiles
      ? Object.values(snapshot.audioFiles).filter(
          (row) => validAudioName(row.name) && !row.name.startsWith("fav_"),
        )
      : await this.store.listAudio();
    const files = available.sort((a, b) => a.created - b.created);
    let total = files.reduce((sum, x) => sum + x.size, 0);
    const remove = new Set();
    for (const file of files)
      if (
        file.name !== protect &&
        (all ||
          (settings.cache.max_age_days > 0 &&
            Date.now() - file.created > settings.cache.max_age_days * 86400000) ||
          total > settings.cache.max_size_mb * 1048576)
      ) {
        remove.add(file.name);
        total -= file.size;
      }
    if (remove.size) await this.removeFiles(remove);
    return {
      status: "success",
      removed: remove.size,
      max_size_mb: settings.cache.max_size_mb,
      ...(await this.stats(files.filter((file) => !remove.has(file.name)))),
    };
  }
  async mediaMutation(method, path, body = {}) {
    const id = path.split("/")[2],
      data = await this.store.read();
    if (path.startsWith("/favorites/") && method === "POST") {
      const existing = data.favorites.find((x) => x.generation_id === id);
      if (existing) return { status: "exists", id: existing.id };
      const generation = find(data.generations, id),
        bytes = await this.store.getAudio(generation.audio_filename);
      if (!bytes)
        throw new UserError("음성 파일이 없습니다. 다시 생성해 주세요.", 404);
      const favorite = {
        ...generation,
        id: newId(),
        generation_id: id,
        created_at: now(),
      };
      favorite.audio_filename = `fav_${favorite.id}.${generation.audio_filename.endsWith(".wav") ? "wav" : "mp3"}`;
      await this.store.writeAudio(favorite.audio_filename, bytes);
      await this.store.transaction((db) => db.favorites.push(favorite));
      return { status: "success", id: favorite.id };
    }
    if (path.startsWith("/favorites/") && method === "DELETE") {
      const item = find(data.favorites, id);
      if (item.audio_filename)
        await this.store.deleteAudio(item.audio_filename);
      await this.store.transaction((db) => {
        db.favorites = db.favorites.filter((x) => x.id !== id);
      });
      return { status: "success" };
    }
    // 기록 → 화자 하나의 음성 모두 지우기 (a file another speaker's record still uses stays).
    if (path === "/history/speaker" && method === "POST") {
      const key = String(body?.speaker_key || "");
      if (!key) throw new UserError("지울 화자를 골라 주세요.");
      const ids = new Set(data.generations.filter((x) => (x.speaker_key || "") === key).map((x) => x.id));
      const files = new Set(
        data.generations
          .filter((x) => ids.has(x.id) && x.audio_filename)
          .map((x) => x.audio_filename)
          .filter((name) => !data.generations.some((x) => !ids.has(x.id) && x.audio_filename === name)),
      );
      if (files.size) await this.removeFiles(files);
      await this.store.transaction((db) => {
        db.generations = db.generations.filter((x) => !ids.has(x.id));
      });
      return { status: "success", removed: ids.size };
    }
    if (path.startsWith("/history/") && method === "DELETE") {
      const item = find(data.generations, id);
      if (
        !item.audio_filename ||
        data.generations.some(
          (x) => x.id !== id && x.audio_filename === item.audio_filename,
        )
      ) {
        await this.store.transaction((db) => {
          db.generations = db.generations.filter((x) => x.id !== id);
        });
      } else await this.removeFiles(new Set([item.audio_filename]));
      return { status: "success" };
    }
    throw new UserError("지원하지 않는 기능입니다.", 404);
  }
}
