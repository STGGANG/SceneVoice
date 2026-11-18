// 메시지 버튼 자리: the 음성 button sits in 실리태번's message button row, beside the pencil, and
// its tool (분석 보기) in the ⋯ menu. A theme that gives the row's own buttons fixed
// places would lay ours over one of them: then the 음성 button goes into the ⋯ menu too.

const ROW = ".mes_buttons";
const MENU = ".extraMesButtons";

const overlap = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;

const shown = (element) => element.getClientRects().length > 0;

/** Sideways distance between two boxes on one line (Infinity when they are on different lines). */
const apart = (a, b) =>
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
    ? Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
    : Infinity;

/**
 * In the row, does the 음성 button lie over one of the row's own buttons, or away from them
 * (a theme that seats each of its buttons by name leaves ours wherever there is room)?
 */
function misplaced(control, row) {
  const own = control.getBoundingClientRect();
  const others = [...row.children].filter(
    (item) =>
      item !== control &&
      !item.classList.contains("sv-message-tool") &&
      shown(item),
  );
  if (others.some((item) => overlap(own, item.getBoundingClientRect())))
    return true;
  const natives = others
    .filter((item) => item.classList.contains("mes_button"))
    .map((item) => item.getBoundingClientRect());
  if (!natives.length) return false;
  // As far apart as the row's own buttons are from each other, and a button's width more.
  const spacing =
    natives.length > 1
      ? Math.min(...natives.slice(1).map((box, i) => apart(natives[i], box)))
      : 0;
  const reach =
    (Number.isFinite(spacing) ? spacing : 0) + Math.max(own.width, 24);
  return Math.min(...natives.map((box) => apart(own, box))) > reach;
}

export const messageButtons = {
  // What the row was found to be under the present theme and width.
  buttonRow: { order: "", crowded: false, known: false },

  placeMessageButtons(message, control) {
    this.layMessageButtons(message, control);
    if (!this.buttonRow.known) this.scheduleButtonRowCheck();
  },

  layMessageButtons(message, control) {
    const row = message.querySelector(ROW);
    const menu = row?.querySelector(`:scope > ${MENU}`);
    const tools = control.svTools || [];
    if (menu && this.buttonRow.crowded) {
      if (control.parentElement !== menu) menu.append(control, ...tools);
      control.style.order = "";
      return;
    }
    const edit = row?.querySelector(":scope > .mes_edit");
    if (edit) {
      if (edit.nextElementSibling !== control) edit.after(control);
    } else if (control.parentElement !== (row || message))
      (row || message).append(control);
    // A theme that orders the row's buttons keeps ours beside the pencil.
    control.style.order = edit ? this.buttonRow.order : "";
    const home = menu || row || message;
    for (const tool of tools)
      if (tool.parentElement !== home) home.append(tool);
  },

  scheduleButtonRowCheck() {
    clearTimeout(this.buttonRowTimer);
    this.buttonRowTimer = setTimeout(() => this.checkButtonRow(), 60);
  },

  /**
   * Measures one message whose button row is on screen: the pencil's order, and whether the 음성
   * button, in the row, lies over another button. Everything is moved and measured within one
   * frame, so nothing is seen of it.
   */
  checkButtonRow() {
    const state = this.buttonRow;
    const controls = [
      ...document.querySelectorAll(".sv-message-generate"),
    ].filter((control) => control.closest(ROW));
    const sample = controls.find((control) =>
      [...control.closest(ROW).children].some(
        (item) => item.classList.contains("mes_edit") && shown(item),
      ),
    );
    // No row to judge by yet (none drawn, or all hidden while a reply is made).
    if (!sample) {
      state.known = false;
      return;
    }
    const message = sample.closest(".mes, .message-body");
    const row = sample.closest(ROW);
    const before = `${state.order}|${state.crowded}`;
    state.crowded = false;
    const order = getComputedStyle(
      row.querySelector(":scope > .mes_edit"),
    ).order;
    state.order = order === "0" ? "" : order;
    this.layMessageButtons(message, sample);
    state.crowded = shown(sample) && misplaced(sample, row);
    state.known = true;
    if (`${state.order}|${state.crowded}` === before)
      this.layMessageButtons(message, sample);
    else
      for (const control of controls)
        this.layMessageButtons(control.closest(".mes, .message-body"), control);
  },

  /** The row is measured again when the theme, the chat style or the width changes. */
  watchButtonRow() {
    let width = window.innerWidth;
    const again = () => {
      if (document.querySelector(".sv-message-generate"))
        this.scheduleButtonRowCheck();
      else this.buttonRow.known = false;
    };
    const resized = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      again();
    };
    window.addEventListener("resize", resized);
    // 실리태번 writes the theme's CSS into a <style> in the head, and its chat style and
    // "expand message actions" as classes on the body.
    const watch = new MutationObserver(again);
    watch.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    watch.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    this.eventCleanups.push(() => {
      window.removeEventListener("resize", resized);
      watch.disconnect();
      clearTimeout(this.buttonRowTimer);
      this.buttonRow = { order: "", crowded: false, known: false };
    });
  },
};
