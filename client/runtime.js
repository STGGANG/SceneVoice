// Shared runtime: chat identity and fingerprints, cancelling work when the chat changes, requests
// to the service, settings from other devices, and disposal.
import { contentKey } from "../shared/hash.js";
import { withoutVoiceTags } from "./common.js";
export const runtime = {
  chatController: null,
  lifetimeController: null,
  eventCleanups: [],
  chatKey: "",
  transport: null,
  generatedUrls: new Set(),
  // The hashes below are asked for by every line button on every pass; the SHA-256 is plain
  // JavaScript (it must work on plain-HTTP pages), so results are kept until their input changes.
  currentChatId() {
    const context = window.SillyTavern?.getContext?.() || {};
    const character = this.getCurrentCharacterProfile().key;
    const input = `${context.chatId || ""}\u0000${character}`;
    if (this.chatIdCache?.input !== input)
      this.chatIdCache = {
        input,
        value: contentKey({ chatId: context.chatId || "", character }),
      };
    return this.chatIdCache.value;
  },
  anchorFingerprint(index) {
    const message = window.SillyTavern?.getContext?.()?.chat?.[Number(index)];
    if (!message) return "";
    this.printCache ||= new WeakMap();
    const cached = this.printCache.get(message);
    if (cached?.mes === message.mes && cached.swipe === message.swipe_id) return cached.value;
    // MultiCast's 🚀 tags leaving the message don't make it another message.
    const value = contentKey({ text: withoutVoiceTags(message.mes), swipe: message.swipe_id });
    this.printCache.set(message, { mes: message.mes, swipe: message.swipe_id, value });
    return value;
  },
  /** Where a call or text was made: the chat message it follows and the swipe then showing. */
  anchorStamp(index) {
    const message = window.SillyTavern?.getContext?.()?.chat?.[Number(index)];
    const tag = this.anchorTag(index);
    return {
      anchor_fingerprint: this.anchorFingerprint(index),
      ...(typeof message?.swipe_id === "number" ? { anchor_swipe: message.swipe_id } : {}),
      ...(tag ? { anchor_tag: tag } : {}),
    };
  },
  /**
   * A mark left on the chat message a call or text was made at (kept with it through edits,
   * continuing and swipes back to it; gone when the message is deleted or made anew), so a call
   * or text of a later part of the chat that was taken back doesn't come back with whatever
   * message takes that place.
   */
  anchorTag(index) {
    const context = window.SillyTavern?.getContext?.() || {};
    const message = context.chat?.[Number(index)];
    if (!message) return "";
    if (!message.extra || typeof message.extra !== "object") message.extra = {};
    let tag = message.extra.scenevoice_anchor;
    if (!tag) {
      tag = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      message.extra.scenevoice_anchor = tag;
      // Into the swipe's own record too, so it is there when this swipe is shown again.
      const info = message.swipe_info?.[message.swipe_id];
      if (info && typeof info === "object") (info.extra ||= {}).scenevoice_anchor = tag;
      Promise.resolve(context.saveChat?.()).catch(() => undefined);
    }
    return String(tag);
  },
  /** The swipe a record was made on, or null when unknown. */
  anchorSwipeOf(record) {
    return Number.isInteger(record?.anchor_swipe) ? record.anchor_swipe : null;
  },
  /**
   * Where a call or text stands with the chat as it is now: "here" (it belongs to what the chat
   * shows: it is used and remembered), "swipe" (made on another swipe of its message: swiping
   * back brings it back) or "gone" (the chat went back to before it). Records away from "here"
   * stay on the phone under 미적용 기억, out of every prompt.
   */
  anchorPlace(record) {
    const match = String(record?.anchor_message_id ?? "").match(/^\d+$/);
    if (!match) return "here";
    const message = window.SillyTavern?.getContext?.()?.chat?.[Number(match[0])];
    // The message it was made at is gone: the chat went back to before it. One made in a chat
    // with no messages yet (kept at message 0, with nothing to mark) stays.
    if (!message) return match[0] === "0" && !record.anchor_tag && !record.anchor_fingerprint ? "here" : "gone";
    const made = this.anchorSwipeOf(record);
    const current = typeof message.swipe_id === "number" ? message.swipe_id : 0;
    if (made !== null && made !== current) {
      // Still a swipe of the same message (one made later could have taken its number).
      const count = Array.isArray(message.swipes) ? message.swipes.length : 0;
      if (made >= count) return "gone";
      const tag = message.swipe_info?.[made]?.extra?.scenevoice_anchor;
      return record.anchor_tag && tag !== record.anchor_tag ? "gone" : "swipe";
    }
    // Another message has taken that place since (the chat went back and on again).
    if (record.anchor_tag && message.extra?.scenevoice_anchor !== record.anchor_tag) return "gone";
    return "here";
  },
  /** A call or text of what the chat shows now (see anchorPlace). */
  anchorShown(record) {
    return this.anchorPlace(record) === "here";
  },
  createAudioUrl(blob) {
    const url = URL.createObjectURL(blob);
    this.generatedUrls.add(url);
    return url;
  },
  captureChat() {
    const context = window.SillyTavern?.getContext?.() || {};
    const key = contentKey({
      chatId: context.chatId || "",
      character: context.characterId,
      group: context.groupId,
    });
    if (this.chatKey && this.chatKey !== key) this.resetChat(key);
    this.chatKey = key;
    this.chatController ||= new AbortController();
    return {
      key,
      signal: this.chatController.signal,
      chat: context.chat,
      chatId: context.chatId || "",
    };
  },
  assertChat(operation) {
    const current = this.captureChat();
    if (operation.signal.aborted || operation.key !== current.key)
      throw new DOMException(
        "채팅이 바뀌어 작업을 취소했습니다.",
        "AbortError",
      );
  },
  resetChat(key = "") {
    this.chatController?.abort(
      new DOMException(
        "채팅 또는 설정이 바뀌어 작업을 취소했습니다.",
        "AbortError",
      ),
    );
    this.chatController = new AbortController();
    this.chatKey = key;
    this.clearMessageJobs?.();
    this.lineStatePromise = null;
    this.lineState = null;
    document.getElementById("sv-line-editor")?.remove();
    document.querySelectorAll(".sv-play-btn").forEach((button) => {
      button.lineSignature = "";
    });
    this.phoneOperationToken++;
    this.queue = Promise.resolve();
    this.analysisCache.clear();
    this.phoneSession = null;
    this.phonePendingEvent = null;
    this.incomingTexts = [];
    this.incomingText = null;
    // A voicemail being left, and their getting back to it, belonged to the chat before; so did a
    // written call left open on its screen.
    this.voicemailBox = null;
    this.callListenOpen = null;
    this.writtenCallBusy = "";
    this.memoEditor = null;
    this.groupCallPicker = null;
    this.radioEditor = null;
    if (this.radioPlaying) this.radioPlaying.stopped = true;
    this.radioPlaying = null;
    this.stopRadioMusic?.();
    this.radioShowOpen = null;
    this.radioStopAt = null;
    this.unheardMemos?.clear();
    for (const timer of this.voicemailAnswers?.values() || []) clearTimeout(timer);
    this.voicemailAnswers?.clear();
    // The last 연락 판단 belonged to the message shown before (another swipe, another chat).
    this.lastContactDecisions = [];
    this.lastStateRound = null;
    this.statePersonKey = "";
    this.lastStateTrackingSource = "";
    this.stateTrackingBusy = false;
    this.phoneBusy = false;
    this.phoneAudioBusyTurnId = "";
    this.voiceMessageBusy = false;
    this.textReplyTimers.forEach((timer) => clearTimeout(timer));
    this.textReplyTimers.clear();
    this.textReplyBusy = "";
    this.textReplyAgain.clear();
    this.messageThreadKey = "";
    this.phoneShelf = {};
    this.overheardEditor = null;
    this.messageGroups = [];
    this.groupEditor = null;
    this.unreadThreads.clear();
    this.stopPhoneTimer();
    if (this.threadPlayback) this.threadPlayback.stopped = true;
    this.threadPlayback = null;
    if (this.callPlayback) this.callPlayback.stopped = true;
    this.callPlayback = null;
    clearTimeout(this.textAlertTimer);
    this.textAlert = null;
    clearTimeout(this.ringTimer);
    this.ringReturnTab = null;
    clearTimeout(this.callAfterTimer);
    this.unheardCalls?.clear();
    this.stopPlayback();
    this.clearChatMemoryPrompts();
    // Only lines whose making was just cancelled go back; finished voices stay, and each line is
    // checked against the chat as it is now on the next refresh (no flicker over the chat).
    this.invalidateGeneratedButtons(
      '.sv-play-btn:is([data-status="queued"], [data-status="generating"], .sv-loading)',
    );
    for (const url of this.generatedUrls) URL.revokeObjectURL(url);
    this.generatedUrls.clear();
    // An open phone stays open. Another chat starts on its home screen; an edit, swipe or
    // deletion in the same chat keeps the current screen. Either way it is redrawn for the
    // chat as it is now (after the call record is restored).
    const shell = document.getElementById("sv-smartphone");
    if (shell && !shell.classList.contains("hidden")) {
      clearTimeout(this.phoneRedrawTimer);
      this.phoneRedrawTimer = setTimeout(
        () => this.run(() => this.renderSmartphone()),
        250,
      );
    }
    this.updatePhoneLauncherVisibility();
  },
  async fetch(url, options = {}, timeout = 180000) {
    const operation = this.captureChat();
    const response = await this.transport.request(
      url,
      { ...options, signal: operation.signal },
      timeout,
    );
    this.assertChat(operation);
    this.noteStorageUsage?.(response);
    // Guard body consumption too: a chat can change while audio is downloading.
    for (const method of ["json", "blob", "arrayBuffer"]) {
      const read = response[method].bind(response);
      response[method] = async () => {
        const body = await read();
        this.assertChat(operation);
        return body;
      };
    }
    return response;
  },
  apiUrl(path) {
    return path;
  },
  /** A new voice filled the cache to 90% or more: say so once per session. */
  noteStorageUsage(response) {
    const usage = Number(response.headers?.get?.("X-SceneVoice-Storage"));
    if (!(usage >= 0.9) || this.storageWarned) return;
    this.storageWarned = true;
    this.notify(
      `음성 저장 공간이 ${Math.min(100, Math.round(usage * 100))}% 찼습니다. 최대 용량을 넘으면 오래된 음성부터 지웁니다(보관함은 그대로). 설정 → 저장 공간에서 용량을 늘리거나 정리할 수 있습니다.`,
      "info",
    );
  },

  request(path, options = {}, timeout = 10000) {
    return this.fetch(path, options, timeout);
  },
  run(task) {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        if (error.name !== "AbortError")
          this.notify(error.message || "작업 실패", "error");
      });
  },
  stopPlayback() {
    // Whoever waited for this audio (playing a message in a row) hears that it stopped.
    const stopped = this.currentAudioStop;
    this.currentAudioStop = null;
    stopped?.();
    // Callbacks of the audio being stopped are ignored from here on.
    this.playToken = (this.playToken || 0) + 1;
    this.markPaused?.(false);
    this.stopSideSounds?.();
    this.hideNowReading?.(true);
    this.syncPublicState?.({ playing: false });
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
    }
    this.currentAudio = null;
    this.currentPlayButton?.classList.remove("sv-playing");
    this.currentPlayButton = null;
    this.currentAudioNodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {}
    });
    this.currentAudioNodes = [];
    if (this.currentAudioObjectUrl)
      URL.revokeObjectURL(this.currentAudioObjectUrl);
    this.currentAudioObjectUrl = "";
  },
  cancelPending() {
    this.resetChat(this.chatKey);
    this.notify(
      "대기 및 진행 중인 요청을 취소했습니다. 이미 서비스에 전달된 생성은 과금될 수 있습니다.",
    );
  },
  async loadVoiceChoices() {
    const response = await this.request(
      "/api/plugins/scenevoice/voices?engine=elevenlabs",
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "보이스 목록을 읽지 못했습니다.");
    // Every voice picker (defaults and each person's) lists these by name.
    this.voiceChoices = data.items || [];
    this.fillVoiceOptions();
    return this.voiceChoices.length;
  },

  async syncSharedSettings() {
    if (
      document.hidden ||
      this.phoneBusy ||
      this.voiceMessageBusy ||
      this.stateTrackingBusy ||
      document.querySelector(".sv-loading,.sv-queued") ||
      document.querySelector('#sv-panel[data-tab="settings"]')
    )
      return;
    try {
      // Settings changed on another device apply like a save here: line buttons are rebuilt only
      // when what they read changed, so the chat doesn't flicker for an unrelated setting.
      const before = this.config;
      const beforeKey = contentKey(before);
      const lineKey = this.lineConfigKey();
      await this.loadConfig();
      if (contentKey(this.config) !== beforeKey) {
        await this.applySavedSettings(before, lineKey);
        this.updatePhoneLauncherVisibility();
      }
      // The lines are looked at again only when their saved edits or voices changed (another
      // device made or fixed one).
      const shownLines = this.lineState;
      this.lineStatePromise = null;
      const state = await this.loadLineState();
      const same = (value) => JSON.stringify([value?.edits, value?.audio]);
      if (!shownLines || same(shownLines) !== same(state)) await this.hydrateLines();
      const tab = document.getElementById("sv-panel")?.dataset.tab;
      if (
        tab === "history" &&
        !document.activeElement?.closest(".sv-history-filters")
      )
        await this.renderHistory();
      if (tab === "favorites") await this.renderFavorites();
    } catch (error) {
      if (error.name !== "AbortError")
        console.warn("[SceneVoice] 공유 목록 새로고침 보류:", error.name);
    }
  },
  dispose() {
    this.castOrderCleanup?.();
    this.castOrderCleanup = null;
    clearInterval(this.syncTimer);
    clearInterval(this.phoneClockTimer);
    this.resetChat();
    this.lifetimeController?.abort();
    this.phoneFitBound = false;
    this.observer?.disconnect();
    this.observer = null;
    for (const timer of [
      "scanTimer",
      "stateScanTimer",
      "chatMemoryRefreshTimer",
      "launcherTimer",
      "phoneRedrawTimer",
      "phoneFitTimer",
      "autoAnalysisTimer",
      "autoPlayTimer",
      "nowReadingTimer",
      "textAlertTimer",
      "ringTimer",
      "callAfterTimer",
    ])
      clearTimeout(this[timer]);
    this.textReplyTimers.forEach((timer) => clearTimeout(timer));
    this.releaseMultiCast?.();
    this.removePublicApi?.();
    this.eventCleanups.splice(0).forEach((off) => off());
    this.chatMemoryEventsBound = false;
    this.removeDecorations();
    document.body.classList.remove("sv-hide-line-buttons");
    this.transport?.dispose();
    for (const id of [
      "sv-phone-launcher",
      "sv-call-banner",
      "sv-now-reading",
      "sv-smartphone",
      "sv-overlay",
      "sv-restore-dialog",
      "sv-backup-dialog",
      "sv-extension-menu-item",
      "sv-phone-menu-item",
      "sv-extension-settings-block",
      "sv-line-editor",
    ])
      document.getElementById(id)?.remove();
  },
};
