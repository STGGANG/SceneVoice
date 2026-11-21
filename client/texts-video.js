// 문자 영상: a text conversation drawn as it reads on the phone (bubbles coming in one by one,
// the view following the newest) with the voices its messages have, as one video file. The
// recording itself is the call video's (call-video.js).
import {
  FONT,
  HEIGHT,
  WIDTH,
  avatar,
  canvasOf,
  loadImage,
  roundRect,
  wrap,
} from "./call-video.js";
import { CARD_KINDS } from "./cards.js";

const HEAD = 150;
const SIDE = 28;
const BUBBLE_MAX = 470;
const TEXT_SIZE = 30;
const LINE = 42;
const PAD_X = 22;
const PAD_Y = 14;
const FACE = 56;
const APPEAR = 0.25;

/** A color the canvas can paint from the phone's theme, or the fallback. */
const themed = (name, fallback) => {
  const value = getComputedStyle(
    document.getElementById("sv-smartphone") || document.body,
  )
    .getPropertyValue(name)
    .trim();
  return /^(#|rgb|hsl)/.test(value) ? value : fallback;
};

export const textsVideo = {
  /** The messages a video holds: the whole room, or its last exchange (my texts and the answers). */
  threadVideoRange(thread, scope) {
    // A stretch picked in the room: from one message to another, whichever was tapped first.
    if (scope && typeof scope === "object") {
      const ends = [scope.from, scope.to].map((id) =>
        thread.findIndex((item) => item.id === id),
      );
      if (ends.some((at) => at < 0)) return [];
      return thread.slice(Math.min(...ends), Math.max(...ends) + 1);
    }
    if (scope !== "last") return thread;
    let start = thread.length;
    // Back over the answers, then over my texts before them.
    while (start > 0 && thread[start - 1].role !== "user") start -= 1;
    while (start > 0 && thread[start - 1].role === "user") start -= 1;
    return thread.slice(start);
  },

  /**
   * 구간 고르기: the room turns into a picker. A tap on a message starts the stretch, the next
   * tap ends it (a third starts again); the bar at the bottom makes the video or closes.
   */
  startVideoPick(key) {
    this.videoPick = { key, from: "", to: "" };
    const body = document.querySelector("#sv-smartphone .sv-smartphone-body");
    if (body) this.showVideoPick(body);
  },

  /** Draws the picker over the room as it is now (again after each redraw of the room). */
  showVideoPick(body) {
    const pick = this.videoPick;
    const view = body.querySelector(".sv-msg-thread-view:not(.sv-msg-away)");
    if (!pick || !view || view.dataset.thread !== pick.key) return;
    view.classList.add("sv-msg-picking");
    const idOf = (row) => row.querySelector("[data-id]")?.dataset.id || "";
    const rows = [...view.querySelectorAll(".sv-msg-list .sv-msg-row")].filter(
      idOf,
    );
    let bar = view.querySelector(".sv-msg-pickbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "sv-msg-pickbar";
      bar.innerHTML =
        '<span data-pick-note></span><button type="button" data-pick-cancel>취소</button><button type="button" class="sv-pick-make" data-pick-make>영상 만들기</button>';
      view.append(bar);
      const close = () => {
        this.videoPick = null;
        this.renderSmartphone();
      };
      bar.querySelector("[data-pick-cancel]").addEventListener("click", close);
      bar.querySelector("[data-pick-make]").addEventListener("click", () => {
        const { from, to } = this.videoPick || {};
        if (!from) return;
        close();
        this.run(() => this.downloadThreadVideo(pick.key, { from, to }));
      });
      // While picking, a tap anywhere on a message picks it (its own buttons stay still).
      view.querySelector(".sv-msg-list").addEventListener(
        "click",
        (event) => {
          if (!this.videoPick) return;
          const row = event.target.closest(".sv-msg-row");
          event.preventDefault();
          event.stopPropagation();
          const id = row && idOf(row);
          if (!id) return;
          if (!pick.from || pick.to !== pick.from) pick.from = pick.to = id;
          else pick.to = id;
          this.showVideoPick(body);
        },
        true,
      );
      view
        .querySelector(".sv-msg-list")
        .addEventListener("keydown", (event) => {
          if (
            this.videoPick &&
            (event.key === "Enter" || event.key === " ") &&
            event.target.matches(".sv-msg-row")
          ) {
            event.preventDefault();
            event.target.click();
          }
        });
    }
    const ends = [pick.from, pick.to].map((id) =>
      rows.findIndex((row) => idOf(row) === id),
    );
    const [first, last] = [Math.min(...ends), Math.max(...ends)];
    rows.forEach((row, index) =>
      row.classList.toggle(
        "sv-msg-picked",
        first >= 0 && index >= first && index <= last,
      ),
    );
    // Reached by keyboard too: each message is a button while picking.
    for (const row of rows) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute(
        "aria-pressed",
        String(row.classList.contains("sv-msg-picked")),
      );
    }
    const count = first >= 0 ? last - first + 1 : 0;
    bar.querySelector("[data-pick-note]").textContent = !count
      ? "영상에 넣을 첫 문자를 눌러 주십시오"
      : pick.from === pick.to
        ? "마지막 문자를 눌러 주십시오 (이대로면 1개)"
        : `문자 ${count}개를 골랐습니다`;
    bar.querySelector("[data-pick-make]").disabled = !count;
  },

  /**
   * 영상 저장: `scope` "last" (the last exchange), "all" (every message of the room) or
   * { from, to } (a stretch picked in the room, by message id).
   */
  async downloadThreadVideo(key, scope = "last") {
    const thread = (await this.loadMessages()).filter(
      (item) => this.messageThreadOf(item) === key,
    );
    const items = this.threadVideoRange(thread, scope).filter(
      (item) => item.text || item.card?.title,
    );
    if (!items.length) throw new Error("영상에 넣을 문자가 없습니다.");
    const contact = this.threadContact(key);
    const lacking = items.filter(
      (item) => item.role !== "user" && !item.audio_url && item.text,
    );
    const make =
      lacking.length > 0 &&
      confirm(
        `목소리가 없는 문자 ${lacking.length}개가 있습니다. 목소리를 만들어서 함께 넣으시겠습니까? (만드는 만큼 음성 생성 비용이 듭니다)\n취소하면 그 문자는 글자로만 나옵니다.`,
      );
    await this.makeRecordingVideo({
      heading: "문자 영상 만들기",
      scene: { call_direction: "texts", key, contact },
      silentOk: true,
      trackOptions: () => ({ lead: 0.6, gap: 0.35, tail: 1.4 }),
      name: `${contact.name}-문자-${this.fileStamp()}`,
      gather: async (onStep) => {
        const clips = [];
        for (const [index, item] of items.entries()) {
          onStep(index, items.length);
          let url = item.audio_url ? this.apiUrl(item.audio_url) : "";
          let revoke = false;
          if (!url && make && lacking.includes(item)) {
            url =
              (await this.generateVoiceMessageAudio(item, null, false, {
                play: false,
                quiet: true,
              }).catch(() => "")) || "";
            revoke = Boolean(url);
          }
          clips.push(
            url
              ? {
                  url,
                  revoke,
                  turn: item,
                  filter:
                    (item.kind || "voice") === "voice" &&
                    this.shouldApplyCommunicationFilter("voice_message", item),
                }
              : { silent: true, turn: item },
          );
        }
        return { clips, left: 0 };
      },
    });
  },

  /** The room as the video shows it: `draw(time)` paints the messages sent by then. */
  async textsVideoScene(scene, lines) {
    const { contact } = scene;
    const colors = {
      bg: themed("--ph-bg", "#000000"),
      fg: themed("--ph-fg", "#f5f5f7"),
      muted: themed("--ph-muted", "rgba(235, 235, 245, 0.62)"),
      theirs: themed("--ph-surface", "#1c1c1e"),
      mine: themed("--ph-blue", "#0a84ff"),
      line: themed("--ph-line", "rgba(255, 255, 255, 0.12)"),
    };
    const canvas = canvasOf(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    const group = Boolean(contact.group);
    const people = group ? contact.members : [contact];
    const faces = new Map();
    await Promise.all(
      people.map(async (person) =>
        faces.set(
          person.key,
          avatar(await loadImage(person.avatarUrl), person.name, FACE * 2),
        ),
      ),
    );
    const headFaces = people
      .slice(0, 2)
      .map((person) => faces.get(person.key))
      .filter(Boolean);
    // Each message laid out once: where its bubbles sit in the conversation's own height.
    const cardName = (item) =>
      CARD_KINDS.find(([type]) => type === item.card?.type)?.[1] || "";
    let y = 0;
    let before = null;
    const rows = lines.map(({ start, end, turn, silent }) => {
      const mine = turn.role === "user";
      const sender = mine
        ? null
        : group
          ? this.memberContact({
              key: turn.character_key,
              name: turn.character_name,
            })
          : contact;
      const same =
        before &&
        before.mine === mine &&
        (mine || before.senderKey === sender?.key);
      y += before ? (same ? 10 : 30) : 0;
      const labelled = group && !mine && !same;
      const labelTop = y;
      if (labelled) y += 34;
      ctx.font = `${TEXT_SIZE}px ${FONT}`;
      const kind = cardName(turn);
      const words = `${kind ? `[${kind}] ` : ""}${turn.text || turn.card?.title || ""}`;
      const bubbles = words
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const wrapped = wrap(ctx, line, BUBBLE_MAX - PAD_X * 2);
          const width =
            Math.max(...wrapped.map((part) => ctx.measureText(part).width)) +
            PAD_X * 2;
          const height = wrapped.length * LINE + PAD_Y * 2;
          const box = { top: y, width, height, lines: wrapped };
          y += height + 8;
          return box;
        });
      y -= bubbles.length ? 8 : 0;
      const row = {
        start,
        end,
        mine,
        senderKey: sender?.key || "",
        sender,
        labelled,
        labelTop,
        bubbles,
        bottom: y,
        voiced: !silent,
      };
      before = row;
      return row;
    });
    const room = HEIGHT - HEAD - 70;
    const left = SIDE + (group ? FACE + 14 : 0);
    const ease = (value) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;
    const draw = (time) => {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const shown = rows.filter((row) => row.start <= time);
      // The view follows the newest message, moving to it as it comes in.
      const scrollOf = (count) =>
        count > 0 ? Math.max(0, rows[count - 1].bottom - room) : 0;
      const newest = shown.at(-1);
      const moved = newest ? ease((time - newest.start) / 0.3) : 1;
      const scroll =
        scrollOf(shown.length - 1) +
        (scrollOf(shown.length) - scrollOf(shown.length - 1)) * moved;
      const top = HEAD + 34 - scroll;
      ctx.textBaseline = "middle";
      for (const row of shown) {
        if (top + row.bottom < HEAD - 20 || top + row.labelTop > HEIGHT)
          continue;
        const coming = ease((time - row.start) / APPEAR);
        ctx.globalAlpha = coming;
        const rise = (1 - coming) * 18;
        if (row.labelled) {
          ctx.font = `600 22px ${FONT}`;
          ctx.fillStyle = colors.muted;
          ctx.textAlign = "left";
          ctx.fillText(
            row.sender?.name || "",
            left + 6,
            top + row.labelTop + 14 + rise,
          );
          const face = faces.get(row.senderKey);
          if (face)
            ctx.drawImage(face, SIDE, top + row.labelTop + rise, FACE, FACE);
        }
        const playing = row.voiced && time >= row.start && time < row.end;
        for (const bubble of row.bubbles) {
          const x = row.mine ? WIDTH - SIDE - bubble.width : left;
          const at = top + bubble.top + rise;
          roundRect(ctx, x, at, bubble.width, bubble.height, 26);
          ctx.fillStyle = row.mine ? colors.mine : colors.theirs;
          ctx.fill();
          if (playing) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = colors.mine;
            ctx.stroke();
          }
          ctx.font = `${TEXT_SIZE}px ${FONT}`;
          ctx.fillStyle = row.mine ? "#ffffff" : colors.fg;
          ctx.textAlign = "left";
          bubble.lines.forEach((part, index) =>
            ctx.fillText(part, x + PAD_X, at + PAD_Y + LINE * (index + 0.5)),
          );
        }
        ctx.globalAlpha = 1;
      }
      // The room's head, over the messages that have scrolled up.
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, WIDTH, HEAD);
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, HEAD - 1, WIDTH, 1);
      headFaces.forEach((face, index) =>
        ctx.drawImage(face, SIDE + index * 34, 50 + index * 10, 68, 68),
      );
      const nameLeft = SIDE + 68 + (headFaces.length > 1 ? 34 : 0) + 20;
      ctx.textAlign = "left";
      ctx.font = `700 34px ${FONT}`;
      ctx.fillStyle = colors.fg;
      const name =
        wrap(ctx, contact.name || "", WIDTH - nameLeft - SIDE)[0] || "";
      ctx.fillText(name, nameLeft, group ? 72 : 86);
      if (group) {
        ctx.font = `24px ${FONT}`;
        ctx.fillStyle = colors.muted;
        ctx.fillText(`${contact.members.length + 1}명`, nameLeft, 112);
      }
    };
    draw(0);
    return { canvas, draw };
  },
};
