// 채팅 대사 버튼: finds the lines to read in each chat message, puts play buttons on them and
// makes each line's voice.
import { contentKey } from "../shared/hash.js";
import { extractSegments } from "../shared/segments.js";
import {
  stripMarkup,
  clamp,
  simpleHash,
  normalizeTags,
  tagsText,
  withoutVoiceTags,
} from "./common.js";

// Elements this extension puts into the chat. Changes inside them, or the insertion of them,
// are our own and need no new look at the message.
const OWN =
  ".sv-inline-actions, .sv-utterance, .sv-chat-memory, .sv-message-generate, .sv-message-tool";

export const dialogue = {
  bindEvents() {
    document.addEventListener(
      "click",
      (event) => {
        const memoryAction = event.target.closest("[data-sv-memory-action]");
        if (memoryAction) {
          event.preventDefault();
          event.stopPropagation();
          this.run(() => this.handleChatMemoryAction(memoryAction));
          return;
        }

        const launcher = event.target.closest(
          "#sv-extension-menu-item",
        );
        if (launcher) {
          event.preventDefault();
          this.run(() => this.openPanel());
          return;
        }

        const playButton = event.target.closest(".sv-play-btn");
        if (playButton) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey)
            this.run(() => this.withBusyButton(playButton, () => this.reanalyzeButton(playButton)));
          else this.handlePlayClick(playButton);
          return;
        }

        const moreButton = event.target.closest(".sv-more-btn");
        if (moreButton) {
          event.preventDefault();
          event.stopPropagation();
          this.toggleLineActions(moreButton.closest(".sv-inline-actions"));
          return;
        }

        const editButton = event.target.closest(".sv-edit-btn");
        if (editButton) {
          event.preventDefault();
          event.stopPropagation();
          const play = editButton
            .closest(".sv-inline-actions")
            ?.querySelector(".sv-play-btn");
          if (play) this.run(() => this.editLine(play));
          return;
        }
        const rerollButton = event.target.closest(".sv-reroll-btn");
        if (rerollButton) {
          event.preventDefault();
          event.stopPropagation();
          const playButton = rerollButton
            .closest(".sv-inline-actions")
            ?.querySelector(".sv-play-btn");
          if (playButton)
            this.run(() => this.withBusyButton(rerollButton, () => this.handleRerollClick(playButton)));
          return;
        }

        const historyPlay = event.target.closest(".sv-history-play");
        if (historyPlay) {
          event.preventDefault();
          this.playAudio(this.apiUrl(historyPlay.dataset.url), historyPlay);
          return;
        }

        const historyDelete = event.target.closest(".sv-history-delete");
        if (historyDelete) {
          event.preventDefault();
          this.run(() => this.deleteHistory(historyDelete.dataset.id));
          return;
        }

        const historyFavorite = event.target.closest(".sv-history-favorite");
        if (historyFavorite) {
          event.preventDefault();
          this.run(() => this.addFavorite(historyFavorite.dataset.id));
          return;
        }

        const favoriteDelete = event.target.closest(".sv-favorite-delete");
        if (favoriteDelete) {
          event.preventDefault();
          this.run(() => this.deleteFavorite(favoriteDelete.dataset.id));
        }
      },
      { signal: this.lifetimeController.signal },
    );
    // A missing card thumbnail falls back to the person icon instead of a broken image.
    document.addEventListener(
      "error",
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const avatar = image.closest(".sv-phone-avatar");
        if (!avatar) return;
        image.remove();
        avatar.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>';
        avatar
          .closest(".sv-has-wall")
          ?.classList.remove("sv-has-wall");
      },
      { capture: true, signal: this.lifetimeController.signal },
    );
    if (!this.chatMemoryEventsBound) {
      const context = window.SillyTavern?.getContext?.() || {};
      const events = context.eventTypes || context.event_types || {};
      const source = context.eventSource;
      const refreshEvents = [
        events.APP_READY,
        events.CHAT_CHANGED,
        events.MESSAGE_RECEIVED,
        events.GENERATION_ENDED,
        events.MESSAGE_EDITED,
        events.MESSAGE_UPDATED,
        events.MESSAGE_DELETED,
        events.MESSAGE_SWIPED,
        events.MORE_MESSAGES_LOADED,
        events.USER_MESSAGE_RENDERED,
        events.CHARACTER_MESSAGE_RENDERED,
      ].filter(Boolean);
      if (source?.on) {
        // Events that change which version of the chat is shown reset its work and look at every
        // message again; the others name one message, and only that one is looked at.
        const resetting = [
          events.CHAT_CHANGED,
          events.MESSAGE_EDITED,
          events.MESSAGE_DELETED,
          events.MESSAGE_SWIPED,
        ];
        const oneMessage = [
          events.MESSAGE_RECEIVED,
          events.MESSAGE_UPDATED,
          events.USER_MESSAGE_RENDERED,
          events.CHARACTER_MESSAGE_RENDERED,
        ];
        [...new Set(refreshEvents)].forEach((eventName) => {
          const handler = (messageId) => {
            // Switched off: only which chat is open is kept track of.
            if (!this.isActive()) {
              if (resetting.includes(eventName)) {
                this.resetChat();
                this.captureChat();
              }
              return;
            }
            if (resetting.includes(eventName)) {
              this.resetChat();
              this.captureChat();
              this.run(() => this.restorePhoneSession());
            }
            if (eventName === events.CHAT_CHANGED) this.run(() => this.syncMultiCastCast?.());
            if ([events.MESSAGE_RECEIVED, events.GENERATION_ENDED].includes(eventName))
              this.generatingSince = 0;
            this.scheduleChatMemoryRefresh();
            const index = Number(messageId);
            this.scheduleScan(
              oneMessage.includes(eventName) && Number.isInteger(index) && index >= 0 ? index : null,
            );
            if (
              [
                events.CHAT_CHANGED,
                events.MESSAGE_RECEIVED,
                events.GENERATION_ENDED,
                events.MESSAGE_EDITED,
                events.MESSAGE_SWIPED,
              ].includes(eventName)
            )
              this.scheduleStateTracking();
            // Rooms where the members talk among themselves may pick up after a reply, and a
            // new message may be analysed ahead of time.
            if (eventName === events.MESSAGE_RECEIVED) {
              this.run(() => this.groupAutoChatTick?.());
              this.scheduleAutoAnalysis();
              this.scheduleAutoPlay(messageId);
            }
          };
          source.on(eventName, handler);
          this.eventCleanups.push(() =>
            source.removeListener
              ? source.removeListener(eventName, handler)
              : source.off?.(eventName, handler),
          );
        });
        // While a reply streams in, its message is left alone (it is rewritten on every token);
        // a dry run (token counting) is not a reply.
        const generating = (type, options, dryRun) => {
          if (!dryRun) this.generatingSince = Date.now();
        };
        const stopped = () => {
          this.generatingSince = 0;
          this.scheduleScan(null);
        };
        // A bot card renamed in 실리태번 gets a new file (and key): its records follow it.
        const renamed = (oldAvatar, newAvatar) =>
          this.run(async () => {
            if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;
            const moved = await this.relinkCard(`character:${oldAvatar}`, `character:${newAvatar}`);
            if (moved) this.notify("봇카드 이름이 바뀌어, 씬보이스 기록을 새 이름으로 옮겼습니다.", "success");
          });
        for (const [eventName, listener] of [
          [events.GENERATION_STARTED, generating],
          [events.GENERATION_STOPPED, stopped],
          [events.CHARACTER_RENAMED, renamed],
        ]) {
          if (!eventName) continue;
          source.on(eventName, listener);
          this.eventCleanups.push(() =>
            source.removeListener
              ? source.removeListener(eventName, listener)
              : source.off?.(eventName, listener),
          );
        }
        // Right before a reply (or a new swipe) is written, the chat records are synced at once:
        // the swipe being replaced must not pass its call or text records to the new one.
        for (const eventName of new Set(
          [events.GENERATION_STARTED, events.GENERATION_AFTER_COMMANDS].filter(Boolean),
        )) {
          const sync = () => this.syncChatMemoryPrompts();
          source.on(eventName, sync);
          this.eventCleanups.push(() =>
            source.removeListener
              ? source.removeListener(eventName, sync)
              : source.off?.(eventName, sync),
          );
        }
        this.chatMemoryEventsBound = true;
      }
    }
  },

  /** Line buttons shown or hidden (대사 옆 재생 버튼); 음성 준비 reads them either way. */
  applyChatDisplay() {
    document.body.classList.toggle(
      "sv-hide-line-buttons",
      this.chatVoiceOn() && this.config.playback?.line_buttons === false,
    );
  },

  /** Watches the chat for messages added or redrawn, and looks at just those messages. */
  startObserver() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (!mutation.addedNodes.length) continue;
        const target =
          mutation.target.nodeType === Node.ELEMENT_NODE
            ? mutation.target
            : mutation.target.parentElement;
        const added = [...mutation.addedNodes];
        // Our buttons, wrappers and records going in (or changing inside) are no news.
        if (
          target?.closest(OWN) ||
          added.some((node) => node.nodeType === Node.ELEMENT_NODE && node.matches(OWN))
        )
          continue;
        const message = target?.closest(".mes");
        if (message) {
          this.scheduleScan(message, 30);
          continue;
        }
        let found = false;
        for (const node of added) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          for (const item of node.matches(".mes") ? [node] : node.querySelectorAll(".mes")) {
            this.scheduleScan(item);
            found = true;
          }
        }
        // Outside the usual message layout (other front ends): look at everything.
        if (!found && target?.closest(".markdown-content, .message-body")) this.scheduleScan(null);
      }
    });
    this.observer.observe(document.getElementById("chat") || document.body, {
      childList: true,
      subtree: true,
    });
  },

  /**
   * Asks for a look at the chat shortly (bursts of changes are folded together). `target`: a
   * message element or index for just that message; null (default) for every message.
   */
  scheduleScan(target = null, delay = 120) {
    if (target === null) this.scanAll = true;
    else (this.scanTargets ||= new Set()).add(target);
    // A look already due as soon is not put off by more changes (a burst of them would keep the
    // buttons away while another extension redraws message after message).
    const due = Date.now() + delay;
    if (this.scanTimer && this.scanDue <= due) return;
    clearTimeout(this.scanTimer);
    this.scanDue = due;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.scan();
    }, delay);
  },

  scan() {
    const all = this.scanAll || !this.scanTargets?.size;
    const targets = all ? [] : [...this.scanTargets];
    this.scanAll = false;
    this.scanTargets?.clear();
    let containers;
    let messages = null;
    if (all) {
      containers = Array.from(document.querySelectorAll(".mes_text"));
      if (containers.length === 0)
        containers.push(...document.querySelectorAll(".markdown-content, .message-body"));
    } else {
      messages = [
        ...new Set(
          targets
            .map((target) =>
              typeof target === "number"
                ? document.querySelector(`#chat .mes[mesid="${target}"]`)
                : target,
            )
            .filter((message) => message?.isConnected),
        ),
      ];
      containers = messages.flatMap((message) => [...message.querySelectorAll(".mes_text")]);
    }
    if (this.chatVoiceOn()) {
      for (const container of containers) this.decorateContainer(container);
      const roots = all ? [document] : containers;
      if (roots.some((root) => root.querySelector(".sv-play-btn")))
        this.run(async () => {
          for (const root of roots) await this.hydrateLines(root);
          // Buttons drawn again (a setting switched, a redraw) come back once voices are known.
          for (const container of containers) await this.revealMessageTools?.(container);
        });
    }
    this.renderChatMemoryDecorations(messages);
  },

  /** The message a reply is streaming into right now (left alone until it is done). */
  isStreamingMessage(messageId) {
    if (!this.generatingSince || Date.now() - this.generatingSince > 180000) return false;
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    return String(messageId) === String(chat.length - 1);
  },

  decorateContainer(container) {
    if (!(container instanceof HTMLElement)) return;
    const messageElement = container.closest(".mes, .message-body");
    const messageId =
      messageElement?.getAttribute("mesid") ||
      messageElement?.dataset?.messageId ||
      simpleHash(container.textContent || "");
    if (this.isStreamingMessage(messageId)) return;
    let quoteIndex = container.querySelectorAll(".sv-play-btn").length;

    // Lines drawn by a custom chat renderer (.custom-lines, quotes already taken out) count too.
    for (const line of container.querySelectorAll(
      ".custom-lines:not([data-sv-decorated])",
    )) {
      const displayedText = stripMarkup(line.textContent || "");
      if (!displayedText) continue;
      line.dataset.svDecorated = "true";
      line.appendChild(
        this.createButtonGroup(displayedText, messageId, quoteIndex),
      );
      quoteIndex += 1;
    }

    const context = window.SillyTavern?.getContext?.() || {};
    const raw = withoutVoiceTags(context.chat?.[Number(messageId)]?.mes || "");
    // Markdown turns *…* and _…_ into emphasis and removes the marks. Only decorate emphasis
    // whose text matches a region marked that way in the message source.
    const emphasized = extractSegments(raw, this.config.reading)
      .filter((x) => /^[*_]/.test(x.marked))
      .map((x) => ({ ...x, plain: stripMarkup(x.text) }));
    // A translation shown next to the original (a translation extension's side-by-side view):
    // only the original is read, so its buttons match the message line for line.
    const skip = `.sv-utterance,.custom-lines,[data-sv-thought]${
      container.querySelector(".original_text") ? ",.translated_text" : ""
    }`;
    for (const element of container.querySelectorAll(
      "em:not([data-sv-thought]),strong:not([data-sv-thought])",
    )) {
      if (element.closest(skip)) continue;
      const text = stripMarkup(element.textContent);
      const source = emphasized.find((x) => x.plain === text);
      if (!source) continue;
      element.dataset.svThought = "true";
      element.append(
        this.createButtonGroup(text, messageId, quoteIndex++, source.kind),
      );
    }
    // Lines are read from a paragraph's text as a whole, so formatting inside a line
    // (“**Disqualified.** You're…”, “don't even *think* about it”) doesn't split it.
    const lines = [];
    for (const run of this.textRuns(container, skip)) {
      const text = run.map((node) => node.nodeValue).join("");
      const segments = extractSegments(text, this.config.reading);
      if (!segments.length) continue;
      // Where each piece of text starts in the paragraph's text.
      const starts = [];
      let offset = 0;
      for (const node of run) {
        starts.push(offset);
        offset += node.nodeValue.length;
      }
      const at = (position, ending) => {
        let index = run.length - 1;
        while (index > 0 && (ending ? starts[index] >= position : starts[index] > position)) index--;
        return [run[index], position - starts[index]];
      };
      for (const segment of segments)
        lines.push({ segment, start: at(segment.start, false), end: at(segment.end, true) });
    }
    lines.forEach((line) => (line.index = quoteIndex++));
    // From the last line back, so splitting text never moves a line still to come.
    for (const { segment, start, end, index } of lines.reverse()) {
      const group = this.createButtonGroup(segment.text, messageId, index, segment.kind);
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      const wrapper = document.createElement("span");
      wrapper.className = "sv-utterance";
      try {
        range.surroundContents(wrapper);
      } catch (_) {
        // The line begins or ends inside formatting ("Hello <em>world"</em>): the formatting is
        // split around it so the line is wrapped all the same. Left unwrapped, the next look at
        // the message would find it again and add its buttons over and over.
        wrapper.append(range.extractContents());
        range.insertNode(wrapper);
      }
      // Themes paint quotes (<q>) as a highlight; a line filling its <q> has its buttons after the
      // <q>, so the highlight stays on the words and no theme rule meets buttons inside it.
      const quote = wrapper.parentElement;
      const filled = quote?.tagName === "Q" && quote !== container &&
        !/[^\s"'“”‘’「」『』«»]/.test(quote.textContent.replace(wrapper.textContent, ""));
      if (filled) quote.after(group);
      else wrapper.append(group);
    }
    // Keep visible reading order stable, including Markdown emphasis and custom renderers.
    container.querySelectorAll(".sv-play-btn").forEach((button, index) => {
      button.dataset.quoteIndex = String(index);
    });
    this.decorateMessageGeneration(container);
  },

  /**
   * The message's text pieces, grouped into runs that read as one (a paragraph, with its
   * inline formatting and line breaks). Blocks, skipped parts and lines already decorated end a
   * run, so a quote mark is never paired across them.
   */
  textRuns(container, skip) {
    const runs = [];
    let run = [];
    const flush = () => {
      if (run.length) runs.push(run);
      run = [];
    };
    const left = `script,style,textarea,input,button,select,code,pre,.voice-bubble,.sv-inline-actions,${skip}`;
    const visit = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.nodeValue) run.push(child);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.matches(left)) {
          flush();
          continue;
        }
        // A line may go on over a line break, as it does in the message text.
        if (child.tagName === "BR") continue;
        const block = !/^(A|ABBR|B|BDI|BDO|CITE|DATA|DEL|DFN|EM|FONT|I|INS|KBD|MARK|Q|RUBY|RT|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR)$/.test(child.tagName);
        if (block) flush();
        visit(child);
        if (block) flush();
      }
    };
    visit(container);
    flush();
    return runs;
  },

  createPlayButton(spokenText, messageId, quoteIndex, kind = "dialogue") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sv-play-btn";
    this.setPlayButtonIcon(button, "waiting");
    button.title = "재생 · Shift+클릭: 분석 다시";
    button.setAttribute("aria-label", `${spokenText} 재생`);
    button.dataset.text = spokenText;
    button.dataset.kind = kind;
    button.dataset.messageId = String(messageId);
    button.dataset.quoteIndex = String(quoteIndex);
    button.dataset.key = simpleHash(`${messageId}|${quoteIndex}|${spokenText}`);
    button.dataset.status = "waiting";
    return button;
  },

  createButtonGroup(spokenText, messageId, quoteIndex, kind = "dialogue") {
    const group = document.createElement("span");
    group.className = "sv-inline-actions";
    const play = this.createPlayButton(spokenText, messageId, quoteIndex, kind);
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "sv-reroll-btn";
    reroll.title = "음성 재생성: 같은 분석으로 목소리만 새로 만듭니다";
    reroll.setAttribute("aria-label", `${spokenText} 음성 재생성`);
    reroll.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "sv-edit-btn";
    edit.title = "고치기: 화자·연기 태그 확인·수정, AI 분석 다시";
    edit.setAttribute("aria-label", "이 대사의 화자와 연기 고치기");
    edit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
    // Only play and ⋯ show by default; ⋯ reveals the rest for this line.
    const more = document.createElement("button");
    more.type = "button";
    more.className = "sv-more-btn";
    more.title = "더 보기: 음성 재생성 · 고치기 · 화자";
    more.setAttribute("aria-label", `${spokenText} 버튼 더 보기`);
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = '<i class="fa-solid fa-ellipsis" aria-hidden="true"></i>';
    // The speaker menu comes the first time ⋯ opens (toggleLineActions): one for every line
    // from the start would be thousands of hidden options in a long chat.
    group.append(play, more, reroll, edit);
    // Hidden at once when the speaker is already known: the message's author reads it.
    const author = this.messageSpeaker(play).key;
    if (
      author === "user" ||
      !this.config.casting?.auto_enabled ||
      this.config.character_voices?.[author]?.single_voice
    )
      this.applyLineVisibility(play, author);
    return group;
  },

  /**
   * 새 메시지 바로 분석: once the newest AI message has its buttons, its lines are analysed (one
   * request for the whole message, kept for later). No audio is made.
   */
  scheduleAutoAnalysis() {
    if (!this.config.llm?.auto_analyze || !this.chatVoiceOn()) return;
    clearTimeout(this.autoAnalysisTimer);
    this.autoAnalysisTimer = setTimeout(
      () => this.run(() => this.analyzeLatestMessage()),
      1500,
    );
  },

  async analyzeLatestMessage() {
    const context = window.SillyTavern?.getContext?.() || {};
    const index = (context.chat || []).length - 1;
    const message = context.chat?.[index];
    if (!message || message.is_user || message.is_system) return;
    const container = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    if (!container) return;
    // With a translation on screen, the source lines (what 음성 준비 reads) are analysed.
    const source = this.sourceLineButtons?.(container);
    const button = source?.buttons[0] || container.querySelector(".sv-play-btn");
    if (!button || button.dataset.status === "ready") return;
    await this.analyzeUtterance(button);
  },

  /** A line read by someone whose play buttons are switched off disappears. */
  applyLineVisibility(button, key) {
    button
      .closest(".sv-inline-actions")
      ?.classList.toggle(
        "sv-line-hidden",
        this.config.character_voices?.[key]?.hide_button === true,
      );
  },

  /** Shows or hides a line's extra buttons. */
  toggleLineActions(group, open = !group?.classList.contains("sv-open")) {
    if (!group) return;
    const play = group.querySelector(".sv-play-btn");
    if (open && play && !group.querySelector(".sv-speaker-select"))
      group.append(this.createSpeakerControl(play));
    group.classList.toggle("sv-open", open);
    const more = group.querySelector(".sv-more-btn");
    more?.setAttribute("aria-expanded", String(open));
  },

  /** A chat line's voice (a thought with its inner-voice effect). */
  playLine(button, options = {}) {
    return this.playAudio(button.dataset.audioUrl, button, false, {
      thoughtEffect: this.wantsThoughtEffect(button),
      ...options,
    });
  },

  setPlayButtonIcon(button, state) {
    const icons = {
      waiting: "fa-volume-low",
      queued: "fa-ellipsis",
      loading: "fa-spinner",
      ready: "fa-volume-low",
      error: "fa-triangle-exclamation",
    };
    button.innerHTML = `<i class="fa-solid ${icons[state] || icons.waiting}" aria-hidden="true"></i>`;
  },

  handlePlayClick(button) {
    this.unlockAudioForMobile();
    if (button.dataset.status === "ready" && button.dataset.audioUrl) {
      this.playLine(button);
      return;
    }
    if (
      button.dataset.status === "queued" ||
      button.dataset.status === "generating"
    )
      return;

    button.dataset.status = "queued";
    button.classList.add("sv-queued");
    this.setPlayButtonIcon(button, "queued");
    const operation = this.captureChat();
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => {
        this.assertChat(operation);
        return this.generateForButton(button);
      })
      .catch((error) => {
        if (error.name !== "AbortError") this.notify(error.message, "error");
      });
  },

  /**
   * A pressed line button (다시 생성, 다시 분석) spins and stays disabled until its work is done,
   * so a press never looks ignored. The play button keeps its own state.
   */
  async withBusyButton(control, work) {
    if (control.classList.contains("sv-busy")) return;
    const icon = control.classList.contains("sv-play-btn") ? null : control.querySelector("i");
    const before = icon?.className;
    control.classList.add("sv-busy");
    if (icon) icon.className = "fa-solid fa-spinner fa-spin";
    try {
      return await work();
    } finally {
      control.classList.remove("sv-busy");
      if (icon && before) icon.className = before;
    }
  },

  /** Makes the line's voice again with the same analysis; resolves when it is done. */
  handleRerollClick(button) {
    this.unlockAudioForMobile();
    if (
      button.dataset.status === "queued" ||
      button.dataset.status === "generating"
    )
      return;
    if (button.dataset.audioUrl?.startsWith("blob:"))
      URL.revokeObjectURL(button.dataset.audioUrl);
    delete button.dataset.audioUrl;
    button.dataset.status = "queued";
    button.classList.add("sv-queued");
    this.setPlayButtonIcon(button, "queued");
    const operation = this.captureChat();
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => {
        this.assertChat(operation);
        return this.generateForButton(button, { regenerate: true });
      })
      .catch((error) => {
        if (error.name !== "AbortError") this.notify(error.message, "error");
      });
    return this.queue;
  },

  /** Returns true when audio is ready, "skipped" for a line left for the user to assign (skipUncertain). */
  async generateForButton(
    button,
    { regenerate = false, autoplay = true, skipUncertain = false, skipUnvoiced = false } = {},
  ) {
    const operation = this.captureChat();
    button.dataset.status = "generating";
    button.classList.remove("sv-queued");
    button.classList.add("sv-loading");
    this.setPlayButtonIcon(button, "loading");

    try {
      if (!this.chatVoiceOn())
        throw new Error("채팅 대사 읽기가 꺼져 있습니다(설정 → 기본).");
      const text = button.dataset.text || "";
      await button.lineSaving;
      await this.loadLineState();
      const lineKey = this.lineIdentity(button);
      const edit = this.lineState.edits[lineKey]?.value || {};
      button.lineEdit = edit;
      button.dataset.speakerOverride = edit.speaker_key || "";
      const analysis = edit.performance
        ? {
            ...edit.performance,
            speaker_key: edit.speaker_key,
            needs_confirmation: false,
          }
        : await this.analyzeUtterance(button);
      this.assertChat(operation);
      // In 음성 준비, a line of unclear speaker may be read with the default voice instead.
      const asDefault =
        skipUncertain &&
        analysis.needs_confirmation &&
        !button.dataset.speakerOverride &&
        this.config.casting?.uncertain === "default";
      if (analysis.needs_confirmation && !button.dataset.speakerOverride && !asDefault) {
        // Left closed (no line opens by itself); ⋯ shows "화자 확인 필요" in its speaker menu.
        if (skipUncertain) {
          button.dataset.status = "waiting";
          button.classList.remove("sv-loading", "sv-queued");
          this.setPlayButtonIcon(button, "waiting");
          button.title = "화자를 골라야 생성합니다";
          return "skipped";
        }
        throw new Error(
          "화자를 확실히 구분하지 못했습니다. 대사 옆 ⋯을 눌러 인물을 골라 주십시오.",
        );
      }
      const speaker = asDefault
        ? { key: "__default__", name: "기본 목소리" }
        : this.resolvedSpeaker(button, analysis);
      if (
        !asDefault &&
        skipUnvoiced &&
        (this.speakerSkipped(speaker.key) || !this.speakerHasVoice(speaker.key, button.dataset.kind))
      ) {
        button.dataset.status = "waiting";
        button.classList.remove("sv-loading", "sv-queued");
        this.setPlayButtonIcon(button, "waiting");
        button.title = this.speakerSkipped(speaker.key)
          ? "메시지 음성 버튼에서 건너뛰도록 설정한 인물입니다. 누르면 만듭니다."
          : this.speakerVoiceMissing(speaker.key, button.dataset.kind, analysis.gender, speaker.name)
            ? `‘${speaker.name}’에게 목소리가 없어 건너뛰었습니다. 캐릭터별 목소리에서 정하거나 ⋯에서 인물을 고르십시오.`
            : "목소리를 등록하지 않은 인물이라 메시지 음성 버튼에서 건너뛰었습니다. 누르면 기본 목소리로 만듭니다.";
        return "unvoiced";
      }
      if (this.speakerVoiceMissing(speaker.key, button.dataset.kind, analysis.gender, speaker.name))
        throw new Error(
          asDefault
            ? "기본 목소리가 없습니다. 설정 → 음성 엔진에서 남성·여성 기본 목소리를 정해 주십시오."
            : `‘${speaker.name || "이 인물"}’에게 쓸 목소리가 없습니다. 설정 → 캐릭터별 목소리에서 목소리를 정하거나, 대사 옆 ⋯에서 인물을 고르십시오.`,
        );
      const payload = {
        text,
        line_key: lineKey,
        config_key: this.lineConfigKey(),
        edit_key: contentKey(edit),
        speaker_key: speaker.key,
        speaker_name: speaker.name,
        utterance_kind: button.dataset.kind || "dialogue",
        language: analysis.language,
        voice_gender: analysis.gender || "",
        script: analysis.script || "",
        tags: normalizeTags(analysis),
        intensity: analysis.intensity,
        chat_id: this.currentChatId(),
        message_id: button.dataset.messageId || "",
        quote_index: Number(button.dataset.quoteIndex || 0),
        variation_token: regenerate
          ? `${Date.now()}-${Math.random().toString(36).slice(2)}`
          : "",
        force_regenerate: regenerate,
      };

      const response = await this.fetch(
        this.apiUrl("/api/plugins/scenevoice/generate"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        let message = `음성 생성 실패 (${response.status})`;
        try {
          const error = await response.json();
          if (error.detail) message = error.detail;
        } catch (_) {
          /* 응답 본문이 JSON이 아닐 수 있다. */
        }
        throw new Error(message);
      }

      const appliedControl = decodeURIComponent(
        response.headers.get("X-SceneVoice-Applied") || "",
      );
      const cacheState = response.headers.get("X-SceneVoice-Cache") || "";
      const historyId = response.headers.get("X-SceneVoice-History-ID") || "";
      const blob = await response.blob();
      const audioUrl = this.createAudioUrl(blob);
      button.dataset.audioUrl = audioUrl;
      button.dataset.status = "ready";
      button.dataset.madeAt = String(Date.now());
      button.dataset.emotion = analysis.emotion;
      button.dataset.speakerName = asDefault ? "" : speaker.name || "";
      button.dataset.appliedControl = appliedControl;
      button.dataset.historyId = historyId;
      button.classList.remove("sv-loading", "sv-error");
      button.classList.add("sv-ready");
      this.setPlayButtonIcon(button, "ready");
      button.title = [
        analysis.script || tagsText(normalizeTags(analysis)),
        appliedControl ? `실제 적용: ${appliedControl}` : "",
        cacheState === "hit" ? "캐시 재사용" : "새로 생성",
      ]
        .filter(Boolean)
        .join("\n");
      if (autoplay) this.playLine(button);
      // Reload the shared index next time without discarding clips already on screen.
      this.lineStatePromise = null;
      this.staleLines?.delete(lineKey);

      if (document.querySelector('#sv-panel[data-tab="history"]')) {
        this.renderHistory();
      }
      return true;
    } catch (error) {
      if (operation.signal.aborted) return false;
      console.error("[SceneVoice] 생성 실패", error);
      button.dataset.status = "error";
      button.classList.remove("sv-loading", "sv-queued");
      button.classList.add("sv-error");
      this.setPlayButtonIcon(button, "error");
      button.title = error.message || "음성 생성 실패";
      this.notify(error.message || "음성 생성에 실패했습니다.", "error");
      return false;
    }
  },

  collectMessageBatch(button) {
    const container = button.closest(
      ".mes_text, .markdown-content, .message-body",
    );
    const buttons = container
      ? Array.from(container.querySelectorAll(".sv-play-btn"))
      : [button];
    const usableButtons = buttons.length ? buttons : [button];
    usableButtons.forEach((item, index) => {
      item.dataset.quoteIndex = String(index);
      item.dataset.key = simpleHash(
        `${item.dataset.messageId || ""}|${index}|${item.dataset.text || ""}`,
      );
    });

    let currentMessage = "";
    const context = window.SillyTavern?.getContext?.() || {};
    const message = context.chat?.[Number(button.dataset.messageId)];
    const shown = message?.extra?.display_text;
    // Lines of the message as written (on screen with no translation, or the off-screen source
    // lines 음성 준비 reads under a translation) go with the message as written. Then an analysis
    // made before a translation arrives still serves 음성 준비 after it. Translated lines on
    // screen go with the translated text.
    if (
      message &&
      (!container?.isConnected ||
        !shown ||
        shown === message.mes ||
        container.querySelector(".original_text"))
    ) {
      currentMessage = stripMarkup(
        typeof context.substituteParams === "function"
          ? context.substituteParams(message.mes, context.name1, message.name)
          : message.mes,
      );
    } else if (container) {
      const clone = container.cloneNode(true);
      clone
        .querySelectorAll(".sv-inline-actions")
        .forEach((item) => item.remove());
      currentMessage = stripMarkup(clone.innerHTML || clone.textContent || "");
    }

    return {
      buttons: usableButtons,
      utterances: usableButtons.map((item, index) => {
        const author = this.messageSpeaker(item).key;
        // A card set to one voice reads every line of its messages with that voice.
        const oneVoice =
          this.config.character_voices?.[author]?.single_voice === true;
        return {
          index,
          kind: item.dataset.kind || "dialogue",
          default_speaker_key: author,
          forced_speaker_key:
            item.dataset.speakerOverride ||
            (oneVoice || !this.config.casting?.auto_enabled ? author : ""),
          text: String(item.dataset.text || "").trim(),
        };
      }),
      currentMessage,
    };
  },

  buildPreviousContext(button) {
    const context = window.SillyTavern?.getContext?.();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const messageId = Number(button.dataset.messageId);
    const currentIndex =
      Number.isFinite(messageId) && messageId >= 0
        ? Math.min(messageId, chat.length - 1)
        : chat.length - 1;
    const count = clamp(this.config.context_messages ?? 4, 0, 12);
    const start = Math.max(0, currentIndex - count);
    const selected = chat.slice(start, currentIndex);
    const lines = selected.map((message, offset) => {
      const name = message.name || (message.is_user ? "User" : "Character");
      const content = stripMarkup(message.mes || "");
      return `${start + offset}. ${name}: ${content}`;
    });
    return lines.join("\n");
  },

  /** Every line button back to "not made yet" (settings or the voice data changed). */
  invalidateGeneratedButtons(selector = ".sv-play-btn") {
    document.querySelectorAll(selector).forEach((button) => {
      if (button.dataset.audioUrl?.startsWith("blob:"))
        URL.revokeObjectURL(button.dataset.audioUrl);
      delete button.dataset.audioUrl;
      delete button.dataset.emotion;
      delete button.dataset.appliedControl;
      delete button.dataset.historyId;
      button.dataset.status = "waiting";
      button.classList.remove(
        "sv-ready",
        "sv-error",
        "sv-loading",
        "sv-playing",
        "sv-queued",
      );
      this.setPlayButtonIcon(button, "waiting");
      button.title = "이 대사 음성 생성";
    });
  },

  removeDecorations() {
    this.clearMessageJobs();
    document
      .querySelectorAll(".sv-message-generate, .sv-message-tool")
      .forEach((button) => button.remove());
    document.querySelectorAll("[data-sv-thought]").forEach((element) => {
      element.querySelectorAll(".sv-inline-actions").forEach((x) => x.remove());
      delete element.dataset.svThought;
    });
    document
      .querySelectorAll(".custom-lines[data-sv-decorated]")
      .forEach((line) => {
        line
          .querySelectorAll(":scope > .sv-inline-actions")
          .forEach((item) => item.remove());
        delete line.dataset.svDecorated;
      });
    document.querySelectorAll("q + .sv-inline-actions").forEach((item) => item.remove());
    document.querySelectorAll(".sv-utterance").forEach((wrapper) => {
      // A line may hold formatting (bold, italics); only its buttons go.
      wrapper.querySelectorAll(":scope > .sv-inline-actions").forEach((item) => item.remove());
      const parent = wrapper.parentNode;
      wrapper.replaceWith(...wrapper.childNodes);
      parent?.normalize();
    });
  },
};
