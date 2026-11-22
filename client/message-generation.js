// 음성 준비: makes a message's lines one by one and plays them in order, starting as soon as
// the first is ready (the next ones are made while one plays).
import { extractSegments } from "../shared/segments.js";
import { withoutVoiceTags, stOf } from "./common.js";

// Lines made before 음성 준비 starts to play, and again when playing catches up with the making.
const PREPARE_AHEAD = 3;
const CATCH_UP_AHEAD = 2;

// The message button is an icon button like 실리태번's own (the theme sizes and colours it like
// the pencil), so its state is its icon: idle (nothing made yet), play (made: from the start, or
// on from where it stopped), waiting (voices being made), stop (playing: a press stops).
const GENERATE_STATES = {
  idle: ["fa-wave-square", "이어 듣기 (음성 만들며 듣기)"],
  play: ["fa-play", "이어 듣기"],
  waiting: ["fa-hourglass-half", "이어 듣기 준비 중 · 멈추기"],
  stop: ["fa-stop", "이어 듣기 멈추기"],
};

/**
 * A message button in 실리태번's own form: a div carrying its icon class, clicked by Enter too.
 * Its title stays a short name like 실리태번's own: other extensions list the buttons by it.
 */
function messageButton(name, icon, title, onClick) {
  const button = document.createElement("div");
  button.className = `mes_button ${name} fa-solid ${icon}`;
  button.dataset.icon = icon;
  button.tabIndex = 0;
  button.setAttribute("role", "button");
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!button.classList.contains("disabled")) onClick();
  });
  return button;
}

/** 실리태번 leaves a `disabled` button out of the tab order and of its Enter-to-click. */
function setDisabled(button, disabled) {
  button.classList.toggle("disabled", disabled);
  button.setAttribute("aria-disabled", String(disabled));
}

export const messageGeneration = {
  messageJobs: new Map(),
  setGenerateState(control, state) {
    const [icon, label] = GENERATE_STATES[state];
    control.classList.remove(control.dataset.icon);
    control.classList.add(icon);
    control.dataset.icon = icon;
    control.dataset.state = state;
    control.setAttribute("aria-label", label);
  },
  decorateMessageGeneration(container) {
    if (this.config.playback?.prepare === false) return;
    const message = container.closest(".mes,.message-body");
    if (!message) return;
    const existing = message.querySelector(".sv-message-generate");
    const lines = Boolean(container.querySelector(".sv-play-btn"));
    // The button row stays through a swipe or an edit: the button follows the text shown now.
    const print = this.anchorFingerprint?.(message.getAttribute("mesid")) || "";
    if (
      existing &&
      existing.dataset.print !== print &&
      !this.messageJobs.has(existing)
    ) {
      if (!lines) {
        this.messageTools(existing).forEach((tool) => tool.remove());
        existing.remove();
        return;
      }
      existing.dataset.print = print;
      this.messagePlayback?.delete(existing);
      this.setGenerateState(existing, "idle");
      existing.title = existing.dataset.firstTitle || existing.title;
      for (const tool of this.messageTools(existing)) tool.hidden = true;
    }
    if (!lines || existing) return;
    const button = messageButton(
      "sv-message-generate",
      GENERATE_STATES.idle[0],
      "이어 듣기",
      () => this.queueMessageGeneration(container, button),
    );
    button.dataset.print = print;
    button.dataset.firstTitle = button.title;
    this.setGenerateState(button, "idle");
    // 분석 보기: shown once the message has been prepared (or has made voices). It opens the
    // message's lines with their analysis; nothing is asked of the model until it is told to.
    const again = messageButton(
      "sv-message-tool sv-message-reanalyze",
      "fa-wand-magic-sparkles",
      "분석 보기",
      () => this.run(() => this.openMessageAnalysis(container, button)),
    );
    again.hidden = !container.querySelector(
      '.sv-play-btn[data-status="ready"]',
    );
    button.svTools = [again];
    this.placeMessageButtons(message, button);
  },

  /** A pressed tool spins until its work is done, so a press never looks ignored. */
  async withBusyTool(tool, work) {
    if (tool.classList.contains("sv-busy")) return;
    tool.classList.add("sv-busy", "fa-spinner", "fa-spin");
    tool.classList.remove(tool.dataset.icon);
    try {
      return await work();
    } finally {
      tool.classList.remove("sv-busy", "fa-spinner", "fa-spin");
      tool.classList.add(tool.dataset.icon);
    }
  },

  /** 분석 보기 shows for a message with voices made (on screen, or its source lines). */
  async revealMessageTools(container) {
    const control = container
      .closest(".mes,.message-body")
      ?.querySelector(".sv-message-generate");
    const tools = this.messageTools(control);
    if (!tools.some((tool) => tool.hidden)) return;
    const source = this.sourceLineButtons(container);
    if (source) await this.hydrateLines(source.host);
    const lines = source
      ? source.buttons
      : [...container.querySelectorAll(".sv-play-btn")];
    const voiced = lines.some((line) => line.dataset.status === "ready");
    // An analysis kept for the message as it is written now shows the button too, voices or not.
    const analysed =
      !voiced &&
      lines.length > 0 &&
      Boolean(
        this.lineState?.analysed?.has(
          this.messageAnalysisKey(lines[0], this.collectMessageBatch(lines[0])),
        ),
      );
    if (!voiced && !analysed) return;
    for (const tool of tools) tool.hidden = false;
    // Voices made on an earlier visit: the button plays them.
    if (
      voiced &&
      !this.messageJobs.has(control) &&
      control.dataset.state === "idle"
    )
      this.setGenerateState(control, "play");
  },

  /** The tools of a message's 음성 준비 (분석 보기; 내려받기 is inside it). */
  messageTools(control) {
    return control?.svTools || [];
  },

  /**
   * 내려받기: the message's made voices joined in reading order, with the short breath played
   * between them, as one WAV file. Lines not made yet are left out (and counted).
   */
  /** The message's made voices as one file, in reading order (`buttons`: its lines). */
  async downloadMessageAudio(container, buttons = null) {
    if (!buttons) {
      const source = this.sourceLineButtons(container);
      buttons = source
        ? source.buttons
        : [...container.querySelectorAll(".sv-play-btn")];
      await this.hydrateLines(source ? source.host : container);
    }
    const ready = buttons.filter(
      (line) => line.dataset.status === "ready" && line.dataset.audioUrl,
    );
    if (!ready.length)
      throw new Error(
        "내려받을 음성이 없습니다. 먼저 메시지의 이어 듣기 버튼으로 만들어 주십시오.",
      );
    const messageId = container.closest(".mes")?.getAttribute("mesid") || "";
    await this.downloadJoinedAudio(
      ready.map((line) => ({ url: line.dataset.audioUrl })),
      `${this.getCurrentCharacterProfile?.().name || "scenevoice"}-${messageId}`,
      { gap: 0.38, rate: 44100 },
    );
  },

  /** One line's voice as a file of its own (it has to be made first). */
  async downloadLineAudio(button) {
    if (button.dataset.status !== "ready" || !button.dataset.audioUrl)
      throw new Error(
        "이 대사의 음성이 아직 없습니다. 먼저 재생 버튼으로 만들어 주십시오.",
      );
    await this.downloadJoinedAudio(
      [{ url: button.dataset.audioUrl }],
      `${this.getCurrentCharacterProfile?.().name || "scenevoice"}-${button.dataset.messageId || ""}-${Number(button.dataset.quoteIndex || 0) + 1}`,
      { gap: 0, rate: 44100 },
    );
  },

  /**
   * With a translation on screen (a translation extension shows message.extra.display_text and keeps
   * the source in message.mes), 음성 준비 reads the source text: its lines, off screen.
   */
  sourceLineButtons(container) {
    const messageId = container.closest(".mes")?.getAttribute("mesid");
    const context = stOf(this) || {};
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
      host.append(
        this.createButtonGroup(segment.text, messageId, index, segment.kind),
      ),
    );
    return {
      host,
      source,
      buttons: [...host.querySelectorAll(".sv-play-btn")],
    };
  },

  /**
   * Plays the lines in order with a short breath between: `made[i]` resolves once line i is ready
   * or left out. So that a slow voice doesn't leave a gap mid-scene, it starts once the first few
   * lines are made, and when it catches up with the making it waits for a couple more.
   * `onLine(i, waiting)` reports progress. False when stopped (the place is kept in
   * `state.position` for 이어 듣기). The caption strip's ‹ › move it to another line (`run.jump`).
   */
  async playMessageLines(buttons, state, made = null, onLine = null) {
    const first = state.position || 0;
    const run = (this.messageRun = {
      state,
      buttons,
      jump: null,
      wake: null,
      between: false,
    });
    // A wait that ‹ › end as well.
    const orJump = (wait) =>
      Promise.race([
        wait,
        new Promise((resolve) => {
          run.wake = resolve;
        }),
      ]);
    const playable = (button) =>
      button.dataset.status === "ready" && button.dataset.audioUrl;
    try {
      let index = first;
      while (index < buttons.length) {
        if (state.stopped) return false;
        if (run.jump !== null) {
          index = run.jump;
          run.jump = null;
        }
        state.position = index;
        this.syncLineSteps();
        const button = buttons[index];
        const ahead =
          index === first
            ? PREPARE_AHEAD
            : !playable(button)
              ? CATCH_UP_AHEAD
              : 0;
        if (made && ahead) {
          if (
            buttons
              .slice(index, index + ahead)
              .some((line) => line.dataset.status !== "ready")
          ) {
            onLine?.(index, true);
            this.showNowWaiting?.(button);
          }
          await orJump(Promise.all(made.slice(index, index + ahead)));
          this.endNowWaiting?.();
          if (state.stopped) return false;
          if (run.jump !== null) continue;
          // The making stopped at this line or before it: 이어 듣기 starts again from here.
          if (state.haltAt >= 0 && index >= state.haltAt && !playable(button))
            return false;
        }
        if (!playable(button)) {
          index++;
          continue;
        }
        onLine?.(index, false);
        if (this.currentPlayButton === button) this.stopPlayback();
        const finished = await new Promise((resolve) =>
          this.playLine(button, {
            onEnded: () => resolve(true),
            onStop: () => resolve(false),
          }),
        );
        if (run.jump !== null && !state.stopped) continue;
        if (!finished) return false;
        // Heard to the end: 이어 듣기 goes on with the next line.
        state.position = index + 1;
        if (state.stopped) return false;
        if (index + 1 < buttons.length) {
          run.between = true;
          await orJump(new Promise((resolve) => setTimeout(resolve, 380)));
          run.between = false;
        }
        if (run.jump === null) index++;
      }
      state.position = 0;
      return true;
    } finally {
      if (this.messageRun === run) this.messageRun = null;
      this.endNowWaiting?.(true);
      this.syncLineSteps();
    }
  },

  /**
   * ‹ (-1) or › (+1) on the caption strip, while a message's lines play in a row: the line with
   * a voice before the one playing (the same one again at the first), or the next line.
   */
  stepMessageLine(step) {
    const run = this.messageRun;
    if (!run || run.state.stopped) return false;
    const { buttons } = run;
    const now = run.state.position;
    // In the breath between two lines the next one is already the place: › just ends the breath.
    let target = step > 0 && run.between ? now : now + step;
    if (step < 0) {
      while (target >= 0 && buttons[target].dataset.status !== "ready")
        target--;
      if (target < 0) target = now;
    } else if (target >= buttons.length) return false;
    run.jump = target;
    run.wake?.();
    const to = buttons[target];
    // A line with its voice ready takes over without a gap; otherwise the sound stops first.
    if (
      target !== now &&
      to.dataset.status === "ready" &&
      this.currentAudioStop
    ) {
      const stopped = this.currentAudioStop;
      this.currentAudioStop = null;
      stopped();
    } else if (this.currentAudio) this.stopPlayback();
    return true;
  },

  /**
   * 음성 준비: makes the message's lines in order (one request at a time, in the generation
   * queue) while they play in order outside it: the first line sounds as soon as it is made.
   * Pressed again it stops both; afterwards it reads 이어 듣기 (from where it stopped) or 다시 듣기.
   * `silent`: the lines are only made (새 답변 자동 음성 생성); nothing plays until it is pressed.
   */
  queueMessageGeneration(container, control, { silent = false } = {}) {
    const current = this.messageJobs.get(control);
    if (current) {
      current.cancelled = true;
      // A request on its way (the analysis can take minutes) is let go of at once.
      current.stop.abort(new DOMException("멈춤", "AbortError"));
      if (current.playback) {
        current.playback.stopped = true;
        this.stopPlayback();
      }
      this.setGenerateState(control, "play");
      control.classList.remove("sv-queued");
      setDisabled(control, true);
      control.title = "멈추는 중입니다. 이미 만든 음성은 남습니다.";
      return;
    }
    const operation = this.captureChat();
    const source = this.sourceLineButtons(container);
    const buttons = source
      ? source.buttons
      : [...container.querySelectorAll(".sv-play-btn")];
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
    for (const tool of tools) setDisabled(tool, true);
    this.setGenerateState(control, "waiting");
    control.title = "생성 대기 중 · 누르면 멈춥니다.";
    control.classList.add("sv-queued");
    const messageId = Number(container.closest(".mes")?.getAttribute("mesid"));
    const sourceText = () =>
      withoutVoiceTags(stOf(this)?.chat?.[messageId]?.mes);
    const startedFrom = sourceText();
    const valid = () => {
      this.assertChat(operation);
      if (sourceText() !== startedFrom || !container.isConnected)
        throw new DOMException("메시지가 변경되었습니다.", "AbortError");
      // Same words, drawn again (a translation arriving, another extension updating it): the
      // work starts over on the new drawing, keeping what was made and heard.
      if (
        !source &&
        buttons.some(
          (button, i) =>
            !button.isConnected || this.lineIdentity(button) !== job.keys[i],
        )
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
    if (!silent) job.playback = playback;
    const total = buttons.length;
    if (silent)
      control.title =
        "음성 만드는 중 · 누르면 멈춥니다. 이미 만든 음성은 남습니다.";
    const playing = silent
      ? prepared.then(
          () => undefined,
          () => undefined,
        )
      : this.playMessageLines(buttons, playback, made, (index, waiting) => {
          control.classList.toggle("sv-queued", waiting);
          this.setGenerateState(control, waiting ? "waiting" : "stop");
          control.title = `${waiting ? `${index + 1}/${total} 준비 중` : `${index + 1}/${total} 재생 중`} · 누르면 만들기와 재생을 멈춥니다. 이미 만든 음성은 남습니다.`;
        });
    Promise.all([prepared, playing])
      .catch((error) => {
        playback.stopped = true;
        if (error.name === "AnalysisFailedError")
          this.notifyAnalysisFailed(error, () => {
            if (
              control.isConnected &&
              container.isConnected &&
              !this.messageJobs.has(control)
            )
              this.queueMessageGeneration(container, control, { silent });
          });
        else if (error.name !== "AbortError")
          this.notify(error.message, "error");
        // Redrawn with the same words: once the line playing now ends, go on from the next one
        // with the new drawing's buttons (the made voices come back to them).
        if (job.redrawn)
          playing.finally(() =>
            setTimeout(() => {
              if (
                control.isConnected &&
                container.isConnected &&
                !this.messageJobs.has(control)
              )
                this.queueMessageGeneration(container, control, { silent });
            }, 300),
          );
      })
      .finally(() => {
        if (this.messageJobs.get(control) !== job) return;
        this.messageJobs.delete(control);
        this.syncMultiCast?.();
        control.classList.remove("sv-queued");
        for (const tool of tools) {
          setDisabled(tool, false);
          tool.hidden = false;
        }
        // Heard to the end (lines left out along the way included): 재생 from the start.
        const resume = playback.position > 0 || job.failed || job.cancelled;
        setDisabled(control, false);
        this.setGenerateState(control, "play");
        control.title = resume
          ? "남은 대사를 만들고 멈춘 곳부터 이어서 들려줍니다."
          : `이 메시지의 대사를 처음부터 다시 들려줍니다. 만든 음성은 다시 만들지 않습니다.${job.skipped || job.unvoiced ? " 건너뛴 대사는 화자를 고르거나 목소리를 정한 뒤 다시 들으면 만듭니다." : ""}`;
      });
  },
  /**
   * 새 답변 자동 음성 생성: a reply that just arrived gets its lines made once its buttons are
   * there (made only: they play when the user presses). Older messages are never read by themselves, nor anything during a call.
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
    const chat = stOf(this)?.chat || [];
    const index = Number(messageId);
    const message = chat[index];
    if (
      !message ||
      message.is_user ||
      message.is_system ||
      index !== chat.length - 1
    )
      return;
    clearTimeout(this.autoPlayTimer);
    const started = Date.now();
    const tryStart = () => {
      if (this.phoneSession?.status === "active") return;
      const element = document.querySelector(`#chat .mes[mesid="${index}"]`);
      const control = element?.querySelector(".sv-message-generate");
      const container = element?.querySelector(".mes_text");
      if (control && container) {
        if (!this.messageJobs.has(control))
          this.queueMessageGeneration(container, control, { silent: true });
        return;
      }
      // Its buttons come a moment after the message (or never, when it has nothing to read).
      if (Date.now() - started < 4000)
        this.autoPlayTimer = setTimeout(tryStart, 300);
    };
    this.autoPlayTimer = setTimeout(tryStart, 400);
  },

  clearMessageJobs() {
    for (const [control, job] of this.messageJobs) {
      job.cancelled = true;
      // Its lines stop playing too (also between two lines, when nothing is sounding).
      if (job.playback) job.playback.stopped = true;
      control.classList.remove("sv-queued");
      for (const button of [control, ...this.messageTools(control)])
        setDisabled(button, false);
      this.setGenerateState(control, "idle");
    }
    this.messageJobs.clear();
    this.syncMultiCast?.();
  },
};
