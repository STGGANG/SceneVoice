// 음성 메모: what characters record on their phone for themselves (the user's character never hears
// it), a peek at what they were thinking around then. Made when asked in the 음성 메모 app, or now
// and then on their own when the state update suggests someone would (no extra request for that).
// Each is one line voiced on demand. Kept out of the chat memory: it doesn't steer the story.
import { escapeHtml } from "./common.js";
import { dataBlock, phoneMessages, voiceMemoFinal, voiceMemoSystem } from "./prompts.js";

// A suggested memo really gets recorded this often, at most one a state update.
const MEMO_CHANCE = 0.3;

export const memos = {
  memoAppOn() {
    return this.phoneOn() && this.config.phone?.memo_app !== false;
  },

  /** Memos on their own: the app on, and state updates running (they suggest them). */
  autoMemosOn() {
    return this.memoAppOn() && Boolean(this.stateTrackingRuns?.());
  },

  /** The memo the state update suggests (voice_memo), or null. */
  normalizeVoiceMemo(raw) {
    const source = raw?.voice_memo;
    const key = String(source?.key || "").trim();
    return key ? { key, about: String(source?.about || "").trim().slice(0, 300) } : null;
  },

  /** A suggested memo, rolled: not while asleep (with the user's character is fine). */
  async handleVoiceMemo(memo, sourceMessageId, sheets = new Map()) {
    if (!memo || !this.autoMemosOn() || !this.hasCharacterChat()) return;
    const person = this.statePeople().find((item) => item.key === memo.key);
    if (!person) return;
    const sheet = sheets.get(person.key) || {};
    if (sheet.availability === "asleep") return;
    if (Math.random() >= MEMO_CHANCE) return;
    await this.writeVoiceMemo(person, memo.about, sourceMessageId, { origin: "auto" });
  },

  async loadMemos() {
    const response = await this.request(
      `/api/plugins/scenevoice/phone/memos?chat_id=${encodeURIComponent(this.currentChatId())}&limit=200`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `음성 메모를 불러오지 못했습니다 (${response.status})`);
    return data.items || [];
  },

  /**
   * One memo of `contact`'s, written in one request and kept, with its chat memory (they know
   * it, the user's character doesn't). `about`: what it is about, or empty to leave it to them.
   * Returns it.
   */
  async writeVoiceMemo(contact, about = "", sourceMessageId = "", { origin = "asked" } = {}) {
    const operation = this.captureChat();
    const profileId = this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) throw new Error("전화·문자에 쓸 연결 프로필을 설정해 주십시오.");
    const person = this.phoneContact(contact.key);
    const { blocks: stateBlocks, absent, unknown } = this.stateBlocks(await this.stateForPrompt(person.key));
    const language = this.conversationLanguage([], "", person.key);
    const before = (await this.loadMemos().catch(() => []))
      .filter((memo) => memo.character_key === person.key)
      .slice(0, 3)
      .map((memo) => memo.text);
    const messages = phoneMessages(
      voiceMemoSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        language,
        translation: this.wantsTranslation(language),
        soundEffects: this.phoneSoundEffects(person.key),
        fixedLanguage: this.languageIsFixed(person.key),
        absent,
        unknown,
      }),
      [
        dataBlock("user_character", this.userCharacterName()),
        dataBlock("target_character", person.name),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock("performance_note", person.note || "", { range: this.emotionalRange(person.key) }),
        ...stateBlocks,
        dataBlock("recent_chat", this.buildRecentChatContext(this.config.phone?.context_messages ?? 10)),
        ...((await this.worldInfoBlocks?.([about])) || []),
        ...this.currentTimeBlocks([person.key]),
        ...(before.length ? [dataBlock("previous_memos", before)] : []),
        dataBlock("about", about || "(decide from context)"),
      ],
      voiceMemoFinal(person.name, language),
    );
    this.assertChat(operation);
    const draft = this.normalizePhoneDraft(await this.requestSpokenReply(profileId, messages, 700));
    this.assertChat(operation);
    if (!draft.text) throw new Error("보조모델이 메모를 돌려주지 않았습니다. 다시 시도해 주십시오.");
    const anchor = String(this.phoneAnchorFromSource(sourceMessageId).index);
    const response = await this.request("/api/plugins/scenevoice/phone/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.getStateIdentity().chatId,
        anchor_message_id: anchor,
        ...this.anchorStamp(anchor),
        character_key: person.key,
        character_name: person.name,
        text: draft.text,
        script: draft.script,
        translation: draft.translation,
        tags: draft.tags,
        intensity: draft.intensity,
        language: draft.language,
        about,
        origin,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `음성 메모 저장 실패 (${response.status})`);
    if (origin === "auto") this.announceMemo(data.item);
    return data.item;
  },

  /** A memo of theirs came in on its own: unheard, and a banner for a few seconds. */
  announceMemo(memo) {
    (this.unheardMemos ||= new Set()).add(memo.id);
    this.textAlert = {
      key: memo.character_key,
      name: String(memo.character_name || ""),
      text: String(memo.text || "").split("\n")[0].slice(0, 70),
      kind: "memo",
      at: Date.now(),
    };
    clearTimeout(this.textAlertTimer);
    this.textAlertTimer = setTimeout(() => {
      this.textAlert = null;
      this.updatePhoneLauncherVisibility();
    }, 8000);
    this.updatePhoneLauncherVisibility();
    if (this.phoneActiveTab === "memo") this.renderSmartphone();
  },

  /** A memo's voice, made (or remade) and linked to it; played right away. */
  async playMemo(body, memo, button, regenerate = false) {
    this.unheardMemos?.delete(memo.id);
    if (memo.audio_url && !regenerate) {
      this.playMessageAudio(memo, this.apiUrl(memo.audio_url), button);
      return;
    }
    this.unlockAudioForMobile();
    const icon = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    try {
      const session = {
        chat_id: memo.chat_id,
        anchor_message_id: memo.anchor_message_id,
        character_key: memo.character_key,
        character_name: memo.character_name,
      };
      const voice = await this.speakPhoneLine(session, { ...memo, role: "character", turn_index: 0 }, regenerate);
      const attach = await this.request(`/api/plugins/scenevoice/phone/memos/${encodeURIComponent(memo.id)}/audio`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: memo.chat_id,
          generation_id: voice.mixed?.id || voice.historyId,
          audio_filename: voice.mixed?.filename || voice.filename,
          mime_type: voice.mixed ? "audio/wav" : voice.mimeType,
          applied_control: voice.applied,
        }),
      });
      const data = await attach.json();
      if (!attach.ok) throw new Error(data.detail || `음성 연결 실패 (${attach.status})`);
      const url = this.createAudioUrl(voice.mixed?.blob || voice.blob);
      let lit = null;
      if (body.isConnected && this.phoneActiveTab === "memo") {
        await this.renderSmartphone();
        lit = body.querySelector(`[data-memo-play="${CSS.escape(memo.id)}"]`);
      }
      this.playMessageAudio({ ...memo, ...data.item, sounds_mixed: Boolean(voice.mixed), kind: "voice" }, url, lit, { revoke: true });
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = icon;
      }
    }
  },

  async editMemo(memo) {
    const value = await this.openLineSheet({ title: "음성 메모 고치기", value: memo.script || memo.text });
    if (value === null) return;
    const edit = this.spokenEdit(value);
    if (!edit.text) throw new Error("메모를 비울 수는 없습니다.");
    if (edit.text === memo.text && edit.script === (memo.script || "")) return;
    const response = await this.request(`/api/plugins/scenevoice/phone/memos/${encodeURIComponent(memo.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: memo.chat_id,
        ...edit,
        ...(edit.text === memo.text && memo.translation ? { translation: memo.translation } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "메모를 고치지 못했습니다.");
    await this.renderSmartphone();
  },

  async deleteMemo(memo) {
    if (!confirm(`${memo.character_name || "이 인물"}의 음성 메모를 지우시겠습니까?`)) return;
    const response = await this.request(`/api/plugins/scenevoice/phone/memos/${encodeURIComponent(memo.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: memo.chat_id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "메모를 지우지 못했습니다.");
    if (this.anchorShown(memo)) await this.removeChatMemoryEvent(memo.anchor_message_id, memo.id);
    else await this.forgetSwipeMemory(memo);
    this.unheardMemos?.delete(memo.id);
    this.updatePhoneLauncherVisibility();
    await this.renderSmartphone();
  },

  /** The 음성 메모 app: everyone's memos, newest first, and 새 메모 to have one recorded now. */
  async renderSmartphoneMemos(body) {
    const editor = this.memoEditor;
    const contacts = this.phoneContacts();
    if (editor) {
      body.innerHTML = `
        <div class="sv-room-editor sv-memo-editor">
          <header class="sv-msg-head">
            <button type="button" class="sv-phone-back" data-memo-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 음성 메모</button>
            <strong class="sv-room-editor-title">새 메모</strong>
          </header>
          <p class="sv-room-hint">고른 인물이 지금 혼자 휴대폰에 남기는 음성 메모입니다. 내 캐릭터는 모릅니다.</p>
          <label class="sv-room-name"><span>누가</span><select id="sv-memo-person" ${editor.busy ? "disabled" : ""}>${contacts
            .map((contact) => `<option value="${escapeHtml(contact.key)}" ${contact.key === editor.key ? "selected" : ""}>${escapeHtml(contact.name)}</option>`)
            .join("")}</select></label>
          <label class="sv-room-name"><span>무엇에 대한 메모인지</span><input id="sv-memo-about" maxlength="300" placeholder="비워 두면 지금 상황에 맞게 정합니다" value="${escapeHtml(editor.about)}" autocomplete="off" ${editor.busy ? "disabled" : ""}></label>
          <div class="sv-room-actions">
            <button type="button" class="sv-room-save" data-memo-make ${editor.busy ? "disabled" : ""}>${editor.busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 메모 받아 오는 중…' : "메모 만들기"}</button>
          </div>
        </div>`;
      body.querySelector("#sv-memo-person").addEventListener("change", (event) => {
        editor.key = event.target.value;
      });
      body.querySelector("#sv-memo-about").addEventListener("input", (event) => {
        editor.about = event.target.value;
      });
      body.querySelector("[data-memo-cancel]").addEventListener("click", () => {
        this.memoEditor = null;
        this.renderSmartphone();
      });
      body.querySelector("[data-memo-make]").addEventListener("click", () =>
        this.run(async () => {
          if (editor.busy) return;
          editor.busy = true;
          await this.renderSmartphone();
          try {
            await this.writeVoiceMemo(this.phoneContact(editor.key), editor.about.trim());
            if (this.memoEditor === editor) this.memoEditor = null;
          } finally {
            editor.busy = false;
            if (this.phoneActiveTab === "memo") await this.renderSmartphone();
          }
        }),
      );
      return;
    }
    body.innerHTML =
      '<div class="sv-phone-list-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><p>음성 메모를 불러오는 중…</p></div>';
    let items;
    try {
      items = (await this.loadMemos()).filter((memo) => this.anchorShown(memo));
    } catch (error) {
      body.innerHTML = `<div class="sv-phone-list-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(error.message)}</p></div>`;
      return;
    }
    if (this.phoneActiveTab !== "memo" || this.memoEditor) return;
    this.memoRecords = new Map(items.map((memo) => [memo.id, memo]));
    const add = contacts.length
      ? '<button type="button" class="sv-msg-new-group sv-memo-new" data-memo-new><i class="fa-solid fa-plus" aria-hidden="true"></i><span>새 메모</span></button>'
      : "";
    const playing = (memo) => (this.playingMessageId === memo.id && this.currentAudio ? " sv-playing" : "");
    body.innerHTML = `
      <div class="sv-memo-list">
        ${add}
        ${
          items.length
            ? items
                .map((memo, index) => {
                  const fresh = this.unheardMemos?.has(memo.id);
                  const named = (label) => (index === 0 ? `<span>${label}</span>` : "");
                  return `
              <article class="sv-memo${playing(memo) ? " sv-msg-reading" : ""}" data-memo="${escapeHtml(memo.id)}">
                <header>
                  ${this.contactAvatarMarkup(this.phoneContact(memo.character_key))}
                  <span class="sv-recent-main"><strong>${escapeHtml(memo.character_name || "")}</strong><small>${escapeHtml([this.chatSpotLabel?.(memo), this.formatPhoneDate(memo.created_at), memo.origin === "auto" && "혼자 남김"].filter(Boolean).join(" · "))}</small></span>
                  ${fresh ? '<i class="sv-unread-dot" aria-label="아직 안 들음"></i>' : ""}
                  <button type="button" class="sv-memo-play sv-msg-play${playing(memo)}" data-memo-play="${escapeHtml(memo.id)}" aria-label="재생" title="${memo.audio_url ? "재생" : "재생: 음성을 만든 뒤 재생합니다"}"><i class="fa-solid fa-play" aria-hidden="true"></i></button>
                </header>
                <p>${escapeHtml(memo.text)}</p>
                ${this.translationHtml(memo)}
                <div class="sv-call-line-tools${index === 0 ? " sv-labeled" : ""}">${
                  memo.audio_url
                    ? `<button type="button" data-memo-reroll="${escapeHtml(memo.id)}" aria-label="음성 재생성" title="음성 재생성: 같은 메모로 목소리만 새로 만듭니다"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>${named("음성 재생성")}</button>`
                    : ""
                }<button type="button" data-memo-edit="${escapeHtml(memo.id)}" aria-label="고치기" title="고치기: 메모를 고친 뒤 음성을 새로 만듭니다"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button type="button" data-memo-delete="${escapeHtml(memo.id)}" aria-label="삭제" title="삭제"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></div>
              </article>`;
                })
                .join("")
            : '<div class="sv-phone-list-empty"><span class="sv-empty-badge sv-app-memo"><i class="fa-solid fa-wave-square" aria-hidden="true"></i></span><strong>음성 메모</strong><p>아직 남긴 메모가 없습니다.</p></div>'
        }
      </div>`;
    const record = (id) => this.memoRecords.get(id);
    body.querySelector("[data-memo-new]")?.addEventListener("click", () => {
      this.memoEditor = { key: contacts[0].key, about: "", busy: false };
      this.renderSmartphone();
    });
    body.querySelectorAll("[data-memo-play]").forEach((button) =>
      button.addEventListener("click", () => {
        const memo = record(button.dataset.memoPlay);
        // Pressed again while it sounds: it stops.
        if (this.playingMessageId === memo.id && this.currentAudio) {
          this.stopPlayback();
          return;
        }
        this.run(() => this.playMemo(body, memo, button));
      }),
    );
    body.querySelectorAll("[data-memo-reroll]").forEach((button) =>
      button.addEventListener("click", () => this.run(() => this.playMemo(body, record(button.dataset.memoReroll), button, true))),
    );
    body.querySelectorAll("[data-memo-edit]").forEach((button) =>
      button.addEventListener("click", () => this.run(() => this.editMemo(record(button.dataset.memoEdit)))),
    );
    body.querySelectorAll("[data-memo-delete]").forEach((button) =>
      button.addEventListener("click", () => this.run(() => this.deleteMemo(record(button.dataset.memoDelete)))),
    );
  },
};
