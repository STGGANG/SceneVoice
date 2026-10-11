// 화자 설정 (캐릭터별 목소리): bot cards, the people under them and global people, each
// with their voice, language, gender and switches.
import { escapeHtml, contentKey, LANGUAGE_CHOICES } from "./common.js";
import { fieldHtml, switchHtml, infoTip } from "./ui.js";
import { cardHoldsPerson, cardStandIn } from "../shared/casting.js";
import { voicePickHtml } from "./voice-picker.js";
export const casting = {
  /** Who may speak a line here: the chat's cards that are people, their people, and global people. */
  speakerCatalog() {
    const voices = this.config.character_voices || {};
    const cards = this.currentCardKeys();
    const result = cards
      .filter((key) => voices[key]?.single_voice || this.cardIsPerson(key))
      .map((key) => ({
        key,
        name: voices[key]?.name || this.cardInfo(key).name,
        aliases: voices[key]?.aliases || "",
      }));
    for (const [key, value] of Object.entries(voices)) {
      if (cards.includes(key) || key.startsWith("character:")) continue;
      if (value?.card && !cards.includes(value.card)) continue;
      // A global person speaks only in the bot cards it is switched on for.
      if (key.startsWith("speaker:") && !value?.card && !this.globalInUse(value || {}, cards)) continue;
      result.push({ key, name: value?.name || key, aliases: value?.aliases || "" });
    }
    return result;
  },
  speakerAnalysisContext(utterances = []) {
    const context = window.SillyTavern?.getContext?.() || {};
    const characters = new Map(
      (context.characters || []).map((x) => [`character:${x.avatar}`, x]),
    );
    const roster = new Map(this.speakerCatalog().map((x) => [x.key, x]));
    for (const line of utterances) {
      for (const key of [line.default_speaker_key, line.forced_speaker_key]) {
        if (key && !roster.has(key))
          roster.set(key, {
            key,
            name:
              key === "user"
                ? context.name1 || "사용자"
                : characters.get(key)?.name || key,
            aliases: "",
          });
      }
    }
    return [...roster.values()].map((item) => {
      const voice = this.config.character_voices?.[item.key];
      const engine =
        voice?.engine && voice.engine !== "inherit"
          ? voice.engine
          : this.config.engine;
      // A person registered under a card shares that card's description.
      const card =
        characters.get(item.key) || characters.get(voice?.card || "");
      return {
        key: item.key,
        name: item.name,
        aliases: item.aliases || "",
        engine,
        model: this.config[engine]?.model || "",
        performance_note: String(this.config.character_notes?.[item.key] || ""),
        range: voice?.expressiveness || "normal",
        description: String(
          item.key === "user"
            ? this.config.llm?.analysis_include_persona
              ? context.powerUserSettings?.persona_description || ""
              : ""
            : card?.data?.description || card?.description || "",
        ),
      };
    });
  },
  messageSpeaker(button) {
    const context = window.SillyTavern?.getContext?.() || {};
    const message = context.chat?.[Number(button.dataset.messageId)];
    if (message?.is_user) {
      const key = this.personaKey();
      return {
        key,
        name: this.config.character_voices?.[key]?.name || context.name1 || "사용자",
      };
    }
    const characters = context.characters || [];
    const matches = characters.filter((character) =>
      message?.original_avatar
        ? character.avatar === message.original_avatar
        : character.name === message?.name,
    );
    if (matches.length === 1)
      return { key: `character:${matches[0].avatar}`, name: matches[0].name };
    return this.getCurrentCharacterProfile();
  },
  resolvedSpeaker(button, analysis) {
    const fallback = this.messageSpeaker(button);
    const key =
      button.dataset.speakerOverride || analysis?.speaker_key || fallback.key;
    const profile = this.config.character_voices?.[key];
    return {
      key,
      name: profile?.name || (key === fallback.key ? fallback.name : key),
    };
  },
  createSpeakerControl(button) {
    const select = document.createElement("select");
    select.className = "sv-speaker-select";
    select.title = "이 대사를 읽을 캐릭터";
    select.setAttribute("aria-label", "대사 화자 선택");
    const fallback = this.messageSpeaker(button),
      catalog = this.speakerCatalog();
    if (!catalog.some((item) => item.key === fallback.key))
      catalog.unshift(fallback);
    select.append(
      new Option(
        // What the analysis said, when the line was analysed before its menu was made.
        button.dataset.speakerLabel ||
          `자동 · ${fallback.name}${button.dataset.kind === "thought" ? " · 생각" : ""}`,
        "",
      ),
      ...catalog.map((item) => new Option(item.name, item.key)),
    );
    select.value = button.dataset.speakerOverride || "";
    select.addEventListener("change", () => {
      this.cancelLineAudio(button);
      const value = select.value;
      button.dataset.speakerOverride = value;
      if (value)
        select
          .closest(".sv-inline-actions")
          ?.querySelector(".sv-more-btn")
          ?.classList.remove("sv-attention");
      this.run(() =>
        this.saveLineEdit(button, value ? { speaker_key: value } : {}),
      );
      button.title = select.value ? "지정한 화자로 생성" : "문맥에서 화자 분석";
    });
    return select;
  },
  cancelLineAudio(button) {
    if (
      button.dataset.status === "generating" ||
      button.dataset.status === "queued"
    )
      this.cancelPending();
    if (button.dataset.audioUrl?.startsWith("blob:"))
      URL.revokeObjectURL(button.dataset.audioUrl);
    delete button.dataset.audioUrl;
    button.dataset.status = "waiting";
    button.classList.remove("sv-ready", "sv-error");
    this.setPlayButtonIcon(button, "waiting");
  },
  /** Card picker plus the editor for that card's own voice and the people registered under it. */
  renderCastingSettings() {
    const root = document.getElementById("sv-casting-settings");
    if (!root) return;
    const context = window.SillyTavern?.getContext?.() || {};
    this.voiceDraft = structuredClone(this.config.character_voices || {});
    this.noteDraft = structuredClone(this.config.character_notes || {});
    const cards = new Map(
      (context.characters || [])
        .filter((x) => x.avatar)
        .map((x) => [`character:${x.avatar}`, String(x.name || x.avatar)]),
    );
    const current = this.currentCardKeys();
    for (const key of current)
      if (!cards.has(key)) cards.set(key, this.cardInfo(key).name);
    for (const [key, entry] of Object.entries(this.voiceDraft))
      if (key.startsWith("character:") && !cards.has(key))
        cards.set(key, entry.name || key);
    this.castCards = cards;
    const count = (key) => this.castMembers(key).length;
    const option = (key) =>
      `<option value="${escapeHtml(key)}">${escapeHtml(cards.get(key))}${count(key) ? ` · 인물 ${count(key)}` : ""}</option>`;
    const others = [...cards.keys()]
      .filter((key) => !current.includes(key))
      .sort((a, b) => cards.get(a).localeCompare(cards.get(b), "ko"));
    root.innerHTML = `${fieldHtml({
      id: "sv-cast-character",
      label: "봇카드",
      control: `<select id="sv-cast-character">
        <optgroup label="${current.length > 1 ? "현재 그룹 채팅" : "현재 채팅"}">${current.map(option).join("")}</optgroup>
        <optgroup label="다른 봇카드">${others.map(option).join("")}</optgroup>
      </select>`,
    })}
      ${
        this.multicastApi?.()?.getCast
          ? `<div class="sv-multicast-import">${switchHtml({
              id: "sv-multicast-sync",
              label: "MultiCast 확장 출연진 자동 연동",
              hint: "MultiCast 확장의 인물을 가져오고, MultiCast 확장에서 고치거나 지우면 따라갑니다.",
              tip: "채팅·스마트폰·설정을 열 때 맞춥니다. 바로 맞추려면 ‘재연동’을 누르세요.",
              extra: '<button type="button" class="sv-mini-btn" data-cast-multicast title="지금 MultiCast 확장과 다시 맞춥니다" aria-label="재연동"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i><span>재연동</span></button>',
              checked: this.config.casting?.multicast_sync !== false,
            })}</div>`
          : ""
      }
      <div id="sv-cast-panel"></div>`;
    const select = root.querySelector("#sv-cast-character");
    this.editingCard = current[0];
    select.value = this.editingCard;
    select.addEventListener("change", () => {
      this.editingCard = select.value;
      this.renderCastPanel();
    });
    root.addEventListener("input", (event) => this.onCastInput(event));
    root.addEventListener("change", (event) => this.onCastInput(event));
    root.addEventListener("click", (event) => this.onCastClick(event));
    root.addEventListener("keydown", (event) => {
      if (event.target.id !== "sv-cast-new") return;
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      root.querySelector("#sv-cast-add")?.click();
    });
    this.renderCastPanel();
  },

  /** People registered under a card, or the shared people for "__shared__". */
  castMembers(cardKey) {
    return Object.entries(this.voiceDraft || {})
      .filter(([key, entry]) =>
        cardKey === "__shared__"
          ? !entry?.card && !key.startsWith("character:") && key !== "user"
          : entry?.card === cardKey && key !== cardKey,
      )
      .map(([key]) => key);
  },

  castDefaultName(key) {
    if (key === "user")
      return window.SillyTavern?.getContext?.()?.name1 || "사용자";
    return this.castCards?.get(key) || this.cardInfo(key).name;
  },

  castVoiceFields(prefix, entry, { member = false } = {}) {
    const id = (field) => `${prefix}-${field}`;
    const fishAvailable = this.availableEngines.includes("fish");
    return `<div class="sv-row sv-row-3">
        ${fieldHtml({ id: id("engine"), label: "엔진", control: `<select id="${id("engine")}" data-field="engine"><option value="inherit">${member ? "봇카드 기본 따라감" : "기본 엔진 사용"}</option><option value="fish" ${fishAvailable ? "" : "disabled"}>Fish Audio</option><option value="elevenlabs">ElevenLabs</option></select>` })}
        ${fieldHtml({ id: id("voice"), label: "대사 목소리", tip: "내 ElevenLabs 보이스 목록에서 이름으로 고릅니다. 목록에 없는 목소리나 Fish Audio의 Reference ID는 칸에 붙여 넣으면 됩니다.", control: voicePickHtml({ id: id("voice"), field: "voice_id", value: entry.voice_id || "", label: this.voiceName(entry.voice_id) || entry.voice_id || "", placeholder: member ? "비우면 봇카드 기본 목소리" : "비우면 성별에 맞는 기본 목소리", empty: member ? "비우기 · 봇카드 기본 목소리" : "비우기 · 성별에 맞는 기본 목소리" }) })}
        ${fieldHtml({ id: id("thought"), label: "생각 목소리", control: voicePickHtml({ id: id("thought"), field: "thought_voice_id", value: entry.thought_voice_id || "", label: this.voiceName(entry.thought_voice_id) || entry.thought_voice_id || "", placeholder: "비우면 대사와 같은 목소리", empty: "비우기 · 대사와 같은 목소리" }) })}
      </div>
      <div class="sv-row">
        ${fieldHtml({ id: id("gender"), label: "성별", tip: "목소리를 정하지 않았을 때 남성·여성 기본 목소리 중 무엇을 쓸지 정합니다. ‘자동’이면 보조모델이 추정합니다.", control: `<select id="${id("gender")}" data-field="gender"><option value="" ${!entry.gender ? "selected" : ""}>자동</option><option value="male" ${entry.gender === "male" ? "selected" : ""}>남성</option><option value="female" ${entry.gender === "female" ? "selected" : ""}>여성</option></select>` })}
        ${fieldHtml({ id: id("always"), label: "항상 붙일 태그", tip: "이 인물의 모든 대사 앞에 늘 붙는 태그입니다(4개까지). 목소리 결을 고정할 때 씁니다.", control: `<input id="${id("always")}" data-field="always_tags" value="${escapeHtml(Array.isArray(entry.always_tags) ? entry.always_tags.map((tag) => `[${tag}]`).join("") : entry.always_tags || "")}" placeholder="[husky][breathy] 또는 husky, breathy" autocomplete="off" spellcheck="false">` })}
      </div>`;
  },

  castRateField(id, entry) {
    const rate = Number.isFinite(Number(entry.contact_rate)) ? Number(entry.contact_rate) : 50;
    const choices = [
      [10, "거의 안 함 · 10%"],
      [30, "가끔 · 30%"],
      [50, "보통 · 50%"],
      [70, "자주 · 70%"],
      [90, "매우 자주 · 90%"],
    ];
    if (!choices.some(([value]) => value === rate)) choices.push([rate, `직접 지정 · ${rate}%`]);
    return fieldHtml({
      id,
      label: "먼저 연락하는 빈도",
      tip: "상태를 갱신할 때 보조모델이 ‘지금 이 인물이 먼저 연락할 만하다’고 판단하면, 이 확률로 실제 연락합니다(10%면 상황이 맞아도 열 번에 한 번꼴).\n실제 확률 = 빈도 × 긴급도(낮음 ×0.85 · 보통 ×1 · 높음 ×1.6) × 바쁨이면 ×0.5, 최대 95%. 예: 매우 자주(90%)에 긴급도 높음이면 95%, 그 인물이 바쁘면 72%.\n함께 있거나 자는 중이면 연락하지 않습니다. 바쁨·자는 중 여부는 상태 탭에 보이는 그 인물의 상태를 따릅니다.\n사람마다 따로 판단하고, 여럿이 걸리면 전화는 확률이 가장 높은 한 명만, 한 번에 최대 두 명까지 연락합니다. 최근(상태 갱신 두 번 안)에 먼저 연락한 사람은 급한 일이 아니면 확률이 절반입니다(연락할 수 있는 인물이 한 명뿐이면 깎지 않음).",
      control: `<select id="${id}" data-field="contact_rate">${choices.map(([value, label]) => `<option value="${value}" ${value === rate ? "selected" : ""}>${label}</option>`).join("")}</select>`,
    });
  },

  castRangeField(id, entry) {
    const choices = [
      ["very_restrained", "아주 절제 · 무슨 일이 있어도 담담하게"],
      ["restrained", "절제 · 큰 순간에도 담담하게"],
      ["", "기본 · 따로 정하지 않음"],
      ["expressive", "풍부 · 감정을 잘 드러냄"],
      ["very_expressive", "격정적 · 감정을 크게 터뜨림"],
    ];
    const value = entry.expressiveness || "";
    return fieldHtml({
      id,
      label: "감정 표현",
      tip: [
        "기본은 따로 정하지 않은 상태입니다. 보조모델이 말투 메모와 성격을 보고 감정을 얼마나 드러낼지 판단하고, 엔진 값도 그대로 둡니다.",
        "다른 단계를 고르면 그 폭을 우선해 지키고, 엔진의 연기 일관성도 함께 움직입니다. 절제면 화가 나도 [angry] 대신 [quietly irritated]처럼 드러나는 만큼만 붙입니다.",
      ].join("\n"),
      control: `<select id="${id}" data-field="expressiveness">${choices.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select>`,
    });
  },

  castLanguageField(id, entry) {
    const choices = [["", "자동 · 대화 언어 따라가기"], ...LANGUAGE_CHOICES];
    const value = entry.language || "";
    return fieldHtml({
      id,
      label: "통화·메시지 언어",
      tip: "정해 두면 내가 어떤 언어로 보내도 이 인물은 이 언어로 전화·문자에 답합니다. ‘자동’이면 대화 언어를 따릅니다.",
      control: `<select id="${id}" data-field="language">${choices.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select>`,
    });
  },

  castMemberHtml(key, index, open = false) {
    const entry = this.voiceDraft[key] || {};
    const prefix = `sv-member-${index}`;
    const initial = Array.from(String(entry.name || "?").trim())[0] || "?";
    // The same picture as on the phone and the 상태 tab (the card's own for its namesake).
    const avatar = entry.avatar || this.defaultAvatar?.(key) || "";
    // A global person (a persona too: my voice there) is switched on or off for this bot card
    // right on its row.
    const usable = !entry.card && this.editingCard?.startsWith("character:");
    // Kept in step with MultiCast: changed and deleted there.
    // The switch as it stands in the panel, saved or not.
    const syncOn =
      document.getElementById("sv-multicast-sync")?.checked ?? this.config.casting?.multicast_sync !== false;
    const synced = Boolean(entry.multicast_id && syncOn && this.multicastApi?.());
    const used = usable && this.globalInUse(entry, [this.editingCard]);
    return `<details class="sv-member ${usable && !used ? "sv-member-off" : ""}" data-key="${escapeHtml(key)}" ${open ? "open" : ""}>
      <summary>
        <span class="sv-member-avatar" aria-hidden="true">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span>
        <span class="sv-member-main"><strong data-member-label>${escapeHtml(entry.name || "이름 없음")}</strong><small data-member-sub>${escapeHtml(this.castMemberSummary(entry))}</small></span>
        ${usable ? `<label class="sv-use-chip" title="${entry.persona ? "켜면 이 봇카드에서 내 메시지와 문자를 이 목소리로 읽습니다" : "켜면 이 봇카드의 화자 후보·연락처·상태 추적에 들어갑니다"}"><input type="checkbox" class="sv-switch" data-field="use_here" ${used ? "checked" : ""}><span>이 봇카드에서 사용</span></label>` : ""}
        <i class="fa-solid fa-chevron-down sv-member-chevron" aria-hidden="true"></i>
      </summary>
      <div class="sv-member-body">
        ${synced ? '<div class="sv-notice"><i class="fa-solid fa-link" aria-hidden="true"></i><span>MultiCast 확장과 연동된 인물입니다. 목소리·성별·항상 붙일 태그·연기 메모·감정 표현은 MultiCast에서 정하고, 지우려면 MultiCast에서 지우세요. 여기서는 아래 항목만 추가 지정 가능합니다.</span></div>' : ""}
        <div class="sv-row sv-row-3">
          ${fieldHtml({ id: `${prefix}-name`, label: "이름", control: `<input id="${prefix}-name" data-field="name" maxlength="120" value="${escapeHtml(entry.name || "")}" autocomplete="off">` })}
          ${fieldHtml({ id: `${prefix}-aliases`, label: "별명·다른 표기", control: `<input id="${prefix}-aliases" data-field="aliases" maxlength="600" value="${escapeHtml(entry.aliases || "")}" placeholder="쉼표로 구분: 사토루, Gojo, 선생님" autocomplete="off">` })}
          ${fieldHtml({ id: `${prefix}-role`, label: "역할", tip: "페르소나는 내가 연기하는 인물입니다. 내 메시지와 내가 보낸 문자를 이 목소리로 읽고, 스마트폰 연락처·상태 추적에서는 빠집니다.", control: `<select id="${prefix}-role" data-field="persona"><option value="">등장인물</option><option value="persona" ${entry.persona ? "selected" : ""}>페르소나(내 캐릭터)</option></select>` })}
        </div>
        ${
          synced
            ? ""
            : `<hr class="sv-divider">
        ${this.castVoiceFields(prefix, entry, { member: Boolean(entry.card) })}
        ${fieldHtml({ id: `${prefix}-note`, label: "말투·연기 메모", control: `<textarea id="${prefix}-note" data-field="note" rows="3" maxlength="4000" placeholder="이 인물의 말투·억양·감정 표현 습관&#10;예: 감정 표현이 크지 않다. 화가 나도 고함보다 단호하고 침착한 목소리로 말한다.">${escapeHtml(this.noteDraft[key] || "")}</textarea>` })}`
        }
        <div class="sv-row">${synced ? "" : this.castRangeField(`${prefix}-range`, entry)}${this.castLanguageField(`${prefix}-language`, entry)}${synced && !entry.persona ? this.castRateField(`${prefix}-rate`, entry) : ""}</div>
        ${entry.persona || synced ? "" : `<div class="sv-row">${this.castRateField(`${prefix}-rate`, entry)}</div>`}
        <hr class="sv-divider">
        <div class="sv-member-foot">
          <span class="sv-member-checks">
            ${entry.persona ? "" : `<label class="sv-check"><input type="checkbox" data-field="no_state" ${entry.no_state ? "checked" : ""}><span>상태 분석에서 제외 (먼저 전화·문자 X)</span>${infoTip("이 인물의 상태를 추적하지 않고, 먼저 전화·문자를 보내지도 않습니다. 내가 거는 건 가능합니다.", "상태 분석 제외 설명")}</label>`}
            <label class="sv-check sv-chat-only"><input type="checkbox" data-field="skip_voice" ${entry.skip_voice ? "checked" : ""}><span>음성 준비·이어 듣기에서 건너뛰기</span>${infoTip("메시지의 ‘음성 준비’와 이어 듣기에서 이 인물의 대사를 빼고 만듭니다. 재생 버튼을 직접 누르면 만들 수 있습니다.", "음성 준비 건너뛰기 설명")}</label>
            <label class="sv-check sv-chat-only"><input type="checkbox" data-field="hide_button" ${entry.hide_button ? "checked" : ""}><span>대사 옆 버튼 숨기기</span>${infoTip("이 인물의 대사 옆 버튼을 숨깁니다. 화자가 정해진 뒤부터 숨겨지고, 음성 준비·이어 듣기에서도 빠집니다.", "대사 옆 버튼 숨기기 설명")}</label>
          </span>
          <span class="sv-actions">
            ${this.castMoveButton(entry)}
            ${synced ? "" : '<button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-member-remove><i class="fa-solid fa-user-xmark" aria-hidden="true"></i><span>인물 삭제</span></button>'}
          </span>
        </div>
      </div>
    </details>`;
  },

  /** A person moves between this card and the global list. */
  castMoveButton(entry) {
    if (entry.card)
      return '<button type="button" class="sv-btn sv-btn-ghost sv-btn-sm" data-member-move=""><i class="fa-solid fa-globe" aria-hidden="true"></i><span>글로벌로 옮기기</span></button>';
    const target = this.editingCard?.startsWith("character:")
      ? this.editingCard
      : this.currentCardKeys().find((key) => key.startsWith("character:"));
    return target
      ? `<button type="button" class="sv-btn sv-btn-ghost sv-btn-sm" data-member-move="${escapeHtml(target)}"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i><span>${escapeHtml(this.castDefaultName(target))} 봇카드로 옮기기</span></button>`
      : "";
  },

  castMemberSummary(entry) {
    const language = Object.fromEntries(LANGUAGE_CHOICES)[entry.language];
    return [
      entry.aliases || "별명 없음",
      entry.voice_id ? "목소리 지정됨" : "기본 목소리",
      ...(language ? [language] : []),
      ...(entry.persona ? ["페르소나"] : []),
      ...(entry.multicast_id ? ["MultiCast 확장 연동"] : []),
      ...(entry.skip_voice || entry.hide_button ? ["음성 건너뜀"] : []),
    ].join(" · ");
  },

  renderCastPanel(openKey = "") {
    const panel = document.getElementById("sv-cast-panel");
    if (!panel) return;
    const cardKey = this.editingCard;
    const ownerKey = cardKey;
    const entry = this.voiceDraft[ownerKey] || {};
    const members = this.castMembers(cardKey);
    const globals = this.castMembers("__shared__");
    const contact = this.cardInfo(cardKey);
    const name = this.castDefaultName(cardKey);
    const single = entry.single_voice === true;
    const loreOn = this.loreChoice?.(cardKey, this.loreDraft || this.config.phone?.world_info_choice).enabled === true;
    const standIn = cardStandIn(this.voiceDraft, cardKey, [entry.name, contact.name]);
    const avatar = this.contactAvatarMarkup({ name: contact.name, avatarUrl: contact.avatarUrl });
    let index = 0;
    const list = (keys, empty) =>
      keys.map((key) => this.castMemberHtml(key, index++, key === openKey)).join("") ||
      `<div class="sv-member-empty"><p class="sv-hint">${empty}</p></div>`;
    const adopt = `<button type="button" class="sv-btn sv-btn-sm" data-cast-adopt><i class="fa-solid fa-user-plus" aria-hidden="true"></i><span>‘${escapeHtml(name)}’ 인물로 추가</span></button>`;
    // The one voice of a card set to one voice.
    const ownVoice = `${this.castVoiceFields("sv-cast", entry)}
        <div class="sv-row">${this.castRangeField("sv-cast-range", entry)}</div>
        ${fieldHtml({ id: "sv-cast-note", label: "말투·연기 메모", tip: "보조모델이 이 화자의 대사를 분석할 때 참고합니다. 소리 내어 읽지 않습니다.", control: `<textarea id="sv-cast-note" data-field="note" rows="3" maxlength="4000" placeholder="이 인물의 말투·억양·감정 표현 습관&#10;예: 감정 표현이 크지 않다. 화가 나도 고함보다 단호하고 침착한 목소리로 말한다.">${escapeHtml(this.noteDraft[ownerKey] || "")}</textarea>` })}`;
    panel.innerHTML = `
      <div class="sv-cast-card" data-key="${escapeHtml(ownerKey)}">
        <div class="sv-cast-head">
          ${avatar}
          <div class="sv-cast-title"><strong>${escapeHtml(name)}</strong><small>봇카드 공통 설정</small></div>
        </div>
        ${switchHtml({ id: "sv-cast-realtime", label: "실제 시간 인식 (전화·문자)", hint: "켜면 이 봇카드의 인물들이 전화·문자에서 지금 날짜와 시각을 압니다.", tip: "밤늦은 시간, 주말, 메시지 사이에 흐른 시간처럼 실제 시각을 대화에 자연스럽게 반영합니다. 통화·문자 기록에도 시각이 남습니다.", checked: entry.realtime === true, attrs: 'data-field="realtime"' })}
        ${switchHtml({ id: "sv-cast-lore", label: "월드인포 참고 (전화·문자)", hint: "고른 월드인포 항목을 통화·문자 AI 요청에 맥락 참고용으로 보냅니다.", tip: "참고할 월드인포와 항목을 고릅니다. 상시 항목은 늘, 키워드 항목은 그 키워드가 최근 채팅이나 지금 통화·문자에 나올 때만 보냅니다. 이상한 지시가 든 항목은 꺼 두세요. 대필에도 씁니다.", checked: loreOn })}
        <details class="sv-lore-fold" ${loreOn ? "" : "hidden"}><summary><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>참고할 월드인포 고르기</span><i class="fa-solid fa-chevron-down sv-lore-chevron" aria-hidden="true"></i></summary><div id="sv-lore-picker" class="sv-lore-picker"></div></details>
        ${switchHtml({ id: "sv-cast-single", label: "이 봇카드는 목소리 하나로 통일", hint: "켜면 등장인물을 구분하지 않고 이 봇카드의 모든 대사를 아래 목소리로 읽습니다.", checked: single })}
        ${single ? `<hr class="sv-divider">${ownVoice}` : ""}
      </div>
      <section class="sv-members ${single ? "sv-members-off" : ""}">
        <h4 class="sv-members-title"><span>이 봇카드의 등장인물</span><span class="sv-badge">${members.length}</span>${infoTip("이 봇카드에만 나오는 인물입니다.", "등장인물 설명")}</h4>
        ${single ? '<p class="sv-hint">목소리 하나로 통일 중이라 등장인물 구분은 쉬고 있습니다. 등록 정보는 그대로 남습니다.</p>' : ""}
        <div class="sv-member-list">${list(members, standIn ? `등록한 인물이 없어 이 봇카드의 대사는 글로벌 인물 ‘${escapeHtml(standIn[1].name)}’의 목소리로 읽습니다(이름이 같음).` : `등록한 인물이 없어 지금은 봇카드를 한 사람(${escapeHtml(name)})으로 읽습니다.`)}</div>
        ${members.length ? "" : `<div class="sv-member-quick">${adopt}</div>`}
      </section>
      <section class="sv-members">
        <h4 class="sv-members-title"><span>글로벌 등장인물</span><span class="sv-badge">${globals.length}</span>${infoTip("여러 봇카드에 나오는 인물을 한 번만 등록합니다. 줄 오른쪽의 ‘이 봇카드에서 사용’을 켠 봇카드에서만 화자 후보·연락처·상태 추적에 들어갑니다.\n페르소나도 켠 봇카드에서만 내 목소리로 씁니다. 여럿을 켜 두면 지금 페르소나와 이름이 같은 쪽을 씁니다.", "글로벌 등장인물 설명")}</h4>
        <div class="sv-member-list">${list(globals, "등록한 글로벌 인물이 없습니다.")}</div>
      </section>
      <div class="sv-combo sv-member-add">
        <input id="sv-cast-new" maxlength="120" placeholder="인물 이름" autocomplete="off" aria-label="새 인물 이름">
        <select id="sv-cast-scope" aria-label="등록 범위"><option value="card">이 봇카드에만</option><option value="global">글로벌 (여러 봇카드)</option></select>
        <button type="button" id="sv-cast-add" class="sv-btn"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>인물 추가</span></button>
      </div>`;
    // The world info list is read when its fold is first opened.
    this.bindLorePicker();
    panel.querySelector(".sv-lore-fold")?.addEventListener("toggle", (event) => {
      if (event.currentTarget.open && !event.currentTarget.dataset.loaded) {
        event.currentTarget.dataset.loaded = "true";
        this.run(() => this.renderLorePicker(cardKey));
      }
    });
    const keys = [...members, ...globals];
    for (const [selector, value] of [
      ["#sv-cast-engine", entry.engine || "inherit"],
      ...keys.map((key, at) => [
        `#sv-member-${at}-engine`,
        this.voiceDraft[key]?.engine || "inherit",
      ]),
    ]) {
      const element = panel.querySelector(selector);
      if (element) element.value = value;
    }
  },

  /** The card's own person (its name and the settings it still holds) becomes its first person. */
  adoptCardPerson(cardKey) {
    const name = this.voiceDraft[cardKey]?.name || this.castDefaultName(cardKey);
    const key = `speaker:${contentKey({ card: cardKey, name })}`;
    const person = { ...(this.voiceDraft[key] || {}), name, card: cardKey };
    // First among the card's people, so it is the one the card speaks with.
    const next = {};
    let placed = false;
    for (const [other, value] of Object.entries(this.voiceDraft)) {
      if (other === key) continue;
      if (!placed && value?.card === cardKey) {
        next[key] = person;
        placed = true;
      }
      next[other] = value;
    }
    if (!placed) next[key] = person;
    this.voiceDraft = next;
    this.renderCastPanel(key);
  },

  onCastInput(event) {
    const field = event.target.dataset?.field;
    if (!field) {
      // 월드인포 참고 for this card: on, and its list can be opened.
      if (event.target.id === "sv-cast-lore" && event.type === "change") {
        this.loreDraft ||= structuredClone(this.config.phone?.world_info_choice || {});
        (this.loreDraft[this.editingCard] ||= { books: {}, entries: {} }).enabled = event.target.checked;
        const fold = document.querySelector("#sv-cast-panel .sv-lore-fold");
        if (fold) fold.hidden = !event.target.checked;
      }
      if (event.target.id === "sv-cast-single" && event.type === "change") {
        // Kept as false when switched off, so the parked voice is not taken for old settings.
        const card = (this.voiceDraft[this.editingCard] ||= { name: this.castDefaultName(this.editingCard) });
        card.single_voice = event.target.checked;
        this.renderCastPanel();
      }
      // 자동 연동 off: linked people open up for editing here right away (and close again on).
      if (event.target.id === "sv-multicast-sync" && event.type === "change")
        this.renderCastPanel(document.querySelector("#sv-cast-panel .sv-member[open]")?.dataset.key || "");
      return;
    }
    const member = event.target.closest(".sv-member");
    const key = member?.dataset.key || event.target.closest(".sv-cast-card")?.dataset.key;
    if (!key) return;
    const pick = event.target.closest("[data-voice-pick]");
    const value = pick
      ? this.voicePickValue(pick)
      : event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value.trim();
    this.updateCastEntry(key, field, field === "persona" ? value === "persona" || value === true : value);
    if (field === "persona" && event.type === "change") {
      this.renderCastPanel(key);
      return;
    }
    if (member) {
      const entry = this.voiceDraft[key] || {};
      member.querySelector("[data-member-label]").textContent = entry.name || "이름 없음";
      member.querySelector("[data-member-sub]").textContent = this.castMemberSummary(entry);
      if (field === "use_here") member.classList.toggle("sv-member-off", !value);
    }
  },

  onCastClick(event) {
    if (event.target.closest("[data-cast-adopt]")) {
      this.adoptCardPerson(this.editingCard);
      return;
    }
    if (event.target.closest("[data-cast-multicast]")) {
      try {
        const { added, updated, linked, removed } = this.importMultiCastCast();
        this.renderCastPanel();
        this.scheduleSettingsSave();
        const done = [
          added ? `새 인물 ${added}명` : "",
          linked ? `이미 있던 ${linked}명 연결` : "",
          updated ? `${updated}명 갱신` : "",
          removed ? `MultiCast 확장에서 빠진 ${removed}명 정리` : "",
        ].filter(Boolean);
        this.notify(
          done.length ? `재연동했습니다: ${done.join(", ")}.` : "MultiCast 확장과 이미 같습니다.",
          "info",
        );
      } catch (error) {
        this.notify(error.message || "MultiCast 확장에서 가져오지 못했습니다.", "error");
      }
      return;
    }
    if (event.target.closest("#sv-cast-add")) {
      const input = document.getElementById("sv-cast-new");
      const name = input?.value.trim();
      if (!name) return input?.focus();
      const cardKey = this.editingCard;
      const global = document.getElementById("sv-cast-scope")?.value === "global";
      const key = `speaker:${contentKey({ card: global ? "" : cardKey, name })}`;
      // A global person added while a bot card is open takes part in that card from the start.
      this.voiceDraft[key] ||= global
        ? { name, use_cards: cardKey.startsWith("character:") ? [cardKey] : [] }
        : { name, card: cardKey };
      this.renderCastPanel(key);
      return;
    }
    const move = event.target.closest("[data-member-move]");
    if (move) {
      const key = move.closest(".sv-member")?.dataset.key;
      const entry = key && this.voiceDraft[key];
      if (!entry) return;
      if (move.dataset.memberMove) entry.card = move.dataset.memberMove;
      else delete entry.card;
      this.renderCastPanel(key);
      return;
    }
    const remove = event.target.closest("[data-member-remove]");
    if (remove) {
      const key = remove.closest(".sv-member")?.dataset.key;
      if (!key) return;
      delete this.voiceDraft[key];
      delete this.noteDraft[key];
      this.renderCastPanel();
    }
  },

  /** Writes one field into the draft; a card entry with nothing set is dropped again. */
  updateCastEntry(key, field, value) {
    // A global person switched on or off for the bot card being edited.
    if (field === "use_here") {
      const entry = (this.voiceDraft[key] ||= { name: "" });
      const cards = new Set(this.globalUseList(entry));
      if (value) cards.add(this.editingCard);
      else cards.delete(this.editingCard);
      entry.use_cards = [...cards];
      return;
    }
    if (field === "note") {
      if (value) this.noteDraft[key] = value;
      else delete this.noteDraft[key];
      return;
    }
    const isPerson = key.startsWith("speaker:");
    const entry = (this.voiceDraft[key] ||= isPerson
      ? { name: "" }
      : { name: this.castDefaultName(key) });
    // Home-screen choice is kept either way: unset means "only the first contact".
    if (field === "quick_call") {
      entry.quick_call = Boolean(value);
      return;
    }
    if (field === "contact_rate") value = Number(value) === 50 ? "" : Number(value);
    if (value === false || value === "") delete entry[field];
    else entry[field] = value;
    if (!entry.name && !isPerson) entry.name = this.castDefaultName(key);
    const unused =
      !isPerson &&
      entry.name === this.castDefaultName(key) &&
      !entry.single_voice &&
      !entry.realtime &&
      !cardHoldsPerson(entry, this.noteDraft[key]);
    if (unused) delete this.voiceDraft[key];
  },

  /** Drafts are updated as fields change; kept for the save path. */
  flushVoiceDraft() {},
};
