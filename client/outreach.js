import { stripMarkup, clamp } from "./common.js";

// 먼저 연락: whether people call or text first after the state update says it would fit
// (the helper model's candidates, each person's contact habit, call cooldowns), and the ring.
// The 스마트폰 사용 switch gates all of it.

// How urgency and being busy scale a person's habit of reaching out, and the most it can reach.
export const URGENCY_WEIGHT = { low: 0.85, medium: 1, high: 1.6 };
export const BUSY_WEIGHT = 0.5;
export const CHANCE_CAP = 0.95;
// Someone who reached out within this many of the state updates before is held back (halved),
// unless it is urgent; and no more than this many people get through in one update.
const RECENT_ROUNDS = 2;
export const RECENT_WEIGHT = 0.5;
const CONTACTS_PER_ROUND = 2;

export const outreach = {
  /**
   * 스마트폰 사용 (설정 → 전화). Off: no phone, no floating button or wand entry, no call
   * banner, and nobody calls or texts first; saved calls, texts and chat memories stay.
   */
  phoneOn() {
    return this.config.active !== false && this.config.phone?.app_enabled !== false;
  },

  autoCallOn() {
    return this.phoneOn() && Boolean(this.config.phone?.auto_enabled);
  },

  autoTextOn() {
    return this.phoneOn() && Boolean(this.config.voice_message?.enabled);
  },

  /** 엿듣는 통화 (설정 → 전화): now and then two people of the story phone each other. */
  overheardCallsOn() {
    return this.phoneOn() && this.config.phone?.overheard_calls === true;
  },

  contactWord(value, allowed) {
    const word = String(value || "").toLowerCase();
    return allowed.includes(word) ? word : "unknown";
  },

  /**
   * Chance that a suggested contact really happens: never while together or asleep; otherwise the
   * caller's habit (contact_rate %) scaled by urgency, halved while busy.
   */
  contactChance(candidate, rate = 50) {
    if (!candidate || candidate.type === "none") return 0;
    if (candidate.presence === "together" || candidate.availability === "asleep")
      return 0;
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
      reason: String(source.reason || "").replace(/[<>]/g, " ").trim().slice(0, 500),
    };
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
        confidence >= 0.85 ? "high" : confidence >= 0.72 ? "medium" : confidence >= 0.5 ? "low" : "none";
    }
    return {
      type: urgency === "none" ? "none" : type,
      caller_key: String(source.caller_key || "").slice(0, 300),
      presence: this.contactWord(source.presence, ["together", "apart"]),
      availability: this.contactWord(source.availability, ["free", "busy", "asleep"]),
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
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
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
      speaker: turn.role === "user" ? "사용자" : turn.voicemail ? "캐릭터(음성 사서함)" : "캐릭터",
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
    const cooldown = clamp(
      this.config.phone?.auto_cooldown_messages ?? 0,
      0,
      100,
    );
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(identity.chatId)}&limit=6`,
        { cache: "no-store" },
        5000,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Calls of a part of the chat that was taken back (or another swipe) don't count, nor
      // calls between two other people (엿듣는 통화).
      const sessions = ((await response.json()).items || []).filter(
        (session) => session.call_direction !== "overheard" && this.anchorShown?.(session) !== false,
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
      people.find((person) => candidate.caller_key && person.name === candidate.caller_key) ||
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
          note(this.livePersonKey(session.character_key, session.character_name), session.anchor_message_id);
      for (const item of items)
        if (item.origin === "incoming") note(this.messageThreadOf(item), item.anchor_message_id);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 최근 연락을 읽지 못했습니다.", error);
    }
    return since;
  },

  /**
   * The state update's candidates: each person's chance is worked out and rolled on its own
   * (their habit × urgency, halved while busy, nothing while with the user or asleep; halved
   * again when they reached out lately, unless it is urgent). Of those who get through, one call
   * at most rings (the likeliest) and two people at most reach out in all; their texts and voice
   * messages are written one after another (see drainIncomingTexts).
   * `sheets`: each person's state.contact now; it (what the 상태 tab shows) decides whether
   * they are with the user, busy or asleep, over what the candidate said.
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
    const callFree = !this.phonePendingEvent && !this.phoneSession && contactContext?.allowIncoming !== false;
    const recentReplies = clamp(this.config.state_tracking?.every_messages ?? 2, 1, 20) * RECENT_ROUNDS;
    // With one person who can reach out there is nobody to make room for: no holding back.
    const recent =
      this.statePeople().filter((person) => !person.hidden).length > 1 ? await this.recentOutreach() : new Map();
    const decisions = [];
    for (const raw of candidates) {
      if (raw.type === "incoming_call" ? !this.autoCallOn() || !callFree : !this.autoTextOn()) continue;
      const picked = this.actionCaller(raw, unknown);
      if (!picked || decisions.some((item) => item.callerKey === picked.caller.key)) continue;
      const { caller } = picked;
      let candidate = picked.candidate;
      const sheet = unknown.has(caller.key) ? null : sheets.get(caller.key);
      if (sheet) {
        const presence = this.contactWord(sheet.presence, ["together", "apart"]);
        const availability = this.contactWord(sheet.availability, ["free", "busy", "asleep"]);
        candidate = {
          ...candidate,
          ...(presence !== "unknown" ? { presence } : {}),
          ...(availability !== "unknown" ? { availability } : {}),
        };
      }
      const rate = this.contactRate(caller.key);
      const lately = recent.has(caller.key) && recent.get(caller.key) < recentReplies && candidate.urgency !== "high";
      const chance = this.contactChance(candidate, rate) * (lately ? RECENT_WEIGHT : 1);
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
    for (const item of through) item.held = item !== call && !texts.includes(item);
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
      this.drainIncomingTexts().catch((error) => console.warn("[SceneVoice] 메시지 대기열 중단", error));
  },

  /**
   * 엿듣는 통화: the state update says two people would phone each other now. With the switch on,
   * both tracked, neither with the user's character nor asleep (their sheets), and not again
   * within a few updates of the last one, it happens as often as the caller reaches out
   * (their 먼저 연락하는 빈도); its lines are written in one request (writeOverheardCall).
   */
  async handleSideCall(sideCall, sourceMessageId, sheets = new Map()) {
    if (!sideCall || !this.overheardCallsOn() || !this.hasCharacterChat()) return;
    const people = this.statePeople().filter((person) => !person.hidden);
    const caller = people.find((person) => person.key === sideCall.caller_key);
    const callee = people.find((person) => person.key === sideCall.callee_key);
    if (!caller || !callee || caller.key === callee.key) return;
    for (const key of [caller.key, callee.key]) {
      const sheet = sheets.get(key) || {};
      if (sheet.presence === "together" || sheet.availability === "asleep") return;
    }
    const since = await this.repliesSinceOverheard();
    if (since !== null && since < clamp(this.config.state_tracking?.every_messages ?? 2, 1, 20) * 3) return;
    if (Math.random() >= clamp(this.contactRate(caller.key), 0, 100) / 100) return;
    await this.writeOverheardCall(caller, callee, sideCall.reason, sourceMessageId);
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
      (session) => session.call_direction === "overheard" && this.anchorShown(session),
    );
    const anchor = String(last?.anchor_message_id ?? "").match(/^\d+$/);
    return anchor ? this.assistantMessagesSince(Number(anchor[0])) : null;
  },

  /** A person's call rings: saved as ringing (anchored to the message that led to it). */
  async ringIncomingCall({ candidate, callerKey, caller }, sourceMessageId) {
    const identity = this.getStateIdentity();
    const sourceIndex = String(this.phoneAnchorFromSource(sourceMessageId).index);
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
      // The user is on (or being rung by) a call the chat shows: the line is busy.
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
    if (this.config.phone?.vibration && navigator.vibrate) navigator.vibrate([180, 120, 180]);
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
        while (this.voiceMessageBusy && !operation.signal.aborted) await wait(500);
        if (operation.signal.aborted) break;
        await this.generateIncomingVoiceMessage(this.incomingTexts.shift());
        if (this.incomingTexts.length) await wait(900 + Math.random() * 900);
      }
    } finally {
      if (this.incomingDrain === operation.signal) this.incomingDrain = null;
    }
  },
};
