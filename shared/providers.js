// Engine requests (ElevenLabs, Fish) and audio-tag handling.
import {
  EMOTIONS,
  SPEECH_LANGUAGES,
  UserError,
  text,
  bounded,
  validModel,
  elevenModelTraits,
} from "./settings.js";
const CUES = {
  default: "",
  calm: "calm",
  soft: "soft tone",
  happy: "happy",
  sad: "sad",
  pain: "restrained pain",
  tense: "tense",
  angry: "angry",
  battle: "urgent and forceful",
  fearful: "scared",
  surprised: "surprised",
  tired: "tired",
  sarcastic: "sarcastic",
  sensual: "intimate and softly breathy",
  flustered: "flustered",
  languid: "relaxed and languid",
  seductive: "seductive",
  curious: "curious",
  confident: "confident",
  disappointed: "disappointed",
  relieved: "relieved",
  embarrassed: "embarrassed",
};
// Emotion words as audio tags, plus common delivery words. Suggestions only; any short phrase works.
const TAG_WORDS = { battle: "urgent", pain: "pained" };
export const DELIVERY_TAGS = [
  "whispers",
  "quiet",
  "emphatic",
  "reflective",
  "matter-of-fact",
  "breathy",
  "breathless",
  "husky",
  "shaky",
  "hesitant",
  // Named in ElevenLabs' or Fish's own prompting guides.
  "excited",
  "nervous",
  "annoyed",
  "mischievous",
  "shouting",
  "crying",
];
// Voice and breath sounds that can sit inside a line (ElevenLabs' forms; Fish reads them too).
export const SOUND_TAGS = [
  "sighs",
  "laughs",
  "chuckles",
  "clears throat",
  "gasps",
  "sniffs",
  "exhales",
  "gulps",
  "giggles",
  "groans",
  "sobs",
  "yawns",
  "scoffs",
  "panting",
  "inhales deeply",
  // A kiss; ElevenLabs performs it.
  "smooch",
];
export function tagSuggestions(emotions = EMOTIONS) {
  return [
    ...new Set([
      ...emotions
        .filter((item) => item !== "default")
        .map((item) => TAG_WORDS[item] || item),
      ...DELIVERY_TAGS,
    ]),
  ];
}

export const cleanTag = (value) =>
  String(value ?? "")
    .replace(/[\[\]{}<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

const TAG = /\[([^\[\]\r\n]{1,160})\]/g;
const oneSpace = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
// Japanese and Chinese text has no spaces between words, so a removed tag leaves none there.
const NO_SPACE = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
/** The line without its [tags]. */
export const stripTags = (value) =>
  oneSpace(
    String(value ?? "").replace(
      /(\s*)\[[^\[\]\r\n]{1,160}\](\s*)/g,
      (match, left, right, offset, whole) => {
        const before = whole[offset - 1] || "";
        const after = whole[offset + match.length] || "";
        if (NO_SPACE.test(before) || NO_SPACE.test(after)) return "";
        return left || right || (/\w/.test(before) && /\w/.test(after))
          ? " "
          : "";
      },
    ),
  );
const sameWords = (a, b) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
/** Whether a tagged line still has exactly the words of the line (spacing aside). */
export const keepsLine = (script, line) =>
  sameWords(stripTags(script), String(line ?? ""));
const scriptTags = (script) =>
  [...String(script || "").matchAll(TAG)].map((match) => match[1]);

/**
 * A line with audio tags woven in, e.g. "[clears throat] so, you... [chuckles] just kidding."
 * Kept only when removing the tags gives back exactly the line (spacing aside); a script that
 * changed any word, punctuation or ellipsis is dropped and the line falls back to leading tags.
 * Without `line` (a saved manual edit) only the tags are cleaned; it is checked when spoken.
 */
export function cleanScript(script, line) {
  let value = String(script ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!value || value.length > 12000) return "";
  value = value.replace(TAG, (_, tag) => {
    const clean = cleanTag(tag);
    return clean ? `[${clean}]` : " ";
  });
  const count = scriptTags(value).length;
  if (!count || count > 16) return "";
  // Spacing aside: a tag between Japanese words may bring a space the line didn't have.
  if (line !== undefined && !keepsLine(value, line)) return "";
  return value;
}

/** Fish reads one combined cue best at the start; tags inside the line stay where they are. */
function fishScript(script) {
  const lead = /^(?:\s*\[[^\[\]]+\])+/.exec(script);
  if (!lead) return script;
  const tags = scriptTags(lead[0]);
  return `[${tags.join(", ")}] ${script.slice(lead[0].length).trimStart()}`;
}

/**
 * Delivery tags of a line, e.g. ["frustrated", "emphatic"]. Accepts a list, "[a][b]" or "a, b";
 * a line with tags woven in lists every tag in it, in order.
 * Records saved before tags kept one emotion and one free-text direction; those become one tag.
 */
export function normalizeTags(input = {}) {
  let list = input.script ? scriptTags(input.script) : input.tags;
  if (typeof list === "string")
    list = /\[[^\]]+\]/.test(list)
      ? [...list.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1])
      : list.split(/[,，、]/);
  if (!Array.isArray(list)) {
    const legacy = text(input.direction, 160) || CUES[input.emotion] || "";
    list = legacy ? [legacy] : [];
  }
  const seen = new Set();
  return list
    .map(cleanTag)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, input.script ? 16 : 4);
}

/** The emotion word of a tag list, for badges and filters; "default" when none matches. */
export function tagEmotion(tags, fallback = "default") {
  const words = Object.fromEntries(
    Object.entries(TAG_WORDS).map(([emotion, tag]) => [tag, emotion]),
  );
  const known = tags
    .map((tag) => words[tag.toLowerCase()] || tag.toLowerCase())
    .find((tag) => EMOTIONS.includes(tag));
  return known || (EMOTIONS.includes(fallback) ? fallback : "default");
}

/** `matchScript: false` only for a saved manual edit, whose line is not sent with it. */
export function normalizeSpeech(input, { matchScript = true } = {}) {
  const spoken = String(input.text ?? "").trim();
  if (!spoken || spoken.length > 10000)
    throw new UserError("대사는 1~10,000자여야 합니다.");
  const script = cleanScript(input.script, matchScript ? spoken : undefined);
  // A script that changed the words still says how the line starts: keep its leading tags.
  const lead = /^(?:\s*\[[^\[\]\r\n]+\])+/.exec(String(input.script || ""));
  const tags = normalizeTags({
    ...input,
    script,
    tags: !script && lead ? scriptTags(lead[0]) : input.tags,
  });
  return {
    text: spoken,
    script,
    tags,
    emotion: tagEmotion(
      tags,
      Array.isArray(input.tags) ? "default" : input.emotion,
    ),
    // Kept for older readers of saved records.
    direction: tags.join(", "),
    language: SPEECH_LANGUAGES.includes(input.language) ? input.language : "ja",
    intensity: bounded(input.intensity, 0, 1, 0.5),
  };
}
/** ElevenLabs reads each tag as its own audio tag; Fish gets one combined cue. */
export function deliveryCue(tags, engine = "elevenlabs") {
  if (!tags.length) return "";
  return engine === "fish"
    ? `[${tags.join(", ")}]`
    : tags.map((tag) => `[${tag}]`).join("");
}
/** What the engine reads: the tagged line when there is one, otherwise leading tags + the line. */
export function directedText(input, engine = "elevenlabs") {
  if (input.script)
    return engine === "fish" ? fishScript(input.script) : input.script;
  const cue = deliveryCue(normalizeTags(input), engine);
  return cue ? `${cue} ${input.text}` : input.text;
}
/**
 * A person's always-on tags lead every line, whatever the analysis chose; a tag the line
 * already starts with is not doubled.
 */
export function withAlwaysTags(raw, always = []) {
  const tags = (Array.isArray(always) ? always : [])
    .map(cleanTag)
    .filter(Boolean);
  if (!tags.length) return raw;
  const known = new Set(tags.map((tag) => tag.toLowerCase()));
  const lead = tags.map((tag) => `[${tag}]`).join("");
  const script = String(raw.script || "");
  if (script) {
    const head = /^(?:\s*\[[^\[\]\r\n]+\])+/.exec(script)?.[0] || "";
    const kept = [...head.matchAll(/\[([^\[\]\r\n]+)\]/g)]
      .map((match) => match[1])
      .filter((tag) => !known.has(cleanTag(tag).toLowerCase()))
      .map((tag) => `[${tag}]`)
      .join("");
    return {
      ...raw,
      script: `${lead}${kept} ${script.slice(head.length).trimStart()}`,
    };
  }
  const rest = (Array.isArray(raw.tags) ? raw.tags : [])
    .map(cleanTag)
    .filter((tag) => tag && !known.has(tag.toLowerCase()));
  return { ...raw, tags: [...tags, ...rest] };
}
/**
 * A text written over several lines (each shown as its own bubble) read in one breath. Engines
 * pause oddly at every line break, so the lines are joined; a line that ends without punctuation
 * gets a sentence end in its language first (。 for Japanese and Chinese, which join without a
 * space; a period otherwise). A single line comes back unchanged.
 */
export function flowingText(value, language = "") {
  const lines = String(value ?? "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return String(value ?? "");
  const cjk = ["ja", "zh"].includes(language);
  return lines
    .map((line, index) =>
      index === lines.length - 1 ||
      /[.!?。！？…~〜♪」』)\]"”'’,、，:;]$/.test(line)
        ? line
        : `${line}${cjk ? "。" : "."}`,
    )
    .join(cjk ? "" : " ");
}

const LATIN = /[A-Za-z0-9À-ɏ]/;
/**
 * 발음 사전: words the engine misreads go to it written the way they are said (夏川 → なつかわ);
 * the line itself stays as written. Longest word first, each place once, [tags] untouched.
 * A word in Latin letters or digits counts only as a whole word.
 */
export function respell(value, words) {
  const source = String(value ?? "");
  const map = new Map(
    (Array.isArray(words) ? words : [])
      .filter((word) => word?.from && word.to)
      .map(({ from, to }) => [String(from).toLowerCase(), String(to)]),
  );
  if (!map.size) return source;
  const pattern = new RegExp(
    [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "giu",
  );
  return source
    .split(/(\[[^\[\]\r\n]{1,160}\])/)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(pattern, (match, offset) => {
            const to = map.get(match.toLowerCase());
            if (to === undefined) return match;
            const before = part[offset - 1] || "";
            const after = part[offset + match.length] || "";
            if (
              (LATIN.test(match[0]) && LATIN.test(before)) ||
              (LATIN.test(match.at(-1)) && LATIN.test(after))
            )
              return match;
            return to;
          }),
    )
    .join("");
}

/** The words in use for these bot cards: those for every card, then the cards' own (which win). */
export function wordsFor(words, cards) {
  const list = Array.isArray(words) ? words : [];
  const open = new Set(Array.isArray(cards) ? cards.map(String) : []);
  return [
    ...list.filter((word) => !word?.card),
    ...list.filter((word) => word?.card && open.has(word.card)),
  ];
}

// How far a line's intensity may loosen the consistency setting (see buildSpeechRequest).
const INTENSITY_PULL = 0.5;
export function buildSpeechRequest(settings, raw) {
  const input = normalizeSpeech(raw);
  const engine = settings.engine,
    config = settings[engine];
  if (!config || !validModel(engine, config.model))
    throw new UserError("지원하지 않는 음성 모델입니다.");
  const voice = engine === "fish" ? config.reference_id : config.voice_id;
  if (!voice || !/^[a-zA-Z0-9_-]{1,200}$/.test(voice))
    throw new UserError("음성의 Voice / Reference ID를 설정해 주십시오.");
  // ElevenLabs models before v3 would read a bracketed tag aloud: they get the plain line.
  const traits =
    engine === "elevenlabs" ? elevenModelTraits(config.model) : null;
  const useTags =
    engine !== "elevenlabs" || (traits.tags && config.use_audio_tags !== false);
  const spoken = respell(
    flowingText(
      useTags ? directedText(input, engine) : input.text,
      input.language,
    ),
    wordsFor(settings.pronunciation?.words, raw.card_keys),
  );
  const control = input.script
    ? directedText(input, engine).slice(0, 400)
    : deliveryCue(input.tags, engine) || "기본 연기";
  if (traits && spoken.length > traits.maxChars)
    throw new UserError(
      `${config.model}는 연기 지시 포함 ${traits.maxChars.toLocaleString("ko-KR")}자까지 지원합니다. 대사를 나눠 주십시오.`,
    );
  if (spoken.length > 10000 && !traits)
    throw new UserError("연기 지시를 포함한 대사가 10,000자를 초과했습니다.");
  // A line performed with more feeling than usual (intensity above 0.5) loosens the engine's own
  // consistency setting a little: up to a quarter of the way from the user's value to its loose
  // end at intensity 1. The user's value stays the rule for ordinary lines.
  const loosen = Math.max(0, input.intensity - 0.5) * INTENSITY_PULL;
  if (engine === "fish")
    return {
      engine,
      input,
      voice,
      model: config.model,
      control,
      url: "https://api.fish.audio/v1/tts",
      headers: { model: config.model },
      body: {
        text: spoken,
        reference_id: voice,
        temperature:
          Number(config.temperature) +
          (1 - Number(config.temperature)) * loosen,
        top_p: config.top_p,
        prosody: { speed: config.speed, volume: 0, normalize_loudness: true },
        normalize: true,
        format: "mp3",
        sample_rate: 44100,
        mp3_bitrate: 128,
        latency: "normal",
      },
    };
  const voiceSettings = {
    stability: Number(config.stability) * (1 - loosen),
    similarity_boost: config.similarity_boost,
  };
  if (traits.v3) {
    // V3's three delivery modes (Creative / Natural / Robust), by the user's own value: a line's
    // intensity is too small a step to move between them.
    const wanted = Number(config.stability);
    voiceSettings.stability = [0, 0.5, 1].reduce((a, b) =>
      Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a,
    );
  }
  if (traits.style) voiceSettings.style = config.style;
  // Speaking speed, only to models that have it (v4 doesn't).
  if (traits.speed && Number(config.speed) && Number(config.speed) !== 1)
    voiceSettings.speed = Number(config.speed);
  return {
    engine,
    input,
    voice,
    model: config.model,
    control: useTags
      ? control
      : traits.tags
        ? "태그 미사용"
        : "태그 미사용 · 이 모델은 오디오 태그를 읽지 못함",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    headers: {},
    body: {
      text: spoken,
      model_id: config.model,
      ...(traits.languageCode ? { language_code: input.language } : {}),
      voice_settings: voiceSettings,
    },
  };
}
