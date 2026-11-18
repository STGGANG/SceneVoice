// 채팅 기억 · 말풍선 보기: a kept call or text conversation drawn as chat bubbles under its
// message. Only what is shown changes; the memory's own text (what the AI reads) stays as it is.

import { escapeHtml } from "./common.js";

const unescape = (value) =>
  String(value)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const MARKS = {
  "voice message": "음성 메시지",
  voicemail: "음성 사서함",
  "in the background": "옆에서",
};
const OUTCOMES = { ended: "종료", rejected: "거절", missed: "부재중" };

/**
 * A memory's text read back into who said what. `me`: the user's character, whose lines go on
 * the right. Null when the text isn't one of ours (edited out of shape): it is shown as written.
 */
export function parseMemoryText(text, me = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const open = /^<(CALL|TEXT_MESSAGES|VOICE_MESSAGE)\b([^>]*)>$/.exec(
    lines[0] || "",
  );
  if (!open) return null;
  const attrs = {};
  for (const match of open[2].matchAll(/([a-z_]+)="([^"]*)"/g))
    attrs[match[1]] = unescape(match[2]);
  const kind = { CALL: "call", TEXT_MESSAGES: "texts", VOICE_MESSAGE: "voice" }[
    open[1]
  ];
  // Whoever the opening line names can speak; anything else before a colon is part of a line.
  const speakers = new Set(
    [
      me,
      "?",
      ...["character", "members", "between", "initiated_by", "caller"].flatMap(
        (name) => String(attrs[name] || "").split(", "),
      ),
    ].filter(Boolean),
  );
  const result = {
    kind,
    attrs,
    absent: attrs.user_present === "false",
    left: false,
    notes: [],
    items: [],
  };
  for (const line of lines.slice(1)) {
    if (/^<\/(CALL|TEXT_MESSAGES|VOICE_MESSAGE)>$/.test(line)) continue;
    // Said to the AI only: the story's context line, and what the user's character didn't see.
    if (/^Context: /.test(line)) continue;
    if (/^\(.* (has not seen it|doesn't know it happened)\.\)$/.test(line))
      continue;
    if (/^\(.* left the group chat\.\)$/.test(line)) {
      result.left = true;
      continue;
    }
    const said =
      /^(.+?)(?: \((voice message|voicemail|in the background)\))?: (.*)$/.exec(
        line,
      );
    if (said && speakers.has(said[1])) {
      let words = said[3];
      let time = "";
      const stamped =
        kind === "texts" ? /^\(([^)]{1,60})\) (.*)$/.exec(words) : null;
      if (stamped && /\d{1,2}:\d{2}/.test(stamped[1]))
        [, time, words] = stamped;
      result.items.push({
        who: said[1],
        mine: Boolean(me) && said[1] === me,
        mark: MARKS[said[2]] || "",
        time,
        // A person's texts sent one after another were kept on one line.
        parts:
          kind === "texts" && said[2] !== "voice message"
            ? words.split(" / ").filter(Boolean)
            : [words],
      });
    } else if (result.items.length) result.items.at(-1).parts.push(line);
    else result.notes.push(line);
  }
  return result.items.length ? result : null;
}

/** What kind of conversation it was, in a short line over the bubbles ("" when nothing to say). */
function headLine(memory) {
  const { kind, attrs } = memory;
  const parts = [];
  if (kind === "call") {
    if (memory.absent) parts.push("내가 듣지 못한 통화");
    else if (attrs.initiated_by) parts.push(`${attrs.initiated_by}의 전화`);
    if (attrs.outcome && attrs.outcome !== "ended")
      parts.push(OUTCOMES[attrs.outcome] || attrs.outcome);
  }
  if (kind === "texts" && attrs.group) {
    parts.push(memory.absent ? "내가 없는 단체방" : "단체방");
    if (attrs.members) parts.push(attrs.members);
  }
  if (attrs.time) parts.push(attrs.time);
  return parts.join(" · ");
}

/** The bubbles of one memory, or "" when its text can't be read back (shown as written then). */
export function memoryBubblesHtml(text, me = "") {
  const memory = parseMemoryText(text, me);
  if (!memory) return "";
  const head = headLine(memory);
  const rows = memory.items.map((item, index) => {
    const before = memory.items[index - 1];
    const same = before && before.who === item.who && before.mark === item.mark;
    return `<div class="sv-mb-line${item.mine ? " sv-mb-mine" : ""}${same ? " sv-mb-same" : ""}">
      <span class="sv-mb-who">${escapeHtml(item.who)}${item.mark ? `<em>${item.mark}</em>` : ""}</span>
      ${item.parts.map((part) => `<span class="sv-mb-bubble">${escapeHtml(part)}</span>`).join("")}
      ${item.time ? `<small class="sv-mb-time">${escapeHtml(item.time)}</small>` : ""}
    </div>`;
  });
  return `<div class="sv-memory-bubbles sv-memory-body" data-kind="${memory.kind}">
    ${head ? `<p class="sv-mb-note">${escapeHtml(head)}</p>` : ""}
    ${memory.notes.map((note) => `<p class="sv-mb-note">${escapeHtml(note)}</p>`).join("")}
    ${rows.join("")}
    ${memory.left ? '<p class="sv-mb-note">내가 방에서 나감</p>' : ""}
  </div>`;
}
