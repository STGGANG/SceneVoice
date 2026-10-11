import { escapeHtml } from "./common.js";

// 목소리 고르기: a combobox that shows voice names from the user's ElevenLabs list and keeps the
// Voice ID out of sight. The visible box shows the name; the ID it stands for is resolved when
// read. An ID that is not in the list (a library voice, a Fish reference) can still be pasted.

// Looks like an ID rather than a half-typed name: long, or with a digit, and no spaces.
const looksLikeId = (text) =>
  /^[A-Za-z0-9_-]+$/.test(text) && (text.length >= 16 || (text.length >= 8 && /\d/.test(text)));

/**
 * The picker markup. `field` is the casting field name (data-field), `empty` what an empty box
 * means. The text box carries `id` so its label still points at it.
 */
export function voicePickHtml({ id, field = "", value = "", label = "", placeholder = "", empty = "" }) {
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
    if (!typed) return pick.dataset.placeholder !== undefined && box.inputMode === "text" ? saved : "";
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
    return this.voicePickValue(document.getElementById(id)?.closest("[data-voice-pick]"));
  },

  /** Puts names in place of IDs once the list is loaded (skips the box being typed in). */
  fillVoiceOptions() {
    for (const pick of document.querySelectorAll("[data-voice-pick]")) {
      const box = pick.querySelector(".sv-voice-pick-text");
      if (!box || box === document.activeElement) continue;
      const value = pick.dataset.value || "";
      box.value = this.voiceName(value) || value;
    }
  },

  /** The engine the voice in this picker is for (a person may use Fish while the default is ElevenLabs). */
  voicePickEngine(pick) {
    const own = pick.closest(".sv-member, .sv-cast-card")?.querySelector('[data-field="engine"]')?.value;
    if (own && own !== "inherit") return own;
    if (pick.closest(".sv-engine-section")) return "elevenlabs";
    return document.getElementById("sv-engine")?.value || this.config.engine;
  },

  openVoicePick(pick, filter = "") {
    const menu = pick.querySelector(".sv-voice-pick-menu");
    const box = pick.querySelector(".sv-voice-pick-text");
    if (!menu || !box) return;
    const current = this.voicePickValue(pick);
    const needle = filter.trim().toLowerCase();
    const fish = this.voicePickEngine(pick) === "fish";
    const items = fish
      ? []
      : (this.voiceChoices || []).filter(
          (item) =>
            !needle ||
            item.name.toLowerCase().includes(needle) ||
            String(item.meta || "").toLowerCase().includes(needle),
        );
    const note = fish
      ? "Fish Audio는 목록이 없습니다. Reference ID를 붙여 넣으세요."
      : !this.voiceChoices?.length
        ? "보이스 목록을 아직 불러오지 않았습니다. 설정 → 음성 엔진의 ‘내 보이스 목록 불러오기’를 누르거나 Voice ID를 붙여 넣으세요."
        : !items.length
          ? "맞는 목소리가 없습니다. Voice ID를 붙여 넣어도 됩니다."
          : "";
    menu.innerHTML = [
      `<li role="option" class="sv-voice-pick-option sv-voice-pick-empty" data-voice-id="" aria-selected="${!current}">${escapeHtml(pick.dataset.empty || "비우기")}</li>`,
      ...items.map(
        (item) =>
          `<li role="option" class="sv-voice-pick-option" data-voice-id="${escapeHtml(item.id)}" aria-selected="${item.id === current}"><span>${escapeHtml(item.name)}</span>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ""}</li>`,
      ),
      note ? `<li class="sv-voice-pick-note" role="presentation">${escapeHtml(note)}</li>` : "",
      // On a touch screen the keyboard stays down while choosing; typing an ID is asked for.
      box.inputMode === "none"
        ? '<li role="option" class="sv-voice-pick-option sv-voice-pick-type" data-voice-type>ID 직접 입력…</li>'
        : "",
    ].join("");
    menu.hidden = false;
    pick.classList.add("sv-open");
    box.setAttribute("aria-expanded", "true");
  },

  closeVoicePick(pick) {
    const menu = pick?.querySelector(".sv-voice-pick-menu");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    pick.classList.remove("sv-open");
    pick.querySelector(".sv-voice-pick-text")?.setAttribute("aria-expanded", "false");
  },

  /** Settles the picker on `id` and tells the settings and casting code it changed. */
  commitVoicePick(pick, id) {
    const box = pick.querySelector(".sv-voice-pick-text");
    box.removeAttribute("inputmode");
    if (pick.dataset.placeholder !== undefined) box.placeholder = pick.dataset.placeholder;
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
      if (box && event.pointerType !== "mouse" && box !== document.activeElement)
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
      if (pick && event.isTrusted && event.target.matches(".sv-voice-pick-text"))
        this.openVoicePick(pick, event.target.value);
    });
    // mousedown, so the choice lands before the box loses focus.
    root.addEventListener("mousedown", (event) => {
      const pick = pickOf(event.target);
      if (!pick) return;
      const option = event.target.closest(".sv-voice-pick-option");
      if (option?.hasAttribute("data-voice-type")) {
        // Keyboard on: the next tap on the box types (or pastes) an ID.
        event.preventDefault();
        const box = pick.querySelector(".sv-voice-pick-text");
        this.closeVoicePick(pick);
        box.inputMode = "text";
        box.value = "";
        pick.dataset.placeholder ??= box.placeholder;
        box.placeholder = "Voice ID를 붙여 넣으세요";
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
        const index = list.indexOf(pick.querySelector(".sv-voice-pick-option.sv-active"));
        const next = list[(index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
        list.forEach((item) => item.classList.toggle("sv-active", item === next));
        next.scrollIntoView({ block: "nearest" });
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
      if (!pick || pick.dataset.typing || pick.contains(event.relatedTarget)) return;
      const value = this.voicePickValue(pick);
      if (value !== (pick.dataset.value || "")) this.commitVoicePick(pick, value);
      else {
        // A search left half-way: show the chosen voice again.
        const box = pick.querySelector(".sv-voice-pick-text");
        box.value = this.voiceName(value) || value;
        box.removeAttribute("inputmode");
        if (pick.dataset.placeholder !== undefined) box.placeholder = pick.dataset.placeholder;
        this.closeVoicePick(pick);
      }
    });
  },
};
