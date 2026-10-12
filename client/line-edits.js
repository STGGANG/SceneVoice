// 대사별 수정: a line's saved speaker/performance edit and saved voice, and the 화자·연기 editor.
import { contentKey } from "../shared/hash.js";
import { escapeHtml, normalizeTags, LANGUAGE_CHOICES } from "./common.js";
import { infoTip, fieldHtml, bindInfoTips } from "./ui.js";
import {
  SOUND_TAGS,
  cleanScript,
  keepsLine,
  tagSuggestions,
} from "../shared/providers.js";
const bracketed = (tags) => tags.map((tag) => `[${tag}]`).join("");
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
  shaky: "떨리는 목소리",
  hesitant: "머뭇거리며",
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
  smooch: "쪽 (뽀뽀)",
};
const chips = (tags) =>
  tags
    .map(
      (tag) =>
        `<button type="button" class="sv-tag-pick" data-tag="${escapeHtml(tag)}" title="[${escapeHtml(tag)}]">${escapeHtml(TAG_LABELS[tag] || tag)}</button>`,
    )
    .join("");

export const lineEdits = {
  lineConfigKey() {
    const engine = (name) =>
      Object.fromEntries(
        Object.entries(this.config[name] || {}).filter(
          ([key]) => !["api_key", "has_api_key", "clear_api_key"].includes(key),
        ),
      );
    return contentKey({
      engine: this.config.engine,
      elevenlabs: engine("elevenlabs"),
      fish: engine("fish"),
      voices: this.config.character_voices,
      notes: this.config.character_notes,
      reading: this.config.reading,
      language: this.config.default_language,
      analysis: this.config.analysis_enabled,
      casting: this.config.casting,
      llm: this.config.llm,
      context: this.config.context_messages,
      connection:
        this.connectionService?.fingerprint?.(
          this.config.connection_profile_id,
        ) || this.config.connection_profile_id,
    });
  },
  /** A line's key: its chat, message (as written now), place, kind and words. Kept per button. */
  lineIdentity(button) {
    const value = {
      chat: this.currentChatId(),
      message: button.dataset.messageId,
      source: this.anchorFingerprint(button.dataset.messageId),
      index: button.dataset.quoteIndex,
      kind: button.dataset.kind,
      text: button.dataset.text,
    };
    const input = Object.values(value).join("\u0000");
    if (button.identityInput !== input) {
      button.identityInput = input;
      button.identityKey = contentKey(value);
    }
    return button.identityKey;
  },
  async loadLineState() {
    if (!this.lineStatePromise) {
      const operation = this.captureChat();
      const requestedAt = Date.now();
      this.lineStatePromise = (async () => {
        const response = await this.request(
          `/api/plugins/scenevoice/line-state?chat_id=${encodeURIComponent(this.currentChatId())}&config_key=${this.lineConfigKey()}`,
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || "대사 설정을 읽지 못했습니다.");
        this.assertChat(operation);
        data.requestedAt = requestedAt;
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
        (button.dataset.madeAt && Number(button.dataset.madeAt) >= (state.requestedAt || 0))
      )
        continue;
      const key = this.lineIdentity(button);
      const edit = state.edits[key]?.value || {};
      // A line whose message was analysed again is made again (the same acting comes back
      // from the saved voices without a new request).
      const audio = this.staleLines?.has(key) ? null : state.audio[key];
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
      if (edit.speaker_key) this.applyLineVisibility?.(button, edit.speaker_key);
      const select = button
        .closest(".sv-inline-actions")
        ?.querySelector(".sv-speaker-select");
      if (select) select.value = edit.speaker_key || "";
      if (audio?.audio_url && button.dataset.status !== "ready") {
        button.dataset.audioUrl = audio.audio_url;
        button.dataset.historyId = audio.id;
        button.dataset.speakerName = audio.speaker_key === "__default__" ? "" : audio.speaker_name || "";
        button.dataset.status = "ready";
        button.classList.remove("sv-error");
        button.classList.add("sv-ready");
        this.setPlayButtonIcon(button, "ready");
        button.title = `저장된 음성 · ${audio.speaker_name || ""} · ${audio.applied_control || "기본 연기"}`;
      }
    }
  },
  async saveLineEdit(button, value) {
    const operation = this.captureChat();
    const key = this.lineIdentity(button);
    const previous = button.lineSaving;
    const work = (async () => {
      await previous;
      await this.loadLineState();
      this.assertChat(operation);
      const response = await this.request(
        "/api/plugins/scenevoice/line-edits",
        {
          method: "POST",
          body: JSON.stringify({
            line_key: key,
            chat_id: this.currentChatId(),
            value,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "대사 설정 저장 실패");
      this.assertChat(operation);
      if (key !== this.lineIdentity(button))
        throw new DOMException("메시지가 변경되었습니다.", "AbortError");
      this.lineState.edits[key] = { value: result.value };
      delete this.lineState.audio[key];
      button.lineEdit = result.value;
      button.lineKey = key;
      button.lineSignature = "";
      button.dataset.speakerOverride = result.value.speaker_key || "";
      const select = button.closest(".sv-inline-actions")?.querySelector(".sv-speaker-select");
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
            "AI 분석 다시는 직접 고친 내용을 지우고 이 대사만 보조모델로 다시 분석해 칸을 채웁니다(요청 1번). 결과는 바로 쓰이고, 더 고치려면 고친 뒤 저장하세요.",
            "메시지를 고치거나 다른 스와이프로 바꾸면 그 버전의 지정만 적용합니다.",
          ].join("\n"),
          "대사 편집 설명",
        )}
      </header>
      <blockquote class="sv-line-text">${escapeHtml(button.dataset.text)}</blockquote>
      <p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>저장만 하며 음성은 만들지 않습니다. 저장한 뒤 재생 버튼이나 음성 준비로 생성하세요.</span></p>
      <div class="sv-row">
        ${fieldHtml({ id: "sv-edit-speaker", label: "화자", control: '<select id="sv-edit-speaker"></select>' })}
        ${fieldHtml({ id: "sv-edit-language", label: "언어", control: `<select id="sv-edit-language">${LANGUAGE_CHOICES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>` })}
      </div>
      ${fieldHtml({ id: "sv-edit-script", label: "태그 넣은 대사", control: '<textarea id="sv-edit-script" rows="3" maxlength="12000" autocomplete="off" spellcheck="false"></textarea>', hint: "대사 글자는 그대로 두고 [대괄호] 태그만 넣거나 빼세요. 감정·말투는 맨 앞에, 소리는 커서 자리에 들어갑니다." })}
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
    const controls = [...dialog.querySelectorAll("select, textarea, .sv-tag-pick, #sv-edit-save, #sv-edit-reanalyze")];
    controls.forEach((control) => {
      control.disabled = true;
    });
    const loading = dialog.querySelector("#sv-edit-script-check");
    loading.dataset.state = "";
    loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 이 대사의 분석 결과를 불러오는 중…';
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
      result ||= this.fallbackAnalysis(button.dataset.text || "", Number(button.dataset.quoteIndex || 0));
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
      if (![...speakerField.options].some((option) => option.value === speaker.key))
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
        : "대사 글자가 바뀌었습니다. 태그만 넣고 빼 주세요.";
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
          group.dataset.place === "lead" ? lead : Math.min(caret ?? value.length, value.length);
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
      check.textContent = "아직 분석하지 않은 대사입니다. 필요하면 ‘AI 분석’을 누르세요.";
    }
    const save = async () => {
      this.assertChat(operation);
      if (!validate())
        throw new Error("대사 글자가 바뀌어 저장할 수 없습니다. 태그만 넣고 빼 주세요.");
      if (!button.isConnected || key !== this.lineIdentity(button))
        throw new Error("메시지가 변경되었습니다. 다시 열어 주세요.");
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
          throw new Error("메시지가 변경되었습니다. 다시 열어 주세요.");
        controls.forEach((control) => {
          control.disabled = true;
        });
        const icon = again.querySelector("i");
        icon.className = "fa-solid fa-spinner fa-spin";
        check.dataset.state = "";
        check.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 이 대사를 다시 분석하는 중…';
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
