// 대사 분석: one helper-model request per message works out each line's speaker, tags and
// language. Results are cached per message (in memory and in the records) and reused.
import {
  analysisSystem,
  ANALYSIS_FINAL,
  dataBlock,
  userPrompt,
} from "./prompts.js";
import {
  clamp,
  contentKey,
  normalizePlace,
  normalizeTags,
  tagsText,
} from "./common.js";
import { normalizeSpeech } from "../shared/providers.js";
import { SPEECH_LANGUAGES } from "../shared/settings.js";
import { looseWords } from "../shared/loose.js";

export class AnalysisFailedError extends Error {
  constructor(reason, analysisKey) {
    super(`대사 분석에 실패해 음성을 만들지 않았습니다. (${reason})`);
    this.name = "AnalysisFailedError";
    this.reason = reason;
    this.analysisKey = analysisKey;
  }
}

export const analysis = {
  /**
   * Where a message's analysis is kept: its chat, its place and its lines as they are written
   * now (another swipe or an edit is another message). Nothing of the settings is in it: an
   * analysis once made stays until the user asks for a new one (분석 보기 → 다시 분석), as a made
   * voice does.
   */
  messageAnalysisKey(button, batch) {
    const keys = this.messageAnalysisKeys(button, batch);
    // The chat's own analysis; else the one the message came with (from an id the chat had
    // before, or the chat it came from), until it is analysed again here.
    const kept = this.lineState?.analysed;
    return (
      keys.find((key) => kept?.has(key) || this.analysisCache?.has(key)) ||
      this.looseAnalysisKey(button, batch, keys[0]) ||
      keys[0]
    );
  },
  /**
   * The key of an analysis kept for this message when its lines are the same but for marks
   * that mean the same (see looseWords), "" when there is none. Its key must be the one these
   * lines would have had with its words: then it is of this chat, of lines of these kinds, and
   * made with the two switches as they are now.
   */
  looseAnalysisKey(button, batch, own) {
    const state = this.lineState;
    if (!state?.analysedLines?.length) return "";
    state.looseAnalyses ||= new Map();
    if (state.looseAnalyses.has(own)) return state.looseAnalyses.get(own);
    const messageId = button.dataset.messageId || "";
    const kinds = batch.utterances.map((line) => line.kind || "");
    const words = batch.utterances
      .map((line) => looseWords(line.text))
      .join("\n");
    const bases = this.chatKeyBases?.() || [this.currentChatId()];
    let found = "";
    for (const [key, message, texts] of state.analysedLines) {
      if (message !== messageId || texts.length !== kinds.length) continue;
      if (texts.map(looseWords).join("\n") !== words) continue;
      const value = {
        messageId,
        lines: texts.map((text, index) => [kinds[index], text]),
        tags: Boolean(this.config.analysis_enabled),
        cast: Boolean(this.config.casting?.auto_enabled),
      };
      if (
        bases.some((chatId) => `ma-${contentKey({ chatId, ...value })}` === key)
      )
        found = key;
    }
    state.looseAnalyses.set(own, found);
    return found;
  },
  /** The key under this chat's own id first, then under each id it may have been kept with. */
  messageAnalysisKeys(button, batch) {
    const value = {
      messageId: button.dataset.messageId || "",
      lines: batch.utterances.map((line) => [line.kind || "", line.text]),
      // The two switches that decide what an analysis holds at all (tags, who speaks): one made
      // with a switch off is not what the user gets with it on.
      tags: Boolean(this.config.analysis_enabled),
      cast: Boolean(this.config.casting?.auto_enabled),
    };
    const bases = this.chatKeyBases?.() || [this.currentChatId()];
    // The lines as shown first; then all of them as they read with periods for an ellipsis, or
    // the other way round (see dotReadings in common.js).
    const readings = [value.lines];
    for (const turn of [0, 1]) {
      const lines = value.lines.map(([kind, text]) => [
        kind,
        turn
          ? String(text).replaceAll("...", "…")
          : String(text).replaceAll("…", "..."),
      ]);
      if (
        !readings.some((kept) => JSON.stringify(kept) === JSON.stringify(lines))
      )
        readings.push(lines);
    }
    return readings.flatMap((lines) =>
      bases.map((chatId) => `ma-${contentKey({ chatId, ...value, lines })}`),
    );
  },

  async reanalyzeButton(button) {
    // The new analysis can take a few seconds: the line shows it is working from the start.
    button.classList.add("sv-loading");
    this.setPlayButtonIcon(button, "loading");
    await button.lineSaving;
    if (button.lineEdit?.performance)
      await this.saveLineEdit(
        button,
        button.lineEdit.speaker_key
          ? { speaker_key: button.lineEdit.speaker_key }
          : {},
      );
    try {
      await this.analyzeUtterance(button, { force: true });
    } catch (error) {
      button.classList.remove("sv-loading");
      this.setPlayButtonIcon(
        button,
        button.dataset.status === "ready" ? "ready" : "waiting",
      );
      throw error;
    }
    return this.handleRerollClick(button);
  },

  fallbackAnalysis(text, index) {
    return {
      index,
      text,
      script: "",
      tags: [],
      emotion: "default",
      intensity: 0.5,
      direction: "",
      language: this.detectLanguage(text, this.chatLanguage()),
    };
  },

  normalizeMessageAnalyses(items, utterances) {
    const byIndex = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const index = Number(item?.index);
      if (Number.isInteger(index) && index >= 0 && index < utterances.length) {
        byIndex.set(index, item);
      }
    }
    const roster =
      this.speakerAnalysisContext?.(utterances) || this.speakerCatalog();
    return utterances.map((utterance, index) => {
      const fallback = this.fallbackAnalysis(utterance.text, index);
      const item = byIndex.get(index) || {};
      const automatic = Boolean(this.config.casting?.auto_enabled);
      const forced = roster.some((x) => x.key === utterance.forced_speaker_key)
        ? utterance.forced_speaker_key
        : "";
      // A chat card counts too: it speaks with its first person when it lists people.
      const known =
        roster.some((x) => x.key === item.speaker_key) ||
        Boolean(
          item.speaker_key &&
          this.currentCardKeys?.().includes(item.speaker_key),
        );
      // The model returns the line with tags woven in (script). A script that changed the
      // words is dropped except its leading tags; older replies had tags or emotion + direction.
      let performance = { script: "", tags: [], emotion: "default" };
      if (this.config.analysis_enabled)
        try {
          performance = normalizeSpeech({
            text: utterance.text,
            script: item.script,
            tags: item.tags,
            direction: item.direction,
            emotion: String(item.emotion || "").toLowerCase(),
          });
        } catch {
          /* An unusable reply for one line keeps the plain delivery. */
        }
      const { script, tags } = performance;
      const speakerKey =
        forced ||
        (automatic && known
          ? item.speaker_key
          : utterance.default_speaker_key || "");
      // Hangul or kana in the line settles the language. A line the script can't settle (kanji
      // only, "…!") goes by the speaker's own language when set, then the model's guess.
      const language =
        this.scriptLanguage(utterance.text) ||
        (/[A-Za-z]/.test(utterance.text)
          ? ""
          : this.personLanguage?.(speakerKey) || "") ||
        (SPEECH_LANGUAGES.includes(String(item.language || "").toLowerCase())
          ? String(item.language).toLowerCase()
          : fallback.language);
      return {
        index,
        speaker_key: speakerKey,
        speaker_confidence: clamp(item.speaker_confidence ?? 0, 0, 1),
        // Picks the male or female default voice for a speaker without one of their own.
        gender: ["male", "female"].includes(
          String(item.gender || "").toLowerCase(),
        )
          ? String(item.gender).toLowerCase()
          : "",
        needs_confirmation:
          !forced &&
          automatic &&
          roster.length > 1 &&
          (Boolean(item.needs_confirmation) ||
            !known ||
            clamp(item.speaker_confidence ?? 0, 0, 1) < 0.65),
        text: utterance.text,
        script,
        tags,
        emotion: performance.emotion,
        language,
        intensity: this.config.analysis_enabled
          ? clamp(item.intensity ?? 0.5, 0, 1)
          : 0.5,
        direction: tags.join(", "),
        ...normalizePlace(item),
      };
    });
  },

  applyMessageAnalyses(buttons, analyses) {
    buttons.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis) return;
      item.dataset.emotion = analysis.emotion;
      item.dataset.side = analysis.side || "";
      item.dataset.space = analysis.space || "";
      const speaker = this.resolvedSpeaker(item, analysis);
      this.applyLineVisibility?.(item, speaker.key);
      // The speaker menu's first choice names who the analysis heard (kept for a menu made later).
      item.dataset.speakerLabel = `${analysis.needs_confirmation ? "화자 확인 필요" : speaker.name}${item.dataset.kind === "thought" ? " · 생각" : ""}`;
      const select = item
        .closest(".sv-inline-actions")
        ?.querySelector(".sv-speaker-select");
      if (select?.options[0])
        select.options[0].textContent = item.dataset.speakerLabel;
      item.title = `${speaker.name} · ${analysis.script || tagsText(normalizeTags(analysis))}`;
    });
  },

  async loadStoredMessageAnalysis(analysisKey, utterances) {
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/message-analysis?analysis_key=${encodeURIComponent(analysisKey)}`,
        ),
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.found) return null;
      return this.normalizeMessageAnalyses(data.analyses, utterances);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 저장된 메시지 분석을 읽지 못했습니다.", error);
      return null;
    }
  },

  /**
   * The message has an analysis kept: its 분석 보기 button shows from here on, without waiting
   * for a voice. The line may sit outside the message's text (the source lines under a
   * translation), so the message is found by its number.
   */
  async noteAnalysed(analysisKey, button) {
    // The chat's list may still be on its way (an analysis that finished first).
    await this.loadLineState?.().catch(() => null);
    this.lineState?.analysed?.add(analysisKey);
    const id = button?.dataset?.messageId;
    // (The host of source lines is a detached .mes_text of its own.)
    const own = button?.closest?.(".mes_text");
    const container =
      (own?.isConnected && own.closest(".mes,.message-body") ? own : null) ||
      (id !== undefined && id !== ""
        ? document.querySelector?.(
            `#chat .mes[mesid="${CSS.escape(String(id))}"] .mes_text`,
          )
        : null);
    if (container) await this.revealMessageTools?.(container);
  },

  async saveStoredMessageAnalysis(analysisKey, button, analyses) {
    // Always under this chat's own id: one that came from another chat stays that chat's.
    const own = this.messageAnalysisKeys(
      button,
      this.collectMessageBatch(button),
    )[0];
    if (own !== analysisKey) this.analysisCache?.set(own, analyses);
    analysisKey = own;
    try {
      const response = await this.fetch(
        this.apiUrl("/api/plugins/scenevoice/message-analysis"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysis_key: analysisKey,
            chat_id: this.currentChatId(),
            message_id: button.dataset.messageId || "",
            profile_id: this.config.connection_profile_id || "",
            analyses,
          }),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.noteAnalysed(analysisKey, button);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 메시지 분석 영구 저장에 실패했습니다.", error);
    }
  },

  /**
   * The message's analyses as they are kept now (in memory, else in the records), with the key
   * they are kept under; `analyses` is null when the message was never analysed.
   */
  async keptMessageAnalyses(button) {
    // Which key the message's analysis is under is read from the chat's list.
    if ((this.chatKeyBases?.() || []).length > 1)
      await this.loadLineState?.().catch(() => null);
    const batch = this.collectMessageBatch(button);
    const key = this.messageAnalysisKey(button, batch);
    const analyses =
      this.analysisCache.get(key) ||
      (await this.loadStoredMessageAnalysis(key, batch.utterances)) ||
      null;
    return { key, batch, analyses };
  },

  /**
   * 분석 다시 for some lines of a message (`chosen`: their indexes). The whole message is
   * analysed again in one request, as its lines are read together; the lines not chosen keep
   * the analysis they had.
   */
  async reanalyzeLines(button, chosen) {
    const before = (await this.keptMessageAnalyses(button)).analyses;
    await this.analyzeUtterance(button, { force: true });
    if (!before) return;
    const { key, batch, analyses } = await this.keptMessageAnalyses(button);
    if (!analyses) return;
    const merged = analyses.map((item, index) =>
      chosen.has(index) ? item : before[index] || item,
    );
    this.analysisCache.set(key, merged);
    this.applyMessageAnalyses(batch.buttons, merged);
    await this.saveStoredMessageAnalysis(key, button, merged);
  },

  parseMessageAnalysis(response, utterances) {
    const data = this.parseJsonObject(response);
    const indices = new Set(
      (data.utterances || []).map((item) => Number(item?.index)),
    );
    if (
      !Array.isArray(data.utterances) ||
      data.utterances.length !== utterances.length ||
      indices.size !== utterances.length ||
      utterances.some(
        (line, index) =>
          !indices.has(index) ||
          (line.forced_speaker_key &&
            data.utterances.find((x) => Number(x.index) === index)
              ?.speaker_key !== line.forced_speaker_key),
      )
    ) {
      throw new Error(
        "보조모델이 모든 대사의 분석 결과를 반환하지 않았습니다.",
      );
    }
    return this.normalizeMessageAnalyses(data.utterances, utterances);
  },

  /** Why a helper request failed, in a few words for a notice. */
  failureReason(error) {
    if (error?.name === "TimeoutError") return "10분 안에 답이 오지 않음";
    const text = String(error?.message || error || "").trim();
    return text
      ? text.length > 140
        ? `${text.slice(0, 140)}…`
        : text
      : "이유를 알 수 없음";
  },

  /**
   * The message's analysis for this line: from memory, from the records, or one new request.
   * `force` asks again and replaces the saved one (분석 다시), and lets a failure through.
   * `storedOnly`: only an analysis already made (null without one); no request is sent.
   * `signal`: stops the analysis request (a message's 정지).
   */
  async analyzeUtterance(
    button,
    { force = false, storedOnly = false, signal } = {},
  ) {
    const operation = this.captureChat();
    const batch = this.collectMessageBatch(button);
    const previousContext = this.buildPreviousContext(button);
    const states = await this.loadStatesForMessage(button, batch);
    this.assertChat(operation);
    if ((this.chatKeyBases?.() || []).length > 1) {
      await this.loadLineState?.().catch(() => null);
      this.assertChat(operation);
    }
    const analysisKey = this.messageAnalysisKey(button, batch);
    const selectedIndex = Number(button.dataset.quoteIndex || 0);
    const fallbackBatch = this.normalizeMessageAnalyses([], batch.utterances);

    if (
      (!this.config.analysis_enabled && !this.config.casting?.auto_enabled) ||
      !this.config.connection_profile_id ||
      !this.connectionService
    ) {
      this.applyMessageAnalyses(batch.buttons, fallbackBatch);
      return fallbackBatch[selectedIndex] || fallbackBatch[0];
    }

    if (this.analysisCache.size > 300)
      this.analysisCache.delete(this.analysisCache.keys().next().value);
    if (!force && this.analysisCache.has(analysisKey)) {
      const cached = this.analysisCache.get(analysisKey);
      this.applyMessageAnalyses(batch.buttons, cached);
      return cached[selectedIndex] || cached[0];
    }

    const stored =
      !force &&
      (await this.loadStoredMessageAnalysis(analysisKey, batch.utterances));
    if (stored) {
      this.analysisCache.set(analysisKey, stored);
      this.applyMessageAnalyses(batch.buttons, stored);
      await this.noteAnalysed(analysisKey, button);
      return stored[selectedIndex] || stored[0];
    }
    if (storedOnly) return null;
    // 분석 없이 생성 was pressed after this message's analysis failed: plain delivery this time,
    // each line read by whoever the message is from (or the person the user chose for it).
    if (!force && this.analysisSkipped?.has(analysisKey)) {
      const plain = fallbackBatch.map((item) => ({
        ...item,
        needs_confirmation: false,
      }));
      this.applyMessageAnalyses(batch.buttons, plain);
      return plain[selectedIndex] || plain[0];
    }

    const roster = this.speakerAnalysisContext(batch.utterances);
    const profileId = this.config.connection_profile_id;
    // Card descriptions can be left out (설정 → 보조모델 분석 → 봇카드 설명 참고).
    const includeCharacter =
      this.config.llm?.analysis_include_character !== false;
    const roleplayProfile = this.getRoleplayProfileContext({
      includeUser: Boolean(this.config.llm?.analysis_include_persona),
      includeCharacter,
    });
    try {
      const messages = [
        {
          role: "system",
          content: analysisSystem({
            emotions: [...this.analysisEmotionCandidates()].sort(),
            soundEffects: roster.some((speaker) =>
              this.soundEffectsFor(speaker.key),
            ),
            spatial: this.config.playback?.spatial !== false,
            readings: this.findsReadings(),
          }),
        },
        {
          role: "user",
          content: userPrompt(
            [
              dataBlock(
                "speakers",
                JSON.stringify(
                  roster.map(
                    ({ key, name, aliases, engine, model, range }) => ({
                      key,
                      name,
                      aliases,
                      range: range || "normal",
                      engine,
                      model,
                    }),
                  ),
                ),
              ),
              ...roster.map(({ key, name, description, performance_note }) =>
                dataBlock(
                  "speaker_background",
                  JSON.stringify({
                    description:
                      includeCharacter || key === "user" ? description : "",
                    performance_note,
                  }),
                  { key, name },
                ),
              ),
              dataBlock("profile", roleplayProfile),
              ...states.map(({ key, name, state }) =>
                dataBlock("state", state, { key, name }),
              ),
              dataBlock("recent_chat", previousContext),
              ...(this.findsReadings() && this.knownReadings().length
                ? [dataBlock("known_readings", this.knownReadings())]
                : []),
              dataBlock("current_message", batch.currentMessage),
              dataBlock("dialogues", batch.utterances),
            ],
            ANALYSIS_FINAL,
          ),
        },
      ];
      this.assertChat(operation);
      const prompt = this.connectionService.constructPrompt
        ? this.connectionService.constructPrompt(messages, profileId)
        : messages;
      // Each line comes back whole with its tags, so the reply grows with the lines' length.
      const lineChars = batch.utterances.reduce(
        (sum, line) => sum + line.text.length,
        0,
      );
      const maxTokens = Math.min(
        8000,
        400 + batch.utterances.length * 140 + Math.ceil(lineChars * 1.5),
      );
      const response = await this.connectionService.sendRequest(
        profileId,
        prompt,
        maxTokens,
        {
          stream: false,
          extractData: true,
          includePreset: false,
          includeInstruct: true,
          signal,
        },
        { temperature: 0.2 },
      );
      const analyses = this.parseMessageAnalysis(response, batch.utterances);
      this.analysisSkipped?.delete(analysisKey);
      this.analysisCache.set(analysisKey, analyses);
      this.applyMessageAnalyses(batch.buttons, analyses);
      await this.saveStoredMessageAnalysis(analysisKey, button, analyses);
      // Before the lines are voiced, so the new readings are used for them already.
      await this.keepFoundReadings(response, batch.utterances);
      return analyses[selectedIndex] || analyses[0];
    } catch (error) {
      if (error.name === "AbortError" || force) throw error;
      console.warn("[SceneVoice] 메시지 일괄 감정 분석 실패", error);
      // No voice without the analysis the user turned on: the notice offers 분석 없이 생성.
      throw new AnalysisFailedError(this.failureReason(error), analysisKey);
    }
  },

  /**
   * An analysis failed and nothing was made. `retry` does the same work again; the notice's
   * 분석 없이 생성 runs it with plain delivery for that message.
   */
  notifyAnalysisFailed(error, retry) {
    const toastr = window.toastr;
    if (!toastr || !window.jQuery) {
      this.notify(error.message, "error");
      return;
    }
    if (this.analysisFailToast)
      toastr.clear(this.analysisFailToast, { force: true });
    const body = document.createElement("div");
    body.className = "sv-toast-body";
    const text = document.createElement("div");
    text.textContent = error.message;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "sv-toast-action";
    action.textContent = "분석 없이 생성";
    body.append(text, action);
    const toast = toastr.error(window.jQuery(body), "씬보이스", {
      timeOut: 15000,
      extendedTimeOut: 10000,
      tapToDismiss: false,
      closeButton: true,
      escapeHtml: false,
    });
    this.analysisFailToast = toast;
    action.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      (this.analysisSkipped ||= new Set()).add(error.analysisKey);
      toastr.clear(toast, { force: true });
      if (this.analysisFailToast === toast) this.analysisFailToast = null;
      retry();
    });
  },
};
