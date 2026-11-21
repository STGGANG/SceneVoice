import { escapeHtml, mergeConfig, setText } from "./common.js";
import { cleanPronunciation } from "../shared/settings.js";
import { infoTip, subTitle, switchHtml } from "./ui.js";

// "발음 사전": words the voice engine misreads, each with how it is said. The engine gets the
// reading in place of the word (shared/providers.js: respell); the line on screen stays.
// A word is for every bot card or for one card only. The line analysis adds the names whose
// reading it can settle (prompts.js: READING_RULES), for the card of that chat.

function wordRow(word = {}) {
  const auto = word.auto === true;
  return `<li class="sv-pron-word" ${auto ? `data-auto data-auto-from="${escapeHtml(word.from || "")}"` : ""}>
    <input type="text" data-word-field="from" value="${escapeHtml(word.from || "")}" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="대사에 적힌 표기" placeholder="적힌 표기">
    <i class="fa-solid fa-arrow-right sv-pron-arrow" aria-hidden="true"></i>
    <input type="text" data-word-field="to" value="${escapeHtml(word.to || "")}" maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="읽는 법" placeholder="읽는 법">
    <span class="sv-badge sv-pron-mark">${auto ? "자동" : "수동"}</span>
    <button type="button" class="sv-icon-btn sv-read-remove" data-word-remove aria-label="단어 삭제" title="단어 삭제"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
  </li>`;
}

/** One list of words: those for every bot card (`card` ""), or one card's own. */
function wordList(title, card, words) {
  return `<div class="sv-pron-block">
      <div class="sv-pron-head"><span>${escapeHtml(title)}</span><button type="button" class="sv-btn sv-btn-sm" data-word-add><i class="fa-solid fa-plus" aria-hidden="true"></i><span>단어 추가</span></button></div>
      <ul class="sv-read-list sv-pron-list" data-word-card="${escapeHtml(card)}">${words.map(wordRow).join("")}</ul>
    </div>`;
}

/**
 * The model's words worth adding: a written form found in the lines as it is, with a reading,
 * and neither on the list nor removed from it before. They come back marked auto.
 */
export function newReadings(words, known = [], sources = "") {
  const seen = new Set(known.map((from) => String(from).toLowerCase()));
  const text = String(sources).toLowerCase();
  const found = [];
  for (const word of Array.isArray(words) ? words : []) {
    const from = String(word?.written ?? "").trim();
    const key = from.toLowerCase();
    if (!from || seen.has(key) || !text.includes(key)) continue;
    seen.add(key);
    found.push({ from, to: word?.reading, auto: true });
  }
  return cleanPronunciation(found);
}

export const pronunciation = {
  /** The bot cards of the open chat, as the keys words are kept under. */
  wordCards() {
    return (this.currentCardKeys?.() || []).filter((key) =>
      String(key).startsWith("character:"),
    );
  },

  /** A section of 보조모델 분석 (the analysis is what fills it by itself), folded until opened. */
  pronunciationSectionHtml(config) {
    const words = config.pronunciation?.words || [];
    const cards = this.hasCharacterChat?.() === false ? [] : this.wordCards();
    this.pronunciationSkipped = [...(config.pronunciation?.skipped || [])];
    // Words of bot cards that are not open stay as they are, out of sight.
    this.pronunciationElsewhere = words.filter(
      (word) => word.card && !cards.includes(word.card),
    );
    const shown = words.length - this.pronunciationElsewhere.length;
    const tip = [
      "채팅 대사와 전화·문자의 음성에 모두 적용됩니다.",
      "‘모든 봇카드’의 단어는 어디서나, ‘이 봇카드만’의 단어는 그 봇카드의 채팅에서만 바꿔 읽습니다. 같은 표기가 양쪽에 있으면 봇카드 쪽을 씁니다.",
      "다른 봇카드의 단어는 그 봇카드의 채팅을 열었을 때 보입니다.",
      "읽는 법은 그 대사 언어의 소리 글자로 적습니다(일본어: 히라가나·가타카나).",
      "영어·숫자로 된 표기는 단어 전체가 같을 때만 바꿉니다.",
      "글자를 잘못 읽는 것만 잡습니다. 억양이 어색한 것은 고쳐지지 않습니다.",
    ].join("\n");
    return `${subTitle("sv-sub-pronunciation", "spell-check", "발음 사전", { open: false, note: `${infoTip(tip, "발음 사전 설명")}<small id="sv-pron-count" ${shown ? "" : "hidden"}>${shown}개</small>` })}
      <div class="sv-notice sv-read-lead"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>음성 엔진이 잘못 읽는 이름이나 단어를, <b>읽을 때만</b> 적어 둔 글자로 바꿔 보냅니다(예: 遥斗 → はると). 화면의 글은 바뀌지 않습니다.</span></div>
      <div class="sv-row sv-chat-only">
        ${switchHtml({ id: "sv-pron-auto", label: "읽는 법 알아서 찾기", hint: "보조모델이 채팅 대사를 분석할 때, 읽는 법이 헷갈릴 이름을 함께 찾아 그 봇카드의 사전에 넣습니다.", tip: "대사를 분석하는 요청에 함께 물어봅니다(추가 요청 없음).\n봇카드 설명이나 등록한 이름·별명으로 읽는 법이 확실할 때만 넣고, 넣은 단어에는 ‘자동’, 직접 적거나 고친 단어에는 ‘수동’ 표시가 붙습니다.\n찾은 단어는 그 채팅의 봇카드에서만 씁니다.\n틀리게 넣은 것은 고치면 되고, 지우면 다시 넣지 않습니다.\n전화·문자 대사에서는 찾지 않습니다. 사전에 든 단어는 거기서도 바꿔 읽습니다.\n‘보조모델 분석’이 꺼져 있으면 찾지 않습니다.", checked: config.pronunciation?.auto !== false })}
      </div>
      <div id="sv-pron-words">
        ${wordList(
          "모든 봇카드",
          "",
          words.filter((word) => !word.card),
        )}
        ${cards
          .map((card) =>
            wordList(
              `이 봇카드만 · ${this.cardInfo?.(card)?.name || "지금 열린 봇카드"}`,
              card,
              words.filter((word) => word.card === card),
            ),
          )
          .join("")}
      </div>`;
  },

  bindPronunciation() {
    const lists = document.getElementById("sv-pron-words");
    if (!lists) return;
    lists.addEventListener("click", (event) => {
      const add = event.target.closest("[data-word-add]");
      if (add) {
        add
          .closest(".sv-pron-block")
          .querySelector(".sv-pron-list")
          .insertAdjacentHTML("beforeend", wordRow());
        return;
      }
      const row = event.target
        .closest("[data-word-remove]")
        ?.closest(".sv-pron-word");
      if (!row) return;
      // A word the analysis found and the user threw out is not found again.
      if (row.dataset.autoFrom)
        this.pronunciationSkipped = [
          ...new Set([...this.pronunciationSkipped, row.dataset.autoFrom]),
        ];
      row.remove();
      this.notePronunciationCount();
      this.settingsDirty = true;
      this.scheduleSettingsSave(250);
    });
    lists.addEventListener("input", (event) => {
      // Edited by hand, it is the user's own word from then on.
      const row = event.target.closest(".sv-pron-word");
      if (row?.hasAttribute("data-auto")) {
        row.removeAttribute("data-auto");
        row.querySelector(".sv-pron-mark").textContent = "수동";
      }
      this.notePronunciationCount();
    });
  },

  notePronunciationCount() {
    const badge = document.getElementById("sv-pron-count");
    const lists = document.getElementById("sv-pron-words");
    if (!badge || !lists) return;
    const count = this.shownPronunciation(lists).length;
    if (badge.hidden !== !count) badge.hidden = !count;
    setText(badge, `${count}개`);
  },

  /** Rows with both sides filled in; a row still being typed is left out of the save. */
  shownPronunciation(lists) {
    return [...lists.querySelectorAll(".sv-pron-word")]
      .map((row) => ({
        from: row.querySelector('[data-word-field="from"]').value.trim(),
        to: row.querySelector('[data-word-field="to"]').value.trim(),
        ...(row.hasAttribute("data-auto") ? { auto: true } : {}),
        ...(row.closest("[data-word-card]").dataset.wordCard
          ? { card: row.closest("[data-word-card]").dataset.wordCard }
          : {}),
      }))
      .filter((word) => word.from && word.to);
  },

  /** Every word: what the open settings window shows plus the other cards' words, or the saved ones. */
  collectPronunciation() {
    const lists = globalThis.document?.getElementById("sv-pron-words");
    if (!lists) return structuredClone(this.config.pronunciation?.words || []);
    return [
      ...this.shownPronunciation(lists),
      ...(this.pronunciationElsewhere || []),
    ];
  },

  /** What the settings window holds of 발음 사전, for the save. */
  collectPronunciationSettings() {
    return {
      words: this.collectPronunciation(),
      auto: document.getElementById("sv-pron-auto")?.checked !== false,
      skipped:
        this.pronunciationSkipped || this.config.pronunciation?.skipped || [],
    };
  },

  /** Whether the line analysis is asked for readings too. */
  findsReadings() {
    return this.config.pronunciation?.auto !== false;
  },

  /**
   * Written forms the analysis needn't look at: listed for every card or for one of the open
   * chat's, or removed by the user.
   */
  knownReadings() {
    const cards = this.wordCards();
    return [
      ...new Set([
        ...this.collectPronunciation()
          .filter((word) => !word.card || cards.includes(word.card))
          .map((word) => word.from),
        ...(this.pronunciationSkipped || []),
        ...(this.config.pronunciation?.skipped || []),
      ]),
    ];
  },

  /**
   * The readings an analysis reply brought, kept for the bot card of the chat. Never fails the
   * analysis.
   */
  async keepFoundReadings(response, utterances) {
    if (!this.findsReadings()) return;
    try {
      const card = this.wordCards()[0];
      const found = newReadings(
        this.parseJsonObject(response)?.readings,
        this.knownReadings(),
        utterances.map((line) => line.text).join("\n"),
      ).map((word) => (card ? { ...word, card } : word));
      if (found.length) await this.keepPronunciation(found);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 읽는 법 저장 실패", error);
    }
  },

  async keepPronunciation(found) {
    const response = await this.request("/api/plugins/scenevoice/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pronunciation: {
          words: [...(this.config.pronunciation?.words || []), ...found],
        },
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.detail || `발음 사전 저장 실패 (${response.status})`,
      );
    this.config = mergeConfig(data.settings || {});
    // An open settings window saving later keeps them too: in the card's list when it shows.
    const lists = globalThis.document?.getElementById("sv-pron-words");
    if (!lists) return;
    for (const word of found) {
      const list = [...lists.querySelectorAll("[data-word-card]")].find(
        (item) => item.dataset.wordCard === (word.card || ""),
      );
      if (list) list.insertAdjacentHTML("beforeend", wordRow(word));
      else (this.pronunciationElsewhere ||= []).push(word);
    }
    this.notePronunciationCount();
  },
};
