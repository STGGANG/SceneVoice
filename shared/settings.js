// Settings: defaults, validation and the engines' models.
import { validateVoices } from "./casting.js";
import {
  DEFAULT_READING_RULES,
  READING_KINDS,
} from "./segments.js";
export const EMOTIONS = [
  "default",
  "calm",
  "soft",
  "happy",
  "sad",
  "pain",
  "tense",
  "angry",
  "battle",
  "fearful",
  "surprised",
  "tired",
  "sarcastic",
  "sensual",
  "flustered",
  "languid",
  "seductive",
  "curious",
  "confident",
  "disappointed",
  "relieved",
  "embarrassed",
];
// ElevenLabs text-to-speech models offered today (docs, October 2026). Any other model ID
// (a newer one, or a retired Turbo) can be typed in by hand.
export const MODELS = {
  fish: ["s2.1-pro-free", "s2.1-pro", "s2-pro"],
  elevenlabs: [
    "eleven_v4",
    "eleven_v4_turbo",
    "eleven_v3",
    "eleven_v3_conversational",
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_flash_v2",
  ],
};
/** A model this engine can be asked for: one of the list, or (ElevenLabs) a typed-in ID. */
export function validModel(engine, model) {
  if (MODELS[engine]?.includes(model)) return true;
  return engine === "elevenlabs" && /^[a-z0-9_]{3,64}$/.test(String(model || ""));
}
/**
 * What an ElevenLabs model takes. v3 and later (v3, v4 and their variants) perform audio tags;
 * the others would read a bracket aloud, so they get the plain line.
 */
export function elevenModelTraits(model) {
  const id = String(model || "");
  const generation = Number(/^eleven_v(\d+)/.exec(id)?.[1] || 0);
  const tags = generation >= 3;
  return {
    tags,
    // v3 snaps stability to Creative / Natural / Robust and takes a style value.
    v3: generation === 3,
    style: generation === 3 || id === "eleven_multilingual_v2",
    // v4 has no speed control; the v2-generation models have one.
    speed: /^eleven_(multilingual_v2|flash_v2|flash_v2_5|turbo_v2|turbo_v2_5)$/.test(id),
    languageCode: tags || /_v2_5$/.test(id),
    maxChars: generation === 3 ? 5000 : /flash/.test(id) ? 30000 : 10000,
  };
}
export const PHONE_LAUNCHERS = ["floating", "menu", "both"];
// Languages a person can speak on the phone and that lines are tagged with (ISO 639-1).
export const SPEECH_LANGUAGES = ["ko", "ja", "en", "zh", "fr", "es", "de", "it", "pt", "ru"];
// Smartphone colors: the dark default, or one of the light themes with a white body.
export const PHONE_THEMES = ["default", "white", "pink", "blue"];
export const OVERHEARD_LENGTHS = ["short", "normal", "long"];
export const DEFAULT_SETTINGS = {
  // 씬보이스 사용: off, nothing runs (line buttons, phone, analysis, chat memory); records stay.
  active: true,
  // 채팅 대사 읽기: chat messages' lines get voices. Off leaves only the phone.
  enabled: true,
  engine: "elevenlabs",
  analysis_enabled: true,
  connection_profile_id: "",
  context_messages: 4,
  character_notes: {},
  character_voices: {},
  // Marked regions that get a play button (quotes, *…*, (…), or the user's own marks).
  // thought_effect: thoughts play a little softer and more inward (playback only).
  // version 2 added the straight single quote.
  reading: { rules: structuredClone(DEFAULT_READING_RULES), thought_effect: true, version: 2 },
  // auto_new: a new AI reply is voiced and read through at once (its 음성 준비 is pressed).
  // caption: the line being read shown under 실리태번's top bar: "off", "auto" (only for lines
  // read from the original while a translation is on screen) or "always".
  // line_buttons: the play buttons beside the lines (off: hidden, 음성 준비 still reads them).
  // prepare: the message's 음성 준비 / 이어 듣기 button.
  playback: { auto_new: false, caption: "always", line_buttons: true, prepare: true },
  // uncertain: what 음성 준비 does with a line whose speaker is unclear: "skip" it, or read it
  // with the default voice (the male or female one when the analysis tells).
  // multicast_sync: MultiCast TTS's cast kept in step with the people here (when it is installed).
  casting: { auto_enabled: true, uncertain: "skip", multicast_sync: true },
  // "auto": each person's own language, otherwise the conversation's. A language set here is
  // used by everyone.
  default_language: "auto",
  llm: {
    include_preset: true,
    analysis_include_persona: false,
    // Card descriptions go to the line analysis.
    analysis_include_character: true,
    // A new AI message is analysed as soon as it arrives (speakers and tags; no audio).
    auto_analyze: false,
    // On: line analysis and state tracking go at a low temperature so their JSON stays intact.
    // Calls and texts always use the connection preset's temperature.
    task_temperature: true,
    // 0 = follow the connection profile's preset.
    max_input_tokens: 0,
    max_output_tokens: 0,
  },
  state_tracking: {
    enabled: false,
    connection_profile_id: "",
    context_messages: 8,
    // Update the state after every N new AI replies.
    every_messages: 2,
  },
  phone: {
    // 스마트폰 사용: off removes the phone, its buttons and everyone reaching out first.
    app_enabled: true,
    connection_profile_id: "",
    context_messages: 10,
    auto_enabled: false,
    auto_cooldown_messages: 0,
    ringtone: true,
    vibration: true,
    audio_filter: true,
    // Sound effects mixed into a line's saved voice (off: the voice alone, sounds played around it).
    sfx_in_file: true,
    // Where the smartphone can be opened: floating button, extensions (wand) menu, or both.
    launcher: "both",
    // The floating button shows only while a call or message waits (on every device).
    launcher_events_only: false,
    // A call or voice message in another language also shows a Korean translation (not spoken).
    show_translation: true,
    // The other side's reply is voiced and played as soon as it arrives.
    auto_voice: true,
    // A call of theirs declined or not picked up within a minute: they leave a voicemail.
    voicemail: true,
    // 엿듣는 통화: now and then two people phone each other, written out for the user to hear.
    overheard_calls: false,
    // 엿듣는 통화 길이 (lines asked for: see overheardCallSystem).
    overheard_length: "normal",
    theme: "default",
    // 월드인포 참고, per bot card (switched on there): entries the call or text conversation
    // triggers go to the prompt, from the books and entries chosen for the card:
    // {cardKey: {enabled, books: {key: bool}, entries: {key: {uid: bool}}}}.
    world_info_choice: {},
  },
  // The messaging app. enabled: the character may text or send a voice message first.
  voice_message: {
    enabled: false,
    audio_filter: true,
    auto_generate_audio: false,
    // Replies to the user's texts may now and then come as a voice message.
    reply_voice: true,
    // Short tones when a text is sent or arrives.
    sounds: true,
  },
  chat_memory: { enabled: false },
  // max_age_days 0 = keep until the size limit needs the room.
  cache: { max_size_mb: 1024, max_age_days: 0 },
  fish: {
    api_key: "",
    reference_id: "",
    // Default voices by gender, for speakers without a voice of their own.
    reference_id_male: "",
    reference_id_female: "",
    model: "s2.1-pro-free",
    temperature: 0.7,
    top_p: 0.7,
    speed: 1,
  },
  elevenlabs: {
    api_key: "",
    voice_id: "",
    voice_id_male: "",
    voice_id_female: "",
    model: "eleven_v4",
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.2,
    // 0.7–1.2; 1 is not sent.
    speed: 1,
    use_audio_tags: true,
    // Short scene sound effects ([knocking], [applause]) between lines; Eleven v4 performs them.
    sound_effects: false,
  },
};

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function bounded(value, min, max, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new UserError(`숫자는 ${min}~${max} 범위여야 합니다.`);
  return number;
}
export function text(value, max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}
export function settingsWithDefaults(source = {}) {
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const key of Object.keys(result)) {
    if (!(key in source)) continue;
    if (result[key] && typeof result[key] === "object") {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      )
        Object.assign(result[key], source[key]);
    } else result[key] = source[key];
  }
  return result;
}
export function validateSettings(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new UserError("설정 형식이 올바르지 않습니다.");
  const next = settingsWithDefaults(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) continue;
    if (value === null)
      throw new UserError(`${key}: 빈 설정을 저장할 수 없습니다.`);
    if (typeof DEFAULT_SETTINGS[key] === "object") {
      if (typeof value !== "object" || Array.isArray(value))
        throw new UserError(`${key}: 설정 형식이 올바르지 않습니다.`);
      if (key === "character_voices") {
        next[key] = validateVoices(value);
        continue;
      }
      if (key === "character_notes") {
        next[key] = Object.fromEntries(
          Object.entries(value)
            .slice(0, 200)
            .map(([k, v]) => [text(k, 300), text(v, 4000)]),
        );
        continue;
      }
      for (const field of Object.keys(DEFAULT_SETTINGS[key])) {
        if (!Object.hasOwn(value, field)) continue;
        if (field === "api_key" && !value[field]) continue;
        next[key][field] = value[field];
      }
      if (value.clear_api_key && ["fish", "elevenlabs"].includes(key))
        next[key].api_key = "";
    } else next[key] = value;
  }
  if (!Object.hasOwn(MODELS, next.engine))
    throw new UserError("지원하지 않는 음성 엔진입니다.");
  if (!["auto", ...SPEECH_LANGUAGES].includes(next.default_language))
    throw new UserError("지원하지 않는 언어입니다.");
  for (const key of ["active", "enabled", "analysis_enabled"])
    next[key] = Boolean(next[key]);
  next.connection_profile_id = text(next.connection_profile_id);
  next.context_messages = bounded(next.context_messages, 0, 12, 4);
  for (const key of [
    "state_tracking",
    "phone",
    "voice_message",
    "chat_memory",
    "llm",
    "casting",
    "playback",
  ]) {
    for (const [field, defaultValue] of Object.entries(DEFAULT_SETTINGS[key])) {
      if (typeof defaultValue === "boolean")
        next[key][field] = Boolean(next[key][field]);
    }
    if ("connection_profile_id" in next[key])
      next[key].connection_profile_id = text(next[key].connection_profile_id);
    // The phone takes as many chat messages as asked (a request too big for the model is cut
    // from its oldest messages when sent).
    if ("context_messages" in next[key])
      next[key].context_messages = Math.round(
        bounded(next[key].context_messages, 1, key === "phone" ? 100000 : 20, 8),
      );
  }
  next.reading = {
    rules: validateReadingRules(next.reading?.rules),
    thought_effect: next.reading?.thought_effect !== false,
    version: 2,
  };
  next.phone.world_info_choice = cleanLoreChoice(next.phone.world_info_choice);
  if (!["off", "auto", "always"].includes(next.playback.caption))
    next.playback.caption = DEFAULT_SETTINGS.playback.caption;
  if (!["skip", "default"].includes(next.casting.uncertain))
    next.casting.uncertain = DEFAULT_SETTINGS.casting.uncertain;
  if (!PHONE_LAUNCHERS.includes(next.phone.launcher))
    next.phone.launcher = DEFAULT_SETTINGS.phone.launcher;
  if (!PHONE_THEMES.includes(next.phone.theme))
    next.phone.theme = DEFAULT_SETTINGS.phone.theme;
  if (!OVERHEARD_LENGTHS.includes(next.phone.overheard_length))
    next.phone.overheard_length = DEFAULT_SETTINGS.phone.overheard_length;
  next.phone.auto_cooldown_messages = bounded(
    next.phone.auto_cooldown_messages,
    0,
    100,
    6,
  );
  next.llm.max_input_tokens = Math.round(
    bounded(next.llm.max_input_tokens, 0, 2000000, 0),
  );
  next.llm.max_output_tokens = Math.round(
    bounded(next.llm.max_output_tokens, 0, 200000, 0),
  );
  next.state_tracking.every_messages = Math.round(
    bounded(next.state_tracking.every_messages, 1, 20, 2),
  );
  next.cache.max_size_mb = bounded(next.cache.max_size_mb, 128, 20480, 1024);
  next.cache.max_age_days = Math.round(bounded(next.cache.max_age_days, 0, 3650, 0));
  for (const engine of Object.keys(MODELS)) {
    const section = next[engine];
    if (!validModel(engine, section.model))
      throw new UserError(`${engine}: 지원하지 않는 모델입니다.`);
    section.api_key = text(section.api_key, 1000);
    const voiceField = engine === "fish" ? "reference_id" : "voice_id";
    for (const field of [voiceField, `${voiceField}_male`, `${voiceField}_female`]) {
      section[field] = text(section[field], 200);
      if (section[field] && !/^[a-zA-Z0-9_-]+$/.test(section[field]))
        throw new UserError("Voice ID에는 영문·숫자·밑줄·하이픈만 사용할 수 있습니다.");
    }
  }
  next.elevenlabs.use_audio_tags = Boolean(next.elevenlabs.use_audio_tags);
  for (const field of ["stability", "similarity_boost", "style"])
    next.elevenlabs[field] = bounded(
      next.elevenlabs[field],
      0,
      1,
      DEFAULT_SETTINGS.elevenlabs[field],
    );
  next.fish.temperature = bounded(next.fish.temperature, 0.1, 1, 0.7);
  next.fish.top_p = bounded(next.fish.top_p, 0.1, 1, 0.7);
  next.fish.speed = bounded(next.fish.speed, 0.5, 2, 1);
  next.elevenlabs.speed = bounded(next.elevenlabs.speed, 0.7, 1.2, 1);
  return next;
}
/** The lorebook choice, kept to booleans under short keys. */
function cleanLoreChoice(value) {
  const object = (item) => item && typeof item === "object" && !Array.isArray(item);
  if (!object(value)) return {};
  const flags = (item, limit) =>
    Object.fromEntries(
      Object.entries(object(item) ? item : {})
        .slice(0, limit)
        .map(([key, flag]) => [text(key, 300), flag === true]),
    );
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([card, choice]) => [
        text(card, 300),
        {
          enabled: choice?.enabled === true,
          books: flags(choice?.books, 200),
          entries: Object.fromEntries(
            Object.entries(object(choice?.entries) ? choice.entries : {})
              .slice(0, 200)
              .map(([book, uids]) => [text(book, 300), flags(uids, 2000)]),
          ),
        },
      ]),
  );
}
export function publicSettings(settings) {
  const publicValue = settingsWithDefaults(settings);
  for (const provider of Object.keys(MODELS)) {
    publicValue[provider].has_api_key = Boolean(
      publicValue[provider].api_key || settings[provider]?.has_api_key,
    );
    delete publicValue[provider].api_key;
  }
  return publicValue;
}

/** Each rule: start and end mark (1–12 characters, no line break or angle bracket), kind, on/off. */
export function validateReadingRules(rules) {
  if (!Array.isArray(rules))
    throw new UserError("읽을 구간 설정 형식이 올바르지 않습니다.");
  if (rules.length > 20)
    throw new UserError("읽을 구간은 20개까지 만들 수 있습니다.");
  const seen = new Set();
  const result = [];
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule))
      throw new UserError("읽을 구간 설정 형식이 올바르지 않습니다.");
    const open = String(rule.open ?? "").trim();
    const close = String(rule.close ?? "").trim();
    for (const mark of [open, close])
      if (!mark || mark.length > 12 || /[\r\n<>]/.test(mark))
        throw new UserError(
          "읽을 구간의 시작·끝 기호는 줄바꿈·꺾쇠를 제외한 1~12자로 입력해 주세요.",
        );
    const pair = `${open}\u0000${close}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    result.push({
      id: text(rule.id, 40) || `custom-${index + 1}`,
      open,
      close,
      kind: READING_KINDS.includes(rule.kind) ? rule.kind : "dialogue",
      enabled: rule.enabled !== false,
    });
  }
  return result;
}
