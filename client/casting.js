// 화자 설정 (캐릭터별 목소리): bot cards, the people under them and global people, each
// with their voice, language, gender and switches.
import {
  escapeHtml,
  contentKey,
  LANGUAGE_CHOICES,
  setText,
  stOf,
} from "./common.js";
import { fieldHtml, switchHtml, infoTip } from "./ui.js";
import { TIME_ZONES, cardHoldsPerson, cardStandIn } from "../shared/casting.js";
import { voicePickHtml } from "./voice-picker.js";
import { bindCastOrder } from "./cast-order.js";
// The bot card's own settings show open; folded, they stay folded on this device.
const CARD_OPTIONS_CLOSED = "scenevoice_card_options_closed";
function cardOptionsOpen() {
  try {
    return localStorage.getItem(CARD_OPTIONS_CLOSED) !== "1";
  } catch {
    return true;
  }
}
// The card's phone settings are folded away until opened; open, they stay open on this device.
const CARD_PHONE_OPEN = "scenevoice_card_phone_open";
function cardPhoneOpen() {
  try {
    return localStorage.getItem(CARD_PHONE_OPEN) === "1";
  } catch {
    return false;
  }
}
const OUTREACH_MODES = [
  ["", "스마트폰 탭에서 고른 방식"],
  ["state", "인물별 상태 추적"],
  ["random", "랜덤"],
  ["time", "시간"],
];
// Which folders of the global list are folded: a matter of this device's view, not a setting.
const CLOSED_FOLDERS = "scenevoice_closed_folders";
function closedFolders() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_FOLDERS) || "[]"));
  } catch {
    return new Set();
  }
}
function keepClosedFolders(names) {
  try {
    localStorage.setItem(
      CLOSED_FOLDERS,
      JSON.stringify([...names].slice(0, 50)),
    );
  } catch {
    // Storage that refuses: folders open again next time.
  }
}

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
      if (
        key.startsWith("speaker:") &&
        !value?.card &&
        !this.globalInUse(value || {}, cards)
      )
        continue;
      result.push({
        key,
        name: value?.name || key,
        aliases: value?.aliases || "",
      });
    }
    return result;
  },
  speakerAnalysisContext(utterances = []) {
    const context = stOf(this) || {};
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
    const context = stOf(this) || {};
    const message = context.chat?.[Number(button.dataset.messageId)];
    if (message?.is_user) {
      const key = this.personaKey();
      return {
        key,
        name:
          this.config.character_voices?.[key]?.name ||
          context.name1 ||
          "사용자",
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
    // A bot card with people of its own is not a speaker (unless it reads with one voice).
    const person =
      !fallback.key.startsWith("character:") || this.cardIsPerson(fallback.key);
    if (person && !catalog.some((item) => item.key === fallback.key))
      catalog.unshift(fallback);
    select.append(
      new Option(
        // What the analysis said, when the line was analysed before its menu was made.
        button.dataset.speakerLabel ||
          `자동${person ? ` · ${fallback.name}` : ""}${button.dataset.kind === "thought" ? " · 생각" : ""}`,
        "",
      ),
      ...catalog.map((item) => new Option(item.name, item.key)),
    );
    select.value = button.dataset.speakerOverride || "";
    select.addEventListener("change", () => {
      this.cancelLineAudio(button);
      const value = select.value;
      button.dataset.speakerOverride = value;
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
    const context = stOf(this) || {};
    this.voiceDraft = structuredClone(this.config.character_voices || {});
    this.noteDraft = structuredClone(this.config.character_notes || {});
    this.folderDraft = [...(this.config.casting?.global_folders || [])];
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
              tip: "채팅·스마트폰·설정을 열 때 맞춥니다.\n바로 맞추려면 ‘재연동’을 누르십시오.",
              extra:
                '<button type="button" class="sv-mini-btn" data-cast-multicast title="지금 MultiCast 확장과 다시 맞춥니다" aria-label="재연동"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i><span>재연동</span></button>',
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
      if (!event.target.matches?.("[data-cast-new]")) return;
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      event.target.parentElement.querySelector("[data-cast-add]")?.click();
    });
    this.renderCastPanel();
  },

  /** People registered under a card, or the shared people for "__shared__". */
  castMembers(cardKey) {
    return Object.entries(this.voiceDraft || {})
      .filter(([key, entry]) =>
        cardKey === "__shared__"
          ? // Global people are registered people: a leftover entry of "no bot card" isn't one.
            !entry?.card && key.startsWith("speaker:")
          : entry?.card === cardKey && key !== cardKey,
      )
      .map(([key]) => key);
  },

  castDefaultName(key) {
    if (key === "user") return stOf(this)?.name1 || "사용자";
    return this.castCards?.get(key) || this.cardInfo(key).name;
  },

  /** Keep card-owned entries in their slots while saving the global rows' displayed order. */
  reorderGlobalCast(keys) {
    const globals = this.castMembers("__shared__");
    const allowed = new Set(globals);
    if (
      keys.length !== globals.length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !allowed.has(key))
    )
      return;
    if (keys.every((key, index) => key === globals[index])) return;
    let index = 0;
    this.voiceDraft = Object.fromEntries(
      Object.entries(this.voiceDraft).map(([key, value]) => {
        if (!allowed.has(key)) return [key, value];
        const next = keys[index++];
        return [next, this.voiceDraft[next]];
      }),
    );
    this.settingsDirty = true;
    this.scheduleSettingsSave(250);
  },

  /** The global list's folders: the saved ones in their order, then any a person names besides. */
  globalFolders() {
    const named = this.castMembers("__shared__").map(
      (key) => this.voiceDraft[key]?.folder,
    );
    return [...new Set([...(this.folderDraft || []), ...named])].filter(
      Boolean,
    );
  },

  /** After a drag or Alt + arrows: each global row's folder, the rows' order and the folders', as now shown. */
  placeGlobalCast(placed, folders = null) {
    let moved = false;
    if (
      folders &&
      JSON.stringify(folders) !== JSON.stringify(this.globalFolders())
    ) {
      this.folderDraft = folders;
      moved = true;
    }
    for (const { key, folder } of placed) {
      const entry = this.voiceDraft[key];
      if (!entry || (entry.folder || "") === folder) continue;
      moved = true;
      if (folder) entry.folder = folder;
      else delete entry.folder;
    }
    this.reorderGlobalCast(placed.map((item) => item.key));
    if (!moved) return;
    this.castChanged();
    this.renderCastPanel(
      document.querySelector("#sv-cast-panel .sv-member[open]")?.dataset.key ||
        "",
    );
  },

  castChanged() {
    this.settingsDirty = true;
    this.scheduleSettingsSave(250);
  },

  /** In how many of the known bot cards a global person is switched on (Infinity: in every one). */
  globalUseCount(entry = {}) {
    if (!Array.isArray(entry.use_cards)) return Infinity;
    const known = this.castCards;
    return entry.use_cards.filter((card) => !known?.size || known.has(card))
      .length;
  },

  castVoiceFields(prefix, entry, { member = false } = {}) {
    const id = (field) => `${prefix}-${field}`;
    const fishAvailable = this.availableEngines.includes("fish");
    return `<div class="sv-row sv-row-3">
        ${fieldHtml({ id: id("engine"), label: "엔진", control: `<select id="${id("engine")}" data-field="engine"><option value="inherit">${member ? "봇카드 기본 따라감" : "기본 엔진 사용"}</option><option value="fish" ${fishAvailable ? "" : "disabled"}>Fish Audio</option><option value="elevenlabs">ElevenLabs</option></select>` })}
        ${fieldHtml({ id: id("voice"), label: "대사 목소리", tip: "내 ElevenLabs 보이스 목록에서 이름으로 고릅니다.\n목록에 없는 목소리나 Fish Audio의 Reference ID는 칸에 붙여 넣으면 됩니다.", control: voicePickHtml({ id: id("voice"), field: "voice_id", value: entry.voice_id || "", label: this.voiceName(entry.voice_id) || entry.voice_id || "", placeholder: member ? "비우면 봇카드 기본 목소리" : "비우면 성별에 맞는 기본 목소리", empty: member ? "비우기 · 봇카드 기본 목소리" : "비우기 · 성별에 맞는 기본 목소리" }) })}
        ${fieldHtml({ id: id("gender"), label: "성별", tip: "목소리를 정하지 않았을 때 남성·여성 기본 목소리 중 무엇을 쓸지 정합니다.\n‘자동’이면 보조모델이 추정합니다.", control: `<select id="${id("gender")}" data-field="gender"><option value="" ${!entry.gender ? "selected" : ""}>자동</option><option value="male" ${entry.gender === "male" ? "selected" : ""}>남성</option><option value="female" ${entry.gender === "female" ? "selected" : ""}>여성</option></select>` })}
      </div>`;
  },

  castNoStateCheck(entry) {
    return `<label class="sv-check"><input type="checkbox" data-field="no_state" ${entry.no_state ? "checked" : ""}><span>상태 분석에서 제외 (먼저 전화·문자 X)</span>${infoTip("이 인물의 상태를 추적하지 않고, 먼저 전화·문자를 보내지도 않습니다.\n내가 거는 건 가능합니다.", "상태 분석 제외 설명")}</label>`;
  },

  castRateField(id, entry) {
    const rate = Number.isFinite(Number(entry.contact_rate))
      ? Number(entry.contact_rate)
      : 50;
    const choices = [
      [10, "거의 안 함 · 10%"],
      [30, "가끔 · 30%"],
      [50, "보통 · 50%"],
      [70, "자주 · 70%"],
      [90, "매우 자주 · 90%"],
    ];
    if (!choices.some(([value]) => value === rate))
      choices.push([rate, `직접 지정 · ${rate}%`]);
    return fieldHtml({
      id,
      label: "선연락 빈도",
      tip: "인물별 상태 추적 방식: 상태를 갱신할 때 보조모델이 ‘지금 이 인물이 선연락할 만하다’고 판단하면, 이 확률로 실제 연락합니다(10%면 상황이 맞아도 열 번에 한 번꼴).\n실제 확률 = 빈도 × 긴급도(낮음 ×0.85 · 보통 ×1 · 높음 ×1.6) × 바쁨이면 ×0.5, 최대 95%. 예: 매우 자주(90%)에 긴급도 높음이면 95%, 그 인물이 바쁘면 72%.\n자는 중이면 연락하지 않습니다. 함께 있을 때는 보조모델이 고르지 않습니다(골랐다면 상태에 ‘함께 있음’이라고 적혀 있어도 연락합니다).\n바쁨·자는 중 여부는 상태 탭에 보이는 그 인물의 상태를 따릅니다.\n사람마다 따로 판단하고, 여럿이 걸리면 전화는 확률이 가장 높은 한 명만, 한 번에 최대 두 명까지 연락합니다.\n최근(상태 갱신 두 번 안)에 선연락한 사람은 급한 일이 아니면 확률이 절반입니다(연락할 수 있는 인물이 한 명뿐이면 깎지 않음).\n랜덤 방식: AI 답변이 올 때마다 ‘공통 연락 빈도’의 기본 확률 × (이 빈도 ÷ 50)으로 굴립니다. 보통(50%)이면 기본 확률 그대로, 자주(70%)면 1.4배입니다.",
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
        "기본은 따로 정하지 않은 상태입니다. 보조모델이 말투·연기 메모와 성격을 보고 감정을 얼마나 드러낼지 판단하고, 엔진 값도 그대로 둡니다.",
        "다른 단계를 고르면 그 폭을 우선해 지키고, 엔진의 연기 일관성도 함께 움직입니다. 절제면 화가 나도 [angry] 대신 [quietly irritated]처럼 드러나는 만큼만 붙입니다.",
      ].join("\n"),
      control: `<select id="${id}" data-field="expressiveness">${choices.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select>`,
    });
  },

  castAlwaysField(id, entry) {
    return fieldHtml({
      id,
      label: "항상 붙일 태그",
      tip: "이 인물의 모든 대사 앞에 늘 붙는 태그입니다(4개까지).\n목소리 결을 고정할 때 씁니다.",
      control: `<input id="${id}" data-field="always_tags" value="${escapeHtml(Array.isArray(entry.always_tags) ? entry.always_tags.map((tag) => `[${tag}]`).join("") : entry.always_tags || "")}" placeholder="[husky][breathy] 또는 husky, breathy" autocomplete="off" spellcheck="false">`,
    });
  },

  castLanguageField(id, entry) {
    const choices = [["", "자동 · 대화 언어 따라가기"], ...LANGUAGE_CHOICES];
    const value = entry.language || "";
    return fieldHtml({
      id,
      label: "전화·문자 언어",
      tip: "정해 두면 내가 어떤 언어로 보내도 이 인물은 이 언어로 전화·문자에 답합니다.\n‘자동’이면 대화 언어를 따릅니다.",
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
      document.getElementById("sv-multicast-sync")?.checked ??
      this.config.casting?.multicast_sync !== false;
    const synced = Boolean(
      entry.multicast_id && syncOn && this.multicastApi?.(),
    );
    const used = usable && this.globalInUse(entry, [this.editingCard]);
    return `<details class="sv-member ${usable && !used ? "sv-member-off" : ""}" data-key="${escapeHtml(key)}" ${open ? "open" : ""}>
      <summary>
        <span class="sv-member-avatar" aria-hidden="true">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : escapeHtml(initial)}</span>
        <span class="sv-member-main"><strong data-member-label>${escapeHtml(entry.name || "이름 없음")}</strong><small data-member-sub>${escapeHtml(this.castMemberSummary(entry))}</small></span>
        ${usable ? `<label class="sv-use-chip" title="${entry.persona ? "켜면 이 봇카드에서 내 메시지와 문자를 이 목소리로 읽습니다" : "켜면 이 봇카드의 화자 후보·연락처·상태 추적에 들어갑니다"}"><input type="checkbox" class="sv-switch" data-field="use_here" ${used ? "checked" : ""}><span>이 봇카드에서 사용</span></label>` : ""}
        <i class="fa-solid fa-chevron-down sv-member-chevron" aria-hidden="true"></i>
      </summary>
      <div class="sv-member-body">
        ${synced ? '<div class="sv-notice"><i class="fa-solid fa-link" aria-hidden="true"></i><span>MultiCast 확장과 연동된 인물입니다. 목소리·성별·항상 붙일 태그·말투·연기 메모·감정 표현은 MultiCast에서 정하고, 지우려면 MultiCast에서 지우십시오. 여기서는 아래 항목만 추가 지정 가능합니다.</span></div>' : ""}
        <div class="sv-row sv-row-3">
          ${fieldHtml({ id: `${prefix}-name`, label: "이름", control: `<input id="${prefix}-name" data-field="name" maxlength="120" value="${escapeHtml(entry.name || "")}" autocomplete="off">` })}
          ${fieldHtml({ id: `${prefix}-aliases`, label: "별명·다른 표기", control: `<input id="${prefix}-aliases" data-field="aliases" maxlength="600" value="${escapeHtml(entry.aliases || "")}" placeholder="쉼표로 구분: 사토루, Gojo, 선생님" autocomplete="off">` })}
          ${fieldHtml({ id: `${prefix}-role`, label: "역할", tip: "페르소나는 내가 연기하는 인물입니다.\n내 메시지와 내가 보낸 문자를 이 목소리로 읽고, 스마트폰 연락처·상태 추적에서는 빠집니다.", control: `<select id="${prefix}-role" data-field="persona"><option value="">봇(등장인물)</option><option value="persona" ${entry.persona ? "selected" : ""}>페르소나(내 캐릭터)</option></select>` })}
        </div>
        ${
          synced
            ? ""
            : `<hr class="sv-divider">
        ${this.castVoiceFields(prefix, entry, { member: Boolean(entry.card) })}
        ${fieldHtml({ id: `${prefix}-note`, label: "말투·연기 메모", control: `<textarea id="${prefix}-note" data-field="note" rows="3" maxlength="4000" placeholder="이 인물의 말투·억양·감정 표현 습관&#10;예: 감정 표현이 크지 않다. 화가 나도 고함보다 단호하고 침착한 목소리로 말한다.">${escapeHtml(this.noteDraft[key] || "")}</textarea>` })}`
        }
        ${synced ? "" : `<div class="sv-row">${this.castRangeField(`${prefix}-range`, entry)}${this.castAlwaysField(`${prefix}-always`, entry)}</div>`}
        <div class="sv-row">${this.castLanguageField(`${prefix}-language`, entry)}${entry.persona ? "" : this.castRateField(`${prefix}-rate`, entry)}</div>
        ${entry.card ? "" : this.castGlobalFields(prefix, entry)}
        <hr class="sv-divider">
        <div class="sv-member-foot">
          <span class="sv-member-checks">
            ${entry.persona ? "" : this.castNoStateCheck(entry)}
            <label class="sv-check sv-chat-only"><input type="checkbox" data-field="skip_voice" ${entry.skip_voice ? "checked" : ""}><span>이어 듣기에서 건너뛰기</span>${infoTip("메시지의 이어 듣기 버튼으로 들을 때 이 인물의 대사를 빼고 만듭니다.\n대사 옆 재생 버튼을 직접 누르면 만들 수 있습니다.", "이어 듣기에서 건너뛰기 설명")}</label>
            <label class="sv-check sv-chat-only"><input type="checkbox" data-field="hide_button" ${entry.hide_button ? "checked" : ""}><span>대사 옆 버튼 숨기기</span>${infoTip("이 인물의 대사 옆 버튼을 숨깁니다.\n화자가 정해진 뒤부터 숨겨지고, 이어 듣기에서도 빠집니다.", "대사 옆 버튼 숨기기 설명")}</label>
          </span>
          <span class="sv-actions">
            ${this.castMoveButton(entry)}
            ${synced ? "" : '<button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-member-remove><i class="fa-solid fa-user-xmark" aria-hidden="true"></i><span>인물 삭제</span></button>'}
          </span>
        </div>
      </div>
    </details>`;
  },

  /** A global person's folder, and the bot cards it is switched on for (with a way to clear them). */
  castGlobalFields(prefix, entry) {
    const folders = this.globalFolders();
    const count = this.globalUseCount(entry);
    const here = this.editingCard?.startsWith("character:");
    const where =
      count === Infinity ? "모든 봇카드" : count ? `봇카드 ${count}곳` : "없음";
    return `<hr class="sv-divider">
        <div class="sv-row">
          ${fieldHtml({
            id: `${prefix}-use`,
            label: "사용 중인 봇카드",
            tip: "글로벌 인물은 켠 봇카드에서만 화자 후보·연락처·상태 추적에 들어갑니다.\n여러 곳에 켜져 있으면 여기서 한 번에 정리합니다.",
            control: `<div class="sv-use-all" id="${prefix}-use"><span class="sv-use-count">${where}</span>${here ? '<button type="button" class="sv-btn sv-btn-sm" data-use-only><span>이 봇카드에서만</span></button>' : ""}<button type="button" class="sv-btn sv-btn-sm" data-use-none ${count ? "" : "disabled"}><span>모두 끄기</span></button></div>`,
          })}
          ${
            folders.length
              ? fieldHtml({
                  id: `${prefix}-folder`,
                  label: "폴더",
                  control: `<select id="${prefix}-folder" data-field="folder"><option value="">폴더 없음</option>${folders.map((name) => `<option value="${escapeHtml(name)}" ${entry.folder === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>`,
                })
              : ""
          }
        </div>`;
  },

  /** One folder of the global list: folded or open, renamed, taken away, switched on as a whole. */
  castFolderHtml(name, keys, rows, closed) {
    const here = this.editingCard?.startsWith("character:");
    const on = keys.filter((key) =>
      this.globalInUse(this.voiceDraft[key], [this.editingCard]),
    ).length;
    const label = escapeHtml(name);
    const title = `<strong class="sv-folder-name">${label}</strong>`;
    return `<details class="sv-cast-folder" data-folder="${label}" ${closed.has(name) ? "" : "open"}>
      <summary>
        <i class="fa-solid fa-folder sv-folder-icon" aria-hidden="true"></i>
        ${title}<span class="sv-badge">${keys.length}</span>
        <span class="sv-folder-tools">
          <button type="button" class="sv-icon-btn" data-folder-rename title="폴더 이름 바꾸기" aria-label="${label} 폴더 이름 바꾸기"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
          <button type="button" class="sv-icon-btn" data-folder-remove title="폴더 없애기 (안의 인물은 남습니다)" aria-label="${label} 폴더 없애기"><i class="fa-solid fa-folder-minus" aria-hidden="true"></i></button>
        </span>
        ${here && keys.length ? `<label class="sv-use-chip ${on && on < keys.length ? "" : "sv-use-chip-bare"}" title="폴더 안의 인물을 이 봇카드에서 한 번에 켜고 끕니다"><input type="checkbox" class="sv-switch" data-folder-use aria-label="${label} 폴더의 인물 모두 사용" ${on === keys.length ? "checked" : ""} ${on && on < keys.length ? "data-mixed" : ""}>${on && on < keys.length ? `<span>${on}명만 사용</span>` : ""}</label>` : ""}
        <i class="fa-solid fa-chevron-down sv-member-chevron" aria-hidden="true"></i>
      </summary>
      <div class="sv-folder-members">${rows}<p class="sv-hint sv-folder-empty">인물을 길게 눌러 여기로 끌어 넣거나, 인물 안의 ‘폴더’에서 고릅니다.</p></div>
    </details>`;
  },

  addCastFolder() {
    const names = new Set(this.globalFolders());
    let name = "새 폴더";
    for (let at = 2; names.has(name); at++) name = `새 폴더 ${at}`;
    this.folderDraft = [...this.globalFolders(), name];
    this.castChanged();
    this.renderCastPanel();
    this.openFolderName(name);
  },

  /** 폴더 이름: asked in a small window of its own (the folder's row is too narrow to type in). */
  openFolderName(name) {
    document.getElementById("sv-folder-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-folder-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-folder"></i></span>
        <div><h3>폴더 이름</h3><small>글로벌 인물을 묶는 폴더의 이름입니다</small></div>
      </header>
      <input class="sv-folder-rename" data-folder-name maxlength="40" value="${escapeHtml(name)}" aria-label="폴더 이름" autocomplete="off">
      <footer class="sv-dialog-actions">
        <button type="submit" class="sv-btn" value="cancel">취소</button>
        <button type="submit" class="sv-btn sv-btn-primary" value="ok">저장</button>
      </footer>
    </form>`;
    document.body.append(dialog);
    const input = dialog.querySelector("[data-folder-name]");
    // Saved at once (the dialog's own close event comes a moment later).
    const save = () => {
      const value = input.value;
      dialog.remove();
      this.renameCastFolder(name, value);
    };
    // Enter in the box saves (the first button of the form is 취소).
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      save();
    });
    // (Not by the form's submitter: older Safari doesn't say which button it was.)
    dialog
      .querySelector(".sv-btn-primary")
      .addEventListener("click", (event) => {
        event.preventDefault();
        save();
      });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    // The box takes the keyboard where there is one to hand; on a touch screen it waits for a tap.
    if (window.matchMedia?.("(pointer: coarse)").matches)
      dialog.querySelector(".sv-btn-primary").focus({ preventScroll: true });
    else {
      input.focus();
      input.select();
    }
  },

  renameCastFolder(from, to) {
    const name = String(to || "")
      .trim()
      .slice(0, 40);
    if (name && name !== from && !this.globalFolders().includes(name)) {
      this.folderDraft = this.globalFolders().map((item) =>
        item === from ? name : item,
      );
      for (const key of this.castMembers("__shared__"))
        if (this.voiceDraft[key].folder === from)
          this.voiceDraft[key].folder = name;
      const closed = closedFolders();
      if (closed.delete(from)) closed.add(name);
      keepClosedFolders(closed);
      this.castChanged();
    }
    this.renderCastPanel();
  },

  removeCastFolder(name) {
    this.folderDraft = this.globalFolders().filter((item) => item !== name);
    for (const key of this.castMembers("__shared__"))
      if (this.voiceDraft[key].folder === name)
        delete this.voiceDraft[key].folder;
    this.castChanged();
    this.renderCastPanel();
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
      // Worth a glance: in use beyond the card it was switched on for.
      ...(!entry.card && this.globalUseCount(entry) === Infinity
        ? ["모든 봇카드에서 사용"]
        : !entry.card && this.globalUseCount(entry) > 1
          ? [`봇카드 ${this.globalUseCount(entry)}곳에서 사용`]
          : []),
      ...(entry.multicast_id ? ["MultiCast 확장 연동"] : []),
      ...(entry.skip_voice || entry.hide_button ? ["음성 건너뜀"] : []),
    ].join(" · ");
  },

  renderCastPanel(openKey = "") {
    this.castOrderCleanup?.();
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
    const loreOn =
      this.loreChoice?.(
        cardKey,
        this.loreDraft || this.config.phone?.world_info_choice,
      ).enabled === true;
    const standIn = cardStandIn(this.voiceDraft, cardKey, [
      entry.name,
      contact.name,
    ]);
    const avatar = this.contactAvatarMarkup({
      name: contact.name,
      avatarUrl: contact.avatarUrl,
    });
    let index = 0;
    const row = (key) => this.castMemberHtml(key, index++, key === openKey);
    const list = (keys, empty) =>
      keys.map(row).join("") ||
      `<div class="sv-member-empty"><p class="sv-hint">${empty}</p></div>`;
    // Global people: the folders first, each with its people, then those in no folder.
    const folders = this.globalFolders();
    const closed = closedFolders();
    const within = (name) =>
      globals.filter((key) => (this.voiceDraft[key]?.folder || "") === name);
    // Called from the template, after the card's own rows: the rows are numbered as they are drawn.
    const shownGlobals = [...folders.flatMap(within), ...within("")];
    const globalRows = () =>
      folders
        .map((name) =>
          this.castFolderHtml(
            name,
            within(name),
            within(name).map(row).join(""),
            closed,
          ),
        )
        .join("") +
      (folders.length
        ? within("").map(row).join("")
        : list(globals, "등록한 글로벌 인물이 없습니다."));
    // Each list has its own row for adding to it.
    const adder = (scope, inputId, buttonId, label, about) =>
      `<div class="sv-combo sv-member-add">
        <input id="${inputId}" data-cast-new maxlength="120" placeholder="인물 이름" autocomplete="off" aria-label="${about}">
        <button type="button" id="${buttonId}" class="sv-btn" data-cast-add="${scope}"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>${label}</span></button>
      </div>`;
    const adopt = `<button type="button" class="sv-btn sv-btn-sm" data-cast-adopt><i class="fa-solid fa-user-plus" aria-hidden="true"></i><span>‘${escapeHtml(name)}’ 인물로 추가</span></button>`;
    // The one voice of a card set to one voice.
    const ownVoice = `${this.castVoiceFields("sv-cast", entry)}
        ${fieldHtml({ id: "sv-cast-note", label: "말투·연기 메모", tip: "보조모델이 이 인물의 대사를 분석할 때 참고합니다.\n소리 내어 읽지 않습니다.", control: `<textarea id="sv-cast-note" data-field="note" rows="3" maxlength="4000" placeholder="이 인물의 말투·억양·감정 표현 습관&#10;예: 감정 표현이 크지 않다. 화가 나도 고함보다 단호하고 침착한 목소리로 말한다.">${escapeHtml(this.noteDraft[ownerKey] || "")}</textarea>` })}
        <div class="sv-row">${this.castRangeField("sv-cast-range", entry)}${this.castAlwaysField("sv-cast-always", entry)}</div>
        <div class="sv-row">${this.castLanguageField("sv-cast-language", entry)}${this.castRateField("sv-cast-rate", entry)}</div>
        <div class="sv-member-checks">${this.castNoStateCheck(entry)}</div>`;
    // A name half-typed in an add row outlives a redraw (the panel is drawn again as lists load).
    const typed = [...panel.querySelectorAll("[data-cast-new]")].map(
      (input) => [input.id, input.value],
    );
    panel.innerHTML = `
      <div class="sv-cast-card" data-key="${escapeHtml(ownerKey)}">
        <details class="sv-cast-fold" ${cardOptionsOpen() ? "open" : ""}>
          <summary class="sv-cast-head">
            ${avatar}
            <div class="sv-cast-title"><strong>${escapeHtml(name)}</strong><small data-card-options></small></div>
            <i class="fa-solid fa-chevron-down sv-member-chevron" aria-hidden="true"></i>
          </summary>
          <div class="sv-cast-body">
        ${
          ownerKey.startsWith("character:")
            ? `        ${switchHtml({ id: "sv-cast-single", label: "이 봇카드는 목소리 하나로 통일", hint: "켜면 인물을 구분하지 않고 이 봇카드의 모든 대사를 아래 목소리로 읽습니다.", checked: single })}
        ${single ? `<hr class="sv-divider">${ownVoice}` : ""}
        <details class="sv-sub-sec sv-cast-phone" ${cardPhoneOpen() ? "open" : ""}>
          <summary class="sv-sub-title"><i class="fa-solid fa-mobile-screen" aria-hidden="true"></i><span>스마트폰</span><small data-card-phone></small><i class="fa-solid fa-chevron-down sv-sub-chevron" aria-hidden="true"></i></summary>
          <div class="sv-sub-body">
        ${switchHtml({ id: "sv-cast-outreach", label: "선연락 받기", hint: "켜면 이 봇카드에서 인물이 먼저 전화·문자하고, 음성 메모와 엿듣는 통화도 저절로 생깁니다.", tip: "스마트폰 탭의 ‘선연락’에서 켜 둔 것만 옵니다.\n꺼 두어도 내가 거는 전화와 보내는 문자는 그대로입니다.", checked: entry.outreach === true, attrs: 'data-field="outreach"' })}
        <div class="sv-row sv-cast-mode" ${entry.outreach ? "" : "hidden"}>
          ${fieldHtml({ id: "sv-cast-mode", label: "연락 방식", tip: "이 봇카드에서만 다른 방식으로 연락받을 수 있습니다.\n각 방식의 세부 설정(주기, 빈도, 간격)은 스마트폰 탭의 ‘선연락’에서 그 방식을 골라 바꿉니다.", control: `<select id="sv-cast-mode" data-field="outreach_mode">${OUTREACH_MODES.map(([value, name]) => `<option value="${value}" ${(entry.outreach_mode || "") === value ? "selected" : ""}>${name}</option>`).join("")}</select>` })}
        </div>
        ${switchHtml({ id: "sv-cast-realtime", label: "실제 시간 인식", hint: "켜면 이 봇카드의 인물들이 전화·문자에서 지금 날짜와 시각을 압니다.", tip: "밤늦은 시간, 주말, 메시지 사이에 흐른 시간처럼 실제 시각을 대화에 자연스럽게 반영합니다.\n전화·문자 기록에도 시각이 남습니다.", checked: entry.realtime === true, attrs: 'data-field="realtime"' })}
        <div class="sv-row sv-cast-zones" ${entry.realtime ? "" : "hidden"}>
          ${fieldHtml({ id: "sv-cast-zone", label: "인물들이 사는 곳의 시간", tip: "이 봇카드의 인물들이 아는 ‘지금 시각’입니다.\n서머타임은 자동으로 반영됩니다.", control: `<select id="sv-cast-zone" data-field="time_zone"><option value="">이 기기의 시간과 같게</option>${TIME_ZONES.map(([value, name]) => `<option value="${value}" ${entry.time_zone === value ? "selected" : ""}>${name}</option>`).join("")}</select>` })}
          ${fieldHtml({ id: "sv-cast-user-zone", label: "내 캐릭터가 사는 곳의 시간", tip: "인물들과 다른 곳을 고르면 서로 시차가 있다는 것을 압니다.", control: `<select id="sv-cast-user-zone" data-field="user_time_zone"><option value="">이 기기의 시간과 같게</option>${TIME_ZONES.map(([value, name]) => `<option value="${value}" ${entry.user_time_zone === value ? "selected" : ""}>${name}</option>`).join("")}</select>` })}
        </div>
        <div class="sv-row sv-cast-quiet" ${entry.outreach ? "" : "hidden"}>
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-cast-quiet-label">연락하지 않는 시간</span>${infoTip("이 시간에는 이 봇카드의 인물들이 먼저 연락하지 않습니다(랜덤·시간 방식).\n‘실제 시간 인식’에서 고른 인물들이 사는 곳의 시각으로 따지고, 고르지 않았으면 이 기기의 시각입니다.\n내가 먼저 건 전화나 보낸 문자에는 이 시간에도 답합니다.\n상태 추적 방식은 이야기 속 상황(자는 중 등)으로 판단하므로 해당하지 않습니다.\n두 칸을 비우면 쓰지 않습니다.", "연락하지 않는 시간 설명")}</div>
            <div class="sv-range-pair" role="group" aria-labelledby="sv-cast-quiet-label"><input type="time" data-field="quiet_from" value="${escapeHtml(entry.quiet_from || "")}" aria-label="연락하지 않는 시간 시작"><span>~</span><input type="time" data-field="quiet_to" value="${escapeHtml(entry.quiet_to || "")}" aria-label="연락하지 않는 시간 끝"></div>
          </div>
        </div>
        ${switchHtml({ id: "sv-cast-memory", attrs: 'data-field="chat_memory"', label: "채팅 기억 연동", hint: "켜면 전화·문자 내용이 채팅 화면에 보이고, 이 봇카드의 캐릭터가 그 내용을 기억합니다.", tip: "끝난 전화·음성 메시지·주고받은 문자는 스위치와 상관없이 늘 그때의 채팅 메시지에 기록해 둡니다.\n켜면 그 기록을 메시지 아래 ‘전화·문자 채팅 기억’에 보여 주고, 이후 실리태번 채팅에서 서사를 이어갈 때도 활용합니다. 꺼 두었다가 켜도 그동안의 기록이 바로 반영됩니다.\n되돌렸거나 다른 스와이프에서 주고받은 기록은 넣지 않습니다(스마트폰의 미적용 기억).\n끄면 AI에게 보내지 않을 뿐, 기록은 남아 있습니다.", checked: entry.chat_memory ?? Boolean(this.config.chat_memory?.enabled) })}
        ${switchHtml({ id: "sv-cast-lore", label: "월드인포 참고", hint: "고른 월드인포 항목을 전화·문자 AI 요청에 맥락 참고용으로 보냅니다.", tip: "참고할 월드인포와 항목을 고릅니다.\n상시 항목은 늘, 키워드 항목은 그 키워드가 최근 채팅이나 지금 전화·문자에 나올 때만 보냅니다.\n형식이나 문체를 바꾸는 지시가 든 항목은 가급적 꺼 두십시오.\n대필에도 씁니다.", checked: loreOn })}
        <details class="sv-lore-fold" ${loreOn ? "" : "hidden"}><summary><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>참고할 월드인포 고르기</span><i class="fa-solid fa-chevron-down sv-lore-chevron" aria-hidden="true"></i></summary><div id="sv-lore-picker" class="sv-lore-picker"></div></details>
          </div>
        </details>`
            : '<p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>지금 열린 봇카드가 없습니다. 채팅을 열거나 위에서 봇카드를 고르면 그 봇카드의 설정이 여기 보입니다.</span></p>'
        }
          </div>
        </details>
      </div>
      <section class="sv-members ${single ? "sv-members-off" : ""}">
        <h4 class="sv-members-title"><span>이 봇카드의 인물</span><span class="sv-badge">${members.length}</span>${infoTip("이 봇카드에만 나오는 인물입니다.", "이 봇카드의 인물 설명")}</h4>
        ${single ? '<p class="sv-hint">목소리 하나로 통일 중이라 인물 구분은 쉬고 있습니다. 등록 정보는 그대로 남습니다.</p>' : ""}
        <div class="sv-member-list">${list(members, standIn ? `등록한 인물이 없어 이 봇카드의 대사는 글로벌 인물 ‘${escapeHtml(standIn[1].name)}’의 목소리로 읽습니다(이름이 같음).` : `등록한 인물이 없어 지금은 봇카드를 한 사람(${escapeHtml(name)})으로 읽습니다.`)}</div>
        ${members.length ? "" : `<div class="sv-member-quick">${adopt}</div>`}
        ${adder("card", "sv-cast-new", "sv-cast-add", "이 봇카드에 추가", "이 봇카드에 추가할 인물 이름")}
      </section>
      <section class="sv-members">
        <h4 class="sv-members-title sv-members-title-tools"><span>글로벌 인물</span><span class="sv-badge">${globals.length}</span>${infoTip("여러 봇카드에 나오는 인물을 한 번만 등록합니다.\n줄 오른쪽의 ‘이 봇카드에서 사용’을 켠 봇카드에서만 화자 후보·연락처·상태 추적에 들어갑니다.\n페르소나도 켠 봇카드에서만 내 목소리로 씁니다.\n여럿을 켜 두면 지금 페르소나와 이름이 같은 쪽을 씁니다.", "글로벌 인물 설명")}<button type="button" class="sv-btn sv-btn-ghost sv-btn-sm sv-folder-add" data-folder-add title="글로벌 인물을 묶을 폴더를 만듭니다"><i class="fa-solid fa-folder-plus" aria-hidden="true"></i><span>폴더 만들기</span></button></h4>
        ${globals.length > 1 || (globals.length && folders.length) ? `<p class="sv-hint">인물 이름을 길게 누른 뒤 끌어 ${folders.length ? "순서를 바꾸거나 폴더에 넣습니다" : "순서를 바꿉니다"}. 자동으로 저장합니다.</p>` : ""}
        <div class="sv-member-list sv-global-member-list">${globalRows()}</div>
        ${adder("global", "sv-cast-new-global", "sv-cast-add-global", "글로벌에 추가", "글로벌로 추가할 인물 이름")}
      </section>`;
    for (const [id, value] of typed) {
      const input = value && panel.querySelector(`#${id}`);
      if (input) input.value = value;
    }
    // The world info list is read when its fold is first opened.
    const globalList = panel.querySelector(".sv-global-member-list");
    for (const summary of globalList.querySelectorAll(".sv-member > summary")) {
      summary.title =
        "길게 눌러 순서를 바꾸거나 폴더에 넣습니다. 키보드에서는 Alt + 위·아래 방향키를 사용합니다.";
      summary.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    }
    for (const summary of globalList.querySelectorAll(
      ":scope > .sv-cast-folder > summary",
    )) {
      summary.title =
        "길게 눌러 폴더 순서를 바꿉니다. 키보드에서는 Alt + 위·아래 방향키를 사용합니다.";
      summary.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    }
    this.castOrderCleanup = bindCastOrder(globalList, (placed, folders) =>
      this.placeGlobalCast(placed, folders),
    );
    for (const folder of globalList.querySelectorAll(
      ":scope > .sv-cast-folder",
    )) {
      folder.addEventListener("toggle", () => {
        const names = closedFolders();
        if (folder.open) names.delete(folder.dataset.folder);
        else names.add(folder.dataset.folder);
        keepClosedFolders(names);
      });
      const mixed = folder.querySelector("[data-folder-use][data-mixed]");
      if (mixed) mixed.indeterminate = true;
    }
    this.bindLorePicker();
    // The card's own settings fold away; folded or open, they stay as left (on this device).
    panel
      .querySelector(".sv-cast-fold")
      ?.addEventListener("toggle", (event) => {
        if (event.target !== event.currentTarget) return;
        try {
          if (event.currentTarget.open)
            localStorage.removeItem(CARD_OPTIONS_CLOSED);
          else localStorage.setItem(CARD_OPTIONS_CLOSED, "1");
        } catch {
          // Storage that refuses: open again next time.
        }
      });
    panel
      .querySelector(".sv-cast-phone")
      ?.addEventListener("toggle", (event) => {
        try {
          if (event.currentTarget.open)
            localStorage.setItem(CARD_PHONE_OPEN, "1");
          else localStorage.removeItem(CARD_PHONE_OPEN);
        } catch {
          // Storage that refuses: folded again next time.
        }
      });
    this.noteCardOptions();
    panel
      .querySelector(".sv-lore-fold")
      ?.addEventListener("toggle", (event) => {
        if (event.currentTarget.open && !event.currentTarget.dataset.loaded) {
          event.currentTarget.dataset.loaded = "true";
          this.run(() => this.renderLorePicker(cardKey));
        }
      });
    const keys = [...members, ...shownGlobals];
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
    const name =
      this.voiceDraft[cardKey]?.name || this.castDefaultName(cardKey);
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

  /** Under the card's name: which of its settings are on, readable while they are folded away. */
  noteCardOptions() {
    const note = document.querySelector("#sv-cast-panel [data-card-options]");
    if (!note) return;
    const checked = (ids) =>
      ids
        .filter(([id]) => document.getElementById(id)?.checked)
        .map(([, label]) => label);
    setText(
      note,
      [
        "봇카드 공통 설정",
        ...checked([["sv-cast-single", "목소리 하나"]]),
      ].join(" · "),
    );
    setText(
      document.querySelector("#sv-cast-panel [data-card-phone]"),
      checked([
        ["sv-cast-outreach", "선연락"],
        ["sv-cast-realtime", "실제 시간"],
        ["sv-cast-memory", "채팅 기억"],
        ["sv-cast-lore", "월드인포"],
      ]).join(" · "),
    );
  },

  onCastInput(event) {
    if (event.target.closest?.(".sv-cast-card")) this.noteCardOptions();
    const field = event.target.dataset?.field;
    if (!field) {
      // 월드인포 참고 for this card: on, and its list can be opened.
      if (event.target.id === "sv-cast-lore" && event.type === "change") {
        this.loreDraft ||= structuredClone(
          this.config.phone?.world_info_choice || {},
        );
        (this.loreDraft[this.editingCard] ||= {
          books: {},
          entries: {},
        }).enabled = event.target.checked;
        const fold = document.querySelector("#sv-cast-panel .sv-lore-fold");
        if (fold) fold.hidden = !event.target.checked;
      }
      if (event.target.id === "sv-cast-single" && event.type === "change") {
        // Kept as false when switched off, so the parked voice is not taken for old settings.
        const card = (this.voiceDraft[this.editingCard] ||= {
          name: this.castDefaultName(this.editingCard),
        });
        card.single_voice = event.target.checked;
        this.renderCastPanel();
      }
      // A folder's switch: everyone in it, in or out of this bot card at once.
      if (
        event.target.matches("[data-folder-use]") &&
        event.type === "change"
      ) {
        const name = event.target.closest("[data-folder]").dataset.folder;
        for (const key of this.castMembers("__shared__"))
          if (this.voiceDraft[key].folder === name)
            this.updateCastEntry(key, "use_here", event.target.checked);
        this.renderCastPanel(
          document.querySelector("#sv-cast-panel .sv-member[open]")?.dataset
            .key || "",
        );
      }
      // 자동 연동 off: linked people open up for editing here right away (and close again on).
      if (event.target.id === "sv-multicast-sync" && event.type === "change")
        this.renderCastPanel(
          document.querySelector("#sv-cast-panel .sv-member[open]")?.dataset
            .key || "",
        );
      return;
    }
    const member = event.target.closest(".sv-member");
    const key =
      member?.dataset.key || event.target.closest(".sv-cast-card")?.dataset.key;
    if (!key) return;
    const pick = event.target.closest("[data-voice-pick]");
    const value = pick
      ? this.voicePickValue(pick)
      : event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value.trim();
    this.updateCastEntry(
      key,
      field,
      field === "persona" ? value === "persona" || value === true : value,
    );
    // 선연락 받기 on this card: the note under 선연락 사용 follows.
    if (field === "outreach") {
      const mode = document.querySelector("#sv-cast-panel .sv-cast-mode");
      if (mode) mode.hidden = !value;
      const quiet = document.querySelector("#sv-cast-panel .sv-cast-quiet");
      if (quiet) quiet.hidden = !value;
    }
    if (["outreach", "outreach_mode"].includes(field))
      this.syncOutreachView?.();
    // 실제 시간 인식 on: where everyone lives can be chosen.
    if (field === "realtime") {
      const zones = document.querySelector("#sv-cast-panel .sv-cast-zones");
      if (zones) zones.hidden = !value;
      // Switched off, the places chosen go with it.
      if (!value) {
        for (const zone of ["time_zone", "user_time_zone"])
          this.updateCastEntry(key, zone, "");
        zones
          ?.querySelectorAll("select")
          .forEach((select) => (select.value = ""));
      }
    }
    if (["persona", "folder"].includes(field) && event.type === "change") {
      this.renderCastPanel(key);
      return;
    }
    if (member) {
      // The row's name and summary follow once the typing pauses (see setText in common.js).
      clearTimeout(this.memberLabelTimer);
      const label = () => {
        if (!member.isConnected) return;
        const entry = this.voiceDraft[key] || {};
        setText(
          member.querySelector("[data-member-label]"),
          entry.name || "이름 없음",
        );
        setText(
          member.querySelector("[data-member-sub]"),
          this.castMemberSummary(entry),
        );
      };
      if (event.type === "input" && event.target.matches("input, textarea"))
        this.memberLabelTimer = setTimeout(label, 400);
      else label();
      if (field === "use_here")
        member.classList.toggle("sv-member-off", !value);
    }
  },

  onCastClick(event) {
    if (event.target.closest("[data-folder-add]")) return this.addCastFolder();
    const folderTool = event.target.closest(
      "[data-folder-rename], [data-folder-remove]",
    );
    if (folderTool) {
      // In the folder's summary: the press is for the tool, not for folding.
      event.preventDefault();
      const name = folderTool.closest("[data-folder]").dataset.folder;
      if (folderTool.matches("[data-folder-remove]")) {
        if (
          !confirm(
            `‘${name}’ 폴더를 없애시겠습니까?\n안에 있던 인물은 지워지지 않고 폴더 밖으로 나옵니다.`,
          )
        )
          return;
        return this.removeCastFolder(name);
      }
      return this.openFolderName(name);
    }
    const clear = event.target.closest("[data-use-only], [data-use-none]");
    if (clear) {
      const key = clear.closest(".sv-member")?.dataset.key;
      const entry = key && this.voiceDraft[key];
      if (!entry) return;
      entry.use_cards = clear.matches("[data-use-only]")
        ? [this.editingCard]
        : [];
      this.castChanged();
      return this.renderCastPanel(key);
    }
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
          done.length
            ? `재연동했습니다: ${done.join(", ")}.`
            : "MultiCast 확장과 이미 같습니다.",
          "info",
        );
      } catch (error) {
        this.notify(
          error.message || "MultiCast 확장에서 가져오지 못했습니다.",
          "error",
        );
      }
      return;
    }
    const add = event.target.closest("[data-cast-add]");
    if (add) {
      const input = add.parentElement.querySelector("[data-cast-new]");
      const name = input?.value.trim();
      if (!name) return input?.focus();
      const cardKey = this.editingCard;
      const global = add.dataset.castAdd === "global";
      const key = `speaker:${contentKey({ card: global ? "" : cardKey, name })}`;
      // A global person added while a bot card is open takes part in that card from the start.
      this.voiceDraft[key] ||= global
        ? { name, use_cards: cardKey.startsWith("character:") ? [cardKey] : [] }
        : { name, card: cardKey };
      input.value = "";
      this.renderCastPanel(key);
      return;
    }
    const move = event.target.closest("[data-member-move]");
    if (move) {
      const key = move.closest(".sv-member")?.dataset.key;
      const entry = key && this.voiceDraft[key];
      if (!entry) return;
      if (move.dataset.memberMove) {
        entry.card = move.dataset.memberMove;
        delete entry.use_cards;
        delete entry.folder;
      } else {
        // Global from here on, and in use only in the card it came from (no list would be every card).
        entry.use_cards = entry.card?.startsWith("character:")
          ? [entry.card]
          : [];
        delete entry.card;
      }
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
    // With no bot card open (실리태번's first screen) there is no card to keep settings for.
    if (!isPerson && !key.startsWith("character:") && key !== "user") return;
    const entry = (this.voiceDraft[key] ||= isPerson
      ? { name: "" }
      : { name: this.castDefaultName(key) });
    // Home-screen choice is kept either way: unset means "only the first contact".
    if (field === "quick_call") {
      entry.quick_call = Boolean(value);
      return;
    }
    if (field === "contact_rate")
      value = Number(value) === 50 ? "" : Number(value);
    // Off is kept as off: an unset card follows the switch there was before for every card.
    if (field === "chat_memory") {
      entry.chat_memory = Boolean(value);
      return;
    }
    if (value === false || value === "") delete entry[field];
    else entry[field] = value;
    if (!entry.name && !isPerson) entry.name = this.castDefaultName(key);
    const unused =
      !isPerson &&
      entry.name === this.castDefaultName(key) &&
      !entry.single_voice &&
      !entry.realtime &&
      !entry.outreach &&
      entry.chat_memory === undefined &&
      !cardHoldsPerson(entry, this.noteDraft[key]);
    if (unused) delete this.voiceDraft[key];
  },

  /** Drafts are updated as fields change; kept for the save path. */
  flushVoiceDraft() {},
};
