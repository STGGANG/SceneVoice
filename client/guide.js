// 첫 설정 안내: a few steps over the settings window that set things as they are answered (the
// engine, its key, the connections, what to use). Each step lights the real setting behind it.
// Opened from the ⋯ menu; nothing here keeps a setting of its own.
import { escapeHtml } from "./common.js";
import { CURRENT_CONNECTION } from "./connection.js";

// What each step lights up, and the settings group it sits in.
const STEPS = [
  { key: "engine", group: "sv-group-basic", target: "#sv-engine" },
  { key: "key", group: "sv-group-basic", target: "[data-sv-key-state]" },
  {
    key: "connection",
    group: "sv-group-analysis",
    target: "#sv-connection-profile",
  },
  { key: "features", group: "sv-group-chat", target: "#sv-enabled" },
  // Only with 채팅 대사 읽기 on: how its lines are listened to.
  { key: "buttons", group: "sv-group-chat", target: "#sv-line-buttons" },
  // A look around before the end: what each of the three parts of the settings is for.
  { key: "tour", group: "sv-group-basic", target: ".sv-settings-subtabs" },
  {
    key: "tab-common",
    group: "sv-group-basic",
    target: '.sv-settings-subtabs [data-pane="common"]',
  },
  {
    key: "tab-people",
    group: "sv-group-casting",
    target: '.sv-settings-subtabs [data-pane="people"]',
  },
  {
    key: "tab-phone",
    group: "sv-fold-smartphone",
    target: '.sv-settings-subtabs [data-pane="phone"]',
  },
  { key: "done", group: "sv-group-basic", target: "#sv-engine-check" },
];
// The pages of that look around: icon, the tab's name, what it is for, what is in it.
const TAB_PAGES = {
  "tab-common": [
    "sliders",
    "공통",
    "씬보이스 전체와 채팅 대사 읽기에 쓰이는 설정입니다.",
    [
      "기본: 씬보이스 켜고 끄기, 음성 엔진과 모델, API 키, 기본 목소리",
      "채팅 대사: 채팅 대사 읽기, 재생 버튼, 자막, 읽을 구간",
      "보조모델 분석: 대사 분석에 쓸 연결, 화자 구분, 효과음, 발음 사전",
    ],
  ],
  "tab-people": [
    "users",
    "캐릭터",
    "봇카드별 설정과 인물의 목소리를 정하는 곳입니다.",
    [
      "인물을 등록하고 인물마다 목소리 고르기",
      "별명, 말투·연기 메모, 언어, 선연락 빈도",
      "봇카드별 스마트폰 설정: 선연락 받기, 채팅 기억 연동, 월드인포 참고",
    ],
  ],
  "tab-phone": [
    "mobile-screen-button",
    "스마트폰",
    "스마트폰 기능에 관한 설정입니다.",
    [
      "스마트폰 사용, 전화·문자에 쓸 연결과 언어, 화면 모양",
      "전화·문자·앱: 음성 만들기, 답장 방식, 음성 메모, 라디오",
      "선연락: 인물이 먼저 전화·문자하는 기능과 연락 방식",
    ],
  ],
};

// Shown by itself once on each device (kept like the update notes' "seen").
const SEEN_KEY = "scenevoice_seen_setup_guide";
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
};

export const guide = {
  /**
   * The first time the settings window opens on a device, the guide comes up by itself (after
   * the update notes, when those show too). Where that can't be remembered, it never does.
   */
  offerSetupGuide() {
    try {
      if (localStorage.getItem(SEEN_KEY) === "1") return;
    } catch {
      return;
    }
    const show = () => {
      if (
        !document.getElementById("sv-panel") ||
        this.setupGuide ||
        !markSeen()
      )
        return;
      this.openSetupGuide();
    };
    const notes = document.getElementById("sv-update-dialog");
    if (notes) notes.addEventListener("close", show, { once: true });
    else show();
  },

  openSetupGuide() {
    if (!document.getElementById("sv-panel")) return;
    markSeen();
    this.setupGuide = { step: 0, note: "" };
    // Esc closes the guide wherever the focus is (WebKit leaves it on nothing after a click),
    // and only the guide: the window behind it stays.
    this.guideKey = (event) => {
      if (event.key !== "Escape" || document.querySelector(".sv-tip-pop"))
        return;
      event.preventDefault();
      event.stopPropagation();
      this.closeSetupGuide();
    };
    document.addEventListener("keydown", this.guideKey, true);
    this.renderSetupGuide();
  },

  closeSetupGuide() {
    this.setupGuide = null;
    if (this.guideKey)
      document.removeEventListener("keydown", this.guideKey, true);
    this.guideKey = null;
    this.guideCleanup?.();
    this.guideCleanup = null;
    document.querySelector("#sv-panel .sv-guide")?.remove();
    document.querySelector("#sv-panel .sv-guide-spot")?.remove();
  },

  /** A setting changed from the guide goes through the form's own control, so it is saved as usual. */
  guideSet(id, value) {
    const control = document.getElementById(id);
    if (!control) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  },

  /** The steps as they stand: how lines are listened to is asked only while the chat is read. */
  guideSteps() {
    const chat = document.getElementById("sv-enabled")?.checked !== false;
    return STEPS.filter((step) => step.key !== "buttons" || chat);
  },

  guideEngine() {
    return document.getElementById("sv-engine")?.value || this.config.engine;
  },

  guideBodyHtml(key) {
    const state = this.setupGuide;
    const engine = this.guideEngine();
    if (key === "engine") {
      const fish = this.availableEngines.includes("fish");
      return `<h4>어떤 음성 엔진을 쓰시나요?</h4>
        <p>목소리를 만들어 주는 서비스입니다. 나중에 설정에서 바꿀 수 있습니다.</p>
        <div class="sv-guide-choices">
          <button type="button" data-guide-engine="elevenlabs" aria-pressed="${engine === "elevenlabs"}"><strong>ElevenLabs</strong><small>감정 연기 태그 · 보이스 목록에서 고르기</small></button>
          <button type="button" data-guide-engine="fish" aria-pressed="${engine === "fish"}" ${fish ? "" : "disabled"}><strong>Fish Audio</strong><small>${fish ? "Reference ID로 목소리 지정" : "이 실리태번 설정에서는 쓸 수 없습니다"}</small></button>
        </div>`;
    }
    if (key === "key") {
      const saved = Boolean(this.config[engine]?.has_api_key);
      const name = engine === "fish" ? "Fish Audio" : "ElevenLabs";
      const badge = `<span class="sv-badge ${saved ? "sv-badge-on" : "sv-badge-warn"}">${saved ? "저장됨" : "키 없음"}</span>`;
      // An older 실리태번 keeps the ElevenLabs key in its own TTS settings, out of reach from here.
      const typed = engine === "fish" || this.transport?.elevenLabsServer;
      return `<h4>${name} API 키 ${badge}</h4>
        ${
          typed
            ? `<p>${engine === "fish" ? "이 브라우저에만 저장됩니다." : "실리태번의 TTS 키 칸에 저장됩니다. 실리태번 TTS 설정에서 이미 넣은 키가 있으면 그대로 씁니다."}</p>
        <div class="sv-guide-key">
          <input type="password" data-guide-key autocomplete="off" placeholder="${saved ? "저장된 키 유지 · 바꿀 때만 입력" : `${name} API 키`}" aria-label="${name} API 키">
          <button type="button" class="sv-btn sv-btn-sm sv-btn-primary" data-guide-key-save><span>저장</span></button>
        </div>`
            : "<p>이 실리태번 버전에서는 <b>실리태번 기본 TTS 설정 → ElevenLabs</b>에 키를 넣어 주십시오. 넣은 뒤 이 창을 다시 열면 ‘저장됨’으로 바뀝니다.</p>"
        }
        ${state.note ? `<p class="sv-guide-note" role="status">${escapeHtml(state.note)}</p>` : ""}`;
    }
    if (key === "connection") {
      const profiles = this.getConnectionProfiles().map((profile) => [
        profile.id,
        profile.name || profile.model || profile.id,
      ]);
      const select = (id, selected, empty) =>
        `<select data-guide-select="${id}" aria-label="${empty}"><option value="">${empty}</option><option value="${CURRENT_CONNECTION}" ${selected === CURRENT_CONNECTION ? "selected" : ""}>현재 연결 사용</option>${profiles
          .map(
            ([value, label]) =>
              `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("")}</select>`;
      return `<h4>어느 연결로 AI에게 물어볼까요?</h4>
        <p>대사를 분석하고 전화·문자를 쓰는 데 실리태번의 연결을 씁니다. 요청마다 그 연결의 비용이 듭니다.</p>
        <label class="sv-guide-field"><span>대사 분석 <small>화자·연기 태그</small></span>${select("sv-connection-profile", document.getElementById("sv-connection-profile")?.value || "", "분석 끔")}</label>
        <label class="sv-guide-field"><span>전화·문자 <small>상대의 답을 쓰는 연결</small></span>${select("sv-phone-profile", document.getElementById("sv-phone-profile")?.value || "", "대사 분석과 같게")}</label>`;
    }
    if (key === "features") {
      const on = (id) => document.getElementById(id)?.checked !== false;
      return `<h4>무엇을 쓰시겠어요?</h4>
        <label class="sv-guide-feature">
          <span class="sv-guide-art sv-guide-art-chat" aria-hidden="true"><i>“안녕.”</i><b><i class="fa-solid fa-volume-low"></i></b></span>
          <span><strong>채팅 대사 읽기</strong><small>채팅 메시지 속 대사를 인물 목소리로 읽어 줍니다. 대사 옆 스피커 버튼이나 메시지의 이어 듣기 버튼으로 듣습니다.</small></span>
          <input type="checkbox" class="sv-switch" data-guide-toggle="sv-enabled" ${on("sv-enabled") ? "checked" : ""}>
        </label>
        <label class="sv-guide-feature">
          <span class="sv-guide-art sv-guide-art-phone" aria-hidden="true"><i>뭐 해?</i><i>가는 중!</i></span>
          <span><strong>스마트폰</strong><small>인물과 전화·문자를 주고받는 가상의 스마트폰입니다. 화면의 플로팅 버튼이나 마법봉 메뉴에서 엽니다.</small></span>
          <input type="checkbox" class="sv-switch" data-guide-toggle="sv-phone-app" ${on("sv-phone-app") ? "checked" : ""}>
        </label>`;
    }
    if (key === "buttons") {
      const on = (id) => document.getElementById(id)?.checked !== false;
      return `<h4>대사를 어떤 버튼으로 들을까요?</h4>
        <p>둘 다 켜 두어도 됩니다. 버튼을 누르기 전에는 음성을 만들지 않습니다.</p>
        <label class="sv-guide-feature">
          <span class="sv-guide-art sv-guide-art-line" aria-hidden="true"><i>“안녕.”</i><b><i class="fa-solid fa-volume-low"></i></b><i>“왔어?”</i><b><i class="fa-solid fa-volume-low"></i></b></span>
          <span><strong>대사별 재생 버튼</strong><small>대사마다 옆에 붙는 스피커 버튼입니다. 누른 그 대사 하나만 만들어 들려줍니다.</small></span>
          <input type="checkbox" class="sv-switch" data-guide-toggle="sv-line-buttons" ${on("sv-line-buttons") ? "checked" : ""}>
        </label>
        <label class="sv-guide-feature">
          <span class="sv-guide-art sv-guide-art-row" aria-hidden="true"><i class="fa-solid fa-pencil"></i><b><i class="fa-solid fa-wave-square"></i></b><i class="fa-solid fa-ellipsis"></i></span>
          <span><strong>전체 이어 듣기 버튼</strong><small>메시지 버튼 줄에 하나 있는 파형 버튼입니다. 그 메시지의 대사를 처음부터 차례로 만들며 이어서 들려줍니다.</small></span>
          <input type="checkbox" class="sv-switch" data-guide-toggle="sv-prepare" ${on("sv-prepare") ? "checked" : ""}>
        </label>`;
    }
    if (key === "tour")
      return `<h4>기본 설정은 끝났습니다</h4>
        <p>이제 설정 화면을 잠깐 둘러보겠습니다. 설정은 <b>공통</b>, <b>캐릭터</b>, <b>스마트폰</b> 세 탭으로 나뉘어 있고, 탭마다 무엇을 정하는 곳인지 한 장씩 알려 드립니다.</p>
        <p>바로 쓰려면 오른쪽 위 ✕로 닫아도 됩니다.</p>`;
    if (TAB_PAGES[key]) {
      const [icon, name, lead, items] = TAB_PAGES[key];
      return `<h4><i class="fa-solid fa-${icon}" aria-hidden="true"></i>‘${name}’ 탭</h4>
        <p>${lead}</p>
        <ul class="sv-guide-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
    }
    return `<h4>준비됐습니다</h4>
      <p>채팅을 연 뒤 설정의 <b>캐릭터</b> 탭에서 인물마다 목소리를 정하면 됩니다. 정하지 않은 인물은 ‘기본’ 묶음의 ‘상세 설정’에 있는 기본 목소리로 읽습니다.</p>
      <p class="sv-guide-tip"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i><span>지금 설정 그대로 바로 쓸 수 있습니다. AI 요청이 더 들거나 취향이 갈리는 기능(스마트폰의 선연락, 새 답변 자동 음성 생성 등)은 꺼져 있으니, 익숙해지면 취향에 맞게 켜 보십시오.</span></p>
      <p>아래 ‘연결 확인’으로 키가 맞는지 볼 수 있습니다(음성을 만들지 않아 비용이 들지 않습니다).</p>
      <div class="sv-guide-key"><button type="button" class="sv-btn sv-btn-sm" data-guide-check><i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i><span>연결 확인</span></button></div>
      ${state.note ? `<p class="sv-guide-note" role="status">${escapeHtml(state.note)}</p>` : ""}`;
  },

  /** Draws the current step: its card at the bottom of the window, a ring on the setting it is about. */
  renderSetupGuide({ focus = true } = {}) {
    const panel = document.getElementById("sv-panel");
    const state = this.setupGuide;
    if (!panel || !state) return;
    const steps = this.guideSteps();
    state.step = Math.min(state.step, steps.length - 1);
    const step = steps[state.step];
    this.openSettingsGroup(step.group);
    // The settings inside 상세 설정 are lit only when it is open; the key and the check are outside it.
    panel.querySelector(".sv-guide")?.remove();
    const card = document.createElement("div");
    card.className = "sv-guide";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "첫 설정 안내");
    const last = state.step === steps.length - 1;
    card.innerHTML = `<div class="sv-guide-head"><span class="sv-guide-count">${state.step + 1} / ${steps.length}</span><button type="button" class="sv-icon-btn" data-guide-close aria-label="안내 모두 닫기" title="안내 모두 닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
      <div class="sv-guide-body">${this.guideBodyHtml(step.key)}</div>
      <div class="sv-guide-actions">
        ${last ? "" : '<button type="button" class="sv-btn sv-btn-sm sv-btn-ghost" data-guide-skip title="이 단계만 넘어갑니다. 안내를 모두 닫으려면 오른쪽 위 ✕">건너뛰기</button>'}
        <span class="sv-spacer"></span>
        ${state.step ? '<button type="button" class="sv-btn sv-btn-sm" data-guide-back>이전</button>' : ""}
        <button type="button" class="sv-btn sv-btn-sm sv-btn-primary" data-guide-next>${last ? "닫기" : "다음"}</button>
      </div>`;
    panel.append(card);
    this.placeGuideSpot(step.target);
    this.bindSetupGuide(card);
    // The keyboard doesn't come up by itself: the button takes the focus, never a text box.
    if (focus)
      card.querySelector("[data-guide-next]")?.focus({ preventScroll: true });
  },

  /** The ring around the setting a step is about; it follows scrolling and resizing. */
  placeGuideSpot(selector) {
    const panel = document.getElementById("sv-panel");
    this.guideCleanup?.();
    const target = [...panel.querySelectorAll(selector)].find(
      (element) => element.offsetParent,
    );
    let spot = panel.querySelector(".sv-guide-spot");
    if (!target) {
      spot?.remove();
      this.guideCleanup = null;
      return;
    }
    if (!spot) {
      spot = document.createElement("div");
      spot.className = "sv-guide-spot";
      spot.setAttribute("aria-hidden", "true");
      panel.append(spot);
    }
    const anchor =
      target.closest(
        ".sv-field, .sv-switch-row, .sv-notice, .sv-engine-check",
      ) || target;
    const scroller = document.getElementById("sv-settings-tab");
    const card = panel.querySelector(".sv-guide");
    // The setting is brought near the top, clear of the card at the bottom; one that can't go
    // that high (the end of the page) gets the card above it instead.
    anchor.scrollIntoView({ block: "center" });
    if (scroller)
      scroller.scrollTop +=
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        28;
    card?.classList.remove("sv-guide-top");
    if (
      card &&
      anchor.getBoundingClientRect().bottom >
        card.getBoundingClientRect().top - 10
    )
      card.classList.add("sv-guide-top");
    const place = () => {
      if (!spot.isConnected || !anchor.isConnected) return;
      const frame = panel.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      const pad = 6;
      spot.style.left = `${Math.round(box.left - frame.left - panel.clientLeft - pad)}px`;
      spot.style.top = `${Math.round(box.top - frame.top - panel.clientTop - pad)}px`;
      spot.style.width = `${Math.round(box.width + pad * 2)}px`;
      spot.style.height = `${Math.round(box.height + pad * 2)}px`;
    };
    place();
    scroller?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    this.guideCleanup = () => {
      scroller?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  },

  bindSetupGuide(card) {
    const state = this.setupGuide;
    const redraw = () => this.renderSetupGuide({ focus: false });
    card
      .querySelectorAll("[data-guide-close]")
      .forEach((button) =>
        button.addEventListener("click", () => this.closeSetupGuide()),
      );
    card.querySelector("[data-guide-back]")?.addEventListener("click", () => {
      state.step -= 1;
      state.note = "";
      this.renderSetupGuide();
    });
    const forward = () => {
      state.step += 1;
      state.note = "";
      this.renderSetupGuide();
    };
    // 건너뛰기 leaves this step as it is; 다음 also keeps a key typed but not saved yet.
    card.querySelector("[data-guide-skip]")?.addEventListener("click", forward);
    card.querySelector("[data-guide-next]").addEventListener("click", () => {
      if (state.step === this.guideSteps().length - 1)
        return this.closeSetupGuide();
      const typed = card.querySelector("[data-guide-key]")?.value.trim();
      if (!typed) return forward();
      this.run(async () => {
        await this.saveGuideKey(this.guideEngine(), typed);
        forward();
      });
    });
    card.querySelectorAll("[data-guide-engine]").forEach((button) =>
      button.addEventListener("click", () => {
        this.guideSet("sv-engine", button.dataset.guideEngine);
        redraw();
      }),
    );
    card
      .querySelectorAll("[data-guide-select]")
      .forEach((select) =>
        select.addEventListener("change", () =>
          this.guideSet(select.dataset.guideSelect, select.value),
        ),
      );
    card.querySelectorAll("[data-guide-toggle]").forEach((input) =>
      input.addEventListener("change", () => {
        this.guideSet(input.dataset.guideToggle, input.checked);
        // 채팅 대사 읽기 adds or removes a step: the count follows.
        if (input.dataset.guideToggle === "sv-enabled")
          card.querySelector(".sv-guide-count").textContent =
            `${state.step + 1} / ${this.guideSteps().length}`;
      }),
    );
    const key = card.querySelector("[data-guide-key]");
    const saveKey = () =>
      this.run(async () => {
        const value = key.value.trim();
        if (!value) return;
        await this.saveGuideKey(this.guideEngine(), value);
        state.note = "키를 저장했습니다.";
        redraw();
      });
    card
      .querySelector("[data-guide-key-save]")
      ?.addEventListener("click", saveKey);
    key?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        saveKey();
      }
    });
    card.querySelector("[data-guide-check]")?.addEventListener("click", () =>
      this.run(async () => {
        await this.checkEngineConnection();
        state.note =
          document.getElementById("sv-engine-check-result")?.textContent || "";
        redraw();
      }),
    );
  },

  /**
   * A key typed into the guide: Fish's goes where the settings form keeps it (this browser);
   * ElevenLabs' goes into 실리태번's own key store, the place its TTS settings use.
   */
  async saveGuideKey(engine, value) {
    if (engine === "fish") {
      const input = document.getElementById("sv-fish-key");
      if (!input) throw new Error("설정 창을 다시 열어 주십시오.");
      input.value = value;
      this.settingsDirty = true;
      await this.saveSettingsNow();
      input.value = "";
    } else {
      const secrets = await import("/scripts/secrets.js");
      if (
        !secrets.SECRET_KEYS?.ELEVENLABS ||
        typeof secrets.writeSecret !== "function"
      )
        throw new Error(
          "이 실리태번 버전에서는 TTS 설정에서 키를 넣어 주십시오.",
        );
      const saved = await secrets.writeSecret(
        secrets.SECRET_KEYS.ELEVENLABS,
        value,
      );
      if (saved === null)
        throw new Error("실리태번이 키를 저장하지 못했습니다.");
    }
    await this.loadConfig();
    this.noteKeyStates?.();
    this.renderStatusBar?.();
  },
};
