// 음성 준비: makes a message's lines one by one and plays them in order, starting as soon as
// the first is ready (the next ones are made while one plays).
import { extractSegments } from "../shared/segments.js";
import { withoutVoiceTags } from "./common.js";

// Lines made before 음성 준비 starts to play, and again when playing catches up with the making.
const PREPARE_AHEAD = 3;
const CATCH_UP_AHEAD = 2;

// The message button's word and its icon: 음성 (nothing made yet), 재생 (made, play from the
// start or resume), 준비중 (waiting for voices), 정지 (playing: a press stops).
const GENERATE_ICONS = {
  음성: "fa-wave-square",
  재생: "fa-play",
  준비중: "fa-hourglass-half",
  정지: "fa-stop",
};

export const messageGeneration = {
  messageJobs: new Map(),
  setGenerateLabel(control, text) {
    const label = control.querySelector(".sv-generate-label");
    if (label) label.textContent = text;
    else control.textContent = text;
    const icon = control.querySelector("i");
    if (icon && GENERATE_ICONS[text]) icon.className = `fa-solid ${GENERATE_ICONS[text]}`;
  },
  decorateMessageGeneration(container) {
    if (this.config.playback?.prepare === false) return;
    const message = container.closest(".mes,.message-body");
    if (!message) return;
    const existing = message.querySelector(".sv-message-generate");
    const lines = Boolean(container.querySelector(".sv-play-btn"));
    // The button row stays through a swipe or an edit: the button follows the text shown now.
    const print = this.anchorFingerprint?.(message.getAttribute("mesid")) || "";
    if (existing && existing.dataset.print !== print && !this.messageJobs.has(existing)) {
      if (!lines) {
        this.messageTools(existing).forEach((tool) => tool.remove());
        existing.remove();
        return;
      }
      existing.dataset.print = print;
      this.messagePlayback?.delete(existing);
      this.setGenerateLabel(existing, "음성");
      existing.title = existing.dataset.firstTitle || existing.title;
      for (const tool of this.messageTools(existing)) tool.hidden = true;
    }
    if (!lines || existing) return;
    const button = document.createElement("button");
    button.dataset.print = print;
    button.type = "button";
    button.className = "mes_button sv-message-generate";
    button.innerHTML =
      '<i class="fa-solid fa-wave-square" aria-hidden="true"></i><span class="sv-generate-label">음성</span>';
    button.title =
      "이 메시지의 대사·생각을 차례로 만들며 이어서 들려줍니다. 앞의 몇 대사가 준비되면 시작합니다. 번역 확장으로 번역문이 보이는 메시지는 원문으로 만듭니다.";
    button.dataset.firstTitle = button.title;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.queueMessageGeneration(container, button);
    });
    // 분석 다시: shown once the message has been prepared (or has made voices).
    const again = document.createElement("button");
    again.type = "button";
    again.className = "mes_button sv-message-tool sv-message-reanalyze";
    again.hidden = !container.querySelector('.sv-play-btn[data-status="ready"]');
    again.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span class="sv-generate-label">분석</span>';
    again.title =
      "이 메시지의 화자·연기를 다시 분석합니다(보조모델 요청 1번). 다음에 들을 때 연기가 바뀐 대사만 새로 만듭니다.";
    again.setAttribute("aria-label", again.title);
    again.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.run(() => this.withBusyButton(again, () => this.reanalyzeMessage(container, button)));
    });
    // The message's made voices as one file, in reading order.
    const save = document.createElement("button");
    save.type = "button";
    save.className = "mes_button sv-message-tool sv-message-download";
    save.hidden = again.hidden;
    save.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i>';
    save.title = "이 메시지의 음성을 이어진 파일 하나로 내려받기(WAV)";
    save.setAttribute("aria-label", save.title);
    save.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.run(() => this.withBusyButton(save, () => this.downloadMessageAudio(container)));
    });
    (message.querySelector(".mes_buttons") || message).append(button, again, save);
  },

  /** 분석 다시 and 내려받기 show for a message with voices made (on screen, or its source lines). */
  async revealMessageTools(container) {
    const control = container.closest(".mes,.message-body")?.querySelector(".sv-message-generate");
    const tools = this.messageTools(control);
    if (!tools.some((tool) => tool.hidden)) return;
    const source = this.sourceLineButtons(container);
    if (source) await this.hydrateLines(source.host);
    const lines = source ? source.buttons : [...container.querySelectorAll(".sv-play-btn")];
    if (!lines.some((line) => line.dataset.status === "ready")) return;
    for (const tool of tools) tool.hidden = false;
    // Voices made on an earlier visit: the button plays them.
    if (!this.messageJobs.has(control) && control.querySelector(".sv-generate-label")?.textContent === "음성")
      this.setGenerateLabel(control, "재생");
  },

  /** The buttons beside a message's 음성 준비 (분석 다시, 내려받기). */
  messageTools(control) {
    return [...(control?.parentElement?.querySelectorAll(".sv-message-tool") || [])];
  },

  /**
   * 내려받기: the message's made voices joined in reading order, with the short breath played
   * between them, as one WAV file. Lines not made yet are left out (and counted).
   */
  async downloadMessageAudio(container) {
    const source = this.sourceLineButtons(container);
    const buttons = source ? source.buttons : [...container.querySelectorAll(".sv-play-btn")];
    await this.hydrateLines(source ? source.host : container);
    const ready = buttons.filter((line) => line.dataset.status === "ready" && line.dataset.audioUrl);
    if (!ready.length) throw new Error("내려받을 음성이 없습니다. 먼저 메시지의 ‘음성’ 버튼으로 만들어 주십시오.");
    const messageId = container.closest(".mes")?.getAttribute("mesid") || "";
    await this.downloadJoinedAudio(
      ready.map((line) => ({ url: line.dataset.audioUrl })),
      `${this.getCurrentCharacterProfile?.().name || "scenevoice"}-${messageId}`,
      { gap: 0.38, rate: 44100 },
    );
  },

  /**
   * 분석 다시: one new analysis of the whole message replaces the saved one. Its made voices are
   * set aside; on the next listen each line is asked for again, and only a line whose speaker or
   * acting changed costs a new voice (the rest come back from the saved files).
   */
  async reanalyzeMessage(container, control) {
    if (this.messageJobs.has(control)) return;
    const source = this.sourceLineButtons(container);
    const buttons = source ? source.buttons : [...container.querySelectorAll(".sv-play-btn")];
    if (!buttons.length) return;
    await this.hydrateLines(source ? source.host : container);
    await this.analyzeUtterance(buttons[0], { force: true });
    this.staleLines ||= new Set();
    for (const line of buttons) {
      this.staleLines.add(this.lineIdentity(line));
      if (line.dataset.status === "ready") this.cancelLineAudio(line);
      line.lineSignature = "";
    }
    const playback = this.messagePlayback?.get(control);
    if (playback) playback.position = 0;
    this.setGenerateLabel(control, "재생");
    control.title = "새 분석으로 처음부터 들려줍니다. 연기가 바뀐 대사만 새로 만듭니다.";
    this.notify("분석을 다시 했습니다. 다음에 들을 때 바뀐 대사만 새로 만듭니다.", "info");
  },
  /**
   * With a translation on screen (a translation extension shows message.extra.display_text and keeps
   * the source in message.mes), 음성 준비 reads the source text: its lines, off screen.
   */
  sourceLineButtons(container) {
    const messageId = container.closest(".mes")?.getAttribute("mesid");
    const context = window.SillyTavern?.getContext?.() || {};
    const message = context.chat?.[Number(messageId)];
    const shown = message?.extra?.display_text;
    if (!message || !shown || shown === message.mes) return null;
    // The original shown beside its translation already has its own buttons.
    if (container.querySelector(".original_text")) return null;
    const written = withoutVoiceTags(message.mes);
    const source =
      typeof context.substituteParams === "function"
        ? context.substituteParams(written, context.name1, message.name)
        : written;
    const segments = extractSegments(source, this.config.reading);
    if (!segments.length) return null;
    // A detached copy of the message: its text for the analysis, a button per source line.
    const host = document.createElement("div");
    host.className = "mes_text";
    host.textContent = source;
    segments.forEach((segment, index) =>
      host.append(this.createButtonGroup(segment.text, messageId, index, segment.kind)),
    );
    return { host, source, buttons: [...host.querySelectorAll(".sv-play-btn")] };
  },

  /**
   * Plays the lines in order with a short breath between: `made[i]` resolves once line i is ready
   * or left out. So that a slow voice doesn't leave a gap mid-scene, it starts once the first few
   * lines are made, and when it catches up with the making it waits for a couple more.
   * `onLine(i, waiting)` reports progress. False when stopped (the place is kept in
   * `state.position` for 이어 듣기).
   */
  async playMessageLines(buttons, state, made = null, onLine = null) {
    const first = state.position || 0;
    for (let index = first; index < buttons.length; index++) {
      if (state.stopped) return false;
      state.position = index;
      const button = buttons[index];
      const ahead = index === first ? PREPARE_AHEAD : button.dataset.status !== "ready" ? CATCH_UP_AHEAD : 0;
      if (made && ahead) {
        if (buttons.slice(index, index + ahead).some((line) => line.dataset.status !== "ready"))
          onLine?.(index, true);
        await Promise.all(made.slice(index, index + ahead));
        // Stopped, or this line failed to be made: 이어 듣기 starts again from it.
        if (state.stopped || state.haltAt === index) return false;
      }
      if (button.dataset.status !== "ready" || !button.dataset.audioUrl) continue;
      onLine?.(index, false);
      if (this.currentPlayButton === button) this.stopPlayback();
      const finished = await new Promise((resolve) =>
        this.playLine(button, {
          onEnded: () => resolve(true),
          onStop: () => resolve(false),
        }),
      );
      if (!finished) return false;
      // Heard to the end: 이어 듣기 goes on with the next line.
      state.position = index + 1;
      if (state.stopped) return false;
      if (index + 1 < buttons.length) await new Promise((resolve) => setTimeout(resolve, 380));
    }
    state.position = 0;
    return true;
  },

  /**
   * 음성 준비: makes the message's lines in order (one request at a time, in the generation
   * queue) while they play in order outside it: the first line sounds as soon as it is made.
   * Pressed again it stops both; afterwards it reads 이어 듣기 (from where it stopped) or 다시 듣기.
   */
  queueMessageGeneration(container, control) {
    const current = this.messageJobs.get(control);
    if (current) {
      current.cancelled = true;
      // A request on its way (the analysis can take minutes) is let go of at once.
      current.stop.abort(new DOMException("멈춤", "AbortError"));
      if (current.playback) {
        current.playback.stopped = true;
        this.stopPlayback();
      }
      this.setGenerateLabel(control, "재생");
      control.classList.remove("sv-queued");
      control.disabled = true;
      control.title = "멈추는 중입니다. 이미 만든 음성은 남습니다.";
      return;
    }
    const operation = this.captureChat();
    const source = this.sourceLineButtons(container);
    const buttons = source ? source.buttons : [...container.querySelectorAll(".sv-play-btn")];
    this.messagePlayback ||= new WeakMap();
    const playback = this.messagePlayback.get(control) || { position: 0 };
    playback.stopped = false;
    playback.haltAt = -1;
    this.messagePlayback.set(control, playback);
    const job = {
      stop: new AbortController(),
      cancelled: false,
      playback: null,
      keys: buttons.map((button) => this.lineIdentity(button)),
    };
    this.messageJobs.set(control, job);
    this.syncMultiCast?.();
    const tools = this.messageTools(control);
    for (const tool of tools) tool.disabled = true;
    this.setGenerateLabel(control, "준비중");
    control.title = "생성 대기 중 · 누르면 멈춥니다.";
    control.classList.add("sv-queued");
    const messageId = Number(container.closest(".mes")?.getAttribute("mesid"));
    const sourceText = () =>
      withoutVoiceTags(window.SillyTavern?.getContext?.()?.chat?.[messageId]?.mes);
    const startedFrom = sourceText();
    const valid = () => {
      this.assertChat(operation);
      if (sourceText() !== startedFrom || !container.isConnected)
        throw new DOMException("메시지가 변경되었습니다.", "AbortError");
      // Same words, drawn again (a translation arriving, another extension updating it): the
      // work starts over on the new drawing, keeping what was made and heard.
      if (
        !source &&
        buttons.some((button, i) => !button.isConnected || this.lineIdentity(button) !== job.keys[i])
      ) {
        job.redrawn = true;
        throw new DOMException("메시지가 다시 그려졌습니다.", "AbortError");
      }
    };
    // One promise per line, settled when the line is made, left out or the work stopped.
    const settle = [];
    const made = buttons.map(
      (_, index) =>
        new Promise((resolve) => {
          settle[index] = resolve;
        }),
    );
    const settleAll = () => settle.forEach((resolve) => resolve());
    const prepared = (this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        valid();
        await this.hydrateLines(source ? source.host : container);
        // Lines whose speaker is uncertain are left for the user; the rest are still prepared.
        let skipped = 0;
        // People without a voice of their own are left out once anyone has one.
        let unvoiced = 0;
        for (const [index, button] of buttons.entries()) {
          valid();
          if (job.cancelled) break;
          if (button.dataset.status !== "ready") {
            const result = await this.generateForButton(button, {
              autoplay: false,
              skipUncertain: true,
              skipUnvoiced: true,
              signal: job.stop.signal,
            });
            if (result === "unvoiced") unvoiced++;
            else if (result === "skipped") skipped++;
            else if (!result) {
              job.failed = true;
              playback.haltAt = index;
              break;
            }
          }
          settle[index]();
        }
        // No notice: a line left out keeps its own button, whose title says why.
        job.skipped = skipped;
        job.unvoiced = unvoiced;
        return !job.cancelled && !job.failed;
      })
      .finally(settleAll));
    // The lines play in order as they become ready (outside the generation queue).
    job.playback = playback;
    const total = buttons.length;
    const playing = this.playMessageLines(buttons, playback, made, (index, waiting) => {
      control.classList.toggle("sv-queued", waiting);
      this.setGenerateLabel(control, waiting ? "준비중" : "정지");
      control.title = `${waiting ? `${index + 1}/${total} 준비 중` : `${index + 1}/${total} 재생 중`} · 누르면 만들기와 재생을 멈춥니다. 이미 만든 음성은 남습니다.`;
    });
    Promise.all([prepared, playing])
      .catch((error) => {
        playback.stopped = true;
        if (error.name !== "AbortError") this.notify(error.message, "error");
        // Redrawn with the same words: once the line playing now ends, go on from the next one
        // with the new drawing's buttons (the made voices come back to them).
        if (job.redrawn)
          playing.finally(() =>
            setTimeout(() => {
              if (control.isConnected && container.isConnected && !this.messageJobs.has(control))
                this.queueMessageGeneration(container, control);
            }, 300),
          );
      })
      .finally(() => {
        if (this.messageJobs.get(control) !== job) return;
        this.messageJobs.delete(control);
        this.syncMultiCast?.();
        control.classList.remove("sv-queued");
        for (const tool of tools) {
          tool.disabled = false;
          tool.hidden = false;
        }
        // Heard to the end (lines left out along the way included): 재생 from the start.
        const resume = playback.position > 0 || job.failed || job.cancelled;
        control.disabled = false;
        this.setGenerateLabel(control, "재생");
        control.title = resume
          ? "남은 대사를 만들고 멈춘 곳부터 이어서 들려줍니다."
          : `이 메시지의 대사를 처음부터 다시 들려줍니다. 만든 음성은 다시 만들지 않습니다.${job.skipped || job.unvoiced ? " 건너뛴 대사는 화자를 고르거나 목소리를 정한 뒤 다시 들으면 만듭니다." : ""}`;
      });
  },
  /**
   * 새 답변 자동 재생: a reply that just arrived gets its 음성 준비 pressed once its buttons are
   * there. Older messages are never read by themselves, nor anything during a call.
   */
  scheduleAutoPlay(messageId) {
    if (
      !this.chatVoiceOn() ||
      this.config.playback?.prepare === false ||
      !this.config.playback?.auto_new ||
      // Another extension asked to hold it (SceneVoiceAPI.holdAutoPlay).
      this.publicHolds?.size
    )
      return;
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const index = Number(messageId);
    const message = chat[index];
    if (!message || message.is_user || message.is_system || index !== chat.length - 1) return;
    clearTimeout(this.autoPlayTimer);
    const started = Date.now();
    const tryStart = () => {
      if (this.phoneSession?.status === "active") return;
      const element = document.querySelector(`#chat .mes[mesid="${index}"]`);
      const control = element?.querySelector(".sv-message-generate");
      const container = element?.querySelector(".mes_text");
      if (control && container) {
        if (!this.messageJobs.has(control)) this.queueMessageGeneration(container, control);
        return;
      }
      // Its buttons come a moment after the message (or never, when it has nothing to read).
      if (Date.now() - started < 4000) this.autoPlayTimer = setTimeout(tryStart, 300);
    };
    this.autoPlayTimer = setTimeout(tryStart, 400);
  },

  clearMessageJobs() {
    for (const [control, job] of this.messageJobs) {
      job.cancelled = true;
      // Its lines stop playing too (also between two lines, when nothing is sounding).
      if (job.playback) job.playback.stopped = true;
      control.classList.remove("sv-queued");
      control.disabled = false;
      this.setGenerateLabel(control, "음성");
    }
    this.messageJobs.clear();
    this.syncMultiCast?.();
  },
};
