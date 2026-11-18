// 다른 봇카드의 문자: people of a bot card whose chat isn't open text me too (선연락 · 시간 방식),
// and the phone can show and answer those texts without leaving the chat that is open.
//
// A card that isn't open is worked on through a "view" of the app: an object that inherits
// everything from it but sees that card's chat as the open one (scopeContext, read through
// common.js: stOf) and keeps its own per-chat state. So the texts code runs as it is: written
// with that card's profile, people and chat, saved under that chat's id. What reaches into the
// chat on screen (chat memory, line buttons, marks on chat messages) is switched off in a view;
// the chat memory of texts made this way is written when that chat is next opened
// (settleAwayTexts).

import { contentKey } from "../shared/hash.js";
import { escapeHtml } from "./common.js";
import { playback } from "./playback.js";
import { loudness } from "./loudness.js";

const real = () => window.SillyTavern?.getContext?.() || {};
const AVATAR = "character:";
const unreadKey = (card, person) => `${card}\u0000${person}`;
// 다른 봇카드 in the texts list: open or folded, kept on this device.
export const OTHERS_OPEN = "scenevoice_others_open";
export const OTHER_CARD_REASON =
  "Some time has passed without a word between them; no particular reason is given for reaching out now. The story in <recent_chat> is not going on at this moment: it is what they have been through together, not a scene to continue. They may write about anything in their own day, pick up something from before, or just say hello.";

// What reaches into the chat on screen, or belongs to the open chat alone: nothing in a view.
const QUIET = [
  "refreshChatMemory",
  "scheduleChatMemoryRefresh",
  "clearChatMemoryPrompts",
  "syncChatMemoryPrompts",
  "renderChatMemoryDecorations",
  "scheduleScan",
  "scheduleStateTracking",
  "scheduleRandomOutreach",
  "invalidateGeneratedButtons",
  "removeDecorations",
  "resetChat",
  "redrawnChat",
  "syncMultiCast",
  "syncPublicState",
  "announceCallRecord",
  "bindPhoneShelf",
  "settleAwayTexts",
  "adoptRenamedChat",
];
// Kept in the chat's own messages: left for when that chat is open.
const LATER = [
  "persistTextThreadMemory",
  "persistVoiceMessageToMessage",
  "persistChatMemoryEvent",
  "removeChatMemoryEvent",
  "rewriteSwipeMemory",
  "forgetSwipeMemory",
];
// Only texts come from a card that isn't open.
const OFF = [
  "autoCallOn",
  "callsFirstOn",
  "canCallAfterText",
  "overheardCallsOn",
  "overheardTextsOn",
  "selfTextsOn",
  "autoMemosOn",
];

/** The persona a chat of this card is talked to as: the chat's own, the card's, the default one. */
function personaOf(context, avatar, metadata) {
  const power = context.powerUserSettings || {};
  const names = power.personas || {};
  const tied = Object.entries(power.persona_descriptions || {}).find(
    ([, persona]) =>
      (persona?.connections || []).some(
        (link) => link?.type === "character" && link.id === avatar,
      ),
  )?.[0];
  const id = [metadata?.persona, tied, power.default_persona].find(
    (item) => item && names[item],
  );
  return id
    ? {
        name: String(names[id]),
        description: String(
          power.persona_descriptions?.[id]?.description || "",
        ),
      }
    : {
        name: String(context.name1 || "User"),
        description: String(power.persona_description || ""),
      };
}

export const visit = {
  /**
   * Bot cards whose chat isn't open and whose people text me as time passes: 선연락 받기 on,
   * reaching out by time (the card's own choice, or the common one), 먼저 문자 보내기 on.
   */
  otherTimedCards() {
    if (
      this.visitOf ||
      !this.phoneOn() ||
      this.config.outreach?.enabled !== true ||
      !this.config.voice_message?.enabled ||
      this.config.voice_message?.text_me === false
    )
      return [];
    const voices = this.config.character_voices || {};
    const open = new Set(this.hasCharacterChat() ? this.currentCardKeys() : []);
    return (real().characters || [])
      .filter((card) => card?.avatar && card.avatar !== "none")
      .map((card) => `${AVATAR}${card.avatar}`)
      .filter(
        (key) =>
          !open.has(key) &&
          voices[key]?.outreach === true &&
          (voices[key].outreach_mode || this.config.outreach?.mode) === "time",
      );
  },

  /** The view of a card that isn't open (see the top of this file), made once per open chat. */
  cardView(cardKey) {
    this.cardViews ||= new Map();
    if (this.cardViews.has(cardKey)) return this.cardViews.get(cardKey);
    const app = this;
    const avatar = String(cardKey).slice(AVATAR.length);
    const card = (real().characters || []).find(
      (item) => item.avatar === avatar,
    );
    if (!card) return null;
    const file = String(card.chat || "");
    const scope = { chat: [], metadata: {}, loaded: null };
    const view = Object.create(app);
    Object.defineProperty(view, "scopeContext", {
      get() {
        const now = real();
        const index = (now.characters || []).findIndex(
          (item) => item.avatar === avatar,
        );
        const persona = personaOf(now, avatar, scope.metadata);
        return Object.assign(Object.create(now), {
          chat: scope.chat,
          chatId: file,
          characterId: index < 0 ? undefined : index,
          groupId: null,
          name1: persona.name,
          name2: String(card.name || ""),
          chatMetadata: scope.metadata,
          powerUserSettings: Object.assign(
            Object.create(now.powerUserSettings || {}),
            { persona_description: persona.description },
          ),
          saveChat: async () => undefined,
          saveMetadata: async () => undefined,
          setExtensionPrompt: () => undefined,
        });
      },
    });
    // Settings are the app's own, whoever saves them.
    Object.defineProperty(view, "config", {
      get: () => app.config,
      set: (value) => {
        app.config = value;
      },
    });
    Object.assign(view, {
      visitOf: cardKey,
      visitName: String(card.name || ""),
      chatKey: "",
      chatController: new AbortController(),
      chatIdCache: null,
      printCache: new WeakMap(),
      incomingTexts: [],
      incomingText: null,
      incomingDrain: null,
      phoneSession: null,
      phonePendingEvent: null,
      phoneOperationToken: 0,
      phoneBusy: false,
      voiceMessageBusy: false,
      textReplyTimers: new Map(),
      textReplyBusy: "",
      textReplyAgain: new Set(),
      textReplyStop: null,
      messageThreadKey: "",
      // "" while the phone doesn't show this card.
      phoneActiveTab: "",
      phoneShelf: {},
      phoneShownChat: "",
      phoneDrawing: null,
      phoneDrawAgain: false,
      messageGroups: [],
      groupEditor: null,
      unreadThreads: new Set(),
      unheardCalls: new Map(),
      unheardMemos: new Set(),
      lastContactDecisions: [],
      analysisCache: new Map(),
      statusLineCache: new Map(),
      senderNames: new Map(),
      messageRecords: new Map(),
      messageDrafts: {},
      messageHashes: new Map(),
      messageAudioJobs: new Set(),
      voicePending: new Set(),
      generatedUrls: new Set(),
      queue: Promise.resolve(),
      textAlert: null,
      threadPlayback: null,
      replyTarget: null,
      replacingMessage: null,
      roundFamily: null,
      cardTray: null,
      cardWaiting: "",
      draftTranslation: null,
      hiddenRounds: [],
      awayHidden: [],
      voicemailBox: null,
      timedNext: null,
      timedBusy: false,
    });
    for (const name of QUIET) view[name] = () => undefined;
    for (const name of LATER) view[name] = async () => false;
    for (const name of OFF) view[name] = () => false;
    // One player for everything that is heard.
    for (const name of [
      ...Object.keys({ ...playback, ...loudness }),
      "playAudio",
      "stopPlayback",
      "playIncomingTone",
    ])
      if (typeof app[name] === "function")
        view[name] = (...args) => app[name](...args);
    Object.assign(view, {
      // A mark is left on a chat message only while its chat is open.
      anchorTag: () => "",
      loadMessageGroups: async () => [],
      phoneShelfTabs: () => "",
      updatePhoneLauncherVisibility: () => app.updatePhoneLauncherVisibility(),
      announceText: (key, name, text, kind) =>
        app.announceOtherText(view, key, name, text, kind),
      renderSmartphone() {
        return app.visiting === view
          ? app.renderSmartphone.call(view)
          : Promise.resolve();
      },
      async drawSmartphone() {
        await app.drawSmartphone.call(view);
        // Left while this was being drawn: the open chat's screen goes back over it.
        if (app.visiting !== view) await app.renderSmartphone();
        else app.drawVisit(view);
      },
      /** The card's chat as it stands, read once (it doesn't change while it isn't open). */
      loadChat() {
        scope.loaded ||= (async () => {
          if (!file) return;
          const now = real();
          const response = await fetch("/api/chats/get", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(now.getRequestHeaders?.() || {}),
            },
            body: JSON.stringify({
              ch_name: card.name,
              file_name: file,
              avatar_url: card.avatar,
            }),
          });
          const rows = response.ok ? await response.json() : [];
          if (!Array.isArray(rows)) return;
          // The first line of a chat file is about the chat itself.
          const head =
            rows[0] && typeof rows[0].mes !== "string" ? rows[0] : null;
          scope.metadata = head?.chat_metadata || {};
          scope.chat = rows.filter((row) => typeof row?.mes === "string");
        })().catch((error) => {
          scope.loaded = null;
          throw error;
        });
        return scope.loaded;
      },
    });
    // Its own chat key from the start, so the app's work is never taken for a chat gone.
    view.captureChat();
    this.cardViews.set(cardKey, view);
    return view;
  },

  /** The chat on screen changed: what was going on for other cards is dropped. */
  dropCardViews() {
    this.leaveVisit({ draw: false });
    this.otherThreadsKept = null;
    for (const view of this.cardViews?.values() || []) {
      view.textReplyTimers.forEach((timer) => clearTimeout(timer));
      view.chatController.abort(
        new DOMException("채팅이 바뀌어 작업을 취소했습니다.", "AbortError"),
      );
    }
    this.cardViews = new Map();
  },

  /**
   * 선연락 · 시간 방식 for the cards that aren't open: each waits its own random time (between
   * the two settings); when it is over one of its people texts me, within that card's own day's
   * limit. One card a turn.
   */
  async timedOtherCardsTick() {
    const cards = this.otherTimedCards();
    this.timedOthers ||= new Map();
    for (const key of [...this.timedOthers.keys()])
      if (!cards.includes(key)) this.timedOthers.delete(key);
    for (const key of cards)
      if (!this.timedOthers.has(key))
        this.timedOthers.set(key, Date.now() + this.timedWait());
    if (this.timedOtherBusy) return;
    const due = cards.find((key) => Date.now() >= this.timedOthers.get(key));
    if (!due) return;
    this.timedOthers.set(due, Date.now() + this.timedWait());
    this.timedOtherBusy = true;
    try {
      await this.textFromOtherCard(due);
    } catch (error) {
      if (error.name !== "AbortError")
        console.warn("[SceneVoice] 다른 봇카드의 문자 실패", error);
    } finally {
      this.timedOtherBusy = false;
    }
  },

  /** One of that card's people texts me (drawn by 선연락 빈도). */
  async textFromOtherCard(cardKey) {
    const view = this.cardView(cardKey);
    if (!view || view.voiceMessageBusy || view.textReplyBusy) return;
    await view.loadChat();
    // 먼저 문자 off for it, or its 연락하지 않는 시간.
    if (!view.autoTextOn() || view.quietHours()) return;
    const people = view.statePeople().filter((person) => !person.hidden);
    if (!people.length || !(await view.timedContactAllowed())) return;
    const weights = people.map((person) =>
      Math.max(1, view.contactRate(person.key)),
    );
    let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    const person =
      people.find((_, index) => (roll -= weights[index]) <= 0) || people.at(-1);
    view.incomingTexts.push({
      type: "text_message",
      callerKey: person.key,
      reason: OTHER_CARD_REASON,
      mayPass: false,
      sourceMessageId: "",
      createdAt: new Date().toISOString(),
    });
    await view.drainIncomingTexts();
  },

  /** A text from a card that isn't open: unread on the phone, and the same banner as any text. */
  announceOtherText(view, key, name, text, kind = "text") {
    let avatarUrl = "";
    try {
      avatarUrl = view.phoneContact(key).avatarUrl || "";
    } catch {
      /* no picture */
    }
    (this.otherUnread ||= new Map()).set(unreadKey(view.visitOf, key), {
      card: view.visitOf,
      key,
      name: String(name || ""),
      avatarUrl,
    });
    this.textAlert = {
      key,
      card: view.visitOf,
      avatarUrl,
      name: String(name || ""),
      text: String(text || "")
        .split("\n")[0]
        .slice(0, 70),
      kind,
      at: Date.now(),
    };
    clearTimeout(this.textAlertTimer);
    this.textAlertTimer = setTimeout(() => {
      this.textAlert = null;
      this.updatePhoneLauncherVisibility();
    }, 8000);
    this.otherThreadsKept = null;
    this.updatePhoneLauncherVisibility();
    const shell = document.getElementById("sv-smartphone");
    if (
      shell &&
      !shell.classList.contains("hidden") &&
      !this.visiting &&
      this.phoneActiveTab === "message" &&
      !this.messageThreadKey
    )
      this.renderSmartphone();
  },

  /**
   * The conversations of the cards that aren't open, for the texts app's list: [{card, cardName,
   * key, contact, last, unread}], newest first. Also brings the unread ones up to date.
   */
  async loadOtherThreads({ fresh = false } = {}) {
    // The list is drawn again with every text of the open chat: looked up afresh only now and then.
    if (
      !fresh &&
      this.otherThreadsKept &&
      Date.now() - this.otherThreadsKept.at < 20000
    )
      return this.otherThreadsKept.rows;
    const rows = [];
    const unread = new Map();
    if (!this.phoneOn() || this.visitOf) {
      this.otherUnread = unread;
      return rows;
    }
    // Every card's chat as it is named now, by the id its records are kept under; the open
    // chat's cards are not "others". Worked out again only when a card or a chat name changed.
    const open = new Set(this.hasCharacterChat() ? this.currentCardKeys() : []);
    const cards = (real().characters || []).filter(
      (card) => card?.avatar && card.avatar !== "none",
    );
    const signature = cards
      .map((card) => `${card.avatar}\u0000${card.chat || ""}`)
      .join("\n");
    if (this.otherChatIds?.signature !== signature)
      this.otherChatIds = {
        signature,
        ids: new Map(
          cards.map((card) => [
            contentKey({
              chatId: String(card.chat || ""),
              character: `${AVATAR}${card.avatar}`,
            }),
            `${AVATAR}${card.avatar}`,
          ]),
        ),
      };
    const response = await this.request(
      `/api/plugins/scenevoice/voice-messages/threads?chat_id=${this.hasCharacterChat() ? this.currentChatId() : ""}`,
      { cache: "no-store" },
    );
    const threads = response.ok ? (await response.json()).items || [] : [];
    for (const thread of threads) {
      const cardKey = this.otherChatIds.ids.get(thread.chat_id);
      if (!cardKey || open.has(cardKey)) continue;
      const view = this.cardView(cardKey);
      if (!view) continue;
      const key = view.livePersonKey?.(thread.key, thread.name) || thread.key;
      const contact = view.threadContact(key);
      if (thread.unread)
        unread.set(unreadKey(cardKey, key), {
          card: cardKey,
          key,
          name: contact.name,
          avatarUrl: contact.avatarUrl || "",
        });
      rows.push({
        card: cardKey,
        cardName: view.visitName,
        key,
        contact,
        last: thread.last,
        unread: thread.unread === true,
      });
    }
    this.otherUnread = unread;
    rows.sort((a, b) =>
      String(b.last?.created_at || "").localeCompare(
        String(a.last?.created_at || ""),
      ),
    );
    this.otherThreadsKept = { at: Date.now(), rows };
    return rows;
  },

  /** Only another card's text waits on the phone (nothing of the open chat): whose, or null. */
  otherAlertOnly() {
    if (
      !this.otherUnread?.size ||
      this.phonePendingEvent ||
      this.unreadThreads.size ||
      (this.incomingText && !this.incomingText.again) ||
      this.unheardCalls?.size ||
      this.unheardMemos?.size
    )
      return null;
    return [...this.otherUnread.values()].at(-1);
  },

  /** Looked at when a chat opens: texts of other cards still unread. */
  async refreshOtherUnread() {
    await this.loadOtherThreads({ fresh: true });
    this.updatePhoneLauncherVisibility();
  },

  /** The rows of 다른 봇카드 under the texts list (nothing when there are none). */
  otherThreadsHtml(rows) {
    if (!rows.length) return "";
    const waiting = rows.filter((row) => row.unread).length;
    let open = false;
    try {
      open = localStorage.getItem(OTHERS_OPEN) === "1";
    } catch {
      /* stays folded */
    }
    // Folded until opened (kept on this device); texts not read yet are counted on its heading.
    return `<details class="sv-msg-others" data-others ${open ? "open" : ""}><summary class="sv-msg-others-title"><i class="fa-solid fa-id-card-clip" aria-hidden="true"></i><span>다른 봇카드</span><em>${rows.length}</em>${waiting ? `<b class="sv-msg-others-new" aria-label="읽지 않은 대화 ${waiting}개">${waiting}</b>` : ""}<i class="fa-solid fa-chevron-down sv-msg-others-chevron" aria-hidden="true"></i></summary>${rows
      .map(
        ({ card, cardName, key, contact, last, unread }) => `
          <button type="button" class="sv-msg-thread sv-msg-other" data-other-card="${escapeHtml(card)}" data-other-thread="${escapeHtml(key)}">
            ${this.threadAvatarMarkup(contact)}
            <span class="sv-msg-thread-main"><strong><span class="sv-msg-thread-name">${escapeHtml(contact.name)}</span>${contact.name === cardName ? "" : `<em class="sv-msg-count">${escapeHtml(cardName)}</em>`}</strong><small>${escapeHtml(this.messagePreview(last))}</small></span>
            <span class="sv-msg-thread-meta">${last ? `<time>${escapeHtml(this.formatPhoneDate(last.created_at))}</time>` : ""}${unread ? '<i class="sv-unread-dot" aria-label="읽지 않음"></i>' : ""}</span>
          </button>`,
      )
      .join("")}</details>`;
  },

  /** The phone shows a card that isn't open: its texts, that conversation first. */
  async visitCard(cardKey, threadKey = "") {
    const view = this.cardView(cardKey);
    if (!view) return;
    await view.loadChat();
    this.textAlert = null;
    this.visiting = view;
    view.phoneActiveTab = "message";
    view.messageThreadKey = threadKey;
    view.phoneShelf = {};
    await this.openSmartphone("message");
  },

  /** Back to the phone of the chat that is open. */
  leaveVisit({ draw = true } = {}) {
    const view = this.visiting;
    if (!view) return;
    this.visiting = null;
    this.otherThreadsKept = null;
    view.phoneActiveTab = "";
    view.messageThreadKey = "";
    const shell = document.getElementById("sv-smartphone");
    if (shell) delete shell.dataset.visit;
    if (draw && shell && !shell.classList.contains("hidden"))
      this.renderSmartphone();
  },

  /** A visited card's screen says whose texts these are, and how to get back. */
  drawVisit(view) {
    const shell = document.getElementById("sv-smartphone");
    const body = shell?.querySelector(".sv-smartphone-body");
    if (!body || this.visiting !== view) return;
    shell.dataset.visit = "1";
    const title = shell.querySelector(".sv-smartphone-title");
    if (title)
      title.innerHTML = `<i class="fa-solid fa-id-card-clip" aria-hidden="true"></i> ${escapeHtml(view.visitName)}`;
    const list = body.querySelector(".sv-msg-threads");
    if (list && !list.querySelector(".sv-visit-note")) {
      const note = document.createElement("p");
      note.className = "sv-visit-note";
      note.innerHTML = `<span>다른 봇카드 ‘${escapeHtml(view.visitName)}’의 문자입니다. 지금 채팅의 기록과 섞이지 않습니다.</span><button type="button" data-visit-leave>지금 채팅으로</button>`;
      note.querySelector("[data-visit-leave]").addEventListener("click", () => {
        this.phoneActiveTab = "message";
        this.messageThreadKey = "";
        this.leaveVisit();
      });
      list.prepend(note);
    }
    // Seen here: no longer waiting on the phone of the open chat.
    if (view.messageThreadKey)
      this.otherUnread?.delete(unreadKey(view.visitOf, view.messageThreadKey));
    this.updatePhoneLauncherVisibility();
  },

  /**
   * Texts exchanged with this chat's people while another chat was open (kept with `away`): their
   * chat memory is written now that the chat is here.
   */
  async settleAwayTexts() {
    if (this.visitOf || !this.phoneOn() || !this.hasCharacterChat()) return;
    const operation = this.captureChat();
    const away = (await this.loadMessages({ all: true })).filter(
      (item) => item.away,
    );
    if (!away.length) return;
    const places = new Map();
    for (const item of away)
      if (this.anchorShown(item) && !item.thread_key)
        places.set(
          `${this.messageThreadOf(item)}\u0000${item.anchor_message_id}`,
          item,
        );
    for (const item of places.values()) {
      this.assertChat(operation);
      await this.persistTextThreadMemory(
        this.messageThreadOf(item),
        item.anchor_message_id,
      );
    }
    this.assertChat(operation);
    await this.request("/api/plugins/scenevoice/voice-messages/settled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.getStateIdentity().chatId,
        ids: away.map((item) => item.id),
      }),
    });
  },
};
