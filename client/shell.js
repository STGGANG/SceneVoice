// 스마트폰 껍데기: where it opens (wand menu, floating button, call banner), the phone frame, its
// home screen, dragging and fitting to the window.
import { escapeHtml, clamp, mergeConfig } from "./common.js";

// Per device: { side: "left" | "right", top: share of the window height }.
const LAUNCHER_SPOT_KEY = "scenevoice_launcher_spot";
const LAUNCHER_MARGIN = 14;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (value) => String(value).padStart(2, "0");

export const shell = {
  createLauncher() {
    document.getElementById("sv-launcher")?.remove();
    const extensionsMenu = document.getElementById("extensionsMenu");
    if (extensionsMenu && !document.getElementById("sv-extension-menu-item")) {
      const menuItem = document.createElement("div");
      menuItem.id = "sv-extension-menu-item";
      menuItem.className =
        "list-group-item flex-container flexGap5 interactable";
      menuItem.tabIndex = 0;
      menuItem.setAttribute("role", "button");
      menuItem.setAttribute("aria-label", "씬보이스 설정");
      menuItem.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.run(() => this.openPanel());
        }
      });
      menuItem.innerHTML = `
                <div class="fa-solid fa-volume-high extensionsMenuExtensionButton" aria-hidden="true"></div>
                <span>씬보이스</span>
            `;
      extensionsMenu.appendChild(menuItem);
    }
    this.syncPhoneMenuItem();

    // SceneVoice opens from the wand (extensions) menu only; no block in the extension settings list.
    document.getElementById("sv-extension-settings-block")?.remove();
    if (!extensionsMenu)
      this.launcherTimer = setTimeout(() => this.createLauncher(), 800);
  },

  isMobilePhoneLayout() {
    return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  },

  /** Wand-menu entry for the phone, shown when the launcher setting includes the menu. */
  syncPhoneMenuItem() {
    const mode = this.config.phone?.launcher || "both";
    let item = document.getElementById("sv-phone-menu-item");
    if (!this.backendConnected || mode === "floating" || !this.phoneOn()) {
      item?.remove();
      return;
    }
    const menu = document.getElementById("extensionsMenu");
    if (!menu) return;
    if (!item) {
      item = document.createElement("div");
      item.id = "sv-phone-menu-item";
      item.className = "list-group-item flex-container flexGap5 interactable";
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", "씬보이스 스마트폰 열기");
      item.innerHTML =
        '<div class="fa-solid fa-mobile-screen-button extensionsMenuExtensionButton" aria-hidden="true"></div><span>씬보이스 전화</span><span class="sv-menu-badge hidden"></span>';
      const open = () => this.run(() => this.openSmartphone());
      item.addEventListener("click", open);
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
      const anchor = document.getElementById("sv-extension-menu-item");
      if (anchor?.parentElement === menu) anchor.after(item);
      else menu.appendChild(item);
    }
    // A number only, as on the floating button: how many conversations wait (a call counts one).
    const pending = this.phoneAlert();
    const badge = item.querySelector(".sv-menu-badge");
    const count = this.phoneAlertCount();
    badge.textContent = count ? String(count) : "";
    badge.title =
      pending === "incoming_call"
        ? "수신 전화"
        : pending === "voicemail"
          ? "음성 사서함"
          : pending === "overheard"
            ? "엿들을 통화"
            : pending
              ? "새 메시지"
              : "";
    badge.classList.toggle("hidden", !count);
  },

  createPhoneLauncher() {
    if (!document.getElementById("sv-phone-launcher")) {
      const launcher = document.createElement("button");
      launcher.id = "sv-phone-launcher";
      launcher.type = "button";
      launcher.title = "씬보이스 전화";
      launcher.setAttribute("aria-label", "씬보이스 스마트폰 열기");
      launcher.innerHTML =
        '<span class="sv-fab-ring" aria-hidden="true"></span><span class="sv-fab-icon" aria-hidden="true"><i class="fa-solid fa-phone"></i></span><span class="sv-phone-badge hidden">0</span>';
      // The click that ends a drag doesn't open the phone.
      launcher.addEventListener("click", () => {
        if (!this.launcherDragged) this.openSmartphone();
      });
      document.body.appendChild(launcher);
      this.enableLauncherDragging(launcher);
      this.placeLauncher(launcher);
    }
    this.updatePhoneLauncherVisibility();
  },

  launcherSpot() {
    let spot = this.launcherSpotHere || null;
    try {
      spot = JSON.parse(localStorage.getItem(LAUNCHER_SPOT_KEY) || "null") || spot;
    } catch {
      /* storage blocked: kept for this page only */
    }
    return spot && ["left", "right"].includes(spot.side) && Number.isFinite(spot.top) ? spot : null;
  },

  placeLauncher(launcher = document.getElementById("sv-phone-launcher")) {
    if (!launcher) return;
    const spot = this.launcherSpot();
    if (!spot) {
      for (const side of ["left", "top", "right", "bottom"]) launcher.style[side] = "";
      return;
    }
    const size = launcher.offsetWidth || 50;
    launcher.style.top = `${clamp(spot.top * window.innerHeight, 8, Math.max(8, window.innerHeight - size - 8))}px`;
    launcher.style.left = `${spot.side === "left" ? LAUNCHER_MARGIN : Math.max(LAUNCHER_MARGIN, window.innerWidth - size - LAUNCHER_MARGIN)}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  },

  /** A press that moves over 8px drags the button; let go, it settles on the nearer side. */
  enableLauncherDragging(launcher) {
    let press = null;
    launcher.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        moved: false,
      };
      // Held from the press, so a quick move that leaves the small button still drags it.
      launcher.setPointerCapture?.(event.pointerId);
    });
    launcher.addEventListener("pointermove", (event) => {
      if (!press || event.pointerId !== press.id) return;
      if (!press.moved) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8) return;
        press.moved = true;
        launcher.classList.add("sv-dragging");
      }
      const size = launcher.offsetWidth;
      launcher.style.left = `${clamp(event.clientX - press.dx, 4, window.innerWidth - size - 4)}px`;
      launcher.style.top = `${clamp(event.clientY - press.dy, 4, window.innerHeight - size - 4)}px`;
      launcher.style.right = "auto";
      launcher.style.bottom = "auto";
    });
    const finish = (event) => {
      if (!press || event.pointerId !== press.id) return;
      const moved = press.moved;
      press = null;
      if (!moved) return;
      launcher.classList.remove("sv-dragging");
      this.launcherDragged = true;
      setTimeout(() => {
        this.launcherDragged = false;
      }, 0);
      const rect = launcher.getBoundingClientRect();
      const spot = {
        side: rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right",
        top: rect.top / window.innerHeight,
      };
      this.launcherSpotHere = spot;
      try {
        localStorage.setItem(LAUNCHER_SPOT_KEY, JSON.stringify(spot));
      } catch {
        /* storage blocked */
      }
      this.placeLauncher(launcher);
    };
    launcher.addEventListener("pointerup", finish);
    launcher.addEventListener("pointercancel", finish);
    window.addEventListener("resize", () => this.placeLauncher(launcher), {
      signal: this.lifetimeController?.signal,
    });
  },

  /**
   * What the phone is waiting on: an incoming call, a message being received, a text reply not
   * read yet ("text_message"), a voicemail not heard yet ("voicemail") or a call between two
   * people not listened to yet ("overheard"); "" when nothing.
   */
  phoneAlert() {
    return (
      this.phonePendingEvent?.type ||
      (this.incomingText && !this.incomingText.again ? this.incomingText.type : "") ||
      (this.unreadThreads?.size ? "text_message" : "") ||
      ([...(this.unheardCalls?.values() || [])].some((item) => item.kind === "voicemail")
        ? "voicemail"
        : this.unheardCalls?.size
          ? "overheard"
          : "")
    );
  },

  /**
   * The number on the phone's badges: a call counts one; otherwise the conversations and
   * voicemails waiting.
   */
  phoneAlertCount() {
    if (this.phonePendingEvent) return 1;
    return (
      this.unreadThreads.size + (this.unheardCalls?.size || 0) ||
      (this.incomingText && !this.incomingText.again ? 1 : 0)
    );
  },

  /**
   * A voicemail left after an unanswered call, or a call between two people to listen in on
   * ("overheard"): waiting in 통화 기록, and a banner for a moment.
   */
  announceCallRecord(session, kind = "voicemail") {
    (this.unheardCalls ||= new Map()).set(session.id, { key: session.character_key, kind });
    this.textAlert = {
      key: session.character_key,
      name:
        kind === "overheard"
          ? `${session.character_name || ""} ↔ ${session.callee_name || ""}`
          : String(session.character_name || ""),
      text: String(session.turns?.[0]?.text || "").split("\n")[0].slice(0, 70),
      kind,
      at: Date.now(),
    };
    clearTimeout(this.textAlertTimer);
    this.textAlertTimer = setTimeout(() => {
      this.textAlert = null;
      this.updatePhoneLauncherVisibility();
    }, 8000);
    this.updatePhoneLauncherVisibility();
  },

  /**
   * A text or voice message came in while its conversation isn't on screen: unread, and for a
   * few seconds a banner under ST's top bar (who, and the start of it) that opens it.
   */
  announceText(key, name, text, kind = "text") {
    this.unreadThreads.add(key);
    this.textAlert = {
      key,
      name: String(name || ""),
      text: String(text || "").split("\n")[0].slice(0, 70),
      kind,
      at: Date.now(),
    };
    clearTimeout(this.textAlertTimer);
    this.textAlertTimer = setTimeout(() => {
      this.textAlert = null;
      this.updatePhoneLauncherVisibility();
    }, 8000);
    this.updatePhoneLauncherVisibility();
  },

  /**
   * A call while the phone is closed: a banner just under ST's top bar. Tapping it opens the
   * phone on the incoming call. Gone once the call is answered or over. A text (voicemail,
   * overheard call) that just came in shows the same way for a few seconds. With the phone open
   * the same notice drops down inside its screen instead, unless that screen is the call itself
   * (a conversation open on screen got no notice in the first place).
   */
  updateCallBanner(pending = this.phoneAlert(), phoneShown = false) {
    const id = phoneShown ? "sv-phone-notice" : "sv-call-banner";
    document.getElementById(phoneShown ? "sv-call-banner" : "sv-phone-notice")?.remove();
    let banner = document.getElementById(id);
    const call = pending === "incoming_call";
    const text = !call && this.textAlert;
    const screen = phoneShown ? document.querySelector("#sv-smartphone .sv-phone-screen") : document.body;
    if ((!call && !text) || !screen || (phoneShown && call && this.phoneActiveTab === "call")) {
      banner?.remove();
      return;
    }
    const key = call ? this.phonePendingEvent?.callerKey || "" : `text:${text.key}:${text.at}`;
    if (banner && banner.dataset.caller === key) return;
    let contact = { name: "알 수 없는 번호", avatarUrl: "" };
    try {
      if (call && this.phonePendingEvent?.callerKey) contact = this.phoneContact(this.phonePendingEvent.callerKey);
      else if (text) contact = { ...this.phoneContact(text.key), name: text.name };
    } catch {
      if (text) contact = { name: text.name, avatarUrl: "" };
    }
    if (!banner) {
      banner = document.createElement("button");
      banner.type = "button";
      banner.id = id;
      banner.addEventListener("click", () =>
        this.run(async () => {
          // A message banner opens its conversation; a voicemail's, the call history.
          if (["voicemail", "overheard"].includes(banner.dataset.kind)) {
            this.textAlert = null;
            await this.openSmartphone("history");
          } else if (banner.dataset.kind === "text" && this.textAlert) {
            this.messageThreadKey = this.textAlert.key;
            this.textAlert = null;
            await this.openSmartphone("message");
          } else await this.openSmartphone();
        }),
      );
      screen.appendChild(banner);
    }
    const voicemail = !call && text.kind === "voicemail";
    const overheard = !call && text.kind === "overheard";
    banner.dataset.caller = key;
    banner.dataset.kind = call ? "call" : voicemail ? "voicemail" : overheard ? "overheard" : "text";
    banner.setAttribute(
      "aria-label",
      call
        ? `${contact.name} 전화 수신 중 · 눌러서 스마트폰 열기`
        : voicemail
          ? `${contact.name}의 음성 사서함 · 눌러서 열기`
          : overheard
            ? `${contact.name} 통화 엿듣기 · 눌러서 열기`
            : `${contact.name}의 새 메시지 · 눌러서 열기`,
    );
    const initial = Array.from(String(contact.name || "?").trim())[0] || "?";
    banner.innerHTML = `
      <span class="sv-call-banner-avatar" aria-hidden="true">${
        contact.avatarUrl ? `<img src="${escapeHtml(contact.avatarUrl)}" alt="">` : escapeHtml(initial)
      }</span>
      <span class="sv-call-banner-text"><strong>${escapeHtml(contact.name)}</strong><small>${
        call
          ? "씬보이스 전화 · 눌러서 받기"
          : voicemail
            ? "음성 사서함에 메시지를 남겼어요"
            : overheard
              ? "둘이 통화했어요 · 눌러서 엿듣기"
              : escapeHtml(text.kind === "voice" ? "음성 메시지" : text.text || "새 문자")
      }</small></span>
      <span class="sv-call-banner-icon" aria-hidden="true"><i class="fa-solid fa-${call ? "phone" : voicemail ? "voicemail" : overheard ? "ear-listen" : text.kind === "voice" ? "microphone" : "comment"}"></i></span>`;
  },

  updatePhoneLauncherVisibility() {
    this.syncPhoneMenuItem();
    this.syncMultiCast?.();
    this.syncPublicState?.();
    const launcher = document.getElementById("sv-phone-launcher");
    if (!launcher) return;
    const pending = this.phoneAlert();
    const mode = this.config.phone?.launcher || "both";
    let visible = mode !== "menu" && this.config.phone?.launcher_events_only !== true;
    // An incoming call or message must stay answerable whatever the placement.
    if (pending) visible = true;
    if (!this.phoneOn()) visible = false;
    // Hidden only while the phone is really on screen, not merely marked open.
    const phone = document.getElementById("sv-smartphone");
    const phoneShown =
      phone && !phone.classList.contains("hidden") && phone.getClientRects().length > 0;
    launcher.classList.toggle("hidden", Boolean(phoneShown));
    launcher.classList.toggle("sv-launcher-off", !visible);
    this.updateCallBanner?.(this.phoneOn() ? pending : "", phoneShown);
    // Switched off while open: the phone closes.
    if (!this.phoneOn() && phoneShown) this.closeSmartphone();
    launcher.dataset.alert =
      pending === "incoming_call" ? "call" : pending ? "message" : "";
    launcher.setAttribute(
      "aria-label",
      pending === "incoming_call"
        ? "수신 전화 · 스마트폰 열기"
        : pending === "voice_message"
          ? "새 음성 메시지 · 스마트폰 열기"
          : pending === "voicemail"
            ? "새 음성 사서함 · 스마트폰 열기"
            : pending === "overheard"
              ? "엿들을 통화 · 스마트폰 열기"
              : pending
                ? "새 문자 · 스마트폰 열기"
                : "씬보이스 스마트폰 열기",
    );
    const icon = launcher.querySelector(".sv-fab-icon i");
    if (icon)
      icon.className = `fa-solid ${
        pending === "voice_message"
          ? "fa-microphone-lines"
          : pending === "text_message"
            ? "fa-comment-dots"
            : pending === "voicemail"
              ? "fa-voicemail"
              : pending === "overheard"
                ? "fa-ear-listen"
                : "fa-phone"
      }`;
    const badge = launcher.querySelector(".sv-phone-badge");
    if (badge) {
      const count = this.phoneAlertCount();
      badge.textContent = String(count);
      badge.classList.toggle("hidden", !count);
    }
  },

  restorePhonePosition(shell) {
    if (this.isMobilePhoneLayout()) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem("scenevoice_phone_position") || "{}",
      );
      if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        const maxLeft = Math.max(8, window.innerWidth - shell.offsetWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - shell.offsetHeight - 8);
        shell.style.left = `${clamp(saved.left, 8, maxLeft)}px`;
        shell.style.top = `${clamp(saved.top, 8, maxTop)}px`;
        shell.style.right = "auto";
        shell.style.bottom = "auto";
      } else for (const side of ["left", "top", "right", "bottom"]) shell.style[side] = "";
    } catch (_) {
      /* 손상된 위치값은 기본 위치를 사용한다. */
    }
  },

  /**
   * After the window is resized (a short pause, not on every pixel), a phone that was moved by
   * hand is brought back inside the window.
   */
  watchPhoneFit() {
    if (this.phoneFitBound) return;
    this.phoneFitBound = true;
    window.addEventListener(
      "resize",
      () => {
        clearTimeout(this.phoneFitTimer);
        this.phoneFitTimer = setTimeout(() => {
          this.fitPhoneToWindow();
          // Turning a phone or resizing may switch between the wide and narrow layouts.
          this.updatePhoneLauncherVisibility();
        }, 250);
      },
      { signal: this.lifetimeController?.signal },
    );
  },

  fitPhoneToWindow() {
    const shell = document.getElementById("sv-smartphone");
    // A closed phone has no size to measure (it would be pushed to the corner); it is placed
    // again when it opens.
    if (!shell || !shell.style.left || shell.classList.contains("hidden") || !shell.getClientRects().length)
      return;
    // The narrow layout fills the screen by itself; a hand-placed spot only applies on wide screens.
    if (this.isMobilePhoneLayout()) {
      for (const side of ["left", "top", "right", "bottom"]) shell.style[side] = "";
      return;
    }
    const rect = shell.getBoundingClientRect();
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
    const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));
    if (Math.round(left) === Math.round(rect.left) && Math.round(top) === Math.round(rect.top))
      return;
    shell.style.left = `${left}px`;
    shell.style.top = `${top}px`;
  },

  enablePhoneDragging(shell) {
    this.watchPhoneFit();
    const handle = shell.querySelector(".sv-smartphone-handle");
    if (!handle || handle.dataset.dragBound) return;
    handle.dataset.dragBound = "true";
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (this.isMobilePhoneLayout() || event.target.closest("button")) return;
      const rect = shell.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      handle.setPointerCapture?.(event.pointerId);
      shell.classList.add("sv-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const left = clamp(
        event.clientX - drag.dx,
        8,
        window.innerWidth - shell.offsetWidth - 8,
      );
      const top = clamp(
        event.clientY - drag.dy,
        8,
        window.innerHeight - shell.offsetHeight - 8,
      );
      shell.style.left = `${left}px`;
      shell.style.top = `${top}px`;
      shell.style.right = "auto";
      shell.style.bottom = "auto";
    });
    const finish = () => {
      if (!drag) return;
      shell.classList.remove("sv-dragging");
      const rect = shell.getBoundingClientRect();
      drag = null;
      try {
        localStorage.setItem(
          "scenevoice_phone_position",
          JSON.stringify({ left: rect.left, top: rect.top }),
        );
      } catch {
        /* Storage blocked (a private window): the phone just won't remember where it was. */
      }
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  },

  phoneClockText(date = new Date()) {
    return `${date.getHours()}:${pad(date.getMinutes())}`;
  },

  startPhoneClock() {
    clearInterval(this.phoneClockTimer);
    const tick = () => {
      const text = this.phoneClockText();
      document
        .querySelectorAll("#sv-smartphone .sv-phone-clock, #sv-smartphone .sv-phone-bigclock")
        .forEach((node) => {
          if (node.textContent !== text) node.textContent = text;
        });
    };
    tick();
    this.phoneClockTimer = setInterval(tick, 15000);
  },

  stopPhoneClock() {
    clearInterval(this.phoneClockTimer);
    this.phoneClockTimer = null;
  },

  /** Smartphone colors from settings; the dark default carries no attribute. */
  applyPhoneTheme() {
    const shell = document.getElementById("sv-smartphone");
    if (!shell) return;
    const theme = this.config.phone?.theme || "default";
    if (theme === "default") delete shell.dataset.phoneTheme;
    else shell.dataset.phoneTheme = theme;
  },

  applyPhoneWallpaper(root) {
    const url = this.getCurrentCharacterProfile().avatarUrl;
    root?.querySelectorAll("[data-phone-wallpaper]").forEach((node) => {
      if (url) node.style.setProperty("--sv-wall", `url("${url}")`);
      node.classList.toggle("sv-has-wall", Boolean(url));
    });
  },

  async openPhoneSettings() {
    this.closeSmartphone();
    await this.openPanel();
    this.openSettingsGroup("sv-fold-smartphone");
  },

  async openSmartphone(tab = null) {
    await this.syncMultiCastCast?.();
    if (!this.phoneOn()) {
      this.notify("스마트폰이 꺼져 있습니다. 설정 → 스마트폰에서 ‘스마트폰 사용’을 켜 주세요.");
      return;
    }
    if (!this.phoneSession && !this.phonePendingEvent)
      await this.restorePhoneSession();
    const open = document.getElementById("sv-smartphone");
    const before = open && !open.classList.contains("hidden") ? this.phoneActiveTab : "home";
    this.phoneActiveTab =
      tab ||
      (this.phoneSession || this.phonePendingEvent?.type === "incoming_call"
        ? "call"
        : ["voicemail", "overheard"].includes(this.phoneAlert())
          ? "history"
          : this.phoneAlert()
            ? "message"
            : "home");
    this.phoneShelf = {};
    this.overheardEditor = null;
    this.noteRingReturn(before);
    // Opened for a message: go straight to that conversation.
    if (!tab && this.phoneActiveTab === "message")
      this.messageThreadKey =
        [...this.unreadThreads][0] || this.incomingText?.callerKey || this.messageThreadKey;
    let shell = document.getElementById("sv-smartphone");
    if (!shell) {
      shell = document.createElement("section");
      shell.id = "sv-smartphone";
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-label", "씬보이스 스마트폰");
      shell.innerHTML = `
                <div class="sv-phone-frame">
                    <span class="sv-phone-key sv-phone-key-action" aria-hidden="true"></span>
                    <span class="sv-phone-key sv-phone-key-up" aria-hidden="true"></span>
                    <span class="sv-phone-key sv-phone-key-down" aria-hidden="true"></span>
                    <span class="sv-phone-key sv-phone-key-power" aria-hidden="true"></span>
                    <div class="sv-phone-screen">
                        <header class="sv-phone-status sv-smartphone-handle" title="끌어서 옮기기">
                            <time class="sv-phone-clock"></time>
                            <span class="sv-phone-island" aria-hidden="true"><span></span></span>
                            <span class="sv-phone-indicators" aria-hidden="true"><i class="fa-solid fa-signal"></i><i class="fa-solid fa-wifi"></i><span class="sv-phone-battery"><span></span></span></span>
                        </header>
                        <nav class="sv-phone-nav">
                            <button type="button" class="sv-smartphone-home sv-home-invisible" aria-label="스마트폰 홈으로 돌아가기"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>홈</span></button>
                            <strong class="sv-smartphone-title">SceneVoice</strong>
                            <button type="button" class="sv-call-return" hidden aria-label="통화로 돌아가기" title="통화로 돌아가기"><i class="fa-solid fa-phone" aria-hidden="true"></i><span></span></button>
                            <button type="button" class="sv-smartphone-close" aria-label="스마트폰 닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </nav>
                        <main class="sv-smartphone-body"></main>
                        <button type="button" class="sv-phone-homebar" aria-label="홈 화면으로"><span></span></button>
                    </div>
                </div>`;
      document.body.appendChild(shell);
      const goHome = () => {
        this.phoneActiveTab = "home";
        this.renderSmartphone();
      };
      shell
        .querySelector(".sv-smartphone-close")
        ?.addEventListener("click", () => this.closeSmartphone());
      shell.querySelector(".sv-call-return")?.addEventListener("click", () => {
        const before = this.phoneActiveTab;
        this.phoneActiveTab = "call";
        this.noteRingReturn(before);
        this.renderSmartphone();
      });
      shell
        .querySelector(".sv-smartphone-home")
        ?.addEventListener("click", goHome);
      shell
        .querySelector(".sv-phone-homebar")
        ?.addEventListener("click", goHome);
      shell
        .querySelector(".sv-smartphone-body")
        ?.addEventListener("click", (event) => {
          const app = event.target.closest("[data-phone-app]");
          if (app) {
            this.phoneActiveTab = app.dataset.phoneApp;
            // An app opens on 적용 기억.
            this.phoneShelf = {};
            this.overheardEditor = null;
            // The dock opens the contact list; a widget or contact row opens that person.
            if (app.dataset.phoneApp === "call") {
              this.phoneContactKey = app.dataset.contactKey || "";
              if (!this.phoneSession && !this.phonePendingEvent) {
                this.run(async () => {
                  await this.restorePhoneSession();
                  await this.renderSmartphone();
                });
                return;
              }
            }
            // The dock opens the conversation list; an alert or a contact opens that conversation.
            if (app.dataset.phoneApp === "message")
              this.messageThreadKey = app.dataset.threadKey || "";
            this.renderSmartphone();
            return;
          }
          const person = event.target.closest("[data-contact]");
          if (person) {
            this.phoneContactKey = person.dataset.contact;
            this.renderSmartphone();
            return;
          }
          if (event.target.closest("[data-phone-contacts]")) {
            this.phoneContactKey = "";
            this.renderSmartphone();
            return;
          }
          const editing = event.target.closest("[data-phone-edit]");
          if (editing) {
            this.renderContactEdit(
              shell.querySelector(".sv-smartphone-body"),
              editing.dataset.phoneEdit,
            );
            return;
          }
          if (event.target.closest('[data-phone-action="settings"]'))
            this.run(() => this.openPhoneSettings());
        });
      this.enablePhoneDragging(shell);
      requestAnimationFrame(() => this.restorePhonePosition(shell));
    }
    shell.classList.remove("hidden");
    // Back where it was last moved to (kept inside the window as it is now).
    this.restorePhonePosition(shell);
    this.updatePhoneLauncherVisibility();
    this.startPhoneClock();
    // The screen chosen above is for this chat.
    this.phoneShownChat = this.currentChatId();
    await this.renderSmartphone();
    this.showUpdateNotes?.();
  },

  /**
   * 적용 기억 | 미적용 기억 over the conversation list and the call history (`app`: message or
   * history); `away`: how many records the chat doesn't use now (see anchorPlace), counted on
   * its tab when there are any. Clicking switches and draws the app again.
   */
  phoneShelfTabs(app, away) {
    this.phoneShelf ||= {};
    const shown = this.phoneShelf[app] === "unapplied" ? "unapplied" : "applied";
    const tab = (value, icon, label, extra = "") =>
      `<button type="button" role="tab" class="sv-shelf-tab" data-shelf="${value}" aria-selected="${shown === value}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>${extra}</button>`;
    return `<div class="sv-shelf" role="tablist" aria-label="기억 보기">${tab("applied", "fa-circle-check", "적용 기억")}${tab("unapplied", "fa-trash-can", "미적용 기억", away ? `<em class="sv-shelf-count" aria-label="${away}개">${away}</em>` : "")}</div>`;
  },

  /** 미적용 기억 with nothing in it. */
  phoneShelfEmpty() {
    return `<div class="sv-phone-list-empty sv-shelf-empty"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><strong>미적용 기억이 없어요</strong><p>채팅을 되돌리거나 다른 스와이프로 넘기면, 그때 주고받은 통화·문자가 여기로 옮겨 와요.</p></div>`;
  },

  /** What 미적용 기억 is, and 모두 지우기 (bound by the app). */
  phoneShelfNote() {
    return `<div class="sv-shelf-note"><p>지금 채팅에 반영되지 않는 기록이에요. 다른 스와이프의 기록은 그 스와이프로 돌아가면 다시 적용돼요.</p><button type="button" class="sv-shelf-clear" data-shelf-clear><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>모두 지우기</span></button></div>`;
  },

  bindPhoneShelf(body, app) {
    body.querySelectorAll("[data-shelf]").forEach((button) =>
      button.addEventListener("click", () => {
        if (this.phoneShelf[app] === button.dataset.shelf) return;
        this.phoneShelf[app] = button.dataset.shelf;
        if (app === "message") this.messageThreadKey = "";
        this.renderSmartphone();
      }),
    );
  },

  /** Where a 미적용 record was made: "#12 · 2번째 스와이프", or "#12 · 되돌린 흐름". */
  awayPointLabel(record) {
    const at = String(record?.anchor_message_id ?? "").match(/^\d+/)?.[0];
    const where = at === undefined ? "" : `#${at} · `;
    return this.anchorPlace(record) === "swipe"
      ? `${where}${Number(record.anchor_swipe) + 1}번째 스와이프`
      : `${where}되돌린 흐름`;
  },

  /**
   * The screen to go back to when a ringing call shown on the phone ends unanswered (declined
   * or rung out): the one seen before it (`before`), or the home screen.
   */
  noteRingReturn(before) {
    if (this.phoneActiveTab !== "call" || this.phoneSession || this.phonePendingEvent?.type !== "incoming_call")
      return;
    this.ringReturnTab = before && before !== "call" ? before : "home";
  },

  closeSmartphone() {
    document.getElementById("sv-smartphone")?.classList.add("hidden");
    this.stopPhoneTimer();
    this.stopPhoneClock();
    this.updatePhoneLauncherVisibility();
  },

  /**
   * Redraws the open phone screen. Asks made while a draw is running fold into one more draw
   * after it: bursts (a voice made, a reply arriving, a chat event) redraw once, and the screen
   * always ends on the latest state. Resolves when the screen is up to date.
   */
  renderSmartphone() {
    this.syncMultiCast?.();
    this.syncPublicState?.();
    if (this.phoneDrawing) {
      this.phoneDrawAgain = true;
      return this.phoneDrawing;
    }
    this.phoneDrawing = (async () => {
      try {
        do {
          this.phoneDrawAgain = false;
          await this.drawSmartphone();
        } while (this.phoneDrawAgain);
      } finally {
        this.phoneDrawing = null;
      }
    })();
    return this.phoneDrawing;
  },

  async drawSmartphone() {
    const shell = document.getElementById("sv-smartphone");
    const body = shell?.querySelector(".sv-smartphone-body");
    if (!shell || !body) return;
    // Drawn for another chat than last time: start from that chat's home screen.
    const chat = this.currentChatId();
    if (this.phoneShownChat && this.phoneShownChat !== chat) {
      this.phoneActiveTab = "home";
      this.phoneContactKey = "";
      this.messageThreadKey = "";
      this.phoneShelf = {};
      this.overheardEditor = null;
    }
    this.phoneShownChat = chat;
    const labels = {
      home: "SceneVoice",
      call: this.phoneSession || this.phoneContactKey ? "전화" : "연락처",
      message: "메시지",
      history: "통화 기록",
    };
    const homeButton = shell.querySelector(".sv-smartphone-home");
    homeButton?.classList.toggle(
      "sv-home-invisible",
      this.phoneActiveTab === "home",
    );
    const title = shell.querySelector(".sv-smartphone-title");
    if (title) title.textContent = labels[this.phoneActiveTab] || "SceneVoice";
    // On a call (or one ringing) elsewhere on the phone: a green pill in the title's place
    // says so and brings the call back.
    const back = shell.querySelector(".sv-call-return");
    if (back) {
      const ringing = this.phonePendingEvent?.type === "incoming_call" && !this.phoneSession;
      const live = ["active", "ringing"].includes(this.phoneSession?.status) || ringing;
      const away = live && this.phoneActiveTab !== "call";
      back.hidden = !away;
      if (title) title.hidden = away;
      if (away)
        back.querySelector("span").textContent = ringing
          ? "전화가 오고 있어요"
          : `${this.phoneSession?.character_name || "상대"}와 통화 중`;
    }
    body.dataset.phoneView = this.phoneActiveTab;
    shell.dataset.view = this.phoneActiveTab;
    this.applyPhoneTheme();
    if (this.phoneActiveTab === "home") this.renderSmartphoneHome(body);
    else if (this.phoneActiveTab === "call")
      await this.renderSmartphoneCall(body);
    else if (this.phoneActiveTab === "message")
      await this.renderSmartphoneMessages(body);
    else await this.renderSmartphoneHistory(body);
    // The notice inside the phone follows the screen (gone on the call it announces).
    this.updatePhoneLauncherVisibility();
    // Call screens draw edge to edge, so the status bar turns light on them.
    shell.dataset.screen = body.querySelector(
      ".sv-incoming-call, .sv-call-screen, .sv-call-contact",
    )
      ? "call"
      : this.phoneActiveTab === "home"
        ? "home"
        : "app";
    this.applyPhoneWallpaper(body);
  },

  renderSmartphoneHome(body) {
    this.stopPhoneTimer();
    const pending = this.phoneAlert();
    const now = new Date();
    const status =
      pending === "incoming_call"
        ? "전화가 걸려 오고 있어요"
        : pending === "voice_message"
          ? "새 음성 메시지가 도착했어요"
          : pending === "text_message"
            ? "새 문자가 도착했어요"
            : pending === "voicemail"
              ? "음성 사서함에 메시지가 있어요"
              : pending === "overheard"
                ? "엿들을 수 있는 통화가 있어요"
                : this.phoneSession
                  ? "통화 중"
                  : "통화와 메시지";
    // Quick-call widgets: contacts chosen for the home screen (the first one unless switched
    // off), and whoever a call or message is waiting from.
    const alertKey =
      this.phonePendingEvent?.callerKey ||
      [...this.unreadThreads][0] ||
      this.incomingText?.callerKey ||
      [...(this.unheardCalls?.values() || [])][0]?.key ||
      "";
    // Where an alert widget leads: the call, the conversation, or the voicemail in 통화 기록.
    const alertApp =
      pending === "incoming_call" ? "call" : ["voicemail", "overheard"].includes(pending) ? "history" : "message";
    const quick = this.quickCallContacts().slice(0, 4);
    const widgets = quick.map((contact, index) => [
      contact,
      Boolean(pending) && (alertKey ? alertKey === contact.key : index === 0),
    ]);
    if (pending && alertKey && !quick.some((contact) => contact.key === alertKey))
      widgets.unshift([this.threadContact(alertKey), true]);
    if (pending && !widgets.length)
      widgets.push([{ ...this.getCurrentCharacterProfile(), key: "" }, true]);
    const widget = (contact, alert) => `
                <button type="button" class="sv-phone-widget ${alert ? "sv-widget-alert" : ""}" data-phone-app="${alert ? alertApp : "call"}" data-contact-key="${escapeHtml(contact.group ? "" : contact.key)}" data-thread-key="${escapeHtml(alert ? alertKey || contact.key : contact.key)}">
                    ${this.threadAvatarMarkup(contact)}
                    <span class="sv-widget-text"><strong>${escapeHtml(contact.name)}</strong><small>${alert ? status : this.phoneSession?.character_key === contact.key ? "통화 중" : "통화와 메시지"}</small></span>
                    <span class="sv-widget-call" aria-hidden="true"><i class="fa-solid ${alert && pending === "voice_message" ? "fa-play" : alert && pending === "text_message" ? "fa-comment-dots" : alert && pending === "voicemail" ? "fa-voicemail" : alert && pending === "overheard" ? "fa-ear-listen" : "fa-phone"}"></i></span>
                </button>`;
    const apps = [
      ["call", this.phoneContacts().length > 1 ? "연락처" : "전화", "phone", "sv-app-phone", pending === "incoming_call"],
      [
        "message",
        "메시지",
        "comment-dots",
        "sv-app-message",
        ["voice_message", "text_message"].includes(pending),
      ],
      ["history", "통화 기록", "clock-rotate-left", "sv-app-history", ["voicemail", "overheard"].includes(pending)],
    ];
    body.innerHTML = `
            <div class="sv-smartphone-app-home" data-phone-wallpaper>
                <div class="sv-phone-lock">
                    <span class="sv-phone-date">${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일</span>
                    <strong class="sv-phone-bigclock">${this.phoneClockText(now)}</strong>
                </div>
                ${widgets.length ? `<div class="sv-phone-widgets">${widgets.map(([contact, alert]) => widget(contact, alert)).join("")}</div>` : ""}
                <div class="sv-smartphone-app-grid">
                    ${apps
                      .map(
                        ([app, label, icon, tone, alert]) => `
                    <button type="button" data-phone-app="${app}">
                        <span class="sv-app-icon ${tone}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i></span><strong>${label}</strong>
                        ${alert ? "<em>1</em>" : ""}
                    </button>`,
                      )
                      .join("")}
                    <button type="button" data-phone-action="settings">
                        <span class="sv-app-icon sv-app-settings"><i class="fa-solid fa-gear" aria-hidden="true"></i></span><strong>설정</strong>
                    </button>
                </div>
            </div>`;
  },

  renderPhoneContacts(body, people) {
    const hidden = this.phoneContacts({ includeHidden: true }).length - people.length;
    body.innerHTML = `
            <div class="sv-contacts">
                <h3 class="sv-recents-title">연락처</h3>
                <div class="sv-contact-list">
                    ${people
                      .map(
                        (person) => `
                    <button type="button" class="sv-contact-row" data-contact="${escapeHtml(person.key)}">
                        ${this.contactAvatarMarkup(person)}
                        <span class="sv-recent-main"><strong>${escapeHtml(person.name)}</strong></span>
                        <i class="fa-solid fa-chevron-right sv-recent-chevron" aria-hidden="true"></i>
                    </button>`,
                      )
                      .join("")}
                </div>
                <p class="sv-contacts-note">${hidden > 0 ? `숨긴 연락처 ${hidden}명 · ` : ""}씬보이스 설정의 캐릭터별 목소리에 등록한 인물이 자동으로 들어옵니다.</p>
            </div>`;
  },

  /**
   * Edits a person from the phone: picture, name, home-screen spot and visibility. A global
   * person is hidden only in this bot card. Voices stay in the settings.
   */
  renderContactEdit(body, key) {
    const person = this.phoneContact(key);
    const entry = this.config.character_voices?.[key] || {};
    const global = key.startsWith("speaker:") && !entry.card;
    const cards = this.currentCardKeys();
    const hiddenHere = global ? !this.globalInUse(entry, cards) : Boolean(entry.phone_hidden);
    // undefined: unchanged; "": back to the default picture; a URL: the new picture.
    let avatar;
    body.innerHTML = `
            <form class="sv-contact-edit">
                <div class="sv-contact-edit-head">
                    <span class="sv-contact-photo">${this.contactAvatarMarkup(person)}</span>
                    <strong>연락처 편집</strong>
                    <span class="sv-contact-photo-actions">
                        <label class="sv-contact-photo-pick"><input type="file" accept="image/*" name="photo" hidden><i class="fa-solid fa-camera" aria-hidden="true"></i><span>사진 바꾸기</span></label>
                        ${entry.avatar ? '<button type="button" data-photo-reset><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>기본 사진</span></button>' : ""}
                    </span>
                </div>
                <label class="sv-ph-field"><span>이름</span><input name="name" maxlength="120" value="${escapeHtml(person.name)}" autocomplete="off"></label>
                <label class="sv-ph-toggle"><span>홈 화면에 보이기 (빠른 전화)</span><input type="checkbox" name="quick" ${this.isQuickCall(key) ? "checked" : ""}></label>
                <label class="sv-ph-toggle"><span>${global ? "이 봇카드에서 사용" : "연락처에서 숨기기"}</span><input type="checkbox" name="hidden" ${(global ? !hiddenHere : hiddenHere) ? "checked" : ""}></label>
                <div class="sv-contact-edit-actions"><button type="button" data-contact="${escapeHtml(key)}">취소</button><button type="submit">저장</button></div>
            </form>`;
    const phone = document.getElementById("sv-smartphone");
    if (phone) {
      phone.dataset.screen = "app";
      phone.querySelector(".sv-smartphone-title").textContent = "연락처 편집";
    }
    const form = body.querySelector("form");
    const preview = (url) => {
      form.querySelector(".sv-contact-photo").innerHTML = this.contactAvatarMarkup({
        ...person,
        avatarUrl: url,
      });
    };
    form.elements.photo.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      this.run(async () => {
        avatar = await this.uploadAvatar(file);
        preview(avatar);
      });
    });
    form.querySelector("[data-photo-reset]")?.addEventListener("click", () => {
      avatar = "";
      preview(this.defaultAvatar(key));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.run(async () => {
        const voices = structuredClone(this.config.character_voices || {});
        const next = { ...(voices[key] || {}) };
        next.name = form.elements.name.value.trim() || person.name;
        if (global) {
          // Checked here means "in use in this bot card".
          const used = new Set(this.globalUseList(next));
          for (const card of cards)
            if (form.elements.hidden.checked) used.add(card);
            else used.delete(card);
          next.use_cards = [...used];
        } else if (form.elements.hidden.checked) next.phone_hidden = true;
        else delete next.phone_hidden;
        next.quick_call = form.elements.quick.checked;
        if (avatar === "") delete next.avatar;
        else if (avatar) next.avatar = avatar;
        voices[key] = next;
        const response = await this.request("/api/plugins/scenevoice/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_voices: voices }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || `연락처 저장 실패 (${response.status})`);
        this.config = mergeConfig(data.settings || {});
        // Keep an open settings panel's speaker drafts in step with the phone edit.
        if (document.getElementById("sv-casting-settings")) this.renderCastingSettings();
        this.phoneContactKey = form.elements.hidden.checked ? "" : key;
        this.notify("연락처를 저장했습니다.", "success");
        await this.renderSmartphone();
      });
    });
  },
};
