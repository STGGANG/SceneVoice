import { escapeHtml, OVERHEARD_LENGTH_CHOICES } from "./common.js";
import { choiceListHtml } from "./ui.js";

// 통화 기록: the phone's list of past calls, one call's transcript, and deleting a call.

const HEARD_KEY = "scenevoice_call_heard";
const VIEW_KEY = "scenevoice_call_view";

export const callHistory = {
  /** The people on a call other than my character, the caller first. */
  callNames(session) {
    return [
      session.character_name || "",
      ...(session.call_direction === "overheard" ? [session.callee_name || ""] : []),
      ...(session.others || []).map((other) => other.name),
    ];
  },

  /** Their contacts, for the pictures at the top of a call. */
  callMembers(session) {
    return [
      this.phoneContact(session.character_key),
      ...(session.call_direction === "overheard" ? [{ ...this.phoneContact(session.callee_key), name: session.callee_name }] : []),
      ...(session.others || []).map((other) => ({ ...this.phoneContact(other.key), name: other.name })),
    ];
  },

  async renderSmartphoneHistory(body) {
    // 통화 엿듣기 being set up, or a past call being listened to, stays on screen while other
    // things redraw the phone.
    if (this.overheardEditor) {
      this.renderOverheardEditor(body);
      return;
    }
    const listening = this.callPlayback;
    if (listening?.playing && listening.session) {
      this.renderListenScreen(body, listening.session, listening, { away: listening.away });
      return;
    }
    if (this.callListenOpen) {
      this.renderListenScreen(body, this.callListenOpen.session, {}, { ended: true, away: this.callListenOpen.away });
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
      // After a reload: back to the call last looked at (its paused part, or its page).
      const view = this.callViewRestored ? null : this.savedCallView();
      this.callViewRestored = true;
      const viewed = view && items.find((session) => session.id === view.sessionId);
      if (viewed && this.phoneActiveTab === "history") {
        if (view.open && viewed.continuing) {
          this.callListenOpen = { session: viewed, away: view.away };
          this.renderListenScreen(body, viewed, {}, { ended: true, away: view.away });
        } else this.renderPhoneHistoryDetail(body, viewed, view.away);
        return;
      }
      this.saveCallView(null);
      const here = items.filter((session) => this.anchorShown(session));
      const away = items.filter(
        (session) => !this.anchorShown(session) && !["active", "ringing"].includes(session.status),
      );
      const tabs = this.phoneShelfTabs("history", away.length);
      const shelf = this.phoneShelf.history === "unapplied";
      const sessions = shelf ? away : here;
      // 통화 엿듣기: two people of the story on the phone (or one and my character), asked for now.
      const people = this.phoneContacts().length;
      const listen =
        !shelf && people
          ? `<div class="sv-call-new-row">${
              people > 1
                ? '<button type="button" class="sv-msg-new-group sv-overheard-new" data-overheard-new="listen"><i class="fa-solid fa-ear-listen" aria-hidden="true"></i><span>통화 엿듣기</span></button>'
                : ""
            }<button type="button" class="sv-msg-new-group sv-overheard-new" data-overheard-new="mine"><i class="fa-solid fa-headset" aria-hidden="true"></i><span>통화 맡기기</span></button></div>`
          : "";
      body.innerHTML = sessions.length
        ? `<div class="sv-call-history-list">${tabs}${listen}${shelf ? this.phoneShelfNote() : '<h3 class="sv-recents-title">최근 통화</h3>'}${sessions
            .map((session) => {
              // Red only for theirs I missed; mine that went unanswered stays plain.
              const missed = ["rejected", "missed"].includes(session.status) && session.call_direction !== "outgoing";
              const live = ["active", "ringing"].includes(session.status);
              const voicemail = session.turns?.[0]?.voicemail;
              const between = session.call_direction === "overheard";
              const fresh = this.unheardCalls?.has(session.id);
              const who = this.callNames(session).join(", ") || "캐릭터";
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
      body.querySelectorAll("[data-overheard-new]").forEach((button) =>
        button.addEventListener("click", () => {
          const [first, second] = this.phoneContacts();
          const mode = button.dataset.overheardNew;
          this.overheardEditor = {
            mode,
            meFirst: true,
            people: mode === "listen" ? [first.key, second.key] : [first.key],
            reason: "",
            length: this.config.phone?.overheard_length || "normal",
            open: false,
            busy: false,
          };
          this.renderOverheardEditor(body);
        }),
      );
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
   * 통화 엿듣기 (people of the story on the phone with each other) · 통화 맡기기 (my character and
   * them, my lines written too): who is on it (more than two: one call with all of them), what
   * about, how long, and whether it goes a part at a time (이어 가며 듣기). The call is written in
   * one request; its voices are made when it is listened to.
   */
  renderOverheardEditor(body) {
    const editor = this.overheardEditor;
    const mine = editor.mode === "mine";
    const contacts = this.phoneContacts();
    const most = mine ? 4 : 5;
    const options = (selected) =>
      contacts
        .map((contact) => `<option value="${escapeHtml(contact.key)}" ${contact.key === selected ? "selected" : ""}>${escapeHtml(contact.name)}</option>`)
        .join("");
    const off = editor.busy ? "disabled" : "";
    // The first one or two stay; the people added after them can be taken off again.
    const keep = mine ? 1 : 2;
    const row = (label, index) =>
      `<div class="sv-call-person"><label class="sv-room-name"><span>${label}</span><select data-person="${index}" ${off}>${options(editor.people[index])}</select></label>${
        index >= keep ? `<button type="button" class="sv-call-person-remove" data-person-remove="${index}" aria-label="빼기" title="빼기" ${off}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ""
      }</div>`;
    const people = mine
      ? editor.people.map((key, index) => row(index ? "함께 통화하는 사람" : "상대", index)).join("")
      : editor.people.map((key, index) => row(index ? (index > 1 ? "함께 받는 사람" : "받는 사람") : "거는 사람", index)).join("");
    body.innerHTML = `
      <div class="sv-room-editor sv-overheard-editor">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back" data-overheard-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 통화 기록</button>
          <strong class="sv-room-editor-title">${mine ? "통화 맡기기" : "통화 엿듣기"}</strong>
        </header>
        <p class="sv-room-hint">${
          mine
            ? `나(${escapeHtml(this.userCharacterName())})와 상대의 통화를 AI가 내 대사까지 통째로 써 줍니다. 내가 한 통화로 남습니다.`
            : "다른 인물들끼리 하는 통화를 AI가 통째로 써서 들려줍니다. 내 캐릭터는 이 통화를 모릅니다."
        }</p>
        ${
          mine
            ? `<label class="sv-room-name"><span>거는 쪽</span><select id="sv-overheard-side" ${off}><option value="me" ${editor.meFirst ? "selected" : ""}>내가 건다</option><option value="them" ${editor.meFirst ? "" : "selected"}>상대가 건다</option></select></label>`
            : ""
        }
        ${people}
        ${editor.people.length < most ? `<button type="button" class="sv-call-person-add" data-person-add ${off}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>사람 추가</span></button>` : ""}
        <label class="sv-room-name"><span>무슨 통화인지</span><input id="sv-overheard-reason" maxlength="300" placeholder="비워 두면 지금 이야기에 맞게 정합니다" value="${escapeHtml(editor.reason)}" autocomplete="off" ${off}></label>
        ${choiceListHtml({
          name: "sv-overheard-mode",
          label: "통화 방식",
          value: editor.open ? "open" : "complete",
          cls: "sv-overheard-modes",
          choices: [
            ["complete", "phone", "시작부터 끝까지", "한 번에 처음부터 통화가 끝날 때까지 씁니다."],
            ["open", "arrows-rotate", "길게 이어가기", "끊지 않고 중간에서 멈춥니다. 다음 내용을 지시하며 이어 가고, 원할 때 마무리합니다."],
          ],
        })}
        <label class="sv-room-name"><span data-overheard-length-label>${editor.open ? "한 번에 쓸 길이" : "통화 길이"}</span><select id="sv-overheard-length" ${off}>${OVERHEARD_LENGTH_CHOICES.map(([value, label]) => `<option value="${value}" ${value === editor.length ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <div class="sv-room-actions">
          <button type="button" class="sv-room-save" data-overheard-make ${off}>${editor.busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 통화 받아 오는 중…' : "통화 만들기"}</button>
        </div>
      </div>`;
    body.querySelectorAll("[data-person]").forEach((select) =>
      select.addEventListener("change", () => {
        editor.people[Number(select.dataset.person)] = select.value;
      }),
    );
    body.querySelectorAll("[data-person-remove]").forEach((button) =>
      button.addEventListener("click", () => {
        editor.people.splice(Number(button.dataset.personRemove), 1);
        this.renderOverheardEditor(body);
      }),
    );
    body.querySelector("[data-person-add]")?.addEventListener("click", () => {
      // Someone not on it yet, when there is anyone left.
      const next = contacts.find((contact) => !editor.people.includes(contact.key)) || contacts[0];
      editor.people.push(next.key);
      this.renderOverheardEditor(body);
    });
    body.querySelector("#sv-overheard-side")?.addEventListener("change", (event) => {
      editor.meFirst = event.target.value === "me";
    });
    body.querySelector("#sv-overheard-length").addEventListener("change", (event) => {
      editor.length = event.target.value;
    });
    body.querySelectorAll('input[name="sv-overheard-mode"]').forEach((input) => {
      input.disabled = Boolean(editor.busy);
      input.addEventListener("change", () => {
        if (!input.checked) return;
        editor.open = input.value === "open";
        body.querySelector("[data-overheard-length-label]").textContent = editor.open ? "한 번에 쓸 길이" : "통화 길이";
      });
    });
    body.querySelector("#sv-overheard-reason").addEventListener("input", (event) => {
      editor.reason = event.target.value;
    });
    body.querySelector("[data-overheard-cancel]").addEventListener("click", () => {
      this.overheardEditor = null;
      this.renderSmartphoneHistory(body);
    });
    body.querySelector("[data-overheard-make]").addEventListener("click", () =>
      this.run(async () => {
        if (editor.busy) return;
        editor.busy = true;
        this.renderOverheardEditor(body);
        try {
          const chosen = editor.people.map((key) => this.phoneContact(key));
          const me = { me: true };
          const [caller, callees] = !mine
            ? [chosen[0], chosen.slice(1)]
            : editor.meFirst
              ? [me, chosen]
              : [chosen[0], [me, ...chosen.slice(1)]];
          const session = await this.writeOverheardCall(caller, callees, editor.reason.trim(), "", {
            announce: false,
            length: editor.length,
            open: editor.open,
          });
          // Each next part as long as the first.
          if (session?.continuing) (this.callPartLength ||= {})[session.id] = editor.length;
          if (this.overheardEditor !== editor) return;
          this.overheardEditor = null;
          if (!session || !body.isConnected) return;
          // A call that goes on is heard on its call screen right away.
          if (session.continuing) await this.playCallThrough(body, session);
          else this.renderPhoneHistoryDetail(body, session);
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
    if (!confirm(`${session.character_name || "캐릭터"}와의 통화 기록을 지우시겠습니까?`)) return;
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
        `미적용 기억의 통화 ${away.length}개를 모두 지우시겠습니까?\n휴대폰에서 완전히 지워지고, 그 스와이프로 돌아가도 다시 나타나지 않습니다.`,
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
    const many = between || Boolean(session.others?.length);
    // Several voices on it: everyone named on their lines (also a phone handed over on a call).
    const named =
      many || (session.turns || []).some((turn) => turn.speaker_key && turn.speaker_key !== session.character_key);
    const name = escapeHtml(this.callNames(session).join(", ") || "캐릭터");
    const live = ["active", "ringing"].includes(session.status);
    if (this.unheardCalls?.delete(session.id)) this.updatePhoneLauncherVisibility();
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "app";
    const turns = session.turns || [];
    this.saveCallView({ sessionId: session.id, away });
    const heard = this.heardPosition(session.id);
    const playing = this.callPlayback?.sessionId === session.id ? this.callPlayback : heard ? { position: heard } : null;
    const avatar = many
      ? this.threadAvatarMarkup({ group: true, members: this.callMembers(session) })
      : this.contactAvatarMarkup(caller);
    body.innerHTML = `
            <div class="sv-phone-history-detail" data-session="${escapeHtml(session.id)}">
                <button type="button" class="sv-phone-back"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> ${away ? "미적용 기억" : "최근 통화"}</button>
                <div class="sv-detail-head">
                    ${avatar}
                    <div><h3>${name}</h3><small>${escapeHtml(this.formatDate(session.started_at))} · ${this.callStatusLabel(session)}${away ? ` · ${escapeHtml(this.awayPointLabel(session))}` : ""}</small></div>
                    ${live ? "" : '<button type="button" class="sv-call-history-delete sv-detail-delete" aria-label="이 통화 기록 삭제" title="이 기록 삭제"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>'}
                </div>
                ${live || !turns.length ? "" : `<div class="sv-call-aloud-row">${session.continuing ? '<button type="button" class="sv-call-aloud" data-call-continue aria-label="이어 가기" title="이어 가기: 멈춘 자리에서 다음 부분을 지시해 이어 갑니다"><i class="fa-solid fa-forward" aria-hidden="true"></i></button>' : ""}<button type="button" class="sv-call-aloud" data-call-download aria-label="내려받기" title="내려받기: 음성 파일 또는 영상"><i class="fa-solid fa-download" aria-hidden="true"></i></button><button type="button" class="sv-call-aloud" data-call-share aria-label="공유" title="공유: 이 통화를 다른 인물에게 들려줍니다"><i class="fa-solid fa-share" aria-hidden="true"></i></button>${this.callAloudButton(playing, turns.length)}</div>`}
                <div class="sv-call-transcript sv-history-transcript">
                    ${turns.length ? "" : '<p class="sv-transcript-empty">주고받은 대사가 없습니다.</p>'}
                    ${turns
                      .map((turn, index) => {
                        // My lines have a voice only with a persona voice.
                        const voiceable = turn.role !== "user" || this.personaVoiceReady();
                        // A past call's line without a voice yet can be made here.
                        // The line sounding now stays lit through redraws, as in 문자.
                        const sounding = this.playingTurnId === turn.id && this.currentAudio;
                        const button = turn.audio_url
                          ? `<button type="button" class="sv-call-replay${sounding ? " sv-playing" : ""}" data-turn="${index}" aria-label="이 대사 재생" title="재생"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
                          : (!live && voiceable) || turn.voicemail || between
                            ? `<button type="button" class="sv-call-replay" data-turn="${index}" aria-label="재생" title="재생: 음성을 만든 뒤 재생합니다"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
                            : "";
                        // The first line names 음성 재생성; the rest keep icons (names in tooltips).
                        const firstLabel = (label) => (index === 0 ? `<span>${label}</span>` : "");
                        const tools = live
                          ? ""
                          : `<div class="sv-call-line-tools${index === 0 ? " sv-labeled" : ""}">${
                              turn.audio_url && voiceable
                                ? `<button type="button" data-turn-reroll="${index}" aria-label="음성 재생성" title="음성 재생성: 같은 대사로 목소리만 새로 만듭니다"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>${firstLabel("음성 재생성")}</button>`
                                : ""
                            }<button type="button" data-turn-edit="${index}" aria-label="고치기" title="고치기: 대사를 고친 뒤 음성을 새로 만듭니다"><i class="fa-solid fa-pen" aria-hidden="true"></i></button></div>`;
                        const label = turn.voicemail
                          ? '<small class="sv-voicemail-label"><i class="fa-solid fa-voicemail" aria-hidden="true"></i>음성 사서함</small>'
                          : named && turn.role !== "user"
                            ? `<small class="sv-voicemail-label">${escapeHtml(turn.speaker_name || session.character_name || "")}${turn.aside ? " · 뒤에서" : ""}</small>`
                            : "";
                        const reading = (playing?.playing && playing.position === index) || sounding ? " sv-call-reading" : "";
                        return `<article class="${turn.role === "user" ? "sv-call-user" : "sv-call-character"}${reading}" data-index="${index}" aria-label="${turn.role === "user" ? "나" : escapeHtml(turn.speaker_name || session.character_name || "")}">${label}<p>${escapeHtml(turn.text)}</p>${this.translationHtml(turn)}${tools}${button}</article>`;
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
      this.run(async () => {
        const kind = await this.pickDownload();
        if (kind === "video") await this.withBusyButton(save, () => this.downloadCallVideo(body, session, away));
        else if (kind === "audio") await this.withBusyButton(save, () => this.downloadCall(body, session, away));
      }),
    );
    body.querySelector("[data-call-share]")?.addEventListener("click", () => this.run(() => this.shareCall(session)));
    body.querySelector("[data-call-continue]")?.addEventListener("click", () =>
      this.renderListenScreen(body, session, {}, { ended: true, away }),
    );
    body.querySelectorAll(".sv-call-replay").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.playHistoryTurn(body, session, turns[Number(button.dataset.turn)], button, away)),
      ),
    );
    body.querySelectorAll("[data-turn-reroll]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.playHistoryTurn(body, session, turns[Number(button.dataset.turnReroll)], button, away, true)),
      ),
    );
    body.querySelectorAll("[data-turn-edit]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.editHistoryTurn(body, session, turns[Number(button.dataset.turnEdit)], away)),
      ),
    );
  },

  /**
   * 고치기 in a past call: the line's words (and tags) change, with its chat memory; a line that
   * had a voice gets its new one at once. The translation stays only while the words do.
   */
  async editHistoryTurn(body, session, turn, away = false) {
    if (!turn) return;
    const sheet = await this.openLineSheet({
      title: turn.role === "user" ? "내 대사 고치기" : "대사 고치기",
      value: turn.script || turn.text,
      translation: turn.translation,
    });
    if (sheet === null) return;
    const edit = this.spokenEdit(sheet.value);
    if (!edit.text) throw new Error("대사를 비울 수는 없습니다.");
    const { changed, words, translation } = this.sheetChanges(turn, edit, sheet);
    if (!changed) return;
    const response = await this.request(`/api/plugins/scenevoice/phone/turns/${encodeURIComponent(turn.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: session.chat_id, ...edit, translation }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "대사를 고치지 못했습니다.");
    const current = data.session;
    await this.keepCallMemory(current);
    if (!body.isConnected) return;
    this.renderPhoneHistoryDetail(body, current, away);
    const index = current.turns.findIndex((item) => item.id === turn.id);
    const button = body.querySelector(`.sv-call-replay[data-turn="${index}"]`);
    if (words && turn.audio_url && button) await this.playHistoryTurn(body, current, current.turns[index], button, away);
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
      confirm(`캐릭터 대사 ${theirs}개는 아직 목소리가 없습니다. 만들어서 함께 넣으시겠습니까?\n취소하면 그 대사는 빠집니다.`);
    const makeMine =
      mine > 0 &&
      confirm(
        `내 대사 ${mine}개는 아직 목소리가 없습니다. 페르소나 목소리로 만들어서 함께 넣으시겠습니까?\n취소하면 ${captions ? "영상에는 글자로만 나옵니다." : "내 대사는 빠집니다."}`,
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

  /**
   * 내려받기: 음성 (one WAV) or 영상 (MP4), picked on a sheet over the phone; only 음성 where this
   * browser can't make a video. Resolves with "audio", "video" or "" (closed).
   */
  pickDownload() {
    const screen = document.querySelector("#sv-smartphone .sv-phone-screen");
    if (!this.downloadCallVideo || !this.canMakeCallVideo() || !screen) return Promise.resolve("audio");
    screen.querySelector(".sv-ph-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "sv-ph-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "내려받기");
    sheet.innerHTML = `
      <div class="sv-ph-sheet-card sv-pick-sheet" tabindex="-1">
        <strong>내려받기</strong>
        <button type="button" data-pick="audio"><i class="fa-solid fa-file-audio" aria-hidden="true"></i><span><b>음성</b><small>이어진 소리 파일 하나 (WAV)</small></span></button>
        <button type="button" data-pick="video"><i class="fa-solid fa-film" aria-hidden="true"></i><span><b>영상</b><small>화면·자막과 함께 (MP4)</small></span></button>
        <div class="sv-contact-edit-actions"><button type="button" data-pick="">취소</button></div>
      </div>`;
    screen.append(sheet);
    return new Promise((resolve) => {
      const close = (value) => {
        sheet.remove();
        resolve(value);
      };
      sheet.addEventListener("click", (event) => {
        const pick = event.target.closest("[data-pick]");
        if (pick) close(pick.dataset.pick);
        else if (event.target === sheet) close("");
      });
      sheet.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close("");
        }
      });
      sheet.querySelector(".sv-pick-sheet").focus();
    });
  },

  /**
   * A pause between lines (or a line without a voice shown for reading) that ‹ › or 그만 듣기
   * cuts short.
   */
  listenWait(run, ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (run.wake === done) run.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      run.wake = done;
    });
  },

  /** ‹ (-1) or › (+1) while listening: the line before or after the one playing now. */
  listenStep(run, step, count) {
    if (!run || run.stopped) return;
    const target = run.position + step;
    if (target < 0 || target >= count) return;
    run.next = target;
    run.wake?.();
    if (this.currentAudio) this.stopPlayback();
  },

  /** The ‹ › buttons of a listening screen, for line `position` of `count`. */
  syncListenSteps(view, position, count) {
    const prev = view.querySelector("[data-listen-prev]");
    const next = view.querySelector("[data-listen-next]");
    if (prev) prev.disabled = position <= 0;
    if (next) next.disabled = position >= count - 1;
  },

  /**
   * Kept in this browser so a reload doesn't lose them: how far each past call was heard, and
   * the call last looked at in the call history (its page, or a continued call's paused part).
   */
  heardPosition(sessionId) {
    try {
      return Number(JSON.parse(localStorage.getItem(HEARD_KEY) || "{}")[sessionId]) || 0;
    } catch {
      return 0;
    }
  },

  saveHeardPosition(sessionId, position) {
    try {
      const heard = JSON.parse(localStorage.getItem(HEARD_KEY) || "{}");
      delete heard[sessionId];
      if (position > 0) heard[sessionId] = position;
      localStorage.setItem(HEARD_KEY, JSON.stringify(Object.fromEntries(Object.entries(heard).slice(-30))));
    } catch {
      /* storage blocked */
    }
  },

  savedCallView() {
    try {
      const view = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
      return view?.chat === this.currentChatId() ? view : null;
    } catch {
      return null;
    }
  },

  saveCallView(view) {
    try {
      if (view) localStorage.setItem(VIEW_KEY, JSON.stringify({ ...view, chat: this.currentChatId() }));
      else localStorage.removeItem(VIEW_KEY);
    } catch {
      /* storage blocked */
    }
  },

  /** A small round ‹ or › beside 그만 듣기. */
  listenStepHtml(attr, icon, label) {
    return `<div><button type="button" class="sv-call-end sv-listen-back sv-listen-step" ${attr} aria-label="${label}" title="${label}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button></div>`;
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
    return `<button type="button" class="sv-call-aloud${playback?.playing ? " sv-playing" : ""}" data-call-aloud aria-label="${label}" title="${title}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
  },

  /**
   * 전체 듣기: a past call's lines in order, each in its speaker's voice (made as it goes when
   * a line has none yet, the next one while one plays; my own lines only with a persona voice).
   * Pressed again it stops; the next press goes on from there.
   */
  /** `from`: the line to start at (a part just written); otherwise where it stopped, or the top. */
  async playCallThrough(body, session, away = false, { from = null } = {}) {
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
    const saved = this.heardPosition(session.id);
    const start =
      from !== null
        ? Math.max(0, Math.min(from, turns.length - 1))
        : last?.sessionId === session.id && last.position < turns.length
          ? last.position
          : saved < turns.length
            ? saved
            : 0;
    const run = (this.callPlayback = { sessionId: session.id, position: start, playing: true, stopped: false });
    const over = () => run.stopped || operation.signal.aborted || this.callPlayback !== run;
    // Played on a call screen: the line being said under who is on the call.
    const shown = () => body.querySelector(`.sv-listen-screen[data-session="${CSS.escape(session.id)}"]`);
    run.session = session;
    run.away = away;
    this.renderListenScreen(body, session, run, { away });
    const mark = () => {
      const view = shown();
      if (!view) return;
      const turn = turns[run.position];
      const caption = view.querySelector("[data-listen-caption]");
      if (caption && turn) caption.innerHTML = this.listenCaptionHtml(session, turn);
      this.syncListenSteps(view, run.position, turns.length);
      run.ready = true;
    };
    this.unlockAudioForMobile();
    const voiced = (turn) => turn.role !== "user" || this.personaVoiceReady();
    const made = [];
    const settled = new Set();
    const prepare = (index) =>
      index < turns.length
        ? (made[index] ||= (async () => {
            const turn = turns[index];
            if (!voiced(turn)) return null;
            if (turn.audio_url) return { url: this.apiUrl(turn.audio_url), revoke: false, mixed: Boolean(turn.sounds_mixed) };
            const result = await this.makePhoneTurnAudio(current, turn).catch(() => null);
            if (!result) return null;
            if (result.session) current = result.session;
            return { url: result.audioUrl, revoke: true, mixed: result.mixed };
          })().finally(() => settled.add(index)))
        : null;
    try {
      let index = start;
      while (index < turns.length && !over()) {
        run.position = index;
        run.next = null;
        mark();
        // Two voices first, and two more whenever it catches up with the making, so a slow one
        // doesn't leave a gap midway.
        if (!settled.has(index)) await Promise.all([prepare(index), prepare(index + 1)]);
        const ready = await prepare(index);
        prepare(index + 1);
        prepare(index + 2);
        if (over()) break;
        const turn = turns[index];
        if (run.next === null) {
          // A line without a voice (mine, with no persona voice) stays up long enough to read.
          if (!ready) await this.listenWait(run, Math.min(6, 1.2 + Array.from(turn.text || "").length * 0.07) * 1000);
          else
            await new Promise((resolve) =>
              // Kept until the end (‹ can play it again); let go below.
              this.playWithSounds(ready.url, turn.script, null, false, {
                mixed: ready.mixed,
                communicationFilter: this.shouldApplyCommunicationFilter("phone", turn),
                aside: Boolean(turn.aside),
                onEnded: resolve,
                onStop: () => {
                  // ‹ › stop it to go to another line; anything else stops the listening.
                  if (run.next === null) run.stopped = true;
                  resolve();
                },
              }),
            );
        }
        if (over()) break;
        if (run.next === null) {
          run.position = index + 1;
          this.saveHeardPosition(session.id, run.position);
          if (index + 1 < turns.length) await this.listenWait(run, 380);
        }
        index = run.next ?? index + 1;
      }
      // Heard to the end: the next press starts again from the top.
      if (!over()) {
        run.position = 0;
        this.saveHeardPosition(session.id, 0);
      }
    } finally {
      for (const clip of made) clip?.then((ready) => ready?.revoke && URL.revokeObjectURL(ready.url));
      run.playing = false;
      clearInterval(run.clock);
      // Heard to the end: the call screen says so, to hear again or go back. Stopped: back to
      // the call, drawn again with the voices made meanwhile (their play buttons).
      if (shown() && !operation.signal.aborted) {
        if (!run.stopped) this.renderListenScreen(body, current, run, { ended: true, away });
        else {
          const shell = document.getElementById("sv-smartphone");
          if (shell) shell.dataset.screen = "app";
          this.renderPhoneHistoryDetail(body, current, away);
        }
      }
      this.updatePhoneReturn?.();
    }
  },

  /**
   * 이어 가기 (`mode` "next"), 재생성 ("again": its last part written again) or 마무리 ("last"),
   * following what is in the direction box; then the new part plays from its first line.
   */
  async writeCallPart(body, session, mode, away = false) {
    if (this.writtenCallBusy) return;
    this.writtenCallBusy = session.id;
    this.renderListenScreen(body, session, {}, { ended: true, away });
    let current = null;
    try {
      current = await this.continueWrittenCall(session, {
        mode,
        direction: (this.callDirectionDraft || "").trim(),
        length: this.callPartLength?.[session.id] || "",
      });
      this.callDirectionDraft = "";
    } finally {
      this.writtenCallBusy = "";
      if (!current && body.isConnected) this.renderListenScreen(body, session, {}, { ended: true, away });
    }
    if (!body.isConnected) return;
    const last = Math.max(0, ...current.turns.map((turn) => turn.part || 0));
    const from = current.turns.findIndex((turn) => (turn.part || 0) === last);
    await this.playCallThrough(body, current, away, { from });
  },

  /** Who says a past call's line, as its caption shows it. */
  listenCaptionHtml(session, turn) {
    const who =
      turn.role === "user"
        ? this.userCharacterName?.() || "나"
        : turn.speaker_name || session.character_name || "";
    return `<small>${escapeHtml(who)}${turn.aside ? " · 뒤에서" : ""}</small><p>${escapeHtml(turn.text)}</p>${this.translationHtml(turn)}`;
  },

  /**
   * 전체 듣기 of a past call, as a call screen: who is on it at the top (both, for a call between
   * two people), the line being said under them and the time running; `ended` when it was heard
   * to the end.
   */
  renderListenScreen(body, session, run, { ended = false, away = false } = {}) {
    const between = session.call_direction === "overheard";
    const members = this.callMembers(session);
    const many = members.length > 1;
    const names = escapeHtml(this.callNames(session).join(", "));
    // Stopped mid-call to be continued (이어 가며 듣기), or being written on.
    const open = ended && session.continuing;
    const writing = this.writtenCallBusy === session.id;
    // Stays on screen through other redraws until left (나중에 이어 가기) or ended.
    if (open) this.callListenOpen = { session, away };
    else if (this.callListenOpen?.session.id === session.id) this.callListenOpen = null;
    this.saveCallView({ sessionId: session.id, away, open });
    // The line said now (drawn again mid-call), the last one once it ended.
    const line = ended ? (session.turns || []).at(-1) : run.ready ? session.turns?.[run.position] : null;
    const control = (attrs, icon, label, cls = "sv-listen-back") =>
      `<div><button type="button" class="sv-call-end ${cls}" ${attrs} aria-label="${label}" ${writing ? "disabled" : ""}><i class="fa-solid ${icon}" aria-hidden="true"></i></button><small>${label}</small></div>`;
    body.innerHTML = `
      <div class="sv-call-screen sv-listen-screen${many ? " sv-listen-between" : ""}${members.length > 2 ? " sv-listen-many" : ""}" data-phone-wallpaper data-session="${escapeHtml(session.id)}">
        <div class="sv-call-identity">
          ${many ? `<div class="sv-room-avatar" aria-hidden="true">${members.slice(0, 4).map((member) => this.contactAvatarMarkup(member)).join("")}</div>` : this.contactAvatarMarkup(members[0])}
          <h2>${names}</h2>
          <span class="sv-call-state">${ended && !open ? "" : '<i class="sv-live-dot" aria-hidden="true"></i>'}<span>${
            open ? "통화 중 · 멈춤" : ended ? "통화가 끝났습니다" : between ? "엿듣는 중" : "지난 통화 듣는 중"
          }</span>${ended ? "" : ' · <time class="sv-call-duration">00:00</time>'}</span>
        </div>
        <div class="sv-call-live-line">${
          writing
            ? '<div class="sv-call-thinking"><span class="sv-typing" aria-hidden="true"><i></i><i></i><i></i></span><span>다음 부분 쓰는 중…</span></div>'
            : `<div class="sv-call-caption" data-listen-caption>${
                line ? this.listenCaptionHtml(session, line) : '<p class="sv-call-waiting">연결 중…</p>'
              }</div>`
        }</div>
        ${
          open
            ? `<form class="sv-call-compose sv-call-direction">
                 <textarea id="sv-call-direction" rows="1" maxlength="600" placeholder="다음 내용 지시 (비우면 AI가 알아서)" aria-label="다음 내용 지시" ${writing ? "disabled" : ""}>${escapeHtml(this.callDirectionDraft || "")}</textarea>
                 <button type="submit" aria-label="이어 가기" title="이어 가기: 다음 부분을 써서 들려줍니다" ${writing ? "disabled" : ""}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
               </form>${
                 between ? `<button type="button" class="sv-listen-later" data-listen-back ${writing ? "disabled" : ""}>나중에 이어 가기</button>` : ""
               }`
            : ""
        }
        <div class="sv-call-controls sv-listen-controls">${
          open
            ? control("data-listen-again", "fa-rotate-left", "다시 듣기", "sv-listen-again") +
              control("data-listen-part-again", "fa-arrows-rotate", "재생성") +
              control("data-listen-finish", "fa-flag-checkered", "마무리") +
              control("data-listen-hangup", "fa-phone-slash", "끊기", "")
            : ended
              ? control("data-listen-again", "fa-rotate-left", "다시 듣기", "sv-listen-again") +
                control("data-listen-back", "fa-list", "통화 기록")
              : `${this.listenStepHtml("data-listen-prev", "fa-backward-step", "앞 대사")}<div><button type="button" class="sv-call-end" data-listen-stop aria-label="그만 듣기" title="그만 듣기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>${this.listenStepHtml("data-listen-next", "fa-forward-step", "다음 대사")}`
        }</div>
      </div>`;
    this.applyPhoneWallpaper?.(body);
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "call";
    body.scrollTop = 0;
    body.querySelector("[data-listen-stop]")?.addEventListener("click", () => {
      run.stopped = true;
      run.wake?.();
      this.stopPlayback();
    });
    const count = (session.turns || []).length;
    body.querySelector("[data-listen-prev]")?.addEventListener("click", () => this.listenStep(run, -1, count));
    body.querySelector("[data-listen-next]")?.addEventListener("click", () => this.listenStep(run, 1, count));
    if (!ended) this.syncListenSteps(body, run.position ?? 0, count);
    body
      .querySelector("[data-listen-again]")
      ?.addEventListener("click", () => this.run(() => this.playCallThrough(body, session, away, { from: 0 })));
    body.querySelector("[data-listen-back]")?.addEventListener("click", () => {
      this.callListenOpen = null;
      if (shell) shell.dataset.screen = "app";
      this.renderPhoneHistoryDetail(body, session, away);
    });
    const direction = body.querySelector("#sv-call-direction");
    direction?.addEventListener("input", () => {
      this.callDirectionDraft = direction.value;
    });
    const write = (mode) => this.run(() => this.writeCallPart(body, session, mode, away));
    body.querySelector(".sv-call-direction")?.addEventListener("submit", (event) => {
      event.preventDefault();
      write("next");
    });
    body.querySelector("[data-listen-part-again]")?.addEventListener("click", () => write("again"));
    body.querySelector("[data-listen-finish]")?.addEventListener("click", () => write("last"));
    body.querySelector("[data-listen-hangup]")?.addEventListener("click", () =>
      this.run(async () => {
        const closed = await this.closeWrittenCall(session);
        if (body.isConnected) this.renderListenScreen(body, closed, {}, { ended: true, away });
      }),
    );
    if (!ended) {
      run.began ||= Date.now();
      const tick = () => {
        const time = body.querySelector(".sv-listen-screen .sv-call-duration");
        if (time) time.textContent = this.formatCallDuration((Date.now() - run.began) / 1000);
      };
      tick();
      clearInterval(run.clock);
      run.clock = setInterval(tick, 1000);
    }
  },

  /**
   * Plays a past call's line, with its sounds; a line without a voice gets one first.
   * `regenerate` (음성 재생성): a new voice for the same words.
   */
  async playHistoryTurn(body, session, turn, button, away = false, regenerate = false) {
    if (!turn) return;
    // Pressed again while it sounds: it stops.
    if (!regenerate && this.playingTurnId === turn.id && this.currentAudio) {
      this.stopPlayback();
      return;
    }
    const communicationFilter = this.shouldApplyCommunicationFilter("phone", turn);
    const index = (session.turns || []).findIndex((item) => item.id === turn.id);
    // Its play button pulses and its line is outlined while it sounds.
    const play = (url, revoke, mixed, lit) => {
      // A redrawn button isn't the one playback lit, so the marks are looked up, not remembered.
      const unmark = () => {
        body.querySelectorAll(".sv-history-transcript .sv-call-reading").forEach((article) => article.classList.remove("sv-call-reading"));
        body.querySelectorAll(".sv-history-transcript .sv-call-replay.sv-playing").forEach((lit) => lit.classList.remove("sv-playing"));
      };
      const done = () => {
        if (this.playingTurnId === turn.id) {
          this.playingTurnId = "";
          unmark();
        }
      };
      unmark();
      this.playingTurnId = turn.id;
      body.querySelector(`.sv-history-transcript article[data-index="${index}"]`)?.classList.add("sv-call-reading");
      this.playWithSounds(url, turn.script, lit, revoke, { mixed, communicationFilter, aside: Boolean(turn.aside), onEnded: done, onStop: done });
    };
    if (turn.audio_url && !regenerate) {
      play(this.apiUrl(turn.audio_url), false, Boolean(turn.sounds_mixed), button);
      return;
    }
    this.unlockAudioForMobile();
    const icon = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    try {
      const made = await this.makePhoneTurnAudio(session, turn, regenerate);
      if (!made) return;
      // Drawn again with its new voice first, so the button that plays it is the one lit.
      let lit = null;
      if (made.session && body.isConnected && body.querySelector(".sv-phone-history-detail")) {
        this.renderPhoneHistoryDetail(body, made.session, away);
        lit = body.querySelector(`.sv-call-replay[data-turn="${index}"]`);
      }
      play(made.audioUrl, true, made.mixed, lit);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = icon;
      }
    }
  },

  callStatusLabel(session) {
    if (session.continuing) return session.call_direction === "overheard" ? "엿듣는 중 · 이어 가는 중" : "이어 가는 중";
    if (session.call_direction === "overheard") return "엿들은 통화";
    if (session.status === "rejected") return "거절";
    if (session.status === "missed") return session.call_direction === "outgoing" ? "연결 안 됨" : "부재중";
    if (session.status === "active") return "통화 중";
    if (session.status === "ringing") return "수신 중";
    return session.call_direction === "incoming" ? "수신 통화" : "발신 통화";
  },
};
