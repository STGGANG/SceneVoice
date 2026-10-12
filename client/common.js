// Small helpers and constants shared by the client modules.
import { EMOTIONS as EMOTION_LIST, settingsWithDefaults } from "../shared/settings.js";
import { sha256, contentKey } from "../shared/hash.js";
import { normalizeTags, tagEmotion } from "../shared/providers.js";
/** "[frustrated][emphatic]" for display, or the plain-delivery label. */
const tagsText = (tags) =>
  tags?.length ? tags.map((tag) => `[${tag}]`).join("") : "기본 연기";
const EMOTIONS = new Set(EMOTION_LIST);
const CHAT_MEMORY_KEY = "scenevoice_events";
const CHAT_MEMORY_PROMPT_PREFIX = "scenevoice_chat_memory_";
const FINAL_CALL_STATUSES = new Set(["ended", "rejected", "missed"]);
// Spoken languages as the settings list them.
const LANGUAGE_CHOICES = [
  ["ko", "한국어"],
  ["ja", "일본어"],
  ["en", "영어"],
  ["zh", "중국어"],
  ["fr", "프랑스어"],
  ["es", "스페인어"],
  ["de", "독일어"],
  ["it", "이탈리아어"],
  ["pt", "포르투갈어"],
  ["ru", "러시아어"],
];
const OVERHEARD_LENGTH_CHOICES = [
  ["short", "짧게 (4~6줄)"],
  ["normal", "보통 (6~12줄)"],
  ["long", "길게 (12~20줄)"],
];
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Message text is parsed in a document of its own, with no window: markup in it (an image, an
// event handler) neither loads nor runs, as it would in an element of the page.
let inertDocument = null;
function stripMarkup(value) {
  inertDocument ||= document.implementation?.createHTMLDocument?.("") || null;
  const holder = inertDocument ? inertDocument.body : document.createElement("div");
  holder.innerHTML = String(value ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\[TTSVoice[\s\S]*?\]/gi, "");
  const text = holder.textContent || "";
  if (inertDocument) holder.textContent = "";
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A message's text without MultiCast TTS's 🚀 voice tags (<v n="…">"line"</v>, <sfx n="…"/>):
 * MultiCast takes them out of the message once it has read them, and the message is the same.
 */
function withoutVoiceTags(value) {
  const text = String(value ?? "");
  if (!text.includes("<v") && !text.includes("<sfx")) return text;
  return text
    .replace(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/gi, "$1")
    .replace(/<sfx\b[^>]*?\/?>(?:\s*<\/sfx\s*>)?/gi, "");
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

const simpleHash = (value) => sha256(String(value ?? ""));
const mergeConfig = settingsWithDefaults;

export {
  EMOTIONS,
  CHAT_MEMORY_KEY,
  CHAT_MEMORY_PROMPT_PREFIX,
  FINAL_CALL_STATUSES,
  LANGUAGE_CHOICES,
  OVERHEARD_LENGTH_CHOICES,
  escapeHtml,
  stripMarkup,
  withoutVoiceTags,
  clamp,
  simpleHash,
  mergeConfig,
  normalizeTags,
  tagEmotion,
  tagsText,
  contentKey,
};
