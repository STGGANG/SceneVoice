import {
  dataBlock,
  groupTextFinal,
  groupTextSystem,
  languageName,
  phoneMessages,
} from "./prompts.js";
import { escapeHtml } from "./common.js";

const GROUP = "group:";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Group conversations in the messaging app: the user and two or more people texting together.
 * A group's messages carry its thread key ("group:<id>") and, for the characters, who sent them.
 */
export const groups = {
  isGroupThread(key) {
    return String(key || "").startsWith(GROUP);
  },

  /** The open chat's groups, oldest first; kept for drawing until the next load. */
  async loadMessageGroups() {
    const response = await this.fetch(
      this.apiUrl(
        `/api/plugins/scenevoice/message-groups?chat_id=${encodeURIComponent(this.currentChatId())}&limit=100`,
      ),
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    this.messageGroups = (data.items || []).sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    await this.repairGroupMembers();
    return this.messageGroups;
  },

  /** Rooms that still name a member by an old key are saved again with the person's key now. */
  async repairGroupMembers() {
    for (const group of this.messageGroups || []) {
      const members = (group.members || []).map((member) => {
        const key = this.livePersonKey(member.key, member.name);
        return { key, name: key === member.key ? member.name : this.phoneContact(key).name };
      });
      if (members.every((member, index) => member.key === group.members[index].key)) continue;
      // Two old keys that turned out to be one person stay one member.
      const unique = members.filter((member, index) => members.findIndex((item) => item.key === member.key) === index);
      if (unique.length < 2) continue;
      try {
        const response = await this.request(
          `/api/plugins/scenevoice/message-groups/${encodeURIComponent(group.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...group, chat_id: group.chat_id || this.currentChatId(), members: unique }),
          },
        );
        if (response.ok) group.members = unique;
      } catch (error) {
        console.warn("[SceneVoice] room members not repaired", error);
      }
    }
  },

  messageGroup(key) {
    if (!this.isGroupThread(key)) return null;
    const id = String(key).slice(GROUP.length);
    return (this.messageGroups || []).find((group) => group.id === id) || null;
  },

  /**
   * A member as a contact (the person here now, if the saved key is an old one); someone no longer
   * registered keeps the name saved with the group.
   */
  memberContact(member) {
    const contact = this.phoneContact(this.livePersonKey(member.key, member.name));
    return contact.name === "이름 없음" && member.name
      ? { ...contact, name: member.name }
      : contact;
  },

  /** Whoever a conversation is with: one person, or a group with its members. */
  threadContact(key) {
    if (!this.isGroupThread(key)) return this.phoneContact(key);
    const group = this.messageGroup(key);
    return {
      key,
      group: true,
      name: group?.name || "단체방",
      members: (group?.members || []).map((member) => this.memberContact(member)),
    };
  },

  threadAvatarMarkup(contact) {
    if (!contact.group) return this.contactAvatarMarkup(contact);
    const shown = contact.members.slice(0, 2);
    return `<div class="sv-room-avatar" aria-hidden="true">${shown.map((member) => this.contactAvatarMarkup(member)).join("")}</div>`;
  },

  /** Opens the group editor: a new group, or the open one to rename or change its people. */
  openGroupEditor(key = "") {
    const group = this.messageGroup(key);
    const context = window.SillyTavern?.getContext?.() || {};
    // In an ST group chat a new group starts with everyone in it.
    const groupChat = context.groupId !== undefined && context.groupId !== null;
    this.groupEditor = {
      id: group?.id || "",
      name: group?.name || "",
      without_user: group?.without_user === true,
      auto_chat: group?.auto_chat === true,
      auto_every: group?.auto_every || 6,
      auto_daily_max: group?.auto_daily_max ?? 5,
      burst_min: group?.burst_min || 6,
      burst_max: group?.burst_max || 15,
      members: new Set(
        group
          ? group.members.map((member) => this.livePersonKey(member.key, member.name))
          : groupChat
            ? this.phoneContacts().map((contact) => contact.key)
            : [],
      ),
    };
    this.renderSmartphone();
  },

  renderGroupEditor(body) {
    const editor = this.groupEditor;
    this.groupEditorShown = editor;
    const people = this.phoneContacts();
    // People of an existing group who are no longer contacts can still be taken out.
    const group = this.messageGroup(`${GROUP}${editor.id}`);
    for (const member of group?.members || []) {
      const contact = this.memberContact(member);
      if (!people.some((item) => item.key === contact.key)) people.push(contact);
    }
    body.innerHTML = `
      <div class="sv-room-editor">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back" data-group-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> ${editor.id ? "대화" : "대화 목록"}</button>
          <strong class="sv-room-editor-title">${editor.id ? "단체방 설정" : "새 단체방"}</strong>
        </header>
        <label class="sv-room-name"><span>방 이름</span><input id="sv-room-name" maxlength="60" placeholder="비워 두면 참여자 이름으로" value="${escapeHtml(editor.name)}" autocomplete="off"></label>
        <label class="sv-room-check"><input type="checkbox" id="sv-room-alone" ${editor.without_user ? "checked" : ""} ${editor.id ? "disabled" : ""}><span>나 없이 자기들끼리 대화하는 방</span></label>
        <div class="sv-room-alone-options" ${editor.without_user ? "" : "hidden"}>
          <label class="sv-room-check"><input type="checkbox" id="sv-room-auto" ${editor.auto_chat ? "checked" : ""}><span>맥락상 어울리면 알아서 대화</span></label>
          <label class="sv-room-num"><span>AI 답변</span><input type="number" id="sv-room-every" min="1" max="50" value="${editor.auto_every}"><span>개마다 한 번 살펴보기</span></label>
          <label class="sv-room-num"><span>하루 최대</span><input type="number" id="sv-room-daily" min="0" max="100" value="${editor.auto_daily_max}"><span>번 (0 = 제한 없음)</span></label>
          <label class="sv-room-num"><span>‘대화 이어 보기’ 한 번에</span><input type="number" id="sv-room-min" min="1" max="30" value="${editor.burst_min}"><span>~</span><input type="number" id="sv-room-max" min="1" max="30" value="${editor.burst_max}"><span>개</span></label>
        </div>
        <p class="sv-room-hint">${editor.without_user ? "자기들끼리 대화할 사람을" : "함께 대화할 사람을"} 두 명 이상 고르십시오.</p>
        <div class="sv-room-people">
          ${people
            .map(
              (contact) => `<label class="sv-room-person">
                <input type="checkbox" value="${escapeHtml(contact.key)}" ${editor.members.has(contact.key) ? "checked" : ""}>
                ${this.contactAvatarMarkup(contact)}
                <span>${escapeHtml(contact.name)}</span>
                <i class="fa-solid fa-check" aria-hidden="true"></i>
              </label>`,
            )
            .join("")}
        </div>
        <div class="sv-room-actions">
          ${editor.id && !editor.without_user ? '<button type="button" class="sv-room-leave" data-group-leave title="방은 목록에서 사라지고, 채팅 기억에는 나눈 대화와 내가 나간 일이 남습니다."><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>방 나가기</span></button>' : ""}
          ${editor.id ? '<button type="button" class="sv-room-leave" data-group-delete title="방과 메시지, 채팅 기억까지 모두 지웁니다."><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>방 삭제</span></button>' : ""}
          <button type="button" class="sv-room-save" data-group-save ${editor.members.size < 2 ? "disabled" : ""}>${editor.id ? "저장" : "만들기"}</button>
        </div>
      </div>`;
    const save = body.querySelector("[data-group-save]");
    body.querySelector("#sv-room-name").addEventListener("input", (event) => {
      editor.name = event.target.value;
    });
    body.querySelector("#sv-room-alone").addEventListener("change", (event) => {
      editor.without_user = event.target.checked;
      body.querySelector(".sv-room-alone-options").hidden = !editor.without_user;
      body.querySelector(".sv-room-hint").textContent = editor.without_user
        ? "자기들끼리 대화할 사람을 두 명 이상 고르십시오."
        : "함께 대화할 사람을 두 명 이상 고르십시오.";
    });
    for (const [id, field] of [
      ["#sv-room-auto", "auto_chat"],
      ["#sv-room-every", "auto_every"],
      ["#sv-room-daily", "auto_daily_max"],
      ["#sv-room-min", "burst_min"],
      ["#sv-room-max", "burst_max"],
    ])
      body.querySelector(id).addEventListener("change", (event) => {
        editor[field] = event.target.type === "checkbox" ? event.target.checked : Number(event.target.value);
      });
    body.querySelectorAll(".sv-room-person input").forEach((box) =>
      box.addEventListener("change", () => {
        if (box.checked) editor.members.add(box.value);
        else editor.members.delete(box.value);
        save.disabled = editor.members.size < 2;
      }),
    );
    body.querySelector("[data-group-cancel]").addEventListener("click", () => {
      this.groupEditor = null;
      this.renderSmartphone();
    });
    save.addEventListener("click", () => this.run(() => this.saveGroup()));
    body
      .querySelector("[data-group-delete]")
      ?.addEventListener("click", () => this.run(() => this.deleteGroup()));
    body
      .querySelector("[data-group-leave]")
      ?.addEventListener("click", () => this.run(() => this.leaveGroup()));
  },

  async saveGroup() {
    const editor = this.groupEditor;
    const members = [...editor.members].map((key) => {
      const saved = this.messageGroup(`${GROUP}${editor.id}`)?.members.find(
        (member) => this.livePersonKey(member.key, member.name) === key,
      );
      return { key, name: this.memberContact({ key, name: saved?.name || "" }).name };
    });
    if (members.length < 2) throw new Error("두 명 이상 골라 주십시오.");
    const response = await this.request(
      `/api/plugins/scenevoice/message-groups${editor.id ? `/${encodeURIComponent(editor.id)}` : ""}`,
      {
        method: editor.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.currentChatId(),
          name: editor.name.trim(),
          members,
          without_user: editor.without_user,
          auto_chat: editor.auto_chat,
          auto_every: editor.auto_every,
          auto_daily_max: editor.auto_daily_max,
          burst_min: editor.burst_min,
          burst_max: editor.burst_max,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "단체방을 저장하지 못했습니다.");
    this.groupEditor = null;
    this.messageThreadKey = `${GROUP}${data.group.id}`;
    await this.renderSmartphone();
  },

  /**
   * Leaves a group: the room and its messages leave the phone, but the chat memory keeps what
   * was said there, with a last line that the user left.
   */
  async leaveGroup() {
    const key = `${GROUP}${this.groupEditor.id}`;
    if (!confirm("단체방에서 나가시겠습니까? 방과 메시지는 휴대폰에서 사라지고, 채팅 기억에는 나눈 대화와 내가 나간 일이 남습니다."))
      return;
    const items = (await this.loadMessages()).filter((item) => this.messageThreadOf(item) === key);
    if (items.length) await this.persistTextThreadMemory(key, items.at(-1).anchor_message_id, { left: true });
    await this.removeGroup(this.groupEditor.id);
  },

  /** Deletes a group: it, its messages and their chat memories all go. */
  async deleteGroup() {
    const key = `${GROUP}${this.groupEditor.id}`;
    if (!confirm("단체방을 삭제하시겠습니까? 메시지와 채팅 기억까지 모두 지워집니다.")) return;
    const anchors = new Set(
      (await this.loadMessages({ all: true }))
        .filter((item) => this.messageThreadOf(item) === key)
        .map((item) => String(item.anchor_message_id)),
    );
    await this.removeGroup(this.groupEditor.id);
    for (const anchor of anchors) await this.persistTextThreadMemory(key, anchor);
    await this.renderSmartphone();
  },

  async removeGroup(id) {
    const response = await this.request(
      `/api/plugins/scenevoice/message-groups/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.currentChatId() }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "단체방을 지우지 못했습니다.");
    this.groupEditor = null;
    this.messageThreadKey = "";
    this.unreadThreads.delete(`${GROUP}${id}`);
    await this.renderSmartphone();
  },

  /**
   * A room without the user goes on: on 대화 이어 보기 the members write burst_min to burst_max
   * messages; when it picks up by itself (`optional`) they may also stay quiet.
   */
  async continueGroupBurst(key, { optional = false } = {}) {
    if (this.textReplyBusy) return;
    const group = this.messageGroup(key);
    if (!group?.without_user) return;
    const profileId =
      this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) {
      if (!optional) throw new Error("대화를 만들 실리태번 연결 프로필을 먼저 골라 주십시오.");
      return;
    }
    const operation = this.captureChat();
    const viewing = () =>
      !document.getElementById("sv-smartphone")?.classList.contains("hidden") &&
      this.phoneActiveTab === "message" &&
      this.messageThreadKey === key;
    this.textReplyBusy = key;
    if (viewing()) await this.renderSmartphone();
    try {
      const max = optional ? Math.min(group.burst_max || 15, 6) : group.burst_max || 15;
      await this.generateGroupReply(key, {
        operation,
        profileId,
        viewing,
        burst: { count: { min: optional ? 1 : Math.min(group.burst_min || 6, max), max }, optional },
      });
    } finally {
      if (!operation.signal.aborted) {
        this.textReplyBusy = "";
        if (viewing()) await this.renderSmartphone();
      }
    }
  },

  /** After each AI reply: a room set to talk by itself looks in every auto_every replies. */
  async groupAutoChatTick() {
    if (!this.hasCharacterChat?.() || !this.phoneOn()) return;
    await this.loadMessageGroups().catch(() => []);
    this.groupAutoCounters ||= new Map();
    for (const group of this.messageGroups || []) {
      if (!group.without_user || !group.auto_chat) continue;
      const count = (this.groupAutoCounters.get(group.id) || 0) + 1;
      if (count < (group.auto_every || 6)) {
        this.groupAutoCounters.set(group.id, count);
        continue;
      }
      this.groupAutoCounters.set(group.id, 0);
      // The day's limit is kept with the room, so every device counts together.
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const response = await this.request(
        `/api/plugins/scenevoice/message-groups/${encodeURIComponent(group.id)}/auto-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: this.currentChatId(), day }),
        },
      );
      if (!response.ok || !(await response.json()).allowed) continue;
      await this.continueGroupBurst(`${GROUP}${group.id}`, { optional: true });
    }
  },

  /** 재생성 in a room without the user: the last round goes, and a new one comes. */
  async regenerateGroupBurst(key) {
    const thread = (await this.loadMessages()).filter((item) => this.messageThreadOf(item) === key);
    const last = thread.at(-1);
    const mark = last?.round || last?.reason;
    const round = mark ? thread.filter((item) => (item.round || item.reason) === mark) : thread.slice(-1);
    if (!round.length) return;
    await this.regenerateRound(key, round, () => this.continueGroupBurst(key));
  },

  /**
   * The members' answers from a model reply, in order: {member, kind, parsed}. A reply that came
   * as plain "Name: text" lines is read too; one that can't be read at all is an error.
   */
  normalizeGroupReply(parsed, members, allowVoice = false, most = 6) {
    const names = (member) => [
      member.name,
      ...String(this.config.character_voices?.[member.key]?.aliases || "").split(/[,、，]/),
    ]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    const memberOf = (from) => {
      const name = String(from || "").trim().toLowerCase();
      if (!name) return null;
      return (
        members.find((member) => names(member).includes(name)) ||
        members.find((member) => names(member).some((alias) => name.includes(alias))) ||
        null
      );
    };
    let list = Array.isArray(parsed?.messages)
      ? parsed.messages
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!list && typeof parsed?.text === "string") {
      list = [];
      for (const line of parsed.text.split("\n")) {
        const match = line.match(/^\s*([^:：]{1,40})[:：]\s*(.+)$/);
        if (match && memberOf(match[1])) list.push({ from: match[1], text: match[2] });
        else if (list.length && line.trim()) list.at(-1).text += `\n${line.trim()}`;
      }
      if (!list.length) list = null;
    }
    if (!list) throw new Error("보조 모델의 단체방 답장을 읽지 못했습니다. 다시 시도해 주십시오.");
    return list
      .map((entry) => ({ member: memberOf(entry?.from ?? entry?.name ?? entry?.speaker), entry }))
      .filter(({ member, entry }) => member && String(entry?.text ?? "").trim())
      .slice(0, most)
      .map(({ member, entry }) => ({
        member,
        kind: allowVoice && String(entry.type).toLowerCase() === "voice" ? "voice" : "text",
        parsed: entry,
      }));
  },

  /**
   * The members who would answer the user's latest texts in a group do, one after another.
   * `burst`: a room without the user goes on by itself instead ({count: {min, max}, optional}).
   */
  async generateGroupReply(key, { operation, profileId, viewing, burst = null }) {
    if (!this.messageGroup(key)) await this.loadMessageGroups();
    const group = this.messageGroup(key);
    if (!group) return;
    const thread = (await this.loadMessages())
      .filter((item) => this.messageThreadOf(item) === key)
      .slice(-40);
    if (!burst && thread.at(-1)?.role !== "user") return;
    const members = group.members.map((member) => this.memberContact(member));
    const lines = thread.slice(-6).map((item) => item.text);
    const latest = [...thread].reverse().find((item) => item.role === "user")?.text;
    // Each member speaks their own language: their setting, otherwise the conversation's.
    const languages = members.map((member) =>
      this.conversationLanguage(lines, latest, member.key),
    );
    const allowVoice = this.config.voice_message?.reply_voice !== false;
    const openCard = this.getStateIdentity().characterKey;
    // Each member's own state, kept short (away when not in the scene), or only that nobody
    // knows where they are.
    const states = await Promise.all(members.map((member) => this.stateForPrompt(member.key)));
    const memberState = (found) =>
      found?.unknown
        ? { unknown_whereabouts: true }
        : found?.state
          ? {
              state: { summary: found.state.summary || "", contact: found.state.contact || {} },
              ...(found.away ? { away: true } : {}),
            }
          : {};
    const messages = phoneMessages(
      groupTextSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        translation: languages.some((language) => this.wantsTranslation(language)),
        allowVoice,
        soundEffects: members.every((member) => this.soundEffectsFor(member.key)),
        states: states.some((found) => found?.state),
        absent: states.some((found) => found?.unknown || found?.away),
        unknown: states.some((found) => found?.unknown),
        withoutUser: Boolean(burst),
        count: burst?.count || null,
        optional: Boolean(burst?.optional),
      }),
      [
        dataBlock("user_character", this.userCharacterName()),
        dataBlock("group_name", group.name),
        dataBlock(
          "members",
          members.map((member, index) => ({
            name: member.name,
            language: `${languageName(languages[index])} (${languages[index]})`,
            emotional_range: this.emotionalRange(member.key),
            ...(this.realtimeFor(member.key) ? { knows_real_time: true } : {}),
            performance_note: member.note || "",
            // Someone from another card brings that card's description; the open card's
            // people are described in <profile>.
            ...(member.description && member.cardKey && member.cardKey !== openCard
              ? { profile: member.description.slice(0, 1200) }
              : {}),
            ...memberState(states[index]),
          })),
        ),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock(
          "recent_chat",
          this.buildRecentChatContext(this.config.phone?.context_messages ?? 10),
        ),
        ...((await this.statusLinesBlocks?.()) || []),
        ...((await this.worldInfoBlocks?.(thread.map((item) => item.text))) || []),
        ...this.currentTimeBlocks(members.map((member) => member.key)),
        dataBlock(
          "text_thread",
          this.textThreadData(
            thread,
            "",
            members.some((member) => this.realtimeFor(member.key)),
          ),
        ),
      ],
      groupTextFinal(group.name),
    );
    this.assertChat(operation);
    const most = burst?.count?.max || 6;
    const parsed = await this.requestSpokenReply(profileId, messages, 600 + 170 * most);
    this.assertChat(operation);
    const replies = this.normalizeGroupReply(parsed, members, allowVoice, most);
    // One round shares a mark, so 답변 재생성 can take it back whole (and keep it as a version).
    const round = `round-${Date.now().toString(36)}`;
    let last = null;
    // The pause before each next message grows with what it says, as if it were being typed.
    const pause = (reply) => {
      const length = Array.from(String(reply.parsed?.text ?? "").replace(/\[[^\]]*\]/g, "")).length;
      const typing = burst ? 800 + Math.min(2000, length * 35) : 1000 + Math.min(2400, length * 45);
      return Math.round(typing * (0.85 + Math.random() * 0.3));
    };
    for (const [index, reply] of replies.entries()) {
      if (index) await wait(pause(reply));
      this.assertChat(operation);
      last = await this.saveCharacterMessage({
        character: reply.member,
        kind: reply.kind,
        origin: burst ? "incoming" : "reply",
        reason: burst ? round : "",
        round,
        parsed: reply.parsed,
        threadKey: key,
      });
      last.from = reply.member.name;
      if (viewing()) await this.renderSmartphone();
    }
    if (!replies.length) {
      if (viewing())
        this.notify(
          burst ? "지금은 아무도 말하지 않았습니다." : "읽었지만 아무도 답하지 않았습니다.",
          "info",
        );
      return;
    }
    if (!viewing()) this.announceText(key, group.name, `${last.from}: ${last.text || ""}`, "text");
  },
};
