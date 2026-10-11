// Which language a line, a conversation or a chat is in: the script of the text, common words
// for Latin-script languages, the person's or the global language setting, then the chat.

import { SPEECH_LANGUAGES } from "../shared/settings.js";

const LATIN_WORDS = {
  en: ["the", "and", "you", "is", "are", "what", "this", "that", "to", "of", "it's", "i'm"],
  fr: ["le", "la", "les", "des", "est", "je", "tu", "pas", "vous", "et", "c'est", "une", "suis"],
  es: ["el", "los", "las", "que", "es", "por", "para", "está", "pero", "yo", "estoy", "muy"],
  de: ["der", "die", "das", "und", "ich", "nicht", "ist", "du", "ein", "eine", "mit", "bin"],
  it: ["il", "che", "non", "sono", "gli", "della", "per", "ciao", "mi", "ti", "è", "sei"],
  pt: ["não", "você", "está", "os", "uma", "eu", "com", "isso", "muito", "sou", "tudo", "obrigado"],
};
const LATIN_LETTERS = { fr: /[çœàèêâîûù]/g, es: /[ñ¿¡áíóú]/g, de: /[äöüß]/g, pt: /[ãõ]/g };

export const language = {
  /** Language that the text's own script proves, or "" when the script is ambiguous. */
  scriptLanguage(text) {
    const value = String(text || "");
    if (/[가-힣]/.test(value)) return "ko";
    if (/[ぁ-んァ-ヶ]/.test(value)) return "ja";
    if (/[а-яё]/i.test(value)) return "ru";
    return "";
  },

  /** Which Latin-script language a text is in, by common words and letters; English when unsure. */
  latinLanguage(text) {
    const value = ` ${String(text || "").toLowerCase().replace(/[^\p{L}']+/gu, " ")} `;
    let best = "en",
      top = 0;
    for (const [language, words] of Object.entries(LATIN_WORDS)) {
      const score =
        words.reduce((sum, word) => sum + value.split(` ${word} `).length - 1, 0) +
        (value.match(LATIN_LETTERS[language] || /$^/g) || []).length;
      if (score > top) [best, top] = [language, score];
    }
    return best;
  },

  /** The language most of a sample is written in; "" when there is nothing to go on. */
  scoreLanguage(sample) {
    const value = String(sample || "");
    const count = (pattern) => (value.match(pattern) || []).length;
    const scores = [
      ["ko", count(/[가-힣]/g)],
      ["ja", count(/[ぁ-んァ-ヶ]/g) * 2],
      ["zh", count(/[一-鿿]/g) / 2],
      ["ru", count(/[а-яё]/gi)],
      ["latin", count(/[A-Za-zÀ-ÿ]/g) / 4],
    ].sort((a, b) => b[1] - a[1]);
    if (!(scores[0][1] > 0)) return "";
    return scores[0][0] === "latin" ? this.latinLanguage(value) : scores[0][0];
  },

  /** A short line's language when its script makes it clear. */
  textLanguage(text) {
    const value = String(text || "");
    const script = this.scriptLanguage(value);
    if (script) return script;
    if (!/[一-鿿]/.test(value) && (value.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 4)
      return this.latinLanguage(value);
    return "";
  },

  /** A language chosen in the settings for everyone; "" on auto. */
  fixedLanguage() {
    const setting = this.config.default_language;
    return SPEECH_LANGUAGES.includes(setting) ? setting : "";
  },

  /**
   * The chat's language: the setting, or the latest messages. An empty chat goes by the
   * character card's first message and description, then Korean.
   */
  chatLanguage() {
    const fixed = this.fixedLanguage();
    if (fixed) return fixed;
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = context.chat || [];
    const fromChat = this.scoreLanguage(
      chat
        .slice(-8)
        .map((message) => String(message?.mes || ""))
        .join(" "),
    );
    if (fromChat) return fromChat;
    const card = context.characters?.[context.characterId];
    return (
      this.scoreLanguage(
        [
          card?.data?.first_mes || card?.first_mes,
          card?.data?.description || card?.description,
        ].join(" "),
      ) || "ko"
    );
  },

  /**
   * The language a call or text conversation is in: the setting when it names a language for
   * everyone; on auto the person's own language, then what the user just wrote, the
   * conversation so far, and the chat.
   */
  conversationLanguage(lines = [], latestUserText = "", key = "") {
    return (
      this.fixedLanguage() ||
      (key ? this.personLanguage?.(key) : "") ||
      this.textLanguage(latestUserText) ||
      this.scoreLanguage(lines.join(" ")) ||
      this.chatLanguage()
    );
  },

  /** The language was set by the user (for everyone or for this person), not detected. */
  languageIsFixed(key = "") {
    return Boolean(this.fixedLanguage() || (key && this.personLanguage?.(key)));
  },

  detectLanguage(text, fallback = "ja") {
    const value = String(text || "");
    const script = this.scriptLanguage(value);
    if (script) return script;
    if (/[一-鿿]/.test(value)) return fallback === "zh" ? "zh" : "ja";
    if (/[A-Za-z]/.test(value))
      return ["fr", "es", "de", "it", "pt"].includes(fallback) &&
        (value.match(/[A-Za-zÀ-ÿ]/g) || []).length < 12
        ? fallback
        : this.latinLanguage(value);
    return SPEECH_LANGUAGES.includes(fallback) ? fallback : "ja";
  },
};
