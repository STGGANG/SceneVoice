// 스마트폰 연락처: the people from 화자 설정 as phone contacts, with pictures, quick calls and
// per-card hiding.
import { escapeHtml } from "./common.js";
import { SPEECH_LANGUAGES, elevenModelTraits } from "../shared/settings.js";
import { resolveVoice, globalUsedIn, cardStandIn, personNames } from "../shared/casting.js";

// Speakers registered per bot card double as phone contacts.
// A card key ("character:<avatar>") holds the card's own voice; other entries may name
// the card they belong to with `card`. Entries without `card` are shared by every chat.

export const contacts = {
  /** A character or group chat is open (not ST's own welcome chat, "SillyTavern System"). */
  hasCharacterChat() {
    const context = window.SillyTavern?.getContext?.() || {};
    if (context.groupId !== undefined && context.groupId !== null) return true;
    return (
      context.characterId !== undefined &&
      context.characterId !== null &&
      Boolean(context.characters?.[context.characterId])
    );
  },

  /** Cards of the open chat: the group members in a group chat, otherwise the one card. */
  currentCardKeys() {
    const context = window.SillyTavern?.getContext?.() || {};
    if (context.groupId !== undefined && context.groupId !== null) {
      const group = (context.groups || []).find(
        (item) => String(item.id) === String(context.groupId),
      );
      const members = (group?.members || []).map(
        (avatar) => `character:${avatar}`,
      );
      if (members.length) return members;
    }
    return [this.getCurrentCharacterProfile().key];
  },

  cardInfo(key) {
    const context = window.SillyTavern?.getContext?.() || {};
    const avatar = String(key || "").startsWith("character:")
      ? key.slice("character:".length)
      : "";
    const card = avatar
      ? (context.characters || []).find((item) => item.avatar === avatar)
      : null;
    if (!card) {
      const current = this.getCurrentCharacterProfile();
      return key === current.key
        ? { name: current.name, avatarUrl: current.avatarUrl, description: "" }
        : { name: key, avatarUrl: "", description: "" };
    }
    return {
      name: String(card.name || avatar),
      avatarUrl:
        card.avatar && card.avatar !== "none"
          ? `/thumbnail?type=avatar&file=${encodeURIComponent(card.avatar)}`
          : "",
      description: String(card.data?.description || card.description || ""),
    };
  },

  /** The people registered under a card, in the order they were added; personas only on request. */
  cardPeople(cardKey, { personas = false, voices = this.config.character_voices || {} } = {}) {
    return Object.entries(voices)
      .filter(
        ([key, entry]) =>
          key !== cardKey && entry?.card === cardKey && (personas || !entry.persona),
      )
      .map(([key]) => key);
  },

  /** People registered for every chat (not under a card). */
  globalPeople({ voices = this.config.character_voices || {} } = {}) {
    return Object.entries(voices)
      .filter(([key, entry]) => key.startsWith("speaker:") && !entry?.card)
      .map(([key]) => key);
  },

  /**
   * A global person takes part in a chat (contact, state, speaker; a persona: my own voice) only
   * where switched on for one of its bot cards (a new one: the card open when it was added), or
   * everywhere when it has no list.
   */
  globalInUse(entry = {}, cards = this.currentCardKeys()) {
    return cards.some((card) => globalUsedIn(entry, card));
  },

  /** The bot cards a global person is switched on for, spelled out (one used everywhere: all known cards). */
  globalUseList(entry = {}) {
    if (Array.isArray(entry.use_cards)) return entry.use_cards;
    const context = window.SillyTavern?.getContext?.() || {};
    return [
      ...new Set([
        ...Object.keys(this.config.character_voices || {}).filter((key) => key.startsWith("character:")),
        ...(context.characters || []).map((card) => `character:${card.avatar}`),
      ]),
    ].slice(0, 200);
  },

  /**
   * Who my own messages and texts speak as in the open chat: the persona person of its bot card
   * (the one named like my current persona first), else a global persona switched on for this
   * card (이 봇카드에서 사용), else one used in every card that is named like my persona or the
   * only one, else the old shared "user" voice.
   */
  personaKey() {
    const context = window.SillyTavern?.getContext?.() || {};
    const me = String(context.name1 || "").trim().toLowerCase();
    const cards = this.currentCardKeys();
    const personas = Object.entries(this.config.character_voices || {}).filter(
      ([key, entry]) => key.startsWith("speaker:") && entry?.persona,
    );
    const named = ([, entry]) => Boolean(me) && personNames(entry).includes(me);
    const own = personas.filter(([, entry]) => entry.card && cards.includes(entry.card));
    const global = personas.filter(([, entry]) => !entry.card && this.globalInUse(entry, cards));
    const chosen = global.filter(([, entry]) => Array.isArray(entry.use_cards));
    const everywhere = global.filter(([, entry]) => !Array.isArray(entry.use_cards));
    const found =
      own.find(named) ||
      own[0] ||
      chosen.find(named) ||
      chosen[0] ||
      everywhere.find(named) ||
      (everywhere.length === 1 ? everywhere[0] : null);
    return found ? found[0] : "user";
  },

  /** The global person this card stands for (named like it, in use here), or null. */
  cardStandIn(cardKey) {
    return cardStandIn(this.config.character_voices || {}, cardKey, [
      this.config.character_voices?.[cardKey]?.name,
      this.cardInfo(cardKey).name,
    ]);
  },

  /**
   * The card itself counts as a person (a contact, someone whose state is tracked) only when it
   * reads everything with one voice, or when no people are registered under it yet and no
   * global person named like it stands for it.
   */
  cardIsPerson(cardKey) {
    if (this.config.character_voices?.[cardKey]?.single_voice === true) return true;
    return !this.cardPeople(cardKey).length && !this.cardStandIn(cardKey);
  },

  /**
   * Phone contacts for the open chat: the people of its cards (a card itself when it is one),
   * then the global people. Without a character chat open there are none.
   */
  phoneContacts({ includeHidden = false } = {}) {
    if (!this.hasCharacterChat()) return [];
    const list = [];
    const add = (key) => {
      if (!list.some((contact) => contact.key === key)) list.push(this.phoneContact(key));
    };
    for (const cardKey of this.currentCardKeys()) {
      if (this.cardIsPerson(cardKey)) add(cardKey);
      this.cardPeople(cardKey).forEach(add);
    }
    for (const key of this.globalPeople()) {
      const entry = this.config.character_voices?.[key] || {};
      if (!entry.persona && this.globalInUse(entry)) add(key);
    }
    return includeHidden ? list : list.filter((item) => !item.hidden);
  },

  /**
   * The person a saved record means (a room's member, a message's sender) when the key it kept is
   * gone — the person was made again under another key (MultiCast 연동, registered anew): the
   * person here now by that name or alias, or by another name the same old key was saved with in
   * a room. Keys still in use, cards and unknown names stay as they are.
   */
  livePersonKey(key, name = "") {
    const voices = this.config.character_voices || {};
    if (!key || voices[key] || !String(key).startsWith("speaker:")) return key;
    // Worked out again when the people or the rooms (which keep other names) change.
    if (
      this.liveKeysFor !== voices ||
      this.liveKeysRooms !== this.messageGroups ||
      this.liveKeysNames !== this.senderNamesVersion
    ) {
      this.liveKeysFor = voices;
      this.liveKeysRooms = this.messageGroups;
      this.liveKeysNames = this.senderNamesVersion;
      this.liveKeys = new Map();
    }
    const memo = `${key}\n${name}`;
    if (this.liveKeys.has(memo)) return this.liveKeys.get(memo);
    const names = new Set(
      [
        name,
        ...(this.messageGroups || [])
          .flatMap((group) => group.members || [])
          .filter((member) => member.key === key)
          .map((member) => member.name),
        // Other names the same key was sent under (one message may carry the newer spelling).
        ...(this.senderNames?.get(key) || []),
      ]
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean),
    );
    // This chat's people first, then anyone registered.
    const order = [...this.phoneContacts({ includeHidden: true }).map((contact) => contact.key), ...Object.keys(voices)];
    const found = order.find(
      (item) => item.startsWith("speaker:") && voices[item] && personNames(voices[item]).some((alias) => names.has(alias)),
    );
    this.liveKeys.set(memo, found || key);
    return found || key;
  },

  /** Hidden from the phone: a card or a card's person switched to hidden (a global person is on or off per card instead). */
  contactHidden(key) {
    const entry = this.config.character_voices?.[key] || {};
    return Boolean((entry.card || key.startsWith("character:")) && entry.phone_hidden);
  },

  /** On the home screen for a quick call: those switched on, and the first contact unless switched off. */
  isQuickCall(key, contacts = this.phoneContacts()) {
    const set = this.config.character_voices?.[key]?.quick_call;
    return typeof set === "boolean" ? set : contacts[0]?.key === key;
  },

  quickCallContacts() {
    const contacts = this.phoneContacts();
    return contacts.filter((contact) => this.isQuickCall(contact.key, contacts));
  },

  phoneContact(key) {
    const voices = this.config.character_voices || {};
    const notes = this.config.character_notes || {};
    const entry = voices[key] || {};
    const ownerKey = key?.startsWith?.("character:") ? key : entry.card || "";
    const owner = ownerKey ? this.cardInfo(ownerKey) : null;
    // Without a card (persona, shared people, a group with no member list) use the profile itself.
    const self = owner || this.cardInfo(key);
    const persona = window.SillyTavern?.getContext?.()?.name1 || "사용자";
    return {
      key,
      cardKey: ownerKey,
      name: String(
        entry.name ||
          (key === "user" ? persona : key.startsWith("speaker:") ? "" : self.name) ||
          "이름 없음",
      ),
      note: String(notes[key] || "").trim(),
      description: owner?.description || "",
      avatarUrl: entry.avatar || this.defaultAvatar(key),
      hidden: this.contactHidden(key),
    };
  },

  /**
   * A picture chosen on the phone, cropped to a square and shrunk to at most 256 px (WebP, or
   * JPEG where WebP can't be written), then stored. Returns its URL.
   */
  async uploadAvatar(file) {
    if (!/^image\//.test(file?.type || "")) throw new Error("사진 파일을 골라 주십시오.");
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
        element.src = url;
      });
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const size = Math.max(1, Math.min(256, side));
      // A tall picture is cut near its top, where a face usually is; a wide one in the middle.
      const left = (image.naturalWidth - side) / 2;
      const top = (image.naturalHeight - side) * 0.12;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas
        .getContext("2d")
        .drawImage(
          image,
          left,
          top,
          side,
          side,
          0,
          0,
          size,
          size,
        );
      let dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const [head, data] = dataUrl.split(",");
      const response = await this.request("/api/plugins/scenevoice/avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: head.slice(5, head.indexOf(";")), data }),
      }, 30000);
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.detail || "사진을 저장하지 못했습니다.");
      return saved.url;
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /** A picture without one chosen: a card's own, and the card's for its person of the same name. */
  defaultAvatar(key) {
    const entry = this.config.character_voices?.[key] || {};
    if (!key?.startsWith?.("speaker:")) return this.cardInfo(key).avatarUrl || "";
    if (!entry.card) return "";
    const owner = this.cardInfo(entry.card);
    return entry.name && entry.name === owner.name ? owner.avatarUrl || "" : "";
  },

  /** How readily a person reaches out first, in percent (set per person in the speaker editor). */
  contactRate(key) {
    const rate = Number(this.config.character_voices?.[key]?.contact_rate);
    return Number.isFinite(rate) ? rate : 50;
  },

  /** The voice engine a person speaks with: their own, their card's, then the default. */
  speakerEngine(key) {
    const voices = this.config.character_voices || {};
    const pick = (entry) =>
      entry?.engine && entry.engine !== "inherit" ? entry.engine : "";
    return pick(voices[key]) || pick(voices[voices[key]?.card]) || this.config.engine;
  },

  /**
   * Sound effects in this person's calls and voice messages: the sound files there are to choose
   * from ({ mine, library }; any voice can use them), or true for ElevenLabs v4 tags, or false.
   */
  phoneSoundEffects(key) {
    if (this.config.elevenlabs?.sound_effects !== true) return false;
    const choices = this.soundChoices?.();
    return choices && choices.mine.length + choices.library.length ? choices : this.soundEffectsFor(key);
  },

  /** Sound-effect tags are on and this person speaks with ElevenLabs. */
  soundEffectsFor(key) {
    return (
      this.config.elevenlabs?.sound_effects === true &&
      this.config.elevenlabs?.use_audio_tags !== false &&
      elevenModelTraits(this.config.elevenlabs?.model).tags &&
      this.speakerEngine(key) === "elevenlabs"
    );
  },

  /**
   * The line would be read with a voice registered for this person (or their card), not the
   * engine's default. When nobody has a voice of their own, everyone counts as voiced.
   */
  speakerHasVoice(key, kind = "dialogue") {
    const voices = this.config.character_voices || {};
    const anyone = Object.values(voices).some((entry) => entry?.voice_id || entry?.thought_voice_id);
    if (!anyone) return true;
    return (
      resolveVoice(this.config, { speaker_key: key, utterance_kind: kind }).voice_from !== "default"
    );
  },

  /** No voice at all for this line: none of the person's, the card's or a default one. */
  speakerVoiceMissing(key, kind = "dialogue", gender = "", name = "") {
    const resolved = resolveVoice(this.config, {
      speaker_key: key,
      speaker_name: name,
      utterance_kind: kind,
      voice_gender: gender,
    });
    const section = resolved.settings[resolved.settings.engine] || {};
    return !section[resolved.settings.engine === "fish" ? "reference_id" : "voice_id"];
  },

  /** Left out of 음성 준비 and playing in a row (skip switch, or play buttons hidden). */
  speakerSkipped(key) {
    const entry = this.config.character_voices?.[key] || {};
    return Boolean(entry.skip_voice || entry.hide_button);
  },

  /** This person's card lets them know the real date and time in calls and texts. */
  realtimeFor(key) {
    const voices = this.config.character_voices || {};
    return Boolean(voices[key]?.realtime || voices[voices[key]?.card]?.realtime);
  },

  /** "2026-10-09 (금) 22:47" in the user's local time. */
  realTimeLabel(value = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} (${weekday}) ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  /** The language set for a person (or their card); "" follows the general setting. */
  personLanguage(key) {
    const voices = this.config.character_voices || {};
    const pick = (entry) =>
      SPEECH_LANGUAGES.includes(entry?.language) ? entry.language : "";
    return pick(voices[key]) || pick(voices[voices[key]?.card]);
  },

  /** The emotional range set for a person: one of five steps from very_restrained to very_expressive. */
  emotionalRange(key) {
    return this.config.character_voices?.[key]?.expressiveness || "normal";
  },

  contactAvatarMarkup(contact) {
    if (contact?.avatarUrl)
      return `<div class="sv-phone-avatar"><img src="${escapeHtml(contact.avatarUrl)}" alt="${escapeHtml(contact.name)}"></div>`;
    const initial = Array.from(String(contact?.name || "?").trim())[0] || "?";
    return `<div class="sv-phone-avatar sv-avatar-initial" aria-hidden="true">${escapeHtml(initial)}</div>`;
  },
};
