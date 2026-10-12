import { escapeHtml, OVERHEARD_LENGTH_CHOICES } from "./common.js";

// 통화 기록: the phone's list of past calls, one call's transcript, and deleting a call.

export const callHistory = {
  async renderSmartphoneHistory(body) {
    // 통화 엿듣기 being set up, or a call being listened in on, stays on screen while other
    // things redraw the phone.
    if (this.overheardEditor) {
      this.renderOverheardEditor(body);
      return;
    }
    const listening = this.callPlayback;
    if (listening?.playing && listening.overheard) {
      this.renderOverheardScreen(body, listening.overheard, listening, { away: listening.away });
      return;
    }
    body.innerHTML =
      '<div class="sv-phone-list-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><p>통화 기록을 불러오는 중…</p></div>';
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=80`,
        ),
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || `HTTP ${response.status}`);
      // Calls of a swipe not showing now, or of a part of the chat taken back, wait in 미적용
      // 기억 (one ringing there is left alone).
      const items = data.items || [];
      const here = items.filter((session) => this.anchorShown(session));
      const away = items.filter(
        (session) => !this.anchorShown(session) && !["active", "ringing"].includes(session.status),
      );
      const tabs = this.phoneShelfTabs("history", away.length);
      const shelf = this.phoneShelf.history === "unapplied";
      const sessions = shelf ? away : here;
      // 통화 엿듣기: two people of the story on the phone, asked for now.
      const listen =
        !shelf && this.phoneContacts().length >= 2
          ? '<button type="button" class="sv-msg-new-group sv-overheard-new" data-overheard-new><i class="fa-solid fa-ear-listen" aria-hidden="true"></i><span>통화 엿듣기</span></button>'
          : "";
      body.innerHTML = sessions.length
        ? `<div class="sv-call-history-list">${tabs}${listen}${shelf ? this.phoneShelfNote() : '<h3 class="sv-recents-title">최근 통화</h3>'}${sessions
            .map((session) => {
              const missed = ["rejected", "missed"].includes(session.status);
              const live = ["active", "ringing"].includes(session.status);
              const voicemail = session.turns?.[0]?.voicemail;
              const between = session.call_direction === "overheard";
              const fresh = this.unheardCalls?.has(session.id);
              const who = between
                ? `${session.character_name || ""} ↔ ${session.callee_name || ""}`
                : session.character_name || "캐릭터";
              const icon = between ? "fa-ear-listen" : session.call_direction === "incoming" ? "fa-phone-volume" : "fa-phone";
              return `
                <div class="sv-call-history-item">
                  <button type="button" class="sv-call-history-session ${missed ? "sv-missed" : ""}" data-session-id="${escapeHtml(session.id)}">
                      <span class="sv-recent-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
                      <span class="sv-recent-main"><strong>${escapeHtml(who)}</strong><small>${this.callStatusLabel(session)} · ${shelf ? escapeHtml(this.awayPointLabel(session)) : voicemail ? '<i class="fa-solid fa-voicemail" aria-hidden="true"></i> 음성 사서함' : `${(session.turns || []).length}개 대사`}</small></span>
                      <time>${fresh ? '<i class="sv-unread-dot" aria-label="아직 안 들음"></i>' : ""}${escapeHtml(this.formatPhoneDate(session.started_at))}</time>
                      <i class="fa-solid fa-chevron-right sv-recent-chevron" aria-hidden="true"></i>
                  </button>
                  ${live ? "" : `<button type="button" class="sv-call-history-delete" data-delete-session="${escapeHtml(session.id)}" aria-label="${escapeHtml(who)} 통화 기록 삭제" title="이 기록 삭제"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`}
                </div>`;
            })
            .join("")}</div>`
        : `<div class="sv-call-history-list">${tabs}${listen}</div>${
            shelf
              ? this.phoneShelfEmpty()
              : '<div class="sv-phone-list-empty"><span class="sv-empty-badge sv-app-history"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></span><strong>통화 기록</strong><p>아직 통화 기록이 없습니다.</p></div>'
          }`;
      this.bindPhoneShelf(body, "history");
      body.querySelector("[data-overheard-new]")?.addEventListener("click", () => {
        const [first, second] = this.phoneContacts();
        this.overheardEditor = {
          caller: first.key,
          callee: second.key,
          reason: "",
          length: this.config.phone?.overheard_length || "normal",
          busy: false,
        };
        this.renderOverheardEditor(body);
      });
      body
        .querySelector("[data-shelf-clear]")
        ?.addEventListener("click", () => this.run(() => this.clearAwayCalls(body, away)));
      body.querySelectorAll(".sv-call-history-session").forEach((button) =>
        button.addEventListener("click", () => {
          const selected = sessions.find(
            (item) => item.id === button.dataset.sessionId,
          );
          if (selected) this.renderPhoneHistoryDetail(body, selected, shelf);
        }),
      );
      body.querySelectorAll("[data-delete-session]").forEach((button) =>
        button.addEventListener("click", () => {
          const selected = sessions.find(
            (item) => item.id === button.dataset.deleteSession,
          );
          if (selected) this.run(() => this.deletePhoneSession(body, selected));
        }),
      );
    } catch (error) {
      body.innerHTML = `<div class="sv-phone-list-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(error.message)}</p></div>`;
    }
  },

  /**
   * 통화 엿듣기: pick who calls whom (and, if wanted, what about); the call is written in one
   * request and opens right away, its voices made when it is listened to (전체 듣기).
   */
  renderOverheardEditor(body) {
    const editor = this.overheardEditor;
    const people = this.phoneContacts();
    const options = (selected) =>
      people
        .map((contact) => `<option value="${escapeHtml(contact.key)}" ${contact.key === selected ? "selected" : ""}>${escapeHtml(contact.name)}</option>`)
        .join("");
    body.innerHTML = `
      <div class="sv-room-editor sv-overheard-editor">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back" data-overheard-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 통화 기록</button>
          <strong class="sv-room-editor-title">통화 엿듣기</strong>
        </header>
        <label class="sv-room-name"><span>거는 사람</span><select id="sv-overheard-caller" ${editor.busy ? "disabled" : ""}>${options(editor.caller)}</select></label>
        <label class="sv-room-name"><span>받는 사람</span><select id="sv-overheard-callee" ${editor.busy ? "disabled" : ""}>${options(editor.callee)}</select></label>
        <label class="sv-room-name"><span>무슨 통화인지</span><input id="sv-overheard-reason" maxlength="300" placeholder="비워 두면 지금 이야기에 맞게 정합니다" value="${escapeHtml(editor.reason)}" autocomplete="off" ${editor.busy ? "disabled" : ""}></label>
        <label class="sv-room-name"><span>통화 길이</span><select id="sv-overheard-length" ${editor.busy ? "disabled" : ""}>${OVERHEARD_LENGTH_CHOICES.map(([value, label]) => `<option value="${value}" ${value === editor.length ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <p class="sv-room-hint">대사는 요청 한 번에 받고, 목소리는 ‘전체 듣기’를 누를 때 만듭니다. 내 캐릭터는 이 통화를 모릅니다.</p>
        <div class="sv-room-actions">
          <button type="button" class="sv-room-save" data-overheard-make ${editor.busy || editor.caller === editor.callee ? "disabled" : ""}>${editor.busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 통화 받아 오는 중…' : "통화 만들기"}</button>
        </div>
      </div>`;
    const make = body.querySelector("[data-overheard-make]");
    const pick = (field) => (event) => {
      editor[field] = event.target.value;
      make.disabled = editor.caller === editor.callee;
    };
    body.querySelector("#sv-overheard-caller").addEventListener("change", pick("caller"));
    body.querySelector("#sv-overheard-callee").addEventListener("change", pick("callee"));
    body.querySelector("#sv-overheard-length").addEventListener("change", pick("length"));
    body.querySelector("#sv-overheard-reason").addEventListener("input", (event) => {
      editor.reason = event.target.value;
    });
    body.querySelector("[data-overheard-cancel]").addEventListener("click", () => {
      this.overheardEditor = null;
      this.renderSmartphoneHistory(body);
    });
    make.addEventListener("click", () =>
      this.run(async () => {
        if (editor.busy || editor.caller === editor.callee) return;
        editor.busy = true;
        this.renderOverheardEditor(body);
        try {
          const session = await this.writeOverheardCall(
            this.phoneContact(editor.caller),
            this.phoneContact(editor.callee),
            editor.reason.trim(),
            "",
            { announce: false, length: editor.length },
          );
          if (this.overheardEditor !== editor) return;
          this.overheardEditor = null;
          if (session && body.isConnected) this.renderPhoneHistoryDetail(body, session);
        } finally {
          if (this.overheardEditor === editor) {
            editor.busy = false;
            if (body.isConnected && this.phoneActiveTab === "history") this.renderOverheardEditor(body);
          }
        }
      }),
    );
  },

  /** Removes one call from the history, and the chat memory it left. */
  async deletePhoneSession(body, session) {
    if (!confirm(`${session.character_name || "캐릭터"}와의 통화 기록을 지울까요?`)) return;
    const response = await this.request(
      `/api/plugins/scenevoice/phone/sessions/${encodeURIComponent(session.id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: session.chat_id }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "통화 기록을 지우지 못했습니다.");
    if (this.anchorShown(session)) await this.removeChatMemoryEvent(session.anchor_message_id, session.id);
    else await this.forgetSwipeMemory(session);
    // A voicemail of it no longer waits to be heard.
    if (this.unheardCalls?.delete(session.id)) this.updatePhoneLauncherVisibility();
    await this.renderSmartphoneHistory(body);
  },

  /**
   * 미적용 기억 → 모두 지우기: those calls leave the phone for good, with what the swipes they were
   * made on keep of them in the chat memory.
   */
  async clearAwayCalls(body, away) {
    if (!away.length) return;
    if (
      !confirm(
        `미적용 기억의 통화 ${away.length}개를 모두 지울까요?\n휴대폰에서 완전히 지워지고, 그 스와이프로 돌아가도 다시 나타나지 않습니다.`,
      )
    )
      return;
    const response = await this.request("/api/plugins/scenevoice/phone/sessions/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.currentChatId(), ids: away.map((session) => session.id) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "통화 기록을 지우지 못했습니다.");
    for (const session of away) {
      await this.forgetSwipeMemory(session);
      this.unheardCalls?.delete(session.id);
    }
    this.updatePhoneLauncherVisibility();
    await this.renderSmartphoneHistory(body);
  },

  /**
   * One call's lines (a voicemail: the message left; a call between two people: who said each).
   * `away`: a call of 미적용 기억 (its way back says so). Opening it counts its voicemail or
   * overheard call as heard as far as the alert goes.
   */
  renderPhoneHistoryDetail(body, session, away = false) {
    const between = session.call_direction === "overheard";
    const caller = this.phoneContact(session.character_key || this.getCurrentCharacterProfile().key);
    const name = escapeHtml(
      between ? `${session.character_name} ↔ ${session.callee_name}` : session.character_name || "캐릭터",
    );
    const live = ["active", "ringing"].includes(session.status);
    if (this.unheardCalls?.delete(session.id)) this.updatePhoneLauncherVisibility();
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "app";
    const turns = session.turns || [];
    const playing = this.callPlayback?.sessionId === session.id ? this.callPlayback : null;
    const avatar = between
      ? this.threadAvatarMarkup({
          group: true,
          members: [caller, { ...this.phoneContact(session.callee_key), name: session.callee_name }],
        })
      : this.contactAvatarMarkup(caller);
    body.innerHTML = `
            <div class="sv-phone-history-detail" data-session="${escapeHtml(session.id)}">
                <button type="button" class="sv-phone-back"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> ${away ? "미적용 기억" : "최근 통화"}</button>
                <div class="sv-detail-head">
                    ${avatar}
                    <div><h3>${name}</h3><small>${escapeHtml(this.formatDate(session.started_at))} · ${this.callStatusLabel(session)}${away ? ` · ${escapeHtml(this.awayPointLabel(session))}` : ""}</small></div>
                    ${live ? "" : '<button type="button" class="sv-call-history-delete sv-detail-delete" aria-label="이 통화 기록 삭제" title="이 기록 삭제"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>'}
                </div>
                ${live || !turns.length ? "" : `<div class="sv-call-aloud-row">${this.downloadCallVideo && this.canMakeCallVideo() ? '<button type="button" class="sv-call-aloud" data-call-video title="영상으로: 통화 화면과 소리를 영상 파일로 만들어 내려받기 (통화 길이만큼 걸려요)"><i class="fa-solid fa-film" aria-hidden="true"></i><span>영상</span></button>' : ""}<button type="button" class="sv-call-aloud" data-call-download title="내려받기: 통화 전체를 이어진 파일 하나로(WAV)"><i class="fa-solid fa-download" aria-hidden="true"></i><span>내려받기</span></button>${this.callAloudButton(playing, turns.length)}</div>`}
                <div class="sv-call-transcript sv-history-transcript">
                    ${turns.length ? "" : '<p class="sv-transcript-empty">주고받은 대사가 없습니다.</p>'}
                    ${turns
                      .map((turn, index) => {
                        // A voicemail or an overheard line without a voice yet can be made here.
                        const button = turn.audio_url
                          ? `<button type="button" class="sv-call-replay" data-turn="${index}" aria-label="이 대사 재생" title="재생"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
                          : turn.voicemail || between
                            ? `<button type="button" class="sv-call-replay" data-turn="${index}" aria-label="음성 만들기" title="음성 만들기: 이 대사의 목소리를 만들어 재생합니다"><i class="fa-solid fa-microphone-lines" aria-hidden="true"></i></button>`
                            : "";
                        const label = turn.voicemail
                          ? '<small class="sv-voicemail-label"><i class="fa-solid fa-voicemail" aria-hidden="true"></i>음성 사서함</small>'
                          : between
                            ? `<small class="sv-voicemail-label">${escapeHtml(turn.speaker_name || "")}</small>`
                            : "";
                        const reading = playing?.playing && playing.position === index ? " sv-call-reading" : "";
                        return `<article class="${turn.role === "user" ? "sv-call-user" : "sv-call-character"}${reading}" data-index="${index}" aria-label="${turn.role === "user" ? "나" : escapeHtml(turn.speaker_name || session.character_name || "")}">${label}<p>${escapeHtml(turn.text)}</p>${this.translationHtml(turn)}${button}</article>`;
                      })
                      .join("")}
                </div>
            </div>`;
    body
      .querySelector(".sv-phone-back")
      ?.addEventListener("click", () => this.renderSmartphoneHistory(body));
    body
      .querySelector(".sv-detail-delete")
      ?.addEventListener("click", () => this.run(() => this.deletePhoneSession(body, session)));
    body
      .querySelector("[data-call-aloud]")
      ?.addEventListener("click", () => this.run(() => this.playCallThrough(body, session, away)));
    const save = body.querySelector("[data-call-download]");
    save?.addEventListener("click", () =>
      this.run(() => this.withBusyButton(save, () => this.downloadCall(body, session, away))),
    );
    const film = body.querySelector("[data-call-video]");
    film?.addEventListener("click", () =>
      this.run(() => this.withBusyButton(film, () => this.downloadCallVideo(body, session, away))),
    );
    body.querySelectorAll(".sv-call-replay").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.playHistoryTurn(body, session, turns[Number(button.dataset.turn)], button, away)),
      ),
    );
  },

  /**
   * A past call's voices in order (mine only with a persona voice). Lines without one are made
   * only if the user agrees (voice credits), asked apart for the character's and mine;
   * `onStep(done, total)` follows the work. `captions` (the video): my lines without a voice
   * still come, as silent clips that only show their words.
   */
  async callClips(session, onStep = () => {}, { captions = false } = {}) {
    let current = session;
    const voiced = this.personaVoiceReady();
    const turns = (session.turns || []).filter((turn) => turn.role !== "user" || voiced || (captions && turn.text));
    const lacking = (mine) => turns.filter((turn) => !turn.audio_url && (turn.role === "user") === mine).length;
    const theirs = lacking(false);
    const mine = voiced ? lacking(true) : 0;
    const makeTheirs =
      theirs > 0 &&
      confirm(`캐릭터 대사 ${theirs}개는 아직 목소리가 없어요. 만들어서 함께 넣을까요?\n취소하면 그 대사는 빠져요.`);
    const makeMine =
      mine > 0 &&
      confirm(
        `내 대사 ${mine}개는 아직 목소리가 없어요. 페르소나 목소리로 만들어서 함께 넣을까요?\n취소하면 ${captions ? "영상에는 글자로만 나와요." : "내 대사는 빠져요."}`,
      );
    const clips = [];
    for (const [index, turn] of turns.entries()) {
      onStep(index, turns.length);
      let url = turn.audio_url ? this.apiUrl(turn.audio_url) : "";
      let revoke = false;
      if (!url && (turn.role === "user" ? makeMine : makeTheirs)) {
        const made = await this.makePhoneTurnAudio(current, turn).catch(() => null);
        if (made?.session) current = made.session;
        url = made?.audioUrl || "";
        revoke = Boolean(url);
      }
      if (url) clips.push({ url, revoke, turn, filter: this.shouldApplyCommunicationFilter("phone", turn) });
      else if (captions && turn.role === "user" && turn.text) clips.push({ silent: true, turn });
    }
    return { clips, current, left: turns.length - clips.length };
  },

  callFileName(session) {
    const who =
      session.call_direction === "overheard"
        ? `${session.character_name}-${session.callee_name}`
        : session.character_name || "통화";
    return `${who}-통화-${this.fileStamp(session.started_at)}`;
  },

  async downloadCall(body, session, away = false) {
    const { clips, current, left } = await this.callClips(session);
    try {
      if (!clips.length) throw new Error("내려받을 음성이 없습니다.");
      await this.downloadJoinedAudio(clips, this.callFileName(session));
    } finally {
      for (const clip of clips) if (clip.revoke) URL.revokeObjectURL(clip.url);
    }
    if (left) this.notify(`목소리가 없는 대사 ${left}개는 빠졌습니다.`, "info");
    if (current !== session && body.isConnected) this.renderPhoneHistoryDetail(body, current, away);
  },

  /** 전체 듣기 · 이어 듣기 (stopped partway) · 멈추기 (while it plays). */
  callAloudButton(playback, count) {
    const [icon, label, title] = playback?.playing
      ? ["fa-stop", "멈추기", "듣기 멈추기"]
      : playback?.position > 0 && playback.position < count
        ? ["fa-headphones", "이어 듣기", "멈춘 대사부터 이어서 들려줍니다"]
        : [
            "fa-headphones",
            "전체 듣기",
            "통화 전체 듣기: 처음부터 차례로 들려줍니다. 목소리가 없는 대사는 만들면서 재생합니다(내 대사는 페르소나 목소리가 있을 때만).",
          ];
    return `<button type="button" class="sv-call-aloud${playback?.playing ? " sv-playing" : ""}" data-call-aloud title="${title}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
  },

  /**
   * 전체 듣기: a past call's lines in order, each in its speaker's voice (made as it goes when
   * a line has none yet, the next one while one plays; my own lines only with a persona voice).
   * Pressed again it stops; the next press goes on from there.
   */
  async playCallThrough(body, session, away = false) {
    const last = this.callPlayback;
    if (last?.sessionId === session.id && last.playing) {
      last.stopped = true;
      this.stopPlayback();
      return;
    }
    if (last?.playing) {
      last.stopped = true;
      this.stopPlayback();
    }
    const operation = this.captureChat();
    let current = session;
    const turns = session.turns || [];
    const start = last?.sessionId === session.id && last.position < turns.length ? last.position : 0;
    const run = (this.callPlayback = { sessionId: session.id, position: start, playing: true, stopped: false });
    const over = () => run.stopped || operation.signal.aborted || this.callPlayback !== run;
    // A call between two people plays on a call screen of its own (엿듣기); a call of the
    // user's, over its transcript.
    const screen = session.call_direction === "overheard";
    const shown = () =>
      body.querySelector(
        `${screen ? ".sv-overheard-screen" : ".sv-phone-history-detail"}[data-session="${CSS.escape(session.id)}"]`,
      );
    if (screen) {
      run.overheard = session;
      run.away = away;
      this.renderOverheardScreen(body, session, run, { away });
    }
    const mark = () => {
      const view = shown();
      if (!view) return;
      if (screen) {
        const turn = turns[run.position];
        const caption = view.querySelector("[data-overheard-caption]");
        if (caption && turn)
          caption.innerHTML = `<small>${escapeHtml(turn.speaker_name || "")}</small><p>${escapeHtml(turn.text)}</p>${this.translationHtml(turn)}`;
        run.ready = true;
        return;
      }
      const aloud = view.querySelector("[data-call-aloud]");
      if (aloud) aloud.outerHTML = this.callAloudButton(run, turns.length);
      view
        .querySelector("[data-call-aloud]")
        ?.addEventListener("click", () => this.run(() => this.playCallThrough(body, current, away)));
      view.querySelectorAll("article[data-index]").forEach((article) => {
        const on = run.playing && Number(article.dataset.index) === run.position;
        article.classList.toggle("sv-call-reading", on);
        if (on) article.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };
    this.unlockAudioForMobile();
    const voiced = (turn) => turn.role !== "user" || this.personaVoiceReady();
    const made = [];
    const prepare = (index) =>
      (made[index] ||= (async () => {
        const turn = turns[index];
        if (!voiced(turn)) return null;
        if (turn.audio_url) return { url: this.apiUrl(turn.audio_url), revoke: false, mixed: Boolean(turn.sounds_mixed) };
        const result = await this.makePhoneTurnAudio(current, turn).catch(() => null);
        if (!result) return null;
        if (result.session) current = result.session;
        return { url: result.audioUrl, revoke: true, mixed: result.mixed };
      })());
    let heard = start - 1;
    try {
      mark();
      for (let index = start; index < turns.length && !over(); index++) {
        run.position = index;
        mark();
        const ready = await prepare(index);
        if (index + 1 < turns.length) prepare(index + 1);
        if (over()) {
          if (ready?.revoke) URL.revokeObjectURL(ready.url);
          break;
        }
        heard = index;
        if (!ready) continue;
        const turn = turns[index];
        await new Promise((resolve) =>
          this.playWithSounds(ready.url, turn.script, null, ready.revoke, {
            mixed: ready.mixed,
            communicationFilter: this.shouldApplyCommunicationFilter("phone", turn),
            onEnded: resolve,
            onStop: () => {
              run.stopped = true;
              resolve();
            },
          }),
        );
        if (!over()) run.position = index + 1;
        if (!over() && index + 1 < turns.length) await new Promise((resolve) => setTimeout(resolve, 380));
      }
      // Heard to the end: the next press starts again from the top.
      if (!over()) run.position = 0;
    } finally {
      for (const ahead of made.slice(heard + 1))
        ahead?.then((ready) => ready?.revoke && URL.revokeObjectURL(ready.url));
      run.playing = false;
      clearInterval(run.clock);
      // Heard to the end on the call screen: it says so, to hear again or go back. Otherwise
      // the call is drawn again with the voices made meanwhile (their play buttons).
      if (shown() && !operation.signal.aborted) {
        if (screen && !run.stopped) this.renderOverheardScreen(body, current, run, { ended: true, away });
        else {
          const scroll = body.scrollTop;
          this.renderPhoneHistoryDetail(body, current, away);
          if (!screen) body.scrollTop = scroll;
        }
      }
    }
  },

  /**
   * 엿듣기: the call between two people as a call screen, both of them at the top, the line
   * being said under them and the time running; `ended` when it was heard to the end.
   */
  renderOverheardScreen(body, session, run, { ended = false, away = false } = {}) {
    const caller = this.phoneContact(session.character_key);
    const callee = { ...this.phoneContact(session.callee_key), name: session.callee_name };
    const names = `${escapeHtml(session.character_name || "")} ↔ ${escapeHtml(session.callee_name || "")}`;
    // The line said now (drawn again mid-call), the last one once it ended.
    const line = ended ? (session.turns || []).at(-1) : run.ready ? session.turns?.[run.position] : null;
    body.innerHTML = `
      <div class="sv-call-screen sv-overheard-screen" data-phone-wallpaper data-session="${escapeHtml(session.id)}">
        <div class="sv-call-identity">
          ${this.threadAvatarMarkup({ group: true, members: [caller, callee] })}
          <h2>${names}</h2>
          <span class="sv-call-state">${ended ? "" : '<i class="sv-live-dot" aria-hidden="true"></i>'}<span>${ended ? "통화가 끝났어요" : "엿듣는 중"}</span>${ended ? "" : ' · <time class="sv-call-duration">00:00</time>'}</span>
        </div>
        <div class="sv-call-live-line">
          <div class="sv-call-caption" data-overheard-caption>${
            line
              ? `<small>${escapeHtml(line.speaker_name || "")}</small><p>${escapeHtml(line.text)}</p>${this.translationHtml(line)}`
              : '<p class="sv-call-waiting">연결 중…</p>'
          }</div>
        </div>
        <div class="sv-call-controls sv-overheard-controls">${
          ended
            ? `<div><button type="button" class="sv-call-end sv-overheard-again" data-overheard-again aria-label="다시 듣기"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button><small>다시 듣기</small></div>
               <div><button type="button" class="sv-call-end sv-overheard-back" data-overheard-back aria-label="통화 기록"><i class="fa-solid fa-list" aria-hidden="true"></i></button><small>통화 기록</small></div>`
            : '<div><button type="button" class="sv-call-end" data-overheard-stop aria-label="그만 듣기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button><small>그만 듣기</small></div>'
        }</div>
      </div>`;
    this.applyPhoneWallpaper?.(body);
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "call";
    body.scrollTop = 0;
    body.querySelector("[data-overheard-stop]")?.addEventListener("click", () => {
      run.stopped = true;
      this.stopPlayback();
    });
    body
      .querySelector("[data-overheard-again]")
      ?.addEventListener("click", () => this.run(() => this.playCallThrough(body, session, away)));
    body.querySelector("[data-overheard-back]")?.addEventListener("click", () => {
      if (shell) shell.dataset.screen = "app";
      this.renderPhoneHistoryDetail(body, session, away);
    });
    if (!ended) {
      run.began ||= Date.now();
      const tick = () => {
        const time = body.querySelector(".sv-overheard-screen .sv-call-duration");
        if (time) time.textContent = this.formatCallDuration((Date.now() - run.began) / 1000);
      };
      tick();
      clearInterval(run.clock);
      run.clock = setInterval(tick, 1000);
    }
  },

  /** Plays a past call's line, with its sounds; a line without a voice gets one first. */
  async playHistoryTurn(body, session, turn, button, away = false) {
    if (!turn) return;
    const communicationFilter = this.shouldApplyCommunicationFilter("phone", turn);
    if (turn.audio_url) {
      this.playWithSounds(this.apiUrl(turn.audio_url), turn.script, button, false, {
        mixed: Boolean(turn.sounds_mixed),
        communicationFilter,
      });
      return;
    }
    this.unlockAudioForMobile();
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    try {
      const made = await this.makePhoneTurnAudio(session, turn);
      if (!made) return;
      this.playWithSounds(made.audioUrl, turn.script, null, true, { mixed: made.mixed, communicationFilter });
      if (made.session && body.isConnected && body.querySelector(".sv-phone-history-detail"))
        this.renderPhoneHistoryDetail(body, made.session, away);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-microphone-lines" aria-hidden="true"></i>';
      }
    }
  },

  callStatusLabel(session) {
    if (session.call_direction === "overheard") return "엿들은 통화";
    if (session.status === "rejected") return "거절";
    if (session.status === "missed") return "부재중";
    if (session.status === "active") return "통화 중";
    if (session.status === "ringing") return "수신 중";
    return session.call_direction === "incoming" ? "수신 통화" : "발신 통화";
  },
};
