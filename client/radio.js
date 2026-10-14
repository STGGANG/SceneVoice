// 라디오 (a fun extra): a show written in one request and voiced on demand. "토크":
// the hosts talk about the story so far as its cast, outside it (fourth wall); "사연": a DJ in
// the story's world reads my listener's story on air; "시나리오": a show in the flow of an
// outline I wrote. Never part of the chat memory or any other prompt; each show only says where
// in the chat it was made.
import { escapeHtml, OVERHEARD_LENGTH_CHOICES } from "./common.js";
import { dataBlock, languageName, phoneMessages, radioFinal, radioSystem } from "./prompts.js";
import { pcm16, wavFromParts } from "./wav.js";

const RADIO_TOKENS = { short: 1800, normal: 3200, long: 4800 };
// 기억: the shows kept on record that the next one is given whole (newest few), and where the
// 새 방송 choice is kept (it stays as it was last set; off at first).
const PAST_SHOWS = 5;
const REMEMBER_KEY = "scenevoice_radio_remember";
const MODE_LABEL = { talk: "토크", story: "사연", scenario: "시나리오" };
// The show's music: up front and under the first line, then under the last and after it. None
// when the file isn't there.
const MUSIC_URL = new URL("./assets/radio-music.mp3", import.meta.url).href;
const MUSIC_UP = 0.5;
const MUSIC_UNDER = 0.22;
const MUSIC_LEAD = 2.2;
const MUSIC_TAIL = 8.2;
const MUSIC_OUTRO_FROM = 8;
const LINE_GAP = 0.3;
/** Levels at times from the start, made to go forward (a short line doesn't fold them back). */
const envelope = (points) => {
  let at = 0;
  return points.map(([time, level]) => [(at = Math.max(at, time)), level]);
};
const introLevels = () => envelope([[0.6, MUSIC_UP], [MUSIC_LEAD, MUSIC_UP], [MUSIC_LEAD + 0.5, MUSIC_UNDER], [MUSIC_LEAD + 1.5, MUSIC_UNDER], [MUSIC_LEAD + 5.5, 0]]);
// Once the last line has ended: up a little, then a slow fade.
const OUTRO_AFTER = [[0.6, MUSIC_UP], [3.1, MUSIC_UP], [8.1, 0]];
// The same from the last line's start, `spoken` seconds long (for a file).
const outroLevels = (spoken) => envelope([[1.5, MUSIC_UNDER], [spoken, MUSIC_UNDER], ...OUTRO_AFTER.map(([time, level]) => [spoken + time, level])]);

export const radio = {
  radioAppOn() {
    return this.phoneOn() && this.config.phone?.radio_app !== false;
  },

  async loadShows() {
    const response = await this.request(
      `/api/plugins/scenevoice/phone/radio?chat_id=${encodeURIComponent(this.currentChatId())}&limit=100`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `라디오를 불러오지 못했습니다 (${response.status})`);
    return data.items || [];
  },

  /** What happened on the phone in this chat, short: the last calls and texts. */
  async radioPhoneLog() {
    const me = this.userCharacterName();
    const response = await this.request(
      `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=20`,
      { cache: "no-store" },
    );
    const sessions = response.ok ? ((await response.json()).items || []).filter((session) => this.anchorShown(session)).slice(0, 5).reverse() : [];
    const texts = (await this.loadMessages().catch(() => [])).slice(-20);
    return {
      calls: sessions.map((session) => ({
        on_call: this.callNames(session).join(", "),
        lines: (session.turns || []).slice(-6).map((turn) => `${turn.role === "user" ? me : turn.speaker_name || session.character_name}: ${turn.text}`),
      })),
      texts: texts.map((item) => `${item.role === "user" ? me : item.character_name}: ${this.messageWords(item)}`),
    };
  },

  /**
   * One show written and kept. `hosts`: contacts (the first leads); `story`: the listener's story
   * (사연) or my outline (시나리오); `caller`: who may phone in ("auto": whoever fits, a key, or
   * nobody); `remember`: the next shows know it. Returns it.
   */
  async writeRadioShow({ mode = "talk", hosts, length = "normal", phone = false, story = "", caller = "", remember = false }) {
    if (mode === "scenario" && !story.trim()) throw new Error("시나리오를 적어 주세요.");
    const operation = this.captureChat();
    const profileId = this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) throw new Error("전화·문자에 쓸 연결 프로필을 설정해 주십시오.");
    const people = hosts.map((host) => (host.key === "user" ? { key: "user", name: this.userCharacterName(), me: true, note: "" } : this.phoneContact(host.key)));
    // My character speaks in the language of the first other host.
    const other = people.find((person) => !person.me) || people[0];
    const languages = people.map((person) => this.conversationLanguage([], "", (person.me ? other : person).key));
    const onAir = new Set(people.map((person) => person.key));
    const callers = (caller === "auto" ? this.phoneContacts() : caller ? [this.phoneContact(caller)] : [])
      .filter((person) => person?.key && !onAir.has(person.key))
      .slice(0, 8);
    const pastShows = await this.rememberedShows();
    const messages = phoneMessages(
      radioSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        translation: languages.some((language) => this.wantsTranslation(language)),
        soundEffects: people.every((person) => person.me || this.phoneSoundEffects(person.key)),
        length,
        mode,
        count: people.length,
        withUser: people.some((person) => person.me),
        callers: callers.length ? (caller === "auto" ? "auto" : "chosen") : "",
        pastShows: pastShows.length > 0,
      }),
      [
        dataBlock("user_character", this.userCharacterName()),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock(
          "hosts",
          people.map((person, index) => ({
            key: person.key,
            name: person.name,
            language: `${languageName(languages[index])} (${languages[index]})`,
            ...(person.me ? { user_character: true } : {}),
            emotional_range: this.emotionalRange(person.me ? this.personaKey() : person.key),
            performance_note: person.note || "",
          })),
        ),
        ...(callers.length
          ? [
              dataBlock(
                "callers",
                callers.map((person) => ({
                  key: person.key,
                  name: person.name,
                  language: languageName(this.conversationLanguage([], "", person.key)),
                  emotional_range: this.emotionalRange(person.key),
                  performance_note: person.note || "",
                })),
              ),
            ]
          : []),
        dataBlock("recent_chat", this.buildRecentChatContext(this.config.phone?.context_messages ?? 10)),
        ...(phone ? [dataBlock("phone_log", await this.radioPhoneLog())] : []),
        ...(pastShows.length ? [dataBlock("past_shows", pastShows)] : []),
        ...((await this.statusLinesBlocks?.()) || []),
        ...((await this.worldInfoBlocks?.([story])) || []),
        ...(mode === "story" ? [dataBlock("listener_story", story || "(make one up that fits)")] : []),
        ...(mode === "scenario" ? [dataBlock("scenario", story)] : []),
      ],
      radioFinal(people.map((person) => person.name)),
    );
    this.assertChat(operation);
    const parsed = await this.requestSpokenReply(profileId, messages, RADIO_TOKENS[length] || RADIO_TOKENS.normal);
    this.assertChat(operation);
    const voices = [...people, ...callers.map((person) => ({ ...person, caller: true }))];
    const speakerOf = (from) => {
      const value = String(from || "").trim().toLowerCase();
      return (
        voices.find((person) => person.key.toLowerCase() === value) ||
        voices.find((person) => person.name.trim().toLowerCase() === value) ||
        null
      );
    };
    const lines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
      .map((line) => ({ speaker: speakerOf(line?.from), draft: this.normalizePhoneDraft(line) }))
      .filter(({ speaker, draft }) => speaker && draft.text)
      .slice(0, 40)
      .map(({ speaker, draft }) => ({
        speaker_key: speaker.key,
        speaker_name: speaker.name,
        ...(speaker.caller ? { caller: true } : {}),
        text: draft.text,
        script: draft.script,
        translation: draft.translation,
        tags: draft.tags,
        intensity: draft.intensity,
        language: draft.language,
      }));
    if (lines.length < 2) throw new Error("보조모델이 방송 대사를 돌려주지 않았습니다. 다시 시도해 주십시오.");
    const anchor = String(this.currentPhoneAnchor().index);
    const response = await this.request("/api/plugins/scenevoice/phone/radio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.getStateIdentity().chatId,
        anchor_message_id: anchor,
        ...this.anchorStamp(anchor),
        title: String(parsed?.title || "").trim().slice(0, 80),
        mode,
        hosts: people.map(({ key, name }) => ({ key, name })),
        story,
        remember,
        lines,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `방송 저장 실패 (${response.status})`);
    return data.item;
  },

  /** 기억: the shows on record in this chat (as shown now), oldest first, as the next show reads them. */
  async rememberedShows() {
    const shows = (await this.loadShows().catch(() => []))
      .filter((show) => show.remember && this.anchorShown(show))
      .slice(0, PAST_SHOWS)
      .reverse();
    return shows.map((show) => ({
      title: this.radioTitle(show),
      kind: MODE_LABEL[show.mode] || "",
      on_air: show.hosts.map((host) => host.name),
      lines: show.lines.map((line) => `${line.speaker_name}${line.caller ? " (on the phone)" : ""}: ${line.text}`),
    }));
  },

  /** The 새 방송 choice for 기억, as last set (off at first). */
  radioRememberChoice(value) {
    try {
      if (value !== undefined) localStorage.setItem(REMEMBER_KEY, value ? "1" : "0");
      return localStorage.getItem(REMEMBER_KEY) === "1";
    } catch {
      return Boolean(value);
    }
  },

  /** 기억 on a kept show, switched on or off. */
  async setRadioRemember(show, remember) {
    const response = await this.request(`/api/plugins/scenevoice/phone/radio/${encodeURIComponent(show.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: show.chat_id, remember }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "방송 기억을 바꾸지 못했습니다.");
    return data.item;
  },

  /** A host as their contact (my character: my persona's), named as on the show. */
  radioHost(host) {
    return { ...this.phoneContact(host.key === "user" ? this.personaKey() : host.key), key: host.key, name: host.name };
  },

  /** A line said by my character, voiced only when my persona has a voice. */
  radioLineMine(line) {
    return line.speaker_key === "user";
  },

  radioLineVoiced(line) {
    return !this.radioLineMine(line) || this.personaVoiceReady();
  },

  /** Who says a line, as shown: a caller is marked as on the phone. */
  radioSpeaker(line) {
    return `${line.speaker_name || ""}${line.caller ? " · 전화 연결" : ""}`;
  },

  radioTitle(show) {
    return show.title || `${show.hosts.map((host) => host.name).join(", ")}의 ${MODE_LABEL[show.mode] || "라디오"}`;
  },

  /** Where in the chat it was made (it never goes into the chat itself). */
  radioPlace(show) {
    return [this.chatSpotLabel(show), this.formatPhoneDate(show.created_at)].filter(Boolean).join(" · ");
  },

  /** The show's own frequency on the dial (the same every time): FM 88.1 to 107.9. */
  radioFrequency(show) {
    let hash = 0;
    for (const char of String(show.id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return (88.1 + (hash % 100) * 0.2).toFixed(1);
  },

  radioFileName(show) {
    return `${this.radioTitle(show)}-라디오-${this.fileStamp(show.created_at)}`;
  },

  /** The list, a show's page (its lines to read), or the show on air. */
  async renderSmartphoneRadio(body) {
    if (this.radioPlaying) return this.renderRadioAir(body, this.radioPlaying.show, this.radioPlaying, { ended: this.radioPlaying.ended });
    if (this.radioEditor) return this.renderRadioEditor(body);
    if (this.radioShowOpen) return this.renderRadioShow(body, this.radioShowOpen);
    body.innerHTML =
      '<div class="sv-phone-list-empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><p>라디오를 불러오는 중…</p></div>';
    let shows;
    try {
      shows = (await this.loadShows()).filter((show) => this.anchorShown(show));
    } catch (error) {
      body.innerHTML = `<div class="sv-phone-list-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escapeHtml(error.message)}</p></div>`;
      return;
    }
    if (this.phoneActiveTab !== "radio" || this.radioEditor || this.radioPlaying || this.radioShowOpen) return;
    const contacts = this.phoneContacts();
    body.innerHTML = `
      <div class="sv-memo-list sv-radio-list">
        ${contacts.length ? '<button type="button" class="sv-msg-new-group sv-memo-new" data-radio-new><i class="fa-solid fa-plus" aria-hidden="true"></i><span>새 방송</span></button>' : ""}
        ${
          shows.length
            ? shows
                .map(
                  (show) => `
          <button type="button" class="sv-memo sv-radio-show" data-radio-open="${escapeHtml(show.id)}">
            <span class="sv-radio-badge">${escapeHtml(MODE_LABEL[show.mode] || "라디오")}</span>
            <span class="sv-recent-main"><strong>${show.remember ? '<i class="fa-solid fa-bookmark sv-radio-kept" aria-label="기억" title="다음 방송이 기억"></i>' : ""}${escapeHtml(this.radioTitle(show))}</strong><small>${escapeHtml(show.hosts.map((host) => host.name).join(", "))}</small><small>${escapeHtml(this.radioPlace(show))}</small></span>
            <i class="fa-solid fa-chevron-right sv-recent-chevron" aria-hidden="true"></i>
          </button>`,
                )
                .join("")
            : '<div class="sv-phone-list-empty"><span class="sv-empty-badge sv-app-radio"><i class="fa-solid fa-radio" aria-hidden="true"></i></span><strong>라디오</strong><p>아직 만든 방송이 없습니다.</p></div>'
        }
      </div>`;
    body.querySelector("[data-radio-new]")?.addEventListener("click", () => {
      this.radioEditor = {
        mode: "talk",
        hosts: [contacts[0].key],
        length: "normal",
        phone: false,
        story: "",
        scenario: "",
        caller: "auto",
        remember: this.radioRememberChoice(),
        busy: false,
      };
      this.renderSmartphone();
    });
    body.querySelectorAll("[data-radio-open]").forEach((button) =>
      button.addEventListener("click", () => {
        this.radioShowOpen = shows.find((show) => show.id === button.dataset.radioOpen);
        this.renderSmartphone();
      }),
    );
  },

  /** A show's page: what was said, to read; 듣기 puts it on air, 내려받기 saves it. */
  renderRadioShow(body, show) {
    const hosts = show.hosts.map((host) => this.radioHost(host));
    const resume = this.radioStopAt?.id === show.id ? this.radioStopAt.position : 0;
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "app";
    body.innerHTML = `
      <div class="sv-phone-history-detail sv-radio-detail">
        <button type="button" class="sv-phone-back" data-radio-list><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 라디오</button>
        <div class="sv-detail-head">
          ${hosts.length > 1 ? this.threadAvatarMarkup({ group: true, members: hosts }) : this.contactAvatarMarkup(hosts[0])}
          <div><h3>${escapeHtml(this.radioTitle(show))}</h3><small>${escapeHtml([MODE_LABEL[show.mode], hosts.map((host) => host.name).join(", ")].filter(Boolean).join(" · "))}</small><small>${escapeHtml(this.radioPlace(show))}</small></div>
          <div class="sv-radio-head-tools">
            <button type="button" class="sv-radio-remember${show.remember ? " sv-on" : ""}" data-radio-remember aria-pressed="${show.remember ? "true" : "false"}" aria-label="기억" title="${show.remember ? "기억 켜짐: 다음 방송이 이 방송 내용을 압니다(채팅에는 안 들어감)" : "기억 꺼짐: 다음 방송은 이 방송을 모릅니다"}"><i class="fa-solid fa-bookmark" aria-hidden="true"></i></button>
            <button type="button" class="sv-call-history-delete sv-detail-delete" data-radio-delete aria-label="이 방송 삭제" title="이 방송 삭제"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="sv-call-aloud-row">
          <button type="button" class="sv-call-aloud" data-radio-download aria-label="내려받기" title="내려받기: 음성 파일 또는 영상"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
          <button type="button" class="sv-call-aloud" data-radio-play aria-label="${resume ? "이어 듣기" : "듣기"}" title="${resume ? "이어 듣기: 멈춘 대사부터" : "듣기: 라디오 화면에서 처음부터"}"><i class="fa-solid fa-headphones" aria-hidden="true"></i></button>
        </div>
        ${show.story && show.mode !== "talk" ? `<p class="sv-radio-story"><b>${show.mode === "scenario" ? "내 시나리오" : "보낸 사연"}</b>${escapeHtml(show.story)}</p>` : ""}
        <div class="sv-call-transcript sv-history-transcript">
          ${show.lines
            .map((line, index) => {
              // The line sounding now stays lit through redraws.
              const sounding = this.playingTurnId === line.id && this.currentAudio;
              const named = (label) => (index === 0 ? `<span>${label}</span>` : "");
              const voiced = this.radioLineVoiced(line);
              return `<article class="${this.radioLineMine(line) ? "sv-call-user" : "sv-call-character"}${sounding ? " sv-call-reading" : ""}" data-index="${index}" aria-label="${escapeHtml(line.speaker_name || "")}"><small class="sv-voicemail-label">${escapeHtml(this.radioSpeaker(line))}</small><p>${escapeHtml(line.text)}</p>${this.translationHtml(line)}<div class="sv-call-line-tools${index === 0 ? " sv-labeled" : ""}">${
                line.audio_url && voiced
                  ? `<button type="button" data-radio-line-reroll="${index}" aria-label="음성 재생성" title="음성 재생성: 같은 대사로 목소리만 새로 만듭니다"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>${named("음성 재생성")}</button>`
                  : ""
              }<button type="button" data-radio-line-edit="${index}" aria-label="고치기" title="고치기: 대사를 고친 뒤 음성을 새로 만듭니다"><i class="fa-solid fa-pen" aria-hidden="true"></i></button></div>${
                voiced
                  ? `<button type="button" class="sv-call-replay${sounding ? " sv-playing" : ""}" data-radio-line-play="${index}" aria-label="이 대사 재생" title="${line.audio_url ? "재생" : "재생: 음성을 만든 뒤 재생합니다"}"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
                  : ""
              }</article>`;
            })
            .join("")}
        </div>
      </div>`;
    body.scrollTop = 0;
    body.querySelector("[data-radio-list]").addEventListener("click", () => {
      this.radioShowOpen = null;
      this.renderSmartphone();
    });
    body.querySelector("[data-radio-play]").addEventListener("click", () => this.run(() => this.playRadioShow(body, show, resume)));
    const keep = body.querySelector("[data-radio-remember]");
    keep.addEventListener("click", () =>
      this.run(async () => {
        keep.disabled = true;
        try {
          const current = await this.setRadioRemember(show, !show.remember);
          Object.assign(show, { remember: current.remember });
          if (this.radioShowOpen?.id === show.id) this.radioShowOpen = show;
          this.notify(show.remember ? "다음 방송부터 이 방송 내용을 기억합니다." : "이제 다음 방송은 이 방송을 모릅니다.", "info");
        } finally {
          if (body.isConnected && body.querySelector(".sv-radio-detail")) this.renderRadioShow(body, show);
        }
      }),
    );
    const save = body.querySelector("[data-radio-download]");
    save.addEventListener("click", () =>
      this.run(async () => {
        const kind = await this.pickDownload();
        if (kind === "video") await this.withBusyButton(save, () => this.downloadRadioVideo(show));
        else if (kind === "audio") await this.withBusyButton(save, () => this.downloadRadio(show));
      }),
    );
    body.querySelectorAll("[data-radio-line-play]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.playRadioLine(body, show, Number(button.dataset.radioLinePlay), button)),
      ),
    );
    body.querySelectorAll("[data-radio-line-reroll]").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => this.playRadioLine(body, show, Number(button.dataset.radioLineReroll), button, true)),
      ),
    );
    body.querySelectorAll("[data-radio-line-edit]").forEach((button) =>
      button.addEventListener("click", () => this.run(() => this.editRadioLine(body, show, Number(button.dataset.radioLineEdit)))),
    );
    body.querySelector("[data-radio-delete]").addEventListener("click", () =>
      this.run(async () => {
        if (!confirm(`‘${this.radioTitle(show)}’ 방송을 지우시겠습니까?`)) return;
        const response = await this.request(`/api/plugins/scenevoice/phone/radio/${encodeURIComponent(show.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: show.chat_id }),
        });
        if (!response.ok) throw new Error((await response.json()).detail || "방송을 지우지 못했습니다.");
        this.radioShowOpen = null;
        await this.renderSmartphone();
      }),
    );
  },

  renderRadioEditor(body) {
    const editor = this.radioEditor;
    const contacts = this.phoneContacts();
    const off = editor.busy ? "disabled" : "";
    // My character can be on air too (the AI writes their lines as well).
    const choices = [...contacts, { key: "user", name: `${this.userCharacterName()} (나)` }];
    const options = (selected) =>
      choices
        .map((contact) => `<option value="${escapeHtml(contact.key)}" ${contact.key === selected ? "selected" : ""}>${escapeHtml(contact.name)}</option>`)
        .join("");
    const story = editor.mode === "story";
    const scenario = editor.mode === "scenario";
    const modes = [
      ["talk", "토크 · 지금까지 이야기로 수다 (제4의 벽)"],
      ["story", "사연 · 내 사연을 읽어 주는 방송"],
      ["scenario", "시나리오 · 내가 쓴 흐름대로 만드는 방송"],
    ];
    body.innerHTML = `
      <div class="sv-room-editor sv-radio-editor">
        <header class="sv-msg-head">
          <button type="button" class="sv-phone-back" data-radio-cancel><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 라디오</button>
          <strong class="sv-room-editor-title">새 방송</strong>
        </header>
        <label class="sv-room-name"><span>무슨 방송</span><select id="sv-radio-mode" ${off}>${modes.map(([value, label]) => `<option value="${value}" ${value === editor.mode ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <p class="sv-room-hint">${
          story
            ? "첫 번째 사람이 이야기 속 세계의 DJ가 되어 내 사연을 읽고 답해 줍니다."
            : scenario
              ? "적어 준 흐름(설정, 일어나는 순서, 결말)을 따라 비슷하게 방송을 만듭니다. 대본이 아니라 줄거리라, 대사는 인물들이 자기 말투로 채웁니다."
              : "인물들이 이야기 밖으로 잠깐 나와, 지금까지 일을 두고 떠듭니다. 채팅 기억에는 들어가지 않습니다."
        }</p>
        ${editor.hosts
          .map(
            (key, index) =>
              `<div class="sv-call-person"><label class="sv-room-name"><span>${index ? "함께 진행" : story ? "DJ" : "진행"}</span><select data-radio-host="${index}" ${off}>${options(key)}</select></label>${
                index ? `<button type="button" class="sv-call-person-remove" data-radio-host-remove="${index}" aria-label="빼기" title="빼기" ${off}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ""
              }</div>`,
          )
          .join("")}
        ${editor.hosts.length < 3 ? `<button type="button" class="sv-call-person-add" data-radio-host-add ${off}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>진행자 추가</span></button>` : ""}
        <label class="sv-room-name"><span>전화 연결</span><select id="sv-radio-caller" ${off}>${[
          ["auto", "알아서 (어울리면)"],
          ["", "없음"],
          ...contacts.filter((contact) => !editor.hosts.includes(contact.key)).map((contact) => [contact.key, contact.name]),
        ]
          .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === editor.caller ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}</select></label>
        <p class="sv-room-hint">진행자가 아닌 인물이 전화로 연결돼 의견을 말하거나 질문을 받습니다. ‘알아서’는 어울릴 때만.</p>
        ${story ? `<label class="sv-room-name"><span>사연</span><textarea id="sv-radio-story" rows="4" maxlength="2000" placeholder="비워 두면 이야기에 어울리는 사연을 지어냅니다" ${off}>${escapeHtml(editor.story)}</textarea></label><p class="sv-room-hint">익명으로 전달됩니다. 내용에 따라 페르소나라는 걸 눈치챌 수도, 다른 사람으로 여길 수도 있습니다.</p>` : ""}
        ${scenario ? `<label class="sv-room-name"><span>시나리오</span><textarea id="sv-radio-scenario" rows="6" maxlength="2000" placeholder="예: 심야 연애 고민 상담 코너. 누군가의 고민을 들어주다가 자기들끼리 불이 붙어 급히 라디오를 종료한다." ${off}>${escapeHtml(editor.scenario)}</textarea></label>` : ""}
        <label class="sv-room-name"><span>분량</span><select id="sv-radio-length" ${off}>${OVERHEARD_LENGTH_CHOICES.map(([value, label]) => `<option value="${value}" ${value === editor.length ? "selected" : ""}>${escapeHtml(label.split(" (")[0])}</option>`).join("")}</select></label>
        <label class="sv-room-check"><input type="checkbox" id="sv-radio-phone" ${editor.phone ? "checked" : ""} ${off}><span>전화·문자 내용도 참고</span></label>
        <label class="sv-room-check"><input type="checkbox" id="sv-radio-remember" ${editor.remember ? "checked" : ""} ${off}><span>다음 방송이 이 방송을 기억 (라디오끼리만)</span></label>
        <div class="sv-room-actions">
          <button type="button" class="sv-room-save" data-radio-make ${off}>${editor.busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 방송 준비 중…' : "방송 만들기"}</button>
        </div>
      </div>`;
    body.querySelector("#sv-radio-mode").addEventListener("change", (event) => {
      editor.mode = event.target.value;
      this.renderRadioEditor(body);
    });
    body.querySelectorAll("[data-radio-host]").forEach((select) =>
      select.addEventListener("change", () => {
        editor.hosts[Number(select.dataset.radioHost)] = select.value;
        // 전화 연결 lists whoever isn't on air now.
        this.renderRadioEditor(body);
      }),
    );
    body.querySelectorAll("[data-radio-host-remove]").forEach((button) =>
      button.addEventListener("click", () => {
        editor.hosts.splice(Number(button.dataset.radioHostRemove), 1);
        this.renderRadioEditor(body);
      }),
    );
    body.querySelector("[data-radio-host-add]")?.addEventListener("click", () => {
      editor.hosts.push((choices.find((contact) => !editor.hosts.includes(contact.key)) || choices[0]).key);
      this.renderRadioEditor(body);
    });
    body.querySelector("#sv-radio-story")?.addEventListener("input", (event) => {
      editor.story = event.target.value;
    });
    body.querySelector("#sv-radio-scenario")?.addEventListener("input", (event) => {
      editor.scenario = event.target.value;
    });
    body.querySelector("#sv-radio-length").addEventListener("change", (event) => {
      editor.length = event.target.value;
    });
    body.querySelector("#sv-radio-phone").addEventListener("change", (event) => {
      editor.phone = event.target.checked;
    });
    body.querySelector("#sv-radio-caller").addEventListener("change", (event) => {
      editor.caller = event.target.value;
    });
    body.querySelector("#sv-radio-remember").addEventListener("change", (event) => {
      editor.remember = this.radioRememberChoice(event.target.checked);
    });
    body.querySelector("[data-radio-cancel]").addEventListener("click", () => {
      this.radioEditor = null;
      this.renderSmartphone();
    });
    body.querySelector("[data-radio-make]").addEventListener("click", () =>
      this.run(async () => {
        if (editor.busy) return;
        editor.busy = true;
        this.renderRadioEditor(body);
        try {
          const show = await this.writeRadioShow({
            mode: editor.mode,
            hosts: [...new Set(editor.hosts)].map((key) => ({ key })),
            length: editor.length,
            phone: editor.phone,
            story: (editor.mode === "scenario" ? editor.scenario : editor.mode === "story" ? editor.story : "").trim(),
            caller: editor.hosts.includes(editor.caller) ? "auto" : editor.caller,
            remember: editor.remember,
          });
          if (this.radioEditor === editor) this.radioEditor = null;
          this.radioShowOpen = show;
          if (body.isConnected && this.phoneActiveTab === "radio") await this.playRadioShow(body, show);
        } finally {
          editor.busy = false;
          if (this.radioEditor === editor && body.isConnected) this.renderRadioEditor(body);
        }
      }),
    );
  },

  /**
   * ON AIR: a radio set at the top (the lamp, the show's frequency on its dial), the hosts and
   * the title under it, a level meter that moves while a line plays, the line on air.
   */
  renderRadioAir(body, show, run, { ended = false } = {}) {
    const hosts = show.hosts.map((host) => this.radioHost(host));
    const line = ended ? show.lines.at(-1) : run?.ready ? show.lines[run.position] : null;
    const frequency = this.radioFrequency(show);
    const needle = Math.round(((Number(frequency) - 88) / 20) * 1000) / 10;
    const control = (attrs, icon, label, cls) =>
      `<div><button type="button" class="sv-call-end ${cls}" ${attrs} aria-label="${label}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button><small>${label}</small></div>`;
    body.innerHTML = `
      <div class="sv-call-screen sv-radio-air${run?.sounding && !ended ? " sv-radio-live" : ""}${hosts.length > 1 ? " sv-listen-between" : ""}${hosts.length > 2 ? " sv-listen-many" : ""}" data-phone-wallpaper>
        <div class="sv-radio-set" aria-hidden="true">
          <div class="sv-radio-set-top">
            <span class="sv-on-air${ended ? " sv-off-air" : ""}">ON AIR</span>
            <span class="sv-radio-freq"><small>FM</small><b>${frequency}</b><small>MHz</small></span>
          </div>
          <div class="sv-radio-dial"><span>88</span><span>92</span><span>96</span><span>100</span><span>104</span><span>108</span><i style="left: ${needle}%"></i></div>
        </div>
        <div class="sv-call-identity">
          ${hosts.length > 1 ? `<div class="sv-room-avatar" aria-hidden="true">${hosts.map((host) => this.contactAvatarMarkup(host)).join("")}</div>` : this.contactAvatarMarkup(hosts[0])}
          <h2>${escapeHtml(this.radioTitle(show))}</h2>
          <span class="sv-call-state"><span>${ended ? "방송이 끝났습니다" : escapeHtml(hosts.map((host) => host.name).join(", "))}</span></span>
        </div>
        <div class="sv-radio-meter" aria-hidden="true">${"<i></i>".repeat(9)}</div>
        <div class="sv-call-live-line">
          <div class="sv-call-caption" data-radio-caption>${
            line
              ? `<small>${escapeHtml(this.radioSpeaker(line))}</small><p>${escapeHtml(line.text)}</p>${this.translationHtml(line)}`
              : '<p class="sv-call-waiting">주파수를 맞추는 중…</p>'
          }</div>
        </div>
        <div class="sv-call-controls sv-listen-controls">${
          ended
            ? control("data-radio-again", "fa-rotate-left", "다시 듣기", "sv-listen-again") + control("data-radio-back", "fa-file-lines", "대본", "sv-listen-back")
            : `${this.listenStepHtml("data-listen-prev", "fa-backward-step", "앞 대사")}<div><button type="button" class="sv-call-end" data-radio-stop aria-label="그만 듣기" title="그만 듣기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>${this.listenStepHtml("data-listen-next", "fa-forward-step", "다음 대사")}`
        }</div>
      </div>`;
    this.applyPhoneWallpaper?.(body);
    const shell = document.getElementById("sv-smartphone");
    if (shell) shell.dataset.screen = "call";
    const leave = () => {
      this.radioPlaying = null;
      this.radioShowOpen = show;
      if (shell) shell.dataset.screen = "app";
      this.renderSmartphone();
    };
    body.querySelector("[data-listen-prev]")?.addEventListener("click", () => this.listenStep(run, -1, show.lines.length));
    body.querySelector("[data-listen-next]")?.addEventListener("click", () => this.listenStep(run, 1, show.lines.length));
    if (!ended && run) this.syncListenSteps(body, run.position, show.lines.length);
    body.querySelector("[data-radio-stop]")?.addEventListener("click", () => {
      this.stopRadioMusic();
      if (run) {
        run.stopped = true;
        run.wake?.();
        // 듣기 on its page goes on from this line.
        this.radioStopAt = { id: show.id, position: run.position };
      }
      this.stopPlayback();
      leave();
    });
    body.querySelector("[data-radio-again]")?.addEventListener("click", () => this.run(() => this.playRadioShow(body, show)));
    body.querySelector("[data-radio-back]")?.addEventListener("click", () => {
      this.stopRadioMusic();
      leave();
    });
  },

  /**
   * A line's voice: the one kept with it, or made now and kept (so it is made only once).
   * `regenerate` (음성 재생성): a new voice for the same words.
   */
  async radioLineVoice(show, line, index, regenerate = false) {
    if (line.audio_url && !regenerate) return { url: this.apiUrl(line.audio_url), revoke: false, mixed: Boolean(line.sounds_mixed) };
    if (!this.radioLineVoiced(line)) return null;
    const session = { chat_id: show.chat_id, anchor_message_id: show.anchor_message_id, character_key: line.speaker_key, character_name: line.speaker_name };
    const spoken = await this.speakPhoneLine(session, { ...line, role: this.radioLineMine(line) ? "user" : "character", turn_index: index }, regenerate);
    const response = await this.request(`/api/plugins/scenevoice/phone/radio-lines/${encodeURIComponent(line.id)}/audio`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: show.chat_id, generation_id: spoken.mixed?.id || spoken.historyId }),
    }).catch(() => null);
    const kept = response?.ok ? (await response.json()).item?.lines?.find((x) => x.id === line.id) : null;
    if (kept) Object.assign(line, kept);
    return { url: this.createAudioUrl(spoken.mixed?.blob || spoken.blob), revoke: true, mixed: Boolean(spoken.mixed) };
  },

  /** One line on the show's page (its voice made first if it has none); pressed again, it stops. */
  async playRadioLine(body, show, index, button, regenerate = false) {
    const line = show.lines[index];
    if (!line) return;
    if (!regenerate && this.playingTurnId === line.id && this.currentAudio) {
      this.stopPlayback();
      return;
    }
    const unmark = () => {
      body.querySelectorAll(".sv-history-transcript .sv-call-reading").forEach((article) => article.classList.remove("sv-call-reading"));
      body.querySelectorAll(".sv-history-transcript .sv-call-replay.sv-playing").forEach((lit) => lit.classList.remove("sv-playing"));
    };
    this.unlockAudioForMobile();
    let ready;
    if (line.audio_url && !regenerate) ready = await this.radioLineVoice(show, line, index);
    else {
      const icon = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
      try {
        ready = await this.radioLineVoice(show, line, index, regenerate);
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = icon;
        }
      }
      // Drawn again with its voice, so its ↻ shows and the button lit is the one there now.
      if (body.isConnected && body.querySelector(".sv-radio-detail")) this.renderRadioShow(body, show);
    }
    const lit = body.querySelector(`[data-radio-line-play="${index}"]`);
    const done = () => {
      if (this.playingTurnId === line.id) {
        this.playingTurnId = "";
        unmark();
      }
    };
    unmark();
    this.playingTurnId = line.id;
    body.querySelector(`.sv-history-transcript article[data-index="${index}"]`)?.classList.add("sv-call-reading");
    this.playWithSounds(ready.url, line.script, lit, ready.revoke, {
      mixed: ready.mixed,
      communicationFilter: this.shouldApplyCommunicationFilter("radio"),
      // A caller comes down the phone line; the hosts sound like the radio.
      radio: !line.caller,
      onEnded: done,
      onStop: done,
    });
  },

  /** 고치기 on a line: new words (and tags); a line that had a voice gets its new one at once. */
  async editRadioLine(body, show, index) {
    const line = show.lines[index];
    if (!line) return;
    const sheet = await this.openLineSheet({ value: line.script || line.text, translation: line.translation });
    if (sheet === null) return;
    const edit = this.spokenEdit(sheet.value);
    if (!edit.text) throw new Error("대사를 비울 수는 없습니다.");
    const { changed, words, translation } = this.sheetChanges(line, edit, sheet);
    if (!changed) return;
    const response = await this.request(`/api/plugins/scenevoice/phone/radio-lines/${encodeURIComponent(line.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: show.chat_id, ...edit, translation }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "대사를 고치지 못했습니다.");
    // Only new words need a new voice; a translation alone changes nothing heard.
    const voiced = Boolean(line.audio_url) && words;
    const current = data.item;
    if (this.radioShowOpen?.id === current.id) this.radioShowOpen = current;
    if (!body.isConnected || !body.querySelector(".sv-radio-detail")) return;
    this.renderRadioShow(body, current);
    if (voiced) await this.playRadioLine(body, current, index, body.querySelector(`[data-radio-line-play="${index}"]`));
  },

  /** The music, decoded once (null when the file isn't there). */
  async radioMusic(context) {
    if (this.radioMusicBuffer !== undefined) return this.radioMusicBuffer;
    try {
      const response = await fetch(MUSIC_URL);
      if (!response.ok) throw new Error(String(response.status));
      const bytes = await response.arrayBuffer();
      this.radioMusicBuffer = await new Promise((resolve, reject) => context.decodeAudioData(bytes, resolve, reject));
    } catch {
      this.radioMusicBuffer = null;
    }
    return this.radioMusicBuffer;
  },

  /**
   * The music under the show, from `from` seconds into it, following `levels` ([seconds, level]
   * from now) and ending with them; `hold`: it stays at the last level until `follow` gives it
   * more. Played through Web Audio, so its fades work on iPhones too.
   */
  radioBed(context, music, from, levels, { hold = false } = {}) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = music;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain).connect(context.destination);
    source.start(0, from % music.duration);
    const bed = {
      follow(points) {
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        for (const [time, level] of points) gain.gain.linearRampToValueAtTime(level, now + time);
        try {
          source.stop(now + (points.at(-1)?.[0] ?? 0) + 0.1);
        } catch {
          /* already stopping */
        }
      },
      stop: () => bed.follow([[0.3, 0]]),
    };
    if (hold) {
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      for (const [time, level] of levels) gain.gain.linearRampToValueAtTime(level, now + time);
    } else bed.follow(levels);
    (this.radioBeds ||= []).push(bed);
    return bed;
  },

  stopRadioMusic() {
    for (const bed of this.radioBeds || []) bed.stop();
    this.radioBeds = [];
  },

  /** Played in order from `from`, two voices made ahead; ‹ › go to the line before or after. */
  async playRadioShow(body, show, from = 0) {
    if (this.radioPlaying) {
      this.radioPlaying.stopped = true;
      this.radioPlaying.wake?.();
      this.stopPlayback();
    }
    this.stopRadioMusic();
    if (this.radioStopAt?.id === show.id) this.radioStopAt = null;
    const operation = this.captureChat();
    const count = show.lines.length;
    const start = Math.max(0, Math.min(from, count - 1));
    const run = (this.radioPlaying = { show, position: start, stopped: false, ready: false, sounding: false, next: null });
    const over = () => run.stopped || operation.signal.aborted || this.radioPlaying !== run;
    const screen = () => body.querySelector(".sv-radio-air");
    this.unlockAudioForMobile();
    const context = this.ensureAudioContext();
    const musicReady = context ? this.radioMusic(context) : Promise.resolve(null);
    this.renderRadioAir(body, show, run);
    const made = [];
    const settled = new Set();
    const prepare = (index) =>
      index < count
        ? (made[index] ||= this.radioLineVoice(show, show.lines[index], index)
            .catch(() => null)
            .finally(() => settled.add(index)))
        : null;
    const sounding = (on) => {
      run.sounding = on;
      screen()?.classList.toggle("sv-radio-live", on);
    };
    let outro = null;
    try {
      let index = start;
      while (index < count && !over()) {
        run.position = index;
        run.next = null;
        if (!settled.has(index)) {
          sounding(false);
          await Promise.all([prepare(index), prepare(index + 1)]);
        }
        const ready = await prepare(index);
        prepare(index + 1);
        prepare(index + 2);
        if (over()) break;
        const music = await musicReady;
        // From the top: the music first, the hosts coming in over it.
        if (index === 0 && run.next === null && music && !run.introDone) {
          run.introDone = true;
          this.radioBed(context, music, 0, introLevels());
          await this.listenWait(run, MUSIC_LEAD * 1000);
          if (over()) break;
        }
        run.ready = true;
        const view = screen();
        const line = show.lines[index];
        const caption = view?.querySelector("[data-radio-caption]");
        if (caption) caption.innerHTML = `<small>${escapeHtml(this.radioSpeaker(line))}</small><p>${escapeHtml(line.text)}</p>${this.translationHtml(line)}`;
        if (view) this.syncListenSteps(view, index, count);
        // The sign-off: the music comes back in under it.
        const last = index === count - 1;
        if (last && music && !outro && run.next === null) outro = this.radioBed(context, music, MUSIC_OUTRO_FROM, [[1.5, MUSIC_UNDER]], { hold: true });
        // My character's line without a voice (my persona has none) stays up to be read.
        if (!ready && run.next === null) await this.listenWait(run, Math.min(6, 1.2 + Array.from(line.text || "").length * 0.07) * 1000);
        if (ready && run.next === null) {
          sounding(true);
          // Kept until the end (‹ can play it again); let go below.
          await new Promise((resolve) =>
            this.playWithSounds(ready.url, line.script, null, false, {
              mixed: ready.mixed,
              communicationFilter: this.shouldApplyCommunicationFilter("radio"),
              radio: !line.caller,
              onEnded: resolve,
              onStop: () => {
                if (run.next === null) run.stopped = true;
                resolve();
              },
            }),
          );
        }
        if (over()) break;
        if (run.next !== null) {
          // Left the last line: its music goes.
          if (outro) {
            outro.stop();
            outro = null;
          }
          index = run.next;
          continue;
        }
        if (last) {
          outro?.follow(OUTRO_AFTER);
          outro = null;
        } else await this.listenWait(run, LINE_GAP * 1000);
        index = run.next ?? index + 1;
      }
    } finally {
      for (const clip of made) clip?.then((ready) => ready?.revoke && URL.revokeObjectURL(ready.url));
      if (over()) this.stopRadioMusic();
      run.ended = true;
      run.sounding = false;
      if (this.radioPlaying === run && !operation.signal.aborted && this.phoneActiveTab === "radio")
        this.renderRadioAir(body, show, run, { ended: true });
      this.updatePhoneReturn?.();
    }
  },

  /**
   * The show's voices in order for a file (with the radio sound where it is on). Lines without
   * one are made only if the user agrees (voice credits).
   */
  async radioClips(show, onStep = () => {}, { captions = false } = {}) {
    const lacking = show.lines.filter((line) => !line.audio_url && this.radioLineVoiced(line)).length;
    const make =
      lacking > 0 && confirm(`대사 ${lacking}개는 아직 목소리가 없습니다. 만들어서 함께 넣으시겠습니까?\n취소하면 그 대사는 빠집니다.`);
    const filter = this.shouldApplyCommunicationFilter("radio");
    const clips = [];
    for (const [index, line] of show.lines.entries()) {
      onStep(index, show.lines.length);
      const turn = { ...line, role: this.radioLineMine(line) ? "user" : "character" };
      if (!this.radioLineVoiced(line)) {
        if (captions) clips.push({ silent: true, turn });
        continue;
      }
      if (!line.audio_url && !make) continue;
      const ready = await this.radioLineVoice(show, line, index).catch(() => null);
      if (ready) clips.push({ url: ready.url, revoke: ready.revoke, turn, filter, radio: !line.caller });
    }
    return { clips, left: show.lines.length - clips.length };
  },

  /** How a show's file is laid out (gaps, room for the music) and the music mixed into it. */
  async radioTrackOptions(context) {
    const music = await this.radioMusic(context);
    if (!music) return { gap: LINE_GAP };
    return {
      gap: LINE_GAP,
      lead: MUSIC_LEAD,
      tail: MUSIC_TAIL,
      mix: (data, rate, lines) => {
        if (!lines.length) return;
        const source = music.getChannelData(0);
        const level = (points, time) => {
          let before = [0, 0];
          for (const point of points) {
            if (time <= point[0]) return before[1] + ((point[1] - before[1]) * (time - before[0])) / Math.max(1e-6, point[0] - before[0]);
            before = point;
          }
          return before[1];
        };
        const lay = (at, from, points) => {
          const until = Math.min(data.length, Math.round((at + points.at(-1)[0]) * rate));
          for (let i = Math.max(0, Math.round(at * rate)); i < until; i++) {
            const time = i / rate - at;
            data[i] += source[Math.floor((from + time) * music.sampleRate) % source.length] * level(points, time);
          }
        };
        lay(lines[0].start - MUSIC_LEAD, 0, introLevels());
        const last = lines.at(-1);
        lay(last.start, MUSIC_OUTRO_FROM, outroLevels(last.end - last.start));
        // Kept from clipping where the music meets a loud line.
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value));
        if (peak > 0.98) for (let i = 0; i < data.length; i++) data[i] *= 0.98 / peak;
      },
    };
  },

  async downloadRadio(show) {
    const { clips, left } = await this.radioClips(show);
    try {
      if (!clips.length) throw new Error("내려받을 음성이 없습니다.");
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const context = new Offline(1, 1, 24000);
      const { track } = await this.callVideoTrack(clips, context, await this.radioTrackOptions(context));
      this.saveFile(wavFromParts([pcm16(track.getChannelData(0))], track.sampleRate), `${this.radioFileName(show)}.wav`);
    } finally {
      for (const clip of clips) if (clip.revoke) URL.revokeObjectURL(clip.url);
    }
    if (left) this.notify(`목소리가 없는 대사 ${left}개는 빠졌습니다.`, "info");
  },

  /** 영상: the ON AIR screen with the show's voices and captions. */
  downloadRadioVideo(show) {
    const hosts = show.hosts;
    return this.makeRecordingVideo({
      heading: "라디오 영상 만들기",
      scene: {
        call_direction: "radio",
        // My character's picture is my persona's.
        character_key: hosts[0]?.key === "user" ? this.personaKey() : hosts[0]?.key,
        character_name: hosts[0]?.name,
        others: hosts.slice(1).map((host) => ({ key: host.key === "user" ? this.personaKey() : host.key, name: host.name })),
        radio_title: this.radioTitle(show),
        radio_frequency: this.radioFrequency(show),
      },
      gather: (onStep) => this.radioClips(show, onStep, { captions: true }),
      trackOptions: (context) => this.radioTrackOptions(context),
      name: this.radioFileName(show),
    });
  },
};
