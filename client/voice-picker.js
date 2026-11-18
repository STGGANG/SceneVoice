import { escapeHtml } from "./common.js";

// 목소리 고르기: a combobox that shows voice names from the user's ElevenLabs list and keeps the
// Voice ID out of sight. The visible box shows the name; the ID it stands for is resolved when
// read. An ID that is not in the list (a library voice, a Fish reference) can still be pasted.
// The list narrows by where a voice is from and by its language, and plays ElevenLabs' own sample
// of a voice (a file on their side: nothing is generated).

const KINDS = [
  ["basic", "기본"],
  ["mine", "내가 만든"],
  ["library", "라이브러리"],
];
const KIND_LABEL = Object.fromEntries(KINDS);

let languageNames;
/** "ja" → "일본어"; the code itself where the browser has no name for it. */
function languageName(code) {
  if (!code) return "";
  try {
    languageNames ??= new Intl.DisplayNames(["ko"], { type: "language" });
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

/** The line under a voice's name, which the search reads too. */
const describe = (item) =>
  [languageName(item.lang), item.meta, KIND_LABEL[item.kind]]
    .filter(Boolean)
    .join(" · ");

const chipsHtml = (label, field, chosen, choices) =>
  choices.length > 2
    ? `<div class="sv-voice-pick-chips" role="group" aria-label="${label}">${choices
        .map(
          ([value, text]) =>
            `<button type="button" tabindex="-1" class="sv-voice-pick-chip" data-voice-${field}="${escapeHtml(value)}" aria-pressed="${value === chosen}">${escapeHtml(text)}</button>`,
        )
        .join("")}</div>`
    : "";

// Looks like an ID rather than a half-typed name: long, or with a digit, and no spaces.
const looksLikeId = (text) =>
  /^[A-Za-z0-9_-]+$/.test(text) &&
  (text.length >= 16 || (text.length >= 8 && /\d/.test(text)));

/**
 * The picker markup. `field` is the casting field name (data-field), `empty` what an empty box
 * means. The text box carries `id` so its label still points at it.
 */
export function voicePickHtml({
  id,
  field = "",
  value = "",
  label = "",
  placeholder = "",
  empty = "",
}) {
  return `<div class="sv-voice-pick" data-voice-pick data-value="${escapeHtml(value)}" data-empty="${escapeHtml(empty)}">
    <input type="text" id="${id}" class="sv-voice-pick-text" ${field ? `data-field="${field}"` : ""} value="${escapeHtml(label || value)}" placeholder="${escapeHtml(placeholder)}" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false">
    <span class="sv-voice-pick-caret" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
    <ul class="sv-voice-pick-menu" role="listbox" hidden></ul>
  </div>`;
}

export const voicePicker = {
  /** The name of a voice in the loaded list, or "". */
  voiceName(id) {
    return (this.voiceChoices || []).find((item) => item.id === id)?.name || "";
  },

  /**
   * The Voice ID a picker stands for. What was typed counts when it names a listed voice, is a
   * listed ID, or looks like a pasted ID; otherwise (a search left half-way) the last value stays.
   */
  voicePickValue(pick) {
    const box = pick?.querySelector(".sv-voice-pick-text");
    if (!box) return "";
    const saved = pick.dataset.value || "";
    const typed = box.value.trim();
    // Emptied only to paste an ID: nothing pasted keeps the voice ("비우기" clears it).
    if (!typed)
      return pick.dataset.placeholder !== undefined && box.inputMode === "text"
        ? saved
        : "";
    if (typed === (this.voiceName(saved) || saved)) return saved;
    const list = this.voiceChoices || [];
    const found =
      list.find((item) => item.name.toLowerCase() === typed.toLowerCase()) ||
      list.find((item) => item.id === typed);
    if (found) return found.id;
    return looksLikeId(typed) ? typed : saved;
  },

  /** Reads a picker by its text box id (settings fields). */
  voiceFieldValue(id) {
    return this.voicePickValue(
      document.getElementById(id)?.closest("[data-voice-pick]"),
    );
  },

  /** Puts names in place of IDs once the list is loaded (skips the box being typed in). */
  fillVoiceOptions() {
    for (const pick of document.querySelectorAll("[data-voice-pick]")) {
      const box = pick.querySelector(".sv-voice-pick-text");
      if (!box || box === document.activeElement) continue;
      const value = pick.dataset.value || "";
      box.value = this.voiceName(value) || value;
    }
    this.noteEngineDetail?.();
  },

  /** The engine the voice in this picker is for (a person may use Fish while the default is ElevenLabs). */
  voicePickEngine(pick) {
    const own = pick
      .closest(".sv-member, .sv-cast-card")
      ?.querySelector('[data-field="engine"]')?.value;
    if (own && own !== "inherit") return own;
    if (pick.closest(".sv-engine-section")) return "elevenlabs";
    return document.getElementById("sv-engine")?.value || this.config.engine;
  },

  // Which voices the list shows; one choice for every picker, until the page is left.
  voiceFilter: { kind: "", lang: "" },

  openVoicePick(pick, search = "") {
    const menu = pick.querySelector(".sv-voice-pick-menu");
    const box = pick.querySelector(".sv-voice-pick-text");
    if (!menu || !box) return;
    pick.dataset.search = search;
    const current = this.voicePickValue(pick);
    const needle = search.trim().toLowerCase();
    const fish = this.voicePickEngine(pick) === "fish";
    const all = fish ? [] : this.voiceChoices || [];
    const kinds = KINDS.filter(([kind]) =>
      all.some((item) => item.kind === kind),
    );
    const count = new Map();
    for (const item of all)
      if (item.lang) count.set(item.lang, (count.get(item.lang) || 0) + 1);
    const langs = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
    const filter = this.voiceFilter;
    // A choice the list no longer has (another account's voices) is let go.
    if (!kinds.some(([kind]) => kind === filter.kind)) filter.kind = "";
    if (!langs.includes(filter.lang)) filter.lang = "";
    const items = all.filter(
      (item) =>
        (!filter.kind || item.kind === filter.kind) &&
        (!filter.lang || item.lang === filter.lang) &&
        (!needle ||
          item.name.toLowerCase().includes(needle) ||
          describe(item).toLowerCase().includes(needle)),
    );
    const chips =
      chipsHtml("종류", "kind", filter.kind, [["", "전체"], ...kinds]) +
      chipsHtml("언어", "lang", filter.lang, [
        ["", "모든 언어"],
        ...langs.map((lang) => [lang, languageName(lang)]),
      ]);
    const note = fish
      ? "Fish Audio는 목록이 없습니다. Reference ID를 붙여 넣으십시오."
      : !this.voiceChoices?.length
        ? "보이스 목록을 아직 불러오지 않았습니다. 설정 → 기본 → 상세 설정의 ‘보이스 목록 새로고침’를 누르거나 Voice ID를 붙여 넣으십시오."
        : !items.length
          ? "맞는 목소리가 없습니다. Voice ID를 붙여 넣어도 됩니다."
          : "";
    menu.innerHTML = [
      chips
        ? `<li class="sv-voice-pick-filters" role="presentation">${chips}</li>`
        : "",
      `<li role="option" class="sv-voice-pick-option sv-voice-pick-empty" data-voice-id="" aria-selected="${!current}">${escapeHtml(pick.dataset.empty || "비우기")}</li>`,
      ...items.map((item) => {
        const about = describe(item);
        return `<li role="option" class="sv-voice-pick-option" data-voice-id="${escapeHtml(item.id)}" aria-selected="${item.id === current}"><span>${escapeHtml(item.name)}</span>${about ? `<small>${escapeHtml(about)}</small>` : ""}${
          item.preview
            ? `<button type="button" tabindex="-1" class="sv-voice-pick-preview" data-voice-preview="${escapeHtml(item.id)}" data-label="${escapeHtml(item.name)}"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
            : ""
        }</li>`;
      }),
      note
        ? `<li class="sv-voice-pick-note" role="presentation">${escapeHtml(note)}</li>`
        : "",
      // On a touch screen the keyboard stays down while choosing; typing an ID is asked for.
      box.inputMode === "none"
        ? '<li role="option" class="sv-voice-pick-option sv-voice-pick-type" data-voice-type>ID 직접 입력…</li>'
        : "",
    ].join("");
    menu.hidden = false;
    pick.classList.add("sv-open");
    box.setAttribute("aria-expanded", "true");
    this.markVoicePreview();
  },

  /** Plays ElevenLabs' sample of a voice, or stops it when it is the one playing. */
  toggleVoicePreview(id) {
    const playing = this.voicePreview;
    this.stopVoicePreview();
    if (playing?.id === id) return;
    const url = (this.voiceChoices || []).find(
      (item) => item.id === id,
    )?.preview;
    if (!url) return;
    const preview = (this.voicePreview = { id, audio: new Audio(url) });
    const done = () => {
      if (this.voicePreview === preview) this.stopVoicePreview();
    };
    preview.audio.addEventListener("ended", done);
    preview.audio.addEventListener("error", done);
    preview.audio.play().catch(done);
    this.markVoicePreview();
  },

  stopVoicePreview() {
    const preview = this.voicePreview;
    if (!preview) return;
    this.voicePreview = null;
    preview.audio.pause();
    this.markVoicePreview();
  },

  markVoicePreview() {
    for (const button of document.querySelectorAll(".sv-voice-pick-preview")) {
      const on = button.dataset.voicePreview === this.voicePreview?.id;
      button.classList.toggle("sv-playing", on);
      button.firstElementChild.className = `fa-solid ${on ? "fa-stop" : "fa-play"}`;
      button.title = on ? "미리 듣기 멈춤 (→)" : "미리 듣기 (→)";
      button.setAttribute(
        "aria-label",
        `${button.dataset.label} ${on ? "미리 듣기 멈춤" : "미리 듣기"}`,
      );
    }
  },

  closeVoicePick(pick) {
    const menu = pick?.querySelector(".sv-voice-pick-menu");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    this.stopVoicePreview();
    pick.classList.remove("sv-open");
    pick
      .querySelector(".sv-voice-pick-text")
      ?.setAttribute("aria-expanded", "false");
  },

  /** Settles the picker on `id` and tells the settings and casting code it changed. */
  commitVoicePick(pick, id) {
    const box = pick.querySelector(".sv-voice-pick-text");
    box.removeAttribute("inputmode");
    if (pick.dataset.placeholder !== undefined)
      box.placeholder = pick.dataset.placeholder;
    pick.dataset.value = id;
    box.value = this.voiceName(id) || id;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    this.closeVoicePick(pick);
  },

  /** One set of listeners for every picker under `root` (the settings window). */
  bindVoicePickers(root) {
    if (!root || root.dataset.voicePickBound) return;
    root.dataset.voicePickBound = "true";
    const pickOf = (target) => target?.closest?.("[data-voice-pick]");
    // A tap opens the list without the keyboard, which would cover it. Set before focus lands.
    root.addEventListener("pointerdown", (event) => {
      const box = event.target.closest?.(".sv-voice-pick-text");
      if (
        box &&
        event.pointerType !== "mouse" &&
        box !== document.activeElement
      )
        box.inputMode = "none";
    });
    root.addEventListener("focusin", (event) => {
      const pick = pickOf(event.target);
      if (!pick || !event.target.matches(".sv-voice-pick-text")) return;
      event.target.select();
      this.openVoicePick(pick);
    });
    root.addEventListener("input", (event) => {
      const pick = pickOf(event.target);
      // Our own commit events are trusted=false; only typing filters the list.
      if (
        pick &&
        event.isTrusted &&
        event.target.matches(".sv-voice-pick-text")
      )
        this.openVoicePick(pick, event.target.value);
    });
    // mousedown, so the choice lands before the box loses focus.
    root.addEventListener("mousedown", (event) => {
      const pick = pickOf(event.target);
      if (!pick) return;
      // The filters and the sample button keep the box's focus (and so the list open).
      const chip = event.target.closest(".sv-voice-pick-chip");
      if (chip) {
        const field = "voiceKind" in chip.dataset ? "kind" : "lang";
        this.voiceFilter[field] =
          chip.dataset[field === "kind" ? "voiceKind" : "voiceLang"];
        this.openVoicePick(pick, pick.dataset.search || "");
      }
      if (
        event.target.closest(".sv-voice-pick-filters, .sv-voice-pick-preview")
      ) {
        event.preventDefault();
        return;
      }
      const option = event.target.closest(".sv-voice-pick-option");
      if (option?.hasAttribute("data-voice-type")) {
        // Keyboard on: the next tap on the box types (or pastes) an ID.
        event.preventDefault();
        const box = pick.querySelector(".sv-voice-pick-text");
        this.closeVoicePick(pick);
        box.inputMode = "text";
        box.value = "";
        pick.dataset.placeholder ??= box.placeholder;
        box.placeholder = "Voice ID를 붙여 넣으십시오";
        // Refocused so the keyboard comes up; the blur in between is not a choice.
        pick.dataset.typing = "true";
        box.blur();
        delete pick.dataset.typing;
        box.focus();
        return;
      }
      if (option) {
        event.preventDefault();
        this.commitVoicePick(pick, option.dataset.voiceId || "");
        return;
      }
      if (event.target.closest(".sv-voice-pick-caret")) {
        event.preventDefault();
        const box = pick.querySelector(".sv-voice-pick-text");
        if (pick.classList.contains("sv-open")) this.closeVoicePick(pick);
        else if (box === document.activeElement) this.openVoicePick(pick);
        else box.focus();
      }
      // The box already has the focus (the list was closed with Esc): a press opens it again.
      const text = event.target.closest(".sv-voice-pick-text");
      if (
        text &&
        text === document.activeElement &&
        !pick.classList.contains("sv-open")
      )
        this.openVoicePick(pick);
    });
    // click, which every browser counts as the user's own act when sound starts.
    root.addEventListener("click", (event) => {
      const button = event.target.closest?.(".sv-voice-pick-preview");
      if (button) this.toggleVoicePreview(button.dataset.voicePreview);
    });
    root.addEventListener("keydown", (event) => {
      const pick = pickOf(event.target);
      if (!pick || !event.target.matches(".sv-voice-pick-text")) return;
      const options = [...pick.querySelectorAll(".sv-voice-pick-option")];
      const active = pick.querySelector(".sv-voice-pick-option.sv-active");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!pick.classList.contains("sv-open")) this.openVoicePick(pick);
        const list = [...pick.querySelectorAll(".sv-voice-pick-option")];
        if (!list.length) return;
        const index = list.indexOf(
          pick.querySelector(".sv-voice-pick-option.sv-active"),
        );
        const next =
          list[
            (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) %
              list.length
          ];
        list.forEach((item) =>
          item.classList.toggle("sv-active", item === next),
        );
        next.scrollIntoView({ block: "nearest" });
      } else if (
        event.key === "ArrowRight" &&
        active?.querySelector(".sv-voice-pick-preview")
      ) {
        event.preventDefault();
        this.toggleVoicePreview(active.dataset.voiceId);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (active) this.commitVoicePick(pick, active.dataset.voiceId || "");
        else this.commitVoicePick(pick, this.voicePickValue(pick));
      } else if (event.key === "Escape" && pick.classList.contains("sv-open")) {
        event.preventDefault();
        event.stopPropagation();
        const value = pick.dataset.value || "";
        event.target.value = this.voiceName(value) || value;
        this.closeVoicePick(pick);
      } else if (event.key === "Tab" && options.length) {
        this.closeVoicePick(pick);
      }
    });
    root.addEventListener("focusout", (event) => {
      const pick = pickOf(event.target);
      if (!pick || pick.dataset.typing || pick.contains(event.relatedTarget))
        return;
      const value = this.voicePickValue(pick);
      if (value !== (pick.dataset.value || ""))
        this.commitVoicePick(pick, value);
      else {
        // A search left half-way: show the chosen voice again.
        const box = pick.querySelector(".sv-voice-pick-text");
        box.value = this.voiceName(value) || value;
        box.removeAttribute("inputmode");
        if (pick.dataset.placeholder !== undefined)
          box.placeholder = pick.dataset.placeholder;
        this.closeVoicePick(pick);
      }
    });
  },
};
