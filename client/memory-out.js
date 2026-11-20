import { simpleHash, stOf, CHAT_MEMORY_KEY } from "./common.js";

// 기억에서 빼기: what the AI is not told, with nothing deleted. A reach says how far:
// "story" (본 채팅 기억에서만: the chat memory sent with 실리태번's chat) or "all" (the phone's own
// requests too: other rooms, calls, radio, the state update). Kept with the chat:
//  - a record under a chat message: its `excluded`;
//  - a whole room: chatMetadata[ROOMS_KEY], { room hash: reach };
//  - single texts: chatMetadata[TEXTS_KEY], message ids, always "all".
const ROOMS_KEY = "scenevoice_memory_off";
const TEXTS_KEY = "scenevoice_texts_off";
const TEXTS_RECORD = /^texts-([0-9a-f]{12})-(\d+)$/;

/** A room's id in these lists: the first 12 characters of its hash, as in a text record's id. */
// Remembered: a room's messages ask for it one by one.
const roomIds = new Map();
export const threadMemoryId = (thread) => {
  let id = roomIds.get(thread);
  if (!id) {
    if (roomIds.size > 500) roomIds.clear();
    id = simpleHash(thread).slice(0, 12);
    roomIds.set(thread, id);
  }
  return id;
};
export const threadOfEvent = (item) =>
  item?.thread || String(item?.id || "").match(TEXTS_RECORD)?.[1] || "";
const reachOf = (value) => (value === "all" ? "all" : value ? "story" : "");

export const REACH_LABELS = {
  story: "본 채팅 기억에서만 빼기",
  all: "본 채팅·스마트폰 기억 둘 다 빼기",
};

export const memoryOut = {
  /** Rooms of this chat left out: room id → reach. */
  memoryRooms() {
    const kept = stOf(this)?.chatMetadata?.[ROOMS_KEY];
    if (Array.isArray(kept)) return new Map(kept.map((id) => [id, "story"]));
    return new Map(
      Object.entries(kept && typeof kept === "object" ? kept : {})
        .map(([id, reach]) => [id, reachOf(reach)])
        .filter(([, reach]) => reach),
    );
  },

  /** Single texts (and voice messages) of this chat left out. */
  forgottenTexts() {
    const kept = stOf(this)?.chatMetadata?.[TEXTS_KEY];
    return new Set(Array.isArray(kept) ? kept.map(String) : []);
  },

  async saveMemoryOut({ rooms = null, texts = null } = {}) {
    const context = stOf(this) || {};
    if (!context.chatMetadata) return;
    if (rooms) {
      if (rooms.size)
        context.chatMetadata[ROOMS_KEY] = Object.fromEntries(rooms);
      else delete context.chatMetadata[ROOMS_KEY];
    }
    if (texts) {
      if (texts.size) context.chatMetadata[TEXTS_KEY] = [...texts];
      else delete context.chatMetadata[TEXTS_KEY];
    }
    await context.saveMetadata?.();
  },

  /**
   * How a chat memory record is left out: { reach, room, single }. `room`: by its whole room;
   * `single`: a voice message left out by itself (from its ⋯).
   */
  memoryLeftOut(
    item,
    rooms = this.memoryRooms(),
    forgotten = this.forgottenTexts(),
  ) {
    const room = rooms.get(threadOfEvent(item));
    if (room) return { reach: room, room: true, single: false };
    const reach = reachOf(item?.excluded);
    if (reach) return { reach, room: false, single: false };
    if (forgotten.has(String(item?.id)))
      return { reach: "all", room: false, single: true };
    return { reach: "", room: false, single: false };
  },

  roomReach(thread) {
    return this.memoryRooms().get(threadMemoryId(thread)) || "";
  },

  /** A whole room left out (`reach`), or back in (""). Its later texts follow it. */
  async setRoomReach(thread, reach) {
    return this.setRoomReachById(threadMemoryId(thread), reach, thread);
  },

  async setRoomReachById(id, reach, thread = "") {
    const context = stOf(this) || {};
    if (!context.chatMetadata || !id) return;
    const rooms = this.memoryRooms();
    if (reach) rooms.set(id, reach);
    else rooms.delete(id);
    // Voice messages kept before records carried their room learn it now.
    if (reach && thread) {
      const ids = new Set(
        (await this.loadMessages().catch(() => []))
          .filter((item) => this.messageThreadOf(item) === thread)
          .map((item) => String(item.id)),
      );
      let marked = false;
      for (const message of context.chat || [])
        for (const item of message?.extra?.[CHAT_MEMORY_KEY] || [])
          if (
            item?.type === "voice_message" &&
            !item.thread &&
            ids.has(String(item.id))
          ) {
            item.thread = id;
            marked = true;
          }
      if (marked) await context.saveChat?.();
    }
    await this.saveMemoryOut({ rooms });
    await this.refreshChatMemory();
  },

  /** 기억에서 빼기 for one text (from its ⋯), or back. The room's record is written again. */
  async setTextForgotten(item, forgotten) {
    const texts = this.forgottenTexts();
    if (forgotten) texts.add(String(item.id));
    else texts.delete(String(item.id));
    await this.saveMemoryOut({ texts });
    const thread = this.messageThreadOf(item);
    const anchor = String(item.anchor_message_id ?? "");
    if (
      /^\d+$/.test(anchor) &&
      (this.isGroupThread(thread) ||
        (item.kind || "voice") === "text" ||
        item.origin === "reply")
    )
      await this.persistTextThreadMemory(thread, anchor);
    await this.refreshChatMemory();
  },

  /** How far a phone message of `thread` is left out, for the marks in its room ("" when kept). */
  messageReach(item, thread, forgotten = this.forgottenTexts()) {
    if (forgotten.has(String(item?.id))) return "all";
    const at = String(item?.anchor_message_id ?? "");
    if (!/^\d+$/.test(at)) return "";
    const ids = [`texts-${threadMemoryId(thread)}-${at}`, String(item.id)];
    const event = this.chatMemoryEventsOf(stOf(this)?.chat?.[Number(at)]).find(
      (record) => ids.includes(record.id),
    );
    return reachOf(event?.excluded);
  },

  /**
   * A room's bubbles (`parts`, one per message of `thread`) with what is left out marked: one
   * line for a whole room, runs of left-out messages framed and dimmed.
   */
  leftOutRunsHtml(thread, key, parts) {
    if (!thread.length) return parts.join("");
    const mark = (text) =>
      `<div class="sv-msg-out-mark"><span><i class="fa-solid fa-brain" aria-hidden="true"></i>${text}</span></div>`;
    const room = this.roomReach(key);
    if (room === "all")
      return (
        mark("이 방 대화는 본 채팅·스마트폰 기억에서 뺐습니다") + parts.join("")
      );
    const forgotten = this.forgottenTexts();
    let html = room ? mark("이 방 대화는 본 채팅 기억에서 뺐습니다") : "";
    let run = [];
    let runReach = "";
    const flush = () => {
      if (run.length)
        html += `<div class="sv-msg-out-run">${mark(runReach === "all" ? "본 채팅·스마트폰 기억에서 뺀 문자" : "본 채팅 기억에서만 뺀 문자")}${run.join("")}</div>`;
      run = [];
      runReach = "";
    };
    thread.forEach((item, index) => {
      const reach = this.messageReach(item, key, forgotten);
      // A room left out of the story already: only what goes further is marked.
      const shown = reach && (!room || reach === "all") ? reach : "";
      if (shown && shown === runReach) run.push(parts[index]);
      else if (shown) {
        flush();
        runReach = shown;
        run.push(parts[index]);
      } else {
        flush();
        html += parts[index];
      }
    });
    flush();
    return html;
  },

  /** What 둘 다 빼기 took out: message ids, and text records as "room id|message number". */
  forgottenForAI() {
    const ids = this.forgottenTexts();
    const batches = new Set();
    for (const message of stOf(this)?.chat || [])
      for (const event of message?.extra?.[CHAT_MEMORY_KEY] || []) {
        if (reachOf(event?.excluded) !== "all") continue;
        const match = String(event.id).match(TEXTS_RECORD);
        if (match) batches.add(`${match[1]}|${match[2]}`);
        else ids.add(String(event.id));
      }
    const rooms = new Set(
      [...this.memoryRooms()]
        .filter(([, reach]) => reach === "all")
        .map(([id]) => id),
    );
    return { ids, batches, rooms };
  },

  /**
   * Phone messages an AI request may read: what 둘 다 빼기 took out goes. `ownRoom`: the room the
   * request is for; a whole room left out still knows its own conversation.
   */
  keptForAI(items, ownRoom = "") {
    const { ids, batches, rooms } = this.forgottenForAI();
    if (!ids.size && !batches.size && !rooms.size) return items;
    return items.filter((item) => {
      if (ids.has(String(item.id))) return false;
      const room = threadMemoryId(this.messageThreadOf(item));
      if (batches.has(`${room}|${item.anchor_message_id}`)) return false;
      return !rooms.has(room) || this.messageThreadOf(item) === ownRoom;
    });
  },

  /** Calls an AI request may read: a call taken out by 둘 다 빼기 goes. */
  callsForAI(sessions) {
    const { ids } = this.forgottenForAI();
    return ids.size
      ? sessions.filter((session) => !ids.has(String(session.id)))
      : sessions;
  },

  /**
   * Asks how far to leave something out, from a small menu under `anchor`: "story", "all", or
   * null. A chat without the chat memory has only the phone's to leave it out of.
   */
  pickMemoryReach(anchor) {
    if (!this.chatMemoryOn?.()) {
      this.notify("스마트폰 안 기억에서 빠집니다.", "info");
      return Promise.resolve("all");
    }
    document.querySelector(".sv-reach-menu")?.remove();
    return new Promise((resolve) => {
      const menu = document.createElement("div");
      menu.className = "sv-reach-menu";
      menu.setAttribute("role", "menu");
      for (const reach of ["story", "all"]) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.dataset.reach = reach;
        item.innerHTML = `<i class="fa-solid fa-brain sv-reach-${reach}" aria-hidden="true"></i><span></span>`;
        item.querySelector("span").textContent = REACH_LABELS[reach];
        menu.append(item);
      }
      const holder = anchor.parentElement;
      if (getComputedStyle(holder).position === "static")
        holder.style.position = "relative";
      holder.append(menu);
      // Its right edge with the button's, kept inside the row it sits in.
      menu.style.left = `${Math.max(
        0,
        Math.min(
          anchor.offsetLeft + anchor.offsetWidth - menu.offsetWidth,
          holder.clientWidth - menu.offsetWidth,
        ),
      )}px`;
      // Above the button in the chat (its bottom is cut by the input bar); under it on the
      // phone, where the button sits in the room's header. Under it too when above is cut off.
      const above = `${anchor.offsetTop - menu.offsetHeight - 4}px`;
      const below = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
      menu.style.top = anchor.closest("#sv-smartphone") ? below : above;
      if (menu.style.top === above) {
        let top = 0;
        for (let box = holder.parentElement; box; box = box.parentElement)
          if (getComputedStyle(box).overflowY !== "visible") {
            const rect = box.getBoundingClientRect();
            if (rect.height) top = Math.max(top, rect.top);
          }
        if (menu.getBoundingClientRect().top < top + 8) menu.style.top = below;
      }
      const done = (value) => {
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", key, true);
        menu.remove();
        resolve(value);
      };
      const outside = (event) => {
        if (!menu.contains(event.target)) done(null);
      };
      const key = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          done(null);
          anchor.focus?.();
        }
      };
      menu.addEventListener("click", (event) => {
        const picked = event.target.closest("[data-reach]");
        if (picked) {
          event.preventDefault();
          event.stopPropagation();
          done(picked.dataset.reach);
        }
      });
      setTimeout(() => {
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", key, true);
      });
      if (!matchMedia("(pointer: coarse)").matches)
        menu.querySelector("button")?.focus();
    });
  },
};
