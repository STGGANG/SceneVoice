import { escapeHtml } from "./common.js";

// Shared markup pieces for the settings panel and dialogs. Labels and hints are
// static strings written in this extension; tooltip text is always escaped.

export function infoTip(text, label = "설명") {
  return `<button type="button" class="sv-info" data-tip="${escapeHtml(text)}" aria-label="${escapeHtml(label)}" aria-expanded="false"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>`;
}

const tipFor = (label, tip) => (tip ? infoTip(tip, `${label} 설명`) : "");

/** `scope`: a quiet word on where the group applies (채팅 대사, 채팅·스마트폰). */
export function groupHtml({ id, icon, title, tip = "", body, fold = false, badge = "", scope = "" }) {
  const heading = `<i class="fa-solid fa-${icon} sv-group-icon" aria-hidden="true"></i><span class="sv-group-name">${title}</span>${tipFor(title, tip)}${scope ? `<span class="sv-scope">${scope}</span>` : ""}`;
  if (fold)
    return `<details class="sv-group sv-fold" id="${id}"><summary class="sv-group-title">${heading}<span class="sv-spacer"></span>${badge}<i class="fa-solid fa-chevron-down sv-fold-chevron" aria-hidden="true"></i></summary><div class="sv-group-body">${body}</div></details>`;
  return `<section class="sv-group" id="${id}"><h3 class="sv-group-title">${heading}</h3><div class="sv-group-body">${body}</div></section>`;
}

export function fieldHtml({ id, label, control, hint = "", tip = "", cls = "", attrs = "" }) {
  return `<div class="sv-field ${cls}" ${attrs}><div class="sv-label-line"><label for="${id}">${label}</label>${tipFor(label, tip)}</div>${control}${hint ? `<small class="sv-hint">${hint}</small>` : ""}</div>`;
}

/** `extra`: a small button after the label (a button inside the label doesn't flip the switch). */
export function switchHtml({ id, label, hint = "", checked = false, tip = "", cls = "", attrs = "", extra = "" }) {
  return `<label class="sv-switch-row ${cls}" for="${id}"><span class="sv-switch-text"><span class="sv-label-line"><span>${label}</span>${tipFor(label, tip)}${extra}</span>${hint ? `<small class="sv-hint">${hint}</small>` : ""}</span><input type="checkbox" class="sv-switch" id="${id}" ${checked ? "checked" : ""} ${attrs}></label>`;
}

/**
 * Choices as a list: a row each, with an icon, a title and a line under it, and a round radio.
 * `choices`: [value, icon, title, hint].
 */
export function choiceListHtml({ name, label, value, choices, tip = "", cls = "" }) {
  const rows = choices
    .map(
      ([key, icon, title, hint]) => `<label class="sv-choice"><span class="sv-choice-icon" aria-hidden="true"><i class="fa-solid fa-${icon}"></i></span><span class="sv-choice-text"><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ""}</span><input type="radio" name="${name}" value="${key}" ${key === value ? "checked" : ""}></label>`,
    )
    .join("");
  return `<div class="sv-field ${cls}"><div class="sv-label-line"><span id="${name}-label">${label}</span>${tipFor(label, tip)}</div><div class="sv-choices" role="radiogroup" aria-labelledby="${name}-label">${rows}</div></div>`;
}

export function rangeHtml({ id, min, max, step, value }) {
  return `<div class="sv-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" tabindex="-1" aria-hidden="true"><input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}"></div>`;
}

export function badgeHtml(forId, on = "켜짐", off = "꺼짐") {
  return `<span class="sv-badge sv-state-badge" data-sv-badge="${forId}" data-on="${on}" data-off="${off}"></span>`;
}

export function emptyHtml(icon, title, text = "") {
  return `<div class="sv-empty"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><strong>${escapeHtml(title)}</strong>${text ? `<span>${escapeHtml(text)}</span>` : ""}</div>`;
}

/* ---------- ⓘ tooltips ---------- */

let tipSequence = 0;

function tipHost(trigger) {
  return trigger.closest("dialog, #sv-panel") || trigger.parentElement;
}

export function closeTips(root = document) {
  root.querySelectorAll(".sv-tip-pop").forEach((pop) => {
    pop.svTrigger?.setAttribute("aria-expanded", "false");
    pop.svTrigger?.removeAttribute("aria-describedby");
    pop.remove();
  });
}

function placeTip(pop, trigger, host) {
  const frame = host.getBoundingClientRect();
  const anchor = trigger.getBoundingClientRect();
  const width = Math.max(180, Math.min(330, frame.width - 24));
  pop.style.width = `${width}px`;
  const originX = frame.left + host.clientLeft - host.scrollLeft;
  const originY = frame.top + host.clientTop - host.scrollTop;
  const center = anchor.left + anchor.width / 2;
  const left = Math.min(
    Math.max(center - 26, frame.left + 12),
    frame.right - width - 12,
  );
  pop.style.left = `${Math.round(left - originX)}px`;
  pop.style.setProperty("--sv-arrow-x", `${Math.round(center - left)}px`);
  const below = anchor.bottom + 8;
  const fitsBelow = below + pop.offsetHeight <= frame.bottom - 8;
  const top = fitsBelow ? below : anchor.top - pop.offsetHeight - 8;
  pop.classList.toggle("sv-tip-above", !fitsBelow);
  pop.style.top = `${Math.round(Math.max(frame.top + 8, top) - originY)}px`;
}

function openTip(trigger) {
  const host = tipHost(trigger);
  const pop = document.createElement("div");
  pop.className = "sv-tip-pop";
  pop.id = `sv-tip-${++tipSequence}`;
  pop.setAttribute("role", "tooltip");
  const lines = String(trigger.dataset.tip || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    pop.append(list);
  } else pop.textContent = lines[0] || "";
  pop.svTrigger = trigger;
  host.append(pop);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-describedby", pop.id);
  placeTip(pop, trigger, host);
}

/** Click ⓘ to open, click elsewhere / Escape / scroll to close. Safe to call repeatedly. */
export function bindInfoTips(root) {
  if (!root || root.svTipsBound) return;
  root.svTipsBound = true;
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest?.(".sv-info");
    if (trigger && root.contains(trigger)) {
      // Keeps a ⓘ inside <summary> or <label> from toggling its parent.
      event.preventDefault();
      event.stopPropagation();
      const wasOpen = trigger.getAttribute("aria-expanded") === "true";
      closeTips(root);
      if (!wasOpen) openTip(trigger);
      return;
    }
    if (!event.target.closest?.(".sv-tip-pop")) closeTips(root);
  });
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !root.querySelector(".sv-tip-pop")) return;
      const trigger = root.querySelector(".sv-info[aria-expanded='true']");
      event.preventDefault();
      event.stopPropagation();
      closeTips(root);
      trigger?.focus();
    },
    true,
  );
  // Follow the ⓘ while its list scrolls (a late or inertial scroll must not close a tip
  // that was just opened); close only once the ⓘ leaves the visible part of the list.
  root.addEventListener(
    "scroll",
    (event) => {
      if (event.target.closest?.(".sv-tip-pop")) return;
      root.querySelectorAll(".sv-tip-pop").forEach((pop) => {
        const trigger = pop.svTrigger;
        const area =
          event.target instanceof Element
            ? event.target.getBoundingClientRect()
            : null;
        const anchor = trigger?.getBoundingClientRect();
        if (
          !trigger?.isConnected ||
          (area &&
            event.target.contains(trigger) &&
            (anchor.bottom < area.top || anchor.top > area.bottom))
        ) {
          closeTips(root);
          return;
        }
        placeTip(pop, trigger, tipHost(trigger));
      });
    },
    true,
  );
}

/* ---------- range + number pairs ---------- */

function paintRange(range) {
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 1;
  const value = Number(range.value);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  range.style.setProperty("--sv-fill", `${Math.min(100, Math.max(0, percent))}%`);
}

/** The number input keeps the saved value; the slider is a shortcut that mirrors it. */
export function bindRanges(root) {
  root?.querySelectorAll(".sv-range").forEach((wrap) => {
    const range = wrap.querySelector('input[type="range"]');
    const number = wrap.querySelector('input[type="number"]');
    if (!range || !number || wrap.dataset.bound) return;
    wrap.dataset.bound = "true";
    const fromNumber = () => {
      if (number.value !== "" && Number.isFinite(Number(number.value)))
        range.value = number.value;
      paintRange(range);
    };
    range.addEventListener("input", () => {
      number.value = range.value;
      paintRange(range);
    });
    number.addEventListener("input", fromNumber);
    fromNumber();
  });
}

/** Folded groups show whether their main switch is on. */
export function bindStateBadges(root) {
  const update = () =>
    root?.querySelectorAll("[data-sv-badge]").forEach((badge) => {
      const input = document.getElementById(badge.dataset.svBadge);
      const on = Boolean(input?.checked);
      badge.textContent = on ? badge.dataset.on : badge.dataset.off;
      badge.classList.toggle("sv-badge-on", on);
    });
  root?.addEventListener("change", update);
  update();
}
