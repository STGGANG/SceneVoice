import { stripMarkup, clamp, stOf } from "./common.js";
import { RANDOM_OUTREACH_BASE } from "../shared/settings.js";

// 선연락: whether people call or text first after the state update says it would fit
// (the helper model's candidates, each person's contact habit, call cooldowns), and the ring.
// The 스마트폰 사용 switch gates all of it.

// How urgency and being busy scale a person's habit of reaching out, and the most it can reach.
export const URGENCY_WEIGHT = { low: 0.85, medium: 1, high: 1.6 };
export const BUSY_WEIGHT = 0.5;
export const CHANCE_CAP = 0.95;
// Someone who reached out within this many of the state updates before is held back (halved),
// unless it is urgent; and no more than this many people get through at once (one call among
// them at most), whichever way they are chosen.
const RECENT_ROUNDS = 2;
export const RECENT_WEIGHT = 0.5;
export const CONTACTS_PER_ROUND = 2;
// 랜덤 연락: of the dice that hit, how often it is a call (the rest are texts), how often a text
// is a voice message instead, how memos and overheard calls scale against the base chance, and
// the AI replies between two overheard calls.
const RANDOM_CALL_SHARE = 0.25;
const RANDOM_VOICE_SHARE = 0.2;
export const RANDOM_EXTRA_WEIGHT = 1;
const RANDOM_OVERHEARD_GAP = 6;
/** Chance per new AI reply that a person of this habit reaches out (랜덤 연락). */
export const randomChance = (level, rate = 50) =>
  Math.min(
    CHANCE_CAP,
    (RANDOM_OUTREACH_BASE[level] ?? RANDOM_OUTREACH_BASE.normal) *
      (clamp(rate, 0, 100) / 50),
  );

/**
 * 랜덤·시간: how someone the dice picked reaches out. A call only while nobody else calls in
 * the same round; "" when nothing they could do is switched on.
 */
export function diceContactType(app, callTaken = false) {
  const texts = app.autoTextOn();
  if (
    app.autoCallOn() &&
    !callTaken &&
    (!texts || Math.random() < RANDOM_CALL_SHARE)
  )
    return "incoming_call";
  if (!texts) return "";
  return Math.random() < RANDOM_VOICE_SHARE ? "voice_message" : "text_message";
}

/**
 * 랜덤·시간: the people the dice picked reach out, the call first (with 상황에 맞을 때만 its
 * opening line is written first, and may be a pass), the texts one after another. `decisions`: {person, type}, kept for the 상태 tab.
 */
export async function sendDiceContacts(
  app,
  decisions,
  { fit, reason = "", sourceMessageId },
) {
  if (!decisions.length) return;
  app.lastContactDecisions = decisions.map(
    ({ person, type, rate, chance }) => ({
      at: new Date().toISOString(),
      callerKey: person.key,
      caller: person.name,
      type,
      rate,
      ...(chance === undefined ? {} : { chance }),
      reached: true,
      held: false,
      random: true,
    }),
  );
  for (const [index, { person, type }] of decisions.entries()) {
    if (type !== "incoming_call") continue;
    const first = fit ? await app.prewriteIncomingCall(person, reason) : null;
    if (first?.pass === true) app.lastContactDecisions[index].passed = true;
    else
      await app.ringIncomingCall(
        {
          candidate: {
            type,
            caller_key: person.key,
            urgency: "medium",
            reason:
              String(first?.reason || "")
                .replace(/[<>]/g, " ")
                .trim()
                .slice(0, 500) || reason,
          },
          callerKey: person.key,
          caller: person.name,
          prewritten: first,
        },
        sourceMessageId,
      );
  }
  const texts = decisions.filter((item) => item.type !== "incoming_call");
  for (const { person, type } of texts)
    app.incomingTexts.push({
      type,
      callerKey: person.key,
      reason,
      mayPass: fit,
      sourceMessageId,
      createdAt: new Date().toISOString(),
    });
  if (texts.length)
    app
      .drainIncomingTexts()
      .catch((error) => console.warn("[SceneVoice] 문자 대기열 중단", error));
}

export const outreach = {
  /**
   * 스마트폰 사용 (설정 → 스마트폰). Off: no phone, no floating button or wand entry, no call
   * banner, and nobody calls or texts first; saved calls, texts and chat memories stay.
   */
  phoneOn() {
    return (
      this.config.active !== false && this.config.phone?.app_enabled !== false
    );
  },

  /**
   * People reach out first here: 선연락 사용 is on, and so is 선연락 받기 on a bot card of
   * this chat (each card's own switch, off until set).
   */
  outreachOn() {
    if (!this.phoneOn() || this.config.outreach?.enabled !== true) return false;
    const voices = this.config.character_voices || {};
    return (this.currentCardKeys?.() || []).some(
      (key) => key.startsWith("character:") && voices[key]?.outreach === true,
    );
  },

  /**
   * How people come to reach out: judged by the state update ("state"), by dice after each chat
   * reply ("random"), or as real time passes ("time"). Their settings are kept for all three.
   */
  outreachMode() {
    // The open bot card's own choice comes first (캐릭터 → 봇카드 공통 설정 → 스마트폰).
    const voices = this.config.character_voices || {};
    const own = (this.currentCardKeys?.() || [])
      .map((key) => voices[key])
      .find((card) => card?.outreach === true && card.outreach_mode);
    const mode = own?.outreach_mode || this.config.outreach?.mode;
    return mode === "random" || mode === "time" ? mode : "state";
  },

  /**
   * 연락하지 않는 시간 (a bot card's own, 캐릭터 → 봇카드 공통 설정 → 스마트폰): now, by the
   * clock of where the card's people live, falls in it. Nobody reaches out by dice or by time
   * then; what I start myself is answered as ever.
   */
  quietHours(now = new Date()) {
    const voices = this.config.character_voices || {};
    return (this.currentCardKeys?.() || []).some((key) => {
      const { quiet_from: from, quiet_to: to } = voices[key] || {};
      if (!from || !to || from === to) return false;
      let clock;
      try {
        clock = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          ...(this.timeZoneFor(key) ? { timeZone: this.timeZoneFor(key) } : {}),
        }).format(now);
      } catch {
        return false;
      }
      // Over midnight (23:00 ~ 07:00) the time lies on either side of it.
      return from < to
        ? clock >= from && clock < to
        : clock >= from || clock < to;
    });
  },

  /** 먼저 전화하기 / 먼저 문자 보내기: the switches over what hangs on each. */
  callsFirstOn() {
    return this.outreachOn() && Boolean(this.config.phone?.auto_enabled);
  },

  textsFirstOn() {
    return this.outreachOn() && Boolean(this.config.voice_message?.enabled);
  },

  /** 나에게 전화: people phone me first. */
  autoCallOn() {
    return this.callsFirstOn() && this.config.phone?.call_me !== false;
  },

  /** 나에게 문자: people text me first, and start talking in rooms I am in. */
  autoTextOn() {
    return this.textsFirstOn() && this.config.voice_message?.text_me !== false;
  },

  /** 엿듣는 통화: now and then two people of the story phone each other. */
  overheardCallsOn() {
    return this.callsFirstOn() && this.config.phone?.overheard_calls === true;
  },

  /** 엿보는 문자: rooms without me talk by themselves. */
  overheardTextsOn() {
    return (
      this.textsFirstOn() && this.config.voice_message?.overheard_texts === true
    );
  },

  /**
   * 스스로 대화하기: people open rooms among themselves and text there when the story gives
   * them a reason, not on a schedule.
   */
  selfTextsOn() {
    return (
      this.overheardTextsOn() && this.config.voice_message?.rooms_self === true
    );
  },

  scheduleRandomOutreach() {
    clearTimeout(this.randomOutreachTimer);
    if (this.config.active === false || this.outreachMode() !== "random")
      return;
    this.randomOutreachTimer = setTimeout(
      () =>
        this.run(async () => {
          // A reply still being written is rolled for once it is done (its end comes here again).
          if (
            this.generatingSince &&
            Date.now() - this.generatingSince < 180000
          )
            return;
          await this.randomOutreachTick();
        }),
      1800,
    );
  },

  /**
   * 랜덤 연락: once for each new AI reply, everyone who can reach out rolls on their own
   * (the base chance of 공통 연락 빈도 × their 선연락 빈도 / 50); the first two to get through call
   * or text (one call at most). No request is made until
   * then, and no state is kept or read: where people are is left to 상황에 맞을 때만. Memos,
   * overheard calls and people texting each other roll apart, at RANDOM_EXTRA_WEIGHT × the base.
   */
  async randomOutreachTick() {
    if (!this.hasCharacterChat()) return;
    const chatId = this.currentChatId();
    const latest = this.latestReplyIndex();
    const seen = this.randomOutreachSeen;
    this.randomOutreachSeen = { chatId, latest };
    // A chat just opened, or the same reply again (an edit, a swipe), is not a new reply.
    if (
      !seen ||
      seen.chatId !== chatId ||
      latest <= seen.latest ||
      this.randomOutreachBusy ||
      // 연락하지 않는 시간 of this card.
      this.quietHours()
    )
      return;
    if (this.onlyGreeting()) return;
    const chat = stOf(this)?.chat || [];
    const people = this.statePeople().filter((person) => !person.hidden);
    if (!people.length) return;
    const settings = this.config.outreach || {};
    const sourceMessageId = `${latest}-${this.messageHash(chat[latest])}`;
    this.randomOutreachBusy = true;
    try {
      const shuffled = (list) => [...list].sort(() => Math.random() - 0.5);
      this.lastContactDecisions = [];
      if (this.autoCallOn() || this.autoTextOn())
        await this.randomContact(shuffled(people), sourceMessageId);
      const extra = randomChance(settings.random_level) * RANDOM_EXTRA_WEIGHT;
      if (this.autoMemosOn?.() && Math.random() < extra) {
        const person = shuffled(people)[0];
        if (person)
          await (
            this.twice
              ? this.twice(() =>
                  this.writeVoiceMemo(person, "", sourceMessageId, {
                    origin: "auto",
                  }),
                )
              : this.writeVoiceMemo(person, "", sourceMessageId, {
                  origin: "auto",
                })
          ).catch((error) => {
            if (error.name === "AbortError") throw error;
            console.warn("[SceneVoice] 음성 메모 자동 생성 실패", error);
          });
      }
      if (this.overheardCallsOn() && Math.random() < extra) {
        const pair = shuffled(people);
        const since = pair.length > 1 ? await this.repliesSinceOverheard() : 0;
        if (
          pair.length > 1 &&
          (since === null || since >= RANDOM_OVERHEARD_GAP)
        )
          await (this.twice
            ? this.twice(() =>
                this.writeOverheardCall(pair[0], pair[1], "", sourceMessageId),
              )
            : this.writeOverheardCall(pair[0], pair[1], "", sourceMessageId));
      }
      if (
        this.selfTextsOn() &&
        people.length > 1 &&
        Math.random() < extra &&
        this.selfTalkDue?.()
      )
        await this.selfTalkTick().catch((error) => {
          if (error.name === "AbortError") throw error;
          console.warn("[SceneVoice] 인물끼리 문자 실패", error);
        });
    } finally {
      this.randomOutreachBusy = false;
    }
  },

  /** A call ringing or going on: nobody else can call now, but a text still comes. */
  onCall() {
    return Boolean(
      this.phonePendingEvent || this.phoneSession || this.otherLineBusy?.(),
    );
  },

  /**
   * The dice for a call or a text: of `people`, the first CONTACTS_PER_ROUND to get through
   * reach out, one call among them at most (none while I am on a call).
   */
  async randomContact(people, sourceMessageId) {
    const settings = this.config.outreach || {};
    // A text of theirs still being written: this round is left out.
    if (this.voiceMessageBusy || this.incomingTexts.length) return;
    const decisions = [];
    for (const person of people) {
      if (decisions.length >= CONTACTS_PER_ROUND) break;
      const rate = this.contactRate(person.key);
      const chance = randomChance(settings.random_level, rate);
      if (Math.random() >= chance) continue;
      const type = diceContactType(
        this,
        this.onCall() ||
          decisions.some((item) => item.type === "incoming_call"),
      );
      if (!type) break;
      decisions.push({ person, type, rate, chance });
    }
    await sendDiceContacts(this, decisions, {
      fit: settings.random_fit !== false,
      sourceMessageId,
    });
  },

  /**
   * 상황에 맞을 때만: a dice call's opening line is written before it rings, in the one request
   * that also decides whether a call makes sense now. Returns the model's answer (`pass: true`
   * when it doesn't), or null when it couldn't be asked: the call rings and is written as usual.
   */
  async prewriteIncomingCall(person, reason = "") {
    try {
      const parsed = await this.generateCharacterPhoneTurn({
        opening: true,
        preview: {
          id: "",
          character_key: person.key,
          character_name: person.name,
          call_direction: "incoming",
          situation: reason,
          turns: [],
        },
      });
      if (parsed?.pass === true) return { pass: true };
      return String(parsed?.text || "").trim() ? parsed : null;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 전화 미리 쓰기 실패", error);
      return null;
    }
  },

  contactWord(value, allowed) {
    const word = String(value || "").toLowerCase();
    return allowed.includes(word) ? word : "unknown";
  },

  /**
   * Chance that a suggested contact really happens: never while asleep; otherwise the caller's
   * habit (contact_rate %) scaled by urgency, halved while busy. Being with the user's character
   * doesn't count against it: the model names only people who would reach out, and a state that
   * says "together" beside such a naming has turned out to be the part that is wrong.
   */
  contactChance(candidate, rate = 50) {
    if (!candidate || candidate.type === "none") return 0;
    if (candidate.availability === "asleep") return 0;
    const urgency = URGENCY_WEIGHT[candidate.urgency] || 0;
    const busy = candidate.availability === "busy" ? BUSY_WEIGHT : 1;
    return Math.min(CHANCE_CAP, (clamp(rate, 0, 100) / 100) * urgency * busy);
  },

  /** The people the state update says would reach out now (an older reply: its one candidate). */
  normalizeActionCandidates(raw) {
    const list = Array.isArray(raw?.action_candidates)
      ? raw.action_candidates
      : raw?.action_candidate && typeof raw.action_candidate === "object"
        ? [raw.action_candidate]
        : [];
    return list
      .filter((item) => item && typeof item === "object")
      .map((item) => this.normalizeActionCandidate(item))
      .filter((item) => item.type !== "none")
      .slice(0, 12);
  },

  /** The call between two people the state update suggests (side_call), or null. */
  normalizeSideCall(raw) {
    const source = raw?.side_call;
    if (!source || typeof source !== "object") return null;
    const caller = String(source.caller_key || "").slice(0, 300);
    const callee = String(source.callee_key || "").slice(0, 300);
    if (!caller || !callee || caller === callee) return null;
    return {
      caller_key: caller,
      callee_key: callee,
      reason: String(source.reason || "")
        .replace(/[<>]/g, " ")
        .trim()
        .slice(0, 500),
    };
  },

  /** The people the state update says would text each other now (side_text), or null. */
  normalizeSideText(raw) {
    const source = raw?.side_text;
    if (!source || typeof source !== "object") return null;
    const keys = [
      ...new Set(
        (Array.isArray(source.member_keys) ? source.member_keys : [])
          .map((key) => String(key || "").slice(0, 300))
          .filter(Boolean),
      ),
    ].slice(0, 12);
    if (keys.length < 2) return null;
    return {
      member_keys: keys,
      room_name: String(source.room_name || "")
        .replace(/[<>]/g, " ")
        .trim()
        .slice(0, 60),
    };
  },

  /**
   * 스스로 대화하기 with 인물별 상태 추적: the state update named people who would text each
   * other now. All of them tracked and none asleep (their sheets), they do (see selfTalk).
   */
  async handleSideText(sideText, sheets = new Map()) {
    if (!sideText || !this.selfTextsOn() || !this.hasCharacterChat()) return;
    const people = this.statePeople().filter((person) => !person.hidden);
    const members = people.filter((person) =>
      sideText.member_keys.includes(person.key),
    );
    if (members.length < 2 || members.length !== sideText.member_keys.length)
      return;
    if (
      members.some(
        (person) => (sheets.get(person.key) || {}).availability === "asleep",
      )
    )
      return;
    await this.selfTalk(members, sideText.room_name);
  },

  normalizeActionCandidate(source = {}) {
    const type = ["incoming_call", "voice_message", "text_message"].includes(
      String(source.type || "").toLowerCase(),
    )
      ? String(source.type).toLowerCase()
      : "none";
    // Older answers only had confidence; map it onto urgency.
    let urgency = String(source.urgency || "").toLowerCase();
    if (!["none", "low", "medium", "high"].includes(urgency)) {
      const confidence = clamp(source.confidence ?? 0, 0, 1);
      urgency =
        confidence >= 0.85
          ? "high"
          : confidence >= 0.72
            ? "medium"
            : confidence >= 0.5
              ? "low"
              : "none";
    }
    return {
      type: urgency === "none" ? "none" : type,
      caller_key: String(source.caller_key || "").slice(0, 300),
      presence: this.contactWord(source.presence, ["together", "apart"]),
      availability: this.contactWord(source.availability, [
        "free",
        "busy",
        "asleep",
      ]),
      urgency,
      reason: String(source.reason || "")
        .replace(/[<>]/g, " ")
        .trim()
        .slice(0, 500),
    };
  },

  /** Two short rings (when 벨소리 is on); the banner shows the call either way. */
  playIncomingTone() {
    if (!this.config.phone?.ringtone) return;
    this.playTones(
      [
        [0, 620, 620, 0.25],
        [0.34, 690, 690, 0.25],
      ],
      0.08,
    );
  },

  assistantMessagesSince(anchorIndex, currentIndex) {
    const chat = stOf(this)?.chat || [];
    if (!Number.isInteger(anchorIndex)) return 0;
    const end = Number.isInteger(currentIndex)
      ? Math.min(currentIndex, chat.length - 1)
      : chat.length - 1;
    return chat
      .slice(Math.max(0, anchorIndex + 1), end + 1)
      .filter((message) => this.isReply(message)).length;
  },

  summarizePhoneSession(session) {
    const statusLabels = {
      ended: "종료",
      rejected: "거절",
      missed: "부재중",
      active: "통화 중",
      ringing: "수신 대기",
    };
    const direction =
      session.call_direction === "incoming"
        ? "캐릭터가 건 전화"
        : "사용자가 건 전화";
    const turns = (session.turns || []).slice(-4).map((turn) => ({
      speaker: `${turn.role === "user" ? "사용자" : "캐릭터"}${turn.voicemail ? "(음성 사서함)" : ""}`,
      text: stripMarkup(turn.text || "").slice(0, 240),
    }));
    return {
      character: session.character_name || "",
      direction,
      result: statusLabels[session.status] || session.status,
      summary: turns.length
        ? turns
        : session.situation
          ? [{ speaker: "맥락", text: session.situation.slice(0, 240) }]
          : [],
    };
  },

  async loadRecentCallContext(currentMessageIndex) {
    const identity = this.getStateIdentity();
    // No gap of its own between calls any more: the state update's cycle (or the dice) paces them.
    const cooldown = 0;
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(identity.chatId)}&limit=6`,
        { cache: "no-store" },
        5000,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Calls of a part of the chat that was taken back (or another swipe) don't count, nor
      // calls between two other people (엿듣는 통화).
      const sessions = this.callsForAI(
        (await response.json()).items || [],
      ).filter(
        (session) =>
          session.call_direction !== "overheard" &&
          this.anchorShown?.(session) !== false,
      );
      const latest = sessions[0] || null;
      const anchor =
        latest && /^\d+$/.test(String(latest.anchor_message_id || ""))
          ? Number(latest.anchor_message_id)
          : null;
      const messagesSince = latest
        ? this.assistantMessagesSince(anchor, currentMessageIndex)
        : cooldown;
      return {
        recent: sessions.slice(0, 4).map((session) => ({
          ...this.summarizePhoneSession(session),
          assistant_messages_since: this.assistantMessagesSince(
            /^\d+$/.test(String(session.anchor_message_id || ""))
              ? Number(session.anchor_message_id)
              : null,
            currentMessageIndex,
          ),
        })),
        messagesSince,
        remaining: latest ? Math.max(0, cooldown - messagesSince) : 0,
        allowIncoming: !latest || messagesSince >= cooldown,
      };
    } catch (error) {
      console.warn("[SceneVoice] 최근 통화 문맥을 읽지 못했습니다.", error);
      return {
        recent: [],
        messagesSince: 0,
        remaining: cooldown,
        allowIncoming: cooldown === 0,
      };
    }
  },

  /**
   * Picks who reaches out: only a tracked person on the phone (when there is one, it's them).
   * Someone whose whereabouts are unknown (`unknown`) is neither known to be with the user nor
   * asleep, so only their habit and the urgency decide.
   */
  actionCaller(candidate, unknown = new Set()) {
    const people = this.statePeople().filter((person) => !person.hidden);
    const caller =
      people.find((person) => person.key === candidate.caller_key) ||
      people.find(
        (person) =>
          candidate.caller_key && person.name === candidate.caller_key,
      ) ||
      (people.length === 1 ? people[0] : null);
    if (!caller) return null;
    return {
      caller,
      candidate: unknown.has(caller.key)
        ? { ...candidate, presence: "unknown", availability: "unknown" }
        : candidate,
    };
  },

  /**
   * Who reached out first lately: person key → assistant replies since their last incoming call,
   * text or voice message (of the chat as it is now).
   */
  async recentOutreach() {
    const since = new Map();
    const note = (key, anchor) => {
      if (!key || !/^\d+$/.test(String(anchor ?? ""))) return;
      const replies = this.assistantMessagesSince(Number(anchor));
      if (!since.has(key) || replies < since.get(key)) since.set(key, replies);
    };
    try {
      const [response, items] = await Promise.all([
        this.request(
          `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=20`,
          { cache: "no-store" },
          5000,
        ),
        this.loadMessages(),
      ]);
      const sessions = response.ok ? (await response.json()).items || [] : [];
      for (const session of sessions)
        if (session.call_direction === "incoming" && this.anchorShown(session))
          note(
            this.livePersonKey(session.character_key, session.character_name),
            session.anchor_message_id,
          );
      for (const item of items)
        if (item.origin === "incoming")
          note(this.messageThreadOf(item), item.anchor_message_id);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 최근 연락을 읽지 못했습니다.", error);
    }
    return since;
  },

  /**
   * The state update's candidates: each person's chance is worked out and rolled on its own
   * (their habit × urgency, halved while busy, nothing while asleep; halved
   * again when they reached out lately, unless it is urgent). Of those who get through, one call
   * at most rings (the likeliest) and two people at most reach out in all; their texts and voice
   * messages are written one after another (see drainIncomingTexts).
   * `sheets`: each person's state.contact now; it (what the 상태 tab shows) decides whether
   * they are busy or asleep, over what the candidate said.
   */
  async handleActionCandidates(
    candidates,
    sourceMessageId,
    contactContext = null,
    unknown = new Set(),
    sheets = new Map(),
  ) {
    this.lastContactDecisions = [];
    if (!candidates?.length || !this.hasCharacterChat()) return;
    const callFree =
      !this.phonePendingEvent &&
      !this.phoneSession &&
      contactContext?.allowIncoming !== false;
    const recentReplies =
      clamp(this.config.state_tracking?.every_messages ?? 3, 1, 20) *
      RECENT_ROUNDS;
    // With one person who can reach out there is nobody to make room for: no holding back.
    const recent =
      this.statePeople().filter((person) => !person.hidden).length > 1
        ? await this.recentOutreach()
        : new Map();
    const decisions = [];
    for (const raw of candidates) {
      if (
        raw.type === "incoming_call"
          ? !this.autoCallOn() || !callFree
          : !this.autoTextOn()
      )
        continue;
      const picked = this.actionCaller(raw, unknown);
      if (
        !picked ||
        decisions.some((item) => item.callerKey === picked.caller.key)
      )
        continue;
      const { caller } = picked;
      let candidate = picked.candidate;
      const sheet = unknown.has(caller.key) ? null : sheets.get(caller.key);
      if (sheet) {
        const presence = this.contactWord(sheet.presence, [
          "together",
          "apart",
        ]);
        const availability = this.contactWord(sheet.availability, [
          "free",
          "busy",
          "asleep",
        ]);
        candidate = {
          ...candidate,
          ...(presence !== "unknown" ? { presence } : {}),
          ...(availability !== "unknown" ? { availability } : {}),
        };
      }
      const rate = this.contactRate(caller.key);
      const lately =
        recent.has(caller.key) &&
        recent.get(caller.key) < recentReplies &&
        candidate.urgency !== "high";
      const chance =
        this.contactChance(candidate, rate) * (lately ? RECENT_WEIGHT : 1);
      decisions.push({
        at: new Date().toISOString(),
        callerKey: caller.key,
        caller: caller.name,
        candidate,
        type: candidate.type,
        rate,
        urgency: candidate.urgency,
        presence: candidate.presence,
        availability: candidate.availability,
        lately,
        chance,
        reached: Math.random() < chance,
        held: false,
      });
    }
    // The likeliest first; one call, and no more than CONTACTS_PER_ROUND people.
    const through = decisions
      .filter((item) => item.reached)
      .sort((a, b) => b.chance - a.chance || Math.random() - 0.5);
    const call = through.find((item) => item.type === "incoming_call");
    const texts = through
      .filter((item) => item.type !== "incoming_call")
      .slice(0, CONTACTS_PER_ROUND - (call ? 1 : 0));
    for (const item of through)
      item.held = item !== call && !texts.includes(item);
    this.lastContactDecisions = decisions;
    if (call) await this.ringIncomingCall(call, sourceMessageId);
    for (const item of texts)
      this.incomingTexts.push({
        ...item.candidate,
        callerKey: item.callerKey,
        sourceMessageId,
        createdAt: new Date().toISOString(),
      });
    if (texts.length)
      this.drainIncomingTexts().catch((error) =>
        console.warn("[SceneVoice] 메시지 대기열 중단", error),
      );
  },

  /**
   * 엿듣는 통화: the state update says two people would phone each other now. With the switch on,
   * both tracked, neither with the user's character nor asleep (their sheets), and not again
   * within a few updates of the last one, it happens as often as the caller reaches out
   * (their 선연락 빈도); its lines are written in one request (writeOverheardCall).
   */
  async handleSideCall(sideCall, sourceMessageId, sheets = new Map()) {
    if (!sideCall || !this.overheardCallsOn() || !this.hasCharacterChat())
      return;
    const people = this.statePeople().filter((person) => !person.hidden);
    const caller = people.find((person) => person.key === sideCall.caller_key);
    const callee = people.find((person) => person.key === sideCall.callee_key);
    if (!caller || !callee || caller.key === callee.key) return;
    for (const key of [caller.key, callee.key]) {
      const sheet = sheets.get(key) || {};
      if (sheet.presence === "together" || sheet.availability === "asleep")
        return;
    }
    const since = await this.repliesSinceOverheard();
    if (
      since !== null &&
      since < clamp(this.config.state_tracking?.every_messages ?? 3, 1, 20) * 3
    )
      return;
    if (Math.random() >= clamp(this.contactRate(caller.key), 0, 100) / 100)
      return;
    const write = () =>
      this.writeOverheardCall(caller, callee, sideCall.reason, sourceMessageId);
    await (this.twice ? this.twice(write) : write());
  },

  /** Assistant replies since the last overheard call of the chat as it is now, or null. */
  async repliesSinceOverheard() {
    const response = await this.request(
      `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=40`,
      { cache: "no-store" },
      5000,
    );
    if (!response.ok) return null;
    const last = ((await response.json()).items || []).find(
      (session) =>
        session.call_direction === "overheard" && this.anchorShown(session),
    );
    const anchor = String(last?.anchor_message_id ?? "").match(/^\d+$/);
    return anchor ? this.assistantMessagesSince(Number(anchor[0])) : null;
  },

  /** A person's call rings: saved as ringing (anchored to the message that led to it). */
  async ringIncomingCall(
    { candidate, callerKey, caller, prewritten = null },
    sourceMessageId,
  ) {
    // One call at a time, whichever bot card it belongs to (visit.js).
    if (this.otherLineBusy?.()) return;
    const identity = this.getStateIdentity();
    const sourceIndex = String(
      this.phoneAnchorFromSource(sourceMessageId).index,
    );
    let sessionId = "";
    try {
      const made = await this.createPhoneSession({
        chat_id: identity.chatId,
        anchor_message_id: sourceIndex,
        ...this.anchorStamp(sourceIndex),
        character_key: callerKey,
        character_name: caller,
        direction: "incoming",
        status: "ringing",
        situation: candidate.reason || "",
      });
      if (made.existing) return;
      sessionId = made.session?.id || "";
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 수신 전화 기록 생성 실패", error);
      return;
    }
    this.phonePendingEvent = {
      ...candidate,
      callerKey,
      sourceMessageId,
      sessionId,
      createdAt: new Date().toISOString(),
      // The opening line, when it was written before the ring (gone after a reload: asked then).
      ...(prewritten?.text ? { prewritten } : {}),
    };
    // The phone open elsewhere stays where it is: its top bar says a call is coming in. Closed,
    // it opens on the call.
    const shell = document.getElementById("sv-smartphone");
    const shown = shell && !shell.classList.contains("hidden");
    if (!shown) {
      this.phoneActiveTab = "call";
      this.ringReturnTab = "home";
    }
    this.updatePhoneLauncherVisibility();
    this.armRingTimeout();
    // Told by the banner under the top bar, not by a toast as well.
    this.playIncomingTone();
    if (this.config.phone?.vibration && navigator.vibrate)
      navigator.vibrate([180, 120, 180]);
    if (shown) await this.renderSmartphone();
  },

  /**
   * Texts and voice messages people decided to send, written one after another with a short
   * pause between them; the chat changing (or a swipe) drops the rest.
   */
  async drainIncomingTexts() {
    const operation = this.captureChat();
    if (this.incomingDrain === operation.signal) return;
    this.incomingDrain = operation.signal;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      while (this.incomingTexts.length && !operation.signal.aborted) {
        // A message being written again (답변 재생성) finishes first.
        while (this.voiceMessageBusy && !operation.signal.aborted)
          await wait(500);
        if (operation.signal.aborted) break;
        await this.generateIncomingVoiceMessage(this.incomingTexts.shift());
        if (this.incomingTexts.length) await wait(900 + Math.random() * 900);
      }
    } finally {
      if (this.incomingDrain === operation.signal) this.incomingDrain = null;
    }
  },
};
