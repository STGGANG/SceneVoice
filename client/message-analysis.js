// 분석 보기: a message's lines with who says each and how (the analysis the voices are made
// from), in one window. From there chosen lines are analysed again, a line is put right by hand
// (the line editor) or its voice is made again.

import { escapeHtml, normalizeTags, tagsText } from "./common.js";

/** A tagged line with its [tags] set apart for the eye. */
const taggedHtml = (script) =>
  escapeHtml(script).replace(/\[[^\[\]\r\n]{1,160}\]/g, "<em>$&</em>");

export const messageAnalysis = {
  /** The message's lines: the ones on screen, or the source lines under a translation. */
  messageLines(container) {
    const source = this.sourceLineButtons(container);
    return {
      host: source ? source.host : container,
      buttons: source
        ? source.buttons
        : [...container.querySelectorAll(".sv-play-btn")],
    };
  },

  /** What the window shows of each line: who, how, and whether a voice is made. */
  async messageAnalysisRows(buttons) {
    await this.loadLineState();
    const kept = buttons.length
      ? (await this.keptMessageAnalyses(buttons[0])).analyses || []
      : [];
    return buttons.map((button, index) => {
      const edit = this.lineEditOf(button);
      // A line with a voice but no analysis kept (an old message, or one analysed before an
      // update) shows how that voice was made: its record has the tagged line and the speaker.
      const made = this.lineAudioOf(button);
      const fromVoice = made
        ? {
            script: made.script || "",
            tags: made.tags || [],
            speaker_key:
              made.speaker_key === "__default__" ? "" : made.speaker_key,
          }
        : null;
      const analysis = edit.performance
        ? { ...edit.performance, speaker_key: edit.speaker_key }
        : kept[index] || fromVoice;
      const line = button.dataset.text || "";
      const tags = analysis ? tagsText(normalizeTags(analysis)) : "";
      return {
        button,
        thought: button.dataset.kind === "thought",
        speaker: analysis
          ? this.resolvedSpeaker(button, analysis).name
          : this.messageSpeaker(button).name,
        unsure:
          Boolean(analysis?.needs_confirmation) &&
          !button.dataset.speakerOverride &&
          !edit.speaker_key,
        script: analysis?.script || (tags ? `${tags} ${line}` : line),
        analysed: Boolean(analysis),
        edited: Boolean(edit.performance || edit.speaker_key),
        voiced: button.dataset.status === "ready",
        busy: ["queued", "generating"].includes(button.dataset.status),
      };
    });
  },

  async openMessageAnalysis(container, control) {
    if (this.messageJobs.has(control)) {
      this.notify("이어 듣기가 끝난 뒤에 열어 주십시오.", "info");
      return;
    }
    const operation = this.captureChat();
    const { host, buttons } = this.messageLines(container);
    if (!buttons.length) return;
    await this.hydrateLines(host);
    document.getElementById("sv-analysis-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-analysis-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
        <div><h3>이 메시지의 대사 분석</h3><small>화자와 연기를 확인하고, 골라서 다시 분석하거나 고칩니다</small></div>
      </header>
      <label class="sv-ma-all"><input type="checkbox" data-ma-all><span>전체 선택</span><small data-ma-count></small></label>
      <ul class="sv-ma-list" data-ma-list></ul>
      <p class="sv-script-check" data-ma-status role="status"></p>
      <footer class="sv-dialog-actions">
        <button type="button" class="sv-btn sv-btn-primary" data-ma-again disabled title="고른 대사만 새 분석으로 바꿉니다. 몇 개를 고르든 메시지를 한 번에 보내므로 요청은 1번이고, 고르지 않은 대사의 분석은 그대로 둡니다. 직접 고친 대사를 고르면 고친 내용은 지워집니다."><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>고른 대사 다시 분석</span><span class="sv-badge sv-cost"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>요청 1회</span></button>
        <span class="sv-spacer"></span>
        <button type="button" class="sv-btn" data-ma-save-all title="전체 내려받기: 이 메시지에서 만든 음성을 읽는 순서대로 이어 붙인 파일 하나로(WAV)"><i class="fa-solid fa-download" aria-hidden="true"></i><span>전체 내려받기</span></button>
        <button type="submit" class="sv-btn">닫기</button>
      </footer>
    </form>`;
    document.body.append(dialog);
    const list = dialog.querySelector("[data-ma-list]");
    const all = dialog.querySelector("[data-ma-all]");
    const again = dialog.querySelector("[data-ma-again]");
    const status = dialog.querySelector("[data-ma-status]");
    const chosen = new Set();
    let watch = null;
    const note = () => {
      dialog.querySelector("[data-ma-count]").textContent = chosen.size
        ? `${chosen.size}개 고름`
        : "";
      all.checked = chosen.size === buttons.length;
      all.indeterminate = chosen.size > 0 && chosen.size < buttons.length;
      again.disabled = !chosen.size || again.dataset.busy === "1";
    };
    const draw = async () => {
      const rows = await this.messageAnalysisRows(buttons);
      if (!dialog.isConnected) return;
      list.innerHTML = rows
        .map(
          (row, index) => `<li class="sv-ma-line" data-index="${index}">
            <input type="checkbox" data-ma-pick aria-label="${index + 1}번 대사를 다시 분석에 넣기" ${chosen.has(index) ? "checked" : ""}>
            <div class="sv-ma-main">
              <div class="sv-ma-meta"><strong>${escapeHtml(row.speaker)}</strong>${row.thought ? '<span class="sv-badge">생각</span>' : ""}${row.unsure ? '<span class="sv-badge sv-badge-warn">화자 확인 필요</span>' : ""}${row.edited ? '<span class="sv-badge">직접 고침</span>' : ""}${row.analysed ? "" : '<span class="sv-badge">분석 전</span>'}${row.voiced ? '<span class="sv-badge sv-badge-on">음성 있음</span>' : ""}</div>
              <p class="sv-ma-script">${taggedHtml(row.script)}</p>
            </div>
            <div class="sv-ma-tools">
              <button type="button" class="sv-icon-btn" data-ma-play aria-label="${index + 1}번 대사 듣기" title="${row.voiced ? "듣기" : "음성을 만들어 듣기"}"><i class="fa-solid ${row.busy ? "fa-spinner fa-spin" : "fa-play"}" aria-hidden="true"></i></button>
              <button type="button" class="sv-icon-btn" data-ma-reroll aria-label="${index + 1}번 대사 음성 재생성" title="음성 재생성: 같은 분석으로 목소리만 새로 만듭니다" ${row.busy ? "disabled" : ""}><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button>
              <button type="button" class="sv-icon-btn" data-ma-edit aria-label="${index + 1}번 대사 고치기" title="고치기: 화자와 태그를 직접 바꿉니다"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
              <button type="button" class="sv-icon-btn" data-ma-save aria-label="${index + 1}번 대사 음성 내려받기" title="${row.voiced ? "내려받기: 이 대사의 음성만 파일로(WAV)" : "음성을 만든 뒤에 내려받을 수 있습니다"}" ${row.voiced ? "" : "disabled"}><i class="fa-solid fa-download" aria-hidden="true"></i></button>
            </div>
          </li>`,
        )
        .join("");
      note();
      // A voice being made shows as done once it is.
      clearTimeout(watch);
      if (rows.some((row) => row.busy)) watch = setTimeout(draw, 900);
    };
    const stale = () => {
      this.assertChat(operation);
      if (buttons.some((button) => !button.isConnected && host.isConnected))
        throw new Error("메시지가 바뀌었습니다. 창을 다시 열어 주십시오.");
    };
    all.addEventListener("change", () => {
      chosen.clear();
      if (all.checked) buttons.forEach((_, index) => chosen.add(index));
      list
        .querySelectorAll("[data-ma-pick]")
        .forEach((box) => (box.checked = all.checked));
      note();
    });
    list.addEventListener("change", (event) => {
      const box = event.target.closest("[data-ma-pick]");
      if (!box) return;
      const index = Number(box.closest("[data-index]").dataset.index);
      if (box.checked) chosen.add(index);
      else chosen.delete(index);
      note();
    });
    list.addEventListener("click", (event) => {
      const tool = event.target.closest("button");
      if (!tool) return;
      const button =
        buttons[Number(tool.closest("[data-index]").dataset.index)];
      this.run(async () => {
        stale();
        if (tool.matches("[data-ma-play]")) this.handlePlayClick(button);
        else if (tool.matches("[data-ma-save]"))
          await this.downloadLineAudio(button);
        else if (tool.matches("[data-ma-reroll]"))
          this.handleRerollClick(button);
        else {
          const opened = this.editLine(button);
          // Back from the line editor: what was saved there shows here.
          document
            .getElementById("sv-line-editor")
            ?.addEventListener("close", () => this.run(draw), { once: true });
          await opened;
          return;
        }
        await draw();
      });
    });
    again.addEventListener("click", () =>
      this.run(async () => {
        stale();
        again.dataset.busy = "1";
        note();
        status.dataset.state = "";
        status.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> 다시 분석하는 중…';
        try {
          await this.reanalyzeChosen(control, buttons, chosen);
          status.dataset.state = "ok";
          status.textContent = `${chosen.size}개 대사를 다시 분석했습니다. 다음에 들을 때 이 대사들의 음성을 새로 만듭니다.`;
          chosen.clear();
        } catch (error) {
          status.dataset.state = "error";
          status.textContent = `다시 분석하지 못했습니다: ${error.message || "요청 실패"}`;
          if (error.name === "AbortError") throw error;
        } finally {
          again.dataset.busy = "";
          if (dialog.isConnected) await draw();
        }
      }),
    );
    dialog.querySelector("[data-ma-save-all]").addEventListener("click", () =>
      this.run(async () => {
        stale();
        await this.downloadMessageAudio(container, buttons);
      }),
    );
    dialog.addEventListener("close", () => {
      clearTimeout(watch);
      dialog.remove();
    });
    await draw();
    dialog.showModal();
    dialog
      .querySelector('button[type="submit"]')
      .focus({ preventScroll: true });
  },

  /**
   * 고른 대사 다시 분석: hand edits of the chosen lines go, the message is analysed again (one
   * request) with the other lines keeping their analysis, and the chosen lines' voices are made
   * anew the next time they are heard.
   */
  async reanalyzeChosen(control, buttons, chosen) {
    if (this.messageJobs.has(control))
      throw new Error("이어 듣기가 끝난 뒤에 다시 해 주십시오.");
    const picked = buttons.filter((_, index) => chosen.has(index));
    if (!picked.length) return;
    for (const line of picked)
      if (line.lineEdit && Object.keys(line.lineEdit).length)
        await this.saveLineEdit(line, {});
    await this.reanalyzeLines(buttons[0], chosen);
    this.staleLines ||= new Set();
    for (const line of picked) {
      this.staleLines.add(this.lineIdentity(line));
      if (line.dataset.status === "ready") this.cancelLineAudio(line);
      line.lineSignature = "";
    }
    const playback = this.messagePlayback?.get(control);
    if (playback) playback.position = 0;
    this.setGenerateState(control, "play");
    control.title =
      "새 분석으로 처음부터 들려줍니다. 연기가 바뀐 대사만 새로 만듭니다.";
  },
};
