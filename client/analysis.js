// 대사 분석: one helper-model request per message works out each line's speaker, tags and
// language. Results are cached per message (in memory and in the records) and reused.
import {
  analysisSystem,
  ANALYSIS_FINAL,
  dataBlock,
  PROMPT_VERSION,
  userPrompt,
} from "./prompts.js";
import { clamp, contentKey, normalizeTags, tagsText } from "./common.js";
import { normalizeSpeech } from "../shared/providers.js";
import { SPEECH_LANGUAGES } from "../shared/settings.js";

export const analysis = {
  messageAnalysisKey(button, batch, previousContext, states = []) {
    return `ma-${contentKey({
      version: PROMPT_VERSION,
      chatId: this.currentChatId(),
      messageId: button.dataset.messageId || "",
      currentMessage: batch.currentMessage,
      utterances: batch.utterances,
      character: this.getCurrentCharacterNote(),
      profile: this.getRoleplayProfileContext({
        includeUser: Boolean(this.config.llm?.analysis_include_persona),
        includeCharacter: this.config.llm?.analysis_include_character !== false,
      }),
      previousContext,
      states: states || [],
      defaultLanguage: this.config.default_language,
      connection:
        this.connectionService?.fingerprint?.(
          this.config.connection_profile_id,
        ) || this.config.connection_profile_id,
      llm: this.config.llm,
      casting: this.config.casting,
      roster:
        this.speakerAnalysisContext?.(batch.utterances) ||
        this.speakerCatalog?.() ||
        [],
      reading: this.config.reading,
      emotions: [...this.analysisEmotionCandidates()].sort(),
    })}`;
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
      this.setPlayButtonIcon(button, button.dataset.status === "ready" ? "ready" : "waiting");
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
        Boolean(item.speaker_key && this.currentCardKeys?.().includes(item.speaker_key));
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
        (automatic && known ? item.speaker_key : utterance.default_speaker_key || "");
      // Hangul or kana in the line settles the language. A line the script can't settle (kanji
      // only, "…!") goes by the speaker's own language when set, then the model's guess.
      const language =
        this.scriptLanguage(utterance.text) ||
        (/[A-Za-z]/.test(utterance.text) ? "" : this.personLanguage?.(speakerKey) || "") ||
        (SPEECH_LANGUAGES.includes(
          String(item.language || "").toLowerCase(),
        )
          ? String(item.language).toLowerCase()
          : fallback.language);
      return {
        index,
        speaker_key: speakerKey,
        speaker_confidence: clamp(item.speaker_confidence ?? 0, 0, 1),
        // Picks the male or female default voice for a speaker without one of their own.
        gender: ["male", "female"].includes(String(item.gender || "").toLowerCase())
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
      };
    });
  },

  applyMessageAnalyses(buttons, analyses) {
    buttons.forEach((item, index) => {
      const analysis = analyses[index];
      if (!analysis) return;
      item.dataset.emotion = analysis.emotion;
      const speaker = this.resolvedSpeaker(item, analysis);
      this.applyLineVisibility?.(item, speaker.key);
      // The speaker menu's first choice names who the analysis heard (kept for a menu made later).
      item.dataset.speakerLabel = `${analysis.needs_confirmation ? "화자 확인 필요" : speaker.name}${item.dataset.kind === "thought" ? " · 생각" : ""}`;
      const select = item
        .closest(".sv-inline-actions")
        ?.querySelector(".sv-speaker-select");
      if (select?.options[0]) select.options[0].textContent = item.dataset.speakerLabel;
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

  async saveStoredMessageAnalysis(analysisKey, button, analyses) {
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
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 메시지 분석 영구 저장에 실패했습니다.", error);
    }
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
        "보조 모델이 모든 대사의 분석 결과를 반환하지 않았습니다.",
      );
    }
    return this.normalizeMessageAnalyses(data.utterances, utterances);
  },

  /**
   * The message's analysis for this line: from memory, from the records, or one new request.
   * `force` asks again and replaces the saved one (분석 다시), and lets a failure through.
   */
  /** `storedOnly`: only an analysis already made (null without one); no request is sent. */
  /** `signal`: stops the analysis request (a message's 정지). */
  async analyzeUtterance(button, { force = false, storedOnly = false, signal } = {}) {
    const operation = this.captureChat();
    const batch = this.collectMessageBatch(button);
    const previousContext = this.buildPreviousContext(button);
    const states = await this.loadStatesForMessage(button, batch);
    this.assertChat(operation);
    const analysisKey = this.messageAnalysisKey(button, batch, previousContext, states);
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
      !force && (await this.loadStoredMessageAnalysis(analysisKey, batch.utterances));
    if (stored) {
      this.analysisCache.set(analysisKey, stored);
      this.applyMessageAnalyses(batch.buttons, stored);
      return stored[selectedIndex] || stored[0];
    }
    if (storedOnly) return null;

    const roster = this.speakerAnalysisContext(batch.utterances);
    const profileId = this.config.connection_profile_id;
    // Card descriptions can be left out (설정 → 보조모델 분석 → 봇 프로필 참고).
    const includeCharacter = this.config.llm?.analysis_include_character !== false;
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
            soundEffects: roster.some((speaker) => this.soundEffectsFor(speaker.key)),
          }),
        },
        {
          role: "user",
          content: userPrompt(
            [
              dataBlock(
                "speakers",
                JSON.stringify(
                  roster.map(({ key, name, aliases, engine, model, range }) => ({
                    key,
                    name,
                    aliases,
                    range: range || "normal",
                    engine,
                    model,
                  })),
                ),
              ),
              ...roster.map(({ key, name, description, performance_note }) =>
                dataBlock(
                  "speaker_background",
                  JSON.stringify({
                    description: includeCharacter || key === "user" ? description : "",
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
      const lineChars = batch.utterances.reduce((sum, line) => sum + line.text.length, 0);
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
      this.analysisCache.set(analysisKey, analyses);
      this.applyMessageAnalyses(batch.buttons, analyses);
      await this.saveStoredMessageAnalysis(analysisKey, button, analyses);
      return analyses[selectedIndex] || analyses[0];
    } catch (error) {
      if (error.name === "AbortError" || force) throw error;
      console.warn(
        "[SceneVoice] 메시지 일괄 감정 분석 실패, 기본값으로 진행합니다.",
        error,
      );
      this.notify("메시지 분석에 실패해 기본 연기로 생성합니다.", "info");
      // Transient failures must remain retryable; do not cache the fallback.
      this.applyMessageAnalyses(batch.buttons, fallbackBatch);
      return fallbackBatch[selectedIndex] || fallbackBatch[0];
    }
  },
};
