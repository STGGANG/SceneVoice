// Start-up (settings, launchers, events) and notifications.
import { EMOTIONS, mergeConfig } from "./common.js";

export const lifecycle = {
  async init({ transport, connectionService = null }) {
    this.transport = transport;
    this.connectionService = connectionService;
    this.lifetimeController = new AbortController();
    this.captureChat();
    this.createLauncher();
    this.bindEvents();
    // Every tap keeps audio allowed on phones (see unlockAudioForMobile); coming back to the
    // page wakes the audio and frees a call voice that was cut off while away.
    const unlock = () => this.unlockAudioForMobile();
    const back = () => {
      if (document.hidden) return;
      const context = this.communicationAudioContext;
      if (context && context.state !== "running") context.resume().catch(() => undefined);
      this.recoverPhoneAudio?.();
    };
    for (const type of ["touchend", "click", "keydown"]) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
      this.eventCleanups.push(() => document.removeEventListener(type, unlock, { capture: true }));
    }
    document.addEventListener("visibilitychange", back);
    this.eventCleanups.push(() => document.removeEventListener("visibilitychange", back));
    await this.loadConfig();
    // The phone button comes first: a failed restore below must not leave the phone unreachable.
    this.createPhoneLauncher();
    await this.restorePhoneSession().catch((error) =>
      console.warn("[SceneVoice] phone session restore failed", error),
    );
    await this.refreshChatMemory().catch((error) =>
      console.warn("[SceneVoice] chat memory refresh failed", error),
    );
    this.bindMultiCast();
    this.exposePublicApi();
    this.updatePhoneLauncherVisibility();
    this.applyChatDisplay();
    if (this.isActive()) {
      this.startObserver();
      this.scheduleScan();
    }
    this.syncTimer = setInterval(
      () => this.run(() => this.syncSharedSettings()),
      15000,
    );
  },
  async loadConfig() {
    const response = await this.request("/api/plugins/scenevoice/settings", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "설정을 읽을 수 없습니다. 서버 연결과 저장 공간을 확인해 주세요.",
      );
    const data = await response.json();
    this.config = mergeConfig(data.settings || {});
    this.availableEmotions = data.available_emotions || [...EMOTIONS];
    this.availableEngines = data.available_engines || ["elevenlabs"];
    this.favoritesPath = data.favorites_path || "";
    this.storageMode = data.storage_mode || this.transport.mode;
    this.backendConnected = true;
    this.backendError = "";
  },
  /** 씬보이스 사용: off, nothing runs; the records and settings stay. */
  isActive() {
    return this.config?.active !== false;
  },

  /** 채팅 대사 읽기: chat lines get buttons and voices. */
  chatVoiceOn() {
    return this.isActive() && this.config?.enabled !== false;
  },

  allowedEmotions() {
    return new Set(this.availableEmotions);
  },
  analysisEmotionCandidates() {
    return this.allowedEmotions();
  },
  formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
  },

  /** ST's toasts; a plain one of our own where ST has none (tests, other front ends). */
  notify(message, type = "info") {
    // The same notice again within a few seconds (one per message of a batch) shows once.
    const now = Date.now();
    this.recentNotices ||= new Map();
    const said = `${type}\n${message}`;
    if (now - (this.recentNotices.get(said) || 0) < 6000) return;
    this.recentNotices.set(said, now);
    if (this.recentNotices.size > 30)
      for (const [key, at] of this.recentNotices) if (now - at >= 6000) this.recentNotices.delete(key);
    if (window.toastr?.[type]) {
      window.toastr[type](message, "씬보이스");
      return;
    }
    console[type === "error" ? "error" : "log"](`[SceneVoice] ${message}`);
    const toast = document.createElement("div");
    toast.className = `sv-toast ${type === "error" ? "sv-toast-error" : ""}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  },
};
