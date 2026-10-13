import { escapeHtml, stripMarkup, clamp, simpleHash } from "./common.js";
import { infoTip, emptyHtml } from "./ui.js";
import { URGENCY_WEIGHT, BUSY_WEIGHT, CHANCE_CAP, RECENT_WEIGHT } from "./outreach.js";

// 상태 탭: the people's saved states, a picker between them, and the hand editor.
// The tracking itself (asking the helper model, saving rounds) is in character.js.

// Fields of each state section, in display order, and their Korean labels.
const STATE_FIELDS = [
  ["physical", "신체", "person", "body", ["condition", "injuries", "energy", "location", "summary"]],
  ["emotional", "감정", "heart", "emotional", ["primary", "secondary", "intensity", "summary"]],
  ["cognitive", "생각", "lightbulb", "mind", ["focus", "intention", "concern", "summary"]],
  ["social", "관계", "people-arrows", "social", ["relationship", "attitude", "interaction", "summary"]],
];
const STATE_LABELS = {
  condition: "상태",
  injuries: "부상",
  energy: "활력",
  location: "위치",
  primary: "주감정",
  secondary: "부감정",
  intensity: "강도",
  focus: "집중",
  intention: "의도",
  concern: "걱정",
  relationship: "관계",
  attitude: "태도",
  interaction: "상호작용",
  summary: "요약",
};
// Saved as 0–1, edited as a percentage.
const PERCENT_FIELDS = new Set(["energy", "intensity"]);
const PRESENCE_CHOICES = [
  ["", "모름"],
  ["together", "함께 있음"],
  ["apart", "떨어져 있음"],
];
const AVAILABILITY_CHOICES = [
  ["", "모름"],
  ["free", "통화 가능"],
  ["busy", "바쁨"],
  ["asleep", "자는 중"],
];

export const stateTab = {
  /**
   * How the chance of a contact decision came about: (빈도 90% × 긴급 ×1.6 × 바쁨 ×0.5), with the
   * cap and the hold-back for someone who reached out lately.
   */
  contactChanceWhy(decision) {
    if (decision.presence === "together") return " (함께 있어서)";
    if (decision.availability === "asleep") return " (자는 중이라)";
    if (!Number.isFinite(decision.rate)) return "";
    const parts = [`빈도 ${decision.rate}%`, `긴급 ×${URGENCY_WEIGHT[decision.urgency] ?? 0}`];
    if (decision.availability === "busy") parts.push(`바쁨 ×${BUSY_WEIGHT}`);
    const busy = decision.availability === "busy" ? BUSY_WEIGHT : 1;
    const capped = (decision.rate / 100) * (URGENCY_WEIGHT[decision.urgency] ?? 0) * busy > CHANCE_CAP;
    return ` (${parts.join(" × ")}${capped ? `, 최대 ${CHANCE_CAP * 100}%` : ""}${decision.lately ? `, 최근에 연락해서 ×${RECENT_WEIGHT}` : ""})`;
  },

  /** `key`: the person shown; the last 연락 판단 about them, if they were among the candidates. */
  contactStripHtml(contact = {}, key = "") {
    const presence = { together: "함께 있음", apart: "떨어져 있음" }[contact.presence] || "같이 있는지 모름";
    const availability = { free: "통화 가능", busy: "바쁨", asleep: "자는 중" }[contact.availability] || "통화 가능 여부 모름";
    const blocked = contact.presence === "together" || contact.availability === "asleep";
    const decision = (this.lastContactDecisions || []).find((item) => item.callerKey === key);
    const outcome = !decision?.reached ? "이번엔 안 함" : decision.held ? "걸렸지만 이번엔 다른 사람 차례" : "연락함";
    const decisionText = decision
      ? `최근 연락 판단: ${{ incoming_call: "전화", voice_message: "음성 메시지", text_message: "문자" }[decision.type] || decision.type} · 긴급도 ${{ low: "낮음", medium: "보통", high: "높음" }[decision.urgency] || decision.urgency} · 확률 ${Math.round(decision.chance * 100)}%${this.contactChanceWhy(decision)} → ${outcome}`
      : "";
    return `<div class="sv-contact-strip">
        <span class="sv-badge ${blocked ? "" : "sv-badge-on"}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${presence}</span>
        <span class="sv-badge ${contact.availability === "free" ? "sv-badge-on" : ""}"><i class="fa-solid fa-phone" aria-hidden="true"></i>${availability}</span>
        ${contact.note ? `<span class="sv-hint">${escapeHtml(contact.note)}</span>` : ""}
        ${decisionText ? `<span class="sv-hint sv-contact-decision">${escapeHtml(decisionText)}</span>` : ""}
      </div>`;
  },

  stateSectionRows(section = {}) {
    return (
      Object.entries(section)
        .filter(
          ([, value]) => value !== "" && value !== null && value !== undefined,
        )
        .map(([key, value]) => {
          const display =
            typeof value === "number" ? `${Math.round(value * 100)}%` : value;
          return `<div><dt>${escapeHtml(STATE_LABELS[key] || key)}</dt><dd>${escapeHtml(display)}</dd></div>`;
        })
        .join("") || '<div class="sv-state-empty">확인된 내용 없음</div>'
    );
  },

  stateEditorHtml(state = {}) {
    const value = (item) =>
      typeof item === "number" ? `${Math.round(item * 100)}%` : String(item ?? "");
    const choices = (items, selected) =>
      items
        .map(
          ([key, label]) =>
            `<option value="${key}" ${key === (selected || "") ? "selected" : ""}>${label}</option>`,
        )
        .join("");
    const contact = state.contact || {};
    const cards = STATE_FIELDS.map(
      ([section, title, icon, tone, keys]) => `<fieldset class="sv-state-card sv-state-${tone}">
        <legend><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${title}</legend>
        ${keys
          .map((key) => {
            const id = `sv-state-${section}-${key}`;
            return `<label class="sv-state-input" for="${id}"><span>${STATE_LABELS[key]}</span><input type="text" id="${id}" name="${section}.${key}" value="${escapeHtml(value(state[section]?.[key]))}" maxlength="500" autocomplete="off" ${PERCENT_FIELDS.has(key) ? 'inputmode="decimal" placeholder="0–100%"' : ""}></label>`;
          })
          .join("")}
      </fieldset>`,
    ).join("");
    return `<form id="sv-state-form" class="sv-state-form" novalidate>
        <p class="sv-notice"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>고친 상태는 대사 분석과 전화·문자에 바로 쓰이고, ‘행방 모름’ 표시도 풀립니다. 다음 자동 갱신은 이 상태에서 이어서 바뀝니다.</span></p>
        <label class="sv-field" for="sv-state-summary-input"><span class="sv-label-line">한 줄 요약</span><textarea id="sv-state-summary-input" name="summary" rows="2" maxlength="1200" placeholder="비워 두면 아래 내용으로 채웁니다.">${escapeHtml(state.summary || "")}</textarea></label>
        <div class="sv-row sv-row-3">
          <label class="sv-field" for="sv-state-presence"><span class="sv-label-line">함께 있는지</span><select id="sv-state-presence" name="contact.presence">${choices(PRESENCE_CHOICES, contact.presence)}</select></label>
          <label class="sv-field" for="sv-state-availability"><span class="sv-label-line">연락 가능</span><select id="sv-state-availability" name="contact.availability">${choices(AVAILABILITY_CHOICES, contact.availability)}</select></label>
          <label class="sv-field" for="sv-state-contact-note"><span class="sv-label-line">연락 메모</span><input type="text" id="sv-state-contact-note" name="contact.note" value="${escapeHtml(contact.note || "")}" maxlength="300" autocomplete="off" placeholder="예: 야간 근무 중"></label>
        </div>
        <div class="sv-state-grid sv-state-edit-grid">${cards}</div>
        <p class="sv-hint sv-state-stale" hidden>그사이 새 분석 결과가 저장되었습니다. 지금 저장하면 그 결과를 덮어씁니다.</p>
        <div class="sv-state-form-actions">
          <button type="button" class="sv-btn sv-btn-ghost" id="sv-state-cancel"><span>취소</span></button>
          <button type="submit" class="sv-btn sv-btn-accent" id="sv-state-save"><i class="fa-solid fa-check" aria-hidden="true"></i><span>상태 저장</span></button>
        </div>
      </form>`;
  },

  /**
   * Saves a hand-edited state for a person, dated to the latest AI reply. It clears 행방 모름
   * until the model marks them unknown again.
   */
  async saveEditedState(form, person) {
    if (this.stateTrackingBusy)
      throw new Error("상태를 분석하는 중입니다. 끝난 뒤 다시 저장해 주십시오.");
    const data = new FormData(form);
    const field = (name) => String(data.get(name) ?? "").trim();
    const raw = {
      summary: field("summary"),
      contact: {
        presence: field("contact.presence"),
        availability: field("contact.availability"),
        note: field("contact.note"),
      },
    };
    for (const [section, , , , keys] of STATE_FIELDS) {
      raw[section] = {};
      for (const key of keys) {
        const value = field(`${section}.${key}`);
        if (!value) continue;
        raw[section][key] =
          PERCENT_FIELDS.has(key) && /^\d+(\.\d+)?\s*%?$/.test(value)
            ? clamp(parseFloat(value) / 100, 0, 1)
            : value;
      }
    }
    const state = this.normalizeCharacterState(raw);
    if (
      !this.hasCharacterStateContent(state) &&
      !Object.values(state.contact).some(Boolean)
    )
      throw new Error("저장할 상태 내용이 없습니다.");
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const latest = this.latestReplyIndex();
    const sourceMessageId =
      latest < 0 ? "manual" : `${latest}-${simpleHash(stripMarkup(chat[latest].mes))}-manual`;
    await this.saveStateRecord(person.stateKey, person, sourceMessageId, state);
    this.notify(`${person.name}의 상태를 저장했습니다.`, "success");
  },

  /**
   * The person picker above the state: one button per tracked person, marked 행방 모름 (nobody
   * knows where they are) or 장면 밖 (away from the scene, whereabouts known).
   */
  statePickerHtml(people, selected, statuses) {
    if (people.length < 2) return "";
    return `<div class="sv-state-people" role="tablist" aria-label="상태를 볼 인물">${people
      .map((person) => {
        const status = statuses.get(person.key) || {};
        const flag = status.unknown
          ? '<em class="sv-badge sv-badge-warn">행방 모름</em>'
          : status.away
            ? '<em class="sv-badge">장면 밖</em>'
            : "";
        return `<button type="button" role="tab" class="sv-state-person" data-key="${escapeHtml(person.key)}" aria-selected="${person.key === selected.key}">${this.contactAvatarMarkup(person)}<span>${escapeHtml(person.name)}</span>${flag}</button>`;
      })
      .join("")}</div>`;
  },

  async renderState({ edit = false, force = false } = {}) {
    const container = document.getElementById("sv-state-tab");
    if (!container) return;
    // A background update must not throw away an open editor; it only flags it.
    const openForm = container.querySelector("#sv-state-form");
    if (openForm && !force && !edit) {
      openForm.querySelector(".sv-state-stale")?.removeAttribute("hidden");
      return;
    }
    container.innerHTML = '<div class="sv-loading-line">상태를 불러오는 중…</div>';
    if (!this.hasCharacterChat()) {
      container.innerHTML = emptyHtml(
        "heart-pulse",
        "캐릭터 채팅이 열려 있지 않습니다",
        "캐릭터나 그룹 채팅을 열면 그 채팅 인물들의 상태를 보여 줍니다.",
      );
      return;
    }
    const people = this.statePeople();
    if (!people.length) {
      container.innerHTML = emptyHtml(
        "heart-pulse",
        "상태를 추적할 인물이 없습니다",
        "이 채팅의 연락처 인물(봇카드 인물과 공용 인물)을 추적합니다. 페르소나(내 캐릭터)로 표시한 인물은 빠집니다.",
      );
      return;
    }
    const [round, loaded] = await Promise.all([
      this.loadStateRound(),
      Promise.all(people.map((item) => this.loadPersonState(item))),
    ]);
    const statuses = new Map();
    const records = new Map();
    people.forEach((item, index) => {
      records.set(item.key, loaded[index]);
      statuses.set(item.key, this.stateStatus(item.key, loaded[index], round));
    });
    // Who is in the scene first, then who left it, then whose whereabouts are unknown.
    const rank = ({ unknown, away }) => (unknown ? 2 : away ? 1 : 0);
    people.sort((a, b) => rank(statuses.get(a.key)) - rank(statuses.get(b.key)));
    const person =
      people.find((item) => item.key === this.statePersonKey) || people[0];
    this.statePersonKey = person.key;
    const current = records.get(person.key);
    const status = statuses.get(person.key);
    const historyKey = current?.state_key || person.stateKey;
    let history = [];
    try {
      history = (await this.loadStateHistory(historyKey)).map((item) => ({
        ...item,
        live: this.stateSourceLive(item.source_message_id),
      }));
    } catch (_) {
      /* 현재 상태 화면은 기록 조회 실패만으로 막지 않는다. */
    }
    const gone = history.filter((item) => !item.live);
    const warn = (text) =>
      `<p class="sv-notice sv-notice-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${text}</span></p>`;
    const notices = [
      current?.replaced
        ? warn("가장 최근 상태는 지금 채팅에 없는 메시지(삭제·수정했거나 다른 스와이프)에서 나와 쓰지 않습니다. 그 전 상태를 씁니다.")
        : !current && gone.length
          ? warn("저장된 상태가 모두 지금 채팅에 없는 메시지에서 나와 쓰지 않습니다.")
          : "",
      status.unknown
        ? warn(
            status.none
              ? `${gone.length ? "쓸 수 있는 상태가 없습니다" : "아직 장면에 나오지 않아 상태가 없습니다"}. 전화·문자를 먼저 보낼 때는 ‘행방 모름’으로 다뤄, 채팅 장면은 모르는 채 자기 이야기로 연락합니다.`
              : "보조모델이 이 인물은 장면을 떠났고 지금 어디서 무엇을 하는지 알 수 없다고 판단해 ‘행방 모름’입니다. 아래는 마지막으로 알려진 상태입니다. 전화·문자 프롬프트에는 이 상태 대신 ‘행방 모름’만 넣고, 자기가 있지 않았던 장면은 모르는 채 자기 이야기로 연락합니다. 장면에 다시 나오면 새로 분석하고, 직접 고치면 그 상태를 씁니다.",
          )
        : status.away
          ? '<p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>지금 장면에 없습니다. 전화·문자에는 아래 상태를 쓰되, 자기가 떠난 뒤의 장면은 모르는 채 연락합니다.</span></p>'
          : "",
    ].join("");
    const state = current?.state || {};
    const cards = STATE_FIELDS.map(
      ([section, title, icon, tone]) =>
        `<article class="sv-state-card sv-state-${tone}"><h4><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${title}</h4><dl>${this.stateSectionRows(state[section])}</dl></article>`,
    ).join("");
    container.innerHTML = `
            ${this.statePickerHtml(people, person, statuses)}
            <section class="sv-page-head">
                ${this.contactAvatarMarkup(person)}
                <div class="sv-page-head-text">
                    <strong>${escapeHtml(person.name)}</strong>
                    <small>${current?.updated_at ? `마지막 갱신 ${escapeHtml(this.formatDate(current.updated_at))}` : gone.length ? "쓸 수 있는 상태 없음" : "저장된 상태 없음"}</small>
                </div>
                ${infoTip(["연락처 인물마다(페르소나 제외) 신체·감정·생각·관계 상태를 따로 저장합니다.", "마지막으로 확인된 상태를 간직하다가, 최근 채팅 어디서든 새로 드러난 게 있는 인물만 갱신합니다. 바뀐 게 없으면 그대로 둡니다.", "어디 있는지 알 수 없는 인물은 ‘행방 모름’으로 표시하고, 자기가 없던 장면은 모르는 채 연락합니다.", "대사 분석과 전화·문자가 이 상태를 참고합니다.", "자동 갱신은 설정 → 캐릭터 상태 추적에서 켭니다."].join("\n"), "상태 추적 설명")}
                <div class="sv-actions">
                    <button type="button" id="sv-state-refresh" class="sv-btn sv-btn-accent" ${edit ? "disabled" : ""}><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>지금 분석</span></button>
                    <button type="button" id="sv-state-edit" class="sv-btn" ${edit ? "disabled" : ""}><i class="fa-solid fa-pen" aria-hidden="true"></i><span>직접 수정</span></button>
                    <button type="button" id="sv-state-clear" class="sv-btn sv-btn-ghost-danger" ${current || history.length ? "" : "disabled"}><i class="fa-solid fa-eraser" aria-hidden="true"></i><span>상태 초기화</span></button>
                </div>
            </section>
            ${notices}
            ${
              edit
                ? this.stateEditorHtml(state)
                : current
                ? `
                <div class="sv-state-view${status.unknown ? " sv-state-uncertain" : ""}">
                <p class="sv-state-summary"><i class="fa-solid fa-quote-left" aria-hidden="true"></i><span>${escapeHtml(state.summary || "상태 요약이 없습니다.")}</span></p>
                ${this.contactStripHtml(state.contact, person.key)}
                <div class="sv-state-grid">${cards}</div>
                </div>`
                : emptyHtml(
                    "heart-pulse",
                    gone.length ? "지금 채팅에 맞는 상태가 없습니다" : "아직 분석한 상태가 없습니다",
                    "‘지금 분석’을 누르거나, ‘직접 수정’으로 지금 상태를 적어 두거나, 설정 → 캐릭터 상태 추적을 켜 보십시오. 분석은 최근 채팅에서 새로 드러난 게 있는 인물만 갱신합니다.",
                  )
            }
            <section class="sv-group sv-state-history">
                <h3 class="sv-group-title"><i class="fa-solid fa-timeline sv-group-icon" aria-hidden="true"></i><span class="sv-group-name">최근 변화</span>${infoTip("상태는 그 상태를 만든 메시지에 연동됩니다. 그 메시지를 지우거나 고쳤거나 바꾸면 ‘채팅에 없음’으로 표시하고 AI에게 보내지 않습니다. 기록은 자동으로 지우지 않으니 필요하면 직접 지우십시오.", "최근 변화 설명")}<span class="sv-spacer"></span>${gone.length ? `<button type="button" class="sv-btn sv-btn-sm sv-btn-ghost-danger" id="sv-state-prune"><i class="fa-solid fa-broom" aria-hidden="true"></i><span>채팅에 없는 기록 지우기 ${gone.length}</span></button>` : ""}</h3>
                ${
                  history.length
                    ? `<ol class="sv-timeline">${history
                        .slice(0, 12)
                        .map(
                          (item) =>
                            `<li class="${item.live ? "" : "sv-timeline-gone"}"><time>${escapeHtml(this.formatDate(item.created_at))}</time><span>${item.live ? "" : '<em class="sv-badge">채팅에 없음</em> '}${escapeHtml(item.state?.summary || "상태 갱신")}</span><button type="button" class="sv-icon-btn sv-state-history-delete" data-id="${escapeHtml(item.id)}" aria-label="이 상태 기록 지우기" title="이 기록 지우기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></li>`,
                        )
                        .join("")}</ol>`
                    : '<p class="sv-hint sv-timeline-empty">기록이 없습니다.</p>'
                }
            </section>`;

    container.querySelectorAll(".sv-state-person").forEach((button) =>
      button.addEventListener("click", () => {
        this.statePersonKey = button.dataset.key;
        this.renderState({ force: true });
      }),
    );
    const removeHistory = async (ids, question) => {
      if (!ids.length || !confirm(question)) return;
      const response = await this.fetch(
        this.apiUrl("/api/plugins/scenevoice/state/history"),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state_key: historyKey, ids }),
        },
      );
      if (!response.ok) {
        this.notify("상태 기록을 지우지 못했습니다.", "error");
        return;
      }
      this.lastStateTrackingSource = "";
      await this.renderState({ force: true });
    };
    document
      .getElementById("sv-state-prune")
      ?.addEventListener("click", () =>
        this.run(() =>
          removeHistory(
            gone.map((item) => item.id),
            `지금 채팅에 없는 메시지에서 나온 ${person.name}의 상태 기록 ${gone.length}개를 지우시겠습니까?`,
          ),
        ),
      );
    container.querySelectorAll(".sv-state-history-delete").forEach((button) =>
      button.addEventListener("click", () =>
        this.run(() => removeHistory([button.dataset.id], "이 상태 기록을 지우시겠습니까?")),
      ),
    );

    document
      .getElementById("sv-state-refresh")
      ?.addEventListener("click", (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.querySelector("span").textContent = "분석 중…";
        this.run(async () => {
          await this.trackCurrentState({ force: true });
          if (document.getElementById("sv-state-tab"))
            await this.renderState({ force: true });
        });
      });
    document
      .getElementById("sv-state-edit")
      ?.addEventListener("click", () => this.renderState({ edit: true }));
    document
      .getElementById("sv-state-cancel")
      ?.addEventListener("click", () => this.renderState({ force: true }));
    document
      .getElementById("sv-state-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("#sv-state-save");
        button.disabled = true;
        try {
          await this.saveEditedState(form, person);
          await this.renderState({ force: true });
        } catch (error) {
          this.notify(error.message || "상태를 저장하지 못했습니다.", "error");
          button.disabled = false;
        }
      });
    document
      .getElementById("sv-state-clear")
      ?.addEventListener("click", () =>
        this.run(async () => {
          if (!confirm(`${person.name}의 저장된 상태 기록을 모두 지우시겠습니까?`)) return;
          const response = await this.fetch(
            this.apiUrl(
              `/api/plugins/scenevoice/state?state_key=${encodeURIComponent(person.stateKey)}`,
            ),
            { method: "DELETE" },
          );
          if (!response.ok) {
            this.notify("상태 기록을 지우지 못했습니다.", "error");
            return;
          }
          this.lastStateTrackingSource = "";
          await this.renderState({ force: true });
        }),
      );
  },
};
