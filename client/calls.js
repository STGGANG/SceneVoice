// 전화: outgoing and incoming calls, the call screen, the other side's lines from the helper model
// and their voices.
import {
  callFinal,
  callSystem,
  dataBlock,
  languageName,
  overheardCallFinal,
  overheardCallSystem,
  phoneMessages,
} from "./prompts.js";
import {
  FINAL_CALL_STATUSES,
  escapeHtml,
  clamp,
  normalizeTags,
  tagEmotion,
} from "./common.js";
import { cleanScript, stripTags } from "../shared/providers.js";
import { SPEECH_LANGUAGES } from "../shared/settings.js";

// How long a call of theirs rings before it counts as missed (and they may leave a voicemail).
const RING_SECONDS = 60;
// About 150 tokens a line with tags and translation.
const OVERHEARD_REPLY_TOKENS = { short: 1400, normal: 2200, long: 4000 };
// A goodbye in the last lines of a call (Korean, Japanese, English, Chinese).
const FAREWELL =
  /(?:안녕|잘\s*자|잘\s*있어|다음에\s*(?:보자|봐|통화)|나중에\s*(?:보자|봐|통화)|들어가|끊을게|끊자|끊는다|이만|じゃあね|またね|おやすみ|バイバイ|切るね|失礼します|再见|拜拜|晚安)|\b(?:bye|goodbye|good night|see you|see ya|talk (?:to you )?later|gotta go)\b/iu;

export const calls = {
  async renderSmartphoneCall(body) {
    if (this.voicemailBox) {
      this.stopPhoneTimer();
      this.renderVoicemailBox(body);
      return;
    }
    if (this.groupCallPicker && !this.phoneSession) {
      this.stopPhoneTimer();
      this.renderGroupCallPicker(body);
      return;
    }
    const session = this.phoneSession;
    if (!session && this.phonePendingEvent?.type === "incoming_call") {
      // The person the state analysis picked as the caller (the main card otherwise).
      const character = this.phoneContact(
        this.phonePendingEvent.callerKey || this.getCurrentCharacterProfile().key,
      );
      this.stopPhoneTimer();
      body.innerHTML = `
                <div class="sv-incoming-call" data-phone-wallpaper>
                    <div class="sv-incoming-top">
                        <span class="sv-call-kicker"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i>수신 전화</span>
                        <h3>${escapeHtml(character.name)}</h3>
                        <p>전화가 걸려 오고 있습니다…</p>
                    </div>
                    <div class="sv-incoming-avatar"><span class="sv-ring" aria-hidden="true"></span><span class="sv-ring" aria-hidden="true"></span>${this.contactAvatarMarkup(character)}</div>
                    <div class="sv-incoming-actions">
                        <div><button type="button" class="sv-reject-call" aria-label="거절"><i class="fa-solid fa-phone-slash" aria-hidden="true"></i></button><small>거절</small></div>
                        <div><button type="button" class="sv-answer-call" aria-label="수락"><i class="fa-solid fa-phone" aria-hidden="true"></i></button><small>수락</small></div>
                    </div>
                </div>`;
      body
        .querySelector(".sv-reject-call")
        ?.addEventListener("click", () => this.rejectIncomingCall());
      body
        .querySelector(".sv-answer-call")
        ?.addEventListener("click", () => this.acceptIncomingCall());
      return;
    }
    if (!session || !["active", "ringing"].includes(session.status)) {
      this.stopPhoneTimer();
      const people = this.phoneContacts();
      // Several people: pick one from the contact list first.
      if (!this.phoneContactKey && people.length > 1) {
        this.renderPhoneContacts(body, people);
        return;
      }
      const character = this.phoneContact(
        this.phoneContactKey || people[0]?.key || this.getCurrentCharacterProfile().key,
      );
      this.phoneContactKey = character.key;
      body.innerHTML = `
                <div class="sv-phone-home sv-call-contact" data-phone-wallpaper>
                    <div class="sv-contact-top">
                        ${people.length > 1 ? '<button type="button" class="sv-contact-pill" data-phone-contacts><i class="fa-solid fa-chevron-left" aria-hidden="true"></i>연락처</button>' : "<span></span>"}
                        <button type="button" class="sv-contact-pill" data-phone-edit="${escapeHtml(character.key)}">편집</button>
                    </div>
                    ${this.contactAvatarMarkup(character)}
                    <h3>${escapeHtml(character.name)}</h3>
                    <p class="sv-contact-status" data-status-for="${escapeHtml(character.key)}" hidden></p>
                    <p>${character.key === character.cardKey ? "봇카드" : escapeHtml(this.cardInfo(character.cardKey).name || "등장인물")}</p>
                    <div class="sv-contact-actions">
                        <button type="button" class="sv-contact-action" data-phone-app="message" data-thread-key="${escapeHtml(character.key)}"><span><i class="fa-solid fa-comment-dots" aria-hidden="true"></i></span><small>메시지</small></button>
                        <div class="sv-contact-main"><button type="button" id="sv-start-call" class="sv-call-start" aria-label="전화 걸기"><i class="fa-solid fa-phone" aria-hidden="true"></i></button><small>전화 걸기</small></div>
                        <button type="button" class="sv-contact-action" data-phone-app="history"><span><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></span><small>통화 기록</small></button>
                    </div>
                </div>`;
      body
        .querySelector("#sv-start-call")
        ?.addEventListener("click", (event) =>
          this.startOutgoingCall(event.currentTarget),
        );
      void this.fillStatusLines?.(body);
      return;
    }
    const turns = Array.isArray(session.turns) ? session.turns : [];
    // 단체 통화: everyone on it at the top.
    const group = this.isGroupCall?.(session);
    const name = escapeHtml(group ? this.callNames(session).join(", ") : session.character_name || "캐릭터");
    // Nothing answers my last line (or nobody has spoken) and nothing is being written.
    const unanswered = !this.phoneBusy && (!turns.length || turns.at(-1).role === "user");
    const previousReply = body.querySelector("#sv-call-reply");
    const replyFocused =
      Boolean(previousReply) && document.activeElement === previousReply;
    body.innerHTML = `
            <div class="sv-call-screen${group ? " sv-listen-between sv-listen-many" : ""}" data-phone-wallpaper>
                <div class="sv-call-identity">
                    ${
                      group
                        ? `<div class="sv-room-avatar" aria-hidden="true">${this.callMembers(session).slice(0, 4).map((member) => this.contactAvatarMarkup(member)).join("")}</div>`
                        : this.contactAvatarMarkup(this.phoneContact(session.character_key))
                    }
                    <h2>${name}</h2>
                    <span class="sv-call-state"><i class="sv-live-dot" aria-hidden="true"></i>통화 중 · <time class="sv-call-duration">00:00</time></span>
                </div>
                <div class="sv-call-live-line">${this.callLineHtml(session)}</div>
                <form class="sv-call-compose">
                    <textarea id="sv-call-reply" rows="1" maxlength="2000" placeholder="${unanswered ? "비워 두고 보내면 답을 다시 받습니다" : "대답 입력 혹은 대필 지시문 입력"}" aria-label="통화로 대답하기" ${this.phoneBusy ? "disabled" : ""}></textarea>
                    <button type="button" class="sv-ghostwrite" data-call-ghostwrite aria-label="대필" title="대필: 내 페르소나가 할 말을 대신 써 줍니다. 입력칸에 ‘늦는다고 사과해 줘’처럼 원하는 내용을 적어 두면 그 뜻대로 자연스럽게 쓰고, 써 둔 초안이면 다듬습니다. 비워 두면 알아서 씁니다." ${this.phoneBusy || this.ghostwriteBusy ? "disabled" : ""}><i class="fa-solid ${this.ghostwriteBusy === "call" ? "fa-spinner fa-spin" : "fa-pen-nib"}" aria-hidden="true"></i></button>
                    <button type="submit" ${this.phoneBusy ? "disabled" : ""} aria-label="통화 답변 보내기" title="${unanswered ? "보내기 · 비워 두고 누르면 상대의 답을 다시 받습니다" : "보내기"}"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
                </form>
                ${this.draftTranslationHtml?.("call", this.callReplyDraft) || ""}
                <div class="sv-call-controls"><button type="button" class="sv-call-end" aria-label="통화 종료" title="통화 종료"><i class="fa-solid fa-phone-slash" aria-hidden="true"></i></button></div>
            </div>`;
    body
      .querySelector(".sv-call-compose")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        this.sendPhoneReply();
      });
    body
      .querySelector(".sv-call-end")
      ?.addEventListener("click", () => this.endPhoneSession("ended"));
    body.querySelector("[data-call-ghostwrite]")?.addEventListener("click", () =>
      this.run(async () => {
        if (this.ghostwriteBusy || this.phoneBusy) return;
        this.ghostwriteBusy = "call";
        await this.renderSmartphone();
        try {
          this.callReplyDraft = await this.ghostwriteDraft("call", "", this.callReplyDraft || "");
        } finally {
          this.ghostwriteBusy = "";
          await this.renderSmartphone();
        }
      }),
    );
    this.bindCallLine(body.querySelector(".sv-call-live-line"), session);
    const reply = body.querySelector("#sv-call-reply");
    // A redraw (a voice finishing, a new line arriving) keeps what the user was typing.
    if (reply && !reply.disabled) {
      reply.value = this.callReplyDraft || "";
      // Only on a desktop: on a phone it would pop the keyboard up again.
      if (replyFocused && !this.isMobilePhoneLayout()) reply.focus();
    }
    // Desktop: Enter sends, Shift+Enter adds a line. Touch keyboards keep Enter as a new line.
    reply?.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        // Safari ends a Korean or Japanese composition with an Enter that isn't marked composing.
        event.isComposing ||
        event.keyCode === 229 ||
        this.isMobilePhoneLayout()
      )
        return;
      event.preventDefault();
      this.sendPhoneReply();
    });
    // Re-measured only when the height may change (measuring every keystroke was slow).
    let lastLength = reply?.value.length || 0;
    const draftBox = body.querySelector("[data-draft-translation]");
    reply?.addEventListener("input", () => {
      this.callReplyDraft = reply.value;
      this.syncDraftTranslation?.(draftBox, "call", reply.value);
      const shorter = reply.value.length < lastLength;
      lastLength = reply.value.length;
      if (!shorter && reply.scrollHeight <= reply.clientHeight) return;
      reply.style.height = "auto";
      reply.style.height = `${Math.min(reply.scrollHeight, 76)}px`;
    });
    this.startPhoneTimer(session);
  },

  /**
   * Under who is on the call: their line and what can be done with it (▶ · 음성 재생성 · 답변
   * 재생성 · ✎). A group call shows one line of the round at a time (the one playing, else the
   * one picked with ‹ ›, else its first), so the buttons act on that line.
   */
  callLineHtml(session) {
    const turns = Array.isArray(session.turns) ? session.turns : [];
    const latest = [...turns].reverse().find((turn) => turn.role === "character") || null;
    if (this.phoneBusy)
      return '<div class="sv-call-thinking"><span class="sv-typing" aria-hidden="true"><i></i><i></i><i></i></span><span>상대가 대답하는 중…</span></div>';
    if (!latest) return '<p class="sv-call-waiting">연결되었습니다. 답이 없으면 비워 둔 채 보내기를 누르십시오.</p>';
    const group = this.isGroupCall?.(session);
    const lastMine = turns.findLastIndex((turn) => turn.role === "user");
    // Several lines since mine (a group's round, or a reply with remarks behind it): one at a time.
    const round = turns.slice(lastMine + 1).filter((turn) => turn.role === "character");
    const shown = round.length > 1 ? round.find((turn) => turn.id === this.groupCallShown?.id) || round[0] : latest;
    const at = round.indexOf(shown);
    const busy = Boolean(shown.id) && this.phoneAudioBusyTurnId === shown.id;
    const off = busy ? "disabled" : "";
    const who = escapeHtml(shown.speaker_name || session.character_name || "캐릭터");
    const pager =
      round.length > 1
        ? `<span class="sv-msg-versions sv-call-versions sv-group-pager"><button type="button" class="sv-call-version" data-group-line="${escapeHtml(round[at - 1]?.id || "")}" aria-label="앞 사람 대사" ${at > 0 ? "" : "disabled"}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><small>${at + 1}/${round.length}</small><button type="button" class="sv-call-version" data-group-line="${escapeHtml(round[at + 1]?.id || "")}" aria-label="다음 사람 대사" ${at < round.length - 1 ? "" : "disabled"}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></span>`
        : "";
    return `<div class="sv-call-caption"><div class="sv-call-caption-head"><small>${who}${shown.aside ? " · 뒤에서" : ""}</small>${pager}</div><p>${escapeHtml(shown.text)}</p>${this.translationHtml(shown)}</div>
      <div class="sv-call-audio-actions sv-call-line-actions">
        <button type="button" class="sv-call-icon-action" data-phone-turn-play="${escapeHtml(shown.id)}" aria-label="재생" title="${shown.audio_url ? "재생" : "재생: 음성을 만든 뒤 재생합니다"}" ${off}><i class="fa-solid ${busy ? "fa-spinner fa-spin" : "fa-play"}" aria-hidden="true"></i></button>
        <button type="button" data-phone-turn-reroll="${escapeHtml(shown.id)}" title="음성 재생성: 같은 대사로 목소리만 새로 만듭니다" ${off}><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>음성 재생성</span></button>
        ${turns.at(-1)?.id === latest.id ? `<button type="button" data-phone-turn-regen="${escapeHtml(latest.id)}" title="${round.length > 1 ? "답변 재생성: 이번에 받은 대사들을 모두 새로 받습니다" : "답변 재생성: 같은 흐름에서 이 대사를 새로 받습니다"}" ${off}><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i><span>답변 재생성</span></button>` : ""}
        <button type="button" class="sv-call-icon-action" data-phone-turn-edit="${escapeHtml(shown.id)}" aria-label="고치기" title="고치기: 대사를 고친 뒤 음성을 새로 만듭니다" ${off}><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        ${group ? "" : this.callVersionsHtml(latest, turns, busy)}
      </div>`;
  },

  bindCallLine(root, session) {
    if (!root) return;
    root.querySelector("[data-phone-turn-play]")?.addEventListener("click", (event) => {
      this.handlePhoneTurnPlayback(event.currentTarget.dataset.phoneTurnPlay, false, event.currentTarget);
    });
    root.querySelector("[data-phone-turn-reroll]")?.addEventListener("click", (event) => {
      this.handlePhoneTurnPlayback(event.currentTarget.dataset.phoneTurnReroll, true, event.currentTarget);
    });
    root
      .querySelector("[data-phone-turn-regen]")
      ?.addEventListener("click", (event) => this.regeneratePhoneTurn(event.currentTarget.dataset.phoneTurnRegen));
    root
      .querySelector("[data-phone-turn-edit]")
      ?.addEventListener("click", (event) => this.run(() => this.editPhoneTurn(event.currentTarget.dataset.phoneTurnEdit)));
    const latest = [...(session.turns || [])].reverse().find((turn) => turn.role === "character");
    root.querySelectorAll("[data-call-version]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.switchPhoneTurnVersion(latest.id, Number(button.dataset.callVersion))),
      ),
    );
    root.querySelectorAll("[data-group-line]").forEach((button) =>
      button.addEventListener("click", () => this.showGroupLine(button.dataset.groupLine)),
    );
  },

  /** A group call's line to show; only the line is drawn again (the reply box keeps its focus). */
  showGroupLine(id) {
    this.groupCallShown = { id };
    const live = document.querySelector("#sv-smartphone .sv-call-screen .sv-call-live-line");
    if (!live || this.phoneActiveTab !== "call" || !this.phoneSession) return;
    live.innerHTML = this.callLineHtml(this.phoneSession);
    this.bindCallLine(live, this.phoneSession);
  },

  /** ‹ n/m › for the last line when 답변 재생성 has given it more than one answer. */
  callVersionsHtml(turn, turns, busy) {
    const count = turn.versions?.length || 0;
    if (count < 2 || turns.at(-1)?.id !== turn.id) return "";
    const shown = Number.isInteger(turn.version) ? turn.version : count - 1;
    const step = (to, icon, label) =>
      `<button type="button" class="sv-call-version" data-call-version="${to}" aria-label="${label}" ${busy || to < 0 || to >= count ? "disabled" : ""}><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
    return `<div class="sv-msg-versions sv-call-versions" title="다른 답 보기: 지금 보이는 답으로 통화가 이어집니다">${step(shown - 1, "fa-chevron-left", "이전 답")}<small>${shown + 1}/${count}</small>${step(shown + 1, "fa-chevron-right", "다음 답")}</div>`;
  },

  async acceptIncomingCall() {
    // The tap that answers also unlocks audio, so the reply can play once it is ready.
    this.unlockAudioForMobile();
    this.callReplyDraft = "";
    const operation = this.captureChat();
    if (!this.phonePendingEvent || this.phoneBusy) return;
    const pending = this.phonePendingEvent;
    clearTimeout(this.ringTimer);
    this.ringReturnTab = null;
    this.phoneBusy = true;
    const operationToken = ++this.phoneOperationToken;
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(pending.sessionId)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || `전화 수락 실패 (${response.status})`);
      this.phoneSession = data.session;
      this.phonePendingEvent = null;
      this.updatePhoneLauncherVisibility();
      await this.persistPhoneSessionToMessage();
      await this.renderSmartphone();
      await this.generateCharacterPhoneTurn({ opening: true, operationToken });
    } catch (error) {
      if (operation.signal.aborted) return;
      this.notify(error.message || "전화를 받을 수 없습니다.", "error");
      // Still ringing: it rings out as before.
      if (this.phonePendingEvent === pending) this.armRingTimeout();
    } finally {
      if (!operation.signal.aborted) {
        this.phoneBusy = false;
        await this.renderSmartphone();
      }
    }
  },

  rejectIncomingCall() {
    return this.closeIncomingCall("rejected");
  },

  /**
   * A call of theirs ringing goes on for RING_SECONDS from when it began (also after a reload);
   * not picked up by then it is missed.
   */
  armRingTimeout() {
    clearTimeout(this.ringTimer);
    const pending = this.phonePendingEvent;
    if (pending?.type !== "incoming_call" || !pending.sessionId) return;
    const began = new Date(pending.createdAt).getTime();
    const left = Number.isFinite(began) ? began + RING_SECONDS * 1000 - Date.now() : RING_SECONDS * 1000;
    this.ringTimer = setTimeout(
      () => this.run(() => this.closeIncomingCall("missed", pending)),
      Math.max(0, left),
    );
  },

  /**
   * A ringing call ends unanswered: declined ("rejected") or not picked up in time ("missed").
   * The caller then leaves a voicemail (설정 → 전화 → 음성 사서함).
   */
  async closeIncomingCall(status, pending = this.phonePendingEvent) {
    if (!pending || this.phonePendingEvent !== pending || this.phoneBusy) return;
    const operation = this.captureChat();
    clearTimeout(this.ringTimer);
    ++this.phoneOperationToken;
    this.phonePendingEvent = null;
    // Its ringing screen gives way to the one seen before it (or home).
    if (this.phoneActiveTab === "call" && !this.phoneSession) this.phoneActiveTab = this.ringReturnTab || "home";
    this.ringReturnTab = null;
    let session = null;
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(pending.sessionId)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (response.ok) session = (await response.json()).session || null;
      if (session) await this.persistPhoneSessionToMessage(session);
    } catch (error) {
      // Not written (a chat change, the network): restored later, it rings out again.
      if (error.name !== "AbortError") console.warn("[SceneVoice] 받지 않은 전화 기록 실패", error);
    }
    this.updatePhoneLauncherVisibility();
    await this.renderSmartphone();
    // Another chat by now: its voicemail would be written from the wrong chat.
    if (operation.signal.aborted) return;
    if (session && this.config.phone?.voicemail !== false) await this.leaveVoicemail(session);
  },

  /**
   * 음성 사서함: after a call of theirs went unanswered, the caller leaves one short voice message
   * (one request to the helper model). It is kept with the call (통화 기록, its chat memory) and
   * voiced right away when 통화 음성 is made at once.
   */
  async leaveVoicemail(session) {
    // One already left (the call rang out on another tab or device too).
    if (session.turns?.length) return;
    const operation = this.captureChat();
    const profileId =
      this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) return;
    const character = this.phoneContact(this.livePersonKey(session.character_key, session.character_name));
    const me = this.userCharacterName();
    const reason = `${
      session.status === "rejected" ? `${me} declined the call just now` : `${me} didn't pick up the call just now`
    }. Leave a short voicemail after the beep, as people do: who it is, and why you called${
      session.situation ? ` (${session.situation})` : ""
    }.`;
    try {
      const draft = this.normalizePhoneDraft(
        await this.writeIncomingMessage(character, "voice", reason, profileId),
      );
      if (!draft.text) return;
      this.assertChat(operation);
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(session.id)}/voicemail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: session.chat_id,
            text: draft.text,
            script: draft.script,
            translation: draft.translation,
            tags: draft.tags,
            intensity: draft.intensity,
            language: draft.language,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `음성 사서함 저장 실패 (${response.status})`);
      const saved = data.session;
      await this.persistPhoneSessionToMessage(saved);
      this.announceCallRecord(saved, "voicemail");
      // Made now and kept with it (heard later from 통화 기록).
      if (this.config.phone?.auto_voice !== false)
        await this.makePhoneTurnAudio(saved, saved.turns[0])
          .then((made) => made && URL.revokeObjectURL(made.audioUrl))
          .catch((error) => {
            if (error.name !== "AbortError") console.warn("[SceneVoice] 음성 사서함 음성 실패", error);
          });
      if (this.phoneActiveTab === "history") await this.renderSmartphone();
    } catch (error) {
      if (operation.signal.aborted) return;
      console.warn("[SceneVoice] 음성 사서함 실패", error);
    }
  },

  currentPhoneAnchor() {
    const context = window.SillyTavern?.getContext?.() || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    let index = chat.length - 1;
    while (index >= 0 && chat[index]?.is_system) index -= 1;
    return {
      context,
      index: Math.max(0, index),
      message: chat[Math.max(0, index)] || null,
    };
  },

  phoneAnchorFromSource(sourceMessageId) {
    const fallback = this.currentPhoneAnchor();
    const match = String(sourceMessageId ?? "").match(/^\d+/);
    if (!match) return fallback;
    const index = Number(match[0]);
    const chat = Array.isArray(fallback.context?.chat)
      ? fallback.context.chat
      : [];
    if (!Number.isInteger(index) || index < 0 || index >= chat.length)
      return fallback;
    return { context: fallback.context, index, message: chat[index] || null };
  },

  async restorePhoneSession() {
    if (!this.phoneOn()) return;
    const identity = this.getStateIdentity();
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(identity.chatId)}&limit=20`,
        { cache: "no-store" },
        5000,
      );
      if (!response.ok) return;
      const sessions = (await response.json()).items || [];
      // A call made on another swipe of its message stays with that swipe: brought back only
      // while it shows (otherwise it would hold the line, unseen, and keep new calls away).
      const openSession = sessions.find(
        (item) => ["active", "ringing"].includes(item.status) && this.anchorShown(item),
      );
      if (!openSession) return;
      if (openSession.status === "ringing") {
        if (!this.phonePendingEvent) {
          this.phonePendingEvent = {
            type: "incoming_call",
            reason: openSession.situation || "",
            sourceMessageId: String(openSession.anchor_message_id || ""),
            sessionId: openSession.id,
            callerKey: openSession.character_key,
            createdAt: openSession.started_at,
            restored: true,
          };
          // Ringing again (its banner and the floating button show it) for what is left of its
          // ring; one that rang out meanwhile is missed at once.
          this.updatePhoneLauncherVisibility?.();
          this.armRingTimeout();
        }
        return;
      }
      this.phoneSession = openSession;
      this.phonePendingEvent = null;
      // Back after an edit or swipe: the open phone shows the call again.
      const shell = document.getElementById("sv-smartphone");
      if (shell && !shell.classList.contains("hidden")) await this.renderSmartphone();
    } catch (error) {
      console.warn("[SceneVoice] 진행 중인 통화를 복구하지 못했습니다.", error);
    }
  },

  stopPhoneTimer() {
    if (this.phoneTimer) clearInterval(this.phoneTimer);
    this.phoneTimer = null;
  },

  formatCallDuration(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  },

  startPhoneTimer(session) {
    this.stopPhoneTimer();
    const startedAt = new Date(
      session?.answered_at || session?.started_at || Date.now(),
    ).getTime();
    const update = () => {
      const timer = document.querySelector("#sv-smartphone .sv-call-duration");
      if (timer)
        timer.textContent = this.formatCallDuration(
          (Date.now() - startedAt) / 1000,
        );
    };
    update();
    this.phoneTimer = setInterval(update, 1000);
  },

  /**
   * A call still open holds the line: one the chat shows comes back as `existing`; one nobody
   * can see (another swipe, a part taken back) is closed first so this one can start.
   */
  async createPhoneSession(record) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.request("/api/plugins/scenevoice/phone/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `통화 기록 저장 실패 (${response.status})`);
      if (data.status !== "exists") return { session: data.session };
      const open = data.session;
      if (attempt || this.anchorShown(open)) return { existing: open };
      await this.request(
        `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(open.id)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: open.chat_id,
            status: open.status === "ringing" ? "missed" : "ended",
          }),
        },
      );
    }
  },

  async startOutgoingCall(button) {
    this.unlockAudioForMobile();
    this.callReplyDraft = "";
    const operation = this.captureChat();
    if (this.phoneBusy) return;
    const profileId =
      this.config.phone?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    if (!profileId || !this.connectionService) {
      this.notify(
        "전화 대화에 사용할 실리태번 연결 프로필을 설정해 주십시오.",
        "error",
      );
      return;
    }
    this.phoneBusy = true;
    const operationToken = ++this.phoneOperationToken;
    button.disabled = true;
    button.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span class="sv-sr">연결 중…</span>';
    try {
      const identity = this.getStateIdentity();
      const contact = this.phoneContact(
        this.phoneContactKey || identity.characterKey,
      );
      // Busy (their saved state): their voicemail instead.
      if (await this.callGoesToVoicemail?.(contact)) {
        this.phoneBusy = false;
        await this.openVoicemailBox(contact);
        return;
      }
      const anchor = this.currentPhoneAnchor();
      const made = await this.createPhoneSession({
        chat_id: identity.chatId,
        anchor_message_id: String(anchor.index),
        ...this.anchorStamp(anchor.index),
        character_key: contact.key,
        character_name: contact.name,
        direction: "outgoing",
        status: "active",
        situation: "",
      });
      // No opening line into the middle of a call that is still open.
      if (made.existing) {
        this.notify(`${made.existing.character_name || "상대"}와의 통화가 아직 이어지고 있어 그 통화로 돌아갑니다.`, "info");
        if (made.existing.status === "ringing") await this.restorePhoneSession();
        else this.phoneSession = made.existing;
        return;
      }
      this.phoneSession = made.session;
      await this.persistPhoneSessionToMessage();
      await this.generateCharacterPhoneTurn({ opening: true, operationToken });
    } catch (error) {
      if (operation.signal.aborted) return;
      this.notify(error.message || "통화를 시작할 수 없습니다.", "error");
    } finally {
      if (!operation.signal.aborted) {
        this.phoneBusy = false;
        await this.renderSmartphone();
      }
    }
  },

  async savePhoneTurn(turn, sessionId = this.phoneSession?.id) {
    if (!sessionId) throw new Error("진행 중인 통화가 없습니다.");
    const response = await this.request(
      `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(turn),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.detail || `통화 대사 저장 실패 (${response.status})`,
      );
    if (this.phoneSession?.id === sessionId) {
      this.phoneSession = data.session;
      await this.persistPhoneSessionToMessage();
    }
    return data.turn_id;
  },

  async sendPhoneReply() {
    this.unlockAudioForMobile();
    const operation = this.captureChat();
    if (!this.phoneSession || this.phoneBusy) return;
    const input = document.getElementById("sv-call-reply");
    const text = input?.value.trim() || "";
    const turns = this.phoneSession.turns || [];
    // Sent empty while no answer follows my last line (or nobody has spoken yet): an edit or
    // swipe of the chat, or a failed request, cut it off, and it is asked for again.
    const answerOnly = !text && (!turns.length || turns.at(-1).role === "user");
    if (!text && !answerOnly) return;
    this.phoneBusy = true;
    const operationToken = ++this.phoneOperationToken;
    const sessionId = this.phoneSession.id;
    if (input) input.value = "";
    this.callReplyDraft = "";
    const translation = this.draftTranslationFor?.("call", text) || "";
    if (translation) this.draftTranslation = null;
    try {
      if (!answerOnly) {
        await this.savePhoneTurn(
          {
            role: "user",
            text,
            ...(translation ? { translation } : {}),
            tags: [],
            language: this.detectLanguage(
              text,
              this.chatLanguage(),
            ),
            intensity: 0.5,
          },
          sessionId,
        );
        await this.renderSmartphone();
      }
      await this.generateCharacterPhoneTurn({ opening: answerOnly && !turns.length, operationToken });
    } catch (error) {
      if (operation.signal.aborted) return;
      this.notify(error.message || "통화 답변을 보낼 수 없습니다.", "error");
    } finally {
      if (!operation.signal.aborted) {
        this.phoneBusy = false;
        await this.renderSmartphone();
      }
    }
  },

  /** `replaces`: the last line answered again (답변 재생성); its new answer becomes another version. */
  async generateCharacterPhoneTurn({
    opening = false,
    operationToken = this.phoneOperationToken,
    replaces = "",
  } = {}) {
    if (this.isGroupCall?.()) return this.generateGroupPhoneTurn({ opening, operationToken });
    const operation = this.captureChat();
    const profileId =
      this.config.phone?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    if (!profileId || !this.connectionService || !this.phoneSession)
      throw new Error("전화 대화 연결 프로필이 없습니다.");
    const sessionId = this.phoneSession.id;
    const turnsSoFar = (this.phoneSession.turns || []).filter((turn) => turn.id !== replaces);
    // Whoever has the phone now: the one called, or someone it was handed to.
    const holderKey =
      [...turnsSoFar].reverse().find((turn) => turn.role === "character" && !turn.aside)?.speaker_key ||
      this.phoneSession.character_key;
    const character = this.phoneContact(holderKey);
    const roleplayProfile = this.phoneRoleplayProfile();
    const me = this.userCharacterName();
    // People who might be right there with them: heard in the background, or handed the phone.
    const voices = this.config.character_voices || {};
    const others = this.phoneContacts({ includeHidden: true })
      .filter((contact) => contact.key !== character.key && !voices[contact.key]?.persona)
      .slice(0, 8);
    const seen = await Promise.all(others.map((contact) => this.stateForPrompt(contact.key).catch(() => null)));
    const nearby = others.map((contact, index) => {
      const state = seen[index]?.state;
      const where = state?.contact?.note || state?.summary || "";
      return { key: contact.key, name: contact.name, ...(where ? { last_seen: where } : {}) };
    });
    // The callee's own state, or only that nobody knows where they are.
    const { blocks: stateBlocks, absent, unknown } = this.stateBlocks(
      await this.stateForPrompt(character.key),
    );
    const recent = this.buildRecentChatContext(
      this.config.phone?.context_messages ?? 10,
    );
    const emotions = Array.from(this.analysisEmotionCandidates()).sort();
    const caller = this.phoneSession.character_name || character.name;
    const transcript = turnsSoFar.slice(-30).map((turn) => ({
      role: turn.role,
      speaker: turn.role === "user" ? me : `${turn.speaker_name || caller}${turn.aside ? " (in the background)" : ""}`,
      text: turn.text,
    }));
    // Answer in the language the user is speaking on the call.
    const language = this.conversationLanguage(
      transcript.slice(-6).map((turn) => turn.text),
      [...transcript].reverse().find((turn) => turn.role === "user")?.text,
      character.key,
    );
    // The contact may be someone registered under a card, or another card in a group chat:
    // describe the contact and the card they belong to, not whichever card is open.
    const member = Boolean(
      character.cardKey && character.cardKey !== character.key,
    );
    const profile = {
      character: member
        ? { name: character.name }
        : { name: character.name, description: character.description },
      ...(member
        ? {
            card: {
              name: this.cardInfo(character.cardKey).name,
              description: character.description,
            },
          }
        : {}),
      ...(roleplayProfile.user_character ? { user_character: roleplayProfile.user_character } : {}),
    };
    if (!profile.character.description) delete profile.character.description;
    const messages = phoneMessages(
      callSystem({
        emotions,
        opening,
        direction: this.phoneSession.call_direction,
        language,
        member,
        translation: this.wantsTranslation(language),
        soundEffects: this.phoneSoundEffects(character.key),
        fixedLanguage: this.languageIsFixed(character.key),
        absent,
        unknown,
        nearby: nearby.length > 0,
      }),
      [
        dataBlock("user_character", me),
        dataBlock("target_character", character.name),
        dataBlock("profile", profile),
        dataBlock("performance_note", character.note, {
          range: this.emotionalRange(character.key),
        }),
        ...stateBlocks,
        dataBlock("recent_chat", recent),
        ...((await this.statusLinesBlocks?.()) || []),
        ...((await this.worldInfoBlocks?.(transcript.map((turn) => turn.text))) || []),
        ...this.currentTimeBlocks([character.key]),
        dataBlock(
          "previous_calls",
          await this.loadPreviousCalls(this.phoneSession.character_key, sessionId),
        ),
        dataBlock(
          "call_situation",
          this.phoneSession.situation || "(natural continuation of the chat)",
          { direction: this.phoneSession.call_direction },
        ),
        dataBlock(
          "call_transcript",
          transcript.map(({ speaker, text }) => ({ speaker, text })),
        ),
        ...(nearby.length ? [dataBlock("nearby_people", nearby)] : []),
      ],
      callFinal(character.name, language, me),
    );
    this.assertChat(operation);
    const parsed = await this.requestSpokenReply(profileId, messages, 900);
    if (
      operationToken !== this.phoneOperationToken ||
      this.phoneSession?.id !== sessionId ||
      this.phoneSession?.status !== "active"
    )
      return;
    const draft = this.normalizePhoneDraft(
      parsed,
      this.phoneSession.situation || "",
    );
    if (!draft.text)
      throw new Error("보조 모델이 통화 대사를 반환하지 않았습니다.");
    // Said into the phone by whoever has it (or someone it was just handed to); people there may
    // be heard behind it.
    const personOf = (value) => {
      const name = String(value || "").trim().toLowerCase();
      return (
        [character, ...others].find((person) => person.key.toLowerCase() === name) ||
        [character, ...others].find((person) => person.name.trim().toLowerCase() === name) ||
        null
      );
    };
    const speaker = personOf(parsed?.from) || character;
    const who = (person) =>
      person.key !== this.phoneSession.character_key ? { speaker_key: person.key, speaker_name: person.name } : {};
    const spoken = (piece) => ({
      text: piece.text,
      script: piece.script,
      translation: piece.translation,
      tags: piece.tags,
      language: piece.language,
      intensity: piece.intensity,
    });
    // An older reply could still mark the line itself as said in the background.
    const aside = speaker.key !== character.key && parsed?.aside === true;
    const ends = Boolean(parsed?.should_end);
    const line = { role: "character", ...who(speaker), ...(aside ? { aside: true } : {}), ...spoken(draft), should_end: ends };
    const background = ends
      ? []
      : (Array.isArray(parsed?.background) ? parsed.background : [])
          .map((item) => ({ person: personOf(item?.from), piece: this.normalizePhoneDraft(item, this.phoneSession.situation || "") }))
          .filter(({ person, piece }) => person && person.key !== speaker.key && piece.text)
          .slice(0, 2)
          .map(({ person, piece }) => ({ role: "character", ...who(person), aside: true, ...spoken(piece), should_end: false }));
    if (replaces) await this.changePhoneTurn(replaces, "answer", line);
    else await this.savePhoneTurn(line, sessionId);
    const made = [this.phoneSession?.turns?.at(-1)?.id];
    for (const remark of background) {
      await this.savePhoneTurn(remark, sessionId);
      made.push(this.phoneSession?.turns?.at(-1)?.id);
    }
    // A reply with remarks behind it shows from its first line.
    this.groupCallShown = null;
    await this.renderSmartphone();
    // Like a real call: the reply is voiced and played as soon as it arrives (setting, on by default).
    if (this.config.phone?.auto_voice === false) return;
    if (made.length > 1) void this.voiceGroupRound(made.filter(Boolean));
    else if (this.phoneSession?.turns?.at(-1)?.role === "character") void this.handlePhoneTurnPlayback(made[0]);
  },

  async handlePhoneTurnPlayback(turnId, regenerate = false, button = null) {
    const operation = this.captureChat();
    this.unlockAudioForMobile();
    if (!this.phoneSession || this.phoneAudioBusyTurnId) return;
    const turn = (this.phoneSession.turns || []).find(
      (item) => item.id === turnId,
    );
    if (!turn || turn.role !== "character") return;
    if (turn.audio_url && !regenerate) {
      this.playWithSounds(this.apiUrl(turn.audio_url), turn.script, button, false, {
        mixed: Boolean(turn.sounds_mixed),
        communicationFilter: this.shouldApplyCommunicationFilter("phone", turn),
        aside: Boolean(turn.aside),
      });
      return;
    }
    this.phoneAudioBusyTurnId = turnId;
    this.phoneAudioStartedAt = Date.now();
    const job = (this.phoneAudioJob = (this.phoneAudioJob || 0) + 1);
    await this.renderSmartphone();
    try {
      await this.generatePhoneTurnAudio(turn, regenerate, job);
    } catch (error) {
      if (!operation.signal.aborted && job === this.phoneAudioJob)
        this.notify(
          error.message || "전화 음성을 생성할 수 없습니다.",
          "error",
        );
    } finally {
      // A job given up on (see recoverPhoneAudio) leaves the buttons to the newer one.
      if (!operation.signal.aborted && job === this.phoneAudioJob) {
        this.phoneAudioBusyTurnId = "";
        await this.renderSmartphone();
      }
    }
  },

  /**
   * Back on the page after a while away: a phone browser may have cut off the voice being made,
   * which would keep the call's buttons waiting for minutes. After 40 seconds it is given up on
   * (a late result is still saved, just not played) and the buttons work again.
   */
  recoverPhoneAudio() {
    if (!this.phoneAudioBusyTurnId || Date.now() - (this.phoneAudioStartedAt || 0) < 40000) return;
    this.phoneAudioJob = (this.phoneAudioJob || 0) + 1;
    this.phoneAudioBusyTurnId = "";
    this.run(() => this.renderSmartphone());
    this.notify("자리를 비운 사이 음성 만들기가 끊겼을 수 있습니다. 재생 버튼을 다시 눌러 주십시오.");
  },

  async generatePhoneTurnAudio(turn, regenerate = false, job = 0) {
    const session = this.phoneSession;
    if (!session?.id || !turn?.id) return;
    // Linked only while that call still goes on (a voice made after it ended isn't wanted).
    const made = await this.makePhoneTurnAudio(session, turn, regenerate, () =>
      this.phoneSession?.id === session.id && this.phoneSession?.status === "active",
    );
    if (!made) return;
    if (made.session) this.phoneSession = made.session;
    await this.persistPhoneSessionToMessage();
    // Made just now: played once right away, unless this job was given up on meanwhile.
    if (!job || job === this.phoneAudioJob)
      this.playWithSounds(made.audioUrl, turn.script, null, true, {
        mixed: made.mixed,
        communicationFilter: this.shouldApplyCommunicationFilter("phone"),
        aside: Boolean(turn.aside),
      });
    else URL.revokeObjectURL(made.audioUrl);
    await this.renderSmartphone();
  },

  /**
   * A phone line's voice (sounds mixed in where that is on), made or found in the cache, for its
   * speaker: the caller, the other person in a call between two people (speaker_key), or my
   * persona for my own line. Not linked to any record.
   */
  async speakPhoneLine(session, turn, regenerate = false) {
    const mine = turn.role === "user";
    const speakerKey = mine ? this.personaKey() : turn.speaker_key || session.character_key;
    const speakerName = mine
      ? this.config.character_voices?.[speakerKey]?.name ||
        window.SillyTavern?.getContext?.()?.name1 ||
        "사용자"
      : turn.speaker_name || session.character_name;
    const script =
      (await this.voiceScript?.(turn.script || "", speakerKey)) ?? (turn.script || "");
    const response = await this.request(
      "/api/plugins/scenevoice/generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: turn.text,
          speaker_key: speakerKey,
          own_voice_only: this.chatVoiceOn?.() === false,
          ...(this.followsMultiCastEngine?.() ? { engine_settings: this.multicastVoiceSettings() } : {}),
          speaker_name: speakerName,
          language:
            this.scriptLanguage(turn.text) ||
            turn.language ||
            this.chatLanguage(),
          script,
          tags: normalizeTags({ ...turn, script }),
          intensity: turn.intensity ?? 0.5,
          chat_id: session.chat_id || "",
          message_id: session.anchor_message_id || "phone",
          quote_index: Number(turn.turn_index ?? 0),
          variation_token: regenerate
            ? `${Date.now()}-${Math.random().toString(36).slice(2)}`
            : "",
          force_regenerate: regenerate,
          phone_mode: true,
        }),
      },
      300000,
    );
    const errorBody = response.ok ? null : await response.json();
    if (!response.ok)
      throw new Error(
        errorBody?.detail || `전화 음성 생성 실패 (${response.status})`,
      );
    const historyId = response.headers.get("X-SceneVoice-History-ID") || "";
    const filename = response.headers.get("X-Audio-Filename") || "";
    const applied = decodeURIComponent(
      response.headers.get("X-SceneVoice-Applied") || "",
    );
    const mimeType = response.headers.get("content-type") || "audio/wav";
    const blob = await response.blob();
    // Its sound effects mixed into the saved voice.
    const mixed =
      this.config.phone?.sfx_in_file !== false ? await this.mixedLine?.(blob, turn.script, historyId) : null;
    return { blob, historyId, filename, applied, mimeType, mixed };
  },

  /**
   * A call line's voice, linked to the line. Returns its URL (for the caller to play and free),
   * whether sounds are in it, and the call as saved; null when `wanted()` says no by the time it
   * is made.
   */
  async makePhoneTurnAudio(session, turn, regenerate = false, wanted = () => true) {
    const { blob, historyId, filename, applied, mimeType, mixed } = await this.speakPhoneLine(session, turn, regenerate);
    if (!wanted()) return null;
    const attach = await this.request(
      `/api/plugins/scenevoice/phone/turns/${encodeURIComponent(turn.id)}/audio`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation_id: mixed?.id || historyId,
          audio_filename: mixed?.filename || filename,
          mime_type: mixed ? "audio/wav" : mimeType,
          applied_control: applied,
          audio_filtered: false,
        }),
      },
    );
    const attachData = await attach.json();
    if (!attach.ok)
      throw new Error(
        attachData.detail || `전화 음성 연결 실패 (${attach.status})`,
      );
    return {
      audioUrl: this.createAudioUrl(mixed?.blob || blob),
      mixed: Boolean(mixed),
      session: attachData.session || null,
    };
  },

  async endPhoneSession(status = "ended") {
    if (!this.phoneSession) return;
    const session = this.phoneSession;
    ++this.phoneOperationToken;
    this.phoneBusy = false;
    this.stopPhoneTimer();
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(session.id)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || `통화 종료 실패 (${response.status})`);
      this.phoneSession = data.session;
      await this.persistPhoneSessionToMessage();
      this.phoneSession = null;
      this.phoneActiveTab = "history";
      await this.renderSmartphone();
    } catch (error) {
      this.notify(error.message || "통화를 종료할 수 없습니다.", "error");
    }
  },

  async persistPhoneSessionToMessage(sessionOverride = null) {
    const session = sessionOverride || this.phoneSession;
    if (!session || session.chat_id !== this.currentChatId()) return;
    // Kept whether or not 채팅 기억 연동 is on: it decides only what is shown and sent.
    if (!FINAL_CALL_STATUSES.has(session.status)) return;
    return this.persistChatMemoryEvent(session.anchor_message_id, {
      id: session.id,
      chat_id: session.chat_id,
      anchor_fingerprint: session.anchor_fingerprint,
      anchor_swipe: session.anchor_swipe,
      anchor_tag: session.anchor_tag,
      type: "call",
      character_name: this.callNames?.(session).join(", ") || session.character_name || "",
      llm_text: this.formatCallMemoryText(session),
    });
  },

  /**
   * A call or voice-message reply. Its text may carry audio tags ("[warm] 응, 나야. [chuckles] …"):
   * the tagged line is kept as script for the voice, and the words alone as text for the screen
   * and chat memory. Older replies had a tags list, or one emotion and one direction.
   */
  normalizePhoneDraft(raw, situation = "") {
    const rawEmotion = String(
      raw?.emotion ?? raw?.mood ?? raw?.feeling ?? "",
    ).toLowerCase();
    const rawLanguage = raw?.language ?? raw?.lang ?? "";
    const language = SPEECH_LANGUAGES.includes(
      String(rawLanguage).toLowerCase(),
    )
      ? String(rawLanguage).toLowerCase()
      : this.chatLanguage();
    const spoken = String(
      raw?.text ??
          raw?.dialogue ??
          raw?.line ??
          raw?.utterance ??
          raw?.spoken_line ??
          raw?.content ??
          raw?.message ??
        "",
    )
      .trim()
      // Quotation marks around the line, after any leading tags.
      .replace(/^((?:\[[^\[\]]+\]\s*)*)[「『“"]/, "$1")
      .replace(/[」』”"]$/, "")
      .trim()
      .slice(0, 5000);
    // Line by line, so separate texts stay on separate lines.
    const lines = (value) =>
      String(value ?? "")
        .split(/\n+/)
        .map((line) => stripTags(line))
        .filter(Boolean)
        .join("\n");
    const text = lines(spoken).slice(0, 5000);
    const script = cleanScript(spoken, text);
    const tags = normalizeTags({
      script,
      tags: raw?.tags ?? raw?.audio_tags,
      direction: raw?.direction ?? raw?.acting_direction ?? raw?.delivery,
      emotion: rawEmotion,
    });
    return {
      text,
      script,
      tags,
      emotion: tagEmotion(tags, rawEmotion),
      direction: tags.join(", "),
      intensity: clamp(raw?.intensity ?? 0.5, 0, 1),
      language: this.scriptLanguage(text) || language,
      // Shown under a line in another language; never spoken.
      translation:
        (this.scriptLanguage(text) || language) !== "ko"
          ? lines(raw?.translation).slice(0, 5000)
          : "",
      situation,
    };
  },

  /**
   * 엿듣는 통화 · 통화 맡기기: writes a call in one request and keeps it in 통화 기록, anchored where
   * the chat stands, with its chat memory. Their voices are made only when it is listened to
   * (전체 듣기). `callee`: one person or several (one call with all of them). One of them may be
   * the user's character (`{me: true}`, 통화 맡기기): then it is kept as their own call.
   * `announce: false` when the user asked for it and it opens at once; `length` (short, normal,
   * long) overrides the setting for that one call; `open`: only its first part is written, to go
   * on a part at a time (이어 가며 듣기). Returns it.
   */
  async writeOverheardCall(
    caller,
    callee,
    reason = "",
    sourceMessageId = "",
    { announce = true, length = "", open = false } = {},
  ) {
    const operation = this.captureChat();
    const me = { key: "user", name: this.userCharacterName(), me: true };
    const people = [caller, ...(Array.isArray(callee) ? callee : [callee])].map((person) =>
      person.me ? me : this.phoneContact(person.key),
    );
    const lines = await this.writtenCallLines(people, { reason, length, part: open ? "first" : "whole" });
    if (!lines) return;
    this.assertChat(operation);
    const withUser = people.some((person) => person.me);
    const characters = people.filter((person) => !person.me);
    const others = (withUser ? characters.slice(1) : people.slice(2)).map(({ key, name }) => ({ key, name }));
    const anchor = String(this.phoneAnchorFromSource(sourceMessageId).index);
    const response = await this.request("/api/plugins/scenevoice/phone/overheard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.getStateIdentity().chatId,
        anchor_message_id: anchor,
        ...this.anchorStamp(anchor),
        ...(withUser
          ? { character_key: characters[0].key, character_name: characters[0].name, user_side: people[0].me ? "caller" : "callee" }
          : {
              character_key: people[0].key,
              character_name: people[0].name,
              callee_key: people[1].key,
              callee_name: people[1].name,
            }),
        ...(others.length ? { others } : {}),
        ...(open ? { open: true } : {}),
        situation: reason,
        lines,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `엿듣는 통화 저장 실패 (${response.status})`);
    await this.persistPhoneSessionToMessage(data.session);
    if (announce) {
      this.announceCallRecord(data.session, "overheard");
      if (this.phoneActiveTab === "history") await this.renderSmartphone();
    }
    return data.session;
  },

  /**
   * A written call's next part (이어 가며 듣기): `mode` "next" goes on, "last" leads to the goodbye
   * (and closes it), "again" writes its last part again. `direction`: what the user wants to
   * happen in it (empty: up to the model). Returns the call as saved.
   */
  async continueWrittenCall(session, { mode = "next", direction = "", length = "" } = {}) {
    const operation = this.captureChat();
    const people = this.writtenCallPeople(session);
    const last = Math.max(0, ...(session.turns || []).map((turn) => turn.part || 0));
    const before = (session.turns || []).filter((turn) => mode !== "again" || (turn.part || 0) !== last);
    const nameOf = (turn) => (turn.role === "user" ? this.userCharacterName() : turn.speaker_name || session.character_name || "");
    // Its first part written again starts the call over, from the hello.
    const first = !before.length;
    const lines = await this.writtenCallLines(people, {
      reason: session.situation || "",
      length,
      part: first ? "first" : mode === "last" ? "last" : "next",
      transcript: first ? null : before.map((turn) => ({ from: nameOf(turn), text: turn.text })),
      direction,
    });
    if (!lines) throw new Error("통화에 쓸 연결 프로필을 설정해 주십시오.");
    this.assertChat(operation);
    const response = await this.request(
      `/api/plugins/scenevoice/phone/overheard/${encodeURIComponent(session.id)}/part`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: session.chat_id,
          lines,
          ...(mode === "again" ? { replace: true } : {}),
          ...(mode === "last" ? { close: true } : {}),
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `통화 이어 쓰기 실패 (${response.status})`);
    await this.keepCallMemory(data.session);
    return data.session;
  },

  /** 끊기 on a call written a part at a time: it ends where it is. */
  async closeWrittenCall(session) {
    const response = await this.request(
      `/api/plugins/scenevoice/phone/overheard/${encodeURIComponent(session.id)}/part`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: session.chat_id, close: true }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `통화를 끝내지 못했습니다 (${response.status})`);
    await this.keepCallMemory(data.session);
    return data.session;
  },

  /** A call's chat memory written again where it is kept (this swipe, or another one). */
  async keepCallMemory(session) {
    if (this.anchorShown?.(session) !== false) return this.persistPhoneSessionToMessage(session);
    if (this.anchorPlace?.(session) === "swipe")
      return this.rewriteSwipeMemory(session.anchor_message_id, session.anchor_swipe, session.id, this.formatCallMemoryText(session));
  },

  /** Everyone on a written call, the caller first: the people kept with it, and my character. */
  writtenCallPeople(session) {
    const person = (key, name) => ({ ...this.phoneContact(key), key, name: name || this.phoneContact(key).name });
    const characters = [
      person(session.character_key, session.character_name),
      ...(session.call_direction === "overheard" ? [person(session.callee_key, session.callee_name)] : []),
      ...(session.others || []).map((other) => person(other.key, other.name)),
    ];
    if (session.call_direction === "overheard") return characters;
    const me = { key: "user", name: this.userCharacterName(), me: true };
    return session.call_direction === "outgoing" ? [me, ...characters] : [characters[0], me, ...characters.slice(1)];
  },

  /**
   * One request for a written call's lines (the whole call, or one part of it), checked against
   * who is on it: each line with who said it, mine as mine. Null without a connection profile.
   */
  async writtenCallLines(people, { reason = "", length = "", part = "whole", transcript = null, direction = "" } = {}) {
    const size = OVERHEARD_REPLY_TOKENS[length]
      ? length
      : OVERHEARD_REPLY_TOKENS[this.config.phone?.overheard_length]
        ? this.config.phone.overheard_length
        : "normal";
    const profileId =
      this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) return null;
    const withUser = people.some((person) => person.me);
    const other = people.find((person) => !person.me);
    const states = await Promise.all(people.map((person) => (person.me ? null : this.stateForPrompt(person.key))));
    // My character talks in the language of the first one on the other end.
    const languages = people.map((person) => this.conversationLanguage([], "", (person.me ? other : person).key));
    const messages = phoneMessages(
      overheardCallSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        translation: languages.some((language) => this.wantsTranslation(language)),
        soundEffects: people.every((person) => person.me || this.phoneSoundEffects(person.key)),
        length: size,
        withUser,
        count: people.length,
        part,
      }),
      [
        dataBlock("user_character", this.userCharacterName()),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock(
          "people_on_call",
          people.map((person, index) => ({
            key: person.key,
            name: person.name,
            language: `${languageName(languages[index])} (${languages[index]})`,
            ...(person.me ? { user_character: true } : {}),
            emotional_range: this.emotionalRange(person.key),
            performance_note: person.note || "",
            ...(states[index]?.unknown
              ? { unknown_whereabouts: true }
              : states[index]?.state
                ? { state: { summary: states[index].state.summary || "", contact: states[index].state.contact || {} } }
                : {}),
          })),
        ),
        dataBlock("recent_chat", this.buildRecentChatContext(this.config.phone?.context_messages ?? 10)),
        ...((await this.statusLinesBlocks?.()) || []),
        ...((await this.worldInfoBlocks?.([reason, direction])) || []),
        ...this.currentTimeBlocks(people.filter((person) => !person.me).map((person) => person.key)),
        dataBlock("reason_to_call", reason || "(decide from context)"),
        ...(transcript ? [dataBlock("call_transcript", transcript)] : []),
        ...(direction ? [dataBlock("direction", direction)] : []),
      ],
      overheardCallFinal(people.map((person) => person.name)),
    );
    const parsed = await this.requestSpokenReply(profileId, messages, OVERHEARD_REPLY_TOKENS[size]);
    const speakerOf = (from) => {
      const value = String(from || "").trim().toLowerCase();
      return (
        people.find((person) => person.key.toLowerCase() === value) ||
        people.find((person) => person.name.trim().toLowerCase() === value) ||
        null
      );
    };
    const lines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
      .map((line) => ({ speaker: speakerOf(line?.from ?? line?.speaker), draft: this.normalizePhoneDraft(line) }))
      .filter(({ speaker, draft }) => speaker && draft.text)
      .slice(0, 30)
      .map(({ speaker, draft }) => ({
        ...(speaker.me ? { role: "user" } : { speaker_key: speaker.key, speaker_name: speaker.name }),
        text: draft.text,
        script: draft.script,
        translation: draft.translation,
        tags: draft.tags,
        intensity: draft.intensity,
        language: draft.language,
      }));
    if (lines.length < (part === "whole" || part === "first" ? 2 : 1))
      throw new Error("보조모델이 통화 대사를 돌려주지 않았습니다. 다시 시도해 주십시오.");
    return lines;
  },

  /** The real date and time, for people whose card has real-time awareness on. */
  currentTimeBlocks(keys = []) {
    if (!keys.some((key) => this.realtimeFor(key))) return [];
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return [dataBlock("current_time", `${this.realTimeLabel()}${zone ? ` · ${zone}` : ""}`)];
  },

  /**
   * Sends a call or voice-message request and reads its JSON reply. A reply that looks like broken
   * JSON is asked for once more with a format reminder instead of being spoken as raw text; a reply
   * in plain prose (no JSON at all) is used as the spoken line. Calls and texts use the preset's
   * temperature (null = no override).
   */
  async requestSpokenReply(profileId, messages, maxTokens, temperature = null) {
    const send = (list, temp) =>
      this.connectionService.sendRequest(
        profileId,
        this.connectionService.constructPrompt
          ? this.connectionService.constructPrompt(list, profileId)
          : list,
        maxTokens,
        {
          stream: false,
          extractData: true,
          includePreset: false,
          includeInstruct: true,
        },
        temp == null ? {} : { temperature: temp },
      );
    const first = await send(messages, temperature);
    try {
      return this.parseJsonObject(first);
    } catch {
      /* Checked below. */
    }
    const raw = String(first?.content ?? first ?? "")
      .replace(/```[a-z]*|```/gi, "")
      .trim();
    if (!/[{}]|"text"\s*:/.test(raw)) return { text: raw };
    const retry = messages.map((message, index) =>
      index === 0
        ? {
            ...message,
            content: `${message.content}\n\nFORMAT RETRY: the previous reply was not valid JSON. Return exactly one complete, valid JSON object in the format above, with double-quoted keys and strings, and nothing outside it.`,
          }
        : message,
    );
    return this.parseJsonObject(
      await send(retry, temperature == null ? null : Math.min(temperature, 0.4)),
    );
  },

  /**
   * This person's last finished calls with the user, newest first. "just now" means within the
   * last two assistant replies; anything older or of unknown position is background only.
   */
  async loadPreviousCalls(characterKey, excludeId = "") {
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.getStateIdentity().chatId)}&limit=30`,
        { cache: "no-store" },
        5000,
      );
      if (!response.ok) return [];
      const last = (window.SillyTavern?.getContext?.()?.chat || []).length - 1;
      return ((await response.json()).items || [])
        .filter(
          (session) =>
            session.id !== excludeId &&
            session.call_direction !== "overheard" &&
            (session.character_key || "") === characterKey &&
            FINAL_CALL_STATUSES.has(session.status) &&
            this.anchorShown?.(session) !== false,
        )
        .slice(0, 3)
        .map((session) => {
          const anchor = /^\d+$/.test(String(session.anchor_message_id || ""))
            ? Number(session.anchor_message_id)
            : null;
          const since = anchor === null ? null : this.assistantMessagesSince(anchor, last);
          return {
            ...this.summarizePhoneSession(session),
            ...(session.status === "ended" ? { ending: this.callEnding(session) } : {}),
            timing: since !== null && since <= 2 ? "just now" : "a while ago",
            assistant_messages_since: since ?? "unknown",
          };
        });
    } catch {
      return [];
    }
  },

  /** How an answered call ended: with a goodbye (either side), or hung up without one. */
  callEnding(session) {
    const turns = session.turns || [];
    if (!turns.some((turn) => turn.role !== "user")) return "통화 직후 끊음";
    if (turns.at(-1)?.should_end) return "작별 인사 후 종료";
    const lastLines = turns
      .slice(-2)
      .map((turn) => turn.text)
      .join(" ");
    return FAREWELL.test(lastLines) ? "작별 인사 후 종료" : "작별 인사 없이 끊김";
  },

  /**
   * A sheet over the phone screen for rewriting a spoken line. Resolves with the new text, or
   * null when cancelled. Tags in brackets may stay or be added; they are voiced, not shown.
   */
  /**
   * The phone's edit sheet. `translation`: the line's Korean translation, when it has one: a
   * small 원문 / 번역 switch then edits either. Resolves to { value, translation } (translation
   * undefined when there was none), or null when cancelled.
   */
  openLineSheet({
    title = "대사 고치기",
    value = "",
    hint = "[sighs] 같은 대괄호 태그도 그대로 쓸 수 있습니다. 저장하면 이전 음성은 지우고 새로 만듭니다.",
    translation,
  } = {}) {
    const screen = document.querySelector("#sv-smartphone .sv-phone-screen");
    if (!screen) return Promise.resolve(null);
    screen.querySelector(".sv-ph-sheet")?.remove();
    const both = typeof translation === "string" && Boolean(translation);
    const texts = { text: value, translation: both ? translation : undefined };
    const hints = { text: both ? `${hint} 번역은 그대로 남습니다.` : hint, translation: "화면에만 보이는 한국어 번역입니다. 음성은 바뀌지 않습니다." };
    let side = "text";
    const sheet = document.createElement("div");
    sheet.className = "sv-ph-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);
    sheet.innerHTML = `<form class="sv-ph-sheet-card">
        <div class="sv-ph-sheet-head"><strong>${escapeHtml(title)}</strong>${
          both
            ? '<span class="sv-sheet-sides"><button type="button" data-sheet-side="text" aria-pressed="true">원문</button><button type="button" data-sheet-side="translation" aria-pressed="false">번역</button></span>'
            : ""
        }</div>
        <textarea rows="5" maxlength="5000" aria-label="${escapeHtml(title)}">${escapeHtml(value)}</textarea>
        <small>${escapeHtml(hints.text)}</small>
        <div class="sv-contact-edit-actions">
          <button type="button" data-sheet-cancel>취소</button>
          <button type="submit" class="sv-contact-save">저장</button>
        </div>
      </form>`;
    screen.append(sheet);
    const field = sheet.querySelector("textarea");
    sheet.querySelectorAll("[data-sheet-side]").forEach((button) =>
      button.addEventListener("click", () => {
        if (button.dataset.sheetSide === side) return;
        texts[side] = field.value;
        side = button.dataset.sheetSide;
        field.value = texts[side];
        sheet.querySelector("small").textContent = hints[side];
        sheet.querySelectorAll("[data-sheet-side]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        field.focus();
      }),
    );
    return new Promise((resolve) => {
      const close = (result) => {
        sheet.remove();
        resolve(result);
      };
      sheet.querySelector("[data-sheet-cancel]").addEventListener("click", () => close(null));
      sheet.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        // The tap that saves also unlocks audio for the new voice.
        this.unlockAudioForMobile();
        texts[side] = field.value;
        close({ value: texts.text, translation: both ? texts.translation.trim() : undefined });
      });
      sheet.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close(null);
        }
      });
    });
  },

  /** The words to show and the tagged line to voice, from what the user typed. */
  spokenEdit(value) {
    const text = String(value ?? "")
      .split(/\n+/)
      .map((line) => stripTags(line))
      .filter(Boolean)
      .join("\n")
      .slice(0, 5000);
    const script = cleanScript(value, text);
    return { text, script, tags: normalizeTags({ script, tags: [] }) };
  },

  /** Takes back the call's last line and asks for it again from the same point. */
  async regeneratePhoneTurn(turnId) {
    this.unlockAudioForMobile();
    const operation = this.captureChat();
    const session = this.phoneSession;
    if (!session || this.phoneBusy || this.phoneAudioBusyTurnId) return;
    if (session.turns?.at(-1)?.id !== turnId) return;
    this.phoneBusy = true;
    const operationToken = ++this.phoneOperationToken;
    try {
      if (this.currentAudio) this.stopPlayback();
      await this.renderSmartphone();
      if (this.isGroupCall?.(session)) {
        // Their whole last round is asked for again.
        await this.dropGroupRound();
        await this.renderSmartphone();
        await this.generateGroupPhoneTurn({
          opening: !this.phoneSession.turns.some((turn) => turn.role !== "user"),
          operationToken,
        });
      } else {
        // Remarks heard behind the last answer go with it; the answer gets its new version.
        const answer = await this.dropTrailingAsides();
        if (!answer) return;
        await this.generateCharacterPhoneTurn({
          opening: !this.phoneSession.turns.some((turn) => turn.role !== "user" && turn.id !== answer.id),
          operationToken,
          replaces: answer.id,
        });
      }
    } catch (error) {
      if (operation.signal.aborted) return;
      this.notify(error.message || "대사를 다시 받을 수 없습니다.", "error");
    } finally {
      if (!operation.signal.aborted) {
        this.phoneBusy = false;
        await this.renderSmartphone();
      }
    }
  },

  /** Background remarks at the end of the call taken back; returns the line before them. */
  async dropTrailingAsides() {
    for (;;) {
      const last = this.phoneSession?.turns?.at(-1);
      if (!last || last.role !== "character" || !last.aside) return last?.role === "character" ? last : null;
      const response = await this.request(`/api/plugins/scenevoice/phone/turns/${encodeURIComponent(last.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.phoneSession.chat_id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "대사를 다시 받을 수 없습니다.");
      this.phoneSession = data.session;
    }
  },

  /** The last line's versions: `answer` adds one (body: the line), `version` shows another (body: index). */
  async changePhoneTurn(turnId, action, body) {
    const response = await this.request(
      `/api/plugins/scenevoice/phone/turns/${encodeURIComponent(turnId)}/${action}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.phoneSession.chat_id, ...body }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "다른 답으로 바꾸지 못했습니다.");
    this.phoneSession = data.session;
    await this.persistPhoneSessionToMessage();
  },

  async switchPhoneTurnVersion(turnId, index) {
    if (this.phoneBusy || this.phoneAudioBusyTurnId) return;
    if (this.currentAudio) this.stopPlayback();
    await this.changePhoneTurn(turnId, "version", { index });
    await this.renderSmartphone();
  },

  async editPhoneTurn(turnId) {
    const turn = this.phoneSession?.turns?.find((item) => item.id === turnId);
    if (!turn || turn.role === "user" || this.phoneBusy || this.phoneAudioBusyTurnId) return;
    const sheet = await this.openLineSheet({ value: turn.script || turn.text, translation: turn.translation });
    if (sheet === null) return;
    const edit = this.spokenEdit(sheet.value);
    if (!edit.text) throw new Error("대사를 비울 수는 없습니다.");
    const { changed, words, translation } = this.sheetChanges(turn, edit, sheet);
    if (!changed) return;
    const response = await this.request(
      `/api/plugins/scenevoice/phone/turns/${encodeURIComponent(turnId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.phoneSession.chat_id, ...edit, translation }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "대사를 고치지 못했습니다.");
    this.phoneSession = data.session;
    await this.persistPhoneSessionToMessage();
    await this.renderSmartphone();
    if (words && this.config.phone?.auto_voice !== false) void this.handlePhoneTurnPlayback(turnId);
  },

  /**
   * What an edit sheet changed on a line: its words (the voice goes with them) and its
   * translation, which stays when only the words change.
   */
  sheetChanges(item, edit, sheet) {
    const words = edit.text !== item.text || (edit.script ?? "") !== (item.script || "");
    const translation = sheet.translation ?? item.translation ?? "";
    return { words, translation, changed: words || translation !== (item.translation || "") };
  },

  /** Korean translation for calls and voice messages in another language (setting on by default). */
  wantsTranslation(language) {
    return language !== "ko" && this.config.phone?.show_translation !== false;
  },

  translationHtml(item) {
    return item?.translation
      ? `<p class="sv-translation" lang="ko"><i class="fa-solid fa-language" aria-hidden="true"></i>${escapeHtml(item.translation)}</p>`
      : "";
  },
};
