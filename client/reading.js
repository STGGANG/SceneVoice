import { escapeHtml } from "./common.js";
import { DEFAULT_READING_RULES } from "../shared/segments.js";
import { groupHtml, switchHtml } from "./ui.js";

// "읽을 구간": which marked regions of a message get a play button, and how they are read.

const PRESET_NAMES = {
  "double-curly": "큰따옴표",
  "double-straight": "곧은 따옴표",
  corner: "낫표",
  "white-corner": "겹낫표",
  "single-curly": "작은따옴표",
  "single-straight": "곧은 작은따옴표",
  asterisk: "별표",
  paren: "괄호",
};

/** A rule keeps its preset name only while it still uses that preset's marks. */
function ruleName(rule) {
  const preset = DEFAULT_READING_RULES.find(
    (item) => item.open === rule.open && item.close === rule.close,
  );
  return preset ? PRESET_NAMES[preset.id] : "직접 지정";
}

function ruleRow(rule) {
  const name = ruleName(rule);
  const kind = rule.kind === "thought" ? "thought" : "dialogue";
  return `<li class="sv-read-rule" data-rule-id="${escapeHtml(rule.id)}" data-kind="${kind}">
    <input type="checkbox" class="sv-switch" data-rule-field="enabled" ${rule.enabled !== false ? "checked" : ""} aria-label="${escapeHtml(name)} 구간 읽기">
    <span class="sv-read-name">${escapeHtml(name)}</span>
    <span class="sv-read-marks">
      <input type="text" data-rule-field="open" value="${escapeHtml(rule.open)}" maxlength="12" autocomplete="off" spellcheck="false" aria-label="시작 기호" placeholder="시작">
      <span class="sv-read-dots" aria-hidden="true">…</span>
      <input type="text" data-rule-field="close" value="${escapeHtml(rule.close)}" maxlength="12" autocomplete="off" spellcheck="false" aria-label="끝 기호" placeholder="끝">
    </span>
    <select data-rule-field="kind" aria-label="읽는 방식">
      <option value="dialogue" ${kind === "dialogue" ? "selected" : ""}>대사로 읽기</option>
      <option value="thought" ${kind === "thought" ? "selected" : ""}>생각·묘사로 읽기</option>
    </select>
    <button type="button" class="sv-icon-btn sv-read-remove" data-rule-remove aria-label="${escapeHtml(name)} 구간 삭제" title="구간 삭제"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
  </li>`;
}

export const reading = {
  readingGroupHtml(config) {
    const rules = config.reading?.rules || DEFAULT_READING_RULES;
    return groupHtml({
      id: "sv-group-reading",
      icon: "quote-left",
      title: "읽을 구간",
      scope: "채팅 대사",
      tip: [
        "구간이 겹치면 바깥 구간 하나로 읽습니다. 예: “대사 *생각* 대사”는 따옴표가 먼저 시작하므로 *생각*까지 포함한 한 대사로 읽고, “대사” *생각* “대사”처럼 따로 떨어져 있으면 세 구간을 각각 읽습니다.",
        "곧은 작은따옴표(')는 don't, it's처럼 단어 안에 들어간 아포스트로피는 구간으로 보지 않습니다.",
        "*…* 구간은 화면에서 기울임꼴로 바뀌어도 메시지 원문과 비교해 찾습니다. **굵게**는 *…* 구간으로 보지 않습니다(대사 안의 굵은 글씨는 대사와 함께 읽음). 코드와 역슬래시로 막은 기호는 읽지 않습니다.",
        "다른 확장이 원문을 크게 바꾸면 일부 버튼이 붙지 않을 수 있습니다.",
      ].join("\n"),
      body: `<p class="sv-hint sv-read-lead">기호로 감싼 글 옆에 재생 버튼을 붙입니다. <b>생각·묘사로 읽기</b>를 고르면 인물의 생각 목소리(지정했을 때)로 읽고, 보조모델에게도 속마음·지문이라고 알려 줍니다.</p>
      <ul class="sv-read-list" id="sv-reading-rules">${rules.map(ruleRow).join("")}</ul>
      <div class="sv-read-actions">
        <button type="button" class="sv-btn sv-btn-sm" id="sv-reading-add"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>구간 추가</span></button>
        <button type="button" class="sv-btn sv-btn-ghost sv-btn-sm" id="sv-reading-reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>기본 구간으로</span></button>
      </div>
      <hr class="sv-divider">
      ${switchHtml({ id: "sv-thought-effect", label: "생각·묘사는 속마음처럼 들리게", hint: "생각·묘사로 읽는 구간을 재생할 때 소리를 조금 작고 부드럽게 하고, 살짝 울림을 더합니다.", checked: config.reading?.thought_effect !== false, tip: "재생할 때만 입히는 효과라 저장된 음성 파일은 그대로입니다." })}`,
    });
  },

  bindReadingRules() {
    const group = document.getElementById("sv-group-reading");
    const list = document.getElementById("sv-reading-rules");
    if (!group || !list) return;
    const changed = () => {
      this.settingsDirty = true;
      this.scheduleSettingsSave(250);
    };
    group.addEventListener("click", (event) => {
      if (event.target.closest("#sv-reading-add")) {
        const id = `custom-${Date.now().toString(36)}`;
        list.insertAdjacentHTML(
          "beforeend",
          ruleRow({ id, open: "", close: "", kind: "dialogue", enabled: true }),
        );
        return;
      }
      if (event.target.closest("#sv-reading-reset")) {
        if (!confirm("읽을 구간을 기본값(큰따옴표·곧은 따옴표·별표 켜짐, 나머지 꺼짐)으로 되돌릴까요?"))
          return;
        list.innerHTML = DEFAULT_READING_RULES.map(ruleRow).join("");
        changed();
        return;
      }
      const remove = event.target.closest("[data-rule-remove]");
      if (remove) {
        remove.closest(".sv-read-rule")?.remove();
        changed();
      }
    });
    list.addEventListener("input", (event) => {
      const row = event.target.closest(".sv-read-rule");
      if (!row) return;
      if (event.target.matches('[data-rule-field="kind"]'))
        row.dataset.kind = event.target.value;
      const open = row.querySelector('[data-rule-field="open"]').value.trim();
      const close = row.querySelector('[data-rule-field="close"]').value.trim();
      row.querySelector(".sv-read-name").textContent = ruleName({ open, close });
      // A new row is saved once both marks are filled in.
      row.classList.toggle("sv-read-incomplete", !open || !close);
    });
  },

  /** Rows with both marks; a row still being filled in is left out of the save. */
  collectReadingRules() {
    const list = document.getElementById("sv-reading-rules");
    if (!list) return structuredClone(this.config.reading?.rules || DEFAULT_READING_RULES);
    return [...list.querySelectorAll(".sv-read-rule")]
      .map((row) => ({
        id: row.dataset.ruleId,
        open: row.querySelector('[data-rule-field="open"]').value.trim(),
        close: row.querySelector('[data-rule-field="close"]').value.trim(),
        kind: row.querySelector('[data-rule-field="kind"]').value,
        enabled: row.querySelector('[data-rule-field="enabled"]').checked,
      }))
      .filter((rule) => rule.open && rule.close);
  },
};
