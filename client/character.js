// 인물 정보와 상태 추적: the open card's profile for prompts, and each person's state, asked of
// the helper model every few replies and saved in rounds.
import {
  dataBlock,
  PROMPT_VERSION,
  stateFinal,
  stateSystem,
  userPrompt,
} from "./prompts.js";
import { escapeHtml, stripMarkup, clamp, simpleHash } from "./common.js";
import { contentKey } from "../shared/hash.js";
import { personNames } from "../shared/casting.js";

// A reply that is cut off or isn't valid JSON.
class StateReplyError extends Error {}

export const character = {
  getCurrentCharacterProfile() {
    const context = window.SillyTavern?.getContext?.() || {};
    const characterId = context.characterId;
    const character =
      characterId !== undefined && characterId !== null
        ? context.characters?.[characterId]
        : null;
    if (character) {
      const identity = String(
        character.avatar ||
          characterId ||
          character.name ||
          context.name2 ||
          "character",
      );
      return {
        key: `character:${identity}`,
        name: String(character.name || context.name2 || "현재 캐릭터"),
        avatarUrl:
          character.avatar && character.avatar !== "none"
            ? `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`
            : "",
      };
    }
    if (context.groupId !== undefined && context.groupId !== null) {
      return {
        key: `group:${context.groupId}`,
        name: String(context.name2 || "현재 그룹"),
        avatarUrl: "",
      };
    }
    return {
      key: "default",
      name: String(context.name2 || "기본 캐릭터"),
      avatarUrl: "",
    };
  },

  getRoleplayProfileContext({ includeUser = true, includeCharacter = true } = {}) {
    const context = window.SillyTavern?.getContext?.() || {};
    const characterId = context.characterId;
    const character =
      characterId !== undefined && characterId !== null
        ? context.characters?.[characterId]
        : null;
    const card =
      character?.data && typeof character.data === "object"
        ? character.data
        : character || {};
    const fullDescription = (value) =>
      typeof value === "string" ? value.trim() : "";
    const characterProfile = {
      name: String(
        character?.name || card?.name || context.name2 || "현재 캐릭터",
      ).slice(0, 160),
      description: includeCharacter
        ? fullDescription(card?.description ?? character?.description)
        : "",
    };
    Object.keys(characterProfile).forEach((key) => {
      if (!characterProfile[key]) delete characterProfile[key];
    });

    const profileContext = { character: characterProfile };
    if (includeUser) {
      const powerUser = context.powerUserSettings || {};
      const userProfile = {
        name: String(context.name1 || "User").slice(0, 160),
        description: fullDescription(powerUser.persona_description),
      };
      Object.keys(userProfile).forEach((key) => {
        if (!userProfile[key]) delete userProfile[key];
      });
      profileContext.user = userProfile;
    }
    return profileContext;
  },

  /** For phone prompts the persona is `user_character`, a fictional person, not the user. */
  phoneRoleplayProfile() {
    const { user, ...profile } = this.getRoleplayProfileContext();
    return user ? { ...profile, user_character: user } : profile;
  },

  userCharacterName() {
    return String(window.SillyTavern?.getContext?.()?.name1 || "User").slice(0, 160);
  },

  characterAvatarMarkup() {
    const profile = this.getCurrentCharacterProfile();
    return `<div class="sv-phone-avatar">${
      profile.avatarUrl
        ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.name)}">`
        : '<i class="fa-solid fa-user"></i>'
    }</div>`;
  },

  getCurrentCharacterNote() {
    const profile = this.getCurrentCharacterProfile();
    const notes =
      this.config.character_notes &&
      typeof this.config.character_notes === "object"
        ? this.config.character_notes
        : {};
    return { ...profile, note: String(notes[profile.key] || "").trim() };
  },

  getStateIdentity() {
    const character = this.getCurrentCharacterProfile();
    return {
      chatId: String(this.currentChatId()),
      characterKey: character.key,
      characterName: character.name,
    };
  },

  /**
   * Where a person's state is saved in this chat. A card that is a person keeps the key its
   * state had before people were tracked one by one.
   */
  stateKeyFor(personKey, chatId = String(this.currentChatId())) {
    return `state-${simpleHash(`${chatId}|${personKey}`)}`;
  },

  /** The chat's record of the last state update round (no history): when it ran and for whom. */
  stateRoundKey(chatId = String(this.currentChatId())) {
    return `state-round-${simpleHash(chatId)}`;
  },

  /**
   * People whose state is tracked: the phone's contacts, hidden ones too (the open chat's cards
   * that are people, the people registered under them, and the global people), never personas.
   */
  statePeople() {
    const voices = this.config.character_voices || {};
    return this.phoneContacts({ includeHidden: true })
      .filter((contact) => !voices[contact.key]?.persona && !voices[contact.key]?.no_state)
      .map((contact) => {
        const card = contact.cardKey;
        const ownCard = card === contact.key;
        return {
          key: contact.key,
          name: contact.name,
          aliases: String(voices[contact.key]?.aliases || ""),
          // A card's messages carry the card's name, which may differ from the person's.
          author: ownCard ? this.cardInfo(card).name : "",
          note: contact.note,
          avatarUrl: contact.avatarUrl,
          hidden: contact.hidden,
          stateKey: this.stateKeyFor(contact.key),
        };
      });
  },

  /** Names a person goes by: their name and each alias, as written (for finding them in text). */
  spokenNames(person) {
    return [person.name, ...String(person.aliases || "").split(/[,，、/|]/)]
      .map((name) => name.trim())
      .filter((name) => name && name !== "이름 없음");
  },

  /**
   * Whether a name appears in text. Latin names must stand as whole words. Other scripts match
   * anywhere (particles follow names directly), but a one-character name only on its own or
   * before a particle, so 준 is found in "준이 왔다" and not in "준비".
   */
  nameInText(text, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/[A-Za-z]/.test(name))
      return (
        name.length > 1 &&
        new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text)
      );
    if (name.length > 1) return text.includes(name);
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}]|[이가은는을를의도와과랑아야에한께만はがをにのともへさちく])`,
      "u",
    ).test(text);
  },

  /** People the given chat messages show: they wrote one (as their card) or are named in one. */
  peopleInChat(people, messages) {
    return people.filter((person) => {
      const names = this.spokenNames(person);
      return messages.some(
        (message) =>
          (person.author && message.speaker === person.author) ||
          names.some(
            (name) => message.speaker === name || this.nameInText(String(message.text || ""), name),
          ),
      );
    });
  },

  /** An AI reply: a character's message with text (not the user's, not a system or hidden one). */
  isReply(message) {
    return Boolean(
      message && !message.is_user && !message.is_system && String(message.mes || "").trim(),
    );
  },

  /** Index of the latest AI reply, or -1. */
  /**
   * The chat moved on from the reply a state update was asked at (`latestIndex`): a reply is
   * being written now, or one came since.
   */
  chatMovedOn(latestIndex) {
    const writing = this.generatingSince && Date.now() - this.generatingSince < 180000;
    return Boolean(writing) || this.latestReplyIndex() !== latestIndex;
  },

  latestReplyIndex() {
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1)
      if (this.isReply(chat[index])) return index;
    return -1;
  },

  /** Who was in the scene at an update round (older round records list updated and unchanged). */
  roundPresent(round) {
    const data = round?.state || {};
    return Array.isArray(data.present)
      ? data.present
      : [...(data.updated || []), ...(data.unchanged || [])];
  },

  /**
   * Whose whereabouts the model has called unknown (older round records: everyone not in the
   * scene).
   */
  roundUnknown(round) {
    const data = round?.state || {};
    if (Array.isArray(data.unknown)) return data.unknown;
    const present = this.roundPresent(round);
    return (data.asked || []).filter((key) => !present.includes(key));
  },

  /**
   * What is known of a person now. `away`: not in the scene at the last update, so they know only
   * the scenes they were in. `unknown`: nobody knows where they are or what they are doing,
   * because the model said so when they left or as time passed, or because no state was ever
   * saved. A state written by hand after the last update counts as known. Before any update
   * there is nothing to go on, and a saved state simply counts.
   */
  stateStatus(key, record, round = null) {
    const none = !record?.state;
    if (!round) return { unknown: false, away: false, none };
    const edited = !none && String(record.updated_at || "") > String(round.updated_at || "");
    const present = this.roundPresent(round);
    // A key the person had before being made again (MultiCast 연동, registered anew) is theirs.
    const inScene =
      present.includes(key) || present.some((old) => old !== key && this.livePersonKey?.(old) === key);
    // A state written by hand since says where they are: with the user is in the scene.
    const presence = edited ? record.state.contact?.presence : "";
    return {
      unknown: !edited && (none || this.roundUnknown(round).includes(key)),
      away: presence === "together" ? false : presence === "apart" ? true : !inScene,
      none,
    };
  },

  /**
   * Whether the message a saved state was built from is still in the chat with the same text,
   * even if it moved. A deleted or edited message, or another swipe, no longer counts.
   */
  stateSourceLive(sourceMessageId) {
    const [position, hash] = String(sourceMessageId || "").split("-");
    if (!/^[0-9a-f]{64}$/.test(hash || "")) return true;
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const index = Number(position);
    if (Number.isInteger(index) && chat[index] && this.messageHash(chat[index]) === hash)
      return true;
    return chat.some((message) => this.isReply(message) && this.messageHash(message) === hash);
  },

  /** A chat message's text hash as states name their source by it (kept: it's plain-JS SHA-256). */
  messageHash(message) {
    const text = String(message?.mes ?? "");
    this.messageHashes ||= new Map();
    let value = this.messageHashes.get(text);
    if (!value) {
      if (this.messageHashes.size > 4000) this.messageHashes.clear();
      value = simpleHash(stripMarkup(text));
      this.messageHashes.set(text, value);
    }
    return value;
  },

  async loadStateHistory(stateKey, limit = 100) {
    const response = await this.fetch(
      this.apiUrl(
        `/api/plugins/scenevoice/state/history?state_key=${encodeURIComponent(stateKey)}&limit=${limit}`,
      ),
      { cache: "no-store" },
    );
    return response.ok ? (await response.json()).items || [] : [];
  },

  /**
   * A saved state as prompts use it. One built from a message that is no longer in the chat is
   * not used; the newest state whose message is still there stands in (nothing is deleted).
   */
  async loadStateRecord(stateKey, { live = true } = {}) {
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/state?state_key=${encodeURIComponent(stateKey)}`,
        ),
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.found) return null;
      if (live && !this.stateSourceLive(data.source_message_id)) {
        const older = (await this.loadStateHistory(stateKey)).find((item) =>
          this.stateSourceLive(item.source_message_id),
        );
        return older ? { ...older, found: true, replaced: true } : null;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 캐릭터 상태를 읽지 못했습니다.", error);
      return null;
    }
  },

  /** A person's state. */
  async loadPersonState(person) {
    if (!person?.stateKey) return null;
    const record =
      (await this.loadStateRecord(person.stateKey)) ||
      ((await this.adoptOldState(person)) ? await this.loadStateRecord(person.stateKey) : null);
    return record ? { ...record, state_key: person.stateKey } : null;
  },

  /**
   * A person with no state yet who was made again (deleted and registered anew, MultiCast 연동):
   * the state this chat kept under their old key — a key nobody has now, saved under their name
   * or an alias — becomes theirs, history and all. Looked for once per person and chat.
   */
  async adoptOldState(person) {
    this.stateAdoptTried ||= new Set();
    const tried = `${this.currentChatId()}|${person.key}`;
    if (this.stateAdoptTried.has(tried)) return false;
    this.stateAdoptTried.add(tried);
    try {
      const response = await this.fetch(
        this.apiUrl(`/api/plugins/scenevoice/states?chat_id=${encodeURIComponent(this.currentChatId())}`),
        { cache: "no-store" },
      );
      if (!response.ok) return false;
      const voices = this.config.character_voices || {};
      const names = personNames({ name: person.name, aliases: person.aliases });
      const old = ((await response.json()).items || [])
        .filter(
          (item) =>
            item.state_key !== person.stateKey &&
            String(item.character_key || "").startsWith("speaker:") &&
            !voices[item.character_key] &&
            names.includes(String(item.character_name || "").trim().toLowerCase()),
        )
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      if (!old) return false;
      const moved = await this.request("/api/plugins/scenevoice/state/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(this.currentChatId()),
          from: old.state_key,
          to: person.stateKey,
          character_key: person.key,
          character_name: person.name,
        }),
      });
      return moved.ok;
    } catch (error) {
      console.warn("[SceneVoice] old state not carried over", error);
      return false;
    }
  },

  /** The state of one tracked person (the first one by default). */
  async loadCurrentState(key = "") {
    const people = this.statePeople();
    const person = people.find((item) => item.key === key) || (key ? null : people[0]);
    return person ? this.loadPersonState(person) : null;
  },

  loadStateRound() {
    return this.loadStateRecord(this.stateRoundKey(), { live: false });
  },

  /**
   * What prompts get about a person: their state (`away` when they aren't in the scene), or only
   * that their whereabouts are unknown (see stateStatus). Null when nothing is tracked for them.
   */
  async stateForPrompt(key) {
    const person = this.statePeople().find((item) => item.key === key);
    if (!person) return null;
    const [record, round] = await Promise.all([
      this.loadPersonState(person),
      this.loadStateRound(),
    ]);
    const status = this.stateStatus(key, record, round);
    if (status.unknown) return { unknown: true };
    return record?.state ? { state: record.state, away: status.away } : null;
  },

  /**
   * The <state> block for a person's call or message. `absent`: they aren't in the scene;
   * `unknown`: nobody knows where they are, so the block says only that.
   */
  stateBlocks(found) {
    if (!found) return { blocks: [], absent: false, unknown: false };
    return found.unknown
      ? { blocks: [dataBlock("state", { unknown_whereabouts: true })], absent: true, unknown: true }
      : { blocks: [dataBlock("state", found.state)], absent: Boolean(found.away), unknown: false };
  },

  /**
   * States of these people as of a chat message, for reading it: for each, the newest state
   * built from a message at or before it that is still in the chat.
   */
  async statesAtMessage(index, keys) {
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const sourceOf = (item) => {
      const [position, hash] = String(item.source_message_id).split("-");
      const source = Number(position);
      const message = chat[source];
      return Number.isInteger(source) &&
        source <= index &&
        message &&
        hash === this.messageHash(message)
        ? source
        : -1;
    };
    const result = [];
    for (const person of this.statePeople().filter((item) => keys.includes(item.key))) {
      const item = (await this.loadStateHistory(person.stateKey)).find((entry) => sourceOf(entry) >= 0);
      if (item) result.push({ key: person.key, name: person.name, state: item.state });
    }
    return result;
  },

  /**
   * States for reading a message: of the people its lines are credited to and the people it
   * names, as of that message (see statesAtMessage).
   */
  async loadStatesForMessage(button, batch) {
    const index = Number(button.dataset.messageId);
    if (!Number.isInteger(index)) return [];
    const keys = new Set(
      batch.utterances
        .flatMap((line) => [line.default_speaker_key, line.forced_speaker_key])
        .filter(Boolean),
    );
    for (const person of this.peopleInChat(this.statePeople(), [
      { speaker: "", text: batch.currentMessage },
    ]))
      keys.add(person.key);
    return this.statesAtMessage(index, [...keys]);
  },

  /** State updates run: 상태 추적 사용, or something that needs them (먼저 연락, 엿듣는 통화). */
  stateTrackingRuns() {
    return Boolean(
      this.config.state_tracking?.enabled || this.autoCallOn() || this.autoTextOn() || this.overheardCallsOn(),
    );
  },

  scheduleStateTracking(force = false) {
    clearTimeout(this.stateScanTimer);
    if (this.config.active === false) return;
    if (!force && !this.stateTrackingRuns()) return;
    this.stateScanTimer = setTimeout(
      () =>
        this.run(async () => {
          // A reply being written (a swipe's new answer streaming in) is read once it is done:
          // its end schedules this again.
          if (!force && this.generatingSince && Date.now() - this.generatingSince < 180000) return;
          if (force || (await this.stateTrackingDue()))
            await this.trackCurrentState({ force });
        }),
      force ? 0 : 1600,
    );
  },

  /**
   * Automatic updates run every N new AI replies (state_tracking.every_messages), counted from
   * the last update round. A rewritten or swiped reply that round was built from is re-read
   * right away.
   */
  async stateTrackingDue() {
    if (!this.hasCharacterChat()) return false;
    // Only the first message (the greeting, before the user says anything): left to 지금 분석, so
    // opening a new chat doesn't start an update (and a call) at once.
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    if (!chat.some((message) => message?.is_user && !message.is_system)) return false;
    const every = Math.max(1, Number(this.config.state_tracking?.every_messages) || 1);
    const latest = this.latestReplyIndex();
    if (latest < 0) return false;
    const round = await this.loadStateRound();
    const last = Number(String(round?.source_message_id || "").split("-")[0]);
    if (!round || !Number.isInteger(last) || last > latest) return true;
    if (!this.stateSourceLive(round.source_message_id)) return true;
    return this.assistantMessagesSince(last, latest) >= every;
  },

  /** The last `count` chat messages (no upper limit: a request too big is cut when sent). */
  buildRecentChatContext(count = 8) {
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const size = Math.max(1, Math.floor(Number(count)) || 1);
    return chat.slice(-size).map((message, offset) => ({
      index: Math.max(0, chat.length - size) + offset,
      speaker: String(message.name || (message.is_user ? "User" : "Character")),
      role: message.is_user ? "user" : "character",
      text: stripMarkup(message.mes || ""),
    }));
  },

  parseJsonObject(response) {
    let current = response;
    const domainKeys = new Set([
      "state",
      "character_state",
      "current_state",
      "physical",
      "emotional",
      "cognitive",
      "social",
      "summary",
      "utterances",
      "text",
      "dialogue",
      "line",
      "emotion",
      "language",
      "action_candidate",
      "action_candidates",
      "side_call",
      "voice_memo",
      "lines",
      "people",
    ]);
    for (let depth = 0; depth < 6; depth += 1) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        if (Object.keys(current).some((key) => domainKeys.has(key)))
          return current;
        const next =
          current.content ??
          current.message?.content ??
          current.choices?.[0]?.message?.content ??
          current.choices?.[0]?.text ??
          current.output_text ??
          current.output ??
          current.response ??
          current.data;
        if (next === undefined || next === current) break;
        current = next;
        continue;
      }
      if (Array.isArray(current)) {
        current = current
          .map((item) => {
            if (typeof item === "string") return item;
            return (
              item?.text ?? item?.content ?? item?.value ?? JSON.stringify(item)
            );
          })
          .join("\n");
      }
      break;
    }
    const cleaned = String(current ?? "")
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {
      /* 설명이 붙은 JSON은 아래에서 다시 찾는다. */
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start)
      throw new Error("보조 모델 응답에서 JSON을 찾지 못했습니다.");
    return JSON.parse(cleaned.slice(start, end + 1));
  },

  normalizeCharacterState(raw) {
    const source =
      raw?.state && typeof raw.state === "object"
        ? raw.state
        : raw?.character_state && typeof raw.character_state === "object"
          ? raw.character_state
          : raw?.current_state && typeof raw.current_state === "object"
            ? raw.current_state
            : raw;
    const firstValue = (object, keys) => {
      for (const key of keys) {
        if (object?.[key] !== undefined && object?.[key] !== null)
          return object[key];
      }
      return undefined;
    };
    const cleanSection = (value, keys) => {
      if (value === undefined || value === null || value === "") return {};
      if (typeof value !== "object")
        return { summary: String(value).trim().slice(0, 500) };
      if (Array.isArray(value))
        return { summary: value.map(String).join(", ").trim().slice(0, 500) };
      const section = value;
      const result = {};
      keys.forEach((key) => {
        if (section[key] === undefined || section[key] === null) return;
        result[key] =
          typeof section[key] === "number"
            ? clamp(section[key], 0, 1)
            : String(section[key]).trim().slice(0, 500);
      });
      if (!Object.keys(result).length) {
        const compact = Object.values(section)
          .filter((item) => item !== undefined && item !== null && item !== "")
          .map((item) =>
            typeof item === "object" ? JSON.stringify(item) : String(item),
          )
          .join(" / ")
          .trim();
        if (compact) result.summary = compact.slice(0, 500);
      }
      return result;
    };
    const state = {
      physical: cleanSection(
        firstValue(source, [
          "physical",
          "physical_state",
          "physicalStatus",
          "신체",
          "신체상태",
        ]),
        ["condition", "injuries", "energy", "location", "summary"],
      ),
      emotional: cleanSection(
        firstValue(source, [
          "emotional",
          "emotional_state",
          "emotion",
          "mood",
          "감정",
          "감정상태",
        ]),
        ["primary", "secondary", "intensity", "summary"],
      ),
      cognitive: cleanSection(
        firstValue(source, [
          "cognitive",
          "cognitive_state",
          "mental",
          "thoughts",
          "인지",
          "생각",
        ]),
        ["focus", "intention", "concern", "summary"],
      ),
      social: cleanSection(
        firstValue(source, [
          "social",
          "social_state",
          "relationship",
          "사회",
          "관계",
        ]),
        ["relationship", "attitude", "interaction", "summary"],
      ),
      summary: String(
        firstValue(source, [
          "summary",
          "overall_summary",
          "overall",
          "요약",
          "현재상태",
        ]) || "",
      )
        .trim()
        .slice(0, 1200),
    };
    if (!state.summary) {
      state.summary = [
        state.physical,
        state.emotional,
        state.cognitive,
        state.social,
      ]
        .map(
          (section) =>
            section.summary ||
            Object.values(section)
              .filter((item) => typeof item === "string")
              .join(", "),
        )
        .filter(Boolean)
        .join(" / ")
        .slice(0, 1200);
    }
    const contact = source?.contact && typeof source.contact === "object" ? source.contact : {};
    state.contact = {
      presence: this.contactWord(contact.presence, ["together", "apart"]),
      availability: this.contactWord(contact.availability, ["free", "busy", "asleep"]),
      note: String(contact.note || "").trim().slice(0, 300),
    };
    return state;
  },

  hasCharacterStateContent(state) {
    return Boolean(
      state?.summary ||
      ["physical", "emotional", "cognitive", "social"].some(
        (key) => state?.[key] && Object.keys(state[key]).length,
      ),
    );
  },

  /**
   * What the state prompt says about each person: everyone's previous state (their last known
   * one), marked unknown_whereabouts when nobody knows where they are now, and no_phone for
   * someone hidden from the phone, who can't reach out.
   */
  statePeopleData(batch, records, statuses) {
    return batch.map((person) => ({
      key: person.key,
      name: person.name,
      ...(person.aliases ? { aliases: person.aliases } : {}),
      ...(person.note ? { performance_note: person.note } : {}),
      ...(person.hidden ? { no_phone: true } : {}),
      ...(statuses.get(person.key)?.unknown ? { unknown_whereabouts: true } : {}),
      previous_state: records.get(person.key)?.state || null,
    }));
  },

  /** `decide`: the people of this request are also judged on reaching out first. */
  stateMessages(batch, round, decide) {
    return [
      {
        role: "system",
        content: stateSystem({
          contactContext: round.contactContext,
          contactEnabled: decide,
          contactTypes: round.contactTypes,
          language: round.language,
          sideCalls: round.sideCalls,
          voiceMemos: round.voiceMemos,
        }),
      },
      {
        role: "user",
        content: userPrompt(
          [
            dataBlock("profile", round.roleplayProfile),
            dataBlock("people", this.statePeopleData(batch, round.records, round.statuses)),
            dataBlock("recent_chat", round.recent),
            dataBlock("recent_calls", round.contactContext.recent),
          ],
          stateFinal(),
        ),
      },
    ];
  },

  /**
   * The result for each person the reply names: `present` (in the scene), a new `state` when
   * something changed, and `unknown` when the model says nobody knows any more where they are.
   * Those left out changed in nothing. A reply that is cut off, isn't JSON or has no people list
   * throws a StateReplyError.
   */
  parseStateReply(response, batch) {
    let parsed;
    try {
      parsed = this.parseJsonObject(response);
    } catch (error) {
      throw new StateReplyError(error.message);
    }
    let items = Array.isArray(parsed?.people) ? parsed.people : null;
    // One person in the older shape ({"state":…}) still counts.
    if (!items && batch.length === 1 && parsed?.state && typeof parsed.state === "object")
      items = [{ key: batch[0].key, state: parsed.state }];
    if (!items && batch.length)
      throw new StateReplyError("상태 응답에 인물 목록이 없습니다.");
    const results = new Map();
    for (const item of items || []) {
      const person =
        batch.find((entry) => entry.key === item?.key) ||
        batch.find((entry) => entry.name === (item?.name || item?.key));
      if (!person || results.has(person.key)) continue;
      const unknown = item.unknown_whereabouts === true;
      // Older answers had no present flag: a named person was in the scene.
      const present = typeof item.present === "boolean" ? item.present : !unknown;
      const state =
        !item.unchanged && item.state && typeof item.state === "object"
          ? this.normalizeCharacterState(item.state)
          : null;
      results.set(person.key, {
        present,
        ...(state && this.hasCharacterStateContent(state) ? { state } : {}),
        ...(unknown && !present ? { unknown: true } : {}),
      });
    }
    return {
      results,
      action_candidates: this.normalizeActionCandidates(parsed),
      side_call: this.normalizeSideCall(parsed),
      voice_memo: this.normalizeVoiceMemo?.(parsed) || null,
      failed: [],
    };
  },

  /**
   * One state request. A broken reply is asked for once more with a format reminder (`retry`).
   * New states count at once for the requests that follow in the same round.
   */
  async askStateBatch(batch, round, { retry = true, decide = false } = {}) {
    const messages = this.stateMessages(batch, round, decide);
    const send = (list) => {
      this.assertChat(round.operation);
      return this.connectionService.sendRequest(
        round.profileId,
        this.connectionService.constructPrompt
          ? this.connectionService.constructPrompt(list, round.profileId)
          : list,
        450 + 450 * Math.max(1, batch.length),
        {
          stream: false,
          extractData: true,
          includePreset: false,
          includeInstruct: true,
        },
        { temperature: 0.15 },
      );
    };
    let reply;
    try {
      reply = this.parseStateReply(await send(messages), batch);
    } catch (error) {
      if (!(error instanceof StateReplyError) || !retry) throw error;
      const again = messages.map((message, index) =>
        index === 0
          ? {
              ...message,
              content: `${message.content}\n\nFORMAT RETRY: the previous reply was cut off or was not valid JSON. Return exactly one complete, valid JSON object in the format above, with each person you return listed once, double-quoted keys and strings, short text values, and nothing outside it.`,
            }
          : message,
      );
      reply = this.parseStateReply(await send(again), batch);
    }
    for (const [key, result] of reply.results)
      if (result.state) {
        round.records.set(key, { state: result.state, source_message_id: round.sourceMessageId });
        round.statuses.set(key, { unknown: false, away: !result.present, none: false });
      } else if (result.unknown)
        round.statuses.set(key, { ...round.statuses.get(key), unknown: true, away: true });
    return reply;
  },

  /**
   * Asks about everyone at once; when the reply stays broken the people are split in half and
   * each half asked on its own, down to one person. Each request judges its own people on
   * reaching out (`decide`), and their candidates are put together.
   * A person still left out brings one notice per session to raise the output limit.
   */
  async requestStateBatch(batch, ask, { retry = true, decide = false } = {}) {
    try {
      return await ask(batch, { retry, decide });
    } catch (error) {
      if (!(error instanceof StateReplyError)) throw error;
      if (batch.length < 2) {
        console.warn("[SceneVoice] 상태 응답이 잘렸거나 형식이 깨졌습니다.", error);
        if (batch.length && !this.stateOutputNoticeShown) {
          this.stateOutputNoticeShown = true;
          this.notify(
            `상태 분석 응답이 잘리거나 형식이 깨져 ${batch[0].name}의 상태를 갱신하지 못했습니다. 설정 → 보조모델 분석 → 최대 출력 토큰을 늘려 보십시오.`,
            "warning",
          );
        }
        return {
          results: new Map(),
          action_candidates: [],
          side_call: null,
          voice_memo: null,
          failed: batch.map((person) => person.key),
        };
      }
      const half = Math.ceil(batch.length / 2);
      const first = await this.requestStateBatch(batch.slice(0, half), ask, { retry: false, decide });
      const second = await this.requestStateBatch(batch.slice(half), ask, { retry: false, decide });
      return {
        results: new Map([...first.results, ...second.results]),
        action_candidates: [...first.action_candidates, ...second.action_candidates],
        side_call: first.side_call || second.side_call,
        voice_memo: first.voice_memo || second.voice_memo,
        failed: [...first.failed, ...second.failed],
      };
    }
  },

  async saveStateRecord(stateKey, { key = "", name = "" }, sourceMessageId, state, history = true) {
    const response = await this.fetch(this.apiUrl("/api/plugins/scenevoice/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state_key: stateKey,
        chat_id: String(this.currentChatId()),
        character_key: key,
        character_name: name,
        source_message_id: sourceMessageId,
        state,
        ...(history ? {} : { history: false }),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `상태 저장 실패 (${response.status})`);
    return data;
  },

  /**
   * One request with every tracked person and their previous state. The model reads the recent
   * chat and names the people in the scene (with a new state when something changed), and those
   * who left or whose situation changed while away: a new state when the story says where they
   * are, or unknown whereabouts when it doesn't. Everyone else, and their marks, stay as they are.
   */
  async trackCurrentState({ force = false } = {}) {
    const operation = this.captureChat();
    if (this.stateTrackingBusy || (!force && !this.stateTrackingRuns())) return null;
    const profileId =
      this.config.state_tracking?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    if (!profileId || !this.connectionService) {
      if (force)
        this.notify(
          "상태 분석에 사용할 실리태번 연결 프로필을 먼저 선택해 주십시오.",
          "error",
        );
      return null;
    }
    // ST's welcome chat ("SillyTavern System") and other chats without a character have no people.
    if (!this.hasCharacterChat()) {
      if (force) this.notify("캐릭터 채팅을 연 뒤에 분석할 수 있습니다.", "info");
      return null;
    }

    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const latestIndex = this.latestReplyIndex();
    if (latestIndex < 0) return null;
    const people = this.statePeople();
    const recent = this.buildRecentChatContext(
      this.config.state_tracking?.context_messages ?? 8,
    );
    const roleplayProfile = this.getRoleplayProfileContext();
    // States are kept in English whatever the chat's language: one language for the prompts that
    // read them, and no drifting between rounds when the chat's language is judged differently.
    const language = "en";
    const sourceMessageId = `${latestIndex}-${simpleHash(stripMarkup(chat[latestIndex]?.mes || ""))}-${contentKey({ version: PROMPT_VERSION, profile: this.connectionService?.fingerprint?.(profileId) || profileId, people: people.map(({ key, name, aliases, note }) => ({ key, name, aliases, note })), roles: roleplayProfile, llm: this.config.llm, language, context: recent })}`;
    const roundKey = this.stateRoundKey();
    const sourceKey = `${roundKey}|${sourceMessageId}`;
    if (!force && sourceKey === this.lastStateTrackingSource)
      return this.lastStateRound;
    const previous = await this.loadStateRound();
    if (!force && previous?.source_message_id === sourceMessageId) {
      this.lastStateTrackingSource = sourceKey;
      this.lastStateRound = { source_message_id: sourceMessageId, ...previous.state };
      return this.lastStateRound;
    }

    this.stateTrackingBusy = true;
    try {
      // What was known at the last update: who was away, whose whereabouts were unknown.
      const records = new Map();
      const statuses = new Map();
      const loaded = await Promise.all(people.map((person) => this.loadPersonState(person)));
      people.forEach((person, index) => {
        records.set(person.key, loaded[index]);
        statuses.set(person.key, this.stateStatus(person.key, loaded[index], previous));
      });
      const contactEnabled = Boolean(
        this.autoCallOn() || this.autoTextOn(),
      );
      const round = {
        operation,
        profileId,
        people,
        records,
        statuses,
        recent,
        roleplayProfile,
        language,
        sourceMessageId,
        contactContext: await this.loadRecentCallContext(latestIndex),
        contactTypes: [
          ...(this.autoCallOn() ? ["incoming_call"] : []),
          ...(this.autoTextOn() ? ["text_message", "voice_message"] : []),
        ],
        // 엿듣는 통화: two people phoning each other, judged in the same request.
        sideCalls: this.overheardCallsOn() && people.filter((person) => !person.hidden).length > 1,
        // 음성 메모: someone recording one for themselves, judged in the same request too.
        voiceMemos: Boolean(this.autoMemosOn?.()),
      };
      const outcome = { updated: [], unchanged: [], failed: [] };
      const present = [];
      // Unknown whereabouts carry on until the model (or a hand edit) says otherwise.
      const unknown = new Set(
        people
          .filter((person) => statuses.get(person.key).unknown && records.get(person.key)?.state)
          .map((person) => person.key),
      );
      let candidates = [];
      let sideCall = null;
      let voiceMemo = null;
      if (people.length) {
        const reply = await this.requestStateBatch(
          people,
          (part, options) => this.askStateBatch(part, round, options),
          { decide: contactEnabled },
        );
        this.assertChat(operation);
        for (const person of people) {
          const result = reply.results.get(person.key);
          if (!result) {
            // Left out: nothing changed. Someone who couldn't be read keeps where they were.
            if (reply.failed.includes(person.key)) {
              outcome.failed.push(person.key);
              if (!statuses.get(person.key).away) present.push(person.key);
            }
            continue;
          }
          if (result.state) {
            await this.saveStateRecord(person.stateKey, person, sourceMessageId, result.state);
            outcome.updated.push(person.key);
          }
          if (result.present) {
            present.push(person.key);
            unknown.delete(person.key);
            if (!result.state) outcome.unchanged.push(person.key);
          } else if (result.unknown) unknown.add(person.key);
          // Left to a place the story names: known again.
          else if (result.state) unknown.delete(person.key);
        }
        candidates = reply.action_candidates;
        sideCall = reply.side_call;
        voiceMemo = reply.voice_memo;
      }
      const asked = people.map((person) => person.key);
      const summary = { asked, present, unknown: [...unknown], ...outcome };
      await this.saveStateRecord(roundKey, {}, sourceMessageId, summary, false);
      this.lastStateTrackingSource = sourceKey;
      this.lastStateRound = { source_message_id: sourceMessageId, ...summary };
      // Whose whereabouts nobody knows now, saved state or not.
      const unknownNow = new Set(
        asked.filter((key) => unknown.has(key) || !records.get(key)?.state),
      );
      // Each person's state sheet as it stands now: the contact decision goes by what it shows.
      const sheets = new Map(asked.map((key) => [key, records.get(key)?.state?.contact]));
      // Its contact decisions belong to that moment: with a reply being written by now (or one
      // written since), a call would cut in from a point already passed, so the next update
      // judges again.
      if (this.chatMovedOn(latestIndex)) this.lastContactDecisions = [];
      else {
        await this.handleActionCandidates(candidates, sourceMessageId, round.contactContext, unknownNow, sheets);
        if (sideCall) await this.handleSideCall(sideCall, sourceMessageId, sheets);
        if (voiceMemo) await this.handleVoiceMemo(voiceMemo, sourceMessageId, sheets);
      }
      if (force) {
        const names = (keys) =>
          keys.map((key) => people.find((person) => person.key === key)?.name || key).join(", ");
        this.notify(
          outcome.updated.length
            ? `${names(outcome.updated)}의 상태를 갱신했습니다.`
            : outcome.failed.length
              ? "상태를 갱신하지 못했습니다."
              : outcome.unchanged.length
                ? "바뀐 상태가 없습니다."
                : "최근 채팅에서 새로 드러난 게 없어 바뀐 상태가 없습니다.",
          outcome.updated.length ? "success" : "info",
        );
      }
      if (document.querySelector('#sv-panel[data-tab="state"]'))
        this.renderState();
      return this.lastStateRound;
    } catch (error) {
      if (operation.signal.aborted) return null;
      console.warn("[SceneVoice] 캐릭터 상태 분석 실패", error);
      if (force)
        this.notify(
          error.message || "캐릭터 상태를 분석할 수 없습니다.",
          "error",
        );
      return null;
    } finally {
      if (!operation.signal.aborted) this.stateTrackingBusy = false;
    }
  },
};
