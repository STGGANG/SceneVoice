// 선연락 · 시간 방식: people reach out as real time passes, whether or not the 실리태번 chat
// moves. Every so often (a random wait between the two settings) one thing happens: someone
// calls or texts me, a room that talks by itself goes on, a memo is left, or two people phone
// each other. Works only while this page is open; nothing is stored for it but the phone's own
// records (which also keep two devices from both reaching out at once).

import { stOf } from "./common.js";
import {
  CONTACTS_PER_ROUND,
  diceContactType,
  sendDiceContacts,
} from "./outreach.js";

const GROUP = "group:";
// How much of their 선연락 빈도 lets one more person reach out along with the one drawn.
const COMPANY_WEIGHT = 0.5;
const MINUTE = 60000;
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};
// Tried once more when it fails (runtime.js: twice), where the app has it.
const twice = (app, task) => (app.twice ? app.twice(task) : task());
const pick = (list) => list[Math.floor(Math.random() * list.length)];
/** One of `people`, more likely the more they reach out (선연락 빈도). */
function pickByRate(people, rateOf) {
  const weights = people.map((person) => Math.max(1, rateOf(person.key)));
  let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) {
    roll -= weight;
    if (roll <= 0) return people[index];
  }
  return people.at(-1);
}

export const timedOutreach = {
  /** The wait before the next thing, in ms: a random time between the two settings. */
  timedWait() {
    const settings = this.config.outreach || {};
    const min = clamp(settings.time_min, 1, 1440, 30);
    const max = Math.max(min, clamp(settings.time_max, 1, 1440, 120));
    return Math.round((min + Math.random() * (max - min)) * MINUTE);
  },

  /** Looked at once a minute (see init): acts when the wait for this chat is over. */
  async timedOutreachTick() {
    // Cards that aren't open take their own turns, whatever the open chat does (visit.js).
    if (
      this.config.active !== false &&
      !(this.generatingSince && Date.now() - this.generatingSince < 180000)
    )
      this.run?.(() => this.timedOtherCardsTick?.());
    if (
      this.config.active === false ||
      this.outreachMode() !== "time" ||
      !this.outreachOn() ||
      !this.hasCharacterChat()
    )
      return (this.timedNext = null);
    const chatId = this.currentChatId();
    // A chat just opened (or the mode just chosen) starts its wait from now.
    if (this.timedNext?.chatId !== chatId)
      return (this.timedNext = { chatId, at: Date.now() + this.timedWait() });
    if (Date.now() < this.timedNext.at || this.timedBusy) return null;
    this.timedNext = { chatId, at: Date.now() + this.timedWait() };
    // 연락하지 않는 시간 of this card: the turn passes.
    if (this.quietHours?.()) return null;
    // A reply being written, a text on its way: the turn is skipped, not queued.
    if (
      (this.generatingSince && Date.now() - this.generatingSince < 180000) ||
      this.voiceMessageBusy ||
      this.textReplyBusy ||
      this.incomingTexts.length
    )
      return null;
    this.timedBusy = true;
    try {
      await this.timedOutreachAct();
    } finally {
      this.timedBusy = false;
    }
    return null;
  },

  /** What could happen now, and one of them does. */
  async timedOutreachAct() {
    const people = this.statePeople().filter((person) => !person.hidden);
    if (!people.length) return;
    const chat = stOf(this)?.chat || [];
    const latest = this.latestReplyIndex();
    const sourceMessageId =
      latest >= 0 && chat[latest]
        ? `${latest}-${this.messageHash(chat[latest])}`
        : "";
    const options = [];
    if (
      (this.autoCallOn() || this.autoTextOn()) &&
      (await this.timedContactAllowed())
    )
      options.push(
        ...Array(3).fill(() => this.timedContact(people, sourceMessageId)),
      );
    await this.loadMessageGroups?.().catch(() => []);
    const rooms = (this.messageGroups || []).filter(
      (group) =>
        this.roomCycles(group) &&
        this.roomAutoAllowed(group.without_user === true),
    );
    if (rooms.length)
      options.push(...Array(2).fill(() => this.timedRoom(pick(rooms))));
    if (this.selfTextsOn() && people.length > 1)
      options.push(() => this.selfTalkTick());
    if (this.autoMemosOn?.())
      options.push(() =>
        twice(this, () =>
          this.writeVoiceMemo(pick(people), "", sourceMessageId, {
            origin: "auto",
          }),
        ),
      );
    if (this.overheardCallsOn() && people.length > 1)
      options.push(() => {
        const [caller, callee] = [...people].sort(() => Math.random() - 0.5);
        return twice(this, () =>
          this.writeOverheardCall(caller, callee, "", sourceMessageId),
        );
      });
    if (!options.length) return;
    await pick(options)().catch((error) => {
      if (error.name === "AbortError") throw error;
      console.warn("[SceneVoice] 시간 방식 선연락 실패", error);
    });
  },

  /**
   * Someone may reach me now: under the day's limit, and nobody did within the shortest wait
   * (read from the phone's own records, so another device that just did counts too).
   */
  async timedContactAllowed() {
    const settings = this.config.outreach || {};
    const cap = clamp(settings.time_daily_max, 0, 50, 6);
    const gap = clamp(settings.time_min, 1, 1440, 30) * MINUTE;
    const today = new Date().toDateString();
    const times = [];
    try {
      const [items, response] = await Promise.all([
        this.loadMessages(),
        this.request(
          `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=30`,
          { cache: "no-store" },
          5000,
        ),
      ]);
      for (const item of items)
        if (
          item.origin === "incoming" &&
          !String(item.thread_key || "").startsWith(GROUP)
        )
          times.push(item.created_at);
      const sessions = response.ok ? (await response.json()).items || [] : [];
      for (const session of sessions)
        if (session.call_direction === "incoming")
          times.push(session.started_at || session.created_at);
    } catch {
      return false;
    }
    const stamps = times
      .map((time) => new Date(time).getTime())
      .filter(Number.isFinite);
    if (stamps.some((stamp) => Date.now() - stamp < gap)) return false;
    return (
      !cap ||
      stamps.filter((stamp) => new Date(stamp).toDateString() === today)
        .length < cap
    );
  },

  /**
   * Someone calls or texts me, drawn by their 선연락 빈도; now and then another does too (half
   * their 선연락 빈도 as the chance), CONTACTS_PER_ROUND at most and one call among them.
   * 상황에 맞을 때만 연락 lets each find it makes no sense now.
   */
  async timedContact(people, sourceMessageId) {
    const rateOf = (key) => this.contactRate(key);
    const decisions = [];
    let rest = people;
    while (rest.length && decisions.length < CONTACTS_PER_ROUND) {
      const person = pickByRate(rest, rateOf);
      const rate = rateOf(person.key);
      rest = rest.filter((other) => other.key !== person.key);
      if (decisions.length && Math.random() >= (rate / 100) * COMPANY_WEIGHT)
        break;
      const type = diceContactType(
        this,
        this.onCall?.() ||
          decisions.some((item) => item.type === "incoming_call"),
      );
      if (!type) break;
      decisions.push({ person, type, rate });
    }
    await sendDiceContacts(this, decisions, {
      fit: this.config.outreach?.random_fit !== false,
      reason:
        "Some time has passed without a word between them; no particular reason is given for reaching out now.",
      sourceMessageId,
    });
  },

  /** A room that talks by itself goes on (its own day's limit holds), whether I answered or not. */
  async timedRoom(group) {
    if (!(await this.roomRunAllowed(group))) return;
    await this.continueGroupBurst(`${GROUP}${group.id}`, { optional: true });
  },
};
