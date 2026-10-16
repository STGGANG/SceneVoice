// Long-press sorting for global people. Touch scrolling stays native until the hold completes.
export function bindCastOrder(list, onChange) {
  if (!list) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  const rows = () => [...list.children].filter((row) => row.matches(".sv-member"));
  const keys = () => rows().map((row) => row.dataset.key);
  const scroller = list.closest(".sv-tab-content");
  let hold = null;
  let frame = 0;
  let suppressClickUntil = 0;
  const onTouchMove = (event) => {
    if (!hold?.touch) return;
    if (event.touches.length !== 1) return finish();
    const touch = [...event.touches].find((item) => item.identifier === hold.id);
    if (touch) move(event, touch.clientX, touch.clientY);
  };
  const onTouchEnd = (event) => {
    if (hold?.touch && [...event.changedTouches].some((touch) => touch.identifier === hold.id)) {
      if (hold.active && event.cancelable) event.preventDefault();
      finish(event.type === "touchend");
    }
  };
  let watching = false;
  function watchTouch(on) {
    if (on === watching) return;
    watching = on;
    for (const [type, listener] of [["touchmove", onTouchMove], ["touchend", onTouchEnd], ["touchcancel", onTouchEnd]])
      if (on) document.addEventListener(type, listener, { passive: false });
      else document.removeEventListener(type, listener, { passive: false });
  }
  const summaryFor = (target) => {
    if (target.closest("input, button, select, textarea, label, a")) return null;
    const summary = target.closest("summary");
    return summary?.parentElement.parentElement === list ? summary : null;
  };
  const finish = (commit = false) => {
    watchTouch(false);
    if (!hold) return;
    const current = hold;
    hold = null;
    clearTimeout(current.timer);
    cancelAnimationFrame(frame);
    if (list.hasPointerCapture?.(current.id)) list.releasePointerCapture(current.id);
    if (!current.active) return;
    suppressClickUntil = Date.now() + 400;
    current.row.classList.remove("sv-member-dragging");
    list.classList.remove("sv-member-sorting");
    current.row.open = current.open;
    if (!commit) {
      for (const row of current.original) list.append(row);
    } else if (rows().some((row, index) => row !== current.original[index])) {
      onChange(keys());
    }
  };
  const place = () => {
    if (!hold?.active) return;
    const next = rows().find((row) => {
      if (row === hold.row) return false;
      const rect = row.getBoundingClientRect();
      return hold.y < rect.top + rect.height / 2;
    });
    if (hold.row.nextElementSibling !== (next || null)) list.insertBefore(hold.row, next || null);
  };
  const follow = () => {
    if (!hold?.active) return;
    if (!list.isConnected || !list.getClientRects().length) return finish();
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const delta = hold.y < top + 44 ? -8 : hold.y > bottom - 44 ? 8 : 0;
      if (delta) {
        scroller.scrollTop += delta;
        place();
      }
    }
    frame = requestAnimationFrame(follow);
  };
  const start = (target, id, x, y, touch) => {
    finish();
    const summary = summaryFor(target);
    if (!summary || rows().length < 2) return;
    hold = { row: summary.parentElement, id, x, y, touch, original: rows() };
    hold.timer = setTimeout(() => {
      if (!list.isConnected || !list.getClientRects().length) return finish();
      hold.active = true;
      hold.open = hold.row.open;
      hold.row.open = false;
      hold.row.classList.add("sv-member-dragging");
      list.classList.add("sv-member-sorting");
      if (!touch) list.setPointerCapture(id);
      frame = requestAnimationFrame(follow);
    }, 450);
  };
  const move = (event, x, y) => {
    if (!hold) return;
    if (!hold.active) {
      if (Math.hypot(x - hold.x, y - hold.y) > 8) finish();
      return;
    }
    if (event.cancelable) event.preventDefault();
    hold.y = y;
    place();
  };
  list.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.button === 0 && event.isPrimary)
      start(event.target, event.pointerId, event.clientX, event.clientY, false);
  }, { signal });
  document.addEventListener("pointermove", (event) => {
    if (hold && !hold.touch && event.pointerId === hold.id) move(event, event.clientX, event.clientY);
  }, { signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    document.addEventListener(type, (event) => {
      if (hold && !hold.touch && event.pointerId === hold.id) finish(type === "pointerup");
    }, { signal });
  // A non-passive touchmove lets a held row move on iOS. It is listened for only while a finger
  // is down on a row: one left on the page would make every scroll wait for it.
  list.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return finish();
    const touch = event.touches[0];
    start(event.target, touch.identifier, touch.clientX, touch.clientY, true);
    if (hold?.touch) watchTouch(true);
  }, { passive: true, signal });
  signal.addEventListener("abort", () => watchTouch(false));
  list.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, signal });
  list.addEventListener("contextmenu", (event) => {
    if (summaryFor(event.target)) event.preventDefault();
  }, { signal });
  list.addEventListener("dragstart", (event) => {
    if (summaryFor(event.target)) event.preventDefault();
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && hold) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    }
  }, { capture: true, signal });
  list.addEventListener("keydown", (event) => {
    const summary = summaryFor(event.target);
    if (!summary || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    finish();
    const row = summary.parentElement;
    const other = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    list.insertBefore(row, event.key === "ArrowUp" ? other : other.nextElementSibling);
    summary.focus();
    onChange(keys());
  }, { signal });
  window.addEventListener("blur", () => finish(), { signal });
  return () => {
    finish();
    controller.abort();
  };
}
