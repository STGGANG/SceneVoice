// 채팅 기억: calls, voice messages and texts kept on the chat message they followed (message
// extra data). They are always kept; 채팅 기억 연동 decides whether they show under the
// messages and go to the model as extension prompts, so switching it on later brings them all.
import {
  CHAT_MEMORY_KEY,
  CHAT_MEMORY_PROMPT_PREFIX,
  FINAL_CALL_STATUSES,
  escapeHtml,
  simpleHash,
  contentKey,
  withoutVoiceTags,
} from "./common.js";

export const memory = {
  memoryAttribute(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },

  memoryContext(value, fallback) {
    const cleaned = String(value || "")
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || /[가-힣ぁ-んァ-ヶ一-鿿]/.test(cleaned)) return fallback;
    return cleaned;
  },

  /** The user's character, by name: a bare "USER" reads as the real person, not the persona. */
  memoryUserName() {
    return this.userCharacterName?.() || "User";
  },

  formatCallMemoryText(session) {
    if (session?.call_direction === "overheard") return this.formatOverheardMemoryText(session);
    const outcome = FINAL_CALL_STATUSES.has(session?.status)
      ? session.status
      : "ended";
    const name = session?.character_name || this.getStateIdentity().characterName;
    const me = this.memoryUserName();
    const [caller, callee] = session?.call_direction === "incoming" ? [name, me] : [me, name];
    const characterName = this.memoryAttribute(name);
    const contextLine = this.memoryContext(session?.situation, `${caller} called ${callee}`);
    // With real-time awareness, the call keeps when it happened.
    const time = this.realtimeFor(session?.character_key)
      ? ` time="${this.memoryAttribute(this.realTimeLabel(session?.started_at))}"`
      : "";
    const lines = [
      `<CALL character="${characterName}" initiated_by="${this.memoryAttribute(caller)}" outcome="${outcome}"${time}>`,
      `Context: ${contextLine}`,
    ];
    for (const turn of Array.isArray(session?.turns) ? session.turns : []) {
      const text = String(turn?.text || "").trim();
      if (!text) continue;
      lines.push(`${turn.role === "user" ? me : turn.voicemail ? `${name} (voicemail)` : name}: ${text}`);
    }
    lines.push("</CALL>");
    return lines.join("\n");
  },

  /** 엿듣는 통화: a call between two people the user's character didn't hear (and doesn't know of). */
  formatOverheardMemoryText(session) {
    const names = [session?.character_name, session?.callee_name].map((name) => this.memoryAttribute(name));
    const time = [session?.character_key, session?.callee_key].some((key) => this.realtimeFor(key))
      ? ` time="${this.memoryAttribute(this.realTimeLabel(session?.started_at))}"`
      : "";
    const lines = [
      `<CALL between="${names.join(", ")}" caller="${names[0]}" user_present="false"${time}>`,
      `(${this.memoryUserName()} was not on this call, didn't hear it and doesn't know it happened.)`,
      `Context: ${this.memoryContext(session?.situation, "a call between them")}`,
    ];
    for (const turn of Array.isArray(session?.turns) ? session.turns : []) {
      const text = String(turn?.text || "").trim();
      if (text) lines.push(`${turn.speaker_name || "?"}: ${text}`);
    }
    lines.push("</CALL>");
    return lines.join("\n");
  },

  formatVoiceMessageMemoryText(item) {
    const name = item?.character_name || this.getStateIdentity().characterName;
    const characterName = this.memoryAttribute(name);
    const contextLine = this.memoryContext(
      item?.reason,
      "asynchronous_personal_message",
    );
    const time = this.realtimeFor(item?.character_key)
      ? ` time="${this.memoryAttribute(this.realTimeLabel(item?.created_at))}"`
      : "";
    return [
      `<VOICE_MESSAGE character="${characterName}"${time}>`,
      `Context: ${contextLine}`,
      `${name}: ${String(item?.text || "").trim()}`,
      "</VOICE_MESSAGE>",
    ].join("\n");
  },

  /**
   * The records that belong to the swipe now showing. ST carries a message's extra data over to
   * a new swipe, so a record made on another swipe stays hidden there (and out of the prompt).
   * Records saved before swipes were noted show on every swipe.
   */
  chatMemoryEventsOf(message) {
    const events = message?.extra?.[CHAT_MEMORY_KEY];
    if (!Array.isArray(events)) return [];
    const swipe = typeof message.swipe_id === "number" ? message.swipe_id : 0;
    return events.filter(
      (item) => item?.llm_text && (typeof item.swipe_id !== "number" || item.swipe_id === swipe),
    );
  },

  async persistChatMemoryEvent(anchorMessageId, event) {
    if (!event?.id || !event?.llm_text) return false;
    if (event.chat_id !== this.currentChatId()) return false;
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const match = String(anchorMessageId ?? "").match(/^\d+/);
    const index = match ? Number(match[0]) : -1;
    const message = Number.isInteger(index) && index >= 0 ? chat[index] : null;
    if (!message) return false;
    // A record that knows its message by the mark left on it (kept through edits) is checked by
    // that mark and its swipe; an older one by the message's text then.
    const stillThere = event.anchor_tag
      ? this.anchorShown?.({
          anchor_message_id: String(index),
          anchor_swipe: event.anchor_swipe,
          anchor_tag: event.anchor_tag,
        }) !== false
      : !event.anchor_fingerprint ||
        event.anchor_fingerprint ===
          contentKey({ text: withoutVoiceTags(message.mes), swipe: message.swipe_id }) ||
        event.anchor_fingerprint === contentKey({ text: message.mes, swipe: message.swipe_id });
    if (!stillThere) return false;
    if (!message.extra || typeof message.extra !== "object") message.extra = {};
    if (!Array.isArray(message.extra[CHAT_MEMORY_KEY]))
      message.extra[CHAT_MEMORY_KEY] = [];
    const normalized = {
      version: 1,
      id: String(event.id),
      type: ["voice_message", "texts"].includes(event.type) ? event.type : "call",
      character_name: String(event.character_name || "").slice(0, 300),
      llm_text: String(event.llm_text).trim(),
      // The swipe it was made on; another swipe of the same message doesn't show it.
      swipe_id: typeof message.swipe_id === "number" ? message.swipe_id : 0,
    };
    const events = message.extra[CHAT_MEMORY_KEY];
    // Records this one takes the place of (the same conversation under an older key).
    const replaced = new Set(Array.isArray(event.replaces) ? event.replaces : []);
    for (let at = events.length - 1; at >= 0; at--) if (replaced.has(events[at]?.id)) events.splice(at, 1);
    const existingIndex = events.findIndex(
      (item) => item?.id === normalized.id,
    );
    if (existingIndex >= 0) events[existingIndex] = normalized;
    else events.push(normalized);
    try {
      await context.saveChat?.();
      await this.refreshChatMemory();
      return true;
    } catch (error) {
      console.warn("[SceneVoice] chat memory save failed", error);
      return false;
    }
  },

  /**
   * `members`: a group's people. `alone`: a group the user isn't in (they never saw it). `left`:
   * the user left the group, and that is its last line.
   */
  formatTextThreadMemoryText(name, items, members = null, timed = false, { alone = false, left = false } = {}) {
    const me = this.memoryUserName();
    const lines = items.map((item) => {
      // With real-time awareness each text keeps when it was sent.
      const text = `${timed ? `(${this.realTimeLabel(item.created_at)}) ` : ""}${String(item.text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" / ")}`;
      if (item.role === "user") return `${me}: ${text}`;
      const who = members ? item.character_name || "?" : name;
      return (item.kind || "voice") === "voice"
        ? `${who} (voice message): ${text}`
        : `${who}: ${text}`;
    });
    const open = members
      ? `<TEXT_MESSAGES group="${this.memoryAttribute(name)}" members="${this.memoryAttribute(members.join(", "))}"${alone ? ' user_present="false"' : ""}>`
      : `<TEXT_MESSAGES character="${this.memoryAttribute(name)}">`;
    return [
      open,
      ...(alone ? [`(${me} is not in this group chat and has not seen it.)`] : []),
      ...lines,
      ...(left ? [`(${me} left the group chat.)`] : []),
      "</TEXT_MESSAGES>",
    ].join("\n");
  },

  /**
   * One memory per person per point in the chat: the texts (and voice replies) exchanged while
   * the chat stood at that message. Rewritten as the conversation goes on. `swipe`: the texts of
   * another swipe of that message (in 미적용 기억), written into the memory kept with that swipe
   * instead.
   */
  async persistTextThreadMemory(key, anchorIndex, { left = false, swipe = null } = {}) {
    const anchor = String(anchorIndex ?? "");
    const away = swipe !== null;
    // A group keeps every message of its room; a one-to-one thread its texts and replies.
    const items = (await this.loadMessages({ all: away })).filter(
      (item) =>
        this.messageThreadOf(item) === key &&
        String(item.anchor_message_id) === anchor &&
        (!away || (item.anchor_swipe === swipe && this.anchorPlace(item) === "swipe")) &&
        (this.isGroupThread(key) || (item.kind || "voice") === "text" || item.origin === "reply"),
    );
    const idOf = (thread) => `texts-${simpleHash(thread).slice(0, 12)}-${anchor}`;
    const id = idOf(key);
    if (!items.length)
      return away ? this.rewriteSwipeMemory(anchor, swipe, id, null) : this.removeChatMemoryEvent(anchor, id);
    // Texts kept under a person's old key (made again since) are this conversation too: the
    // record written under that key gives way to this one instead of staying beside it.
    const former = [
      ...new Set(items.map((item) => item.thread_key || item.character_key).filter((raw) => raw && raw !== key)),
    ].map(idOf);
    if (this.isGroupThread(key) && !this.messageGroup(key))
      await this.loadMessageGroups().catch(() => []);
    const contact = this.threadContact(key);
    const text = this.formatTextThreadMemoryText(
      contact.name,
      items,
      contact.group ? contact.members.map((member) => member.name) : null,
      contact.group
        ? contact.members.some((member) => this.realtimeFor(member.key))
        : this.realtimeFor(key),
      { alone: this.messageGroup(key)?.without_user === true, left },
    );
    if (away) return this.rewriteSwipeMemory(anchor, swipe, id, text);
    return this.persistChatMemoryEvent(anchor, {
      id,
      replaces: former,
      chat_id: this.currentChatId(),
      ...this.anchorStamp(anchor),
      type: "texts",
      character_name: contact.name,
      llm_text: text,
    });
  },

  /**
   * A record kept with another swipe of its message (shown again when that swipe is): its text
   * becomes `text`, or it is taken out when `text` is null. Only one already there changes.
   */
  async rewriteSwipeMemory(anchorMessageId, swipe, id, text = null) {
    const context = window.SillyTavern?.getContext?.() || {};
    const match = String(anchorMessageId ?? "").match(/^\d+/);
    const message = match ? context.chat?.[Number(match[0])] : null;
    if (!message) return false;
    // That swipe's own copy, and the copies later swipes carried over from it (hidden there).
    const extras = [
      message.extra,
      ...(Array.isArray(message.swipe_info) ? message.swipe_info.map((info) => info?.extra) : []),
    ];
    let changed = false;
    for (const extra of extras) {
      const events = extra?.[CHAT_MEMORY_KEY];
      if (!Array.isArray(events)) continue;
      for (let at = events.length - 1; at >= 0; at--) {
        if (events[at]?.id !== id || events[at]?.swipe_id !== swipe) continue;
        if (text) events[at] = { ...events[at], llm_text: text };
        else events.splice(at, 1);
        changed = true;
      }
      if (!events.length) delete extra[CHAT_MEMORY_KEY];
    }
    if (!changed) return false;
    try {
      await context.saveChat?.();
      return true;
    } catch (error) {
      console.warn("[SceneVoice] chat memory save failed", error);
      return false;
    }
  },

  /**
   * A record deleted from 미적용 기억 that was made on another swipe: the chat memory kept with
   * that swipe follows (its texts, `thread`, written again without it; a call or voice message
   * taken out), so swiping back doesn't bring back what was deleted. A record of a part of the
   * chat that was taken back has nothing left to follow.
   */
  async forgetSwipeMemory(record, thread = "") {
    if (this.anchorPlace(record) !== "swipe") return false;
    if (thread)
      return this.persistTextThreadMemory(thread, record.anchor_message_id, { swipe: record.anchor_swipe });
    return this.rewriteSwipeMemory(record.anchor_message_id, record.anchor_swipe, record.id, null);
  },

  /** Removes one call or message record from the chat message it was attached to. */
  async removeChatMemoryEvent(anchorMessageId, id) {
    const context = window.SillyTavern?.getContext?.() || {};
    const match = String(anchorMessageId ?? "").match(/^\d+/);
    const message = match ? context.chat?.[Number(match[0])] : null;
    const events = message?.extra?.[CHAT_MEMORY_KEY];
    if (!Array.isArray(events)) return false;
    const index = events.findIndex((item) => item?.id === id);
    if (index < 0) return false;
    events.splice(index, 1);
    if (!events.length) delete message.extra[CHAT_MEMORY_KEY];
    try {
      await context.saveChat?.();
      await this.refreshChatMemory();
      return true;
    } catch (error) {
      console.warn("[SceneVoice] chat memory save failed", error);
      return false;
    }
  },

  async persistVoiceMessageToMessage(item) {
    return this.persistChatMemoryEvent(item?.anchor_message_id, {
      id: item?.id,
      chat_id: item?.chat_id,
      anchor_fingerprint: item?.anchor_fingerprint,
      anchor_swipe: item?.anchor_swipe,
      anchor_tag: item?.anchor_tag,
      type: "voice_message",
      character_name: item?.character_name || "",
      llm_text: this.formatVoiceMessageMemoryText(item),
    });
  },

  clearChatMemoryPrompts() {
    const context = window.SillyTavern?.getContext?.() || {};
    if (typeof context.setExtensionPrompt !== "function") {
      this.chatMemoryPromptKeys.clear();
      return;
    }
    for (const key of this.chatMemoryPromptKeys) {
      context.setExtensionPrompt(key, "", 1, 0, false, 0);
    }
    this.chatMemoryPromptKeys.clear();
  },

  syncChatMemoryPrompts() {
    const context = window.SillyTavern?.getContext?.() || {};
    this.clearChatMemoryPrompts();
    if (
      !this.chatMemoryOn() ||
      typeof context.setExtensionPrompt !== "function"
    )
      return;
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const chatKey = simpleHash(context.chatId || "chat");
    chat.forEach((message, index) => {
      const events = this.chatMemoryEventsOf(message);
      if (!events.length) return;
      const depth = chat.length - 1 - index;
      if (depth < 0 || depth > 10000) return;
      const key = `${CHAT_MEMORY_PROMPT_PREFIX}${chatKey}_${index}`;
      const value = events
        .map((item) => String(item.llm_text).trim())
        .filter(Boolean)
        .join("\n");
      if (!value) return;
      context.setExtensionPrompt(key, value, 1, depth, false, 0);
      this.chatMemoryPromptKeys.add(key);
    });
  },

  /**
   * Kept calls and texts show under the chat messages and go into the chat's context (채팅 기억
   * 연동), while 씬보이스 is on.
   */
  chatMemoryOn() {
    return this.config?.active !== false && Boolean(this.config?.chat_memory?.enabled);
  },

  /** The record boxes under chat messages: `messages` (elements) or, by default, all of them. */
  renderChatMemoryDecorations(messages = null) {
    if (!this.chatMemoryOn()) {
      document
        .querySelectorAll(".sv-chat-memory")
        .forEach((item) => item.remove());
      return;
    }
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    (messages || document.querySelectorAll("#chat .mes[mesid]")).forEach((messageElement) => {
      if (!messageElement.matches?.("#chat .mes[mesid]")) return;
      const index = Number(messageElement.getAttribute("mesid"));
      const events = this.chatMemoryEventsOf(chat[index]);
      const existing = messageElement.querySelector(
        ":scope > .mes_block > .sv-chat-memory",
      );
      if (!events.length) {
        existing?.remove();
        return;
      }
      const signature = simpleHash(JSON.stringify(events));
      if (existing?.dataset.signature === signature) return;
      const wasOpen = Boolean(existing?.open);
      const details = document.createElement("details");
      details.className = "sv-chat-memory";
      details.dataset.messageId = String(index);
      details.dataset.signature = signature;
      details.open = wasOpen;
      const hasCall = events.some((item) => item.type === "call");
      const hasVoice = events.some((item) => item.type === "voice_message");
      const hasTexts = events.some((item) => item.type === "texts");
      const icon = [
        hasCall ? '<i class="fa-solid fa-phone" aria-hidden="true"></i>' : "",
        hasVoice
          ? '<i class="fa-solid fa-microphone-lines" aria-hidden="true"></i>'
          : "",
        hasTexts ? '<i class="fa-solid fa-comment-dots" aria-hidden="true"></i>' : "",
      ].join("");
      details.innerHTML = `
                <summary><span class="sv-memory-icons">${icon}</span>통화·메시지 채팅 기억 <span class="sv-memory-count">${events.length}</span></summary>
                <div class="sv-memory-records">
                    ${events
                      .map(
                        (item) => `
                        <article class="sv-memory-record" data-event-id="${escapeHtml(item.id)}">
                            <small>${item.type === "call" ? "통화" : item.type === "texts" ? "문자" : "음성 메시지"} · ${escapeHtml(item.character_name || "")}</small>
                            <pre>${escapeHtml(item.llm_text)}</pre>
                            <textarea class="sv-memory-editor hidden" spellcheck="false">${escapeHtml(item.llm_text)}</textarea>
                            <div class="sv-memory-actions">
                                <button type="button" data-sv-memory-action="edit">편집</button>
                                <button type="button" data-sv-memory-action="save" class="hidden">저장</button>
                                <button type="button" data-sv-memory-action="cancel" class="hidden">취소</button>
                                <button type="button" data-sv-memory-action="delete" class="sv-danger">삭제</button>
                            </div>
                        </article>`,
                      )
                      .join("")}
                </div>`;
      existing?.replaceWith(details);
      if (!existing)
        messageElement
          .querySelector(":scope > .mes_block")
          ?.appendChild(details);
    });
  },

  async refreshChatMemory() {
    this.syncChatMemoryPrompts();
    this.renderChatMemoryDecorations();
  },

  scheduleChatMemoryRefresh() {
    clearTimeout(this.chatMemoryRefreshTimer);
    this.chatMemoryRefreshTimer = setTimeout(
      () => this.refreshChatMemory(),
      80,
    );
  },

  async handleChatMemoryAction(button) {
    const action = button?.dataset?.svMemoryAction;
    const record = button?.closest(".sv-memory-record");
    const details = button?.closest(".sv-chat-memory");
    const context = window.SillyTavern?.getContext?.() || {};
    const messageIndex = Number(details?.dataset?.messageId);
    const events = context.chat?.[messageIndex]?.extra?.[CHAT_MEMORY_KEY];
    const event = Array.isArray(events)
      ? events.find((item) => item?.id === record?.dataset?.eventId)
      : null;
    if (!event || !record) return;
    const pre = record.querySelector("pre");
    const editor = record.querySelector(".sv-memory-editor");
    const editButton = record.querySelector('[data-sv-memory-action="edit"]');
    const saveButton = record.querySelector('[data-sv-memory-action="save"]');
    const cancelButton = record.querySelector(
      '[data-sv-memory-action="cancel"]',
    );
    if (action === "edit") {
      editor.value = event.llm_text;
      pre.classList.add("hidden");
      editor.classList.remove("hidden");
      editButton.classList.add("hidden");
      saveButton.classList.remove("hidden");
      cancelButton.classList.remove("hidden");
      return;
    }
    if (action === "cancel") {
      pre.classList.remove("hidden");
      editor.classList.add("hidden");
      editButton.classList.remove("hidden");
      saveButton.classList.add("hidden");
      cancelButton.classList.add("hidden");
      return;
    }
    if (action === "delete") {
      if (!confirm("이 통화·음성 채팅 기억을 삭제할까요?")) return;
      const index = events.findIndex((item) => item?.id === event.id);
      if (index >= 0) events.splice(index, 1);
      if (!events.length)
        delete context.chat[messageIndex].extra[CHAT_MEMORY_KEY];
    } else if (action === "save") {
      const value = editor.value.trim();
      if (!value) {
        this.notify(
          "기억 내용을 비울 수 없습니다. 완전히 지우려면 삭제를 누르세요.",
          "error",
        );
        return;
      }
      event.llm_text = value;
    } else {
      return;
    }
    await context.saveChat?.();
    await this.refreshChatMemory();
  },

  async clearCurrentChatMemory() {
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    let removed = 0;
    for (const message of chat) {
      const events = message?.extra?.[CHAT_MEMORY_KEY];
      if (!Array.isArray(events) || !events.length) continue;
      removed += events.length;
      delete message.extra[CHAT_MEMORY_KEY];
    }
    if (!removed) {
      this.notify("현재 채팅에 연동된 통화·음성 기억이 없습니다.", "info");
      return;
    }
    await context.saveChat?.();
    await this.refreshChatMemory();
    this.notify(`${removed}개의 채팅 연동 기억을 삭제했습니다.`, "success");
  },
};
