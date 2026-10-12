// Who speaks with which voice: checking the casting data and resolving a line's engine and voice.
import { SPEECH_LANGUAGES, UserError, text } from "./settings.js";
import { cleanTag } from "./providers.js";
// How openly a person shows feeling, in five steps (normal, the middle one, is left unset).
export const EMOTIONAL_RANGES = ["very_restrained", "restrained", "expressive", "very_expressive"];
// A person's emotional range also moves the engine's own consistency setting part of the way
// from the user's value to its steady or loose end (so a high base value still leaves room):
// ElevenLabs stability (higher is steadier; v3 rounds it to Creative / Natural / Robust) and
// Fish temperature (lower is steadier).
// The loose side moves less: very low stability makes a voice unsteady.
const RANGE_PULL = { very_restrained: 0.85, restrained: 0.6, expressive: -0.4, very_expressive: -0.65 };
/** A 1–5 emotional range (MultiCast's 감정 폭) as one of the five steps; "" is normal. */
export function rangeStep(value) {
  const step = Math.round(Number(value));
  return ["", "very_restrained", "restrained", "", "expressive", "very_expressive"][step] ?? "";
}
const clampTo = (value, min, max) => Math.min(max, Math.max(min, value));
export function validateVoices(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 200
  )
    throw new UserError("화자는 최대 200명까지 설정할 수 있습니다.");
  return Object.fromEntries(
    Object.entries(value).map(([key, profile]) => {
      if (
        !key ||
        key.length > 300 ||
        ["__proto__", "prototype", "constructor"].includes(key) ||
        !profile ||
        typeof profile !== "object"
      )
        throw new UserError("화자 설정이 올바르지 않습니다.");
      const engine = ["inherit", "fish", "elevenlabs"].includes(profile.engine)
        ? profile.engine
        : "inherit";
      const result = {
        name: text(profile.name, 120),
        aliases: text(profile.aliases, 600),
        engine,
        voice_id: text(profile.voice_id, 200),
        thought_voice_id: text(profile.thought_voice_id, 200),
      };
      // Optional: the bot card this person belongs to, one voice for a whole card, hidden phone contact.
      const card = text(profile.card, 300);
      if (card.startsWith("character:") && card !== key) result.card = card;
      // false is kept too: a card whose one voice was switched off keeps that voice parked.
      if (typeof profile.single_voice === "boolean") result.single_voice = profile.single_voice;
      if (profile.phone_hidden) result.phone_hidden = true;
      // How openly this person shows feeling; unset means normal.
      if (EMOTIONAL_RANGES.includes(profile.expressiveness))
        result.expressiveness = profile.expressiveness;
      // The language this person speaks on the phone and in messages; unset follows the setting.
      if (SPEECH_LANGUAGES.includes(profile.language)) result.language = profile.language;
      // Tags put in front of every line this person says, whatever the analysis chose.
      const always = (
        Array.isArray(profile.always_tags) ? profile.always_tags : String(profile.always_tags || "").split(/[[\],]+/)
      )
        .map((tag) => cleanTag(String(tag)).slice(0, 40))
        .filter(Boolean)
        .slice(0, 4);
      if (always.length) result.always_tags = always;
      // Picks the male or female default voice while this person has no voice of their own.
      if (["male", "female"].includes(profile.gender)) result.gender = profile.gender;
      // The person's own phone picture (a file in ST's user files, or a small inline image).
      const avatar = String(profile.avatar || "");
      if (
        /^\/user\/files\/scenevoice_avatar_[a-f0-9]{24}\.(webp|jpg|png)$/.test(avatar) ||
        (/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length <= 400000)
      )
        result.avatar = avatar;
      // A card whose people know the real date and time on the phone.
      if (profile.realtime) result.realtime = true;
      // Left out of 음성 준비 and of playing in a row; the line's play button hidden.
      if (profile.skip_voice) result.skip_voice = true;
      // Left out of state tracking (and so never reaches out first).
      if (profile.no_state) result.no_state = true;
      if (profile.hide_button) result.hide_button = true;
      // A global person takes part only in the bot cards it was switched on for. An empty list
      // is kept (switched off everywhere); no list at all means every bot card.
      if (Array.isArray(profile.use_cards))
        result.use_cards = [
          ...new Set(
            profile.use_cards
              .map((card) => text(card, 300))
              .filter((card) => card.startsWith("character:"))
              .slice(0, 200),
          ),
        ];
      // The user's own character: read in their voice, but no state or phone contact.
      if (profile.persona) result.persona = true;
      // Brought in from MultiCast TTS: its cast row, so bringing it in again updates this person.
      if (/^[A-Za-z0-9_-]{1,80}$/.test(String(profile.multicast_id || ""))) {
        result.multicast_id = profile.multicast_id;
        // Made by the sync (not someone registered here first): it goes when its row goes.
        if (profile.multicast_made) result.multicast_made = true;
      }
      // On the phone's home screen; unset means only the first contact is.
      if (typeof profile.quick_call === "boolean") result.quick_call = profile.quick_call;
      // How readily this person reaches out first, in percent (50 when unset).
      const rate = Number(profile.contact_rate);
      if (Number.isFinite(rate) && rate !== 50)
        result.contact_rate = Math.round(Math.min(100, Math.max(0, rate)));
      for (const field of ["voice_id", "thought_voice_id"])
        if (result[field] && !/^[a-zA-Z0-9_-]+$/.test(result[field]))
          throw new UserError(
            "목소리 ID에는 영문·숫자·밑줄·하이픈만 사용할 수 있습니다.",
          );
      return [key, result];
    }),
  );
}
// What a person has; a card entry with any of these (and not set to one voice) is kept even
// when nothing else is set on it.
export const PERSON_FIELDS = [
  "aliases",
  "engine",
  "voice_id",
  "thought_voice_id",
  "expressiveness",
  "language",
  "contact_rate",
  "phone_hidden",
  "quick_call",
  "always_tags",
  "gender",
];
export function cardHoldsPerson(entry = {}, note = "") {
  if (!entry || entry.single_voice) return false;
  return (
    Boolean(String(note || "").trim()) ||
    PERSON_FIELDS.some((field) =>
      field === "engine"
        ? entry.engine && entry.engine !== "inherit"
        : entry[field] !== undefined && entry[field] !== "",
    )
  );
}
/**
 * Whether a global person takes part in this bot card: switched on for it, or used in every card
 * (no list: people kept from before, when a shared MultiCast person came in that way). A persona
 * the same way: switched on for a card, it is the voice of my own messages there.
 */
export function globalUsedIn(entry = {}, cardKey = "") {
  return !Array.isArray(entry.use_cards) || entry.use_cards.includes(cardKey);
}

const nameKey = (value) => String(value || "").trim().toLowerCase();
export const personNames = (entry = {}) =>
  [entry.name, ...String(entry.aliases || "").split(/[,，、/|]/)].map(nameKey).filter(Boolean);

/**
 * The global person a bot card stands for: one in use there whose name or alias is the card's
 * name (a card "나나미 켄토" and a global 나나미 켄토 used across cards). Such a card reads in that
 * person's voice and is not a person of its own. Returns [key, entry] or null.
 */
export function cardStandIn(voices = {}, cardKey = "", names = []) {
  const wanted = new Set(names.map(nameKey).filter(Boolean));
  if (!wanted.size) return null;
  return (
    Object.entries(voices).find(
      ([key, entry]) =>
        key.startsWith("speaker:") &&
        entry &&
        !entry.card &&
        !entry.persona &&
        globalUsedIn(entry, cardKey) &&
        personNames(entry).some((name) => wanted.has(name)),
    ) || null
  );
}

export function resolveVoice(settings, input) {
  const key = text(input.speaker_key, 300);
  const voices = settings.character_voices || {};
  let profile = Object.hasOwn(voices, key) ? voices[key] : null;
  // A card with no voice of its own (it only lists its people) speaks with its first person:
  // lines that fall back to the message's author.
  if (
    key.startsWith("character:") &&
    !profile?.single_voice &&
    !profile?.voice_id &&
    !profile?.thought_voice_id
  ) {
    const people = Object.entries(voices).filter(
      ([other, entry]) => other !== key && entry?.card === key && !entry.persona,
    );
    // The person named like the card when there is one, otherwise the first registered.
    const cardName = text(input.speaker_name, 120) || profile?.name || "";
    const main =
      people.find(([, entry]) => cardName && entry.name === cardName) ||
      people[0] ||
      // No people of its own: the global person named like the card.
      cardStandIn(voices, key, [profile?.name, input.speaker_name]);
    if (main) profile = main[1];
  }
  // A person without their own voice uses their bot card's voice, then the engine default.
  const card =
    profile?.card && Object.hasOwn(voices, profile.card)
      ? voices[profile.card]
      : null;
  const pick = (entry) =>
    entry?.engine && entry.engine !== "inherit" ? entry.engine : "";
  const engine = pick(profile) || pick(card) || settings.engine;
  const section = { ...settings[engine] };
  const own = (entry) =>
    input.utterance_kind === "thought" && entry?.thought_voice_id
      ? entry.thought_voice_id
      : entry?.voice_id;
  const cardEngine = pick(card) || settings.engine;
  const fromCard = cardEngine === engine ? own(card) : "";
  const voice = own(profile) || fromCard;
  const voiceField = engine === "fish" ? "reference_id" : "voice_id";
  if (voice) section[voiceField] = voice;
  else {
    // No voice of their own: the default voice for their gender when one is set.
    const gender = ["male", "female"].includes(profile?.gender)
      ? profile.gender
      : ["male", "female"].includes(input.voice_gender)
        ? input.voice_gender
        : "";
    if (gender && section[`${voiceField}_${gender}`])
      section[voiceField] = section[`${voiceField}_${gender}`];
    // Gender unknown and no older single default: the female default, else the male one.
    else if (!section[voiceField])
      section[voiceField] = section[`${voiceField}_female`] || section[`${voiceField}_male`] || "";
  }
  const pull = RANGE_PULL[profile?.expressiveness] || 0;
  // Steady end first: `pull` > 0 goes that much of the way to it, < 0 toward the loose end.
  const toward = (value, steady, loose) =>
    pull > 0 ? value + (steady - value) * pull : value + (loose - value) * -pull;
  if (pull && engine === "elevenlabs")
    section.stability = clampTo(toward(Number(section.stability ?? 0.5), 1, 0), 0, 1);
  if (pull && engine === "fish")
    section.temperature = clampTo(toward(Number(section.temperature ?? 0.7), 0.1, 1), 0.1, 1);
  return {
    settings: { ...settings, engine, [engine]: section },
    always_tags: Array.isArray(profile?.always_tags) ? profile.always_tags : [],
    // Where the voice came from: the person, their card, or the engine's default voice.
    voice_from: own(profile) ? "person" : fromCard ? "card" : "default",
    speaker_key: key,
    speaker_name: profile?.name || text(input.speaker_name, 120),
    utterance_kind: input.utterance_kind === "thought" ? "thought" : "dialogue",
  };
}
