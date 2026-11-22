// 대사별 수정: a line's saved speaker/performance edit and saved voice, and the 화자·연기 editor.
import { contentKey } from "../shared/hash.js";
import {
  escapeHtml,
  normalizeTags,
  LANGUAGE_CHOICES,
  dotReadings,
  stOf,
} from "./common.js";
import { infoTip, fieldHtml, bindInfoTips } from "./ui.js";
import { looseWords } from "../shared/loose.js";
import {
  SOUND_TAGS,
  cleanScript,
  keepsLine,
  tagSuggestions,
} from "../shared/providers.js";
const bracketed = (tags) => tags.map((tag) => `[${tag}]`).join("");
const looseName = (message, kind, text) =>
  `${message}\n${kind === "thought" ? "thought" : "dialogue"}\n${looseWords(text)}`;
// The chips read in Korean; what goes into the line is the English tag the engines know.
const TAG_LABELS = {
  calm: "차분하게",
  soft: "부드럽게",
  happy: "기쁘게",
  sad: "슬프게",
  pained: "아파하며",
  tense: "긴장해서",
  angry: "화나서",
  urgent: "다급하게",
  fearful: "겁먹어서",
  surprised: "놀라서",
  tired: "지쳐서",
  sarcastic: "비꼬듯",
  sensual: "관능적으로",
  flustered: "당황해서",
  languid: "나른하게",
  seductive: "유혹하듯",
  curious: "궁금해하며",
  confident: "자신 있게",
  disappointed: "실망해서",
  relieved: "안도하며",
  embarrassed: "부끄러워하며",
  whispers: "속삭이며",
  quiet: "조용히",
  emphatic: "힘주어",
  reflective: "곰곰이",
  "matter-of-fact": "담담하게",
  breathy: "숨 섞인",
  breathless: "숨이 차서",
  husky: "낮고 거칠게",
  shaky: "떨리는 목소리",
  hesitant: "머뭇거리며",
  excited: "들떠서",
  nervous: "초조하게",
  annoyed: "짜증 내며",
  mischievous: "장난스럽게",
  shouting: "소리치며",
  crying: "울면서",
  sighs: "한숨",
  laughs: "웃음",
  chuckles: "킥킥 웃음",
  "clears throat": "헛기침",
  gasps: "헉 (놀람)",
  sniffs: "훌쩍임",
  exhales: "숨 내쉼",
  gulps: "침 삼킴",
  giggles: "키득거림",
  groans: "앓는 소리",
  sobs: "흐느낌",
  yawns: "하품",
  scoffs: "코웃음",
  panting: "헐떡임",
  "inhales deeply": "숨 들이쉼",
  smooch: "쪽 (뽀뽀)",
};
// The chips in an order that reads as a flow: calm, bright, affectionate, shy and nervous,
// frightened, sad, angry; then laughs, breaths, starts and sobs. A tag not listed here (an
// emotion the user added) comes after them.
const TAG_ORDER = [
  ...["calm", "soft", "quiet", "whispers", "matter-of-fact", "reflective"],
  ...["relieved", "languid", "tired"],
  ...["happy", "excited", "confident", "curious", "mischievous"],
  ...["sensual", "seductive", "breathy", "breathless", "husky"],
  ...["embarrassed", "flustered", "hesitant", "nervous", "tense"],
  ...["surprised", "fearful", "shaky", "urgent"],
  ...["disappointed", "sad", "crying", "pained"],
  ...["sarcastic", "annoyed", "angry", "emphatic", "shouting"],
  ...["laughs", "chuckles", "giggles", "scoffs"],
  ...["sighs", "exhales", "inhales deeply", "panting", "yawns"],
  ...["gasps", "gulps", "clears throat"],
  ...["sniffs", "sobs", "groans", "smooch"],
];
const place = (tag) =>
  TAG_ORDER.includes(tag) ? TAG_ORDER.indexOf(tag) : TAG_ORDER.length;
const chips = (tags) =>
  [...tags]
    .sort((a, b) => place(a) - place(b))
    .map(
      (tag) =>
        `<button type="button" class="sv-tag-pick" data-tag="${escapeHtml(tag)}" title="[${escapeHtml(tag)}]">${escapeHtml(TAG_LABELS[tag] || tag)}</button>`,
    )
    .join("");

// What of a person's settings changes a line's voice, or who a line is given to.
const VOICE_FIELDS = [
  "name",
  "aliases",
  "engine",
  "voice_id",
  "card",
  "single_voice",
  "expressiveness",
  "language",
  "always_tags",
  "gender",
  "persona",
  "use_cards",
];

export const lineEdits = {
  /**
   * What the chat's line buttons read from the settings (who a line is given to, how it is
   * read): when it changes the chat is looked at again. Made voices don't hang on it: a line's
   * voice stays its voice whatever the settings become, until it is made again.
   */
  lineConfigKey() {
    const voices = this.config.character_voices;
    const casting = this.config.casting;
    return contentKey({
      engine: this.config.engine,
      voices: Object.fromEntries(
        Object.entries(voices || {}).map(([key, entry]) => [
          key,
          Object.fromEntries(
            VOICE_FIELDS.filter((field) => entry?.[field] !== undefined).map(
              (field) => [field, entry[field]],
            ),
          ),
        ]),
      ),
      reading: this.config.reading,
      language: this.config.default_language,
      analysis: this.config.analysis_enabled,
      casting: {
        auto_enabled: casting?.auto_enabled,
        uncertain: casting?.uncertain,
      },
    });
  },
  /** A line's key: its chat, message (as written now), place, kind and words. Kept per button. */
  lineIdentity(button) {
    return this.lineKeys(button)[0];
  },
  /**
   * The line's key under each id its chat's lines may have been made with: this chat's own id
   * first (what is written is written under that one), then the ids it had before and those of
   * the chats it came from (their voices and edits are this line's until it gets its own).
   */
  lineKeys(button) {
    const bases = this.chatKeyBases?.() || [this.currentChatId()];
    const value = {
      chat: bases[0],
      message: button.dataset.messageId,
      source: this.anchorFingerprint(button.dataset.messageId),
      index: button.dataset.quoteIndex,
      kind: button.dataset.kind,
      text: button.dataset.text,
    };
    const input = `${Object.values(value).join("\u0000")}\u0000${bases.slice(1).join()}`;
    if (button.identityInput !== input) {
      button.identityInput = input;
      button.identityValue = value;
      button.triedFor = null;
      button.looseFor = null;
      // The words as shown first; then as they read with periods for an ellipsis or the other
      // way round (see dotReadings).
      const readings = [value.text, ...dotReadings(value.text)];
      button.identityKeys = [];
      for (const text of readings)
        for (const chat of bases)
          button.identityKeys.push(contentKey({ ...value, chat, text }));
    }
    return button.identityKeys;
  },
  /**
   * The line's edit: its own, else the one it came with, else the one it had before the marks
   * of its words changed (see looseLineOf).
   */
  lineEditOf(button, state = this.lineState) {
    const keys = this.lineKeys(button);
    for (const key of keys)
      if (state?.edits?.[key]) return state.edits[key].value || {};
    if (keys.some((key) => state?.audio?.[key])) return {};
    return state?.edits?.[this.looseLineOf(button, state)]?.value || {};
  },
  /** Where a line stands: kept with its edit, as a voice's record keeps it. */
  lineSpot(button) {
    return {
      message_id: button.dataset.messageId || "",
      quote_index: Number(button.dataset.quoteIndex || 0),
      utterance_kind: button.dataset.kind || "dialogue",
      text: button.dataset.text || "",
      anchor_tag:
        this.anchorTag?.(button.dataset.messageId, { lazy: true }) || "",
      anchor_swipe: this.messageSwipe?.(button.dataset.messageId) ?? null,
    };
  },
  /** The chat's voices and edits by message, kind and words with their marks made one. */
  looseLines(state) {
    if (!state.loose) {
      state.loose = new Map();
      const add = (key, place, at) => {
        if (!place?.text) return;
        const name = looseName(
          place.message_id,
          place.utterance_kind,
          place.text,
        );
        if (!state.loose.has(name)) state.loose.set(name, []);
        state.loose.get(name).push({ key, place, at: String(at || "") });
      };
      for (const [key, audio] of Object.entries(state.audio || {}))
        add(key, audio, audio.created_at);
      for (const [key, edit] of Object.entries(state.edits || {}))
        add(key, edit.place, edit.updated_at);
    }
    return state.loose;
  },
  /**
   * The key the line was kept under before the marks of its words changed (… for ..., a curly
   * quote for a straight one, a full-width mark for a plain one: see looseWords) or before
   * another part of its message was edited: the newest voice or edit of this very message, for
   * a line of the same kind with the same words. "" when there is none.
   * It must be of this message as it is shown: a record carries the mark of its message (see
   * anchorTag) and the swipe it was made on; another swipe, a message made anew or another
   * message doesn't have them. One kept before marks were left counts unless its key says where
   * else it was made.
   * And it must not be another line's: when the message says the same words twice (two people
   * may), a record goes to the line nearest to where it was made.
   */
  looseLineOf(button, state = this.lineState) {
    if (!state) return "";
    const own = this.lineKeys(button);
    const value = button.identityValue;
    const tag = this.messageTag?.(value.message) || "";
    const kept = this.looseLines(state);
    if (button.looseFor?.kept === kept && button.looseFor.tag === tag)
      return button.looseFor.key;
    button.looseFor = { kept, tag, key: "" };
    const index = Number(value.index) || 0;
    const far = (item) =>
      Math.abs((Number(item.place.quote_index) || 0) - index);
    const name = looseName(value.message, value.kind, value.text);
    const here = (kept.get(name) || [])
      .filter((item) => !own.includes(item.key))
      // The same line said twice in a message: the nearer one, then the newer.
      .sort((a, b) => far(a) - far(b) || (a.at < b.at ? 1 : -1));
    if (!here.length) return "";
    const swipe = this.messageSwipe?.(value.message) ?? 0;
    const twins = [
      ...(button
        .closest?.(".mes_text, .markdown-content, .message-body")
        ?.querySelectorAll(".sv-play-btn") || []),
    ]
      .filter(
        (other) =>
          other !== button &&
          looseName(
            other.dataset.messageId,
            other.dataset.kind,
            other.dataset.text,
          ) === name,
      )
      .map((other) => Number(other.dataset.quoteIndex) || 0);
    const nearest = (item) => {
      const made = Number(item.place.quote_index) || 0;
      const mine = Math.abs(index - made);
      return twins.every((other) => {
        const theirs = Math.abs(other - made);
        return theirs > mine || (theirs === mine && other > index);
      });
    };
    const found = here.find(
      (item) =>
        nearest(item) &&
        (item.place.anchor_tag
          ? item.place.anchor_tag === tag &&
            (!Number.isInteger(item.place.anchor_swipe) ||
              item.place.anchor_swipe === swipe)
          : !this.madeElsewhere(item, value.message)),
    );
    button.looseFor.key = found?.key || "";
    return button.looseFor.key;
  },
  /**
   * Whether a voice kept without a mark of its message is known to be of another swipe of the
   * message, or of a message near it (the chat moved up or down since): its key is then the
   * one it would have there.
   */
  madeElsewhere(item, index) {
    const chat = stOf(this)?.chat || [];
    const at = Number(index);
    const prints = [...(this.otherSwipePrints?.(at) || [])];
    for (let near = at - 3; near <= at + 3; near++)
      if (near !== at && chat[near]) prints.push(this.anchorFingerprint(near));
    if (!prints.length) return false;
    const bases = [
      ...(this.chatKeyBases?.() || [this.currentChatId()]),
      ...(this.chatTriedBases?.() || []),
    ];
    const { place } = item;
    return prints.some((source) =>
      bases.some(
        (base) =>
          contentKey({
            chat: base,
            message: String(place.message_id),
            source,
            index: String(Number(place.quote_index) || 0),
            kind: place.utterance_kind,
            text: place.text,
          }) === item.key,
      ),
    );
  },
  /** The line's voice: its own, else the one it came with (made with the edit it has now). */
  lineAudioOf(button, state = this.lineState) {
    const [own, ...others] = this.lineKeys(button);
    if (state?.audio?.[own]) return state.audio[own];
    const edit = contentKey(this.lineEditOf(button, state));
    const fits = (audio) =>
      audio && (audio.edit_key || contentKey({})) === edit ? audio : undefined;
    for (const key of others)
      if (fits(state?.audio?.[key])) return state.audio[key];
    return (
      this.triedAudioOf(button, state, fits) ||
      fits(state?.audio?.[this.looseLineOf(button, state)])
    );
  },
  /**
   * A voice kept at this very place that nothing claimed: its key may have been made with an id
   * the chat is not known to have had (chatTriedBases). Worked out for such lines only.
   */
  triedAudioOf(button, state, fits) {
    const tried = this.chatTriedBases?.() || [];
    if (!tried.length || !state?.audio) return undefined;
    state.audioPlaces ||= new Set(
      Object.values(state.audio).map(
        (audio) => `${audio.message_id}\n${Number(audio.quote_index) || 0}`,
      ),
    );
    const value = button.identityValue;
    if (!state.audioPlaces.has(`${value.message}\n${Number(value.index) || 0}`))
      return undefined;
    const mark = tried.join();
    if (button.triedFor?.mark !== mark || button.triedFor.state !== state) {
      button.triedFor = { mark, state, base: "", key: "" };
      search: for (const text of [value.text, ...dotReadings(value.text)])
        for (const chat of tried) {
          const key = contentKey({ ...value, chat, text });
          if (fits(state.audio[key])) {
            Object.assign(button.triedFor, { base: chat, key });
            break search;
          }
        }
    }
    if (!button.triedFor.key) return undefined;
    this.keepKeyBase?.(button.triedFor.base);
    return fits(state.audio[button.triedFor.key]);
  },
  async loadLineState() {
    if (!this.lineStatePromise) {
      const operation = this.captureChat();
      const requestedAt = Date.now();
      this.lineStatePromise = (async () => {
        const response = await this.request(
          `/api/plugins/scenevoice/line-state?chat_id=${encodeURIComponent(this.currentChatId())}`,
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || "대사 설정을 읽지 못했습니다.");
        this.assertChat(operation);
        data.requestedAt = requestedAt;
        // Keys of the analyses kept for this chat (those messages' 분석 보기 button shows).
        data.analysed = new Set(data.analysed || []);
        this.lineState = data;
        return data;
      })().catch((error) => {
        this.lineStatePromise = null;
        throw error;
      });
    }
    return this.lineStatePromise;
  },
  async hydrateLines(container = document) {
    const state = await this.loadLineState();
    for (const button of container.querySelectorAll(".sv-play-btn")) {
      if (
        !button.isConnected ||
        button.lineSaving ||
        ["queued", "generating"].includes(button.dataset.status) ||
        // Made after this list was asked for: the list doesn't know its voice yet.
        (button.dataset.madeAt &&
          Number(button.dataset.madeAt) >= (state.requestedAt || 0))
      )
        continue;
      const key = this.lineIdentity(button);
      const edit = this.lineEditOf(button, state);
      // A line whose message was analysed again is made again (the same acting comes back
      // from the saved voices without a new request).
      const audio = this.staleLines?.has(key)
        ? null
        : this.lineAudioOf(button, state);
      const signature = contentKey({ key, edit, audio: audio?.id });
      if (button.lineSignature === signature) continue;
      if (button.lineSignature && !audio && button.dataset.status === "ready")
        this.cancelLineAudio(button);
      if (
        button.lineKey &&
        (button.lineKey !== key ||
          contentKey(button.lineEdit || {}) !== contentKey(edit))
      )
        this.cancelLineAudio(button);
      button.lineKey = key;
      button.lineEdit = edit;
      button.lineSignature = signature;
      button.dataset.speakerOverride = edit.speaker_key || "";
      if (edit.speaker_key)
        this.applyLineVisibility?.(button, edit.speaker_key);
      const select = button
        .closest(".sv-inline-actions")
        ?.querySelector(".sv-speaker-select");
      if (select) select.value = edit.speaker_key || "";
      if (audio?.audio_url && button.dataset.status !== "ready") {
        button.dataset.audioUrl = audio.audio_url;
        button.dataset.historyId = audio.id;
        button.dataset.speakerName =
          audio.speaker_key === "__default__" ? "" : audio.speaker_name || "";
        // An analysis applied since knows better than the record of the voice.
        button.dataset.side ??= audio.side || "";
        button.dataset.space ??= audio.space || "";
        button.dataset.status = "ready";
        button.classList.remove("sv-error");
        button.classList.add("sv-ready");
        this.setPlayButtonIcon(button, "ready");
        button.title = `저장된 음성 · ${audio.speaker_name || ""} · ${audio.applied_control || "기본 연기"}`;
      }
    }
  },
  /** Whether the line would have an edit it came with if it had none under its own key. */
  lineBorrowsEdit(button, state = this.lineState) {
    const [, ...others] = this.lineKeys(button);
    return [...others, this.looseLineOf(button, state)].some(
      (key) => Object.keys(state?.edits?.[key]?.value || {}).length > 0,
    );
  },
  /**
   * An edit the line came with is kept under the line's own key when a voice is made with it:
   * a voice counts by the edit kept under its key.
   */
  async keepLineEdit(button, key, edit) {
    if (!Object.keys(edit).length || this.lineState?.edits?.[key]) return edit;
    const place = this.lineSpot(button);
    const response = await this.request("/api/plugins/scenevoice/line-edits", {
      method: "POST",
      body: JSON.stringify({
        line_key: key,
        chat_id: this.currentChatId(),
        value: edit,
        place,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "대사 설정 저장 실패");
    if (this.lineState) {
      this.lineState.edits[key] = {
        value: result.value,
        place,
        updated_at: new Date().toISOString(),
      };
      this.lineState.loose = null;
    }
    return result.value;
  },
  async saveLineEdit(button, value) {
    const operation = this.captureChat();
    const key = this.lineIdentity(button);
    const previous = button.lineSaving;
    const work = (async () => {
      await previous;
      await this.loadLineState();
      this.assertChat(operation);
      const place = this.lineSpot(button);
      const response = await this.request(
        "/api/plugins/scenevoice/line-edits",
        {
          method: "POST",
          body: JSON.stringify({
            line_key: key,
            chat_id: this.currentChatId(),
            value,
            place,
            keep: this.lineBorrowsEdit(button),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "대사 설정 저장 실패");
      this.assertChat(operation);
      if (key !== this.lineIdentity(button))
        throw new DOMException("메시지가 변경되었습니다.", "AbortError");
      this.lineState.edits[key] = {
        value: result.value,
        place,
        updated_at: new Date().toISOString(),
      };
      this.lineState.loose = null;
      delete this.lineState.audio[key];
      button.lineEdit = result.value;
      button.lineKey = key;
      button.lineSignature = "";
      button.dataset.speakerOverride = result.value.speaker_key || "";
      const select = button
        .closest(".sv-inline-actions")
        ?.querySelector(".sv-speaker-select");
      if (select) select.value = button.dataset.speakerOverride;
      this.analysisCache.clear();
    })();
    button.lineSaving = work;
    try {
      await work;
    } finally {
      if (button.lineSaving === work) button.lineSaving = null;
    }
  },
  async editLine(button) {
    if (["queued", "generating"].includes(button.dataset.status)) return;
    const operation = this.captureChat();
    // The window opens at once; a line not analysed yet is filled in when the analysis is back.
    document.getElementById("sv-line-editor")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-line-editor";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-pen"></i></span>
        <div><h3>이 대사의 화자·연기</h3><small>${button.dataset.kind === "thought" ? "생각" : "대사"} · 분석 결과를 확인하고 고칩니다</small></div>
        ${infoTip(
          [
            "맨 앞 태그는 대사 전체의 감정·말투, 중간 태그는 그 자리의 소리([sighs], [chuckles])나 말투 변화([whispers])입니다.",
            "ElevenLabs는 태그를 그 자리에서 연기합니다. Fish는 맨 앞 태그들을 [frustrated, emphatic]처럼 하나로 묶고, 중간 태그는 그대로 보냅니다.",
            "태그 효과는 목소리·모델마다 다릅니다. 태그를 모두 지우면 원문만 읽습니다.",
            "AI 분석 다시는 직접 고친 내용을 지우고 이 대사만 보조모델로 다시 분석해 칸을 채웁니다(요청 1번). 결과는 바로 쓰이고, 더 고치려면 고친 뒤 저장하십시오.",
            "메시지를 고치거나 다른 스와이프로 바꾸면 그 버전의 지정만 적용합니다.",
          ].join("\n"),
          "대사 편집 설명",
        )}
      </header>
      <blockquote class="sv-line-text">${escapeHtml(button.dataset.text)}</blockquote>
      <p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>저장만 하며 음성은 만들지 않습니다. 저장한 뒤 재생 버튼이나 메시지의 이어 듣기 버튼으로 생성하십시오.</span></p>
      <div class="sv-row">
        ${fieldHtml({ id: "sv-edit-speaker", label: "화자", control: '<select id="sv-edit-speaker"></select>' })}
        ${fieldHtml({ id: "sv-edit-language", label: "언어", control: `<select id="sv-edit-language">${LANGUAGE_CHOICES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>` })}
      </div>
      ${fieldHtml({ id: "sv-edit-script", label: "태그 넣은 대사", control: '<textarea id="sv-edit-script" rows="3" maxlength="12000" autocomplete="off" spellcheck="false"></textarea>', hint: "대사 글자는 그대로 두고 [대괄호] 태그만 넣거나 빼십시오. 감정·말투는 맨 앞에, 소리는 커서 자리에 들어갑니다." })}
      <p class="sv-script-check" id="sv-edit-script-check" role="status"></p>
      <div class="sv-tag-group"><span>감정·말투</span><div class="sv-tag-picks" data-place="lead" role="group" aria-label="감정·말투 태그를 맨 앞에 넣기">${chips(tagSuggestions(this.availableEmotions))}</div></div>
      <div class="sv-tag-group"><span>소리</span><div class="sv-tag-picks" data-place="cursor" role="group" aria-label="소리 태그를 커서 자리에 넣기">${chips(SOUND_TAGS)}</div></div>
      <footer class="sv-dialog-actions">
        <button type="button" id="sv-edit-reanalyze" class="sv-btn sv-btn-ghost"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>AI 분석 다시</span></button>
        <span class="sv-spacer"></span>
        <button type="submit" class="sv-btn">닫기</button>
        <button type="button" id="sv-edit-save" class="sv-btn sv-btn-primary"><i class="fa-solid fa-check" aria-hidden="true"></i><span>이 대사에 저장</span></button>
      </footer>
    </form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      button.focus();
    });
    const controls = [
      ...dialog.querySelectorAll(
        "select, textarea, .sv-tag-pick, #sv-edit-save, #sv-edit-reanalyze",
      ),
    ];
    controls.forEach((control) => {
      control.disabled = true;
    });
    const loading = dialog.querySelector("#sv-edit-script-check");
    loading.dataset.state = "";
    loading.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 이 대사의 분석 결과를 불러오는 중…';
    dialog.showModal();
    let key, result, unanalysed;
    try {
      await button.lineSaving;
      await this.hydrateLines(
        button.closest(".mes_text,.message-body,.markdown-content"),
      );
      key = this.lineIdentity(button);
      // Opening the window is not asking for an analysis: a line not analysed yet shows as it is
      // (AI 분석 does it on request).
      result = button.lineEdit?.performance
        ? {
            ...button.lineEdit.performance,
            speaker_key: button.lineEdit.speaker_key,
          }
        : await this.analyzeUtterance(button, { storedOnly: true });
      unanalysed = !result;
      result ||= this.fallbackAnalysis(
        button.dataset.text || "",
        Number(button.dataset.quoteIndex || 0),
      );
      this.assertChat(operation);
    } catch (error) {
      if (dialog.open) dialog.close();
      throw error;
    }
    // Closed while waiting, or the message changed meanwhile.
    if (!dialog.open) return;
    if (!button.isConnected || key !== this.lineIdentity(button)) {
      dialog.close();
      return;
    }
    controls.forEach((control) => {
      control.disabled = false;
    });
    const roster = this.speakerCatalog();
    const speakerField = dialog.querySelector("#sv-edit-speaker");
    speakerField.append(...roster.map((x) => new Option(x.name, x.key)));
    const line = button.dataset.text || "";
    const field = dialog.querySelector("#sv-edit-script");
    const check = dialog.querySelector("#sv-edit-script-check");
    const saveButton = dialog.querySelector("#sv-edit-save");
    // The fields from an analysis (the saved one, or a new one after AI 분석 다시).
    const fill = () => {
      const speaker = this.resolvedSpeaker(button, result);
      if (
        ![...speakerField.options].some(
          (option) => option.value === speaker.key,
        )
      )
        speakerField.prepend(new Option(speaker.name, speaker.key));
      speakerField.value = speaker.key;
      dialog.querySelector("#sv-edit-language").value = result.language || "ko";
      const tags = normalizeTags(result);
      field.value =
        result.script || (tags.length ? `${bracketed(tags)} ${line}` : line);
    };
    fill();
    // Removing the tags must give back the line; otherwise saving is blocked.
    const validate = () => {
      const same = keepsLine(field.value, line);
      check.dataset.state = same ? "ok" : "error";
      check.textContent = same
        ? "원래 대사와 글자가 같습니다."
        : "대사 글자가 바뀌었습니다. 태그만 넣고 빼 주십시오.";
      saveButton.disabled = !same;
      return same;
    };
    // Emotion and delivery chips join the leading tags; sound chips go where the cursor was
    // (the end of the line until the cursor is placed).
    let caret = null;
    const remember = () => {
      caret = field.selectionStart;
    };
    for (const type of ["click", "keyup", "select", "input"])
      field.addEventListener(type, remember);
    field.addEventListener("input", validate);
    dialog.querySelectorAll(".sv-tag-picks").forEach((group) =>
      group.addEventListener("click", (event) => {
        const chip = event.target.closest(".sv-tag-pick");
        if (!chip) return;
        const value = field.value;
        const lead = /^(?:\s*\[[^\[\]]+\])*/.exec(value)[0].length;
        const at =
          group.dataset.place === "lead"
            ? lead
            : Math.min(caret ?? value.length, value.length);
        const before = value.slice(0, at);
        const after = value.slice(at);
        const tag = `[${chip.dataset.tag}]`;
        const left = before && !/[\s\]]$/.test(before) ? " " : "";
        const right = after && !/^[\s[]/.test(after) ? " " : "";
        field.value = `${before}${left}${tag}${right}${after}`;
        const added = left.length + tag.length + right.length;
        // A leading tag shifts the remembered cursor; a sound leaves the cursor after itself.
        if (group.dataset.place === "lead") {
          if (caret !== null && caret >= at) caret += added;
        } else caret = at + added;
        if (caret !== null) {
          // On a phone the keyboard stays down while tags are tapped in.
          if (!this.isMobilePhoneLayout()) field.focus();
          field.setSelectionRange(caret, caret);
        }
        validate();
      }),
    );
    validate();
    const againLabel = dialog.querySelector("#sv-edit-reanalyze span");
    if (unanalysed) {
      againLabel.textContent = "AI 분석";
      check.textContent =
        "아직 분석하지 않은 대사입니다. 필요하면 ‘AI 분석’을 누르십시오.";
    }
    const save = async () => {
      this.assertChat(operation);
      if (!validate())
        throw new Error(
          "대사 글자가 바뀌어 저장할 수 없습니다. 태그만 넣고 빼 주십시오.",
        );
      if (!button.isConnected || key !== this.lineIdentity(button))
        throw new Error("메시지가 변경되었습니다. 다시 열어 주십시오.");
      this.cancelLineAudio(button);
      const value = {
        speaker_key: dialog.querySelector("#sv-edit-speaker").value,
        performance: {
          script: cleanScript(field.value, line),
          tags: normalizeTags({ script: cleanScript(field.value, line) }),
          language: dialog.querySelector("#sv-edit-language").value,
          intensity: result.intensity ?? 0.5,
        },
      };
      dialog.querySelectorAll("button").forEach((x) => {
        x.disabled = true;
      });
      try {
        await this.saveLineEdit(button, value);
        await this.hydrateLines(
          button.closest(".mes_text,.message-body,.markdown-content"),
        );
        dialog.close();
        this.notify("이 대사의 화자와 연기를 저장했습니다.", "success");
      } finally {
        dialog.querySelectorAll("button").forEach((x) => {
          x.disabled = false;
        });
      }
    };
    dialog.querySelector("#sv-edit-save").onclick = () =>
      this.run(() => save());
    // AI 분석 다시: hand edits go, and this one line is analysed again (one request); the new
    // result is used at once and shown here to keep or adjust.
    const again = dialog.querySelector("#sv-edit-reanalyze");
    again.onclick = () =>
      this.run(async () => {
        this.assertChat(operation);
        if (!button.isConnected || key !== this.lineIdentity(button))
          throw new Error("메시지가 변경되었습니다. 다시 열어 주십시오.");
        controls.forEach((control) => {
          control.disabled = true;
        });
        const icon = again.querySelector("i");
        icon.className = "fa-solid fa-spinner fa-spin";
        check.dataset.state = "";
        check.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 이 대사를 다시 분석하는 중…';
        try {
          this.cancelLineAudio(button);
          if (button.lineEdit) await this.saveLineEdit(button, {});
          result = await this.analyzeUtterance(button, { force: true });
          this.assertChat(operation);
          fill();
        } finally {
          icon.className = "fa-solid fa-wand-magic-sparkles";
          controls.forEach((control) => {
            control.disabled = false;
          });
          validate();
        }
        check.textContent = `${unanalysed ? "분석했습니다" : "다시 분석했습니다"}. ${check.textContent}`;
        unanalysed = false;
        againLabel.textContent = "AI 분석 다시";
      });
  },
};
