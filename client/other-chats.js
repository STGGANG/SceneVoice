// 다른 문자·전화 내용 알기: when a text is written or a call is under way, the people writing
// also get what was said in the other conversations on the phone that they are part of.
// Nothing here is cut by size: a request that would not fit the connection's context is
// shortened where it is sent (limitPrompt), other rooms first, then the private texts with the
// user, and the conversation being written last. Each list is oldest first, so what is cut is
// the oldest.
import { dataBlock } from "./prompts.js";

const GROUP = "group:";
const FINISHED = new Set(["ended", "missed", "rejected"]);

export const otherChats = {
  /** 설정 → 스마트폰 → 문자: 자기가 속한 다른 문자·전화 내용도 알기 (on unless switched off). */
  otherChatsOn() {
    return this.config.voice_message?.other_chats !== false;
  },

  /** The latest texts of one conversation that go into a request (참고할 문자 수; 0 = all). */
  lastTexts(list = []) {
    const count = Number(this.config.voice_message?.thread_messages ?? 40);
    return count > 0 ? list.slice(-count) : list;
  },

  /**
   * What the people in `keys` know from elsewhere on the phone, for a prompt.
   * `thread`: the text conversation being written (left out); none on a call, where the texts
   * with whoever is on it count as elsewhere too.
   * Returns <other_chat_rooms> (who was in which), <private_texts> (their own texts and calls
   * with the user) and <other_chats> (rooms and calls among several); [] when there is nothing
   * or the switch is off.
   */
  async otherChatsBlocks(keys = [], thread = "") {
    if (!this.otherChatsOn() || !keys.length) return [];
    const writers = new Set(keys);
    const me = this.userCharacterName?.() || "User";
    const [all, sessions] = await Promise.all([
      this.loadMessages(),
      this.otherChatSessions(),
      this.loadMessageGroups?.().catch(() => []),
    ]);
    // What 둘 다 빼기 took out isn't known to anyone here.
    const items = this.keptForAI(all);
    const nameOf = (key, fallback = "") =>
      this.phoneContact?.(key)?.name || fallback || key;
    const rooms = new Map();
    for (const group of this.messageGroups || []) {
      const members = group.members.map((member) => ({
        key: this.livePersonKey(member.key, member.name),
        name: member.name,
      }));
      rooms.set(`${GROUP}${group.id}`, {
        label: `group chat "${group.name || members.map((member) => member.name).join(", ")}"`,
        members,
        withMe: !group.without_user,
      });
    }
    // Every message of elsewhere, with the conversation it belongs to: {at, room, from, text}.
    const lines = [];
    const byThread = new Map();
    for (const item of items) {
      const key = this.messageThreadOf(item);
      if (key === thread) continue;
      if (!rooms.has(key)) {
        // A room that is gone leaves its messages nowhere to belong to.
        if (String(key).startsWith(GROUP)) continue;
        const name = nameOf(key, item.character_name);
        rooms.set(key, {
          label: `texts between ${name} and ${me}`,
          members: [{ key, name }],
          withMe: true,
          own: true,
        });
      }
      if (!rooms.get(key).members.some((member) => writers.has(member.key)))
        continue;
      if (!byThread.has(key)) byThread.set(key, []);
      byThread.get(key).push(item);
    }
    for (const [key, list] of byThread)
      for (const item of this.lastTexts(list))
        lines.push({
          at: String(item.created_at || ""),
          room: key,
          from: item.role === "user" ? me : item.character_name || nameOf(key),
          text: String(this.messageWords(item) || "").replace(
            /\s*\n\s*/g,
            " / ",
          ),
        });
    // Calls: between two of the people (엿듣는 통화), or theirs with the user. On a text thread or
    // a call with one person, that person's own calls with the user already go as <previous_calls>.
    const single = keys.length === 1 && !String(thread).startsWith(GROUP);
    const calls = [];
    for (const session of sessions) {
      const overheard = session.call_direction === "overheard";
      const people = [
        { key: session.character_key, name: session.character_name },
        ...(overheard
          ? [{ key: session.callee_key, name: session.callee_name }]
          : []),
        ...(session.others || []),
      ]
        .filter((person) => person.key)
        .map((person) => ({
          key: this.livePersonKey(person.key, person.name),
          name: person.name,
        }));
      if (!people.some((person) => writers.has(person.key))) continue;
      if (!overheard && single && people.length === 1) continue;
      if ((session.turns || []).length)
        calls.push({ session, overheard, people });
    }
    // The latest calls, each whole (참고할 다른 통화 수; 0 = all).
    const callCount = Number(this.config.voice_message?.other_calls ?? 3);
    for (const { session, overheard, people } of callCount > 0
      ? calls.slice(-callCount)
      : calls) {
      const key = `call:${session.id}`;
      const names = people.map((person) => nameOf(person.key, person.name));
      rooms.set(key, {
        label: `phone call between ${overheard ? names.join(" and ") : `${names.join(", ")} and ${me}`}`,
        members: people,
        withMe: !overheard,
        own: !overheard && people.length === 1,
      });
      for (const [index, turn] of session.turns.entries())
        lines.push({
          // Turns of one call stay in order after its start.
          at: `${session.started_at || session.created_at || ""}#${String(index).padStart(3, "0")}`,
          room: key,
          from: turn.role === "user" ? me : turn.speaker_name || names[0],
          text: String(turn.text || "").replace(/\s*\n\s*/g, " / "),
        });
    }
    if (!lines.length) return [];
    lines.sort((a, b) => a.at.localeCompare(b.at));
    const used = [...new Set(lines.map((line) => line.room))];
    const listOf = (own) =>
      lines
        .filter(
          (line) => Boolean(rooms.get(line.room).own) === own && line.text,
        )
        .map((line) => ({
          chat: rooms.get(line.room).label,
          from: line.from,
          text: line.text,
        }));
    const mine = listOf(true);
    const others = listOf(false);
    return [
      dataBlock(
        "other_chat_rooms",
        used.map((key) => {
          const room = rooms.get(key);
          const people = room.members.map((member) =>
            nameOf(member.key, member.name),
          );
          return {
            chat: room.label,
            known_only_to: room.withMe ? [...people, me] : people,
          };
        }),
      ),
      ...(mine.length ? [dataBlock("private_texts", mine)] : []),
      ...(others.length ? [dataBlock("other_chats", others)] : []),
    ];
  },

  /** Finished calls of this chat (the current swipe's), oldest first. */
  async otherChatSessions() {
    try {
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.currentChatId())}&limit=30`,
        { cache: "no-store" },
        5000,
      );
      if (!response.ok) return [];
      return this.callsForAI((await response.json()).items || [])
        .filter(
          (session) =>
            FINISHED.has(session.status) &&
            this.anchorShown?.(session) !== false,
        )
        .reverse();
    } catch {
      return [];
    }
  },
};
