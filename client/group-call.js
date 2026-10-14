// 단체 통화: a live call with two to four people at once. The first one called answers and the
// others are on it too; to each of my lines, whoever would answer does (one request a reply,
// like a group chat), each line in its own voice, played in turn.
import { escapeHtml } from "./common.js";
import { dataBlock, groupCallFinal, groupCallSystem, languageName, phoneMessages } from "./prompts.js";

export const groupCall = {
  isGroupCall(session = this.phoneSession) {
    return Boolean(session?.others?.length);
  },

  /** 단체 통화 from the contacts: who to call together (two to four), then 전화 걸기. */
  renderGroupCallPicker(body) {
    const picker = this.groupCallPicker;
    const contacts = this.phoneContacts();
    const options = (selected) =>
      contacts
        .map((contact) => `<option value="${escapeHtml(contact.key)}" ${contact.key === selected ? "selected" : ""}>${escapeHtml(contact.name)}</option>`)
        .join("");
    const off = picker.busy ? "disabled" : "";
    body.innerHTML = `
      <div class="sv-room-editor sv-group-call-picker">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back" data-group-call-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 연락처</button>
          <strong class="sv-room-editor-title">단체 통화</strong>
        </header>
        <p class="sv-room-hint">여러 명에게 한꺼번에 겁니다. 내가 말하면 대답할 만한 사람이 대답합니다.</p>
        ${picker.people
          .map(
            (key, index) =>
              `<div class="sv-call-person"><label class="sv-room-name"><span>${index ? "함께 통화할 사람" : "전화 받을 사람"}</span><select data-group-person="${index}" ${off}>${options(key)}</select></label>${
                index >= 2 ? `<button type="button" class="sv-call-person-remove" data-group-remove="${index}" aria-label="빼기" title="빼기" ${off}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ""
              }</div>`,
          )
          .join("")}
        ${picker.people.length < 4 ? `<button type="button" class="sv-call-person-add" data-group-add ${off}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>사람 추가</span></button>` : ""}
        <div class="sv-room-actions">
          <button type="button" class="sv-room-save" data-group-call-start ${off}>${picker.busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 거는 중…' : '<i class="fa-solid fa-phone" aria-hidden="true"></i> 전화 걸기'}</button>
        </div>
      </div>`;
    body.querySelectorAll("[data-group-person]").forEach((select) =>
      select.addEventListener("change", () => {
        picker.people[Number(select.dataset.groupPerson)] = select.value;
      }),
    );
    body.querySelectorAll("[data-group-remove]").forEach((button) =>
      button.addEventListener("click", () => {
        picker.people.splice(Number(button.dataset.groupRemove), 1);
        this.renderGroupCallPicker(body);
      }),
    );
    body.querySelector("[data-group-add]")?.addEventListener("click", () => {
      picker.people.push((contacts.find((contact) => !picker.people.includes(contact.key)) || contacts[0]).key);
      this.renderGroupCallPicker(body);
    });
    body.querySelector("[data-group-call-cancel]").addEventListener("click", () => {
      this.groupCallPicker = null;
      this.phoneContactKey = "";
      this.renderSmartphone();
    });
    body.querySelector("[data-group-call-start]").addEventListener("click", () =>
      this.run(async () => {
        if (picker.busy) return;
        const keys = [...new Set(picker.people)];
        if (keys.length < 2) throw new Error("서로 다른 두 사람 이상을 골라 주십시오.");
        picker.busy = true;
        this.renderGroupCallPicker(body);
        try {
          await this.startGroupCall(keys);
        } finally {
          picker.busy = false;
          if (this.groupCallPicker === picker) this.groupCallPicker = null;
          await this.renderSmartphone();
        }
      }),
    );
  },

  /** Calls them together: the first answers, the others join; the call screen opens. */
  async startGroupCall(keys) {
    this.unlockAudioForMobile();
    const operation = this.captureChat();
    if (this.phoneBusy) return;
    const profileId = this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) throw new Error("전화 대화에 사용할 실리태번 연결 프로필을 설정해 주십시오.");
    const people = keys.map((key) => this.phoneContact(key));
    this.phoneBusy = true;
    const operationToken = ++this.phoneOperationToken;
    try {
      const identity = this.getStateIdentity();
      const anchor = this.currentPhoneAnchor();
      const made = await this.createPhoneSession({
        chat_id: identity.chatId,
        anchor_message_id: String(anchor.index),
        ...this.anchorStamp(anchor.index),
        character_key: people[0].key,
        character_name: people[0].name,
        others: people.slice(1).map(({ key, name }) => ({ key, name })),
        direction: "outgoing",
        status: "active",
        situation: "",
      });
      if (made.existing) {
        this.notify(`${made.existing.character_name || "상대"}와의 통화가 아직 이어지고 있어 그 통화로 돌아갑니다.`, "info");
        this.phoneSession = made.existing;
        return;
      }
      this.phoneSession = made.session;
      this.groupCallPicker = null;
      this.phoneActiveTab = "call";
      await this.persistPhoneSessionToMessage();
      await this.renderSmartphone();
      await this.generateGroupPhoneTurn({ opening: true, operationToken });
    } catch (error) {
      if (operation.signal.aborted) return;
      throw error;
    } finally {
      if (!operation.signal.aborted) {
        this.phoneBusy = false;
        await this.renderSmartphone();
      }
    }
  },

  /** Whoever answers my latest line: one request, one to four lines, each kept with who said it. */
  async generateGroupPhoneTurn({ opening = false, operationToken = this.phoneOperationToken } = {}) {
    const operation = this.captureChat();
    const profileId = this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService || !this.phoneSession) throw new Error("전화 대화 연결 프로필이 없습니다.");
    const session = this.phoneSession;
    const sessionId = session.id;
    const me = this.userCharacterName();
    const people = this.callMembers(session).map((person, index) => ({
      ...person,
      name: index ? person.name : session.character_name || person.name,
    }));
    const states = await Promise.all(people.map((person) => this.stateForPrompt(person.key).catch(() => null)));
    const transcript = (session.turns || []).slice(-30).map((turn) => ({
      speaker: turn.role === "user" ? me : turn.speaker_name || session.character_name || "",
      text: turn.text,
    }));
    const lastMine = [...(session.turns || [])].reverse().find((turn) => turn.role === "user")?.text;
    const languages = people.map((person) =>
      this.conversationLanguage(transcript.slice(-6).map((turn) => turn.text), lastMine, person.key),
    );
    const messages = phoneMessages(
      groupCallSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        opening,
        direction: session.call_direction,
        translation: languages.some((language) => this.wantsTranslation(language)),
        soundEffects: people.every((person) => this.phoneSoundEffects(person.key)),
      }),
      [
        dataBlock("user_character", me),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock(
          "people_on_call",
          people.map((person, index) => ({
            key: person.key,
            name: person.name,
            language: `${languageName(languages[index])} (${languages[index]})`,
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
        ...((await this.worldInfoBlocks?.(transcript.map((turn) => turn.text))) || []),
        ...this.currentTimeBlocks(people.map((person) => person.key)),
        dataBlock("call_situation", session.situation || "(natural continuation of the chat)", {
          direction: session.call_direction,
        }),
        dataBlock("call_transcript", transcript),
      ],
      groupCallFinal(me),
    );
    this.assertChat(operation);
    const parsed = await this.requestSpokenReply(profileId, messages, 1400);
    if (operationToken !== this.phoneOperationToken || this.phoneSession?.id !== sessionId || this.phoneSession?.status !== "active")
      return;
    const speakerOf = (from) => {
      const value = String(from || "").trim().toLowerCase();
      return (
        people.find((person) => person.key.toLowerCase() === value) ||
        people.find((person) => person.name.trim().toLowerCase() === value) ||
        null
      );
    };
    const lines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
      .map((line) => ({ speaker: speakerOf(line?.from), draft: this.normalizePhoneDraft(line, session.situation || "") }))
      .filter(({ speaker, draft }) => speaker && draft.text)
      .slice(0, 4);
    if (!lines.length) throw new Error("보조 모델이 통화 대사를 반환하지 않았습니다.");
    const made = [];
    // A new round shows from its first line.
    this.groupCallShown = null;
    for (const [index, { speaker, draft }] of lines.entries()) {
      await this.savePhoneTurn(
        {
          role: "character",
          speaker_key: speaker.key,
          speaker_name: speaker.name,
          text: draft.text,
          script: draft.script,
          translation: draft.translation,
          tags: draft.tags,
          language: draft.language,
          intensity: draft.intensity,
          should_end: index === lines.length - 1 && Boolean(parsed?.should_end),
        },
        sessionId,
      );
      made.push(this.phoneSession?.turns?.at(-1)?.id);
    }
    await this.renderSmartphone();
    // Like a real call, played as they come, one after another.
    if (this.config.phone?.auto_voice !== false) void this.voiceGroupRound(made.filter(Boolean));
  },

  /**
   * The lines of a round voiced and played in order (each made while the one before plays): a
   * group call's, or a 1:1 reply with remarks behind it.
   */
  async voiceGroupRound(ids) {
    const sessionId = this.phoneSession?.id;
    const turnOf = (id) => this.phoneSession?.turns?.find((turn) => turn.id === id);
    let next = null;
    const make = (id) => {
      const turn = turnOf(id);
      if (!turn) return Promise.resolve(null);
      if (turn.audio_url) return Promise.resolve({ url: this.apiUrl(turn.audio_url), revoke: false, mixed: Boolean(turn.sounds_mixed) });
      return this.makePhoneTurnAudio(this.phoneSession, turn)
        .then((result) => {
          if (result?.session && this.phoneSession?.id === result.session.id) this.phoneSession = result.session;
          return result ? { url: result.audioUrl, revoke: true, mixed: result.mixed } : null;
        })
        .catch(() => null);
    };
    for (const [index, id] of ids.entries()) {
      const ready = await (next || make(id));
      next = ids[index + 1] ? make(ids[index + 1]) : null;
      if (this.phoneSession?.id !== sessionId || !ready) continue;
      // The line under the names follows the voice.
      this.showGroupLine(id);
      const turn = turnOf(id);
      await new Promise((resolve) =>
        this.playWithSounds(ready.url, turn?.script || "", null, ready.revoke, {
          mixed: ready.mixed,
          communicationFilter: this.shouldApplyCommunicationFilter("phone"),
          // A remark from behind the phone (a 1:1 call's background) sounds fainter.
          aside: Boolean(turn?.aside),
          onEnded: resolve,
          onStop: resolve,
        }),
      );
    }
    if (this.phoneSession?.id === sessionId) await this.renderSmartphone();
  },

  /** 답변 재생성 on a group call: their whole last round taken back, to be asked for again. */
  async dropGroupRound() {
    for (;;) {
      const last = this.phoneSession?.turns?.at(-1);
      if (!last || last.role === "user") return;
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
};
