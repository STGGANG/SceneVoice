// 설정 창: its tabs, the settings form (saved automatically) and applying saved settings.
import {
  escapeHtml,
  mergeConfig,
  contentKey,
  LANGUAGE_CHOICES,
  OVERHEARD_LENGTH_CHOICES,
} from "./common.js";
import { elevenModelTraits, RANDOM_OUTREACH_BASE } from "../shared/settings.js";
import {
  infoTip,
  groupHtml,
  fieldHtml,
  switchHtml,
  rangeHtml,
  badgeHtml,
  bindInfoTips,
  bindRanges,
  bindStateBadges,
  closeTips,
  choiceListHtml,
  emptyHtml,
  subTitle,
  SUB_END,
  tidySettingLines,
} from "./ui.js";
import { voicePickHtml } from "./voice-picker.js";
import { CURRENT_CONNECTION } from "./connection.js";
import { STYLE_DEFAULTS, normalizeStyle } from "./prompts.js";

const LANGUAGES = [["auto", "자동 · 인물 설정 따름"], ...LANGUAGE_CHOICES];
const ELEVEN_MODELS = [
  ["eleven_v4", "Eleven v4 · 품질 우선 (추천)"],
  ["eleven_v4_turbo", "Eleven v4 Turbo · 빠름"],
  ["eleven_v3", "Eleven v3 · 이전 세대"],
  ["eleven_v3_conversational", "Eleven v3 Conversational · 실시간용"],
  ["eleven_multilingual_v2", "Multilingual v2 · 안정적 · 태그 없음"],
  ["eleven_flash_v2_5", "Flash v2.5 · 가장 빠름 · 태그 없음"],
  ["eleven_flash_v2", "Flash v2 · 영어 전용 · 태그 없음"],
  ["__custom__", "직접 입력…"],
];
const FISH_MODELS = [
  ["s2.1-pro-free", "S2.1-Pro Free · 개인 테스트 추천"],
  ["s2.1-pro", "S2.1-Pro"],
  ["s2-pro", "S2-Pro · 이전 세대"],
];
const PHONE_THEME_CHOICES = [
  ["default", "기본", "#1c1c1e"],
  ["white", "베이지", "#efe5d8"],
  ["pink", "핑크", "#f7a0b8"],
  ["blue", "블루", "#8dbedc"],
];
const PHONE_LAUNCHER_CHOICES = [
  ["floating", "플로팅 버튼", "circle-dot"],
  ["menu", "마법봉 메뉴", "wand-magic-sparkles"],
  ["both", "둘 다", "clone"],
];
const TABS = [
  ["settings", "설정", "sliders"],
  ["state", "상태", "heart-pulse"],
  ["phone", "전화", "mobile-screen-button"],
  ["history", "기록", "clock-rotate-left"],
];
// 기록 holds both lists: every voice made, and the ones kept for good.
const HISTORY_VIEWS = [
  ["history", "전체 기록", "list"],
  ["favorites", "보관함", "star"],
];
// The settings tab in three parts: what all of SceneVoice uses, the people, the smartphone.
const PANES = [
  ["common", "공통", "sliders"],
  ["people", "캐릭터", "users"],
  ["phone", "스마트폰", "mobile-screen-button"],
];

const options = (items, selected) =>
  items
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join("");

// 프롬프트 직접 수정: the box shows the wording as it is sent (headed groups, a rule a line).
const promptPlain = normalizeStyle;
const promptShown = normalizeStyle;
const ENGINE_DETAIL_OPEN = "scenevoice_engine_detail_open";
function engineDetailOpen() {
  try {
    return localStorage.getItem(ENGINE_DETAIL_OPEN) === "1";
  } catch {
    return false;
  }
}

// 프롬프트 직접 수정: the wordings that can be rewritten (one box shows at a time).
const PROMPT_KINDS = [
  ["call_style", "전화", "통화에서 상대가 하는 말"],
  ["text_style", "문자", "상대가 보내는 문자"],
  ["group_call_style", "단체 통화", "단체 통화에서 사람들이 하는 말"],
  ["group_text_style", "단체 문자", "단체방에서 사람들이 보내는 문자"],
];
/** A number box's value, where 0 is a real choice and only an empty box falls back. */
const numberOr = (value, fallback) =>
  String(value).trim() === "" || !Number.isFinite(Number(value))
    ? fallback
    : Number(value);
const FOLD_STATES = "scenevoice_folds";
function foldStates() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLD_STATES) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
function keepFoldState(id, open) {
  try {
    localStorage.setItem(
      FOLD_STATES,
      JSON.stringify({ ...foldStates(), [id]: open }),
    );
  } catch {
    /* private mode: the fold just isn't remembered */
  }
}

export const panel = {
  async openPanel() {
    if (document.getElementById("sv-overlay")) await this.saveSettingsNow();
    await this.loadConfig();
    this.promptsApplied = null;
    await this.syncMultiCastCast?.({ panel: true });
    await this.refreshChatMemory();
    this.closeSetupGuide?.();
    document.getElementById("sv-overlay")?.remove();
    const config = this.config;
    const profiles = this.getConnectionProfiles().map((profile) => [
      profile.id,
      profile.name || profile.model || profile.id,
    ]);
    // Empty (off, or the same as 보조모델 분석), 현재 연결 사용, then the connection profiles.
    const profileSelect = (id, selected, emptyLabel) =>
      `<select id="${id}"><option value="">${emptyLabel}</option><option value="${CURRENT_CONNECTION}" ${selected === CURRENT_CONNECTION ? "selected" : ""}>현재 연결 사용</option>${options(profiles, selected)}</select>`;
    // What a feature costs in AI requests, said in a small pill after its name.
    const cost = (text) =>
      `<span class="sv-badge sv-cost"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>${text}</span>`;
    const number = (id, value, attrs) =>
      `<input type="number" id="${id}" ${attrs} value="${escapeHtml(value)}">`;
    const stMode = this.storageMode === "st";
    const fishAvailable = this.availableEngines.includes("fish");
    const launcher = config.phone?.launcher || "both";

    const divider = '<hr class="sv-divider">';
    const multicast = this.multicastApi?.();
    let multicastReads = false;
    try {
      multicastReads = Boolean(multicast?.isEnabled?.());
    } catch {
      /* an older MultiCast */
    }
    // What the default voices are for, also with only the phone in use.
    const defaultVoiceTip =
      "목소리를 따로 정하지 않은 인물이 성별에 맞춰 쓰는 목소리입니다(채팅 대사, 그리고 전화·문자). 채팅 대사 읽기를 끄면 쓰지 않으며, 그때 목소리 없는 연락처는 문자로만 주고받습니다.";
    // 저장됨 / 키 없음 beside each key; filled by noteKeyStates.
    const keyState = (engine) =>
      `<span class="sv-badge sv-key-state" data-sv-key-state="${engine}"></span>`;
    // 기본: the switch over everything, then the voice engine everything is voiced with.
    const basicGroup = groupHtml({
      id: "sv-group-basic",
      fold: true,
      open: true,
      icon: "power-off",
      title: "기본",
      scope: "채팅·스마트폰",
      tip: [
        "ElevenLabs 키는 실리태번 TTS 설정에서, Fish 키는 여기서 넣습니다. 키는 공유 목록·백업에 들어가지 않습니다.",
        "인물마다 엔진·목소리는 ‘캐릭터’ 탭에서 따로 정할 수 있고, 모델·속도 같은 나머지는 이 설정을 씁니다.",
      ].join("\n"),
      body: `${switchHtml({ id: "sv-active", label: "씬보이스 사용", tip: "끄면 모든 기능이 멈춥니다.\n저장된 기록과 설정은 그대로입니다.", checked: config.active !== false })}
      ${subTitle("sv-sub-engine", "wave-square", "음성 엔진", { cls: "sv-engine-sec" })}
      <div class="sv-row sv-engine-main">
        ${fieldHtml({
          id: "sv-engine",
          label: "엔진",
          control: `<select id="sv-engine">
            <option value="elevenlabs" ${config.engine === "elevenlabs" ? "selected" : ""}>ElevenLabs</option>
            <option value="fish" ${fishAvailable ? "" : "disabled"} ${config.engine === "fish" ? "selected" : ""}>Fish Audio</option>
          </select>`,
        })}
        ${fieldHtml({
          id: "sv-eleven-model",
          label: "음성 모델",
          cls: "sv-engine-section",
          attrs: 'data-engine="elevenlabs"',
          tip: [
            "태그([sighs] 등)는 v3·v4 계열만 연기합니다. 그 밖의 모델에는 태그를 빼고 보냅니다.",
            "새 모델은 ‘직접 입력…’에 모델 ID(예: eleven_v5)를 넣으십시오.",
          ].join("\n"),
          control: `<select id="sv-eleven-model">${options(ELEVEN_MODELS, ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? config.elevenlabs.model : "__custom__")}</select><input type="text" id="sv-eleven-model-custom" class="${ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? "hidden" : ""}" value="${escapeHtml(ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? "" : config.elevenlabs?.model || "")}" placeholder="모델 ID (예: eleven_v5)" autocomplete="off" spellcheck="false" aria-label="ElevenLabs 모델 ID 직접 입력">`,
        })}
        ${fieldHtml({ id: "sv-fish-model", label: "Fish 모델", cls: "sv-engine-section", attrs: 'data-engine="fish"', tip: "연기 태그를 [frustrated, emphatic]처럼 하나로 묶어 대사 앞에 붙입니다.", control: `<select id="sv-fish-model">${options(FISH_MODELS, FISH_MODELS.some(([value]) => value === config.fish?.model) ? config.fish.model : "s2.1-pro-free")}</select>` })}
      </div>
      ${subTitle("sv-sub-engine-key", "key", "API 키·보이스", { cls: "sv-engine-sec" })}
      ${stMode ? `<p class="sv-notice sv-engine-section" data-engine="elevenlabs"><i class="fa-solid fa-key" aria-hidden="true"></i><span>ElevenLabs API 키는 <b>실리태번 기본 TTS 설정 → ElevenLabs</b>에서 입력합니다${multicast ? "(MultiCast 확장에서 넣은 키도 같은 칸이라 그대로 씁니다)" : ""}.</span>${keyState("elevenlabs")}</p>` : ""}
      <div class="sv-row sv-engine-section" data-engine="elevenlabs" ${stMode ? "hidden" : ""}>
        ${fieldHtml({ id: "sv-eleven-key", label: "API 키", extra: keyState("elevenlabs"), control: `<input type="password" id="sv-eleven-key" autocomplete="off" ${stMode ? "disabled" : ""} placeholder="${config.elevenlabs?.has_api_key ? "저장된 키 유지 · 바꿀 때만 입력" : "ElevenLabs API 키"}">` })}
        <div class="sv-field sv-field-action sv-field-action-end"><button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-sv-clear-key="elevenlabs" ${stMode || !config.elevenlabs?.has_api_key ? "disabled" : ""}><i class="fa-solid fa-key" aria-hidden="true"></i><span>저장된 ElevenLabs 키 삭제</span></button></div>
      </div>
      <div class="sv-row sv-engine-section" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-key", label: "API 키", extra: keyState("fish"), control: `<input type="password" id="sv-fish-key" autocomplete="off" placeholder="${config.fish?.has_api_key ? "저장된 키 유지 · 바꿀 때만 입력" : "Fish Audio API 키"}">`, hint: "이 브라우저에만 저장됩니다. 실리태번 config.yaml의 enableCorsProxy: true가 필요합니다." })}
        <div class="sv-field sv-field-action sv-field-action-end"><button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-sv-clear-key="fish" ${config.fish?.has_api_key ? "" : "disabled"}><i class="fa-solid fa-key" aria-hidden="true"></i><span>이 브라우저의 Fish 키 삭제</span></button></div>
      </div>
      <div class="sv-engine-check">
        <button type="button" id="sv-engine-check" class="sv-btn sv-btn-sm"><i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i><span>연결 확인</span></button>
        <p id="sv-engine-check-result" class="sv-engine-check-result" role="status">키와 기본 보이스를 확인합니다. 음성을 만들지 않아 비용이 들지 않습니다.</p>
      </div>
      ${subTitle("sv-engine-detail", "sliders", "상세 설정", { open: engineDetailOpen(), cls: "sv-engine-sec", note: '<small id="sv-engine-detail-note"></small>' })}
      <div class="sv-row sv-engine-section sv-chat-only" data-engine="elevenlabs">
        ${["male", "female"]
          .map((gender) => {
            // Before the split there was one default voice; it fills whichever side is still empty.
            const value =
              config.elevenlabs?.[`voice_id_${gender}`] ||
              config.elevenlabs?.voice_id ||
              "";
            return fieldHtml({
              id: `sv-eleven-voice-${gender}`,
              label: `${gender === "male" ? "남성" : "여성"} 기본 목소리`,
              tip: defaultVoiceTip,
              control: voicePickHtml({
                id: `sv-eleven-voice-${gender}`,
                value,
                label: this.voiceName?.(value) || value,
                placeholder: "목록에서 고르기",
                empty: "비우기",
              }),
            });
          })
          .join("")}
      </div>
      <div class="sv-voice-tools sv-engine-section" data-engine="elevenlabs">
        <button type="button" id="sv-load-voices" class="sv-btn sv-btn-sm"><i class="fa-solid fa-arrow-rotate-right" aria-hidden="true"></i><span>보이스 목록 새로고침</span></button>
        <small class="sv-hint" id="sv-voice-tools-note"></small>
      </div>
      <hr class="sv-divider sv-engine-section sv-chat-only" data-engine="elevenlabs">
      <div class="sv-row sv-engine-section" data-engine="elevenlabs">
        ${fieldHtml({ id: "sv-eleven-stability", label: "연기 일관성", tip: "높을수록 차분하고 일정하게, 낮을수록 감정 기복이 크게 연기합니다.\n감정이 격한 대사는 이 값에서 조금만 더 풀어서 연기합니다(가장 격한 대사에서 값의 4분의 1까지). 평범한 대사는 이 값 그대로입니다.\nv3는 0 / 0.5 / 1 중 가까운 값으로 맞추고, 대사별로 풀지 않습니다.", control: rangeHtml({ id: "sv-eleven-stability", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.stability ?? 0.65 }) })}
        ${fieldHtml({ id: "sv-eleven-similarity", label: "원래 목소리 유사도", control: rangeHtml({ id: "sv-eleven-similarity", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.similarity_boost ?? 0.75 }) })}
      </div>
      <div class="sv-row sv-engine-section" data-engine="elevenlabs" id="sv-eleven-tune-row">
        ${fieldHtml({ id: "sv-eleven-speed", label: "말하기 속도", attrs: 'id="sv-eleven-speed-row"', tip: "0.7~1.2. Multilingual v2·Flash에만 적용됩니다(v4에는 없음).\n크게 바꾸면 발음이 어색해질 수 있습니다.", control: rangeHtml({ id: "sv-eleven-speed", min: 0.7, max: 1.2, step: 0.05, value: config.elevenlabs?.speed ?? 1 }) })}
        ${fieldHtml({ id: "sv-eleven-style", label: "스타일 과장도", attrs: 'id="sv-eleven-style-row"', hint: "v3·Multilingual v2에만 적용됩니다.", tip: "Style Exaggeration. 높일수록 목소리 특유의 말투를 과장합니다.\n불안정해질 수 있어 공식 안내는 대개 0을 권합니다.", control: rangeHtml({ id: "sv-eleven-style", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.style ?? 0.2 }) })}
      </div>
      <div class="sv-row sv-engine-section sv-chat-only" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-reference-male", label: "남성 기본 Reference ID", tip: defaultVoiceTip, control: `<input type="text" id="sv-fish-reference-male" value="${escapeHtml(config.fish?.reference_id_male || config.fish?.reference_id || "")}" placeholder="공개 또는 직접 만든 보이스 ID" autocomplete="off" spellcheck="false">` })}
        ${fieldHtml({ id: "sv-fish-reference-female", label: "여성 기본 Reference ID", tip: defaultVoiceTip, control: `<input type="text" id="sv-fish-reference-female" value="${escapeHtml(config.fish?.reference_id_female || config.fish?.reference_id || "")}" placeholder="공개 또는 직접 만든 보이스 ID" autocomplete="off" spellcheck="false">` })}
      </div>
      <div class="sv-row sv-engine-section" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-speed", label: "말하기 속도", control: rangeHtml({ id: "sv-fish-speed", min: 0.5, max: 2, step: 0.05, value: config.fish?.speed ?? 1 }) })}
      </div>
      ${SUB_END}
      <div class="sv-notice sv-mc-engine-note"><i class="fa-solid fa-link" aria-hidden="true"></i><span>MultiCast 확장을 사용 중이라 씬보이스의 음성 엔진 설정이 숨겨집니다. 전화·문자도 MultiCast 확장의 API 키와 음성 설정을 그대로 씁니다.</span></div>`,
    });

    // 채팅 대사: reading the chat's lines aloud, and which marked parts are read.
    const chatGroup = groupHtml({
      id: "sv-group-chat",
      fold: true,
      open: true,
      icon: "quote-left",
      title: "채팅 대사",
      body: `${switchHtml({ id: "sv-enabled", label: "채팅 대사 읽기", hint: "채팅 메시지의 대사·생각을 음성으로 만듭니다. 끄면 스마트폰 기능만 씁니다.", tip: multicast ? "채팅 대사를 MultiCast 확장으로 들을 때는 끄십시오. 씬보이스 설정은 MultiCast 확장과 따로입니다. 함께 쓰는 것은 ElevenLabs API 키(실리태번 기본 TTS 칸)와, 자동 연동한 인물의 목소리·연기 설정뿐입니다." : "", checked: config.enabled !== false })}
        <div class="sv-notice sv-chat-off-only"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>채팅 대사 읽기를 끄면 스마트폰에 쓰이는 설정만 보입니다.</span></div>
        <div class="sv-basic-chat">
          ${multicastReads ? '<div class="sv-notice sv-notice-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>MultiCast 확장도 채팅 대사를 읽고 있습니다. 한 확장만 읽게 하십시오. 이쪽 ‘채팅 대사 읽기’를 끄면 씬보이스는 스마트폰만 씁니다.</span></div>' : ""}
          <div class="sv-row">
            ${switchHtml({ id: "sv-line-buttons", label: "대사별 재생 버튼", hint: '대사 옆의 스피커(<i class="fa-solid fa-volume-low sv-inline-icon" aria-hidden="true"></i>) 모양 버튼입니다. 누르면 그 대사만 만들어 들려줍니다. 끄면 이어 듣기 버튼으로만 듣습니다.', checked: config.playback?.line_buttons !== false })}
            ${switchHtml({ id: "sv-prepare", label: "전체 이어 듣기 버튼", hint: '메시지 버튼 줄의 파형(<i class="fa-solid fa-wave-square sv-inline-icon" aria-hidden="true"></i>) 모양 버튼입니다. 누르면 대사를 차례로 만들며 이어서 들려줍니다. 분석 보기(<i class="fa-solid fa-wand-magic-sparkles sv-inline-icon" aria-hidden="true"></i> 다시 분석·내려받기)는 ⋯ 안에 있습니다.', checked: config.playback?.prepare !== false })}
          </div>
          <div class="sv-row">
            ${switchHtml({ id: "sv-auto-play", cls: "sv-basic-prepare", label: "새 답변 자동 음성 생성", hint: "새 AI 답변이 오면 분석과 음성 생성까지 미리 해 둡니다. 재생은 버튼을 누를 때 합니다.", tip: "지난 메시지와 통화 중에는 만들지 않습니다.\n음성을 만드는 만큼 비용이 듭니다.", checked: config.playback?.auto_new === true })}
            ${switchHtml({ id: "sv-level", label: "인물별 음량 맞춤", hint: "인물마다 다른 목소리 크기를, 들을 때 비슷하게 맞춥니다.", tip: "채팅 대사를 들으면서 인물별 평균 크기를 재고, 다른 인물보다 큰 목소리만 조금(최대 6dB) 줄입니다.\n대사 몇 개를 들은 뒤부터 적용됩니다.\n만든 음성 파일은 그대로이고 추가 비용이 없습니다.\n측정값은 이 기기에만 남습니다.", checked: config.playback?.level !== false })}
          </div>
          <div class="sv-row">
            <div class="sv-field">
              <div class="sv-label-line"><span id="sv-caption-label">읽고 있는 대사 자막</span>${infoTip("지금 읽는 대사를 한 줄로 띄웁니다.\n‘필요할 때만’은 화면의 대사와 짝이 맞지 않을 때(번역문만 보일 때)나 재생 버튼을 숨겼을 때 띄웁니다.\n자막을 누르면 멈추고, 한 번 더 누르면 멈춘 곳부터 이어 듣습니다.", "읽고 있는 대사 자막 설명")}</div>
              <div class="sv-seg" role="radiogroup" aria-labelledby="sv-caption-label">
                ${[
                  ["off", "끔"],
                  ["auto", "필요할 때만"],
                  ["always", "항상"],
                ]
                  .map(
                    ([value, label]) =>
                      `<label><input type="radio" name="sv-caption" value="${value}" ${(config.playback?.caption || "always") === value ? "checked" : ""}><span>${label}</span></label>`,
                  )
                  .join("")}
              </div>
              <small class="sv-hint">자막을 누르면 멈춤·이어 듣기</small>
            </div>
            <div class="sv-field">
              <div class="sv-label-line"><span id="sv-caption-at-label">자막 위치</span></div>
              <div class="sv-seg" role="radiogroup" aria-labelledby="sv-caption-at-label">
                ${[
                  ["top", "위"],
                  ["bottom", "아래"],
                ]
                  .map(
                    ([value, label]) =>
                      `<label><input type="radio" name="sv-caption-at" value="${value}" ${(config.playback?.caption_at || "bottom") === value ? "checked" : ""}><span>${label}</span></label>`,
                  )
                  .join("")}
              </div>
              <small class="sv-hint">위: 상단바 밑 · 아래: 입력창 위</small>
            </div>
          </div>
          <div class="sv-pause-command">
            <p class="sv-hint">QR 버튼으로도 멈춤·이어 듣기: <code>/sv-pause</code></p>
            <button type="button" id="sv-pause-qr" class="sv-btn sv-btn-sm"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>QR에 추가</span></button>
          </div>
        </div>
      ${this.readingSectionHtml(config)}`,
    });

    const analysisGroup = groupHtml({
      id: "sv-group-analysis",
      fold: true,
      open: true,
      icon: "wand-magic-sparkles",
      title: "보조모델 분석",
      scope: "채팅·스마트폰",
      extra: cost("채팅 메시지마다 요청 1회"),
      tip: [
        "하나의 메시지에 있는 대사를 한 번에 분석합니다. 채팅 원문은 바꾸지 않습니다.",
        "음성 엔진에는 원래 대사와 연기 태그만 보냅니다.",
        "분석 끔: 보조모델 없이 기본 연기로 읽습니다.\n현재 연결 사용: 실리태번에 지금 연결된 API·모델로 보냅니다(1.15 이상).\n연결 프로필: 실리태번의 지금 연결은 그대로 두고, 고른 프로필로 따로 보냅니다.\n요청마다 비용이 듭니다.",
      ].join("\n"),
      body: `${subTitle("sv-sub-analysis-link", "plug", "연결")}
      <div class="sv-row">
        ${fieldHtml({ id: "sv-connection-profile", label: "실리태번 연결 프로필", control: profileSelect("sv-connection-profile", config.connection_profile_id, "분석 끔") })}
      </div>
      <div class="sv-row sv-chat-only">
        ${fieldHtml({ id: "sv-context-messages", label: "참고할 채팅 메시지 수", control: number("sv-context-messages", Number(config.context_messages ?? 4), 'min="0"'), hint: "읽을 대사 앞의 실리태번 채팅 메시지 수입니다. 0이면 전부." })}
      </div>
      ${subTitle("sv-sub-analysis-chat", "comments", "채팅 읽기")}
      <div class="sv-row">
        ${fieldHtml({
          id: "sv-hidden-messages",
          label: "숨긴 메시지",
          control: `<select id="sv-hidden-messages">${options(
            [
              ["read", "원문 그대로 읽기"],
              ["summary", "요약으로 대신 읽기"],
            ],
            config.llm?.hidden_messages === "summary" ? "summary" : "read",
          )}</select>`,
          hint: "실리태번에서 숨긴 메시지를 상태 추적·전화·문자가 어떻게 읽을지 정합니다.",
          tip: "원문 그대로 읽기: 숨겨져 있어도 최근 메시지면 원문을 읽습니다.\n요약으로 대신 읽기: 숨긴 메시지는 읽지 않고, 채팅에 실제로 주입되고 있는 요약 글을 대신 읽습니다. 요약 확장이 원문을 숨기고 요약만 넣을 때 고르십시오.",
        })}
      </div>
      <div class="sv-injected sv-hidden-summary-only">
        <p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>지금 이 채팅에 주입되고 있는 글입니다. 씬보이스도 읽을 것을 고르십시오. 요약·기억으로 보이는 것은 미리 골라 두었습니다.</span></p>
        <div id="sv-injected-list" class="sv-injected-list"></div>
      </div>
      <div class="sv-row">
        ${switchHtml({ id: "sv-skip-command-replies", label: "QR로 받은 답변은 읽지 않기", hint: "QR·슬래시 명령(/sendas 등)으로 넣은 답변은 최근 채팅으로 읽거나 세지 않습니다.", tip: "이런 답변은 보통 이야기 밖(OOC) 내용이라, 상태 추적·전화·문자가 참고하지 않고 답변 수에도 넣지 않습니다.\n/sys 나레이션은 그대로 읽습니다. 대사 재생 버튼도 그대로 붙습니다.", checked: config.llm?.skip_command_replies !== false })}
      </div>
      ${subTitle("sv-sub-analysis-lines", "wand-magic-sparkles", "대사 분석", { cls: "sv-chat-only" })}
      <div class="sv-row sv-chat-only">
        ${switchHtml({
          id: "sv-analysis-enabled",
          cls: "sv-chat-only",
          label: "연기 태그 분석",
          hint: "대사마다 [calm] 같은 감정·말투 태그를 붙여 연기하게 합니다.",
          checked: config.analysis_enabled,
          tip: [
            "줄 앞에 보통 1~2개, 긴 대사는 문장 사이에도 [sighs] 같은 태그를 넣습니다.",
            "끄면 태그 없이 읽습니다.",
          ].join("\n"),
        })}
        ${switchHtml({ id: "sv-analysis-auto", cls: "sv-chat-only", label: "새 답변 자동 분석", hint: "새 AI 답변이 오면 화자·연기 태그를 미리 분석해 둡니다. 음성은 만들지 않습니다.", tip: "끄면 재생 버튼을 누를 때 분석을 시작합니다.\n켜면 기다림이 줄고 화자 확인이 필요한 대사를 미리 알 수 있지만, 듣지 않을 메시지도 메시지마다 보조모델 요청이 1번씩 늘어납니다.", checked: config.llm?.auto_analyze === true })}
      </div>
      ${subTitle("sv-sub-analysis-cast", "user-group", "화자 구분", { cls: "sv-chat-only" })}
      <div class="sv-row sv-chat-only">
        ${switchHtml({ id: "sv-casting-auto", label: "자동 화자 구분", hint: "보조모델이 등록한 이름·별명과 문맥으로 대사마다 화자를 고릅니다.", checked: config.casting?.auto_enabled })}
      </div>
      ${choiceListHtml({
        name: "sv-casting-uncertain",
        cls: "sv-chat-only sv-casting-only sv-choices-across",
        label: "화자가 불확실한 대사 (이어 듣기)",
        tip: "메시지의 이어 듣기 버튼으로 한 번에 만들 때만 적용됩니다.\n대사 버튼을 하나씩 누를 때는 화자를 고르라고 알려 드립니다.",
        value: config.casting?.uncertain === "default" ? "default" : "skip",
        choices: [
          ["skip", "forward", "건너뛰기", "화자를 고를 때까지 만들지 않습니다"],
          [
            "default",
            "user",
            "기본 목소리로 만들기",
            "보조모델이 추정한 성별에 맞춰 생성합니다",
          ],
        ],
      })}
      ${subTitle("sv-sub-analysis-sound", "volume-high", "소리 효과", { cls: "sv-chat-only" })}
      <div class="sv-row">
        <div class="sv-stack">
        ${switchHtml({
          id: "sv-eleven-sfx",
          label: "효과음 태그 넣기",
          hint: "장면에 어울리면 문 여닫는 소리, 발소리 같은 짧은 효과음을 넣습니다.",
          checked: config.elevenlabs?.sound_effects === true,
          tip: [
            "ElevenLabs v4·v3 모델일 때 엔진이 직접 소리를 냅니다(채팅 대사·전화·음성 메시지).",
            "채팅 대사는 연기 태그 분석이 켜져 있어야 넣습니다.",
            ...(this.soundNames?.().length
              ? [
                  "MultiCast 확장을 쓰면 전화·음성 메시지에는 MultiCast 확장에 있는 효과음 파일을 섞어서, 엔진과 상관없이 소리가 납니다(MultiCast 확장에 직접 넣은 소리 먼저).",
                ]
              : []),
          ].join("\n"),
        })}
        ${this.soundNames?.().length ? switchHtml({ id: "sv-sfx-in-file", cls: "sv-sfx-only", label: "효과음도 음성 파일에 저장", hint: "전화·음성 메시지에 넣은 MultiCast 확장 효과음을 목소리와 섞어 저장해 기록·보관함·내려받기에서도 함께 들립니다.", tip: "끄면 실리태번에서 들을 때만 효과음이 섞여 나오고, 기록·보관함·내려받기에서는 목소리만 들립니다.", checked: config.phone?.sfx_in_file !== false }) : ""}
        </div>
        ${switchHtml({ id: "sv-spatial", label: "공간감 및 좌우 효과", hint: "대사가 들리는 방향과 거리를 소리에 입힙니다. 이어폰에서 잘 느껴집니다.", tip: "대사를 분석할 때 좌·우와 가깝게·멀게·먹먹하게를 함께 정하고, 들을 때만 효과를 줍니다(만든 음성은 그대로).\n이미 분석한 메시지는 ‘분석 다시’ 뒤부터 적용됩니다.\n전화는 거리와 먹먹함만, 라디오는 진행자마다 자리를 나눕니다.", checked: config.playback?.spatial !== false })}
      </div>
      ${this.pronunciationSectionHtml(config)}
      ${subTitle("sv-sub-analysis-refs", "book-open", "분석에 참고할 자료", { cls: "sv-chat-only" })}
      <div class="sv-row sv-chat-only">
        ${switchHtml({ id: "sv-analysis-persona", label: "페르소나 설명 참고", hint: "대사 분석에 페르소나 Description도 보냅니다. 끄면 말투·연기 메모와 채팅만 봅니다.", checked: config.llm?.analysis_include_persona })}
        ${switchHtml({ id: "sv-analysis-character", label: "봇카드 설명 참고", hint: "대사 분석에 봇카드 Description도 보냅니다. 끄면 말투·연기 메모와 채팅만 봅니다.", checked: config.llm?.analysis_include_character !== false })}
      </div>
`,
    });

    const castingGroup = groupHtml({
      id: "sv-group-casting",
      fold: true,
      open: true,
      icon: "users",
      title: "캐릭터별 목소리",
      scope: "채팅·스마트폰",
      tip: [
        "별명을 함께 적으면 구분이 정확해집니다(예: 하루 / Haru, 봄이).",
        "화자가 확실하지 않은 대사는 대사 옆 ⋯ 메뉴에서 직접 고릅니다.",
      ].join("\n"),
      body: `<div id="sv-casting-settings"></div>`,
    });

    // The phone itself, then what calls and texts use whoever starts them, then 선연락.
    const smartphoneFold = groupHtml({
      id: "sv-fold-smartphone",
      fold: true,
      open: true,
      icon: "mobile-screen-button",
      title: "스마트폰",
      tip: [
        "전화와 문자에 함께 쓰는 설정입니다.",
        "전화·문자는 캐릭터와 페르소나 Description을 참고하고, 월드인포는 ‘캐릭터’ 탭 봇카드 공통 설정 → 스마트폰의 ‘월드인포 참고’를 켰을 때만 넣습니다.",
      ].join("\n"),
      body: `<div class="sv-row sv-phone-app-row">
          ${switchHtml({ id: "sv-phone-app", label: "스마트폰 사용", tip: "끄면 스마트폰과 플로팅 버튼·마법봉 메뉴가 사라지고, 기능하지 않습니다.\n저장된 전화·문자와 채팅 기억은 그대로입니다.", checked: config.phone?.app_enabled !== false })}
        </div>
        ${subTitle("sv-sub-phone-link", "plug", "연결·언어")}
        <div class="sv-row">
          ${fieldHtml({ id: "sv-phone-profile", label: "연결 프로필", control: profileSelect("sv-phone-profile", config.phone?.connection_profile_id, "보조모델 분석과 같게") })}
          ${fieldHtml({ id: "sv-phone-context", label: "참고할 채팅 메시지 수", control: number("sv-phone-context", Number(config.phone?.context_messages ?? 10), 'min="0"'), hint: "실리태번 채팅 메시지 수입니다. 0이면 전부. 연결 프로필의 최대 입력 토큰을 넘으면 오래된 메시지부터 잘립니다.", tip: "개수 제한은 없습니다.\n많이 넣을수록 요청 비용이 늘어납니다.\n보낼 자료가 연결 프로필의 최대 입력 토큰을 넘으면, 지시문과 캐릭터 설정(프로필, 월드인포, 말투·연기 메모)은 그대로 두고 채팅과 지금 주고받는 전화·문자가 남은 자리를 나눠 씁니다. 둘 다 오래된 것부터 잘립니다." })}
        </div>
        <div class="sv-row">
          ${fieldHtml({ id: "sv-default-language", label: "전화·문자 언어", control: `<select id="sv-default-language">${options(LANGUAGES, config.default_language)}</select>`, hint: "자동이면 ‘캐릭터’ 탭에서 인물마다 정한 언어, 정하지 않았으면 대화 언어로 말합니다.", tip: "여기서 언어를 고르면 인물 설정과 상관없이 모든 인물이 그 언어로 말합니다." })}
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-phone-translation-label">한국어 번역</span>${infoTip("같은 요청에서 함께 받으므로 요청 수는 늘지 않습니다.", "한국어 번역 설명")}</div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-phone-translation-label">
              ${[
                ["on", "함께 보기"],
                ["off", "원문만"],
              ]
                .map(
                  ([value, label]) =>
                    `<label><input type="radio" name="sv-phone-translation" value="${value}" ${(config.phone?.show_translation !== false) === (value === "on") ? "checked" : ""}><span>${label}</span></label>`,
                )
                .join("")}
            </div>
            <small class="sv-hint">한국어가 아닌 전화·문자에 번역을 아래에 붙입니다.</small>
          </div>
        </div>
        ${subTitle("sv-sub-phone-screen", "palette", "화면", { open: false })}
        <div class="sv-row">
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-phone-launcher-label">표시 위치</span></div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-phone-launcher-label">
              ${PHONE_LAUNCHER_CHOICES.map(([value, label, icon]) => `<label><input type="radio" name="sv-phone-launcher-mode" value="${value}" ${launcher === value ? "checked" : ""}><span><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${label}</span></label>`).join("")}
            </div>
          </div>
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-phone-theme-label">스마트폰 색</span></div>
            <div class="sv-seg sv-seg-swatch" role="radiogroup" aria-labelledby="sv-phone-theme-label">
              ${PHONE_THEME_CHOICES.map(([value, label, color]) => `<label><input type="radio" name="sv-phone-theme" value="${value}" ${(config.phone?.theme || "default") === value ? "checked" : ""}><span><i class="sv-swatch" style="--sw:${color}" aria-hidden="true"></i>${label}</span></label>`).join("")}
            </div>
          </div>
        </div>
        <div class="sv-row">
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-memory-view-label">채팅창에서 스마트폰 기록 보기</span>${infoTip("채팅 메시지 아래에 붙는 ‘전화·문자 채팅 기억’을 보여 주는 방식입니다.\n말풍선은 보이는 모양만 바꿉니다. AI에게 보내는 기억 글은 같고, ‘편집’을 누르면 그 원문을 고칩니다.\n직접 고쳐서 형식이 달라진 기억은 원문으로 보입니다.", "채팅 기억 보기 설명")}</div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-memory-view-label">
              ${[
                ["bubble", "말풍선"],
                ["text", "원문"],
              ]
                .map(
                  ([value, label]) =>
                    `<label><input type="radio" name="sv-memory-view" value="${value}" ${(config.chat_memory?.view || "bubble") === value ? "checked" : ""}><span>${label}</span></label>`,
                )
                .join("")}
            </div>
            <small class="sv-hint">전화·문자를 채팅 메시지 아래에 보여 주는 모양</small>
          </div>
        </div>
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-launcher-alerts", label: "알림이 올 때만 플로팅 버튼 표시", hint: "플로팅 버튼을 숨겼다가, 알림이 오면 확인할 때까지 보여 줍니다.", checked: config.phone?.launcher_events_only === true })}
          ${switchHtml({ id: "sv-phone-filter", label: "폰 음질 효과", hint: "전화·음성 메시지·음성 메모는 폰 너머 소리처럼, 라디오는 라디오 소리처럼 들립니다. 켜면 모두, 끄면 모두.", tip: "재생할 때만 입히고 저장된 음성은 그대로 둡니다.\n영상·내려받기의 통화 소리에도 같은 효과가 들어갑니다.", checked: config.phone?.audio_filter !== false })}
        </div>
        ${subTitle("sv-sub-phone-sound", "bell", "소리·진동", { open: false })}
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-sounds", label: "벨소리·알림음", hint: "전화가 걸려 오면 신호음이 울리고, 문자를 보내고 받을 때 짧은 소리가 납니다.", tip: "휴대폰 자체의 벨소리가 아니라 실리태번을 연 브라우저에서 나는 소리입니다.\n실리태번 탭이 열려 있어야 울리고, 휴대폰에서는 화면을 한 번 누른 뒤부터 소리가 납니다.\n꺼 두어도 걸려 온 전화는 화면 위쪽 알림으로 보입니다.", checked: config.phone?.ringtone !== false || config.voice_message?.sounds !== false })}
        </div>
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-vibration", label: "모바일 진동", hint: "전화가 걸려 올 때 진동합니다. 안드로이드 크롬처럼 진동을 지원하는 브라우저에서만 됩니다(아이폰은 안 됨).", checked: config.phone?.vibration !== false })}
        </div>`,
    });

    const appsFold = groupHtml({
      id: "sv-fold-apps",
      fold: true,
      icon: "comments",
      title: "전화·문자·앱",
      tip: [
        "누가 선연락했든 전화·문자에 똑같이 쓰는 설정입니다.",
        "전화는 글로 답하는 역할극 통화입니다(마이크 인식 아님). 상대 대사는 그 인물의 목소리로 읽습니다.",
        "문자는 글로 오고, 말풍선의 재생 버튼을 누를 때 음성을 만듭니다.",
        "상태 탭에서 ‘바쁨’인 인물에게 건 전화는 그 사람의 음성사서함으로 갑니다(인사말은 처음 한 번 만들어 둡니다). 남기든 그냥 끊든 몇 분 뒤 문자나 전화로 연락이 오고, 그 전에 다시 걸면 받습니다.",
      ].join("\n"),
      body: `${subTitle("sv-sub-apps-call", "phone", "전화")}
        <div class="sv-row">
          ${choiceListHtml({
            name: "sv-phone-voice-mode",
            cls: "sv-choices-across",
            label: "전화 음성 만들기",
            value: config.phone?.auto_voice === false ? "tap" : "auto",
            choices: [
              [
                "auto",
                "bolt",
                "바로 생성",
                "상대가 대답하자마자 만들어 재생합니다",
              ],
              [
                "tap",
                "hand-pointer",
                "누를 때 생성",
                "‘재생’을 눌러야 만들어 그만큼 비용을 아낍니다",
              ],
            ],
          })}
        </div>
        ${subTitle("sv-sub-apps-text", "comment-dots", "문자")}
        <div class="sv-row">
          ${switchHtml({ id: "sv-voice-message-reply-voice", label: "문자 답장에 음성 메시지도 섞기", hint: "보통은 문자로 답하고, 어울릴 때만 녹음해서 보내는 음성 메시지로 답합니다.", checked: config.voice_message?.reply_voice !== false })}
          ${switchHtml({ id: "sv-voice-message-auto-audio", label: "음성 메시지는 받는 즉시 음성까지 생성", hint: "켜면 듣지 않은 음성 메시지도 음성 생성 비용이 듭니다.", tip: "문자는 이 설정과 상관없이 ‘재생’을 누를 때만 음성을 만듭니다.", checked: config.voice_message?.auto_generate_audio })}
        </div>
        <div class="sv-row">
          ${switchHtml({ id: "sv-other-chats", label: "자기가 속한 다른 문자·전화 내용도 알기", hint: "문자나 전화를 할 때, 그 인물이 들어 있던 다른 대화와 통화의 내용을 기억하고 말합니다.", tip: "그 인물이 속한 1:1 문자, 단체방, 인물끼리의 방, 통화의 최근 내용을 함께 보냅니다(문자는 방마다 ‘참고할 문자 수’만큼, 통화는 ‘참고할 다른 통화 수’만큼 통화 전체).\n글자 수로 자르지 않습니다. 연결 프로필의 최대 입력 토큰을 넘을 때만 줄이는데, 다른 방·통화 → 나와의 1:1 문자 → 지금 대화 순으로, 오래된 것부터 뺍니다.\n자기가 들어 있지 않은 방의 내용은 모릅니다.\n끄면 지금 대화와 지난 통화만 압니다.", checked: config.voice_message?.other_chats !== false })}
        </div>
        <div class="sv-row">
          ${fieldHtml({ id: "sv-thread-messages", label: "참고할 문자 수 (대화마다)", control: number("sv-thread-messages", Number(config.voice_message?.thread_messages ?? 40), 'min="0" max="1000"'), hint: "지금 대화와 다른 대화 모두, 대화마다 최근 이만큼의 문자를 보냅니다. 0이면 전부.", tip: "많을수록 요청이 길어져 비용이 늘어납니다.\n연결 프로필의 최대 입력 토큰을 넘으면 다른 방·통화의 오래된 것부터 뺍니다." })}
          ${fieldHtml({ id: "sv-other-calls", cls: "sv-other-chats-only", label: "참고할 다른 통화 수", control: number("sv-other-calls", Number(config.voice_message?.other_calls ?? 3), 'min="0" max="30"'), hint: "그 인물이 한 다른 통화를 최근 것부터 이만큼, 통화 내용 전체로 보냅니다. 0이면 전부(최근 30건까지)." })}
        </div>
        ${subTitle("sv-sub-apps-apps", "table-cells-large", "앱")}
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-memo", label: "음성 메모 앱", hint: "인물이 혼자 스마트폰에 남기는 음성 메모를 홈 화면의 ‘음성 메모’에서 만들어 엿듣습니다.", tip: "엿듣기용이라 채팅 기억에는 넣지 않고, 메모 카드에 몇 번째 채팅 무렵인지만 표시합니다.\n메모 하나에 보조모델 요청 1번, 목소리는 들을 때 만듭니다.\n인물이 저절로 남기는 메모는 ‘선연락’에서 켜고 끕니다.", checked: config.phone?.memo_app !== false })}
          ${switchHtml({ id: "sv-phone-radio", label: "라디오", hint: "인물들이 지금까지의 이야기를 두고 떠드는 라디오, 또는 내 사연을 읽어 주는 방송을 홈 화면 ‘라디오’에서 만들어 듣습니다.", tip: "재미용 번외 기능입니다.\n방송 하나에 보조모델 요청 1번, 목소리는 들을 때 만듭니다.\n채팅 기억에는 들어가지 않습니다.", checked: config.phone?.radio_app !== false })}
        </div>`,
    });

    const outreachFold = groupHtml({
      id: "sv-fold-outreach",
      fold: true,
      icon: "bell",
      title: "선연락·인물별 상태 추적",
      badge: badgeHtml("sv-outreach-enabled"),
      tip: [
        "인물이 먼저 걸어 오는 전화, 먼저 보내는 문자, 혼자 남기는 음성 메모, 인물끼리의 통화를 여기서 켜고 끕니다.",
        "누가 얼마나 자주 연락하는지는 ‘캐릭터’ 탭에서 인물마다 ‘선연락 빈도’로 정합니다. ‘상태 분석에서 제외’한 인물은 연락하지 않습니다.",
        "봇카드마다 ‘캐릭터’ 탭 봇카드 공통 설정 → 스마트폰의 ‘선연락 받기’를 켠 곳에서만 옵니다(기본은 꺼짐).",
        "걸려 온 전화는 받기 전에는 대사나 음성을 만들지 않고, 1분 동안 받지 않으면 부재중이 됩니다.",
      ].join("\n"),
      body: `<div class="sv-state-block">
        <div class="sv-row sv-state-switch-row">
          ${switchHtml({
            id: "sv-state-enabled",
            label: "인물별 상태 추적 사용",
            hint: "인물마다 지금 상태를 채팅에서 읽어 둡니다. 채팅 대사 분석이 참고합니다.",
            checked: config.state_tracking?.enabled,
            extra: infoTip(
              [
                "연락처의 인물마다(페르소나 제외) 신체·감정·생각·관계 상태를 따로 저장하고, 대사 분석과 전화·문자가 그 인물의 상태를 참고합니다.",
                "한 번의 요청으로 인물 전원을 살피며, 최근 채팅에서 새로 드러난 게 있는 인물만 바뀝니다(마지막으로 확인된 상태를 간직).",
                "장면을 떠난 인물은 ‘장면 밖’, 어디 있는지 모르면 ‘행방 모름’으로 표시합니다. 상태 탭에서 보고 직접 고칠 수 있습니다.",
                "새 채팅에 첫 메시지(그리팅)만 있을 때는 자동으로 분석하지 않습니다. 필요하면 상태 탭의 ‘지금 분석’을 누르세요.",
                "‘바쁨’인 인물에게 건 전화가 음성사서함으로 가는 것, 장면 밖 인물이 모르는 일을 모르는 것도 이 상태를 씁니다.",
              ].join("\n"),
              "인물별 상태 추적 설명",
            ),
          })}
        </div>
        </div>
        <div class="sv-row">
          ${switchHtml({ id: "sv-outreach-enabled", cls: "sv-phone-only", label: "선연락 사용 (공통 설정)", hint: "끄면 아래에서 고른 것은 그대로 둔 채, 어떤 채팅방에서도 선연락을 하지 않습니다.", checked: config.outreach?.enabled === true })}
        </div>
        <p class="sv-notice sv-phone-only sv-outreach-on-only" id="sv-outreach-card-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span></span><button type="button" class="sv-btn sv-btn-sm" id="sv-outreach-card-link"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>바로가기</span></button></p>
        <div class="sv-stack-col sv-phone-only sv-outreach-on-only">
        <div class="sv-row sv-phone-only">
          ${choiceListHtml({
            name: "sv-outreach-mode",
            cls: "sv-choices-across sv-choices-three",
            label: "연락 방식",
            value: ["random", "time"].includes(config.outreach?.mode)
              ? config.outreach.mode
              : "state",
            tip: [
              "인물별 상태 추적: 인물들의 상태를 주기마다 갱신하면서 ‘지금 연락할 만한 사람’을 함께 고르고(추가 요청 없음), 인물별 빈도로 실제 연락할지 정합니다. 함께 있는 인물은 고르지 않고, 자는 인물은 연락하지 않습니다.",
              "랜덤: 실리태번 채팅에 AI 답변이 올 때마다 인물별로 주사위를 굴립니다. 누가 연락할지는 AI가 고르지 않고 주사위가 정하며, 걸리기 전에는 요청이 나가지 않습니다.",
              "시간: 실리태번 채팅과 상관없이, 실제 시간이 정한 만큼 지나면 누군가 연락합니다. 누가 할지는 인물별 ‘선연락 빈도’가 높을수록 잘 뽑히고, 실리태번 창(탭)이 열려 있는 동안에만 동작합니다.",
              "어느 방식이든 나에게는 한 번에 두 명까지 연락하고, 그중 전화는 한 명입니다.",
              "봇카드마다 다른 방식을 쓰려면 ‘캐릭터’ 탭 봇카드 공통 설정 → 스마트폰의 ‘연락 방식’에서 고릅니다. 방식별 세부 설정은 여기서 그 방식을 눌러 바꾸고, 방식을 바꿔도 값은 남습니다.",
            ].join("\n"),
            choices: [
              [
                "state",
                "heart-pulse",
                "인물별 상태 추적",
                "이야기에 맞을 때 연락 · 주기마다 요청 1번",
              ],
              [
                "random",
                "dice",
                "랜덤",
                "추가 요청 없이 확률로 연락 · 가끔 어긋남",
              ],
              ["time", "clock", "시간", "채팅을 안 해도 시간이 지나면 연락"],
            ],
          })}
        </div>
        <p class="sv-notice sv-phone-only sv-mode-state-only"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>답변이 정한 만큼 쌓일 때마다 보조모델이 인물들의 상태를 살피고 ‘지금 연락할 만한 사람’을 고릅니다. 고른 사람은 자기 ‘선연락 빈도’만큼의 확률로 연락하고, 급한 일일수록 잘 옵니다.</span></p>
        <p class="sv-notice sv-phone-only sv-mode-random-only"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span id="sv-random-example"></span></p>
        <p class="sv-notice sv-phone-only sv-mode-time-only"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>채팅을 하지 않아도, 아래 ‘연락 간격’ 사이의 무작위 시간이 지날 때마다 켜 둔 것 중 한 가지가 일어납니다(나에게 연락, 단체방 대화, 음성 메모 등). 다른 봇카드와 채팅하고 있을 때도 문자는 옵니다. 봇카드 공통 설정에서 ‘실제 시간 인식’을 켜 두면 더 현실적입니다. 실리태번 창이 열려 있는 동안에만 됩니다.</span></p>
        <div class="sv-read-actions sv-phone-only">
          <button type="button" class="sv-btn sv-btn-sm" id="sv-outreach-compare"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i><span>세 방식 자세히 비교</span></button>
        </div>
        </div>
        <div class="sv-row sv-row-3 sv-state-fields">
          ${fieldHtml({ id: "sv-state-profile", label: "상태 분석 연결 프로필", control: profileSelect("sv-state-profile", config.state_tracking?.connection_profile_id, "보조모델 분석과 같게") })}
          ${fieldHtml({ id: "sv-state-every", extra: cost("주기마다 요청 1회"), label: "상태 갱신 주기 (채팅 답변 수)", control: number("sv-state-every", Number(config.state_tracking?.every_messages ?? 3), 'min="1" max="20"'), hint: "실리태번 채팅에 새 AI 답변이 이만큼 쌓일 때마다 갱신하고, 선연락할지도 이때 정합니다. 스마트폰 안의 답장은 세지 않습니다." })}
          ${fieldHtml({ id: "sv-state-context", label: "참고할 채팅 메시지 수", control: number("sv-state-context", Number(config.state_tracking?.context_messages ?? 6), 'min="0"'), hint: "실리태번 채팅 메시지 수입니다. 0이면 전부. 이 메시지들에서 새로 드러난 게 있는 인물만 갱신합니다." })}
        </div>
        <div class="sv-stack-col sv-phone-only sv-outreach-on-only">
        <div class="sv-row sv-row-3 sv-phone-only sv-mode-time-only">
          <div class="sv-field">
            <div class="sv-label-line"><span>연락 간격 (분)</span>${infoTip("이 두 값 사이에서 매번 무작위로 기다립니다.\n예: 30~120이면 30분에서 2시간 사이.\n누군가 나에게 연락한 뒤에는 적어도 앞의 값만큼은 다시 나에게 연락하지 않습니다.", "연락 간격 설명")}</div>
            <div class="sv-range-pair">${number("sv-time-min", Number(config.outreach?.time_min ?? 30), 'min="1" max="1440" aria-label="연락 간격 최소(분)"')}<span>~</span>${number("sv-time-max", Number(config.outreach?.time_max ?? 120), 'min="1" max="1440" aria-label="연락 간격 최대(분)"')}<span>분</span></div>
          </div>
          ${fieldHtml({ id: "sv-time-daily", label: "나에게 오는 연락 하루 최대", control: number("sv-time-daily", Number(config.outreach?.time_daily_max ?? 6), 'min="0" max="50"'), hint: "봇카드별 · 0이면 제한 없음", tip: "봇카드마다 따로 셉니다(그 봇카드의 채팅에 온 전화·문자).\n나에게 오는 전화·문자만 세고, 단체방은 방마다 정한 ‘하루 최대’를 따릅니다." })}
          ${switchHtml({ id: "sv-time-fit", label: "상황에 맞을 때만 연락", hint: "차례가 왔을 때 지금 연락이 말이 되는지 보고, 어색하면 넘깁니다.", checked: config.outreach?.random_fit !== false })}
        </div>
        <div class="sv-row sv-phone-only sv-mode-random-only">
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-random-level-label">공통 연락 빈도</span></div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-random-level-label">
              ${[
                ["low", "드물게"],
                ["normal", "보통"],
                ["high", "자주"],
              ]
                .map(
                  ([value, label]) =>
                    `<label><input type="radio" name="sv-random-level" value="${value}" ${(config.outreach?.random_level || "normal") === value ? "checked" : ""}><span>${label}</span></label>`,
                )
                .join("")}
            </div>
          </div>
          ${switchHtml({ id: "sv-random-fit", label: "상황에 맞을 때만 연락", hint: "걸렸을 때 지금 연락이 말이 되는지 보고, 어색하면 넘깁니다.", tip: "문자·음성 메시지는 글을 쓰는 요청 안에서 함께 판단합니다(추가 요청 없음).\n전화는 울리기 전에 첫 대사를 미리 쓰면서 함께 판단합니다. 받으면 그 대사로 바로 시작해서 추가 요청이 없고, 받지 않거나 어색해서 넘긴 전화에는 그 요청 1번이 쓰입니다.\n끄면 걸리는 대로 연락합니다. 같은 자리에 있어도 전화나 문자가 올 수 있습니다.\n음성 메모와 엿듣는 통화는 내 캐릭터가 모르는 일이라 따로 확인하지 않습니다.", checked: config.outreach?.random_fit !== false })}
        </div>
        </div>
        <div class="sv-stack-col sv-phone-only sv-outreach-on-only">
        ${subTitle("sv-sub-reach-call", "phone", "전화", { cls: "sv-phone-only" })}
        <div class="sv-toggle-group sv-phone-only">
        <div class="sv-row sv-toggle-head">
          ${switchHtml({ id: "sv-phone-auto", label: "먼저 전화하기", hint: "인물이 나에게 전화를 걸거나, 인물끼리 통화합니다.", checked: config.phone?.auto_enabled })}
        </div>
        <div class="sv-sub-block sv-auto-call-only">
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-call-me", extra: cost("대사마다 요청 1회"), label: "나에게 전화", hint: "인물이 나에게 먼저 전화를 겁니다.", checked: config.phone?.call_me !== false })}
          ${switchHtml({ id: "sv-phone-voicemail", extra: cost("남길 때 요청 1회"), cls: "sv-call-me-only", label: "음성 사서함", hint: "걸려 온 전화를 거절하거나 1분 안에 받지 않으면 상대가 짧은 음성 메시지를 남깁니다.", tip: "남길 때마다 보조모델 요청이 한 번 들고, ‘전화 음성 만들기’가 ‘바로 생성’이면 목소리도 바로 만듭니다.\n통화 기록에서 듣고, 채팅 기억에도 그 통화와 함께 남습니다.\n다시 전화하면 상대는 내가 전화를 못 받은 걸 압니다.", checked: config.phone?.voicemail !== false })}
        </div>
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-overheard", extra: cost("통화마다 요청 1회"), label: "인물끼리 전화 (엿듣는 통화)", hint: "떨어져 있는 인물들끼리 가끔 알아서 통화하고, 통화 기록에서 엿들을 수 있습니다.", tip: "상황 판단: 상태를 갱신할 때 둘이 지금 통화할 만하다고 판단되면, 거는 사람의 ‘선연락 빈도’만큼의 확률로 생깁니다.\n랜덤: 답변마다 공통 연락 빈도와 같은 확률로 두 사람이 통화합니다(통화 사이에 답변 6번은 쉽니다).\n꺼 두어도 통화 기록의 ‘통화 엿듣기’로 직접 만들 수 있습니다.\n대사는 요청 한 번에 받아 두고, 목소리는 ‘전체 듣기’를 누를 때 만듭니다.\n내 캐릭터는 이 통화를 모르고, 채팅 기억에도 ‘내 캐릭터는 듣지 못한 통화’로 남습니다.", checked: config.phone?.overheard_calls === true })}
          <div class="sv-field sv-overheard-only">
            <div class="sv-label-line"><span id="sv-phone-overheard-length-label">엿듣는 통화 길이</span>${infoTip("저절로 생기는 엿듣는 통화의 길이입니다.\n짧게 4~6줄 · 보통 6~12줄 · 길게 12~20줄. 길수록 요청·음성 비용이 늘어납니다.\n통화 기록의 ‘통화 엿듣기’로 직접 만들 때는 그 자리에서 따로 고릅니다(처음 값은 이 설정).\n줄 수는 대략이라 조금 넘나들 수 있습니다.", "엿듣는 통화 길이 설명")}</div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-phone-overheard-length-label">
              ${OVERHEARD_LENGTH_CHOICES.map(([value, label]) => `<label><input type="radio" name="sv-phone-overheard-length" value="${value}" ${(config.phone?.overheard_length || "normal") === value ? "checked" : ""}><span>${label.split(" (")[0]}</span></label>`).join("")}
            </div>
          </div>
        </div>
        </div>
        </div>
        ${subTitle("sv-sub-reach-text", "comment-dots", "문자", { cls: "sv-phone-only" })}
        <div class="sv-toggle-group sv-phone-only">
        <div class="sv-row sv-toggle-head">
          ${switchHtml({ id: "sv-voice-message-enabled", label: "먼저 문자 보내기", hint: "인물이 나에게 문자를 보내거나, 인물끼리 문자를 나눕니다.", checked: config.voice_message?.enabled })}
        </div>
        <div class="sv-sub-block sv-auto-text-only">
        <div class="sv-row">
          ${switchHtml({ id: "sv-text-me", extra: cost("문자마다 요청 1회"), label: "나에게 문자", hint: "인물이 나에게 먼저 문자나 음성 메시지를 보내고, 내가 있는 단체방에서 먼저 말을 꺼냅니다.", tip: "단체방에서 먼저 말을 꺼내는 것은 방 설정의 ‘주기마다 알아서 대화’를 켠 방에서만 합니다.\n이 스위치를 끄면 그 방들도 멈추고, 다시 켜면 방마다 정해 둔 대로 돌아옵니다.", checked: config.voice_message?.text_me !== false })}
          ${switchHtml({ id: "sv-text-overheard", extra: cost("대화마다 요청 1회"), label: "인물끼리 문자 (엿보는 문자)", hint: "나 없는 방에서 인물들이 알아서 대화하고, 문자 목록에서 엿볼 수 있습니다.", tip: "내가 만든 나 없는 방은 방 설정의 ‘주기마다 알아서 대화’를 켜면 주기마다 대화합니다.\n인물들이 스스로 만드는 방은 아래 ‘스스로 대화하기’를 켜면 이야기에 맞을 때만 대화합니다.\n이 스위치를 끄면 그 방들도 멈추고, 다시 켜면 방마다 정해 둔 대로 돌아옵니다.\n꺼 두어도 방 안의 ‘대화 이어 보기’ 버튼으로 직접 이어 볼 수 있습니다.\n내 캐릭터는 이 대화를 모릅니다.", checked: config.voice_message?.overheard_texts === true })}
        </div>
        <div class="sv-row sv-overheard-text-only">
          ${switchHtml({ id: "sv-rooms-self", extra: cost("대화마다 요청 1~2회"), label: "스스로 대화하기", hint: "이야기에 서로 문자할 이유가 생겼을 때만, 인물들이 나 없는 방을 만들거나 전에 만든 방에서 다시 대화합니다. 주기로 돌지 않습니다.", tip: "인물별 상태 추적: 상태를 갱신하는 요청에서 ‘지금 서로 문자할 사람들’도 함께 판단합니다(추가 요청 없음).\n랜덤·시간: 차례가 오면 짧은 요청 1번으로 판단하고, 아무도 없으면 넘어갑니다.\n대화를 쓰는 데 요청 1번이 듭니다.\n스스로 만든 방은 채팅마다 5개까지이고, 방마다 ‘하루 최대’를 넘지 않습니다.\n방 설정에서 ‘주기마다 알아서 대화’를 켜면 그 방은 주기로도 대화합니다.\n내가 직접 만든 방은 건드리지 않습니다.", checked: config.voice_message?.rooms_self === true })}
        </div>
        <p class="sv-mini-title"><span>단체방 기본값</span>${infoTip("따로 정하지 않은 단체방은 모두 이 값을 따릅니다. 여기서 바꾸면 그 방들도 바로 바뀝니다.\n한 방만 다르게 하려면 문자 앱의 방 설정에서 ‘이 방만 따로 정하기’를 켭니다.\n대화 주기는 ‘주기마다 알아서 대화’를 켠 방에, 하루 최대 횟수는 그 방들과 인물들이 스스로 만든 방에, 한 번에 생성할 대사는 나 없는 방에 쓰입니다.", "단체방 기본값 설명")}</p>
        <div class="sv-row sv-mode-count-only">
          ${fieldHtml({ id: "sv-room-def-every", label: "대화 주기 (채팅 답변 수)", control: number("sv-room-def-every", Number(config.voice_message?.room_defaults?.auto_every ?? 8), 'min="1" max="50"'), hint: "실리태번 채팅에 새 AI 답변이 이만큼 쌓일 때마다 한 번 대화합니다.", tip: "스마트폰 안의 답장은 세지 않습니다.\n시간 방식에서는 쓰지 않습니다(차례가 올 때 대화)." })}
        </div>
        <div class="sv-row">
          ${fieldHtml({ id: "sv-room-def-daily", label: "하루 최대 횟수 (0 = 제한 없음)", control: number("sv-room-def-daily", Number(config.voice_message?.room_defaults?.auto_daily_max ?? 4), 'min="0" max="100"') })}
          <div class="sv-field">
            <div class="sv-label-line"><span>한 번에 생성할 대사</span>${infoTip("나 없는 방에서 ‘대화 이어 보기’를 누를 때 쓰는 개수입니다.\n알아서 대화할 때는 한 번에 6개까지만 씁니다.", "한 번에 생성할 대사 설명")}</div>
            <div class="sv-range-pair">${number("sv-room-def-min", Number(config.voice_message?.room_defaults?.burst_min ?? 6), 'min="1" max="30" aria-label="한 번에 생성할 대사 최소"')}<span>~</span>${number("sv-room-def-max", Number(config.voice_message?.room_defaults?.burst_max ?? 15), 'min="1" max="30" aria-label="한 번에 생성할 대사 최대"')}<span>개</span></div>
          </div>
        </div>
        </div>
        </div>
        ${subTitle("sv-sub-reach-memo", "microphone", "음성 메모", { cls: "sv-phone-only sv-memo-app-only", note: cost("메모마다 요청 1회") })}
        <div class="sv-row sv-phone-only">
          ${switchHtml({ id: "sv-phone-memo-auto", cls: "sv-memo-app-only", label: "인물이 알아서 음성 메모 남기기", hint: "인물이 가끔 혼자 음성 메모를 남깁니다.", tip: "인물별 상태 추적: 상태를 갱신할 때 ‘지금 메모를 남길 만한 사람’을 함께 판단해(추가 요청 없음) 그중 30% 정도만 실제로 남깁니다. 한 번에 한 명까지, 자는 중이면 남기지 않습니다. 전화·문자 중 하나는 켜져 있어야 상태를 갱신합니다.\n랜덤: 답변마다 공통 연락 빈도와 같은 확률로 한 명이 남깁니다.\n메모 하나에 보조모델 요청 1번, 목소리는 들을 때 만듭니다.", checked: config.phone?.memo_auto !== false })}
        </div>`,
    });

    const promptFold = groupHtml({
      id: "sv-fold-prompts",
      fold: true,
      icon: "pen-to-square",
      title: "프롬프트 직접 수정",
      badge: `<span class="sv-badge" id="sv-prompt-badge"></span>`,
      tip: [
        "전화·문자·단체 통화·단체 문자에서 말투·길이·대화 흐름·인물 묘사를 정하는 지시문입니다. 실제로 보내는 글 그대로 보입니다.",
        "‘## ’으로 시작하는 줄은 묶음 제목, ‘- ’로 시작하는 줄은 지시 하나입니다. 제목과 묶음은 자유롭게 고치거나 새로 만들 수 있습니다.",
        "적은 그대로 보냅니다. ‘-’나 ‘##’를 자동으로 붙이지 않으니 필요한 줄에 직접 적으십시오(빈 줄만 지워집니다).",
        "한국어로 쓸 때 페르소나 인물은 ‘유저’가 아니라 ‘유저 캐릭터’라고 쓰십시오(‘유저’는 실제 사용자로 읽힙니다).",
        "역할, 자료 읽는 법, 출력 형식은 고정이라 여기서 바꿔도 답의 형식은 유지됩니다.",
        "한국어로 써도 되지만 영어가 더 잘 지켜집니다.",
        "음성 메시지, 음성 메모, 라디오는 기본 지시문을 그대로 씁니다.",
        "고쳐 두면 이후 업데이트로 기본 지시문이 나아져도 고친 쪽을 계속 씁니다.",
      ].join("\n"),
      body: `<div class="sv-seg sv-prompt-pick" role="radiogroup" aria-label="고칠 지시문">
          ${PROMPT_KINDS.map(([field, label], index) => `<label><input type="radio" name="sv-prompt-pick" value="${field}" ${index ? "" : "checked"}><span>${label}</span></label>`).join("")}
        </div>
        ${PROMPT_KINDS.map(
          (
            [field, label, about],
            index,
          ) => `<div class="sv-field sv-prompt-edit" data-prompt="${field}" ${index ? "hidden" : ""}>
          <div class="sv-label-line"><label for="sv-prompt-${field}">${label}</label><span class="sv-badge sv-prompt-state"></span></div>
          <textarea id="sv-prompt-${field}" data-prompt-text rows="12" maxlength="6000" spellcheck="false" aria-label="${about}의 문체 지시문">${escapeHtml(promptShown(config.prompts?.[field] || STYLE_DEFAULTS[field]))}</textarea>
          <div class="sv-prompt-actions">
            <span class="sv-hint" data-prompt-status role="status"></span>
            <button type="button" class="sv-btn sv-btn-sm" data-prompt-reset><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>기본값으로 되돌리기</span></button>
            <button type="button" class="sv-btn sv-btn-sm sv-btn-primary" data-prompt-apply><i class="fa-solid fa-check" aria-hidden="true"></i><span>적용</span></button>
          </div>
        </div>`,
        ).join("")}`,
    });

    const extraGroup = groupHtml({
      id: "sv-group-extra",
      fold: true,
      open: false,
      icon: "pen-nib",
      title: "추가 지침",
      scope: "채팅·스마트폰",
      badge: `<span class="sv-badge sv-badge-on" id="sv-extra-badge" ${config.llm?.extra_instructions?.trim() ? "" : "hidden"}>적용 중</span>`,
      tip: [
        "여기 적은 글을 보조모델에게 보내는 모든 요청(대사 분석, 상태 추적, 전화, 문자, 음성 메모, 라디오 등)의 맨 끝에 사용자 지시로 그대로 덧붙입니다.",
        "비워 두면 아무것도 붙지 않습니다.",
        "답의 형식(JSON)을 바꾸라는 내용은 적지 마십시오. 답을 읽지 못해 기능이 멈춥니다.",
        "한국어로 써도 되지만 영어가 더 잘 지켜집니다.",
      ].join("\n"),
      body: `<div class="sv-field sv-extra-edit">
          <textarea id="sv-extra-instructions" rows="5" maxlength="6000" spellcheck="false" aria-label="추가 지침">${escapeHtml(config.llm?.extra_instructions || "")}</textarea>
          <small class="sv-hint">자유 작성 · 지침 맨 끝에 항상 덧붙임</small>
        </div>`,
    });

    const storageFold = groupHtml({
      id: "sv-fold-storage",
      fold: true,
      icon: "hard-drive",
      title: "저장 공간",
      tip: [
        "음성과 목록·설정은 실리태번 사용자 폴더의 files에 scenevoice_로 시작하는 파일로 저장합니다.",
        "여러 기기에서 동시에 설정을 바꾸거나 음성을 만들지 마십시오(한 번에 한 기기).",
        "백업·복원과 초기화는 창 오른쪽 위 ⋯ 메뉴에 있습니다.",
      ].join("\n"),
      body: `<div class="sv-storage-meter" id="sv-storage-meter" role="status">
          <div class="sv-storage-line"><span>생성 음성</span><strong id="sv-storage-text">사용량을 확인하는 중…</strong></div>
          <div class="sv-storage-bar"><i id="sv-storage-fill" style="width:0%"></i></div>
        </div>
        <div class="sv-row">
          ${fieldHtml({ id: "sv-cache-size", label: "최대 용량 (MB)", control: number("sv-cache-size", Number(config.cache?.max_size_mb ?? 1024), 'min="128" max="20480" step="128"'), hint: "넘으면 오래된 음성부터 지웁니다. 90%를 넘으면 알려 드립니다." })}
          ${fieldHtml({ id: "sv-cache-days", label: "보관 일수", control: number("sv-cache-days", Number(config.cache?.max_age_days ?? 0), 'min="0" max="3650"'), hint: "0이면 기간 제한 없이 보관합니다." })}
        </div>
        <p class="sv-hint">새 음성을 만들 때마다(그리고 기준을 바꾸면 바로) 기준을 넘은 오래된 음성을 자동으로 지웁니다. 영구 보관한 음성은 지우지 않습니다.</p>
        ${this.favoritesPath ? `<p class="sv-hint sv-path-note"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> 저장 위치: ${escapeHtml(this.favoritesPath)}</p>` : ""}`,
    });

    const settingsPane = PANES.some(([pane]) => pane === this.settingsPane)
      ? this.settingsPane
      : "common";
    const overlay = document.createElement("div");
    overlay.id = "sv-overlay";
    overlay.innerHTML = `
            <section id="sv-panel" class="${[config.phone?.app_enabled === false && "sv-phone-off", config.active === false && "sv-inactive", config.enabled === false && "sv-chat-off", config.playback?.prepare === false && "sv-prepare-off", config.elevenlabs?.sound_effects !== true && "sv-sfx-off", !config.casting?.auto_enabled && "sv-casting-off", !config.phone?.auto_enabled && "sv-auto-call-off", config.phone?.call_me === false && "sv-call-me-off", !config.voice_message?.enabled && "sv-auto-text-off", config.voice_message?.overheard_texts !== true && "sv-overheard-text-off", config.voice_message?.other_chats === false && "sv-other-chats-off", config.outreach?.enabled !== true && "sv-outreach-off", config.phone?.overheard_calls !== true && "sv-overheard-off", config.phone?.memo_app === false && "sv-memo-app-off", config.outreach?.mode === "random" && "sv-mode-random", config.outreach?.mode === "time" && "sv-mode-time", this.multicastVoiceSettings?.() && "sv-mc-engine"].filter(Boolean).join(" ")}" data-tab="settings" role="dialog" aria-modal="true" aria-labelledby="sv-panel-title">
                <header class="sv-header">
                    <span class="sv-logo" aria-hidden="true"><i class="fa-solid fa-microphone-lines"></i></span>
                    <div class="sv-title"><strong id="sv-panel-title">씬보이스</strong></div>
                    <span class="sv-save-state" id="sv-save-state" data-state="idle" role="status"><i class="fa-solid fa-check" aria-hidden="true"></i><span></span></span>
                    <div class="sv-more">
                        <button type="button" id="sv-more" class="sv-icon-btn" aria-label="업데이트 내역·백업·초기화 메뉴" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
                        <div class="sv-menu" id="sv-more-menu" role="menu" hidden>
                            <button type="button" role="menuitem" data-sv-action="update-notes"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i><span>업데이트 내역<small>최근에 바뀐 점</small></span></button>
                            <button type="button" role="menuitem" data-sv-action="setup-guide"><i class="fa-solid fa-signs-post" aria-hidden="true"></i><span>첫 설정 안내 (입문자)<small>엔진·키·연결을 차례로</small></span></button>
                            <hr>
                            <button type="button" role="menuitem" data-sv-action="backup"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i><span>백업 파일 저장<small>봇카드·항목을 골라서</small></span></button>
                            <label role="menuitem" class="sv-menu-file" tabindex="0"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i><span>백업 파일 복원<small>zip 또는 JSON</small></span><input type="file" id="sv-import-catalog" accept=".json,.zip,application/json,application/zip"></label>
                            <button type="button" role="menuitem" data-sv-action="relink"><i class="fa-solid fa-link" aria-hidden="true"></i><span>봇카드 기록 다시 잇기<small>이름 바꾼 카드의 예전 기록</small></span></button>
                            <hr>
                            <button type="button" role="menuitem" data-sv-action="reset-settings"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>설정 초기화…</span></button>
                            <button type="button" role="menuitem" data-sv-action="reset-data"><i class="fa-solid fa-broom" aria-hidden="true"></i><span>데이터 초기화…</span></button>
                            <button type="button" role="menuitem" class="sv-menu-danger" data-sv-action="reset-all"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>전체 초기화…</span></button>
                        </div>
                    </div>
                    <button type="button" id="sv-close" class="sv-icon-btn" aria-label="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </header>
                <nav class="sv-tabs" role="tablist" aria-label="씬보이스 메뉴">
                    ${TABS.map(([tab, label, icon]) => `<button type="button" role="tab" class="sv-tab ${tab === "settings" ? "active" : ""}" data-tab="${tab}" aria-selected="${tab === "settings"}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join("")}
                </nav>
                <div class="sv-statusbar" id="sv-statusbar" role="status" aria-live="polite" title="누르면 음성 엔진 연결을 다시 확인합니다"></div>
                <nav class="sv-subtabs sv-history-subtabs" role="tablist" aria-label="기록 보기">${HISTORY_VIEWS.map(([view, label, icon]) => `<button type="button" role="tab" class="sv-subtab" data-view="${view}" aria-selected="${view === "history"}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join("")}</nav>
                <nav class="sv-subtabs sv-settings-subtabs" role="tablist" aria-label="설정 분류">${PANES.map(([pane, label, icon]) => `<button type="button" role="tab" class="sv-subtab" data-pane="${pane}" aria-selected="${pane === settingsPane}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join("")}</nav>
                <div class="sv-tab-content" id="sv-settings-tab" role="tabpanel">
                    <div class="sv-pane ${settingsPane === "common" ? "sv-pane-on" : ""}" data-pane="common">
                        ${basicGroup}
                        ${chatGroup}
                        ${analysisGroup}
                        ${extraGroup}
                        <div class="sv-fold-list">
                            <h3 class="sv-group-title"><i class="fa-solid fa-database sv-group-icon" aria-hidden="true"></i><span class="sv-group-name">데이터 관리</span></h3>
                            ${storageFold}
                        </div>
                    </div>
                    <div class="sv-pane ${settingsPane === "people" ? "sv-pane-on" : ""}" data-pane="people">
                        ${castingGroup}
                    </div>
                    <div class="sv-pane ${settingsPane === "phone" ? "sv-pane-on" : ""}" data-pane="phone">
                        ${smartphoneFold}
                        <div class="sv-fold-list">
                            ${appsFold}
                            ${outreachFold}
                        </div>
                        <div class="sv-fold-list">
                            <h3 class="sv-group-title"><i class="fa-solid fa-gear sv-group-icon" aria-hidden="true"></i><span class="sv-group-name">고급</span></h3>
                            ${promptFold}
                        </div>
                    </div>
                </div>
                <div class="sv-tab-content hidden" id="sv-state-tab" role="tabpanel"><div class="sv-loading-line">상태를 불러오는 중…</div></div>
                <div class="sv-tab-content hidden" id="sv-phone-tab" role="tabpanel"><div class="sv-loading-line">전화 화면을 준비하는 중…</div></div>
                <div class="sv-tab-content hidden" id="sv-history-tab" role="tabpanel"><div class="sv-loading-line">기록을 불러오는 중…</div></div>
                <div class="sv-tab-content hidden" id="sv-favorites-tab" role="tabpanel"><div class="sv-loading-line">보관함을 불러오는 중…</div></div>
            </section>`;
    document.body.appendChild(overlay);
    this.bindPanelEvents();
    this.renderCastingSettings();
    this.updateEngineSections();
    this.bindSettingsUi();
    this.tidySettingLines?.();
    this.renderStatusBar();
    document
      .getElementById("sv-statusbar")
      ?.addEventListener("click", () =>
        this.run(() => this.refreshEngineCheck()),
      );
    // The engine is checked once a session (no cost: no voice is made).
    if (!this.engineCheck) this.run(() => this.refreshEngineCheck());
    this.showUpdateNotes?.();
    this.offerSetupGuide?.();
  },

  /** 음성 엔진 연결 for the status line: the key (and default voice) checked, nothing made. */
  async refreshEngineCheck() {
    if (!this.isActive() || this.followsMultiCastEngine?.()) return;
    this.engineCheck = { state: "busy", text: "" };
    this.renderStatusBar();
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/engine-check?engine=${encodeURIComponent(this.config.engine)}`,
      );
      const data = await response.json();
      this.engineCheck = {
        state: response.ok && data.ok ? "ok" : "error",
        text: [data.message || data.detail, data.voice]
          .filter(Boolean)
          .join(" · "),
      };
    } catch (error) {
      this.engineCheck = { state: "error", text: error.message || "" };
    }
    this.renderStatusBar();
  },

  /**
   * The line under the tabs: whether SceneVoice is ready (a dot: green ready, amber something to
   * look at, red not working, grey off), what is on, and MultiCast 확장 alongside.
   */
  renderStatusBar() {
    const bar = document.getElementById("sv-statusbar");
    if (!bar) return;
    const config = this.config;
    const chat = config.enabled !== false;
    const phone = config.phone?.app_enabled !== false;
    const analysing =
      chat && (config.analysis_enabled || config.casting?.auto_enabled);
    const noProfile =
      (analysing && !config.connection_profile_id) ||
      (phone &&
        !config.phone?.connection_profile_id &&
        !config.connection_profile_id);
    let multicastReads = false;
    try {
      multicastReads = Boolean(
        this.multicastAttached && this.multicastApi?.()?.isEnabled?.(),
      );
    } catch {
      /* an older MultiCast */
    }
    const engine = this.followsMultiCastEngine?.()
      ? "MultiCast 확장 음성 설정"
      : config.engine === "fish"
        ? "Fish Audio"
        : "ElevenLabs";
    const check = this.engineCheck;
    const [tone, lead] =
      config.active === false
        ? ["off", "씬보이스 꺼짐"]
        : check?.state === "error"
          ? ["error", `${engine} 연결 안 됨`]
          : noProfile
            ? ["warn", "보조모델 연결 안 됨"]
            : chat && multicastReads
              ? ["warn", "MultiCast 확장도 채팅 대사를 읽는 중"]
              : check?.state === "busy"
                ? ["busy", "연결 확인 중…"]
                : ["ok", check?.state === "ok" ? `${engine} 연결됨` : "준비됨"];
    const parts =
      config.active === false
        ? []
        : [
            lead.includes(engine) ? "" : engine,
            `채팅 대사 읽기 ${chat ? "켜짐" : "꺼짐"}`,
            `스마트폰 ${phone ? "켜짐" : "꺼짐"}`,
            this.multicastAttached ? "MultiCast 확장 연동" : "",
          ].filter(Boolean);
    bar.dataset.tone = tone;
    bar.title = [check?.text, "누르면 음성 엔진 연결을 다시 확인합니다"]
      .filter(Boolean)
      .join("\n");
    bar.innerHTML = `<i class="sv-status-dot" aria-hidden="true"></i><strong>${escapeHtml(lead)}</strong>${parts.length ? `<span>${parts.map((part) => escapeHtml(part)).join(" · ")}</span>` : ""}`;
  },

  getConnectionProfiles() {
    try {
      return this.connectionService?.getSupportedProfiles?.() || [];
    } catch (error) {
      console.warn("[SceneVoice] ST 연결 프로필을 읽을 수 없습니다.", error);
      return [];
    }
  },

  bindSettingsUi() {
    // 월드인포 choices are kept here until saved (the picker sits under each bot card).
    this.loreDraft = null;
    const panel = document.getElementById("sv-panel");
    const settings = document.getElementById("sv-settings-tab");
    if (!panel || !settings) return;
    bindInfoTips(document.getElementById("sv-overlay"));
    panel
      .querySelector(".sv-settings-subtabs")
      ?.addEventListener("click", (event) => {
        const pane = event.target.closest("[data-pane]")?.dataset.pane;
        if (pane) this.showSettingsPane(pane);
      });
    panel
      .querySelector(".sv-history-subtabs")
      ?.addEventListener("click", (event) => {
        const view = event.target.closest("[data-view]")?.dataset.view;
        if (view) this.changeTab(view);
      });
    bindRanges(settings);
    // After a switch or a choice has shown or folded away its settings.
    const tidy = () => requestAnimationFrame(() => tidySettingLines(settings));
    settings.addEventListener("change", tidy);
    // A bot card picked (its settings drawn anew) too.
    settings.addEventListener("click", tidy);
    this.tidySettingLines = tidy;
    this.bindReadingRules();
    this.bindHiddenMessages();
    // 추가 지침: the mark on its heading shows while there is something written.
    const extra = document.getElementById("sv-extra-instructions");
    extra?.addEventListener("input", () => {
      const badge = document.getElementById("sv-extra-badge");
      if (badge) badge.hidden = !extra.value.trim();
    });
    this.bindPronunciation();
    bindStateBadges(settings);
    // Every change is saved automatically. Typing waits for a short pause; keys wait until the field is left.
    const ignored =
      "#sv-cast-character, [data-cast-new], #sv-import-catalog, [data-prompt-text]";
    settings.addEventListener("input", (event) => {
      if (event.target.closest(ignored)) return;
      this.settingsDirty = true;
      if (event.target.matches('input[type="password"]')) return;
      const typing = event.target.matches(
        'input:not([type]), input[type="text"], input[type="number"], textarea',
      );
      this.scheduleSettingsSave(typing ? 900 : 300);
    });
    settings.addEventListener("change", (event) => {
      if (event.target.closest(ignored)) return;
      this.settingsDirty = true;
      this.scheduleSettingsSave(250);
    });
    settings.addEventListener("click", (event) => {
      if (
        event.target.closest(
          "[data-cast-add], [data-member-remove], [data-member-move], [data-cast-adopt]",
        )
      ) {
        this.settingsDirty = true;
        this.scheduleSettingsSave(250);
      }
      const clear = event.target.closest("[data-sv-clear-key]");
      if (!clear) return;
      const engine = clear.dataset.svClearKey;
      const label =
        engine === "fish" ? "이 브라우저에 저장된 Fish" : "저장된 ElevenLabs";
      if (!confirm(`${label} API 키를 삭제하시겠습니까?`)) return;
      this.pendingKeyClear = { ...this.pendingKeyClear, [engine]: true };
      this.settingsDirty = true;
      this.run(() => this.saveSettingsNow());
    });
  },

  /** Panel close: start saving whatever is still waiting, then remove the panel. */
  closeOverlay() {
    this.closeSetupGuide?.();
    this.castOrderCleanup?.();
    this.castOrderCleanup = null;
    this.stopVoicePreview();
    if (this.settingsSaveTimer || this.settingsDirty) this.saveSettingsNow();
    document.getElementById("sv-overlay")?.remove();
  },

  scheduleSettingsSave(delay = 300) {
    clearTimeout(this.settingsSaveTimer);
    this.setSaveState("pending");
    this.settingsSaveTimer = setTimeout(
      () => this.run(() => this.saveSettingsNow()),
      delay,
    );
  },

  setSaveState(state, message = "") {
    const badge = document.getElementById("sv-save-state");
    if (!badge) return;
    // Quiet unless something is happening: saving, just saved, or a save that failed.
    const view = {
      idle: ["fa-check", ""],
      pending: ["fa-circle", "저장 대기"],
      saving: ["fa-spinner fa-spin", "저장 중…"],
      saved: ["fa-check", "저장됨"],
      error: ["fa-triangle-exclamation", `저장 실패 · ${message}`],
    }[state] || ["fa-check", ""];
    badge.dataset.state = state;
    badge.querySelector("i").className = `fa-solid ${view[0]}`;
    badge.querySelector("span").textContent = view[1];
    badge.title =
      state === "error" ? `${message} 값을 고치면 다시 저장합니다.` : "";
    clearTimeout(this.saveStateTimer);
    if (state === "saved")
      this.saveStateTimer = setTimeout(() => this.setSaveState("idle"), 2500);
  },

  /** Saves the settings form now; saves run one after another so the latest values win. */
  saveSettingsNow() {
    clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    if (!document.getElementById("sv-settings-tab"))
      return this.settingsSaveChain;
    this.settingsDirty = false;
    const payload = this.collectSettingsPayload();
    const clearing = { ...this.pendingKeyClear };
    this.pendingKeyClear = {};
    this.settingsSaveChain = (this.settingsSaveChain || Promise.resolve())
      .catch(() => undefined)
      .then(() => this.persistSettings(payload, clearing));
    return this.settingsSaveChain;
  },

  bindPanelEvents() {
    const overlay = document.getElementById("sv-overlay");
    if (!overlay) return;
    this.bindMoreMenu();
    document
      .getElementById("sv-import-catalog")
      ?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        this.run(() => this.openRestore(file));
      });
    const previousFocus = document.activeElement;
    const closePanel = () => {
      this.closeOverlay();
      previousFocus?.focus?.();
    };
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        // An open voice list takes the key first: it closes, the window stays.
        if (event.target.closest?.(".sv-voice-pick.sv-open")) return;
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...overlay.querySelectorAll(
          "button,input,textarea,select,a[href],summary",
        ),
      ].filter(
        (item) =>
          !item.disabled && item.tabIndex >= 0 && item.getClientRects().length,
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    document.getElementById("sv-close")?.addEventListener("click", closePanel);
    document.getElementById("sv-close")?.focus();
    document
      .getElementById("sv-overlay")
      ?.addEventListener("click", (event) => {
        if (event.target.id === "sv-overlay") this.closeOverlay();
      });
    document
      .getElementById("sv-engine")
      ?.addEventListener("change", () => this.updateEngineSections());
    document
      .getElementById("sv-eleven-model")
      ?.addEventListener("change", () => this.updateEngineSections());
    document
      .getElementById("sv-eleven-model-custom")
      ?.addEventListener("input", () => this.updateEngineSections());
    document
      .getElementById("sv-engine-check")
      ?.addEventListener("click", () => this.checkEngineConnection());
    document
      .getElementById("sv-outreach-compare")
      ?.addEventListener("click", () => this.openOutreachCompare());
    document
      .getElementById("sv-pause-qr")
      ?.addEventListener("click", () =>
        this.run(() => this.addPauseQuickReply()),
      );
    document.getElementById("sv-load-voices")?.addEventListener("click", () =>
      this.run(async () => {
        const count = await this.loadVoiceChoices();
        const note = document.getElementById("sv-voice-tools-note");
        if (note)
          note.textContent = `보이스 ${count}개를 불러왔습니다. 목소리 칸을 누르면 이름으로 고를 수 있습니다.`;
      }),
    );
    // 스마트폰 사용 off folds away the phone's other settings and the 전화 tab; the 기본 switches
    // fold away what hangs on them.
    for (const [id, name] of [
      ["sv-phone-app", "sv-phone-off"],
      ["sv-active", "sv-inactive"],
      ["sv-enabled", "sv-chat-off"],
      ["sv-prepare", "sv-prepare-off"],
      ["sv-eleven-sfx", "sv-sfx-off"],
      ["sv-casting-auto", "sv-casting-off"],
      ["sv-phone-auto", "sv-auto-call-off"],
      ["sv-phone-overheard", "sv-overheard-off"],
      ["sv-phone-call-me", "sv-call-me-off"],
      ["sv-voice-message-enabled", "sv-auto-text-off"],
      ["sv-text-overheard", "sv-overheard-text-off"],
      ["sv-other-chats", "sv-other-chats-off"],
      ["sv-phone-memo", "sv-memo-app-off"],
    ])
      document.getElementById(id)?.addEventListener("change", (event) => {
        document
          .getElementById("sv-panel")
          ?.classList.toggle(name, !event.target.checked);
      });
    for (const input of document.querySelectorAll(
      'input[name="sv-outreach-mode"], #sv-state-enabled, #sv-phone-app, #sv-outreach-enabled',
    ))
      input.addEventListener("change", () => this.syncOutreachView());
    this.syncOutreachView();
    document
      .getElementById("sv-outreach-card-link")
      ?.addEventListener("click", () => this.openCardOutreach());
    document
      .querySelectorAll('input[name="sv-random-level"]')
      .forEach((radio) =>
        radio.addEventListener("change", () => this.noteRandomExample()),
      );
    this.noteRandomExample();
    this.bindPromptEdits();
    // The voice list feeds every voice picker; loaded once per session on its own.
    this.bindVoicePickers(document.getElementById("sv-overlay"));
    if (this.voiceChoices?.length) this.fillVoiceOptions();
    else if (
      (document.getElementById("sv-engine")?.value || this.config.engine) ===
      "elevenlabs"
    )
      this.loadVoiceChoices().catch(() => undefined);
    const detail = document.getElementById("sv-engine-detail");
    detail?.addEventListener("toggle", () => {
      try {
        localStorage.setItem(ENGINE_DETAIL_OPEN, detail.open ? "1" : "0");
      } catch {
        /* private mode: the fold just isn't remembered */
      }
    });
    for (const type of ["input", "change"])
      detail?.addEventListener(type, () => this.noteEngineDetail());
    document
      .getElementById("sv-enabled")
      ?.addEventListener("change", () => this.noteEngineDetail());
    // Folds stay as they were left on this device (open or folded), each by its id.
    {
      const saved = foldStates();
      for (const fold of document.querySelectorAll(
        "#sv-overlay details.sv-fold[id], #sv-overlay details.sv-sub-fold[id], #sv-overlay details.sv-sub-sec[id]",
      )) {
        if (fold.id === "sv-engine-detail") continue;
        if (typeof saved[fold.id] === "boolean") fold.open = saved[fold.id];
        // Only what the user folds or opens is kept (a fold drawn open fires a toggle by itself).
        const drawn = Date.now();
        fold.addEventListener("toggle", () => {
          if (Date.now() - drawn > 400) keepFoldState(fold.id, fold.open);
        });
      }
    }
    document
      .getElementById("sv-fold-storage")
      ?.addEventListener("toggle", (event) => {
        if (event.currentTarget.open) this.run(() => this.renderStorageMeter());
      });
    document.querySelectorAll(".sv-tab").forEach((tab) => {
      // 기록 opens on the list last looked at (전체 기록 or 보관함).
      tab.addEventListener("click", () =>
        this.changeTab(
          tab.dataset.tab === "history"
            ? this.historyView || "history"
            : tab.dataset.tab,
        ),
      );
    });
  },

  /** Used space against the size limit, as a bar in the storage section. */
  async renderStorageMeter() {
    const text = document.getElementById("sv-storage-text");
    const fill = document.getElementById("sv-storage-fill");
    if (!text || !fill) return;
    const response = await this.request(
      "/api/plugins/scenevoice/cache",
      { cache: "no-store" },
      20000,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "저장 공간을 확인하지 못했습니다.");
    const limit = Number(this.config.cache?.max_size_mb || 1024);
    const used = Number(data.size_mb || 0);
    const ratio = Math.min(1, used / limit);
    text.textContent = `${used.toLocaleString("ko-KR")} MB / ${limit.toLocaleString("ko-KR")} MB · ${Math.round(ratio * 100)}% · 파일 ${Number(data.file_count || 0).toLocaleString("ko-KR")}개`;
    fill.style.width = `${Math.max(ratio * 100, used ? 1 : 0)}%`;
    fill.closest(".sv-storage-meter").dataset.level =
      ratio >= 0.9 ? "full" : ratio >= 0.7 ? "high" : "ok";
  },

  async checkEngineConnection() {
    const button = document.getElementById("sv-engine-check");
    const result = document.getElementById("sv-engine-check-result");
    if (!button || !result) return;
    const engine =
      document.getElementById("sv-engine")?.value || this.config.engine;
    button.disabled = true;
    result.dataset.state = "busy";
    result.textContent = "확인하는 중…";
    try {
      // A key or voice ID typed a moment ago is saved first, so the check uses it.
      await this.saveSettingsNow();
      const response = await this.request(
        `/api/plugins/scenevoice/engine-check?engine=${encodeURIComponent(engine)}`,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "연결을 확인하지 못했습니다.");
      result.dataset.state = data.ok ? "ok" : "error";
      result.textContent = [data.message, data.voice]
        .filter(Boolean)
        .join(" · ");
      this.engineCheck = {
        state: data.ok ? "ok" : "error",
        text: result.textContent,
      };
      this.renderStatusBar();
    } catch (error) {
      result.dataset.state = "error";
      result.textContent = error.message || "연결을 확인하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  },

  updateEngineSections() {
    const picked = document.getElementById("sv-eleven-model")?.value;
    const custom = picked === "__custom__";
    document
      .getElementById("sv-eleven-model-custom")
      ?.classList.toggle("hidden", !custom);
    const traits = elevenModelTraits(
      custom
        ? document.getElementById("sv-eleven-model-custom")?.value.trim()
        : picked,
    );
    // Only the controls the chosen model takes are shown.
    document
      .getElementById("sv-eleven-style-row")
      ?.classList.toggle("hidden", !traits.style);
    document
      .getElementById("sv-eleven-speed-row")
      ?.classList.toggle("hidden", !traits.speed);
    document
      .getElementById("sv-eleven-tune-row")
      ?.classList.toggle("sv-row-empty", !traits.speed && !traits.style);
    const selected =
      document.getElementById("sv-engine")?.value || this.config.engine;
    document.querySelectorAll(".sv-engine-section").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.engine !== selected);
    });
    this.noteEngineDetail();
    this.noteKeyStates();
  },

  /** 숨긴 메시지: with 요약으로 대신 읽기, the list of what is injected into the chat right now. */
  bindHiddenMessages() {
    const select = document.getElementById("sv-hidden-messages");
    const list = document.getElementById("sv-injected-list");
    if (!select || !list) return;
    const sync = () => {
      const summary = select.value === "summary";
      document
        .getElementById("sv-panel")
        ?.classList.toggle("sv-hidden-read", !summary);
      if (!summary) return;
      const items = this.injectedPrompts();
      list.innerHTML = items.length
        ? items
            .map(
              (item) =>
                `<label class="sv-check"><input type="checkbox" data-injected="${escapeHtml(item.key)}" ${item.picked ? "checked" : ""}><span class="sv-injected-text"><b>${escapeHtml(item.label)}${item.summary ? '<span class="sv-badge sv-badge-on">요약</span>' : ""}</b><small>${item.parts.length > 1 ? `${item.parts.length}개 · ` : ""}${item.text.length.toLocaleString("ko-KR")}자 · ${escapeHtml(item.text.replace(/\s+/g, " ").slice(0, 70))}</small></span></label>`,
            )
            .join("")
        : '<p class="sv-hint">지금 주입되고 있는 글이 없습니다. 채팅에서 답변을 한 번 받은 뒤 이 창을 다시 열어 보십시오.</p>';
    };
    select.addEventListener("change", sync);
    sync();
  },

  /**
   * 선연락·인물별 상태 추적: the three state fields show where state tracking runs (that way
   * of reaching out, or the phone off with its own switch on). The switch itself is only for
   * the phone off.
   */
  syncOutreachView() {
    const panel = document.getElementById("sv-panel");
    if (!panel) return;
    const on = (id) => Boolean(document.getElementById(id)?.checked);
    const phone = on("sv-phone-app");
    const mode =
      document.querySelector('input[name="sv-outreach-mode"]:checked')?.value ||
      "state";
    const random = mode !== "state";
    const reaching = on("sv-outreach-enabled");
    panel.classList.toggle("sv-mode-random", mode === "random");
    panel.classList.toggle("sv-mode-time", mode === "time");
    panel.classList.toggle("sv-outreach-off", !reaching);
    panel.classList.toggle(
      "sv-state-idle",
      phone ? random || !reaching : !on("sv-state-enabled"),
    );
    // On, but not for the bot card that is open: said here, where it would otherwise look broken.
    const note = document.getElementById("sv-outreach-card-note");
    if (note) {
      const cards = (this.currentCardKeys?.() || []).filter((key) =>
        key.startsWith("character:"),
      );
      const voices = this.voiceDraft || this.config.character_voices || {};
      const reaching = cards.filter((key) => voices[key]?.outreach === true);
      const own = reaching
        .map((key) => voices[key].outreach_mode)
        .find((value) => value && value !== mode);
      // Always said while 선연락 사용 is on (each card's own switch is off until set), then how
      // it stands for the card that is open.
      const here = !cards.length
        ? ""
        : own
          ? ` 지금 열린 봇카드는 ‘${{ state: "인물별 상태 추적", random: "랜덤", time: "시간" }[own]}’ 방식으로 연락받습니다(그 방식의 세부 설정은 아래에서 방식을 눌러 바꿉니다).`
          : reaching.length
            ? " 지금 열린 봇카드는 켜져 있습니다."
            : " 지금 열린 봇카드는 꺼져 있습니다.";
      note.querySelector("span").textContent =
        `‘캐릭터’ 탭의 ‘봇카드 공통 설정’에서 ‘선연락 받기’를 켠 봇카드에서만 옵니다. 모든 봇카드는 처음에 꺼져 있습니다.${here}`;
    }
  },

  /** 랜덤 연락: what the chosen 공통 연락 빈도 comes to, in plain numbers. */
  noteRandomExample() {
    const note = document.getElementById("sv-random-example");
    if (!note) return;
    const base =
      RANDOM_OUTREACH_BASE[
        document.querySelector('input[name="sv-random-level"]:checked')?.value
      ] ?? RANDOM_OUTREACH_BASE.normal;
    const percent = (value) => `${Math.round(value * 1000) / 10}%`;
    const every = (rate) => Math.round(1 / (base * (rate / 50)));
    note.textContent = `AI 답변이 올 때마다 인물별로 주사위를 굴립니다. 지금 설정이면 선연락 빈도가 보통인 인물은 답변마다 ${percent(base)}, 평균 답변 ${every(50)}개마다 한 번 연락합니다.`;
  },

  /**
   * 프롬프트 직접 수정: the style part of the call and text prompts. Saved only by 적용 (or
   * 되돌리기), unlike the rest of the form.
   */
  bindPromptEdits() {
    const fold = document.getElementById("sv-fold-prompts");
    if (!fold) return;
    const applied = () => this.promptsApplied || this.config.prompts || {};
    const sync = () => {
      let custom = false;
      fold.querySelectorAll("[data-prompt]").forEach((box) => {
        const field = box.dataset.prompt;
        const mine = Boolean(applied()[field]);
        const text = promptPlain(box.querySelector("[data-prompt-text]").value);
        const state = box.querySelector(".sv-prompt-state");
        state.textContent = mine ? "수정됨" : "기본값";
        state.classList.toggle("sv-badge-on", mine);
        fold
          .querySelector(`input[name="sv-prompt-pick"][value="${field}"]`)
          ?.parentElement.classList.toggle("sv-prompt-mine", mine);
        box.querySelector("[data-prompt-apply]").disabled =
          !text || text === (applied()[field] || STYLE_DEFAULTS[field]);
        box.querySelector("[data-prompt-reset]").disabled =
          !mine && text === STYLE_DEFAULTS[field];
        custom ||= mine;
      });
      const badge = document.getElementById("sv-prompt-badge");
      badge.textContent = custom ? "수정됨" : "기본값";
      badge.classList.toggle("sv-badge-on", custom);
    };
    // One wording shows at a time; a dot on its name says it was rewritten.
    fold.addEventListener("change", (event) => {
      if (event.target.name !== "sv-prompt-pick") return;
      fold
        .querySelectorAll("[data-prompt]")
        .forEach(
          (box) => (box.hidden = box.dataset.prompt !== event.target.value),
        );
    });
    fold.addEventListener("input", (event) => {
      const status = event.target
        .closest("[data-prompt]")
        ?.querySelector("[data-prompt-status]");
      if (status) status.textContent = "";
      sync();
    });
    fold.addEventListener("click", (event) => {
      const button = event.target.closest(
        "[data-prompt-apply], [data-prompt-reset]",
      );
      const box = button?.closest("[data-prompt]");
      if (!box) return;
      const field = box.dataset.prompt;
      const area = box.querySelector("[data-prompt-text]");
      const reset = button.matches("[data-prompt-reset]");
      if (reset) area.value = promptShown(STYLE_DEFAULTS[field]);
      const text = promptPlain(area.value);
      // The built-in wording, typed back in or restored, is the default again.
      this.promptsApplied = {
        ...applied(),
        [field]: reset || text === STYLE_DEFAULTS[field] ? "" : text,
      };
      this.settingsDirty = true;
      this.run(async () => {
        await this.saveSettingsNow();
        box.querySelector("[data-prompt-status]").textContent = reset
          ? "기본값으로 되돌렸습니다."
          : "적용했습니다.";
        sync();
      });
    });
    sync();
  },

  /** The folded 상세 설정 line names the default voices in use (none while the chat isn't read). */
  noteEngineDetail() {
    const note = document.getElementById("sv-engine-detail-note");
    if (!note) return;
    const fish =
      (document.getElementById("sv-engine")?.value || this.config.engine) ===
      "fish";
    const name = (gender) => {
      if (fish)
        return document
          .getElementById(`sv-fish-reference-${gender}`)
          ?.value.trim()
          ? "지정됨"
          : "";
      const box = document.getElementById(`sv-eleven-voice-${gender}`);
      const value = box?.closest("[data-voice-pick]")?.dataset.value || "";
      return (
        this.voiceName(value) || (box?.value.trim() ? box.value.trim() : value)
      );
    };
    note.textContent =
      document.getElementById("sv-enabled")?.checked === false
        ? ""
        : `기본 목소리: 남성 ${name("male") || "없음"} · 여성 ${name("female") || "없음"}`;
  },

  /** 저장됨 / 키 없음 beside each engine's key. */
  noteKeyStates() {
    document.querySelectorAll("[data-sv-key-state]").forEach((badge) => {
      const saved = Boolean(this.config[badge.dataset.svKeyState]?.has_api_key);
      badge.classList.toggle("sv-badge-on", saved);
      badge.classList.toggle("sv-badge-warn", !saved);
      badge.innerHTML = saved
        ? '<i class="fa-solid fa-check" aria-hidden="true"></i>저장됨'
        : "키 없음";
    });
  },

  changeTab(tabName) {
    const panel = document.getElementById("sv-panel");
    if (!panel) return;
    closeTips(panel);
    panel.dataset.tab = tabName;
    // 보관함 is a view inside 기록.
    const top = tabName === "favorites" ? "history" : tabName;
    if (top === "history") this.historyView = tabName;
    document.querySelectorAll(".sv-tab").forEach((tab) => {
      const active = tab.dataset.tab === top;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panel
      .querySelectorAll(".sv-history-subtabs .sv-subtab")
      .forEach((view) =>
        view.setAttribute(
          "aria-selected",
          String(view.dataset.view === tabName),
        ),
      );
    document
      .getElementById("sv-settings-tab")
      ?.classList.toggle("hidden", tabName !== "settings");
    document
      .getElementById("sv-state-tab")
      ?.classList.toggle("hidden", tabName !== "state");
    document
      .getElementById("sv-phone-tab")
      ?.classList.toggle("hidden", tabName !== "phone");
    document
      .getElementById("sv-history-tab")
      ?.classList.toggle("hidden", tabName !== "history");
    document
      .getElementById("sv-favorites-tab")
      ?.classList.toggle("hidden", tabName !== "favorites");
    if (tabName === "state") this.renderState();
    if (tabName === "phone") this.renderPhone();
    if (tabName === "history") this.renderHistory();
    if (tabName === "favorites") this.renderFavorites();
  },

  collectSettingsPayload() {
    this.flushVoiceDraft();
    const clearing = this.pendingKeyClear || {};
    const payload = {
      character_voices: this.voiceDraft || {},
      reading: {
        rules: this.collectReadingRules(),
        thought_effect: true,
      },
      pronunciation: this.collectPronunciationSettings(),
      chat_memory: {
        view:
          document.querySelector('input[name="sv-memory-view"]:checked')
            ?.value || "bubble",
      },
      active: document.getElementById("sv-active").checked,
      playback: {
        auto_new: document.getElementById("sv-auto-play").checked,
        caption:
          document.querySelector('input[name="sv-caption"]:checked')?.value ||
          "always",
        caption_at:
          document.querySelector('input[name="sv-caption-at"]:checked')
            ?.value || "bottom",
        line_buttons: document.getElementById("sv-line-buttons").checked,
        prepare: document.getElementById("sv-prepare").checked,
        spatial: document.getElementById("sv-spatial")?.checked !== false,
        level: document.getElementById("sv-level")?.checked !== false,
      },
      casting: {
        auto_enabled: document.getElementById("sv-casting-auto").checked,
        uncertain:
          document.querySelector('input[name="sv-casting-uncertain"]:checked')
            ?.value || "skip",
        multicast_sync:
          document.getElementById("sv-multicast-sync")?.checked ??
          this.config.casting?.multicast_sync !== false,
        global_folders:
          this.folderDraft || this.config.casting?.global_folders || [],
      },
      enabled: document.getElementById("sv-enabled").checked,
      engine: document.getElementById("sv-engine").value,
      llm: {
        // Not shown any more: the connection's preset and low task temperatures always apply.
        include_preset: true,
        analysis_include_persona: document.getElementById("sv-analysis-persona")
          .checked,
        analysis_include_character: document.getElementById(
          "sv-analysis-character",
        ).checked,
        auto_analyze: document.getElementById("sv-analysis-auto").checked,
        task_temperature: true,
        skip_command_replies: document.getElementById("sv-skip-command-replies")
          .checked,
        hidden_messages: document.getElementById("sv-hidden-messages").value,
        extra_instructions: document.getElementById("sv-extra-instructions")
          .value,
        injected_prompts: {
          ...(this.config.llm?.injected_prompts || {}),
          ...Object.fromEntries(
            [
              ...document.querySelectorAll("#sv-injected-list [data-injected]"),
            ].map((box) => [box.dataset.injected, box.checked]),
          ),
        },
      },
      default_language: document.getElementById("sv-default-language").value,
      analysis_enabled: document.getElementById("sv-analysis-enabled").checked,
      connection_profile_id: document.getElementById("sv-connection-profile")
        .value,
      context_messages: numberOr(
        document.getElementById("sv-context-messages").value,
        4,
      ),
      character_notes: this.noteDraft || {},
      outreach: {
        enabled: document.getElementById("sv-outreach-enabled").checked,
        mode:
          document.querySelector('input[name="sv-outreach-mode"]:checked')
            ?.value || "state",
        random_level:
          document.querySelector('input[name="sv-random-level"]:checked')
            ?.value || "normal",
        // One setting with a switch in each of the two modes that use it.
        random_fit: (document.querySelector(
          'input[name="sv-outreach-mode"]:checked',
        )?.value === "time"
          ? document.getElementById("sv-time-fit")
          : document.getElementById("sv-random-fit")
        ).checked,
        time_min: Number(document.getElementById("sv-time-min").value || 30),
        time_max: Number(document.getElementById("sv-time-max").value || 120),
        time_daily_max: Number(
          document.getElementById("sv-time-daily").value || 0,
        ),
      },
      // Only what 적용 or 되돌리기 put there: a half-written prompt is never saved by itself.
      prompts: this.promptsApplied || this.config.prompts || {},
      state_tracking: {
        enabled: document.getElementById("sv-state-enabled").checked,
        connection_profile_id:
          document.getElementById("sv-state-profile").value,
        context_messages: numberOr(
          document.getElementById("sv-state-context").value,
          8,
        ),
        every_messages: Number(
          document.getElementById("sv-state-every").value || 2,
        ),
      },
      phone: {
        connection_profile_id:
          document.getElementById("sv-phone-profile").value,
        context_messages: numberOr(
          document.getElementById("sv-phone-context").value,
          10,
        ),
        auto_enabled: document.getElementById("sv-phone-auto").checked,
        call_me: document.getElementById("sv-phone-call-me").checked,
        ringtone: document.getElementById("sv-phone-sounds").checked,
        voicemail: document.getElementById("sv-phone-voicemail").checked,
        overheard_calls: document.getElementById("sv-phone-overheard").checked,
        memo_app:
          document.getElementById("sv-phone-memo")?.checked ??
          this.config.phone?.memo_app !== false,
        memo_auto:
          document.getElementById("sv-phone-memo-auto")?.checked ??
          this.config.phone?.memo_auto !== false,
        radio_app:
          document.getElementById("sv-phone-radio")?.checked ??
          this.config.phone?.radio_app !== false,
        overheard_length:
          document.querySelector(
            'input[name="sv-phone-overheard-length"]:checked',
          )?.value || "normal",
        vibration: document.getElementById("sv-phone-vibration").checked,
        audio_filter: document.getElementById("sv-phone-filter").checked,
        sfx_in_file:
          document.getElementById("sv-sfx-in-file")?.checked ??
          this.config.phone?.sfx_in_file !== false,
        launcher:
          document.querySelector('input[name="sv-phone-launcher-mode"]:checked')
            ?.value || "both",
        app_enabled: document.getElementById("sv-phone-app").checked,
        launcher_events_only: document.getElementById(
          "sv-phone-launcher-alerts",
        ).checked,
        show_translation:
          document.querySelector('input[name="sv-phone-translation"]:checked')
            ?.value !== "off",
        world_info_choice:
          this.loreDraft || this.config.phone?.world_info_choice || {},
        theme:
          document.querySelector('input[name="sv-phone-theme"]:checked')
            ?.value || "default",
        auto_voice:
          document.querySelector('input[name="sv-phone-voice-mode"]:checked')
            ?.value !== "tap",
      },
      voice_message: {
        enabled: document.getElementById("sv-voice-message-enabled").checked,
        auto_generate_audio: document.getElementById(
          "sv-voice-message-auto-audio",
        ).checked,
        other_chats: document.getElementById("sv-other-chats").checked,
        thread_messages: Number(
          document.getElementById("sv-thread-messages").value || 0,
        ),
        other_calls: Number(
          document.getElementById("sv-other-calls").value || 0,
        ),
        reply_voice: document.getElementById("sv-voice-message-reply-voice")
          .checked,
        sounds: document.getElementById("sv-phone-sounds").checked,
        text_me: document.getElementById("sv-text-me").checked,
        overheard_texts: document.getElementById("sv-text-overheard").checked,
        rooms_self: document.getElementById("sv-rooms-self").checked,
        room_defaults: {
          auto_every: Number(
            document.getElementById("sv-room-def-every").value || 8,
          ),
          auto_daily_max: Number(
            document.getElementById("sv-room-def-daily").value || 0,
          ),
          burst_min: Number(
            document.getElementById("sv-room-def-min").value || 6,
          ),
          burst_max: Number(
            document.getElementById("sv-room-def-max").value || 15,
          ),
        },
      },
      cache: {
        max_size_mb: Number(
          document.getElementById("sv-cache-size").value || 1024,
        ),
        max_age_days: Number(
          document.getElementById("sv-cache-days").value || 0,
        ),
      },
      fish: {
        api_key: document.getElementById("sv-fish-key").value,
        // reference_id is what a speaker of unknown gender gets: the female default, else the male.
        reference_id:
          document.getElementById("sv-fish-reference-female").value.trim() ||
          document.getElementById("sv-fish-reference-male").value.trim(),
        reference_id_male: document
          .getElementById("sv-fish-reference-male")
          .value.trim(),
        reference_id_female: document
          .getElementById("sv-fish-reference-female")
          .value.trim(),
        model: document.getElementById("sv-fish-model").value,
        speed: Number(document.getElementById("sv-fish-speed").value),
        clear_api_key: Boolean(clearing.fish),
      },
      elevenlabs: {
        // Tags follow the line analysis (연기 태그 분석); the separate switch is gone.
        use_audio_tags: true,
        speed: Number(document.getElementById("sv-eleven-speed").value || 1),
        sound_effects: document.getElementById("sv-eleven-sfx").checked,
        api_key: document.getElementById("sv-eleven-key").value,
        // voice_id is what a speaker of unknown gender gets: the female default, else the male.
        voice_id:
          this.voiceFieldValue("sv-eleven-voice-female") ||
          this.voiceFieldValue("sv-eleven-voice-male"),
        voice_id_male: this.voiceFieldValue("sv-eleven-voice-male"),
        voice_id_female: this.voiceFieldValue("sv-eleven-voice-female"),
        model:
          document.getElementById("sv-eleven-model").value === "__custom__"
            ? document.getElementById("sv-eleven-model-custom").value.trim() ||
              this.config.elevenlabs?.model ||
              "eleven_v4"
            : document.getElementById("sv-eleven-model").value,
        stability: Number(document.getElementById("sv-eleven-stability").value),
        similarity_boost: Number(
          document.getElementById("sv-eleven-similarity").value,
        ),
        style: Number(document.getElementById("sv-eleven-style").value),
        clear_api_key: Boolean(clearing.elevenlabs),
      },
    };
    return payload;
  },

  async persistSettings(payload, clearing = {}) {
    this.setSaveState("saving");
    const previous = this.config;
    const previousLineKey = this.lineConfigKey();
    try {
      const response = await this.request("/api/plugins/scenevoice/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `저장 실패 (${response.status})`);
      }
      const data = await response.json();
      this.config = mergeConfig(data.settings || {});
      this.backendConnected = true;
      this.backendError = "";
      await this.applySavedSettings(previous, previousLineKey);
      for (const engine of Object.keys(clearing)) {
        const button = document.querySelector(
          `[data-sv-clear-key="${engine}"]`,
        );
        if (button) button.disabled = true;
        const input = document.getElementById(
          engine === "fish" ? "sv-fish-key" : "sv-eleven-key",
        );
        if (input) {
          input.value = "";
          input.placeholder =
            engine === "fish" ? "Fish Audio API 키" : "ElevenLabs API 키";
        }
        this.notify("저장된 API 키를 삭제했습니다.", "success");
      }
      if (payload.fish?.api_key)
        document
          .querySelector('[data-sv-clear-key="fish"]')
          ?.removeAttribute("disabled");
      this.noteKeyStates();
      this.setSaveState(this.settingsSaveTimer ? "pending" : "saved");
    } catch (error) {
      if (error.name === "AbortError") {
        // The chat changed mid-save; try again with the same form values.
        this.settingsDirty = true;
        this.scheduleSettingsSave(400);
        return;
      }
      this.setSaveState("error", error.message || "설정을 저장할 수 없습니다.");
    }
  },

  /** Applies saved settings without cancelling calls or generations already running. */
  async applySavedSettings(previous, previousLineKey) {
    this.analysisCache.clear();
    this.lineStatePromise = null;
    const wasOn = previous.active !== false && previous.enabled !== false;
    const redecorate =
      wasOn !== this.chatVoiceOn() ||
      previous.playback?.prepare !== this.config.playback?.prepare ||
      contentKey(previous.reading) !== contentKey(this.config.reading);
    const linesChanged = previousLineKey !== this.lineConfigKey();
    // Voices already made stay on their lines, whatever was changed.
    if (redecorate || !this.chatVoiceOn()) this.removeDecorations();
    this.applyChatDisplay();
    // Switched off, the chat is no longer watched at all.
    if (!this.isActive()) {
      this.observer?.disconnect();
      this.observer = null;
      this.stopPlayback();
    } else this.startObserver();
    await this.refreshChatMemory();
    this.createPhoneLauncher();
    this.applyPhoneTheme();
    // The chat is looked at again only when what its line buttons depend on changed.
    if (
      this.isActive() &&
      (redecorate || linesChanged || previous.active === false)
    )
      this.scheduleScan();
    if (this.stateTrackingRuns()) this.scheduleStateTracking();
    // Smaller limits apply at once: what is now over them goes (영구 보관 stays).
    if (
      previous.cache?.max_size_mb !== this.config.cache?.max_size_mb ||
      previous.cache?.max_age_days !== this.config.cache?.max_age_days
    )
      this.run(() => this.pruneToLimits());
    // Another engine (or key) chosen: checked again for the status line.
    if (previous.engine !== this.config.engine) this.engineCheck = null;
    this.renderStatusBar();
  },

  phoneLauncherNote() {
    const mode = this.config.phone?.launcher || "both";
    const places = [];
    if (mode !== "menu") places.push("화면 구석의 플로팅 전화 버튼");
    if (mode !== "floating") places.push("마법봉 메뉴의 ‘씬보이스 전화’");
    const mobile =
      mode !== "menu" && this.config.phone?.launcher_events_only === true
        ? " 플로팅 버튼은 전화나 문자가 올 때만 나타납니다."
        : "";
    return `${places.join(" 또는 ")}로도 열 수 있습니다.${mobile}`;
  },

  /**
   * 전화 탭: the chat's card, then its contacts at a glance — where each one is (from the state
   * tracking), new texts, the last call — with a call and a text button for each.
   */
  async renderPhone() {
    const container = document.getElementById("sv-phone-tab");
    if (!container) return;
    const pending = this.phoneAlert();
    // Another bot card looked at (its settings and contacts, as they stand): a view of it.
    const openCards = this.hasCharacterChat() ? this.currentCardKeys() : [];
    if (openCards.includes(this.phoneTabCard)) this.phoneTabCard = "";
    let scope = this;
    if (this.phoneTabCard) {
      const view = this.cardView(this.phoneTabCard);
      if (view) {
        await view.loadChat().catch(() => undefined);
        scope = view;
      } else this.phoneTabCard = "";
    }
    const elsewhere = scope !== this;
    const otherText = this.otherAlertOnly?.();
    const notice = elsewhere
      ? '<p class="sv-notice"><i class="fa-solid fa-id-card-clip" aria-hidden="true"></i><span>지금 열려 있지 않은 봇카드입니다. 설정과 연락처를 볼 수 있고, 문자는 채팅을 옮기지 않고 보낼 수 있습니다. 전화는 그 채팅을 열어야 합니다.</span></p>'
      : otherText
        ? `<p class="sv-notice"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>다른 봇카드 ‘${escapeHtml(otherText.name)}’의 새 문자가 있습니다.</span></p>`
        : this.phoneSession
          ? '<p class="sv-notice sv-notice-ok"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i><span>통화 중입니다. 스마트폰을 열어 이어서 대화하십시오.</span></p>'
          : pending === "incoming_call"
            ? '<p class="sv-notice sv-notice-ok"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i><span>전화가 걸려 오고 있습니다.</span></p>'
            : pending === "voice_message"
              ? '<p class="sv-notice"><i class="fa-solid fa-microphone-lines" aria-hidden="true"></i><span>새 음성 메시지가 있습니다.</span></p>'
              : pending === "text_message"
                ? '<p class="sv-notice"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>새 문자가 있습니다.</span></p>'
                : "";
    const footer = `<div class="sv-actions sv-phone-actions">
                <button type="button" id="sv-open-smartphone" class="sv-btn sv-btn-primary sv-btn-lg"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i><span>스마트폰 열기</span></button>
                <button type="button" class="sv-btn sv-btn-lg" data-open-phone="history"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><span>통화 기록</span></button>
                <button type="button" id="sv-phone-settings-link" class="sv-btn sv-btn-lg"><i class="fa-solid fa-gear" aria-hidden="true"></i><span>전화 설정</span></button>
            </div>
            <p class="sv-hint sv-center">${escapeHtml(this.phoneLauncherNote())}</p>`;
    // The chat's card on top: who this chat is with, and what is on for it right now (the
    // names the settings use: 선연락, 먼저 전화, 먼저 문자, 채팅 기억, 시간 인식).
    const identity = scope.getStateIdentity();
    const voices = this.config.character_voices || {};
    // The open chat's card first, then every other card that has settings here.
    const cards = [
      ...openCards,
      ...Object.keys(voices).filter(
        (key) =>
          key.startsWith("character:") &&
          !openCards.includes(key) &&
          this.cardInfo(key).name !== key,
      ),
    ];
    const picker =
      cards.length > 1
        ? `<select id="sv-phone-card" aria-label="볼 봇카드">${cards
            .map(
              (key) =>
                `<option value="${escapeHtml(key)}" ${key === (this.phoneTabCard || openCards[0]) ? "selected" : ""}>${escapeHtml(this.cardInfo(key).name)}${openCards.includes(key) ? " (현재 채팅)" : ""}</option>`,
            )
            .join("")}</select>`
        : "";
    const phone = this.config.phone || {};
    // A card that isn't open only texts; what is shown is how its switches stand.
    const callsOn = elsewhere
      ? scope.outreachOn() &&
        Boolean(phone.auto_enabled) &&
        phone.call_me !== false
      : this.autoCallOn();
    const status = (on, label, more = "") =>
      `<span class="sv-badge ${on ? "sv-badge-on" : ""}">${label} ${on ? "켜짐" : "꺼짐"}${more}</span>`;
    const hero = (callWait = 0) => `
            <section class="sv-phone-hero">
                ${scope.characterAvatarMarkup()}
                <div class="sv-phone-hero-text">
                    <small>${elsewhere ? "다른 봇카드" : "현재 채팅 캐릭터"}</small>
                    ${picker || `<strong>${escapeHtml(identity.characterName)}</strong>`}
                    <div class="sv-badge-row">
                        ${status(scope.outreachOn(), "선연락")}
                        ${status(callsOn, "먼저 전화", callWait ? ` · 답변 ${callWait}개 뒤` : "")}
                        ${status(scope.autoTextOn(), "먼저 문자")}
                        ${status(scope.chatMemoryOn(), "채팅 기억")}
                        ${status(
                          (scope.currentCardKeys?.() || []).some((key) =>
                            this.realtimeFor(key),
                          ),
                          "시간 인식",
                        )}
                    </div>
                </div>
            </section>`;
    const contacts = scope.phoneContacts();
    const token = (this.phoneTabToken = (this.phoneTabToken || 0) + 1);
    container.classList.toggle("sv-phone-elsewhere", elsewhere);
    const pick = () =>
      document
        .getElementById("sv-phone-card")
        ?.addEventListener("change", (event) => {
          this.phoneTabCard = openCards.includes(event.target.value)
            ? ""
            : event.target.value;
          this.run(() => this.renderPhone());
        });
    let rows = [];
    let callWait = 0;
    if (contacts.length) {
      container.innerHTML = `${hero()}${notice}<div class="sv-loading-line">연락처를 불러오는 중…</div>`;
      pick();
      const board = await scope.phoneBoard(contacts);
      if (token !== this.phoneTabToken) return;
      rows = board.rows;
      callWait = board.callWait;
    }
    container.innerHTML = `${hero(callWait)}${notice}
            ${
              contacts.length
                ? `<section class="sv-board">
                <div class="sv-board-head"><strong>연락처 <em>${contacts.length}</em></strong></div>
                <ul class="sv-board-list">${rows.join("")}</ul>
            </section>`
                : emptyHtml(
                    "address-book",
                    "연락처가 없습니다",
                    scope.hasCharacterChat()
                      ? "설정 → 캐릭터별 목소리에서 인물을 등록하면 연락처로 나옵니다."
                      : "캐릭터나 그룹 채팅을 열면 그 채팅의 연락처가 나옵니다.",
                  )
            }
            ${elsewhere ? "" : footer}`;
    pick();
    const open = (tab = null) => {
      this.closeOverlay();
      this.openSmartphone(tab);
    };
    document
      .getElementById("sv-open-smartphone")
      ?.addEventListener("click", () => open());
    container
      .querySelectorAll("[data-open-phone]")
      .forEach((button) =>
        button.addEventListener("click", () => open(button.dataset.openPhone)),
      );
    container.querySelectorAll("[data-board-call]").forEach((button) =>
      button.addEventListener("click", () => {
        this.phoneContactKey = button.dataset.boardCall;
        open("call");
      }),
    );
    container.querySelectorAll("[data-board-text]").forEach((button) =>
      button.addEventListener("click", () => {
        if (elsewhere) {
          this.closeOverlay();
          this.run(() =>
            this.visitCard(scope.visitOf, button.dataset.boardText),
          );
          return;
        }
        this.messageThreadKey = button.dataset.boardText;
        open("message");
      }),
    );
    document
      .getElementById("sv-phone-settings-link")
      ?.addEventListener("click", () =>
        this.openSettingsGroup("sv-fold-smartphone"),
      );
  },

  /** 공통 · 캐릭터 · 스마트폰: one part of the settings shown, from its top. */
  showSettingsPane(pane) {
    const settings = document.getElementById("sv-settings-tab");
    if (!settings?.querySelector(`.sv-pane[data-pane="${pane}"]`)) return;
    this.settingsPane = pane;
    closeTips(document.getElementById("sv-panel"));
    settings
      .querySelectorAll(".sv-pane")
      .forEach((item) =>
        item.classList.toggle("sv-pane-on", item.dataset.pane === pane),
      );
    document
      .querySelectorAll("#sv-panel .sv-settings-subtabs .sv-subtab")
      .forEach((tab) =>
        tab.setAttribute("aria-selected", String(tab.dataset.pane === pane)),
      );
    settings.scrollTop = 0;
  },

  /** Opens the settings at one group: its part shown, the group unfolded and brought up. */
  /** 캐릭터 → 봇카드 공통 설정 → 스마트폰, at its 선연락 받기 switch. */
  openCardOutreach() {
    this.showSettingsPane("people");
    const section = document.querySelector("#sv-cast-panel .sv-cast-phone");
    if (!section) return;
    section.open = true;
    const box = document.getElementById("sv-cast-outreach");
    (box?.closest(".sv-switch-row") || section).scrollIntoView({
      block: "center",
    });
    box?.focus({ preventScroll: true });
  },

  openSettingsGroup(id) {
    this.changeTab("settings");
    const group = document.getElementById(id);
    if (!group) return;
    this.showSettingsPane(group.closest(".sv-pane")?.dataset.pane || "common");
    if (group.tagName === "DETAILS") group.open = true;
  },

  /** The rows of the 전화 tab, and how many AI replies 자동 전화 still waits for. */
  async phoneBoard(contacts) {
    const loadSessions = async () => {
      try {
        const response = await this.request(
          `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=80`,
          { cache: "no-store" },
          5000,
        );
        if (!response.ok) return [];
        // Calls with the user only (not those between two other people).
        return ((await response.json()).items || []).filter(
          (session) =>
            session.call_direction !== "overheard" && this.anchorShown(session),
        );
      } catch (_) {
        return []; // 통화 기록 없이도 연락처는 보여 준다.
      }
    };
    const tracked = new Map(
      this.statePeople().map((person) => [person.key, person]),
    );
    // The calls and everyone's state read at once, not one after another.
    const [sessions, round, records] = await Promise.all([
      loadSessions(),
      tracked.size ? this.loadStateRound().catch(() => null) : null,
      Promise.all(
        contacts.map((contact) =>
          tracked.has(contact.key)
            ? this.loadPersonState(tracked.get(contact.key)).catch(() => null)
            : null,
        ),
      ),
    ]);
    const badge = (tone, icon, text) =>
      `<span class="sv-badge ${tone}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${text}</span>`;
    const rows = [];
    for (const [index, contact] of contacts.entries()) {
      const record = records[index];
      const status = tracked.has(contact.key)
        ? this.stateStatus(contact.key, record, round)
        : null;
      const where = record?.state?.contact || {};
      const chips = [];
      if (status?.unknown)
        chips.push(badge("sv-badge-warn", "circle-question", "행방 모름"));
      else if (where.presence === "together")
        chips.push(badge("sv-badge-on", "user-group", "함께 있음"));
      else if (where.availability === "asleep")
        chips.push(badge("", "moon", "자는 중"));
      else if (where.availability === "busy")
        chips.push(badge("", "briefcase", "바쁨"));
      else if (where.availability === "free")
        chips.push(badge("sv-badge-on", "phone", "통화 가능"));
      else if (status?.away) chips.push(badge("", "door-open", "장면 밖"));
      if (this.unreadThreads.has(contact.key))
        chips.push(badge("sv-badge-new", "comment-dots", "새 문자"));
      const call = sessions.find(
        (session) => session.character_key === contact.key,
      );
      const lines = [
        call
          ? `최근 통화 ${this.formatPhoneDate(call.started_at)} · ${this.callStatusLabel(call)}`
          : "통화 기록 없음",
      ];
      // Together (not named to reach out) or asleep (see contactChance): not now.
      if (
        !status?.unknown &&
        (where.presence === "together" || where.availability === "asleep")
      )
        lines.push("지금은 선연락 안 함");
      const name = escapeHtml(contact.name);
      rows.push(`<li class="sv-board-row">
                ${this.contactAvatarMarkup(contact)}
                <div class="sv-board-main">
                    <div class="sv-board-name"><strong>${name}</strong>${chips.join("")}</div>
                    <small>${escapeHtml(lines.join(" · "))}</small>
                </div>
                <div class="sv-board-actions">
                    <button type="button" class="sv-icon-btn sv-board-text" data-board-text="${escapeHtml(contact.key)}" title="문자" aria-label="${name}에게 문자"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i></button>
                    <button type="button" class="sv-icon-btn sv-board-call" data-board-call="${escapeHtml(contact.key)}" title="전화" aria-label="${name}에게 전화"><i class="fa-solid fa-phone" aria-hidden="true"></i></button>
                </div>
            </li>`);
    }
    // A call first waits for N AI replies after the last call (loadRecentCallContext counts the same way).
    let callWait = 0;
    if (this.autoCallOn()) {
      const cooldown = 0;
      const latest = sessions[0];
      const anchor = /^\d+$/.test(String(latest?.anchor_message_id || ""))
        ? Number(latest.anchor_message_id)
        : null;
      callWait = latest
        ? Math.max(0, cooldown - this.assistantMessagesSince(anchor))
        : 0;
    }
    return { rows, callWait };
  },
};
