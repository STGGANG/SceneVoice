// 문자 앱: the conversation list, a conversation, sending texts, replies from the helper model
// and voice messages.
import {
  dataBlock,
  messageFinal,
  messageSystem,
  textFinal,
  textSystem,
  phoneMessages,
} from "./prompts.js";
import { escapeHtml, normalizeTags, stOf, CHAT_MEMORY_KEY } from "./common.js";
import { cardCanBeAnswered, claimOutcome, REACTIONS } from "./cards.js";
import { validReaction } from "../shared/store.js";

// How often a reply is offered the chance to text someone else about it (다른 인물에게 전하기).
const TELL_CHANCE = 0.35;

export const messages = {
  /**
   * Every text and voice message of the open chat, oldest first. Those not of the chat as it is
   * now (another swipe, a part taken back) stay out unless `all`; `hidden` also brings a group's
   * rounds kept as other versions.
   */
  async loadMessages({ all = false, hidden = false } = {}) {
    const response = await this.fetch(
      this.apiUrl(
        `/api/plugins/scenevoice/voice-messages?chat_id=${encodeURIComponent(this.currentChatId())}&limit=1000${hidden ? "&hidden=1" : ""}`,
      ),
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    // Every name a sender's key was saved with: a key whose person is gone finds them by any.
    this.senderNames ||= new Map();
    // People of another bot card's chat with nobody here named like them: shown by the name
    // their records carry, to read and hear only (see chat-line.js).
    this.lockedPeople = new Map();
    for (const item of data.items || []) {
      if (this.lineLocked?.includes(item.character_key))
        this.lockedPeople.set(item.character_key, item.character_name || "");
      if (!item.character_key || !item.character_name || item.role === "user")
        continue;
      const names = this.senderNames.get(item.character_key) || new Set();
      if (!names.has(item.character_name)) {
        names.add(item.character_name);
        this.senderNames.set(item.character_key, names);
        this.senderNamesVersion = (this.senderNamesVersion || 0) + 1;
      }
    }
    // The list comes newest first; messages saved in the same millisecond keep their saved order.
    return (data.items || [])
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          String(a.item.created_at).localeCompare(String(b.item.created_at)) ||
          a.index - b.index,
      )
      .map(({ item }) => item)
      .filter((item) => all || this.anchorShown?.(item) !== false);
  },

  /** The conversation a message belongs to: its group, or the person who sent it or was texted. */
  messageThreadOf(item) {
    return (
      item?.thread_key ||
      (item?.character_key &&
        this.livePersonKey(item.character_key, item.character_name)) ||
      this.getCurrentCharacterProfile().key
    );
  },

  messagePreview(item) {
    if (!item) return "대화를 시작해 보십시오";
    const first = item.card?.solo
      ? this.cardLabel(item.card)
      : String(item.text || "").split("\n")[0];
    if (item.role === "user") return `나: ${first}`;
    const preview =
      (item.kind || "voice") === "voice" ? `음성 메시지 · ${first}` : first;
    return item.thread_key ? `${item.character_name}: ${preview}` : preview;
  },

  async renderSmartphoneMessages(body) {
    // The room editor stays as it is while texts come in: its choices are kept in groupEditor,
    // and drawing it again would blink it and lose its scroll.
    if (
      this.groupEditor &&
      this.groupEditorShown === this.groupEditor &&
      body.querySelector(".sv-room-editor")
    )
      return;
    // A conversation or the list already shown stays until the new one is ready (no flicker).
    if (!body.querySelector(".sv-msg-thread-view, .sv-msg-threads"))
      body.innerHTML =
        '<div class="sv-phone-list-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><p>문자를 불러오는 중…</p></div>';
    try {
      const [everything, groupList] = await Promise.all([
        this.loadMessages({ hidden: true, all: true }),
        this.loadMessageGroups(),
      ]);
      const here = everything.filter((item) => this.anchorShown(item));
      const items = here.filter((item) => !item.hidden);
      this.hiddenRounds = here.filter((item) => item.hidden);
      // 미적용 기억: texts of a swipe not showing now, or of a part of the chat taken back.
      const away = everything.filter(
        (item) => !item.hidden && !this.anchorShown(item),
      );
      // Their groups' other rounds go with them when they are cleared.
      this.awayHidden = everything.filter(
        (item) => item.hidden && !this.anchorShown(item),
      );
      if (this.groupEditor) {
        this.renderGroupEditor(body);
        return;
      }
      this.phoneShelf ||= {};
      if (this.phoneShelf.message === "unapplied") {
        const awayKey = this.messageThreadKey;
        if (
          awayKey &&
          away.some((item) => this.messageThreadOf(item) === awayKey)
        )
          this.renderAwayThread(body, awayKey, away);
        else {
          this.messageThreadKey = "";
          this.renderAwayThreads(body, away);
        }
        return;
      }
      // People of this chat and its groups, plus anyone an older conversation was with.
      const keys = [
        ...this.phoneContacts().map((contact) => contact.key),
        ...groupList.map((group) => `group:${group.id}`),
      ];
      for (const item of items) {
        const key = this.messageThreadOf(item);
        if (!keys.includes(key) && !this.isGroupThread(key)) keys.push(key);
      }
      // Conversations of the cards that aren't open, under this chat's own.
      this.otherThreads = this.visitOf
        ? []
        : await this.loadOtherThreads().catch(() => []);
      if (!keys.length && this.otherThreads.length) {
        this.messageThreadKey = "";
        this.renderMessageThreads(body, [], [], 0);
        return;
      }
      if (!keys.length) {
        body.innerHTML =
          '<div class="sv-phone-list-empty"><i class="fa-solid fa-comment-slash" aria-hidden="true"></i><p>캐릭터 채팅을 열면 문자를 주고받을 수 있습니다.</p></div>';
        return;
      }
      // A group that was left is no longer there to open.
      if (
        this.isGroupThread(this.messageThreadKey) &&
        !this.messageGroup(this.messageThreadKey)
      )
        this.messageThreadKey = "";
      // The list (with its 적용 기억 | 미적용 기억 tabs) comes first, even with one person.
      const key = this.messageThreadKey;
      if (key) this.renderMessageThread(body, key, items);
      else this.renderMessageThreads(body, items, keys, away.length);
    } catch (error) {
      body.innerHTML = `<div class="sv-phone-list-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(error.message)}</p></div>`;
    }
  },

  renderMessageThreads(body, items, keys, away = 0) {
    const rows = keys
      .map((key) => ({
        key,
        contact: this.threadContact(key),
        last: items.filter((item) => this.messageThreadOf(item) === key).at(-1),
      }))
      .sort((a, b) =>
        String(b.last?.created_at || "").localeCompare(
          String(a.last?.created_at || ""),
        ),
      );
    // A group needs two people besides the user.
    const canGroup = this.phoneContacts().length >= 2;
    // Unread since the page was loaded too (kept with the message until its conversation opens).
    const unreadKeys = new Set(
      items
        .filter((item) => item.unread)
        .map((item) => this.messageThreadOf(item)),
    );
    // Drawn again (a reply came in): the list keeps where it was scrolled to.
    const keepScroll = body.querySelector(".sv-msg-threads")
      ? body.scrollTop
      : 0;
    body.innerHTML = `<div class="sv-msg-threads">${this.phoneShelfTabs("message", away)}${
      canGroup
        ? '<button type="button" class="sv-msg-new-group" data-group-new><i class="fa-solid fa-user-group" aria-hidden="true"></i><span>새 단체방</span></button>'
        : ""
    }${rows
      .map(
        ({ key, contact, last }) => `
          <button type="button" class="sv-msg-thread" data-thread="${escapeHtml(key)}">
            ${this.threadAvatarMarkup(contact)}
            <span class="sv-msg-thread-main"><strong><span class="sv-msg-thread-name">${escapeHtml(contact.name)}</span>${contact.group ? `<em class="sv-msg-count">${this.messageGroup(key)?.without_user ? `<i class="fa-solid fa-eye" aria-hidden="true" title="나 없는 방"></i> ${contact.members.length}` : contact.members.length + 1}</em>` : ""}</strong><small>${escapeHtml(this.messagePreview(last))}</small></span>
            <span class="sv-msg-thread-meta">${last ? `<time>${escapeHtml(this.formatPhoneDate(last.created_at))}</time>` : ""}${this.unreadThreads.has(key) || unreadKeys.has(key) ? '<i class="sv-unread-dot" aria-label="읽지 않음"></i>' : ""}</span>
          </button>`,
      )
      .join("")}${this.otherThreadsHtml(this.otherThreads || [])}</div>`;
    body.scrollTop = keepScroll;
    this.bindPhoneShelf(body, "message");
    body.querySelector("[data-others]")?.addEventListener("toggle", (event) => {
      try {
        localStorage.setItem(
          "scenevoice_others_open",
          event.target.open ? "1" : "0",
        );
      } catch {
        /* not kept */
      }
    });
    body
      .querySelectorAll("[data-other-card]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() =>
            this.visitCard(
              button.dataset.otherCard,
              button.dataset.otherThread,
            ),
          ),
        ),
      );
    body
      .querySelector("[data-group-new]")
      ?.addEventListener("click", () => this.openGroupEditor());
    body.querySelectorAll("[data-thread]").forEach((button) =>
      button.addEventListener("click", () => {
        this.messageThreadKey = button.dataset.thread;
        this.renderSmartphone();
      }),
    );
  },

  /** A button that is pressed shows it is working, and can't be pressed twice meanwhile. */
  async withBusyButton(button, work) {
    if (!button || button.disabled) return work();
    button.disabled = true;
    const icon = button.querySelector("i");
    const before = icon?.className;
    if (icon) icon.className = "fa-solid fa-spinner fa-spin";
    try {
      return await work();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        if (icon) icon.className = before;
      }
    }
  },

  /**
   * 미적용 기억 → 다시 적용: a conversation's texts go back to the chat message they were made at
   * (the same number, on the swipe showing now) and into the chat memory again. A message that
   * already holds other calls or texts is asked about first: on 확인 they give way and wait in
   * 미적용 기억 instead (nothing is deleted). A message no longer in the chat can't take them.
   */
  async reapplyAwayThread(key) {
    const chat = stOf(this)?.chat || [];
    const operation = this.captureChat();
    const everything = await this.loadMessages({ hidden: true, all: true });
    const items = everything.filter(
      (item) =>
        this.messageThreadOf(item) === key &&
        !this.anchorShown(item) &&
        /^\d+$/.test(String(item.anchor_message_id ?? "")),
    );
    if (!items.length) return;
    const points = [
      ...new Set(items.map((item) => String(item.anchor_message_id))),
    ];
    const present = points.filter((at) => chat[Number(at)]);
    const missing = points.filter((at) => !chat[Number(at)]);
    if (!present.length) {
      this.notify(
        `이 문자들이 오갔던 메시지(${missing.map((at) => `#${at}`).join(", ")})가 지금 채팅에 없어 다시 적용할 수 없습니다.`,
        "info",
      );
      return;
    }
    const taken = present.filter(
      (at) => this.chatMemoryEventsOf(chat[Number(at)]).length,
    );
    // The same conversation went on meanwhile (texts used now, at other messages): these are
    // put back among them by the time they were sent, which can read oddly.
    const continued = everything.some(
      (item) =>
        this.messageThreadOf(item) === key &&
        !item.hidden &&
        this.anchorShown(item) &&
        !taken.includes(String(item.anchor_message_id)),
    );
    const notes = [
      continued &&
        "이 대화에는 그 뒤에 오간 문자가 있습니다. 다시 적용하면 보낸 시각 순서대로 기존 대화 사이에 끼워져, 대화 흐름이 어색할 수 있습니다.",
      taken.length &&
        `${taken.map((at) => `#${at}`).join(", ")} 메시지에 이미 다른 전화·문자 기록이 있습니다. 덮어쓰면 원래 있던 기록은 미적용 기억으로 옮겨집니다(지워지지 않습니다).`,
    ].filter(Boolean);
    if (
      notes.length &&
      !confirm(
        `${notes.join("\n\n")}\n\n확인: ${taken.length ? "덮어쓰고 " : ""}다시 적용 · 취소: 그만두기`,
      )
    )
      return;
    const group = this.isGroupThread(key);
    const asText = (item) =>
      group || (item.kind || "voice") === "text" || item.origin === "reply";
    let moved = 0;
    for (const at of present) {
      this.assertChat(operation);
      const index = Number(at);
      const message = chat[index];
      const here = items.filter(
        (item) => String(item.anchor_message_id) === at,
      );
      // Made on another swipe of this message: the memory kept with that swipe lets them go.
      const swipes = here.filter((item) => this.anchorPlace(item) === "swipe");
      if (taken.includes(at)) {
        // What is there now gives way: a new mark, and its memory on this swipe taken out.
        this.renewAnchorTag(index);
        const swipe =
          typeof message.swipe_id === "number" ? message.swipe_id : 0;
        const events = message.extra?.[CHAT_MEMORY_KEY];
        if (Array.isArray(events)) {
          message.extra[CHAT_MEMORY_KEY] = events.filter(
            (item) =>
              typeof item?.swipe_id === "number" && item.swipe_id !== swipe,
          );
          if (!message.extra[CHAT_MEMORY_KEY].length)
            delete message.extra[CHAT_MEMORY_KEY];
        }
        await stOf(this)?.saveChat?.();
      }
      const response = await this.request(
        "/api/plugins/scenevoice/voice-messages/reanchor",
        {
          method: "POST",
          body: JSON.stringify({
            chat_id: this.currentChatId(),
            ids: here.map((item) => item.id),
            anchor_message_id: at,
            ...this.anchorStamp(index),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "다시 적용하지 못했습니다.");
      moved += here.filter((item) => !item.hidden).length;
      for (const item of swipes)
        if (asText(item))
          await this.persistTextThreadMemory(key, at, {
            swipe: item.anchor_swipe,
          });
        else
          await this.rewriteSwipeMemory(at, item.anchor_swipe, item.id, null);
      // Into the chat memory again: the conversation at this point, or each voice message.
      if (here.some((item) => !item.hidden && asText(item)))
        await this.persistTextThreadMemory(key, at);
      for (const item of here)
        if (!item.hidden && !asText(item))
          await this.persistVoiceMessageToMessage({
            ...item,
            ...this.anchorStamp(index),
            anchor_message_id: at,
            type: "voice_message",
            reason: item.reason || "",
          });
    }
    await this.refreshChatMemory?.();
    this.messageThreadKey = key;
    this.phoneShelf ||= {};
    this.phoneShelf.message = "applied";
    await this.renderSmartphone();
    this.notify(
      `문자 ${moved}개를 다시 적용했습니다.${missing.length ? ` (${missing.map((at) => `#${at}`).join(", ")} 메시지는 지금 채팅에 없어 그대로 남았습니다.)` : ""}`,
      "success",
    );
  },

  /** 미적용 기억: the conversations with texts the chat doesn't use now, one row each. */
  renderAwayThreads(body, away) {
    const rows = [...new Set(away.map((item) => this.messageThreadOf(item)))]
      .map((key) => {
        const list = away.filter((item) => this.messageThreadOf(item) === key);
        return {
          key,
          contact: this.threadContact(key),
          count: list.length,
          last: list.at(-1),
        };
      })
      .sort((a, b) =>
        String(b.last.created_at).localeCompare(String(a.last.created_at)),
      );
    body.innerHTML = `<div class="sv-msg-threads">${this.phoneShelfTabs("message", away.length)}${
      rows.length ? this.phoneShelfNote() : this.phoneShelfEmpty()
    }${rows
      .map(
        ({ key, contact, count, last }) => `
          <button type="button" class="sv-msg-thread" data-thread="${escapeHtml(key)}">
            ${this.threadAvatarMarkup(contact)}
            <span class="sv-msg-thread-main"><strong><span class="sv-msg-thread-name">${escapeHtml(contact.name)}</span></strong><small>${escapeHtml(this.messagePreview(last))}</small></span>
            <span class="sv-msg-thread-meta"><time>${escapeHtml(this.formatPhoneDate(last.created_at))}</time><em class="sv-shelf-count" aria-label="${count}개">${count}</em></span>
          </button>`,
      )
      .join("")}</div>`;
    this.bindPhoneShelf(body, "message");
    body
      .querySelector("[data-shelf-clear]")
      ?.addEventListener("click", () =>
        this.run(() => this.clearAwayMessages(away)),
      );
    body.querySelectorAll("[data-thread]").forEach((button) =>
      button.addEventListener("click", () => {
        this.messageThreadKey = button.dataset.thread;
        this.renderSmartphone();
      }),
    );
  },

  /**
   * A conversation in 미적용 기억: only to read, play and delete, each part under where in the
   * chat it was made (#12 · 2번째 스와이프).
   */
  renderAwayThread(body, key, away) {
    this.messageRecords = new Map();
    const contact = this.threadContact(key);
    const thread = away.filter((item) => this.messageThreadOf(item) === key);
    const pointOf = (item) =>
      `${item.anchor_message_id}|${item.anchor_swipe ?? ""}|${item.anchor_tag || ""}`;
    const shown = body.querySelector(".sv-msg-away");
    const keepScroll = shown?.dataset.thread === key ? body.scrollTop : null;
    const awayClaims = this.cardClaims(thread);
    // 한 번에 듣기: the messages here that have a voice, in order (none is made for it).
    const voiced = thread.filter((item) => item.audio_url).length;
    const aloud = this.threadPlayback?.key === `away:${key}`;
    body.innerHTML = `
      <div class="sv-msg-thread-view sv-msg-away" data-thread="${escapeHtml(key)}">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back sv-msg-back" data-thread-back aria-label="미적용 기억" title="미적용 기억"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
          <div class="sv-msg-who">${this.threadAvatarMarkup(contact)}<span class="sv-msg-who-text"><strong>${escapeHtml(contact.name)}</strong><small><i class="fa-solid fa-trash-can" aria-hidden="true"></i> 미적용 기억</small></span></div>
          ${voiced ? `<button type="button" class="sv-msg-aloud ${aloud ? "sv-playing" : ""}" data-thread-aloud aria-pressed="${aloud}" aria-label="${aloud ? "듣기 멈추기" : "한 번에 듣기"}" title="${aloud ? "듣기 멈추기" : `한 번에 듣기: 이 대화에서 음성이 있는 문자 ${voiced}개를 차례로 들려줍니다(새로 만들지 않음)`}"><i class="fa-solid ${aloud ? "fa-stop" : "fa-headphones"}" aria-hidden="true"></i></button>` : ""}
        </header>
        <div class="sv-msg-list" role="log">
          ${thread
            .map((item, index) => {
              const before = thread[index - 1];
              const point = !before || pointOf(before) !== pointOf(item);
              const sameSender =
                !point &&
                before.role === item.role &&
                (item.role === "user" ||
                  before.character_key === item.character_key);
              const head =
                !sameSender ||
                this.formatPhoneDate(before.created_at) !==
                  this.formatPhoneDate(item.created_at);
              return `${point ? `<div class="sv-msg-point"><span>${escapeHtml(this.awayPointLabel(item))}</span></div>` : ""}${this.messageBubbleHtml(
                item,
                {
                  frozen: true,
                  claims: awayClaims.get(item.id),
                  head,
                  sender:
                    contact.group && item.role !== "user"
                      ? this.memberContact({
                          key: item.character_key,
                          name: item.character_name,
                        })
                      : null,
                },
              )}`;
            })
            .join("")}
        </div>
        <p class="sv-msg-frozen"><i class="fa-solid fa-lock" aria-hidden="true"></i>보기만 할 수 있는 대화입니다<button type="button" class="sv-msg-reapply" data-thread-reapply title="다시 적용: 이 문자들이 오갔던 채팅 메시지(같은 번호)에 다시 붙이고 채팅 기억에도 다시 넣습니다"><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i><span>다시 적용</span></button></p>
      </div>`;
    body.querySelector("[data-thread-back]").addEventListener("click", () => {
      this.messageThreadKey = "";
      this.renderSmartphone();
    });
    body
      .querySelector("[data-thread-aloud]")
      ?.addEventListener("click", () =>
        this.run(() => this.playThreadAloud(key, thread)),
      );
    body
      .querySelector("[data-thread-reapply]")
      ?.addEventListener("click", (event) =>
        this.run(() =>
          this.withBusyButton(event.currentTarget, () =>
            this.reapplyAwayThread(key),
          ),
        ),
      );
    const record = (button) => this.messageRecord(button);
    const lit = body.querySelector(".sv-msg-play.sv-playing");
    if (lit && this.currentAudio) this.currentPlayButton = lit;
    body.querySelectorAll(".sv-msg-play").forEach((button) =>
      button.addEventListener("click", () => {
        const item = record(button);
        if (item.audio_url)
          this.playMessageAudio(item, this.apiUrl(item.audio_url), button);
        else this.generateVoiceMessageAudio(item, button);
      }),
    );
    body
      .querySelectorAll(".sv-msg-delete")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() => this.deleteMessage(record(button))),
        ),
      );
    this.bindMessageMore(body);
    if (!this.showReadingMessage(body))
      body.scrollTop = keepScroll ?? body.scrollHeight;
  },

  /**
   * 미적용 기억 → 모두 지우기: those texts leave the phone for good, with what the swipes they
   * were made on keep of them in the chat memory.
   */
  async clearAwayMessages(away) {
    if (!away.length) return;
    if (
      !confirm(
        `미적용 기억의 문자 ${away.length}개를 모두 지우시겠습니까?\n스마트폰에서 완전히 지워지고, 그 스와이프로 돌아가도 다시 나타나지 않습니다.`,
      )
    )
      return;
    const response = await this.request(
      "/api/plugins/scenevoice/voice-messages/delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.currentChatId(),
          ids: [...away, ...(this.awayHidden || [])].map((item) => item.id),
        }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "문자를 지우지 못했습니다.");
    // Once per conversation and point in the chat.
    const done = new Set();
    for (const item of away) {
      const texts =
        (item.kind || "voice") === "text" || item.origin === "reply";
      const thread = texts ? this.messageThreadOf(item) : "";
      const mark = `${thread || item.id}|${item.anchor_message_id}|${item.anchor_swipe}`;
      if (done.has(mark)) continue;
      done.add(mark);
      await this.forgetSwipeMemory(item, thread);
    }
    this.messageThreadKey = "";
    await this.renderSmartphone();
  },

  /** The user's own messages can be voiced too, once their persona has a voice of its own. */
  personaVoiceReady() {
    const persona = this.config.character_voices?.[this.personaKey()] || {};
    return Boolean(persona.voice_id);
  },

  /**
   * One message. `head`: the line above it (avatar and name in a group, then the time), shown
   * when the sender or the minute changes. Buttons are icons; their names are in the tooltips.
   * `frozen`: a message in 미적용 기억, only to play or delete.
   */
  messageBubbleHtml(
    item,
    {
      latest = false,
      head = false,
      sender = null,
      rounds = null,
      frozen = false,
      read = false,
      canQuote = false,
      answered = "",
      // A random card of mine in a group: who opened it so far (cards.js: cardClaims).
      claims = null,
    } = {},
  ) {
    // Buttons carry the message's id; the record itself is kept for this drawing (messageRecord).
    (this.messageRecords ||= new Map()).set(item.id, item);
    const record = escapeHtml(item.id);
    const time = `<time>${escapeHtml(this.formatPhoneDate(item.created_at))}</time>`;
    const label = head
      ? `<div class="sv-msg-label">${
          sender
            ? `${this.contactAvatarMarkup(sender)}<b>${escapeHtml(sender.name)}</b><span class="sv-msg-sep" aria-hidden="true">|</span>`
            : ""
        }${time}${read ? '<i class="fa-solid fa-check sv-msg-read" role="img" aria-label="읽음" title="읽음"></i>' : ""}</div>`
      : "";
    // The same words and icons everywhere: 재생 ▶ (makes the voice first if there is none) ·
    // 음성 재생성 ↻ · 답변 재생성 ⟳ · 고치기 ✎ · 삭제. The newest message names its main ones; older
    // ones keep icons (names in tooltips).
    const button = (cls, icon, title, label = "") =>
      `<button type="button" class="${cls}${latest && label ? " sv-labeled" : ""}" data-id="${record}" aria-label="${title}" title="${title}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${latest && label ? `<span>${label}</span>` : ""}</button>`;
    const remove = button("sv-msg-delete", "fa-trash-can", "삭제");
    const voice = (item.kind || "voice") === "voice";
    // Only the newest message can be asked for again: later ones would no longer follow from it.
    const again =
      latest && item.role !== "user"
        ? button(
            "sv-msg-again",
            "fa-arrows-rotate",
            item.thread_key
              ? "답변 재생성: 이번 회차의 답을 모두 새로 받습니다. 이전 답은 ‹ ›로 넘겨 비교할 수 있습니다"
              : "답변 재생성: 같은 흐름에서 새 답을 받습니다. 이전 답은 ‹ ›로 넘겨 비교할 수 있습니다",
            "답변 재생성",
          )
        : "";
    // Earlier answers of this message (답변 재생성): ‹ 2/3 ›, the one shown is the one used.
    const versions =
      latest && item.role !== "user" && item.versions?.length > 1
        ? item.versions.length
        : 0;
    const shown = versions
      ? Number.isInteger(item.version)
        ? item.version
        : versions - 1
      : 0;
    // A group's round: ‹ 1/2 › pages the whole round of answers.
    const roundPager =
      latest && rounds?.count > 1
        ? `<div class="sv-msg-versions" title="다른 답 보기: 지금 보이는 답이 대화 흐름과 채팅 기억에 쓰입니다"><button type="button" class="sv-msg-round" data-family="${escapeHtml(rounds.family)}" data-index="${rounds.index - 1}" aria-label="이전 답" ${rounds.index > 0 ? "" : "disabled"}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><small>${rounds.index + 1}/${rounds.count}</small><button type="button" class="sv-msg-round" data-family="${escapeHtml(rounds.family)}" data-index="${rounds.index + 1}" aria-label="다음 답" ${rounds.index < rounds.count - 1 ? "" : "disabled"}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div>`
        : "";
    const pager =
      roundPager ||
      (versions
        ? `<div class="sv-msg-versions" title="다른 답 보기: 지금 보이는 답이 대화 흐름과 채팅 기억에 쓰입니다"><button type="button" class="sv-msg-version" data-id="${record}" data-version="${shown - 1}" aria-label="이전 답" ${shown > 0 ? "" : "disabled"}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><small>${shown + 1}/${versions}</small><button type="button" class="sv-msg-version" data-id="${record}" data-version="${shown + 1}" aria-label="다음 답" ${shown < versions - 1 ? "" : "disabled"}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div>`
        : "");
    const voiced = item.role !== "user" || this.personaVoiceReady();
    // The message playing now keeps its lit button through redraws.
    const playing =
      this.playingMessageId === item.id && this.currentAudio
        ? " sv-playing"
        : "";
    // Its bubbles are outlined too, so it is clear which message is being read.
    const reading = playing ? " sv-msg-reading" : "";
    const play =
      voiced && !voice
        ? button(
            `sv-msg-play${playing}`,
            "fa-play",
            item.audio_url ? "재생" : "재생: 음성을 만든 뒤 재생합니다",
            "재생",
          )
        : "";
    // While a new voice is being made (after an edit), its place stays, turning. A voice
    // message without its voice yet offers to make it right away.
    // A message in 미적용 기억 keeps its voice as it is (the bubble's own ▶ makes one).
    // A forwarded recording plays from its card; its voice isn't mine to make again.
    const reroll =
      frozen || item.forward
        ? ""
        : item.audio_url
          ? button(
              "sv-msg-reroll",
              "fa-rotate-right",
              "음성 재생성: 같은 문장으로 목소리만 새로 만듭니다",
            )
          : this.voicePending?.has(item.id)
            ? `<button type="button" class="sv-msg-reroll" disabled aria-label="새 음성을 만드는 중" title="새 음성을 만드는 중"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></button>`
            : voice && item.role !== "user"
              ? button(
                  `sv-msg-play sv-msg-make${playing}`,
                  "fa-play",
                  "재생: 음성을 만든 뒤 재생합니다",
                  "재생",
                )
              : "";
    // Translations always show under their message.
    const translation = item.translation
      ? `<div class="sv-msg-translation">${this.translationHtml(item)}</div>`
      : "";
    const edit =
      frozen || item.forward
        ? ""
        : item.role === "user"
          ? button("sv-msg-edit", "fa-pen", "고치기: 보낸 문자를 고칩니다")
          : button(
              "sv-msg-edit",
              "fa-pen",
              "고치기: 고친 뒤 음성을 새로 만듭니다",
            );
    // 음성 전달: a voice message of theirs can be passed on to someone else.
    const share =
      item.role !== "user" && voice && item.audio_url && !frozen
        ? button(
            "sv-msg-share",
            "fa-share",
            "공유: 이 음성 메시지를 다른 인물에게 들려줍니다",
          )
        : "";
    // 인용 답장: this message is picked as the one my next text answers.
    const quoteButton =
      canQuote && !frozen
        ? button(
            "sv-msg-quote-btn",
            "fa-reply",
            "답장: 이 문자를 인용해 답합니다",
          )
        : "";
    const save =
      voiced && !item.forward
        ? `<button type="button" class="sv-msg-save" data-id="${record}" aria-label="내려받기" title="${item.audio_url ? "내려받기: 이 문자의 음성만 파일로(WAV)" : "음성을 만든 뒤에 내려받을 수 있습니다"}" ${item.audio_url ? "" : "disabled"}><i class="fa-solid fa-download" aria-hidden="true"></i></button>`
        : "";
    // 재생 stays in sight (so does a voice being made); the rest sits behind ⋯.
    const made = reroll.includes('class="sv-msg-reroll" data-id');
    // 기억에서 빼기, one text: the AI doesn't see it anywhere (this room's conversation too).
    const forgotten = this.forgottenTexts?.().has(String(item.id));
    const forget = frozen
      ? ""
      : `<button type="button" class="sv-msg-forget${forgotten ? " sv-memory-off sv-reach-all" : ""}" data-id="${record}" aria-pressed="${Boolean(forgotten)}" aria-label="${forgotten ? "기억에 다시 넣기" : "기억에서 빼기"}" title="${forgotten ? "기억에 다시 넣기: 이 문자를 AI가 다시 알게 합니다" : "기억에서 빼기: 지우지 않고, 본 채팅·스마트폰 어디서도 AI가 이 문자를 모르게 합니다"}"><i class="fa-solid fa-brain" aria-hidden="true"></i></button>`;
    const extra = `${made ? reroll : ""}${save}${quoteButton}${edit}${share}${forget}${remove}`;
    const open = this.messageMoreOpen === item.id;
    // Someone else's text can be answered with an emoji at a tap.
    const reacts =
      item.role !== "user" && !frozen
        ? `<span class="sv-msg-reacts" role="group" aria-label="반응 남기기">${REACTIONS.map((emoji) => `<button type="button" data-react="${emoji}" data-id="${record}" aria-label="반응 ${emoji}" title="반응 남기기">${emoji}</button>`).join("")}<button type="button" class="sv-msg-react-own" data-react-own data-id="${record}" aria-label="다른 이모지로 반응" title="다른 이모지 직접 넣기"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></span>`
        : "";
    const more = `<button type="button" class="sv-msg-more" data-id="${record}" aria-expanded="${open}" aria-label="더 보기" title="더 보기: 음성 재생성 · 내려받기 · 답장 · 고치기 · 기억에서 빼기 · 삭제"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button><span class="sv-msg-extra" ${open ? "" : "hidden"}>${extra}${reacts}</span>`;
    // 답변 재생성 and ‹ 1/2 › go on a line of their own under the buttons.
    const meta = `<div class="sv-msg-meta">${this.reactionsHtml?.(item) || ""}${item.forward ? "" : play}${made ? "" : reroll}${more}</div>${again || pager ? `<div class="sv-msg-meta sv-msg-again-line">${again}${pager}</div>` : ""}`;
    const lines = String(
      (item.forward && !item.forward.note) || item.card?.solo
        ? ""
        : item.text || "",
    )
      .split("\n")
      .filter((line) => line.trim());
    const attached = `${this.quoteHtml?.(item) || ""}${this.cardHtml?.(item, { answered, claims, canAnswer: canQuote && !frozen }) || ""}`;
    const bubbles =
      attached +
      lines
        .map((line) => `<p class="sv-msg-bubble">${escapeHtml(line)}</p>`)
        .join("");
    if (item.role === "user")
      return `<div class="sv-msg-row sv-msg-mine${reading}">${label}${this.forwardCardHtml?.(item, playing) || ""}${bubbles}${translation}${meta}</div>`;
    if ((item.kind || "voice") === "voice")
      return `<div class="sv-msg-row sv-msg-theirs${reading}">${label}
          <div class="sv-msg-bubble sv-msg-voice">
            <div class="sv-vm-player">
              <button type="button" class="sv-voice-message-play sv-msg-play${playing}" data-id="${record}" aria-label="${item.audio_url ? "음성 메시지 재생" : "음성을 만든 뒤 재생"}"><i class="fa-solid fa-play" aria-hidden="true"></i></button>
              <span class="sv-vm-wave" aria-hidden="true">${this.voiceWaveBars(item.text)}</span>
              <small class="sv-vm-note">${item.audio_url ? "음성 메시지" : "눌러서 음성 만들기"}</small>
            </div>
            <p>${escapeHtml(item.text)}</p>
          </div>
          ${translation}${meta}
        </div>`;
    return `<div class="sv-msg-row sv-msg-theirs${reading}">${label}${bubbles}${translation}${meta}</div>`;
  },

  renderMessageThread(body, key, items) {
    this.messageRecords = new Map();
    const contact = this.threadContact(key);
    const thread = items.filter((item) => this.messageThreadOf(item) === key);
    // Seeing the conversation reads it.
    this.unreadThreads.delete(key);
    const unread = thread.filter((item) => item.unread);
    if (unread.length) {
      for (const item of unread) delete item.unread;
      this.markMessagesRead(unread.map((item) => item.id));
    }
    this.updatePhoneLauncherVisibility();
    const typing =
      this.textReplyBusy === key || this.incomingText?.callerKey === key;
    const previous = body.querySelector("#sv-msg-input");
    const hadFocus = previous && document.activeElement === previous;
    this.messageDrafts ||= {};
    // The same conversation drawn again keeps the reading place once I have scrolled up from
    // its end: messages arriving one by one don't pull the view down. At the end (or after I
    // send something, or in another conversation) it follows to the end.
    const shownView = body.querySelector(".sv-msg-thread-view");
    const tail = `${thread.at(-1)?.id || ""}|${typing ? 1 : 0}`;
    const mineJustSent =
      thread.at(-1)?.role === "user" && shownView?.dataset.tail !== tail;
    const keepScroll =
      shownView?.dataset.thread === key &&
      !mineJustSent &&
      body.scrollHeight - body.scrollTop - body.clientHeight > 40
        ? body.scrollTop
        : null;
    const aloud = this.threadPlayback?.key === key;
    // Cards answered (mine by them in a reply, theirs by me with a button): message id → the answer.
    const answers = this.cardAnswers(thread);
    const claims = this.cardClaims(thread);
    const locked = this.lockedPeople?.has(key);
    const observing = locked || Boolean(this.messageGroup(key)?.without_user);
    const replying = this.replyTarget?.key === key ? this.replyTarget : null;
    // The latest round's versions (답변 재생성 in a group): which one is shown, of how many.
    const lastItem = thread.at(-1);
    let rounds = null;
    if (contact.group && lastItem?.family) {
      const family = [...thread, ...(this.hiddenRounds || [])].filter(
        (item) =>
          item.family === lastItem.family && this.messageThreadOf(item) === key,
      );
      const list = this.roundsOf(family);
      rounds = {
        family: lastItem.family,
        count: list.length,
        index: list.findIndex((items) =>
          items.some((item) => item.id === lastItem.id),
        ),
      };
    }
    body.innerHTML = `
      <div class="sv-msg-thread-view" data-thread="${escapeHtml(key)}" data-tail="${escapeHtml(tail)}">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back sv-msg-back" data-thread-back aria-label="대화 목록" title="대화 목록"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
          <div class="sv-msg-who">${this.threadAvatarMarkup(contact)}<span class="sv-msg-who-text"><strong>${escapeHtml(contact.name)}</strong>${
            contact.group
              ? `<small>${
                  // A group named after its people would show the same names twice.
                  this.messageGroup(key)?.without_user
                    ? `나 없는 방 · ${contact.members.length}명`
                    : contact.name ===
                        contact.members.map((member) => member.name).join(", ")
                      ? `나 포함 ${contact.members.length + 1}명`
                      : contact.members
                          .map((member) => escapeHtml(member.name))
                          .join(", ")
                }</small>`
              : ""
          }</span></div>
          <button type="button" class="sv-msg-aloud ${aloud ? "sv-playing" : ""}" data-thread-aloud aria-pressed="${aloud}" aria-label="${aloud ? "듣기 멈추기" : "최근 답장 한 번에 듣기"}" title="${aloud ? "듣기 멈추기" : "최근 답장 한 번에 듣기: 가장 최근에 받은 문자 뭉치를 음성으로 만들며 차례로 재생합니다"}"><i class="fa-solid ${aloud ? (this.threadPlayback.making ? "fa-spinner fa-spin" : "fa-stop") : "fa-headphones"}" aria-hidden="true"></i></button>
          ${contact.group && !this.messageGroup(key)?.without_user && contact.members.length > 1 ? '<button type="button" class="sv-msg-aloud" data-group-call-room aria-label="단체 통화" title="단체 통화: 이 방 사람들에게 한꺼번에 전화합니다"><i class="fa-solid fa-phone" aria-hidden="true"></i></button>' : ""}
          <button type="button" class="sv-msg-group-edit" data-thread-more aria-haspopup="menu" aria-label="더 보기" title="더 보기: 내려받기 · 기억에서 빼기${contact.group ? " · 단체방 설정" : ""}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
        </header>
        <div class="sv-msg-list" role="log" aria-live="polite">
          ${
            thread.length
              ? this.leftOutRunsHtml(
                  thread,
                  key,
                  thread.map((item, index) => {
                    const before = thread[index - 1];
                    const sameSender =
                      before &&
                      before.role === item.role &&
                      (item.role === "user" ||
                        before.character_key === item.character_key);
                    // The name and time head a run of messages from one sender within a minute.
                    const head =
                      !sameSender ||
                      this.formatPhoneDate(before.created_at) !==
                        this.formatPhoneDate(item.created_at);
                    return this.messageBubbleHtml(item, {
                      latest: index === thread.length - 1 && !typing,
                      frozen: locked,
                      rounds,
                      head,
                      // Mine is read once they answer (or are typing); theirs once it is opened.
                      read:
                        item.role === "user"
                          ? typing ||
                            thread
                              .slice(index + 1)
                              .some((later) => later.role !== "user")
                          : !item.unread,
                      canQuote: !observing,
                      answered: answers.get(item.id) || "",
                      claims: claims.get(item.id),
                      sender:
                        contact.group && item.role !== "user"
                          ? this.memberContact({
                              key: item.character_key,
                              name: item.character_name,
                            })
                          : null,
                    });
                  }),
                )
              : `<p class="sv-msg-empty">${contact.group ? "단체방에 첫 문자를 보내 보십시오." : `${escapeHtml(contact.name)}에게 먼저 문자를 보내 보십시오.`}</p>`
          }
          ${typing ? '<div class="sv-msg-row sv-msg-theirs"><div class="sv-msg-bubble sv-msg-typing" aria-label="입력 중"><span class="sv-typing" aria-hidden="true"><i></i><i></i><i></i></span></div></div>' : ""}
        </div>
        ${
          this.messageGroup(key)?.without_user
            ? `<div class="sv-msg-observer">
          <small><i class="fa-solid fa-eye" aria-hidden="true"></i>나 없는 채팅방 · 한 번에 ${this.messageGroup(key).burst_min}~${this.messageGroup(key).burst_max}개</small>
          ${
            typing
              ? '<button type="button" data-group-stop><i class="fa-solid fa-stop" aria-hidden="true"></i><span>멈추기</span></button>'
              : '<button type="button" data-group-burst><i class="fa-solid fa-forward" aria-hidden="true"></i><span>대화 이어 보기</span></button>'
          }
        </div>`
            : ""
        }
        ${locked ? '<p class="sv-msg-frozen"><i class="fa-solid fa-lock" aria-hidden="true"></i>다른 봇카드에서 가져온 대화입니다. 보기만 할 수 있습니다</p>' : ""}
        ${observing ? "" : this.cardTrayHtml(key)}
        ${replying ? `<div class="sv-msg-replying"><i class="fa-solid fa-reply" aria-hidden="true"></i><span><b>${escapeHtml(replying.from || "")}</b>${escapeHtml(replying.text)}</span><button type="button" data-quote-clear aria-label="인용 취소" title="인용 취소"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>` : ""}
        ${this.cardWaiting === key && thread.at(-1)?.role === "user" && !typing ? '<p class="sv-msg-waiting"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>AI 응답 요청을 아직 보내지 않았습니다. 더 보낼 것이 있으면 보낸 뒤, 보내기 버튼을 누르면 답장이 옵니다.</span></p>' : ""}
        <form class="sv-msg-compose" ${observing ? "hidden" : ""}>
          <button type="button" class="sv-card-open" data-card-open aria-label="카드 보내기" title="카드 보내기: 사진·위치·약속·송금·선물" aria-expanded="${this.cardTray?.key === key}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
          <textarea id="sv-msg-input" rows="1" maxlength="2000" placeholder="보낼 내용 또는 대필 지시" aria-label="${escapeHtml(contact.name)}에게 보낼 문자"></textarea>
          <button type="button" class="sv-ghostwrite" data-ghostwrite aria-label="대필" title="대필: 내 페르소나로 보낼 문자를 대신 써 줍니다. 입력칸에 ‘늦는다고 사과해 줘’처럼 원하는 내용을 적어 두면 그 뜻대로 자연스럽게 쓰고, 써 둔 초안이면 다듬습니다. 비워 두면 알아서 씁니다." ${this.ghostwriteBusy === key ? "disabled" : ""}><i class="fa-solid ${this.ghostwriteBusy === key ? "fa-spinner fa-spin" : "fa-pen-nib"}" aria-hidden="true"></i></button>
          ${
            this.textReplyBusy === key
              ? '<button type="submit" class="sv-msg-stop" aria-label="응답 멈추기" title="응답 멈추기"><i class="fa-solid fa-stop" aria-hidden="true"></i></button>'
              : `<button type="submit" aria-label="보내기" title="${thread.at(-1)?.role === "user" ? "보내기 (Ctrl·⌘·Alt+Enter) · 비워 두고 누르면 마지막 문자에 대한 답장을 받습니다" : "보내기 (Ctrl·⌘·Alt+Enter)"}"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>`
          }
          ${this.draftTranslationHtml?.(key, this.messageDrafts[key]) || ""}
        </form>
      </div>`;
    const input = body.querySelector("#sv-msg-input");
    input.value = this.messageDrafts[key] || "";
    // Enter starts a new line (each line goes out as its own bubble); the box grows with it.
    // Its height is touched only when it has to change: every change of it makes the whole page
    // work out its layout again, which on a long chat is felt as lag on each key.
    let lastLength = input.value.length;
    const fit = () => {
      const shorter = input.value.length < lastLength && input.style.height;
      lastLength = input.value.length;
      if (!shorter && input.scrollHeight <= input.clientHeight) return;
      if (shorter) input.style.height = "auto";
      const height = `${Math.min(input.scrollHeight + 2, 110)}px`;
      if (input.style.height !== height) input.style.height = height;
    };
    // A redraw keeps the typing place on a desktop; on a phone it would pop the keyboard up.
    if (hadFocus && !this.isMobilePhoneLayout()) input.focus();
    const draftBox = body.querySelector("[data-draft-translation]");
    input.addEventListener("input", () => {
      this.messageDrafts[key] = input.value;
      this.syncDraftTranslation?.(draftBox, key, input.value);
      fit();
    });
    // Enter is a new line; with Ctrl, ⌘ or Alt it sends (not while a syllable is still being put together).
    input.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" ||
        // Safari ends a Korean or Japanese composition with an Enter that isn't marked composing.
        event.isComposing ||
        event.keyCode === 229 ||
        !(event.ctrlKey || event.metaKey || event.altKey)
      )
        return;
      event.preventDefault();
      send();
    });
    if (input.value) requestAnimationFrame(fit);
    // My text is the last one (its answer failed, or was deleted): an empty send asks for it.
    const lastMine = thread.at(-1)?.role === "user";
    const send = () => {
      // While their answer is being written the button stops it; what I typed stays in the box.
      if (this.textReplyBusy === key) {
        this.stopTextReply(key);
        return;
      }
      const value = input.value;
      if (!value.trim()) {
        if (lastMine && !typing) this.run(() => this.generateTextReply(key));
        return;
      }
      const translation = this.draftTranslationFor?.(key, value) || "";
      if (translation) this.draftTranslation = null;
      this.messageDrafts[key] = "";
      input.value = "";
      this.run(() => this.sendTextMessage(key, value, translation, quoted()));
    };
    // The message picked to answer goes with the next thing sent, once.
    const quoted = () => {
      const target = this.replyTarget?.key === key ? this.replyTarget : null;
      this.replyTarget = null;
      return target
        ? { quote: { id: target.id, from: target.from, text: target.text } }
        : {};
    };
    // A card goes out on its own and waits: what is typed in the box stays there, and their
    // answer is asked for only by the send button (so a photo and a text can go together).
    this.bindCardTray(body, key, (card) =>
      this.run(() =>
        this.sendTextMessage(
          key,
          card.title || "사진",
          "",
          { card: { ...card, solo: true }, ...quoted() },
          { reply: false },
        ),
      ),
    );
    // Answering a card of theirs sends my answer as a text, and asks for theirs.
    body.querySelectorAll("[data-card-answer]").forEach((button) =>
      button.addEventListener("click", () => {
        const card = this.cardAnswer(
          this.messageRecord(button),
          button.dataset.cardAnswer,
        );
        if (card)
          this.run(() => this.sendTextMessage(key, card.title, "", { card }));
      }),
    );
    // A pick-one of theirs: my choice goes out as a text that quotes the card.
    body.querySelectorAll("[data-poll-pick]").forEach((button) =>
      button.addEventListener("click", () => {
        const quote = this.quoteOfMessage(this.messageRecord(button));
        this.run(() =>
          this.sendTextMessage(
            key,
            button.dataset.pollPick,
            "",
            quote ? { quote } : {},
          ),
        );
      }),
    );
    body.querySelectorAll(".sv-msg-quote-btn").forEach((button) =>
      button.addEventListener("click", () => {
        const quote = this.quoteOfMessage(this.messageRecord(button));
        if (!quote) return;
        this.replyTarget = { key, ...quote };
        this.messageMoreOpen = "";
        this.renderSmartphone();
      }),
    );
    body.querySelector("[data-ghostwrite]").addEventListener("click", () =>
      this.run(async () => {
        if (this.ghostwriteBusy) return;
        this.ghostwriteBusy = key;
        await this.renderSmartphone();
        try {
          const text = await this.ghostwriteDraft(
            contact.group ? "group" : "text",
            key,
            this.messageDrafts[key] || "",
          );
          this.messageDrafts[key] = text;
        } finally {
          this.ghostwriteBusy = "";
          await this.renderSmartphone();
        }
      }),
    );
    body
      .querySelector(".sv-msg-compose")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        send();
      });
    body
      .querySelector("[data-group-stop]")
      ?.addEventListener("click", () => this.stopTextReply(key));
    body
      .querySelector("[data-group-call-room]")
      ?.addEventListener("click", () =>
        this.run(() =>
          this.startGroupCall(
            contact.members.slice(0, 4).map((member) => member.key),
          ),
        ),
      );
    body
      .querySelector("[data-group-burst]")
      ?.addEventListener("click", () =>
        this.run(() => this.continueGroupBurst(key)),
      );
    body.querySelector("[data-thread-back]").addEventListener("click", () => {
      this.messageThreadKey = "";
      this.videoPick = null;
      this.renderSmartphone();
    });
    const record = (button) => this.messageRecord(button);
    // The message playing now: its new button takes over from the one this redraw removed.
    const lit = body.querySelector(".sv-msg-play.sv-playing");
    if (lit && this.currentAudio) this.currentPlayButton = lit;
    body
      .querySelector("[data-thread-aloud]")
      ?.addEventListener("click", () =>
        this.run(() => this.playThreadAloud(key)),
      );
    // ⋯: what is used now and then (the header keeps 듣기 and the group call in sight).
    body
      .querySelector("[data-thread-more]")
      .addEventListener("click", (event) => {
        const button = event.currentTarget;
        this.run(async () => {
          const reach = this.roomReach(key);
          const picked = await this.pickFromMenu(button, [
            {
              id: "download",
              icon: "fa-download",
              label: "음성 내려받기",
            },
            ...(this.canMakeCallVideo?.()
              ? [
                  {
                    id: "video-last",
                    icon: "fa-film",
                    label: "영상 저장 · 마지막 대화",
                  },
                  {
                    id: "video-pick",
                    icon: "fa-film",
                    label: "영상 저장 · 구간 고르기",
                  },
                  {
                    id: "video-all",
                    icon: "fa-film",
                    label: "영상 저장 · 전체 대화 (많으면 길어짐)",
                  },
                ]
              : []),
            ...(reach
              ? [
                  {
                    id: "back",
                    icon: `fa-brain sv-reach-${reach}`,
                    label: "이 방 기억에 다시 넣기",
                  },
                ]
              : this.chatMemoryOn?.()
                ? this.reachMenuItems()
                : [
                    {
                      id: "all",
                      icon: "fa-brain",
                      label: "스마트폰 기억에서 빼기",
                    },
                  ]),
            ...(contact.group
              ? [
                  {
                    id: "group",
                    icon: "fa-user-group",
                    label: "단체방 설정",
                  },
                ]
              : []),
          ]);
          if (picked === "group") return this.openGroupEditor(key);
          if (picked === "video-pick") return this.startVideoPick(key);
          if (picked === "video-last" || picked === "video-all")
            return this.downloadThreadVideo(
              key,
              picked === "video-all" ? "all" : "last",
            );
          if (picked === "download")
            return this.withBusyButton(button, () =>
              this.downloadThreadAudio(key),
            );
          if (!picked) return;
          await this.setRoomReach(key, picked === "back" ? "" : picked);
          await this.renderSmartphone();
        });
      });
    body.querySelectorAll(".sv-msg-play").forEach((button) =>
      button.addEventListener("click", () => {
        const item = record(button);
        if (item.audio_url)
          this.playMessageAudio(item, this.apiUrl(item.audio_url), button);
        else this.generateVoiceMessageAudio(item, button);
      }),
    );
    body
      .querySelectorAll(".sv-msg-reroll")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.generateVoiceMessageAudio(record(button), button, true),
        ),
      );
    body
      .querySelectorAll(".sv-msg-delete")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() => this.deleteMessage(record(button))),
        ),
      );
    body.querySelectorAll(".sv-msg-forget").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(async () => {
          const item = record(button);
          await this.setTextForgotten(
            item,
            !this.forgottenTexts().has(String(item.id)),
          );
          await this.renderSmartphone();
        }),
      ),
    );
    this.bindMessageMore(body);
    // 구간 고르기 goes on over a room drawn again (a message arriving meanwhile).
    if (this.videoPick?.key === key) this.showVideoPick(body);
    else this.videoPick = null;
    body
      .querySelectorAll(".sv-msg-round")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() =>
            this.switchRound(
              key,
              button.dataset.family,
              Number(button.dataset.index),
            ),
          ),
        ),
      );
    body
      .querySelectorAll(".sv-msg-version")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() =>
            this.switchMessageVersion(
              record(button),
              Number(button.dataset.version),
            ),
          ),
        ),
      );
    body
      .querySelectorAll(".sv-msg-again")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() => this.regenerateMessage(record(button))),
        ),
      );
    body
      .querySelectorAll(".sv-msg-edit")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() => this.editVoiceMessage(record(button))),
        ),
      );
    body
      .querySelectorAll(".sv-msg-share")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() => this.shareVoiceMessage(record(button))),
        ),
      );
    body.querySelectorAll(".sv-msg-forward-play").forEach((button) =>
      button.addEventListener("click", () => {
        const item = record(button);
        if (this.playingMessageId === item.id && this.currentAudio) {
          this.stopPlayback();
          return;
        }
        this.playMessageAudio(
          { ...item, kind: "voice" },
          this.apiUrl(item.audio_url),
          button,
        );
      }),
    );
    // The + tray, the quote bar and the waiting note sit at the end: shown, they are in view.
    if (aloud) this.showThreadMaking();
    if (this.cardTray?.key === key || replying || this.cardWaiting === key)
      body.scrollTop = body.scrollHeight;
    else if (!(aloud && this.showReadingMessage(body)))
      body.scrollTop = keepScroll ?? body.scrollHeight;
  },

  /**
   * Plays one message's voice, lighting its play button for as long as it sounds (also after
   * the conversation is redrawn). `onEnded`/`onStop` as in playAudio.
   */
  playMessageAudio(
    item,
    url,
    button = null,
    { revoke = false, onEnded = null, onStop = null } = {},
  ) {
    const done = (callback) => () => {
      if (this.playingMessageId === item.id) this.playingMessageId = "";
      document
        .querySelectorAll("#sv-smartphone .sv-msg-play.sv-playing")
        .forEach((lit) => lit.classList.remove("sv-playing"));
      document
        .querySelectorAll("#sv-smartphone .sv-msg-reading")
        .forEach((row) => row.classList.remove("sv-msg-reading"));
      callback?.();
    };
    this.playingMessageId = item.id;
    const lit = button || this.messagePlayButton(item.id);
    lit?.closest(".sv-msg-row")?.classList.add("sv-msg-reading");
    this.playWithSounds(url, item.script, lit, revoke, {
      mixed: Boolean(item.sounds_mixed),
      communicationFilter:
        (item.kind || "voice") === "voice" &&
        this.shouldApplyCommunicationFilter("voice_message", item),
      onEnded: done(onEnded),
      onStop: done(onStop),
    });
  },

  /** 내려받기: only messages that already have a voice (making them for a whole room would cost too much). */
  async downloadThreadAudio(key) {
    const thread = (await this.loadMessages()).filter(
      (item) => this.messageThreadOf(item) === key,
    );
    const voiced = thread.filter((item) => item.audio_url);
    if (!voiced.length)
      throw new Error(
        "내려받을 음성이 없습니다. 목소리를 만든(들어 본) 문자만 들어갑니다.",
      );
    const files = await this.downloadJoinedAudio(
      voiced.map((item) => ({
        url: this.apiUrl(item.audio_url),
        filter:
          (item.kind || "voice") === "voice" &&
          this.shouldApplyCommunicationFilter("voice_message", item),
      })),
      `${this.threadContact(key).name}-문자-${this.fileStamp()}`,
      { gap: 0.8 },
    );
    const notes = [];
    if (files > 1) notes.push(`길어서 30분씩 ${files}개 파일로 나눴습니다.`);
    if (thread.length > voiced.length)
      notes.push(
        `목소리를 만들지 않은 문자 ${thread.length - voiced.length}개는 빠졌습니다.`,
      );
    if (notes.length) this.notify(notes.join(" "), "info");
  },

  /** ⋯ under a message shows its other buttons (one message at a time), and 내려받기 among them. */
  bindMessageMore(body) {
    // The buttons opened with ⋯ go back behind it at a click anywhere else in the phone (Esc too).
    body.svCloseMore = (event) => {
      // What was clicked may already be gone from the page (+ turned into its box): not "elsewhere".
      if (event.type === "click" && !event.target.isConnected) return;
      if (
        event.target
          .closest?.(".sv-msg-meta")
          ?.querySelector(".sv-msg-extra:not([hidden])")
      )
        return;
      const open = body.querySelector('.sv-msg-more[aria-expanded="true"]');
      if (!open) return;
      open.setAttribute("aria-expanded", "false");
      open.nextElementSibling.hidden = true;
      this.messageMoreOpen = "";
      if (event.type === "keydown") open.focus();
    };
    if (!body.dataset.svMoreBound) {
      body.dataset.svMoreBound = "1";
      body.addEventListener("click", (event) => body.svCloseMore?.(event));
      body.addEventListener("keydown", (event) => {
        if (event.key === "Escape") body.svCloseMore?.(event);
      });
    }
    body.querySelectorAll(".sv-msg-more").forEach((button) =>
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") !== "true";
        body.querySelectorAll(".sv-msg-more").forEach((other) => {
          other.setAttribute("aria-expanded", "false");
          other.nextElementSibling.hidden = true;
        });
        button.setAttribute("aria-expanded", String(open));
        button.nextElementSibling.hidden = !open;
        this.messageMoreOpen = open ? button.dataset.id : "";
        // ⋯ steps aside while its buttons are out: the keyboard's place moves on to them.
        if (open) button.nextElementSibling.querySelector("button")?.focus();
      }),
    );
    body.querySelectorAll("[data-react]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(async () => {
          await this.reactToMessage(button.dataset.id, button.dataset.react);
          this.messageMoreOpen = "";
          await this.renderSmartphone();
        }),
      ),
    );
    // Any other emoji: the + turns into a small box to type (or paste) one into.
    body.querySelectorAll("[data-react-own]").forEach((button) =>
      button.addEventListener("click", () => {
        const box = document.createElement("input");
        box.type = "text";
        box.className = "sv-msg-react-input";
        box.maxLength = 24;
        box.placeholder = "🙂";
        box.setAttribute("aria-label", "반응으로 남길 이모지");
        // Enter and leaving the box both say "done": it is left once.
        let left = false;
        const leave = () => {
          const emoji = box.value.trim();
          if (!emoji || left) return;
          if (!validReaction(emoji)) {
            this.notify("이모지 하나만 넣어 주십시오.", "info");
            return;
          }
          left = true;
          this.run(async () => {
            await this.reactToMessage(button.dataset.id, emoji);
            this.messageMoreOpen = "";
            await this.renderSmartphone();
          });
        };
        box.addEventListener("change", leave);
        box.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            leave();
          }
        });
        button.replaceWith(box);
        box.focus();
      }),
    );
    body
      .querySelectorAll(".sv-msg-save")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.run(() =>
            this.withBusyButton(button, () =>
              this.downloadMessageVoice(this.messageRecord(button)),
            ),
          ),
        ),
      );
  },

  /** One message's voice as a file. */
  async downloadMessageVoice(item) {
    if (!item?.audio_url) throw new Error("내려받을 음성이 없습니다.");
    await this.downloadJoinedAudio(
      [
        {
          url: this.apiUrl(item.audio_url),
          filter:
            (item.kind || "voice") === "voice" &&
            this.shouldApplyCommunicationFilter("voice_message", item),
        },
      ],
      `${item.role === "user" ? this.userCharacterName() : item.character_name || "문자"}-문자-${this.fileStamp()}`,
    );
  },

  /**
   * 한 번에 듣기 waiting for a voice still being made: the listen button turns while it waits,
   * and that message is marked, so a gap between two voices doesn't look like the end.
   */
  showThreadMaking() {
    const state = this.threadPlayback;
    const icon = document.querySelector(
      "#sv-smartphone [data-thread-aloud].sv-playing i",
    );
    if (icon)
      icon.className = `fa-solid ${state?.making ? "fa-spinner fa-spin" : "fa-stop"}`;
    document
      .querySelectorAll("#sv-smartphone .sv-msg-making")
      .forEach((row) => row.classList.remove("sv-msg-making"));
    if (state?.making)
      this.messagePlayButton(state.making)
        ?.closest(".sv-msg-row")
        ?.classList.add("sv-msg-making");
  },

  /**
   * 한 번에 듣기 in the conversation shown: the message being read is put mid-screen. Done when
   * the conversation is drawn too, since a draw (a voice made ahead being saved) would otherwise
   * put the view back where it was, or at the end. False when nothing is being read here.
   */
  showReadingMessage(shown = null, smooth = false) {
    const row =
      this.threadPlayback?.at &&
      this.messagePlayButton(this.threadPlayback.at)?.closest(".sv-msg-row");
    const body = row && (shown || row.closest(".sv-smartphone-body"));
    if (!body?.contains(row)) return false;
    const top =
      body.scrollTop +
      row.getBoundingClientRect().top -
      body.getBoundingClientRect().top -
      (body.clientHeight - row.offsetHeight) / 2;
    if (smooth && body.scrollTo) body.scrollTo({ top, behavior: "smooth" });
    else body.scrollTop = top;
    return true;
  },

  messagePlayButton(id) {
    return document.querySelector(
      `#sv-smartphone .sv-msg-play[data-id="${CSS.escape(String(id))}"]`,
    );
  },

  /** The message a bubble's button belongs to, as it was drawn. */
  messageRecord(button) {
    return this.messageRecords?.get(button.dataset.id) || null;
  },

  /**
   * 한 번에 듣기: the latest batch received (the replies after the user's last text; if the user
   * wrote last, the batch before that; in a room without the user, its last round), up to 15,
   * voiced and played in a row. The next one is made while one plays. Pressed again, it stops.
   * `kept`: a conversation of 미적용 기억 (its messages): every one that has a voice already is
   * played, in order, and none is made.
   */
  async playThreadAloud(key, kept = null) {
    const playing = kept ? `away:${key}` : key;
    // Stopped at once, also while it waits for a voice: the run lets go of the button and its
    // marks now, and ends by itself when the voice it was waiting for is back.
    const halt = async () => {
      const running = this.threadPlayback;
      running.stopped = true;
      running.making = "";
      this.threadPlayback = null;
      this.stopPlayback();
      this.showThreadMaking();
      if (this.phoneActiveTab === "message") await this.renderSmartphone();
    };
    if (this.threadPlayback?.key === playing) return halt();
    if (this.threadPlayback) await halt();
    let batch;
    if (kept) batch = kept.filter((item) => item.audio_url);
    else {
      const thread = (await this.loadMessages()).filter(
        (item) => this.messageThreadOf(item) === key,
      );
      // The run of received messages at the end, past any texts of the user's still unanswered.
      let end = thread.length;
      while (end > 0 && thread[end - 1].role === "user") end--;
      let start = end;
      while (start > 0 && thread[start - 1].role !== "user") start--;
      batch = thread.slice(start, end);
      // A room without the user is one long run: only its last round (one 대화 이어 보기).
      const mark = batch.at(-1)?.reason;
      if (this.messageGroup(key)?.without_user && mark?.startsWith("round-"))
        batch = batch.filter((item) => item.reason === mark);
      batch = batch.slice(-15);
    }
    if (!batch.length) {
      this.notify("들을 문자가 없습니다.");
      return;
    }
    const operation = this.captureChat();
    const state = { key: playing, stopped: false };
    this.threadPlayback = state;
    this.unlockAudioForMobile();
    await this.renderSmartphone();
    const made = [];
    const settled = new Set();
    // The first try keeps a failure to itself; the second one shows it.
    const make = (item, quiet = false) =>
      this.generateVoiceMessageAudio(item, null, false, { play: false, quiet });
    const prepare = (index) =>
      index < batch.length
        ? (made[index] ||= (
            batch[index].audio_url
              ? Promise.resolve({
                  url: this.apiUrl(batch[index].audio_url),
                  revoke: false,
                })
              : make(batch[index], true)
                  // A voice that failed is asked for once more, a moment later.
                  .catch(() =>
                    new Promise((resolve) => setTimeout(resolve, 1500)).then(
                      () => (over() ? null : make(batch[index])),
                    ),
                  )
                  .then((url) => (url ? { url, revoke: true } : null))
                  .catch(() => null)
          ).finally(() => settled.add(index)))
        : null;
    // Stopped, or the chat changed (the rest belonged to the conversation shown before).
    const over = () => state.stopped || operation.signal.aborted;
    let heard = -1;
    try {
      for (let index = 0; index < batch.length && !over(); index++) {
        // Two voices first, and two more whenever it catches up with the making, so a slow one
        // doesn't leave a gap midway.
        if (!settled.has(index) && !batch[index].audio_url) {
          // Still being made: the view goes to it and shows that it is on its way.
          state.at = batch[index].id;
          state.making = batch[index].id;
          this.showThreadMaking();
          this.showReadingMessage(null, true);
        }
        if (index === 0 || !settled.has(index))
          await Promise.all([prepare(index), prepare(index + 1)]);
        const ready = await prepare(index);
        if (state.making) {
          state.making = "";
          this.showThreadMaking();
        }
        if (over()) {
          if (ready?.revoke) URL.revokeObjectURL(ready.url);
          break;
        }
        prepare(index + 1);
        prepare(index + 2);
        heard = index;
        if (!ready) continue;
        // The message being read comes into view, so a long run can be followed without scrolling.
        state.at = batch[index].id;
        this.showReadingMessage(null, true);
        await new Promise((resolve) =>
          this.playMessageAudio(batch[index], ready.url, null, {
            revoke: ready.revoke,
            onEnded: resolve,
            onStop: () => {
              state.stopped = true;
              resolve();
            },
          }),
        );
        if (!over() && index + 1 < batch.length)
          await new Promise((resolve) => setTimeout(resolve, 380));
      }
    } finally {
      // A voice made ahead and not heard is let go.
      for (const ahead of made.slice(heard + 1))
        ahead?.then((ready) => ready?.revoke && URL.revokeObjectURL(ready.url));
      if (this.threadPlayback === state) this.threadPlayback = null;
      if (this.phoneActiveTab === "message") await this.renderSmartphone();
    }
  },

  /**
   * Whether someone texting one to one may say they'll call right away (call_after): calls of
   * theirs are switched on (나에게 전화), they are a contact who reaches out, and the
   * line is free.
   */
  canCallAfterText(key) {
    return (
      !this.isGroupThread(key) &&
      this.autoCallOn() &&
      !this.phoneSession &&
      !this.phonePendingEvent &&
      !this.config.character_voices?.[key]?.no_state &&
      this.phoneContacts().some((contact) => contact.key === key)
    );
  },

  /**
   * They said in a text that they'll call now: their call rings a few seconds after it, unless
   * the line is taken by then or the chat changed.
   */
  callAfterText(character, text = "") {
    clearTimeout(this.callAfterTimer);
    const operation = this.captureChat();
    this.callAfterTimer = setTimeout(
      () =>
        this.run(async () => {
          // Not while the chat is writing a reply: the call would cut into it.
          if (
            operation.signal.aborted ||
            this.phoneSession ||
            this.phonePendingEvent ||
            this.generatingSince ||
            !this.autoCallOn()
          )
            return;
          await this.ringIncomingCall(
            {
              candidate: {
                type: "incoming_call",
                urgency: "high",
                reason: `They texted ${this.userCharacterName()} that they would call right away, and now call. Their text: ${String(text).replace(/\s+/g, " ").slice(0, 300)}`,
              },
              callerKey: character.key,
              caller: character.name,
            },
            "",
          );
        }),
      3500 + Math.random() * 3000,
    );
  },

  /** The user texts someone; their reply follows after a short pause for more texts. */
  /** `extra`: more fields for the saved text (음성 전달: what is forwarded with it). */
  /** `reply: false`: sent, but their answer waits until I press send (a card, with more to add). */
  async sendTextMessage(
    key,
    value,
    translation = "",
    extra = {},
    { reply = true } = {},
  ) {
    this.unlockAudioForMobile();
    const text = String(value || "")
      .trim()
      .slice(0, 2000);
    if (!text) return;
    // I texted them first: no getting back to my voicemail on top of their reply.
    this.cancelVoicemailAnswer?.(key);
    const contact = this.threadContact(key);
    const identity = this.getStateIdentity();
    const anchor = this.currentPhoneAnchor();
    const response = await this.fetch(
      this.apiUrl("/api/plugins/scenevoice/voice-messages"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: identity.chatId,
          anchor_message_id: String(anchor.index),
          ...this.anchorStamp(anchor.index),
          character_key: key,
          character_name: contact.name,
          ...(contact.group ? { thread_key: key } : {}),
          role: "user",
          kind: "text",
          origin: "reply",
          text,
          ...(translation ? { translation } : {}),
          language: this.scriptLanguage(text) || this.chatLanguage(),
          ...(this.visitOf ? { away: true } : {}),
          ...extra,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "문자를 보내지 못했습니다.");
    this.playMessageTone("send");
    await this.persistTextThreadMemory(key, anchor.index);
    this.cardWaiting = reply ? "" : key;
    await this.renderSmartphone();
    if (reply) this.queueTextReply(key);
  },

  /** Their texts in the conversation just opened are read from now on (kept with the messages). */
  markMessagesRead(ids) {
    this.request("/api/plugins/scenevoice/voice-messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.getStateIdentity().chatId, ids }),
    }).catch((error) =>
      console.warn("[SceneVoice] 읽음 표시 저장 실패", error),
    );
  },

  /** Each conversation waits its own short pause for more texts; others are not affected. */
  queueTextReply(key) {
    clearTimeout(this.textReplyTimers.get(key));
    this.textReplyTimers.set(
      key,
      setTimeout(() => {
        this.textReplyTimers.delete(key);
        this.run(() => this.generateTextReply(key));
      }, 1600),
    );
  },

  /**
   * 응답 멈추기: the answer being written for this conversation is dropped (the request ends,
   * nothing more of it is saved). The send button asks for it again.
   */
  stopTextReply(key) {
    if (this.textReplyBusy !== key || !this.textReplyStop) return;
    clearTimeout(this.textReplyTimers?.get(key));
    this.textReplyTimers?.delete(key);
    this.textReplyAgain?.delete(key);
    this.cardWaiting = key;
    this.textReplyStop.abort(
      new DOMException("응답을 멈췄습니다.", "AbortError"),
    );
  },

  /** The character answers the user's latest texts: usually by text, sometimes by voice. */
  async generateTextReply(key) {
    if (this.textReplyBusy) {
      this.textReplyAgain.add(key);
      return;
    }
    if (this.cardWaiting === key) this.cardWaiting = "";
    const operation = this.captureChat();
    const profileId =
      this.config.phone?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    if (!profileId || !this.connectionService)
      throw new Error("답장에 쓸 실리태번 연결 프로필을 먼저 골라 주십시오.");
    // That conversation is open (the list doesn't count: an answer there stays unread).
    const viewing = () =>
      !document.getElementById("sv-smartphone")?.classList.contains("hidden") &&
      this.phoneActiveTab === "message" &&
      this.messageThreadKey === key;
    this.textReplyBusy = key;
    const stop = (this.textReplyStop = new AbortController());
    if (viewing()) await this.renderSmartphone();
    try {
      if (this.isGroupThread(key)) {
        await this.generateGroupReply(key, {
          operation,
          profileId,
          viewing,
          signal: stop.signal,
        });
        return;
      }
      const whole = this.keptForAI(await this.loadMessages(), key).filter(
        (item) => this.messageThreadOf(item) === key,
      );
      const thread = this.lastTexts ? this.lastTexts(whole) : whole.slice(-40);
      if (thread.at(-1)?.role !== "user") return;
      const character = this.phoneContact(key);
      // Answer in the language the user is texting in.
      const language = this.conversationLanguage(
        thread.slice(-6).map((item) => item.text),
        [...thread].reverse().find((item) => item.role === "user")?.text,
        key,
      );
      const allowVoice = this.config.voice_message?.reply_voice !== false;
      const {
        blocks: stateBlocks,
        absent,
        unknown,
      } = this.stateBlocks(await this.stateForPrompt(key));
      const emotions = Array.from(this.analysisEmotionCandidates()).sort();
      const canCall = this.canCallAfterText(key);
      const me = this.userCharacterName();
      const status = await this.statusLine?.(key).catch(() => "");
      const { images, unseen } = await this.threadImages(thread);
      // 다른 인물에게 전하기: offered only now and then, and only while people text each other.
      const acquaintances = this.overheardTextsOn?.()
        ? this.statePeople().filter(
            (person) => !person.hidden && person.key !== key,
          )
        : [];
      const mayTell = acquaintances.length > 0 && Math.random() < TELL_CHANCE;
      const messages = phoneMessages(
        textSystem({
          mayTell,
          emotions,
          language,
          translation: this.wantsTranslation(language),
          replying: true,
          photos: unseen.some(Boolean),
          allowVoice,
          soundEffects: this.phoneSoundEffects(character.key),
          fixedLanguage: this.languageIsFixed(key),
          absent,
          unknown,
          canCall,
          statusLine: typeof status === "string",
          style: this.config.prompts?.text_style,
          cards: this.cardKindsOn(),
          openCard: this.hasOpenCard(thread),
        }),
        [
          dataBlock("user_character", me),
          dataBlock("target_character", character.name),
          dataBlock("profile", this.phoneRoleplayProfile()),
          dataBlock("performance_note", character.note, {
            range: this.emotionalRange(character.key),
          }),
          ...stateBlocks,
          dataBlock(
            "recent_chat",
            this.buildRecentChatContext(
              this.config.phone?.context_messages ?? 10,
            ),
          ),
          ...((await this.statusLinesBlocks?.()) || []),
          ...((await this.worldInfoBlocks?.(thread.map((item) => item.text))) ||
            []),
          ...this.currentTimeBlocks([key]),
          dataBlock("previous_calls", await this.loadPreviousCalls(key)),
          ...(mayTell
            ? [
                dataBlock(
                  "people_they_know",
                  acquaintances.map((person) => person.name),
                ),
              ]
            : []),
          ...((await this.otherChatsBlocks?.([key], key)) || []),
          dataBlock(
            "text_thread",
            this.textThreadData(thread, character.name, this.realtimeFor(key)),
          ),
        ],
        textFinal(character.name, language, me),
      );
      this.assertChat(operation);
      this.assertChat(operation);
      const parsed = await this.requestSpokenReply(
        profileId,
        messages,
        900,
        null,
        { images, signal: stop.signal },
      );
      this.assertChat(operation);
      if (stop.signal.aborted) return;
      await this.notePhotosSeen(parsed, unseen);
      const kind =
        allowVoice && String(parsed?.type).toLowerCase() === "voice"
          ? "voice"
          : "text";
      const record = await this.saveCharacterMessage({
        character,
        kind,
        origin: "reply",
        parsed,
        thread,
      });
      await this.textStatusChange(character, parsed, status);
      if (mayTell && parsed?.tell)
        this.tellSomeone(character, parsed.tell, acquaintances).catch((error) =>
          console.warn("[SceneVoice] 다른 인물에게 전하기 실패", error),
        );
      if (!viewing())
        this.announceText(key, character.name, record?.text, kind);
      if (canCall && parsed?.call_after === true)
        this.callAfterText(character, record?.text);
    } catch (error) {
      // Stopped by the user: not an error.
      if (!stop.signal.aborted || operation.signal.aborted) throw error;
    } finally {
      if (this.textReplyStop === stop) this.textReplyStop = null;
      if (!operation.signal.aborted) {
        this.textReplyBusy = "";
        if (viewing()) await this.renderSmartphone();
        // The next conversation texted meanwhile gets its answer now.
        const [again] = this.textReplyAgain;
        if (again) {
          this.textReplyAgain.delete(again);
          this.queueTextReply(again);
        }
      }
    }
  },

  async deleteMessage(item) {
    if (
      !confirm(
        item.role === "user"
          ? "보낸 문자를 지우시겠습니까?"
          : "이 문자를 지우시겠습니까?",
      )
    )
      return;
    const response = await this.request(
      `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: item.chat_id }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "문자를 지우지 못했습니다.");
    await this.forgetMessageMemory(item);
    await this.renderSmartphone();
  },

  /** Chat memory follows a deleted or replaced message (one in 미적용 기억: its own swipe's). */
  async forgetMessageMemory(item) {
    const texts = (item.kind || "voice") === "text" || item.origin === "reply";
    if (!this.anchorShown(item))
      await this.forgetSwipeMemory(
        item,
        texts ? this.messageThreadOf(item) : "",
      );
    else if (texts)
      await this.persistTextThreadMemory(
        this.messageThreadOf(item),
        item.anchor_message_id,
      );
    else await this.removeChatMemoryEvent(item.anchor_message_id, item.id);
  },

  /** The newest message of a conversation, written again from the same point. */
  async regenerateMessage(item) {
    if (this.textReplyBusy || this.voiceMessageBusy) return;
    const key = this.messageThreadOf(item);
    if (this.messageGroup(key)?.without_user) {
      await this.regenerateGroupBurst(key);
      return;
    }
    if (this.isGroupThread(key)) {
      // What the members wrote by themselves is written again the same way.
      if (item.origin === "incoming") await this.regenerateGroupBurst(key);
      else await this.regenerateGroupReply(key);
      return;
    }
    // Set aside, not deleted: the new answer keeps it as an earlier version (‹ › to compare).
    // If no new answer comes, it comes back as it was.
    const stash = async (stashed) => {
      const response = await this.request(
        `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}/stash`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: item.chat_id, stashed }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json()).detail || "문자를 다시 받을 수 없습니다.",
        );
    };
    await stash(true);
    await this.forgetMessageMemory(item);
    const replacing = (this.replacingMessage = {
      key,
      id: item.id,
      done: false,
    });
    try {
      if (item.origin === "reply") {
        await this.renderSmartphone();
        await this.generateTextReply(key);
      } else
        await this.generateIncomingVoiceMessage({
          type:
            (item.kind || "voice") === "text"
              ? "text_message"
              : "voice_message",
          reason: item.reason || "",
          callerKey: key,
          sourceMessageId: item.anchor_message_id,
          again: true,
        });
    } finally {
      if (this.replacingMessage === replacing) this.replacingMessage = null;
      if (!replacing.done) {
        await stash(false);
        await this.rememberMessage(item);
        await this.renderSmartphone();
      }
    }
  },

  /** What the chat memory holds of a message: its thread's texts, or its own voice message. */
  async rememberMessage(item) {
    if ((item.kind || "voice") === "text" || item.origin === "reply")
      await this.persistTextThreadMemory(
        this.messageThreadOf(item),
        item.anchor_message_id,
      );
    else
      await this.persistVoiceMessageToMessage({
        ...item,
        type: "voice_message",
        reason: item.reason || "",
      });
  },

  /** ‹ ›: another of the message's answers becomes the one shown, used and remembered. */
  async switchMessageVersion(item, index) {
    if (this.textReplyBusy || this.voiceMessageBusy) return;
    const response = await this.request(
      `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}/version`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: item.chat_id, index }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "다른 답으로 바꾸지 못했습니다.");
    if (this.playingMessageId === item.id) this.stopPlayback();
    await this.forgetMessageMemory(item);
    await this.rememberMessage(data.item);
    await this.renderSmartphone();
  },

  /** A group's latest round of answers, taken back and asked for again after the user's texts. */
  async regenerateGroupReply(key) {
    const thread = (await this.loadMessages()).filter(
      (item) => this.messageThreadOf(item) === key,
    );
    const start = thread.map((item) => item.role).lastIndexOf("user") + 1;
    const round = thread.slice(start);
    if (!start || !round.length) return;
    await this.regenerateRound(key, round, async () => {
      await this.renderSmartphone();
      await this.generateTextReply(key);
    });
  },

  /** Shows or hides messages of a group (one round of answers kept behind another). */
  async setRoundHidden(items, hidden, { round = "", family = "" } = {}) {
    if (!items.length) return;
    const response = await this.request(
      "/api/plugins/scenevoice/voice-messages/visibility",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: items[0].chat_id,
          ids: items.map((item) => item.id),
          hidden,
          round,
          family,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json()).detail || "문자를 바꾸지 못했습니다.",
      );
  },

  /**
   * 답변 재생성 of a group's round: the round is kept hidden as an earlier version (‹ › brings it
   * back) and `ask` brings a new round in the same family; with no new round, it shows again.
   */
  async regenerateRound(key, round, ask) {
    const family =
      round.find((item) => item.family)?.family || `family-${round[0].id}`;
    const anchors = () =>
      new Set(round.map((item) => String(item.anchor_message_id)));
    await this.setRoundHidden(round, true, {
      round: round[0].round || `round-${round[0].id}`,
      family,
    });
    for (const anchor of anchors())
      await this.persistTextThreadMemory(key, anchor);
    const replacing = (this.roundFamily = { key, family, done: false });
    try {
      await ask();
    } finally {
      if (this.roundFamily === replacing) this.roundFamily = null;
      if (!replacing.done) {
        await this.setRoundHidden(round, false);
        for (const anchor of anchors())
          await this.persistTextThreadMemory(key, anchor);
        await this.renderSmartphone();
      }
    }
  },

  /** ‹ ›: another round of the family is shown (and used, and remembered) in place of this one. */
  async switchRound(key, family, index) {
    if (this.textReplyBusy || this.voiceMessageBusy) return;
    const everything = (await this.loadMessages({ hidden: true })).filter(
      (item) => this.messageThreadOf(item) === key && item.family === family,
    );
    const rounds = this.roundsOf(everything);
    const target = rounds[index];
    const shown = rounds.find((items) => items.some((item) => !item.hidden));
    if (!target || target === shown) return;
    if (
      this.playingMessageId &&
      everything.some((item) => item.id === this.playingMessageId)
    )
      this.stopPlayback();
    await this.setRoundHidden(shown || [], true);
    await this.setRoundHidden(target, false);
    for (const anchor of new Set(
      everything.map((item) => String(item.anchor_message_id)),
    ))
      await this.persistTextThreadMemory(key, anchor);
    await this.renderSmartphone();
  },

  /** A family's messages as rounds, oldest round first. */
  roundsOf(items) {
    const rounds = new Map();
    for (const item of items) {
      const id = item.round || `round-${item.id}`;
      if (!rounds.has(id)) rounds.set(id, []);
      rounds.get(id).push(item);
    }
    return [...rounds.values()].sort((a, b) =>
      String(a[0].created_at).localeCompare(String(b[0].created_at)),
    );
  },

  /** The thread for prompts: my lines under my character's name, never "USER". */
  textThreadData(thread, name, timed = false) {
    const me = this.userCharacterName?.() || "User";
    // n: what a reply's reply_to points at. read: whether I opened their text (one to one).
    // card_open: a card of mine nobody answered yet (their reply may accept or decline it).
    const answers = this.cardAnswers?.(thread) || new Map();
    const claims = this.cardClaims?.(thread) || new Map();
    // A claim card still open: what each member who hasn't opened it would find (card_draw).
    const draw = (item) => {
      const left = item.card?.claim ? this.claimLeft(item, claims) : [];
      return left.length
        ? {
            card_open: true,
            card_draw: Object.fromEntries(
              left.map((member) => [
                member,
                claimOutcome(item.card, member) || "nothing",
              ]),
            ),
          }
        : {};
    };
    return thread.map((item, index) => ({
      n: index + 1,
      from:
        item.role === "user"
          ? me
          : item.thread_key
            ? item.character_name
            : name,
      kind: item.kind || "voice",
      text: this.messageWords(item),
      ...(item.reactions?.length
        ? {
            reactions: item.reactions.map((reaction) => ({
              by: reaction.by === "user" ? me : reaction.name || name,
              emoji: reaction.emoji,
            })),
          }
        : {}),
      ...(item.role !== "user" || !cardCanBeAnswered(item.card)
        ? {}
        : item.card.claim
          ? draw(item)
          : answers.has(item.id)
            ? {}
            : { card_open: true }),
      ...(item.role !== "user" && !item.thread_key
        ? { read: !item.unread }
        : {}),
      ...(timed
        ? {
            sent_at: this.realTimeLabel(
              item.created_at,
              this.timeZoneFor(item.character_key),
            ),
          }
        : {}),
    }));
  },

  /**
   * A message as prompts and the chat memory read it: a forwarded recording (음성 전달) brings
   * what was said in it, and my note when there is one.
   */
  messageWords(item) {
    const forward = item?.forward;
    // A card and a quoted message come first, each as a bracket line.
    if (!forward)
      return [
        this.quoteLine?.(item?.quote),
        this.cardLine?.(item?.card),
        item?.card?.solo ? "" : item?.text || "",
      ]
        .filter(Boolean)
        .join("\n");
    const kind =
      {
        call: "a recording of a phone call",
        memo: "a voice memo recording",
        voice: "a voice message",
      }[forward.type] || "a recording";
    return [
      ...(forward.note ? [item.text] : []),
      `[Forwarded ${kind}: ${forward.title}]`,
      ...forward.lines.map((line) => `${line.from}: ${line.text}`),
    ].join("\n");
  },

  /** Saves the character's text or voice message from a model reply; returns the saved record. */
  async saveCharacterMessage({
    character,
    kind,
    origin,
    parsed,
    reason = "",
    anchorIndex = null,
    threadKey = "",
    round = "",
    thread = null,
  }) {
    const draft = this.normalizePhoneDraft(parsed, reason);
    // A text may answer a card of mine or bring a card of its own (one or the other), and quote a
    // message of the thread it was written from.
    const card =
      kind === "text"
        ? (thread && this.cardAnswerFromReply?.(parsed, thread, character)) ||
          this.cardFromReply?.(parsed)
        : null;
    const quote = thread ? this.quoteFromReply?.(parsed, thread) : null;
    if (!draft.text) throw new Error("보조모델이 문자를 반환하지 않았습니다.");
    const identity = this.getStateIdentity();
    const anchor =
      anchorIndex === null ? this.currentPhoneAnchor().index : anchorIndex;
    // 답변 재생성 of this person's message: the new answer takes the old one in as a version.
    const replacing =
      !threadKey && this.replacingMessage?.key === character.key
        ? this.replacingMessage
        : null;
    const family =
      threadKey && this.roundFamily?.key === threadKey
        ? this.roundFamily
        : null;
    const response = await this.fetch(
      this.apiUrl("/api/plugins/scenevoice/voice-messages"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: identity.chatId,
          anchor_message_id: String(anchor),
          ...this.anchorStamp(anchor),
          character_key: character.key,
          character_name: character.name,
          ...(threadKey ? { thread_key: threadKey } : {}),
          role: "character",
          kind,
          origin,
          reason,
          text: draft.text,
          // A text keeps its tagged line too: hidden on screen, used when it is listened to.
          script: draft.script,
          translation: draft.translation,
          tags: draft.tags,
          intensity: draft.intensity,
          language: draft.language,
          ...(card ? { card } : {}),
          ...(quote ? { quote } : {}),
          ...(replacing ? { replaces: replacing.id } : {}),
          ...(round ? { round } : {}),
          ...(family ? { family: family.family } : {}),
          // Written while this card's chat wasn't open (visit.js): its chat memory comes later.
          ...(this.visitOf ? { away: true } : {}),
        }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || `문자 저장 실패 (${response.status})`);
    if (replacing) replacing.done = true;
    if (family) family.done = true;
    // An emoji they left on someone's text along with this one.
    const reaction = thread
      ? this.reactionFromReply?.(parsed, thread, character.key)
      : null;
    if (reaction)
      await this.reactToMessage(reaction.id, reaction.emoji, {
        by: character.key,
        name: character.name,
      }).catch((error) => console.warn("[SceneVoice] 반응 저장 실패", error));
    // One tone for this person's turn, however many bubbles it shows as.
    this.playMessageTone("receive", character.key);
    const record = {
      id: data.id,
      chat_id: identity.chatId,
      anchor_message_id: String(anchor),
      ...this.anchorStamp(anchor),
      character_key: character.key,
      character_name: character.name,
      ...(threadKey ? { thread_key: threadKey } : {}),
      role: "character",
      kind,
      origin,
      ...draft,
      ...(card ? { card } : {}),
      ...(quote ? { quote } : {}),
    };
    if (kind === "text" || origin === "reply" || threadKey)
      await this.persistTextThreadMemory(threadKey || character.key, anchor);
    else
      await this.persistVoiceMessageToMessage({
        ...record,
        type: "voice_message",
        reason,
      });
    if (kind === "voice" && this.config.voice_message?.auto_generate_audio)
      await this.generateArrivedVoice(record);
    return record;
  },

  async editVoiceMessage(item) {
    const mine = item.role === "user";
    const sheet = await this.openLineSheet({
      title: mine
        ? "보낸 문자 고치기"
        : (item.kind || "voice") === "voice"
          ? "음성 메시지 고치기"
          : "문자 고치기",
      value: mine ? item.text : item.script || item.text,
      translation: item.translation,
      ...(mine
        ? {
            hint: "상대가 이미 한 답은 그대로 두고, 앞으로의 대화와 채팅 기억에는 고친 문장이 쓰입니다.",
          }
        : {}),
    });
    if (sheet === null) return;
    // My text keeps [brackets] as words; a character's line reads them as tags.
    const typed = String(sheet.value).trim().slice(0, 2000);
    const edit = mine
      ? {
          text: typed,
          language:
            this.scriptLanguage(typed) || item.language || this.chatLanguage(),
        }
      : this.spokenEdit(sheet.value);
    if (!edit.text) throw new Error("문자를 비울 수는 없습니다.");
    const { changed, words, translation } = this.sheetChanges(
      mine ? { ...item, script: "" } : item,
      edit,
      sheet,
    );
    if (!changed) return;
    const response = await this.request(
      `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: item.chat_id, ...edit, translation }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "문자를 고치지 못했습니다.");
    // Chat memory keeps what was actually sent, so it follows the edit.
    if ((data.item.kind || "voice") === "text" || data.item.origin === "reply")
      await this.persistTextThreadMemory(
        this.messageThreadOf(data.item),
        data.item.anchor_message_id,
      );
    else
      await this.persistVoiceMessageToMessage({
        ...data.item,
        type: "voice_message",
      });
    // The old voice no longer fits the words. Like on arrival, a voice message gets its new one at
    // once; so does a text that had been listened to (its 음성 다시 stays, turning, meanwhile).
    const arriving =
      words &&
      (data.item.kind || "voice") === "voice" &&
      this.config.voice_message?.auto_generate_audio;
    const remake = words && (arriving || Boolean(item.audio_url));
    if (remake) (this.voicePending ||= new Set()).add(data.item.id);
    await this.renderSmartphone();
    if (!remake) return;
    try {
      if (arriving) await this.generateArrivedVoice(data.item);
      else {
        const url = await this.generateVoiceMessageAudio(
          data.item,
          null,
          false,
          { play: false },
        );
        if (typeof url === "string") URL.revokeObjectURL(url);
      }
    } finally {
      this.voicePending.delete(data.item.id);
      if (this.phoneActiveTab === "message") await this.renderSmartphone();
    }
  },

  /**
   * A voice message made as it arrives plays at once, unless something is being listened to
   * (a chat message read in a row, a call line): then it only waits, ready, in the phone.
   */
  async generateArrivedVoice(item) {
    const busy = Boolean(this.currentAudio) || Boolean(this.messageJobs?.size);
    const url = await this.generateVoiceMessageAudio(item, null, false, {
      play: !busy,
    });
    if (busy && typeof url === "string") URL.revokeObjectURL(url);
  },

  /**
   * Writes what someone sends on their own: a text (`kind` "text", following their conversation)
   * or a voice message, for `reason` (a voicemail's says the call went unanswered). Returns the
   * parsed reply (see requestSpokenReply).
   */
  async writeIncomingMessage(
    character,
    kind,
    reason,
    profileId,
    { mayPass = false } = {},
  ) {
    const {
      blocks: stateBlocks,
      absent,
      unknown,
    } = this.stateBlocks(await this.stateForPrompt(character.key));
    const status =
      kind === "text"
        ? await this.statusLine?.(character.key).catch(() => "")
        : undefined;
    const emotions = Array.from(this.analysisEmotionCandidates()).sort();
    const thread =
      kind === "text"
        ? this.keptForAI(await this.loadMessages(), character.key)
            .filter((item) => this.messageThreadOf(item) === character.key)
            .slice(-20)
        : [];
    // A text follows the language the conversation with this person is in.
    const language =
      kind === "text"
        ? this.conversationLanguage(
            thread.slice(-6).map((item) => item.text),
            [...thread].reverse().find((item) => item.role === "user")?.text,
            character.key,
          )
        : this.conversationLanguage([], "", character.key);
    const translation = this.wantsTranslation(language);
    const me = this.userCharacterName();
    const messages = phoneMessages(
      kind === "text"
        ? textSystem({
            emotions,
            language,
            translation,
            replying: false,
            fixedLanguage: this.languageIsFixed(character.key),
            absent,
            unknown,
            canCall: this.canCallAfterText(character.key),
            statusLine: typeof status === "string",
            style: this.config.prompts?.text_style,
            mayPass,
            cards: this.cardKindsOn(),
          })
        : messageSystem({
            emotions,
            language,
            translation,
            soundEffects: this.phoneSoundEffects(character.key),
            fixedLanguage: this.languageIsFixed(character.key),
            absent,
            unknown,
            mayPass,
          }),
      [
        dataBlock("user_character", me),
        dataBlock("target_character", character.name),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock("performance_note", character.note, {
          range: this.emotionalRange(character.key),
        }),
        ...stateBlocks,
        dataBlock(
          "recent_chat",
          this.buildRecentChatContext(
            this.config.phone?.context_messages ?? 10,
          ),
        ),
        ...((await this.statusLinesBlocks?.()) || []),
        ...((await this.worldInfoBlocks?.([
          ...thread.map((item) => item.text),
          reason,
        ])) || []),
        ...this.currentTimeBlocks([character.key]),
        dataBlock(
          "previous_calls",
          await this.loadPreviousCalls(character.key),
        ),
        ...(kind === "text"
          ? [
              ...((await this.otherChatsBlocks?.(
                [character.key],
                character.key,
              )) || []),
              dataBlock(
                "text_thread",
                this.textThreadData(
                  thread,
                  character.name,
                  this.realtimeFor(character.key),
                ),
              ),
            ]
          : []),
        dataBlock("reason_to_send", reason || "(decide from context)"),
      ],
      kind === "text"
        ? textFinal(character.name, language, me)
        : messageFinal(character.name, language, me),
    );
    const parsed = await this.requestSpokenReply(profileId, messages, 850);
    if (parsed && typeof status === "string") parsed.previousStatus = status;
    return parsed;
  },

  /** A text that came with a new 상태메시지 (rare): it shows on their profile from now. */
  async textStatusChange(character, parsed, previous) {
    const line =
      typeof parsed?.status_message === "string"
        ? parsed.status_message.trim()
        : "";
    if (!line || line === previous || !this.saveStatusLine) return;
    await this.saveStatusLine(character, line).catch((error) =>
      console.warn("[SceneVoice] 상태메시지 저장 실패", error),
    );
  },

  /**
   * The character reaches out first (decided by the state analysis): a text or a voice message.
   * Kept under its old name; candidate.type "text_message" makes it a text.
   */
  async generateIncomingVoiceMessage(candidate) {
    const operation = this.captureChat();
    if (this.voiceMessageBusy) return;
    const profileId =
      this.config.phone?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    if (!profileId || !this.connectionService) return;
    const kind = candidate?.type === "text_message" ? "text" : "voice";
    // The sender is whoever the state analysis picked (the main card otherwise).
    const character = this.phoneContact(
      candidate?.callerKey || this.getCurrentCharacterProfile().key,
    );
    this.voiceMessageBusy = true;
    // 랜덤 연락 with 상황에 맞을 때만: the writer may find they wouldn't reach out now, so nothing
    // shows until the message is there.
    const mayPass = candidate?.mayPass === true;
    // Typing dots in their conversation, and (a new one, not 답변 재생성) the alert, while it is
    // being written.
    if (!mayPass) {
      this.incomingText = {
        type: kind === "text" ? "text_message" : "voice_message",
        callerKey: character.key,
        again: candidate?.again === true,
      };
      this.updatePhoneLauncherVisibility();
      const shell = document.getElementById("sv-smartphone");
      if (
        shell &&
        !shell.classList.contains("hidden") &&
        this.phoneActiveTab === "message" &&
        this.messageThreadKey === character.key
      )
        await this.renderSmartphone();
    }
    try {
      const parsed = await this.writeIncomingMessage(
        character,
        kind,
        candidate?.reason || "",
        profileId,
        { mayPass },
      );
      this.assertChat(operation);
      if (
        mayPass &&
        (parsed?.pass === true || !String(parsed?.text || "").trim())
      ) {
        const decision = (this.lastContactDecisions || []).find(
          (item) => item.random && item.callerKey === character.key,
        );
        if (decision) decision.passed = true;
        return;
      }
      const record = await this.saveCharacterMessage({
        character,
        kind,
        origin: "incoming",
        parsed,
        reason: candidate?.reason || "",
        anchorIndex: this.phoneAnchorFromSource(candidate?.sourceMessageId)
          .index,
      });
      if (kind === "text")
        await this.textStatusChange(character, parsed, parsed?.previousStatus);
      this.incomingText = null;
      const shell = document.getElementById("sv-smartphone");
      const viewing =
        shell &&
        !shell.classList.contains("hidden") &&
        this.phoneActiveTab === "message" &&
        this.messageThreadKey === character.key;
      if (!viewing)
        this.announceText(character.key, character.name, record?.text, kind);
      else this.updatePhoneLauncherVisibility();
      if (
        kind === "text" &&
        parsed?.call_after === true &&
        this.canCallAfterText(character.key)
      )
        this.callAfterText(character, record?.text);
    } catch (error) {
      if (operation.signal.aborted) return;
      console.warn("[SceneVoice] 문자 받기 실패", error);
      // A text they sent by themselves that couldn't be written (the request refused, a reply
      // cut off) is tried once more shortly, without a word; failing again it is said.
      if (candidate && !candidate.again && !candidate.retried) {
        setTimeout(() => {
          if (operation.signal.aborted) return;
          this.incomingTexts.push({ ...candidate, retried: true });
          this.drainIncomingTexts().catch(() => undefined);
        }, this.retryWait ?? 45000);
      } else this.notify(error.message || "문자를 받을 수 없습니다.", "error");
    } finally {
      if (!operation.signal.aborted) {
        this.voiceMessageBusy = false;
        if (this.incomingText) {
          this.incomingText = null;
          this.updatePhoneLauncherVisibility();
        }
        const shell = document.getElementById("sv-smartphone");
        if (
          shell &&
          !shell.classList.contains("hidden") &&
          this.phoneActiveTab === "message"
        )
          await this.renderSmartphone();
      }
    }
  },

  /** `play: false` makes the voice and returns its URL (the caller plays and frees it). */
  async generateVoiceMessageAudio(
    item,
    button = null,
    regenerate = false,
    // `quiet`: a failure is thrown to the caller (which may try again) instead of being shown.
    { play = true, quiet = false } = {},
  ) {
    const operation = this.captureChat();
    if (!item?.text) return;
    this.unlockAudioForMobile();
    // The same words already being voiced (an automatic voice and a tap) are made once.
    this.messageAudioJobs ||= new Set();
    const job = `${item.id}\n${item.script || item.text}`;
    if (this.messageAudioJobs.has(job)) return;
    this.messageAudioJobs.add(job);
    if (button) button.disabled = true;
    try {
      // A sender saved under an old key speaks with the voice the person has now.
      const speakerKey =
        item.role === "user"
          ? this.personaKey()
          : (item.character_key &&
              this.livePersonKey(item.character_key, item.character_name)) ||
            this.getCurrentCharacterProfile().key;
      const script =
        (await this.voiceScript?.(item.script || "", speakerKey)) ??
        (item.script || "");
      const response = await this.fetch(
        this.apiUrl("/api/plugins/scenevoice/generate"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: item.text,
            // The user's own texts speak with the persona voice.
            speaker_key: speakerKey,
            card_keys: this.currentCardKeys?.() || [],
            own_voice_only: this.chatVoiceOn?.() === false,
            ...(this.followsMultiCastEngine?.()
              ? { engine_settings: this.multicastVoiceSettings() }
              : {}),
            speaker_name:
              item.role === "user"
                ? this.config.character_voices?.[this.personaKey()]?.name ||
                  stOf(this)?.name1 ||
                  "사용자"
                : item.character_name,
            language:
              this.scriptLanguage(item.text) ||
              item.language ||
              this.chatLanguage(),
            script,
            tags: normalizeTags({ ...item, script }),
            intensity: item.intensity ?? 0.5,
            chat_id: item.chat_id || this.currentChatId(),
            message_id: item.anchor_message_id || "voice-message",
            quote_index: 0,
            variation_token: regenerate
              ? `${Date.now()}-${Math.random().toString(36).slice(2)}`
              : "",
            force_regenerate: regenerate,
            voice_message_mode: true,
          }),
        },
      );
      const errorBody = response.ok ? null : await response.json();
      if (!response.ok)
        throw new Error(
          errorBody?.detail || `음성 메시지 생성 실패 (${response.status})`,
        );
      const generationId =
        response.headers.get("X-SceneVoice-History-ID") || "";
      const filename = response.headers.get("X-Audio-Filename") || "";
      const mimeType = response.headers.get("content-type") || "audio/wav";
      const blob = await response.blob();
      // Its sound effects mixed into the saved voice.
      const mixed =
        this.config.phone?.sfx_in_file !== false
          ? await this.mixedLine?.(blob, item.script, generationId)
          : null;
      const audioUrl = this.createAudioUrl(mixed?.blob || blob);
      const attached = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}/audio`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generation_id: mixed?.id || generationId,
            audio_filename: mixed?.filename || filename,
            mime_type: mixed ? "audio/wav" : mimeType,
            audio_filtered: false,
          }),
        },
      );
      if (attached.status === 409 || attached.status === 404) {
        // The message was edited or deleted while its voice was being made: the old voice is
        // not the message's any more (it stays in 기록), and the edit makes its own.
        URL.revokeObjectURL(audioUrl);
        if (this.phoneActiveTab === "message") await this.renderSmartphone();
        return;
      }
      if (!attached.ok)
        throw new Error(
          "음성은 생성되었지만 문자에 연결하지 못했습니다. 기록 탭에서 확인해 주십시오.",
        );
      // Played next as it is: its sounds are in the file.
      item.sounds_mixed = Boolean(mixed);
      if (!play) {
        if (this.phoneActiveTab === "message") await this.renderSmartphone();
        return audioUrl;
      }
      this.playMessageAudio(item, audioUrl, button, { revoke: true });
      if (this.phoneActiveTab === "message") await this.renderSmartphone();
    } catch (error) {
      if (operation.signal.aborted) return;
      if (quiet) throw error;
      this.notify(
        error.message || "음성 메시지를 생성할 수 없습니다.",
        "error",
      );
    } finally {
      this.messageAudioJobs.delete(job);
      if (!operation.signal.aborted) {
        if (button) button.disabled = false;
      }
    }
  },

  /**
   * Phone-style short date: time for today, 어제, month/day otherwise. Kept for the day (each
   * message asks for it twice per drawing).
   */
  formatPhoneDate(value) {
    const now = new Date();
    const today = now.toDateString();
    if (this.phoneDates?.day !== today)
      this.phoneDates = { day: today, values: new Map() };
    const known = this.phoneDates.values.get(value);
    if (known !== undefined) return known;
    const date = new Date(value);
    let label;
    if (Number.isNaN(date.getTime())) label = String(value ?? "");
    else if (date.toDateString() === today)
      label = date.toLocaleTimeString("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
      });
    else {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      label =
        date.toDateString() === yesterday.toDateString()
          ? "어제"
          : date.getFullYear() === now.getFullYear()
            ? `${date.getMonth() + 1}월 ${date.getDate()}일`
            : `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
    }
    if (this.phoneDates.values.size > 5000) this.phoneDates.values.clear();
    this.phoneDates.values.set(value, label);
    return label;
  },

  /** Decorative waveform whose shape is stable for the same message. */
  voiceWaveBars(text = "") {
    let seed = 7;
    for (const char of String(text))
      seed = (seed * 31 + char.charCodeAt(0)) % 9973;
    return Array.from({ length: 24 }, (_, index) => {
      seed = (seed * 73 + 41 + index) % 9973;
      return `<i style="--h:${(0.25 + (seed % 75) / 100).toFixed(2)}"></i>`;
    }).join("");
  },
};
