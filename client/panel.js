// 설정 창: its tabs, the settings form (saved automatically) and applying saved settings.
import { escapeHtml, mergeConfig, contentKey, LANGUAGE_CHOICES, OVERHEARD_LENGTH_CHOICES } from "./common.js";
import { elevenModelTraits } from "../shared/settings.js";
import { infoTip, groupHtml, fieldHtml, switchHtml, rangeHtml, badgeHtml, bindInfoTips, bindRanges, bindStateBadges, closeTips, choiceListHtml, emptyHtml } from "./ui.js";
import { voicePickHtml } from "./voice-picker.js";

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

export const panel = {
  async openPanel() {
    if (document.getElementById("sv-overlay")) await this.saveSettingsNow();
    await this.loadConfig();
    await this.syncMultiCastCast?.({ panel: true });
    await this.refreshChatMemory();
    document.getElementById("sv-overlay")?.remove();
    const config = this.config;
    const profiles = this.getConnectionProfiles().map((profile) => [
      profile.id,
      profile.name || profile.model || profile.id,
    ]);
    const profileSelect = (id, selected, emptyLabel) =>
      `<select id="${id}"><option value="">${emptyLabel}</option>${options(profiles, selected)}</select>`;
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
    const basicGroup = groupHtml({
      id: "sv-group-basic",
      icon: "power-off",
      title: "기본",
      body: `${switchHtml({ id: "sv-active", label: "씬보이스 사용", tip: "끄면 모든 기능이 멈춥니다. 저장된 기록과 설정은 그대로입니다.", checked: config.active !== false })}
      <div class="sv-basic-on">
        <hr class="sv-divider">
        ${switchHtml({ id: "sv-enabled", label: "채팅 대사 읽기", hint: "채팅 메시지의 대사·생각을 음성으로 만듭니다. 끄면 스마트폰 기능만 씁니다.", tip: multicast ? "채팅 대사를 MultiCast 확장으로 들을 때는 끄세요. 씬보이스 설정은 MultiCast 확장과 따로입니다. 함께 쓰는 것은 ElevenLabs API 키(실리태번 기본 TTS 칸)와, 자동 연동한 인물의 목소리·연기 설정뿐입니다." : "", checked: config.enabled !== false })}
        <div class="sv-notice sv-chat-off-only"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>채팅 대사 읽기를 끄면 스마트폰에 쓰이는 설정만 보입니다.</span></div>
        <div class="sv-basic-chat">
          ${multicastReads ? '<div class="sv-notice sv-notice-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>MultiCast 확장도 채팅 대사를 읽고 있습니다. 한 확장만 읽게 하세요. 이쪽 ‘채팅 대사 읽기’를 끄면 씬보이스는 스마트폰만 씁니다.</span></div>' : ""}
          <div class="sv-row">
            ${switchHtml({ id: "sv-line-buttons", label: "대사 옆 재생 버튼", hint: "끄면 대사 옆 버튼을 숨기고 ‘음성 준비’로만 듣습니다.", checked: config.playback?.line_buttons !== false })}
            ${switchHtml({ id: "sv-prepare", label: "음성 준비·이어 듣기", hint: "메시지 버튼 줄의 ‘음성 준비’로 대사를 차례로 만들며 이어서 들려줍니다.", checked: config.playback?.prepare !== false })}
          </div>
          <div class="sv-row sv-basic-prepare">
            ${switchHtml({ id: "sv-auto-play", label: "새 답변 자동 재생", hint: "새 메시지가 도착하면 분석·생성·재생까지 바로 합니다.", tip: "지난 메시지와 통화 중에는 읽지 않습니다. 휴대폰에서는 화면을 한 번 누른 뒤부터 자동으로 재생됩니다.", checked: config.playback?.auto_new === true })}
          </div>
          <div class="sv-row">
            <div class="sv-field">
              <div class="sv-label-line"><span id="sv-caption-label">읽고 있는 대사 자막</span>${infoTip("지금 읽는 대사를 실리태번 상단바 아래에 한 줄로 띄웁니다. ‘필요할 때만’은 화면의 대사와 짝이 맞지 않을 때(번역문만 보일 때)나 재생 버튼을 숨겼을 때 띄웁니다.", "읽고 있는 대사 자막 설명")}</div>
              <div class="sv-seg" role="radiogroup" aria-labelledby="sv-caption-label">
                ${[["off", "끔"], ["auto", "필요할 때만"], ["always", "항상"]].map(([value, label]) => `<label><input type="radio" name="sv-caption" value="${value}" ${(config.playback?.caption || "always") === value ? "checked" : ""}><span>${label}</span></label>`).join("")}
              </div>
            </div>
          </div>
        </div>
      </div>`,
    });

    const engineGroup = groupHtml({
      id: "sv-group-engine",
      icon: "wave-square",
      title: "음성 엔진",
      scope: "채팅·스마트폰",
      tip: [
        "ElevenLabs 키는 실리태번 TTS 설정에서, Fish 키는 여기서 넣습니다. 키는 공유 목록·백업에 들어가지 않습니다.",
        "인물마다 엔진·목소리는 화자 설정에서 따로 정할 수 있고, 모델·속도 같은 나머지는 이 설정을 씁니다.",
      ].join("\n"),
      body: `<div class="sv-notice sv-mc-engine-note"><i class="fa-solid fa-link" aria-hidden="true"></i><span>MultiCast 확장을 사용 중이라 씬보이스의 음성 엔진 설정이 숨겨집니다. 전화·문자도 MultiCast 확장의 API 키와 음성 설정을 그대로 씁니다.</span></div>
      <div class="sv-row">
        ${fieldHtml({
          id: "sv-engine",
          label: "음성 엔진",
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
            "새 모델은 ‘직접 입력…’에 모델 ID(예: eleven_v5)를 넣으세요.",
          ].join("\n"),
          control: `<select id="sv-eleven-model">${options(ELEVEN_MODELS, ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? config.elevenlabs.model : "__custom__")}</select><input type="text" id="sv-eleven-model-custom" class="${ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? "hidden" : ""}" value="${escapeHtml(ELEVEN_MODELS.some(([value]) => value === config.elevenlabs?.model) ? "" : config.elevenlabs?.model || "")}" placeholder="모델 ID (예: eleven_v5)" autocomplete="off" spellcheck="false" aria-label="ElevenLabs 모델 ID 직접 입력">`,
        })}
        ${fieldHtml({ id: "sv-fish-model", label: "Fish 모델", cls: "sv-engine-section", attrs: 'data-engine="fish"', tip: "연기 태그를 [frustrated, emphatic]처럼 하나로 묶어 대사 앞에 붙입니다.", control: `<select id="sv-fish-model">${options(FISH_MODELS, FISH_MODELS.some(([value]) => value === config.fish?.model) ? config.fish.model : "s2.1-pro-free")}</select>` })}
      </div>
      ${divider}
      ${stMode ? `<p class="sv-notice sv-engine-section" data-engine="elevenlabs"><i class="fa-solid fa-key" aria-hidden="true"></i><span>ElevenLabs API 키는 <b>실리태번 기본 TTS 설정 → ElevenLabs</b>에서 입력합니다${multicast ? "(MultiCast 확장에서 넣은 키도 같은 칸이라 그대로 씁니다)" : ""}.</span></p>` : ""}
      <div class="sv-row sv-engine-section sv-chat-only" data-engine="elevenlabs">
        ${["male", "female"]
          .map((gender) => {
            // Before the split there was one default voice; it fills whichever side is still empty.
            const value = config.elevenlabs?.[`voice_id_${gender}`] || config.elevenlabs?.voice_id || "";
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
        <button type="button" id="sv-load-voices" class="sv-btn sv-btn-sm"><i class="fa-solid fa-arrow-rotate-right" aria-hidden="true"></i><span>내 보이스 목록 불러오기</span></button>
        <small class="sv-hint" id="sv-voice-tools-note"></small>
      </div>
      <div class="sv-row sv-engine-section" data-engine="elevenlabs" ${stMode ? "hidden" : ""}>
        ${fieldHtml({ id: "sv-eleven-key", label: "API 키", control: `<input type="password" id="sv-eleven-key" autocomplete="off" ${stMode ? "disabled" : ""} placeholder="${config.elevenlabs?.has_api_key ? "저장된 키 유지 · 바꿀 때만 입력" : "ElevenLabs API 키"}">` })}
        <div class="sv-field sv-field-action"><button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-sv-clear-key="elevenlabs" ${stMode || !config.elevenlabs?.has_api_key ? "disabled" : ""}><i class="fa-solid fa-key" aria-hidden="true"></i><span>저장된 ElevenLabs 키 삭제</span></button></div>
      </div>
      <hr class="sv-divider sv-engine-section" data-engine="elevenlabs">
      <div class="sv-row sv-engine-section" data-engine="elevenlabs">
        ${fieldHtml({ id: "sv-eleven-stability", label: "연기 일관성", tip: "높을수록 차분하고 일정하게, 낮을수록 감정 기복이 크게 연기합니다. v3는 0 / 0.5 / 1 중 가까운 값으로 맞춥니다.", control: rangeHtml({ id: "sv-eleven-stability", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.stability ?? 0.5 }) })}
        ${fieldHtml({ id: "sv-eleven-similarity", label: "원래 목소리 유사도", control: rangeHtml({ id: "sv-eleven-similarity", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.similarity_boost ?? 0.75 }) })}
      </div>
      <div class="sv-row sv-engine-section" data-engine="elevenlabs" id="sv-eleven-tune-row">
        ${fieldHtml({ id: "sv-eleven-speed", label: "말하기 속도", attrs: 'id="sv-eleven-speed-row"', tip: "0.7~1.2. Multilingual v2·Flash에만 적용됩니다(v4에는 없음). 크게 바꾸면 발음이 어색해질 수 있습니다.", control: rangeHtml({ id: "sv-eleven-speed", min: 0.7, max: 1.2, step: 0.05, value: config.elevenlabs?.speed ?? 1 }) })}
        ${fieldHtml({ id: "sv-eleven-style", label: "스타일 과장도", attrs: 'id="sv-eleven-style-row"', hint: "v3·Multilingual v2에만 적용됩니다.", tip: "Style Exaggeration. 높일수록 목소리 특유의 말투를 과장합니다. 불안정해질 수 있어 공식 안내는 대개 0을 권합니다.", control: rangeHtml({ id: "sv-eleven-style", min: 0, max: 1, step: 0.05, value: config.elevenlabs?.style ?? 0.2 }) })}
      </div>

      <div class="sv-row sv-engine-section" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-key", label: "API 키", control: `<input type="password" id="sv-fish-key" autocomplete="off" placeholder="${config.fish?.has_api_key ? "저장된 키 유지 · 바꿀 때만 입력" : "Fish Audio API 키"}">`, hint: "이 브라우저에만 저장됩니다. 실리태번 config.yaml의 enableCorsProxy: true가 필요합니다." })}
      </div>
      <div class="sv-row sv-engine-section sv-chat-only" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-reference-male", label: "남성 기본 Reference ID", tip: defaultVoiceTip, control: `<input type="text" id="sv-fish-reference-male" value="${escapeHtml(config.fish?.reference_id_male || config.fish?.reference_id || "")}" placeholder="공개 또는 직접 만든 보이스 ID" autocomplete="off" spellcheck="false">` })}
        ${fieldHtml({ id: "sv-fish-reference-female", label: "여성 기본 Reference ID", tip: defaultVoiceTip, control: `<input type="text" id="sv-fish-reference-female" value="${escapeHtml(config.fish?.reference_id_female || config.fish?.reference_id || "")}" placeholder="공개 또는 직접 만든 보이스 ID" autocomplete="off" spellcheck="false">` })}
      </div>
      <hr class="sv-divider sv-engine-section" data-engine="fish">
      <div class="sv-row sv-engine-section" data-engine="fish">
        ${fieldHtml({ id: "sv-fish-speed", label: "말하기 속도", control: rangeHtml({ id: "sv-fish-speed", min: 0.5, max: 2, step: 0.05, value: config.fish?.speed ?? 1 }) })}
        <div class="sv-field sv-field-action"><button type="button" class="sv-btn sv-btn-ghost-danger sv-btn-sm" data-sv-clear-key="fish" ${config.fish?.has_api_key ? "" : "disabled"}><i class="fa-solid fa-key" aria-hidden="true"></i><span>이 브라우저의 Fish 키 삭제</span></button></div>
      </div>
      <div class="sv-engine-check">
        <button type="button" id="sv-engine-check" class="sv-btn sv-btn-sm"><i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i><span>연결 확인</span></button>
        <p id="sv-engine-check-result" class="sv-engine-check-result" role="status">키와 기본 보이스를 확인합니다. 음성을 만들지 않아 비용이 들지 않습니다.</p>
      </div>`,
    });

    const analysisGroup = groupHtml({
      id: "sv-group-analysis",
      icon: "wand-magic-sparkles",
      title: "보조모델 분석",
      scope: "채팅·스마트폰",
      tip: [
        "하나의 메시지에 있는 대사를 한 번에 분석합니다. 채팅 원문은 바꾸지 않습니다.",
        "음성 엔진에는 원래 대사와 연기 태그만 보냅니다.",
        "실리태번의 지금 연결은 그대로 두고, 고른 연결 프로필로 따로 요청합니다(요청마다 비용).",
      ].join("\n"),
      body: `<div class="sv-row">
        ${fieldHtml({ id: "sv-connection-profile", label: "실리태번 연결 프로필", control: profileSelect("sv-connection-profile", config.connection_profile_id, "사용 안 함") })}
        ${fieldHtml({ id: "sv-context-messages", cls: "sv-chat-only", label: "참고할 직전 메시지 수", control: number("sv-context-messages", Number(config.context_messages ?? 4), 'min="0" max="12"') })}
      </div>
      <div class="sv-row">
        ${fieldHtml({ id: "sv-max-input", label: "최대 입력 토큰", tip: "보낼 자료가 이 크기를 넘을 때만 참고 자료를 줄입니다.\n지시문, 캐릭터 설정(프로필·월드 인포·연기 메모), 분석할 대사와 화자 목록은 줄이지 않습니다.\n채팅과 통화·문자 내용은 남은 자리를 나눠 쓰고, 오래된 것부터 잘립니다.", control: number("sv-max-input", Number(config.llm?.max_input_tokens ?? 0), 'min="0" max="2000000" step="1000"'), hint: "0 = 연결 프로필 프리셋 따라감" })}
        ${fieldHtml({ id: "sv-max-output", label: "최대 출력 토큰", tip: "보조모델 답의 최대 길이입니다. 0이면 프리셋 값을 쓰되 작업에 모자라면 필요한 만큼 늘립니다. 추론(생각하는) 모델은 넉넉하게 두세요.", control: number("sv-max-output", Number(config.llm?.max_output_tokens ?? 0), 'min="0" max="200000" step="100"'), hint: "0 = 연결 프로필 프리셋 따라감" })}
      </div>
      ${divider}
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
        ${switchHtml({ id: "sv-analysis-auto", cls: "sv-chat-only", label: "새 메시지가 오면 바로 분석", hint: "AI 메시지가 도착하면 화자·연기 태그를 미리 분석해 둡니다. 음성은 만들지 않습니다.", tip: "끄면 재생 버튼을 누를 때 분석을 시작합니다. 켜면 기다림이 줄고 화자 확인이 필요한 대사를 미리 알 수 있지만, 듣지 않을 메시지도 메시지마다 보조모델 요청이 1번씩 늘어납니다.", checked: config.llm?.auto_analyze === true })}
      </div>
      <hr class="sv-divider sv-chat-only">
      <div class="sv-row sv-chat-only">
        ${switchHtml({ id: "sv-casting-auto", label: "자동 화자 구분", hint: "보조 모델이 등록한 이름·별명과 문맥으로 대사마다 화자를 고릅니다.", checked: config.casting?.auto_enabled })}
      </div>
      ${choiceListHtml({
        name: "sv-casting-uncertain",
        cls: "sv-chat-only sv-casting-only sv-choices-across",
        label: "화자가 불확실한 대사 (음성 준비·이어 듣기)",
        tip: "‘음성 준비’로 한 번에 만들 때만 적용됩니다. 대사 버튼을 하나씩 누를 때는 화자를 고르라고 알려 드립니다.",
        value: config.casting?.uncertain === "default" ? "default" : "skip",
        choices: [
          ["skip", "forward", "건너뛰기", "화자를 고를 때까지 만들지 않습니다"],
          ["default", "user", "기본 목소리로 만들기", "보조모델이 추정한 성별에 맞춰 생성합니다"],
        ],
      })}
      <hr class="sv-divider sv-chat-only">
      <div class="sv-row">
        ${switchHtml({
          id: "sv-eleven-sfx",
          label: "효과음 태그 넣기",
          hint: "장면에 어울리면 문 여닫는 소리, 발소리 같은 짧은 효과음을 넣습니다.",
          checked: config.elevenlabs?.sound_effects === true,
          tip: [
            "ElevenLabs v4·v3 모델일 때 엔진이 직접 소리를 냅니다(채팅 대사·전화·음성 메시지).",
            "채팅 대사는 연기 태그 분석이 켜져 있어야 넣습니다.",
            ...(this.soundNames?.().length
              ? ["MultiCast 확장을 쓰면 전화·음성 메시지에는 MultiCast 확장에 있는 효과음 파일을 섞어서, 엔진과 상관없이 소리가 납니다(MultiCast 확장에 직접 넣은 소리 먼저)."]
              : []),
          ].join("\n"),
        })}
        ${this.soundNames?.().length ? switchHtml({ id: "sv-sfx-in-file", cls: "sv-sfx-only", label: "효과음도 음성 파일에 저장", hint: "전화·음성 메시지에 넣은 MultiCast 확장 효과음을 목소리와 섞어 저장해 기록·보관함·내려받기에서도 함께 들립니다.", tip: "끄면 실리태번에서 들을 때만 효과음이 섞여 나오고, 기록·보관함·내려받기에서는 목소리만 들립니다.", checked: config.phone?.sfx_in_file !== false }) : ""}
      </div>
      <hr class="sv-divider sv-chat-only">
      <div class="sv-row sv-chat-only">
        ${switchHtml({ id: "sv-analysis-persona", label: "유저 페르소나 참고", hint: "대사 분석에 페르소나 Description도 보냅니다. 끄면 말투 메모와 채팅만 봅니다.", checked: config.llm?.analysis_include_persona })}
        ${switchHtml({ id: "sv-analysis-character", label: "봇 프로필 참고", hint: "대사 분석에 봇카드 Description도 보냅니다. 끄면 말투 메모와 채팅만 봅니다.", checked: config.llm?.analysis_include_character !== false })}
      </div>
`,
    });

    const castingGroup = groupHtml({
      id: "sv-group-casting",
      icon: "users",
      title: "캐릭터별 목소리",
      scope: "채팅·스마트폰",
      tip: [
        "별명을 함께 적으면 구분이 정확해집니다(예: 하루 / Haru, 봄이).",
        "화자가 확실하지 않은 대사는 대사 옆 ⋯ 메뉴에서 직접 고릅니다.",
      ].join("\n"),
      body: `<div id="sv-casting-settings"></div>`,
    });

    const readingGroup = this.readingGroupHtml(config);

    const stateFold = groupHtml({
      id: "sv-fold-state",
      icon: "heart-pulse",
      title: "캐릭터 상태 추적",
      scope: "스마트폰",
      tip: [
        "연락처의 인물마다(페르소나 제외) 신체·감정·생각·관계 상태를 따로 저장하고, 대사 분석과 전화·문자가 그 인물의 상태를 참고합니다.",
        "한 번의 요청으로 인물 전원을 살피며, 최근 채팅에서 새로 드러난 게 있는 인물만 바뀝니다(마지막으로 확인된 상태를 간직).",
        "장면을 떠난 인물은 ‘장면 밖’, 어디 있는지 모르면 ‘행방 모름’으로 표시합니다. 상태 탭에서 보고 직접 고칠 수 있습니다.",
      ].join("\n"),
      body: `<p class="sv-notice sv-notice-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>인물이 전화·메시지를 보낼지 판단하는 데 씁니다. 채팅 속 화자·대화를 분석하는 데에도 활용되지만, 스마트폰을 안 쓴다면 큰 의미는 없습니다. 자동 전화·문자를 켜면 이 스위치가 꺼져 있어도 새 AI 메시지마다 상태 분석을 요청합니다.</span></p>
      ${switchHtml({ id: "sv-state-enabled", label: "상태 추적 사용", checked: config.state_tracking?.enabled })}
      ${divider}
      <div class="sv-row">
        ${fieldHtml({ id: "sv-state-profile", label: "상태 분석 연결 프로필", control: profileSelect("sv-state-profile", config.state_tracking?.connection_profile_id, "보조모델 분석과 같게") })}
        ${fieldHtml({ id: "sv-state-context", label: "참고할 최근 메시지 수", control: number("sv-state-context", Number(config.state_tracking?.context_messages ?? 8), 'min="1" max="20"'), hint: "실리태번 채팅 메시지 수입니다. 이 메시지들에서 새로 드러난 게 있는 인물만 갱신합니다." })}
      </div>
      <div class="sv-row">
        ${fieldHtml({ id: "sv-state-every", label: "갱신 주기 (AI 답변 수)", control: number("sv-state-every", Number(config.state_tracking?.every_messages ?? 2), 'min="1" max="20"'), hint: "새 AI 답변이 이만큼 쌓일 때마다 갱신하고, 먼저 연락할지도 이때 정합니다." })}
      </div>
`,
    });

    // Three sections: the phone as a whole (shared by calls and texts), then calls, then texts.
    const smartphoneFold = groupHtml({
      id: "sv-fold-smartphone",
      icon: "mobile-screen-button",
      title: "스마트폰",
      tip: [
        "전화와 문자에 함께 쓰는 설정입니다.",
        "통화·문자는 캐릭터와 페르소나 Description을 참고하고, 월드인포는 ‘월드인포 참고’를 켰을 때만 넣습니다.",
      ].join("\n"),
      body: `<div class="sv-row sv-phone-app-row">
          ${switchHtml({ id: "sv-phone-app", label: "스마트폰 사용", tip: "끄면 스마트폰과 플로팅 버튼·마법봉 메뉴가 사라지고, 기능하지 않습니다. 저장된 통화·문자와 채팅 기억은 그대로입니다.", checked: config.phone?.app_enabled !== false })}
        </div>
        ${divider}
        <div class="sv-row">
          ${fieldHtml({ id: "sv-phone-profile", label: "연결 프로필", control: profileSelect("sv-phone-profile", config.phone?.connection_profile_id, "보조모델 분석과 같게") })}
          ${fieldHtml({ id: "sv-phone-context", label: "참고할 최근 메시지 수", control: number("sv-phone-context", Number(config.phone?.context_messages ?? 10), 'min="1"'), hint: "실리태번 채팅 메시지 수입니다. 최대 입력 토큰을 넘으면 오래된 메시지부터 잘립니다.", tip: "개수 제한은 없습니다. 많이 넣을수록 요청 비용이 늘어납니다.\n보낼 자료가 ‘보조모델 분석 → 최대 입력 토큰’(0이면 연결 프로필 프리셋의 컨텍스트 크기)을 넘으면, 지시문과 캐릭터 설정(프로필·월드 인포·연기 메모)은 그대로 두고 채팅과 지금 주고받는 통화·문자가 남은 자리를 나눠 씁니다. 둘 다 오래된 것부터 잘립니다." })}
        </div>
        <div class="sv-row">
          ${fieldHtml({ id: "sv-default-language", label: "통화·메시지 언어", control: `<select id="sv-default-language">${options(LANGUAGES, config.default_language)}</select>`, hint: "자동이면 인물마다 정한 언어, 정하지 않았으면 대화 언어로 말합니다.", tip: "여기서 언어를 고르면 인물 설정과 상관없이 모든 인물이 그 언어로 말합니다." })}
          ${switchHtml({ id: "sv-phone-translation", label: "한국어 번역 함께 보기", hint: "한국어가 아닌 통화·메시지에 번역을 아래에 붙입니다.", checked: config.phone?.show_translation !== false, tip: "같은 요청에서 함께 받으므로 요청 수는 늘지 않습니다." })}
        </div>
        ${divider}
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
          ${switchHtml({ id: "sv-phone-launcher-alerts", label: "알림이 올 때만 플로팅 버튼 표시", hint: "플로팅 버튼을 숨겼다가, 알림이 오면 확인할 때까지 보여 줍니다.", checked: config.phone?.launcher_events_only === true })}
          ${switchHtml({ id: "sv-phone-filter", label: "폰 음질 효과", hint: "통화·음성 메시지·음성 메모는 폰 너머 소리처럼, 라디오는 라디오 소리처럼 들려요. 켜면 모두, 끄면 모두.", tip: "재생할 때만 입히고 저장된 음성은 그대로 둡니다. 영상·내려받기의 통화 소리에도 같은 효과가 들어갑니다.", checked: config.phone?.audio_filter !== false })}
        </div>
        ${divider}
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-memo", label: "음성 메모", hint: "인물이 혼자 휴대폰에 남긴 음성 메모를 엿들어요. 홈 화면의 ‘음성 메모’에서 직접 만들거나, ‘상태 추적’ 기능을 켜 두면 인물이 가끔 알아서도 남겨요.", tip: "알아서 남기는 건 상태를 갱신할 때 ‘지금 메모를 남길 만한 사람’을 함께 판단해(추가 요청 없음) 그중 30% 정도만 실제로 남깁니다. 한 번에 한 명까지, 자는 중이면 남기지 않습니다.\n엿듣기용이라 채팅 기억에는 넣지 않고, 메모 카드에 몇 번째 채팅 무렵인지만 표시합니다. 메모 하나에 보조모델 요청 1번, 목소리는 들을 때 만듭니다.", checked: config.phone?.memo_app !== false })}
          ${switchHtml({ id: "sv-phone-radio", label: "라디오", hint: "인물들이 지금까지의 이야기를 두고 떠드는 라디오, 또는 내 사연을 읽어 주는 방송을 홈 화면 ‘라디오’에서 만들어 들어요.", tip: "재미용 번외 기능입니다. 방송 하나에 보조모델 요청 1번, 목소리는 들을 때 만듭니다. 채팅 기억에는 들어가지 않습니다.", checked: config.phone?.radio_app === true })}
        </div>`,
    });

    const phoneFold = groupHtml({
      id: "sv-fold-phone",
      fold: true,
      icon: "phone",
      title: "전화",
      badge: badgeHtml("sv-phone-auto", "자동 전화 켜짐", "자동 전화 꺼짐"),
      tip: [
        "글로 답하는 역할극 통화입니다(마이크 인식 아님). 상대 대사는 그 인물의 목소리로 읽습니다.",
        "걸려 온 전화는 받기 전에는 대사나 음성을 만들지 않고, 1분 동안 받지 않으면 부재중이 됩니다.",
        "상태 추적을 켜 두면, ‘바쁨’인 인물에게 건 전화는 그 사람의 음성사서함으로 갑니다(인사말은 처음 한 번 만들어 둡니다). 남기든 그냥 끊든 몇 분 뒤 문자나 전화로 연락이 오고, 그 전에 다시 걸면 받습니다.",
      ].join("\n"),
      body: `<div class="sv-row">
          ${switchHtml({ id: "sv-phone-auto", label: "캐릭터가 먼저 전화하기", hint: "대화 흐름상 자연스러울 때 전화가 걸려 옵니다.", checked: config.phone?.auto_enabled })}
          ${fieldHtml({ id: "sv-phone-cooldown", label: "자동 전화 최소 간격", control: number("sv-phone-cooldown", Number(config.phone?.auto_cooldown_messages ?? 0), 'min="0" max="100"'), hint: "마지막 통화 뒤 새 채팅이 이만큼 쌓여야 다시 겁니다. 0이면 간격 없이." })}
        </div>
        ${divider}
        <div class="sv-row">
          ${choiceListHtml({
            name: "sv-phone-voice-mode",
            label: "통화 음성 만들기",
            value: config.phone?.auto_voice === false ? "tap" : "auto",
            choices: [
              ["auto", "bolt", "바로 생성", "상대가 대답하자마자 만들어 재생합니다"],
              ["tap", "hand-pointer", "누를 때 생성", "‘재생’을 눌러야 만들어 그만큼 비용을 아낍니다"],
            ],
          })}
        </div>
        ${divider}
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-voicemail", label: "음성 사서함", hint: "걸려 온 전화를 거절하거나 1분 안에 받지 않으면 상대가 짧은 음성 메시지를 남깁니다.", tip: "남길 때마다 보조모델 요청이 한 번 들고, ‘통화 음성 만들기’가 ‘바로 생성’이면 목소리도 바로 만듭니다.\n통화 기록에서 듣고, 채팅 기억에도 그 통화와 함께 남습니다. 다시 전화하면 상대는 내가 전화를 못 받은 걸 압니다.", checked: config.phone?.voicemail !== false })}
          ${switchHtml({ id: "sv-phone-overheard", label: "엿듣는 통화", hint: "켜면 떨어져 있는 인물들끼리 가끔 알아서 통화하고, 통화 기록에서 엿들을 수 있습니다.", tip: "상태를 갱신할 때 둘이 지금 통화할 만하다고 판단되면, 거는 사람의 ‘먼저 연락하는 빈도’만큼의 확률로 생깁니다. 꺼 두어도 통화 기록의 ‘통화 엿듣기’로 직접 만들 수 있습니다.\n대사는 요청 한 번에 받아 두고, 목소리는 ‘전체 듣기’를 누를 때 만듭니다. 내 캐릭터는 이 통화를 모르고, 채팅 기억에도 ‘내 캐릭터는 듣지 못한 통화’로 남습니다.", checked: config.phone?.overheard_calls === true })}
        </div>
        <div class="sv-row">
          <div class="sv-field">
            <div class="sv-label-line"><span id="sv-phone-overheard-length-label">엿듣는 통화 길이</span>${infoTip("자동으로 생기는 통화와 통화 기록의 ‘통화 엿듣기’로 직접 만드는 통화에 모두 씁니다. 직접 만들 때는 그 자리에서 그 통화만 따로 고를 수 있습니다.\n줄 수는 대략이라 조금 넘나들 수 있습니다.", "엿듣는 통화 길이 설명")}</div>
            <div class="sv-seg" role="radiogroup" aria-labelledby="sv-phone-overheard-length-label">
              ${OVERHEARD_LENGTH_CHOICES.map(([value, label]) => `<label><input type="radio" name="sv-phone-overheard-length" value="${value}" ${(config.phone?.overheard_length || "normal") === value ? "checked" : ""}><span>${label.split(" (")[0]}</span></label>`).join("")}
            </div>
            <small class="sv-hint">짧게 4~6줄 · 보통 6~12줄 · 길게 12~20줄. 길수록 요청·음성 비용이 늘어납니다.</small>
          </div>
        </div>
        ${divider}
        <div class="sv-row">
          ${switchHtml({ id: "sv-phone-ringtone", label: "수신 벨소리", checked: config.phone?.ringtone !== false })}
          ${switchHtml({ id: "sv-phone-vibration", label: "모바일 진동", hint: "안드로이드 크롬처럼 진동을 지원하는 브라우저에서만 됩니다(아이폰은 안 됨).", checked: config.phone?.vibration !== false })}
        </div>`,
    });

    const voiceMessageFold = groupHtml({
      id: "sv-fold-voice-message",
      fold: true,
      icon: "comment-dots",
      title: "문자",
      badge: badgeHtml("sv-voice-message-enabled", "먼저 보내기 켜짐", "먼저 보내기 꺼짐"),
      tip: [
        "문자는 글로 오고, 말풍선의 재생 버튼을 누를 때 음성을 만듭니다.",
      ].join("\n"),
      body: `<div class="sv-row">
        ${switchHtml({ id: "sv-voice-message-enabled", label: "캐릭터가 먼저 보내기", hint: "대화 흐름상 자연스러울 때 문자나 음성 메시지가 옵니다.", checked: config.voice_message?.enabled })}
        ${switchHtml({ id: "sv-voice-message-reply-voice", label: "답장에 음성 메시지도 섞기", hint: "보통은 문자로 답하고, 어울릴 때만 녹음해서 보내는 음성 메시지로 답합니다.", checked: config.voice_message?.reply_voice !== false })}
      </div>
      <div class="sv-row">
        ${switchHtml({ id: "sv-voice-message-auto-audio", label: "음성 메시지는 받는 즉시 음성까지 생성", hint: "켜면 듣지 않은 음성 메시지도 음성 생성 비용이 듭니다.", tip: "문자는 이 설정과 상관없이 ‘재생’을 누를 때만 음성을 만듭니다.", checked: config.voice_message?.auto_generate_audio })}
        ${switchHtml({ id: "sv-voice-message-sounds", label: "문자 알림음", hint: "말풍선을 보내고 받을 때마다 짧은 소리를 냅니다.", checked: config.voice_message?.sounds !== false })}
      </div>
`,
    });

    const memoryFold = groupHtml({
      id: "sv-fold-memory",
      fold: true,
      icon: "book-bookmark",
      title: "채팅 기억 연동",
      badge: badgeHtml("sv-chat-memory-enabled"),
      tip: [
        "끝난 통화·음성 메시지·주고받은 문자는 스위치와 상관없이 늘 그때의 채팅 메시지에 기록해 둡니다.",
        "켜면 그 기록을 메시지 아래 ‘통화·메시지 채팅 기억’에 보여 주고, 이후 답변을 만들 때 그 자리에 넣습니다. 꺼 두었다가 켜도 그동안의 기록이 바로 반영됩니다.",
        "되돌렸거나 다른 스와이프에서 주고받은 기록은 넣지 않습니다(스마트폰의 미적용 기억).",
      ].join("\n"),
      body: `<div class="sv-row">
        ${switchHtml({ id: "sv-chat-memory-enabled", label: "통화·메시지를 채팅에 반영", hint: "켜면 채팅 화면에 보이고, 캐릭터가 통화·문자 내용을 기억합니다.", checked: config.chat_memory?.enabled })}
        <div class="sv-field sv-field-action"><button type="button" id="sv-chat-memory-clear" class="sv-btn sv-btn-danger"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>현재 채팅의 연동 기억 삭제</span></button></div>
      </div>`,
    });

    const storageFold = groupHtml({
      id: "sv-fold-storage",
      fold: true,
      icon: "hard-drive",
      title: "저장 공간",
      tip: [
        "음성과 목록·설정은 실리태번 사용자 폴더의 files에 scenevoice_로 시작하는 파일로 저장합니다.",
        "여러 기기에서 동시에 설정을 바꾸거나 음성을 만들지 마세요(한 번에 한 기기).",
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
        ${this.favoritesPath ? `<p class="sv-hint sv-path-note"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> 저장 위치: ${escapeHtml(this.favoritesPath)}</p>` : ""}
        <div class="sv-actions">
          <button type="button" id="sv-cache-clear" class="sv-btn sv-btn-danger"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>생성 음성 전체 삭제</span></button>
          <span class="sv-hint sv-cache-status" id="sv-cache-status" role="status"></span>
        </div>`,
    });

    const settingsPane = PANES.some(([pane]) => pane === this.settingsPane) ? this.settingsPane : "common";
    const overlay = document.createElement("div");
    overlay.id = "sv-overlay";
    overlay.innerHTML = `
            <section id="sv-panel" class="${[config.phone?.app_enabled === false && "sv-phone-off", config.active === false && "sv-inactive", config.enabled === false && "sv-chat-off", config.playback?.prepare === false && "sv-prepare-off", config.elevenlabs?.sound_effects !== true && "sv-sfx-off", !config.casting?.auto_enabled && "sv-casting-off", this.multicastVoiceSettings?.() && "sv-mc-engine"].filter(Boolean).join(" ")}" data-tab="settings" role="dialog" aria-modal="true" aria-labelledby="sv-panel-title">
                <header class="sv-header">
                    <span class="sv-logo" aria-hidden="true"><i class="fa-solid fa-microphone-lines"></i></span>
                    <div class="sv-title"><strong id="sv-panel-title">씬보이스</strong></div>
                    <span class="sv-save-state" id="sv-save-state" data-state="idle" role="status"><i class="fa-solid fa-check" aria-hidden="true"></i><span></span></span>
                    <div class="sv-more">
                        <button type="button" id="sv-more" class="sv-icon-btn" aria-label="업데이트 내역·백업·초기화 메뉴" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
                        <div class="sv-menu" id="sv-more-menu" role="menu" hidden>
                            <button type="button" role="menuitem" data-sv-action="update-notes"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i><span>업데이트 내역<small>최근에 바뀐 점</small></span></button>
                            <hr>
                            <button type="button" role="menuitem" data-sv-action="backup"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i><span>백업 파일 저장<small>봇카드·항목을 골라서</small></span></button>
                            <label role="menuitem" class="sv-menu-file" tabindex="0"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i><span>백업 파일 복원<small>zip 또는 JSON</small></span><input type="file" id="sv-import-catalog" accept=".json,.zip,application/json,application/zip"></label>
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
                        ${engineGroup}
                        ${analysisGroup}
                        ${readingGroup}
                        <div class="sv-fold-list">
                            <h3 class="sv-group-title"><i class="fa-solid fa-database sv-group-icon" aria-hidden="true"></i><span class="sv-group-name">데이터 관리</span></h3>
                            ${storageFold}
                        </div>
                    </div>
                    <div class="sv-pane ${settingsPane === "people" ? "sv-pane-on" : ""}" data-pane="people">
                        ${castingGroup}
                        ${stateFold}
                    </div>
                    <div class="sv-pane ${settingsPane === "phone" ? "sv-pane-on" : ""}" data-pane="phone">
                        ${smartphoneFold}
                        <div class="sv-fold-list">
                            ${phoneFold}
                            ${voiceMessageFold}
                            ${memoryFold}
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
    this.renderStatusBar();
    document.getElementById("sv-statusbar")?.addEventListener("click", () => this.run(() => this.refreshEngineCheck()));
    // The engine is checked once a session (no cost: no voice is made).
    if (!this.engineCheck) this.run(() => this.refreshEngineCheck());
    this.showUpdateNotes?.();
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
        text: [data.message || data.detail, data.voice].filter(Boolean).join(" · "),
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
    const analysing = chat && (config.analysis_enabled || config.casting?.auto_enabled);
    const noProfile =
      (analysing && !config.connection_profile_id) ||
      (phone && !config.phone?.connection_profile_id && !config.connection_profile_id);
    let multicastReads = false;
    try {
      multicastReads = Boolean(this.multicastAttached && this.multicastApi?.()?.isEnabled?.());
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
    bar.title = [check?.text, "누르면 음성 엔진 연결을 다시 확인합니다"].filter(Boolean).join("\n");
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
    panel.querySelector(".sv-settings-subtabs")?.addEventListener("click", (event) => {
      const pane = event.target.closest("[data-pane]")?.dataset.pane;
      if (pane) this.showSettingsPane(pane);
    });
    panel.querySelector(".sv-history-subtabs")?.addEventListener("click", (event) => {
      const view = event.target.closest("[data-view]")?.dataset.view;
      if (view) this.changeTab(view);
    });
    bindRanges(settings);
    this.bindReadingRules();
    bindStateBadges(settings);
    // Every change is saved automatically. Typing waits for a short pause; keys wait until the field is left.
    const ignored = "#sv-cast-character, #sv-cast-new, #sv-cast-scope, #sv-import-catalog";
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
          "#sv-cast-add, [data-member-remove], [data-member-move], [data-cast-adopt]",
        )
      ) {
        this.settingsDirty = true;
        this.scheduleSettingsSave(250);
      }
      const clear = event.target.closest("[data-sv-clear-key]");
      if (!clear) return;
      const engine = clear.dataset.svClearKey;
      const label = engine === "fish" ? "이 브라우저에 저장된 Fish" : "저장된 ElevenLabs";
      if (!confirm(`${label} API 키를 삭제할까요?`)) return;
      this.pendingKeyClear = { ...this.pendingKeyClear, [engine]: true };
      this.settingsDirty = true;
      this.run(() => this.saveSettingsNow());
    });
  },

  /** Panel close: start saving whatever is still waiting, then remove the panel. */
  closeOverlay() {
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
    badge.title = state === "error" ? `${message} 값을 고치면 다시 저장합니다.` : "";
    clearTimeout(this.saveStateTimer);
    if (state === "saved")
      this.saveStateTimer = setTimeout(() => this.setSaveState("idle"), 2500);
  },

  /** Saves the settings form now; saves run one after another so the latest values win. */
  saveSettingsNow() {
    clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    if (!document.getElementById("sv-settings-tab")) return this.settingsSaveChain;
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
      .getElementById("sv-load-voices")
      ?.addEventListener("click", () =>
        this.run(async () => {
          const count = await this.loadVoiceChoices();
          const note = document.getElementById("sv-voice-tools-note");
          if (note) note.textContent = `보이스 ${count}개를 불러왔습니다. 목소리 칸을 누르면 이름으로 고를 수 있습니다.`;
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
    ])
      document.getElementById(id)?.addEventListener("change", (event) => {
        document.getElementById("sv-panel")?.classList.toggle(name, !event.target.checked);
      });
    // The voice list feeds every voice picker; loaded once per session on its own.
    this.bindVoicePickers(document.getElementById("sv-overlay"));
    if (this.voiceChoices?.length) this.fillVoiceOptions();
    else if ((document.getElementById("sv-engine")?.value || this.config.engine) === "elevenlabs")
      this.loadVoiceChoices().catch(() => undefined);
    document
      .getElementById("sv-cache-clear")
      ?.addEventListener("click", () => this.cleanupCache(true));
    document
      .getElementById("sv-fold-storage")
      ?.addEventListener("toggle", (event) => {
        if (event.currentTarget.open) this.run(() => this.renderStorageMeter());
      });
    document
      .getElementById("sv-chat-memory-clear")
      ?.addEventListener("click", () => {
        if (!confirm("현재 채팅에 붙은 통화·메시지 채팅 기억을 모두 삭제할까요?\n캐릭터가 지난 통화·문자를 기억하지 못하게 되고, 다시 켜도 돌아오지 않습니다. 스마트폰의 통화 기록·문자는 그대로 남습니다.\n(기억에 넣지 않게만 하려면 스위치를 끄면 됩니다.)")) return;
        this.run(() => this.clearCurrentChatMemory());
      });
    document.querySelectorAll(".sv-tab").forEach((tab) => {
      // 기록 opens on the list last looked at (전체 기록 or 보관함).
      tab.addEventListener("click", () =>
        this.changeTab(tab.dataset.tab === "history" ? this.historyView || "history" : tab.dataset.tab),
      );
    });
  },

  /** Used space against the size limit, as a bar in the storage section. */
  async renderStorageMeter() {
    const text = document.getElementById("sv-storage-text");
    const fill = document.getElementById("sv-storage-fill");
    if (!text || !fill) return;
    const response = await this.request("/api/plugins/scenevoice/cache", { cache: "no-store" }, 20000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "저장 공간을 확인하지 못했습니다.");
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
    const engine = document.getElementById("sv-engine")?.value || this.config.engine;
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
      if (!response.ok) throw new Error(data.detail || "연결을 확인하지 못했습니다.");
      result.dataset.state = data.ok ? "ok" : "error";
      result.textContent = [data.message, data.voice].filter(Boolean).join(" · ");
      this.engineCheck = { state: data.ok ? "ok" : "error", text: result.textContent };
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
    document.getElementById("sv-eleven-model-custom")?.classList.toggle("hidden", !custom);
    const traits = elevenModelTraits(
      custom ? document.getElementById("sv-eleven-model-custom")?.value.trim() : picked,
    );
    // Only the controls the chosen model takes are shown.
    document.getElementById("sv-eleven-style-row")?.classList.toggle("hidden", !traits.style);
    document.getElementById("sv-eleven-speed-row")?.classList.toggle("hidden", !traits.speed);
    document
      .getElementById("sv-eleven-tune-row")
      ?.classList.toggle("sv-row-empty", !traits.speed && !traits.style);
    const selected =
      document.getElementById("sv-engine")?.value || this.config.engine;
    document.querySelectorAll(".sv-engine-section").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.engine !== selected);
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
      .forEach((view) => view.setAttribute("aria-selected", String(view.dataset.view === tabName)));
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
        thought_effect: document.getElementById("sv-thought-effect")?.checked !== false,
      },
      active: document.getElementById("sv-active").checked,
      playback: {
        auto_new: document.getElementById("sv-auto-play").checked,
        caption: document.querySelector('input[name="sv-caption"]:checked')?.value || "always",
        line_buttons: document.getElementById("sv-line-buttons").checked,
        prepare: document.getElementById("sv-prepare").checked,
      },
      casting: {
        auto_enabled: document.getElementById("sv-casting-auto").checked,
        uncertain:
          document.querySelector('input[name="sv-casting-uncertain"]:checked')?.value || "skip",
        multicast_sync:
          document.getElementById("sv-multicast-sync")?.checked ??
          this.config.casting?.multicast_sync !== false,
      },
      enabled: document.getElementById("sv-enabled").checked,
      engine: document.getElementById("sv-engine").value,
      llm: {
        // Not shown any more: the connection's preset and low task temperatures always apply.
        include_preset: true,
        analysis_include_persona: document.getElementById("sv-analysis-persona")
          .checked,
        analysis_include_character: document.getElementById("sv-analysis-character")
          .checked,
        auto_analyze: document.getElementById("sv-analysis-auto").checked,
        task_temperature: true,
        max_input_tokens: Number(
          document.getElementById("sv-max-input").value || 0,
        ),
        max_output_tokens: Number(
          document.getElementById("sv-max-output").value || 0,
        ),
      },
      default_language: document.getElementById("sv-default-language").value,
      analysis_enabled: document.getElementById("sv-analysis-enabled").checked,
      connection_profile_id: document.getElementById("sv-connection-profile")
        .value,
      context_messages: Number(
        document.getElementById("sv-context-messages").value,
      ),
      character_notes: this.noteDraft || {},
      state_tracking: {
        enabled: document.getElementById("sv-state-enabled").checked,
        connection_profile_id:
          document.getElementById("sv-state-profile").value,
        context_messages: Number(
          document.getElementById("sv-state-context").value || 8,
        ),
        every_messages: Number(
          document.getElementById("sv-state-every").value || 2,
        ),
      },
      phone: {
        connection_profile_id:
          document.getElementById("sv-phone-profile").value,
        context_messages: Number(
          document.getElementById("sv-phone-context").value || 10,
        ),
        auto_enabled: document.getElementById("sv-phone-auto").checked,
        auto_cooldown_messages: Number(
          document.getElementById("sv-phone-cooldown").value || 0,
        ),
        ringtone: document.getElementById("sv-phone-ringtone").checked,
        voicemail: document.getElementById("sv-phone-voicemail").checked,
        overheard_calls: document.getElementById("sv-phone-overheard").checked,
        memo_app: document.getElementById("sv-phone-memo")?.checked ?? this.config.phone?.memo_app !== false,
        radio_app: document.getElementById("sv-phone-radio")?.checked ?? this.config.phone?.radio_app === true,
        overheard_length:
          document.querySelector('input[name="sv-phone-overheard-length"]:checked')
            ?.value || "normal",
        vibration: document.getElementById("sv-phone-vibration").checked,
        audio_filter: document.getElementById("sv-phone-filter").checked,
        sfx_in_file:
          document.getElementById("sv-sfx-in-file")?.checked ?? this.config.phone?.sfx_in_file !== false,
        launcher:
          document.querySelector('input[name="sv-phone-launcher-mode"]:checked')
            ?.value || "both",
        app_enabled: document.getElementById("sv-phone-app").checked,
        launcher_events_only: document.getElementById(
          "sv-phone-launcher-alerts",
        ).checked,
        show_translation: document.getElementById("sv-phone-translation").checked,
        world_info_choice: this.loreDraft || this.config.phone?.world_info_choice || {},
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
        reply_voice: document.getElementById("sv-voice-message-reply-voice").checked,
        sounds: document.getElementById("sv-voice-message-sounds").checked,
      },
      chat_memory: {
        enabled: document.getElementById("sv-chat-memory-enabled").checked,
      },
      cache: {
        max_size_mb: Number(
          document.getElementById("sv-cache-size").value || 1024,
        ),
        max_age_days: Number(document.getElementById("sv-cache-days").value || 0),
      },
      fish: {
        api_key: document.getElementById("sv-fish-key").value,
        // reference_id is what a speaker of unknown gender gets: the female default, else the male.
        reference_id:
          document.getElementById("sv-fish-reference-female").value.trim() ||
          document.getElementById("sv-fish-reference-male").value.trim(),
        reference_id_male: document.getElementById("sv-fish-reference-male").value.trim(),
        reference_id_female: document.getElementById("sv-fish-reference-female").value.trim(),
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
        const button = document.querySelector(`[data-sv-clear-key="${engine}"]`);
        if (button) button.disabled = true;
        const input = document.getElementById(
          engine === "fish" ? "sv-fish-key" : "sv-eleven-key",
        );
        if (input) {
          input.value = "";
          input.placeholder = engine === "fish" ? "Fish Audio API 키" : "ElevenLabs API 키";
        }
        this.notify("저장된 API 키를 삭제했습니다.", "success");
      }
      if (payload.fish?.api_key) document.querySelector('[data-sv-clear-key="fish"]')?.removeAttribute("disabled");
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
    if (redecorate || !this.chatVoiceOn()) this.removeDecorations();
    else if (linesChanged) this.invalidateGeneratedButtons();
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
    if (this.isActive() && (redecorate || linesChanged || previous.active === false))
      this.scheduleScan();
    if (
      this.config.state_tracking?.enabled ||
      this.autoCallOn() ||
      this.autoTextOn()
    )
      this.scheduleStateTracking();
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
        ? " 플로팅 버튼은 전화나 메시지가 올 때만 나타납니다."
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
    const notice = this.phoneSession
      ? '<p class="sv-notice sv-notice-ok"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i><span>통화 중입니다. 스마트폰을 열어 이어서 대화하세요.</span></p>'
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
    // The chat's card on top, as it was: who this chat is with and what is switched on.
    const identity = this.getStateIdentity();
    const status = (on, label, more = "") =>
      `<span class="sv-badge ${on ? "sv-badge-on" : ""}">${label} ${on ? "켜짐" : "꺼짐"}${more}</span>`;
    const hero = (callWait = 0) => `
            <section class="sv-phone-hero">
                ${this.characterAvatarMarkup()}
                <div class="sv-phone-hero-text">
                    <small>현재 채팅 캐릭터</small>
                    <strong>${escapeHtml(identity.characterName)}</strong>
                    <div class="sv-badge-row">
                        ${status(Boolean(this.config.phone?.auto_enabled), "자동 전화", callWait ? ` · 답변 ${callWait}개 뒤` : "")}
                        ${status(Boolean(this.config.voice_message?.enabled), "음성 메시지")}
                        ${status(Boolean(this.config.chat_memory?.enabled), "채팅 기억")}
                    </div>
                </div>
            </section>`;
    const contacts = this.phoneContacts();
    const token = (this.phoneTabToken = (this.phoneTabToken || 0) + 1);
    let rows = [];
    let callWait = 0;
    if (contacts.length) {
      container.innerHTML = `${hero()}${notice}<div class="sv-loading-line">연락처를 불러오는 중…</div>`;
      const board = await this.phoneBoard(contacts);
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
                    this.hasCharacterChat()
                      ? "설정 → 캐릭터별 목소리에서 인물을 등록하면 연락처로 나옵니다."
                      : "캐릭터나 그룹 채팅을 열면 그 채팅의 연락처가 나옵니다.",
                  )
            }
            ${footer}`;
    const open = (tab = null) => {
      this.closeOverlay();
      this.openSmartphone(tab);
    };
    document
      .getElementById("sv-open-smartphone")
      ?.addEventListener("click", () => open());
    container.querySelectorAll("[data-open-phone]").forEach((button) =>
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
        this.messageThreadKey = button.dataset.boardText;
        open("message");
      }),
    );
    document
      .getElementById("sv-phone-settings-link")
      ?.addEventListener("click", () => this.openSettingsGroup("sv-fold-smartphone"));
  },

  /** 공통 · 캐릭터 · 스마트폰: one part of the settings shown, from its top. */
  showSettingsPane(pane) {
    const settings = document.getElementById("sv-settings-tab");
    if (!settings?.querySelector(`.sv-pane[data-pane="${pane}"]`)) return;
    this.settingsPane = pane;
    closeTips(document.getElementById("sv-panel"));
    settings.querySelectorAll(".sv-pane").forEach((item) => item.classList.toggle("sv-pane-on", item.dataset.pane === pane));
    document
      .querySelectorAll("#sv-panel .sv-settings-subtabs .sv-subtab")
      .forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.pane === pane)));
    settings.scrollTop = 0;
  },

  /** Opens the settings at one group: its part shown, the group unfolded and brought up. */
  openSettingsGroup(id) {
    this.changeTab("settings");
    const group = document.getElementById(id);
    if (!group) return;
    this.showSettingsPane(group.closest(".sv-pane")?.dataset.pane || "common");
    if (group.tagName === "DETAILS") group.open = true;
    group.scrollIntoView({ block: "start" });
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
          (session) => session.call_direction !== "overheard" && this.anchorShown(session),
        );
      } catch (_) {
        return []; // 통화 기록 없이도 연락처는 보여 준다.
      }
    };
    const tracked = new Map(this.statePeople().map((person) => [person.key, person]));
    // The calls and everyone's state read at once, not one after another.
    const [sessions, round, records] = await Promise.all([
      loadSessions(),
      tracked.size ? this.loadStateRound().catch(() => null) : null,
      Promise.all(
        contacts.map((contact) =>
          tracked.has(contact.key) ? this.loadPersonState(tracked.get(contact.key)).catch(() => null) : null,
        ),
      ),
    ]);
    const badge = (tone, icon, text) =>
      `<span class="sv-badge ${tone}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${text}</span>`;
    const rows = [];
    for (const [index, contact] of contacts.entries()) {
      const record = records[index];
      const status = tracked.has(contact.key) ? this.stateStatus(contact.key, record, round) : null;
      const where = record?.state?.contact || {};
      const chips = [];
      if (status?.unknown) chips.push(badge("sv-badge-warn", "circle-question", "행방 모름"));
      else if (where.presence === "together") chips.push(badge("sv-badge-on", "user-group", "함께 있음"));
      else if (where.availability === "asleep") chips.push(badge("", "moon", "자는 중"));
      else if (where.availability === "busy") chips.push(badge("", "briefcase", "바쁨"));
      else if (where.availability === "free") chips.push(badge("sv-badge-on", "phone", "통화 가능"));
      else if (status?.away) chips.push(badge("", "door-open", "장면 밖"));
      if (this.unreadThreads.has(contact.key)) chips.push(badge("sv-badge-new", "comment-dots", "새 문자"));
      const call = sessions.find((session) => session.character_key === contact.key);
      const lines = [
        call
          ? `최근 통화 ${this.formatPhoneDate(call.started_at)} · ${this.callStatusLabel(call)}`
          : "통화 기록 없음",
      ];
      // Together or asleep: they don't reach out first now (see contactChance).
      if (!status?.unknown && (where.presence === "together" || where.availability === "asleep"))
        lines.push("지금은 먼저 연락 안 함");
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
    // 자동 전화 waits for N AI replies after the last call (loadRecentCallContext counts the same way).
    let callWait = 0;
    if (this.autoCallOn()) {
      const cooldown = Math.min(100, Math.max(0, Number(this.config.phone?.auto_cooldown_messages ?? 0)));
      const latest = sessions[0];
      const anchor = /^\d+$/.test(String(latest?.anchor_message_id || "")) ? Number(latest.anchor_message_id) : null;
      callWait = latest ? Math.max(0, cooldown - this.assistantMessagesSince(anchor)) : 0;
    }
    return { rows, callWait };
  },
};
