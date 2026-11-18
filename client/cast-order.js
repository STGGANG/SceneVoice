// Long-press sorting for global people: up and down their list, and into or out of its folders.
// A folder is moved the same way, by its own line, among the other folders.
// Touch scrolling stays native until the hold completes.
// The list holds folders (details.sv-cast-folder > .sv-folder-members > rows) and, after them,
// the rows in no folder. `onChange` gets every row in its new order, [{ key, folder }], and the
// folders' names in theirs.
export function bindCastOrder(list, onChange) {
  if (!list) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  const rows = () => [...list.querySelectorAll(".sv-member")];
  const folders = () => [...list.querySelectorAll(":scope > .sv-cast-folder")];
  const folderOf = (row) =>
    row.parentElement.closest("[data-folder]")?.dataset.folder || "";
  const placed = () =>
    rows().map((row) => ({ key: row.dataset.key, folder: folderOf(row) }));
  const folderNames = () => folders().map((folder) => folder.dataset.folder);
  const shape = () => JSON.stringify([placed(), folderNames()]);
  const scroller = list.closest(".sv-tab-content");
  let hold = null;
  let frame = 0;
  let suppressClickUntil = 0;
  const onTouchMove = (event) => {
    if (!hold?.touch) return;
    if (event.touches.length !== 1) return finish();
    const touch = [...event.touches].find(
      (item) => item.identifier === hold.id,
    );
    if (touch) move(event, touch.clientX, touch.clientY);
  };
  const onTouchEnd = (event) => {
    if (
      hold?.touch &&
      [...event.changedTouches].some((touch) => touch.identifier === hold.id)
    ) {
      if (hold.active && event.cancelable) event.preventDefault();
      finish(event.type === "touchend");
    }
  };
  let watching = false;
  function watchTouch(on) {
    if (on === watching) return;
    watching = on;
    for (const [type, listener] of [
      ["touchmove", onTouchMove],
      ["touchend", onTouchEnd],
      ["touchcancel", onTouchEnd],
    ])
      if (on) document.addEventListener(type, listener, { passive: false });
      else document.removeEventListener(type, listener, { passive: false });
  }
  /** The summary of a person's row or of a folder (not a control on it). */
  const summaryFor = (target) => {
    if (target.closest("input, button, select, textarea, label, a"))
      return null;
    const summary = target.closest("summary");
    const row = summary?.parentElement;
    return row?.matches(".sv-member, .sv-cast-folder") && list.contains(row)
      ? summary
      : null;
  };
  const isFolder = (row) => row.matches(".sv-cast-folder");
  /** A closed folder the held row is over: the row goes into it when let go. */
  const setDrop = (folder) => {
    if (!hold || hold.drop === folder) return;
    hold.drop?.classList.remove("sv-folder-drop");
    hold.drop = folder;
    folder?.classList.add("sv-folder-drop");
  };
  const finish = (commit = false) => {
    watchTouch(false);
    if (!hold) return;
    const current = hold;
    hold = null;
    clearTimeout(current.timer);
    cancelAnimationFrame(frame);
    current.drop?.classList.remove("sv-folder-drop");
    if (list.hasPointerCapture?.(current.id))
      list.releasePointerCapture(current.id);
    if (!current.active) return;
    suppressClickUntil = Date.now() + 400;
    current.row.classList.remove("sv-member-dragging");
    list.classList.remove("sv-member-sorting");
    current.row.open = current.open;
    if (!commit) {
      for (const { row, box } of current.original) box.append(row);
      return;
    }
    if (current.drop)
      current.drop
        .querySelector(":scope > .sv-folder-members")
        .append(current.row);
    if (shape() !== current.shape) onChange(placed(), folderNames());
  };
  const place = () => {
    if (!hold?.active) return;
    // A held folder moves among the folders only (they stay above the rows in no folder).
    if (isFolder(hold.row)) {
      const others = folders().filter((item) => item !== hold.row);
      const next = others.find((item) => {
        const rect = item.getBoundingClientRect();
        return hold.y < rect.top + rect.height / 2;
      });
      const before =
        next ||
        (others.length
          ? others.at(-1).nextElementSibling
          : hold.row.nextElementSibling);
      if (before !== hold.row && hold.row.nextElementSibling !== before)
        list.insertBefore(hold.row, before);
      return;
    }
    const folder = folders().find((item) => {
      const rect = item.getBoundingClientRect();
      return hold.y >= rect.top && hold.y <= rect.bottom;
    });
    if (folder && !folder.open) return setDrop(folder);
    setDrop(null);
    const box = folder
      ? folder.querySelector(":scope > .sv-folder-members")
      : list;
    const next = [...box.children].find((row) => {
      if (row === hold.row || !row.matches(".sv-member")) return false;
      const rect = row.getBoundingClientRect();
      return hold.y < rect.top + rect.height / 2;
    });
    if (
      hold.row.parentElement !== box ||
      hold.row.nextElementSibling !== (next || null)
    )
      box.insertBefore(hold.row, next || null);
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
    if (!summary) return;
    const held = summary.parentElement;
    if (
      isFolder(held)
        ? folders().length < 2
        : rows().length < 2 && !folders().length
    )
      return;
    hold = {
      row: held,
      id,
      x,
      y,
      touch,
      shape: shape(),
      original: (isFolder(held) ? [...list.children] : rows()).map((row) => ({
        row,
        box: row.parentElement,
      })),
    };
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
  list.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.pointerType !== "touch" &&
        event.button === 0 &&
        event.isPrimary
      )
        start(
          event.target,
          event.pointerId,
          event.clientX,
          event.clientY,
          false,
        );
    },
    { signal },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (hold && !hold.touch && event.pointerId === hold.id)
        move(event, event.clientX, event.clientY);
    },
    { signal },
  );
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    document.addEventListener(
      type,
      (event) => {
        if (hold && !hold.touch && event.pointerId === hold.id)
          finish(type === "pointerup");
      },
      { signal },
    );
  // A non-passive touchmove lets a held row move on iOS. It is listened for only while a finger
  // is down on a row: one left on the page would make every scroll wait for it.
  list.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) return finish();
      const touch = event.touches[0];
      start(event.target, touch.identifier, touch.clientX, touch.clientY, true);
      if (hold?.touch) watchTouch(true);
    },
    { passive: true, signal },
  );
  signal.addEventListener("abort", () => watchTouch(false));
  list.addEventListener(
    "click",
    (event) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, signal },
  );
  list.addEventListener(
    "contextmenu",
    (event) => {
      if (summaryFor(event.target)) event.preventDefault();
    },
    { signal },
  );
  list.addEventListener(
    "dragstart",
    (event) => {
      if (summaryFor(event.target)) event.preventDefault();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && hold) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish();
      }
    },
    { capture: true, signal },
  );
  // Alt + ↑/↓: one place up or down; at the edge of a folder, into the open folder (or the rows
  // in no folder) next to it.
  list.addEventListener(
    "keydown",
    (event) => {
      const summary = summaryFor(event.target);
      if (
        !summary ||
        !event.altKey ||
        !["ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      finish();
      const up = event.key === "ArrowUp";
      const row = summary.parentElement;
      if (isFolder(row)) {
        const all = folders();
        const other = all[all.indexOf(row) + (up ? -1 : 1)];
        if (!other) return;
        list.insertBefore(row, up ? other : other.nextElementSibling);
        summary.focus();
        onChange(placed(), folderNames());
        return;
      }
      const box = row.parentElement;
      let other = row;
      do other = up ? other.previousElementSibling : other.nextElementSibling;
      while (other && !other.matches(".sv-member"));
      if (other) box.insertBefore(row, up ? other : other.nextElementSibling);
      else {
        const boxes = [
          ...list.querySelectorAll(
            ":scope > .sv-cast-folder[open] > .sv-folder-members",
          ),
          list,
        ];
        const next = boxes[boxes.indexOf(box) + (up ? -1 : 1)];
        if (!next) return;
        if (up) next.append(row);
        else if (next === list)
          list.insertBefore(row, list.querySelector(":scope > .sv-member"));
        else next.prepend(row);
      }
      summary.focus();
      onChange(placed(), folderNames());
    },
    { signal },
  );
  window.addEventListener("blur", () => finish(), { signal });
  return () => {
    finish();
    controller.abort();
  };
}
