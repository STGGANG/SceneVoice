// window.SceneVoiceAPI (apiVersion 1): what other extensions (MultiCast TTS and others) can use
// while SceneVoice is loaded. Keep its shape stable: add things, don't rename or remove them.
// Events go to on(type, fn) listeners and to document as "scenevoice:<type>":
//   ready {apiVersion} · playstart {kind} · playend {} · callstart {name} · callend {}
const API_VERSION = 1;

export const publicApi = {
  exposePublicApi() {
    this.publicListeners = new Map();
    this.publicHolds = new Set();
    const self = this;
    window.SceneVoiceAPI = Object.freeze({
      apiVersion: API_VERSION,
      /** SceneVoice is switched on (설정 → 기본 → 씬보이스 사용). */
      isActive: () => self.isActive(),
      /** SceneVoice voices the chat's own lines (채팅 대사 읽기); off means it only runs the phone. */
      readsChat: () => self.chatVoiceOn(),
      /** The smartphone is on. */
      phoneOn: () => self.phoneOn(),
      /** Something of SceneVoice's is sounding: a chat line, a call line, a voice message. */
      isPlaying: () => Boolean(self.currentAudio),
      /** Stop whatever SceneVoice is playing (a call goes on; only its voice stops). */
      stop: () => self.stopPlayback(),
      /** A call is ringing or going on. */
      inCall: () => Boolean(self.publicCall),
      /** Hold SceneVoice's 새 답변 자동 재생 until released. Reasons stack. */
      holdAutoPlay: (reason = "external") => void self.publicHolds.add(String(reason)),
      releaseAutoPlay: (reason = "external") => void self.publicHolds.delete(String(reason)),
      isAutoPlayHeld: () => self.publicHolds.size > 0,
      /** Open the smartphone. */
      openPhone: () => void self.run(() => self.openSmartphone()),
      on: (type, fn) => {
        if (typeof fn !== "function") return;
        if (!self.publicListeners.has(type)) self.publicListeners.set(type, new Set());
        self.publicListeners.get(type).add(fn);
      },
      off: (type, fn) => void self.publicListeners.get(type)?.delete(fn),
    });
    this.emitPublic("ready", { apiVersion: API_VERSION });
  },

  emitPublic(type, detail = {}) {
    try {
      document.dispatchEvent(new CustomEvent(`scenevoice:${type}`, { detail }));
    } catch {
      /* no document events here */
    }
    for (const fn of this.publicListeners?.get(type) || []) {
      try {
        fn(detail);
      } catch (error) {
        console.warn(`[SceneVoice] listener for ${type} failed`, error);
      }
    }
  },

  /**
   * Tells listeners when SceneVoice starts or stops sounding, and when a call starts or ends.
   * The end of playing waits a moment, so lines read in a row don't flicker end → start.
   */
  syncPublicState({ playing = Boolean(this.currentAudio), kind = "" } = {}) {
    if (!this.publicListeners) return;
    clearTimeout(this.publicIdleTimer);
    if (playing && !this.publicPlaying) {
      this.publicPlaying = true;
      this.emitPublic("playstart", { kind });
    } else if (!playing && this.publicPlaying)
      this.publicIdleTimer = setTimeout(() => {
        if (this.currentAudio) return;
        this.publicPlaying = false;
        this.emitPublic("playend", {});
      }, 1200);
    const call =
      ["ringing", "active"].includes(this.phoneSession?.status) ||
      this.phonePendingEvent?.type === "incoming_call";
    if (call !== Boolean(this.publicCall)) {
      this.publicCall = call;
      this.emitPublic(call ? "callstart" : "callend", call ? { name: this.phoneSession?.character_name || "" } : {});
    }
  },

  /** On the way out: the window object goes, and listeners hear that nothing plays. */
  removePublicApi() {
    clearTimeout(this.publicIdleTimer);
    if (this.publicPlaying) this.emitPublic("playend", {});
    if (this.publicCall) this.emitPublic("callend", {});
    if (window.SceneVoiceAPI?.apiVersion === API_VERSION) delete window.SceneVoiceAPI;
    this.publicListeners = null;
    this.publicPlaying = false;
    this.publicCall = false;
  },
};
