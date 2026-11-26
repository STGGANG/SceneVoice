// 채팅 AI가 직접 연락 (베타): the model that writes the chat is told about the phone and may put
// a text or a call into its reply with a tag. The tags stay in the message, where they happened,
// drawn there as small bubbles; the phone follows them: each text tag has its record in that
// person's conversation (made when the reply arrives, changed or removed when the message is
// edited), and a call tag rings once, when the reply arrives. The other way round too: a text
// changed or deleted on the phone changes its tag in the message. The records are kept with that
// chat message and its swipe like any other, but are left out of the chat memory: the model
// reads them in the message itself.
//
// Switched on for a bot card (캐릭터 → 봇카드 공통 설정, beside 채팅 기억 연동). Someone the model
// names who isn't a contact yet becomes a person of that card, with no voice; a text written as
// the user's own character goes into that conversation as mine.

import { escapeHtml, simpleHash, stOf } from "./common.js";
import { contentKey } from "../shared/hash.js";

const PROMPT_KEY = "scenevoice_chat_tags";
// A text (one cut off by the end of the reply too: what there is of it), or a call.
const TAG =
  /<sv_text\b([^>]*)>([\s\S]*?)(?:<\/sv_text\s*>|$)|<sv_call\b([^>]*?)\/?>(?:\s*<\/sv_call\s*>)?/gi;
const ANY = /<\/?sv_(?:text|call)\b[^>]*>/gi;
const HAS = /<sv_(?:text|call)\b/i;
const attr = (attrs, name) =>
  (
    String(attrs || "")
      .match(
        new RegExp(
          `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>/]+))`,
          "i",
        ),
      )
      ?.slice(1)
      .find((value) => value !== undefined) || ""
  ).trim();
// People brought in by one reply, at most; a name the model made too long or odd is not one.
const NEW_PEOPLE = 3;
const usableName = (name) =>
  name.length > 0 && name.length <= 40 && !/[<>[\]{}\n"]/.test(name);

/** Each tag of a message with what `each(item)` gives for it; `item.n` counts the texts. */
function overTags(text, each) {
  let n = 0;
  return String(text || "").replace(
    TAG,
    (whole, textAttrs, body, callAttrs) => {
      const call = textAttrs === undefined;
      const attrs = call ? callAttrs : textAttrs;
      const said = String(body || "")
        .replace(ANY, "")
        .trim();
      if (!call && !said) return "";
      const to = attr(attrs, "to");
      return each({
        type: call ? "call" : "text",
        from: attr(attrs, "from"),
        ...(to ? { to } : {}),
        ...(call ? {} : { text: said, n: n++ }),
      });
    },
  );
}

/** The phone tags of a message, in the order written: texts ({ from, to, text, n }) and calls. */
export function parseChatTags(text) {
  const items = [];
  overTags(text, (item) => {
    items.push(item);
    return "";
  });
  return items;
}

/** The message without its phone tags and what they hold (what is read aloud as chat). */
export function withoutChatTags(text) {
  if (!HAS.test(String(text || ""))) return String(text || "");
  return overTags(text, () => "")
    .replace(ANY, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The message with its n-th text tag saying `words` instead (null: with that tag taken out). */
export function withChatTagText(text, n, words) {
  const GONE = "\u0000";
  let at = 0;
  const said = (body) =>
    String(body || "")
      .replace(ANY, "")
      .trim();
  const next = String(text || "").replace(TAG, (whole, attrs, body) => {
    if (attrs === undefined || !said(body) || at++ !== n) return whole;
    if (words === null) return GONE;
    return said(words) ? `<sv_text${attrs}>${said(words)}</sv_text>` : whole;
  });
  // A tag that had a line to itself takes the line with it.
  return next
    .replace(new RegExp(`(^|\\n)[ \\t]*${GONE}[ \\t]*(?:\\n|$)`), "$1")
    .replace(new RegExp(`[ \\t]*${GONE}`), "");
}

/**
 * The message as it is drawn: each tag an element 실리태번 keeps (it drops tags it doesn't know and
 * leaves their words loose in the text). `mine(from)`: written as the user's own character.
 */
export function chatTagsDrawn(
  text,
  mine = () => false,
  shownAs = (name) => name,
) {
  const who = (name) =>
    name ? `<small data-sv-from="1">${escapeHtml(shownAs(name))}</small>` : "";
  return overTags(text, (item) =>
    item.type === "call"
      ? `<span data-sv-call="1">${who(item.from)}</span>`
      : `<span data-sv-text="1"${mine(item.from) ? ' data-sv-mine="1"' : ""}>${who(item.from)}${item.text}</span>`,
  ).replace(ANY, "");
}

/**
 * What the chat's model is told (in the chat's context while the feature is on): one block, its
 * parts under headings. `people`: [{ name, aliases }], every name a person may be written with.
 */
export function chatTagPrompt(me, people) {
  const others = (person) =>
    String(person.aliases || "")
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter((name) => name && name !== person.name);
  return [
    "<phone_contact>",
    "## Phones in this story",
    `The people of this story may have smartphones or something like them, and sometimes one of them texts or phones ${me}. When that happens, write it in your reply with a tag.`,
    "",
    "## Tags",
    `- A text: <sv_text from="NAME">the message exactly as typed on the phone</sv_text>`,
    `- A call: <sv_call from="NAME"/> at the moment their call starts ringing. Write nothing of the call itself: ${me} may or may not pick up, the call goes on on a separate screen, and its outcome is given to you with the next reply.`,
    "One tag is one message sent. Several short lines sent in a row go in one tag, each on its own line. Messages sent at different moments of the reply, or by different people, each get their own tag where they happen.",
    "",
    "## Example",
    "(A and B stand for names.)",
    "She frowned at the screen.",
    `<sv_text from="A">where are you`,
    `call me when you see this</sv_text>`,
    `A minute later the phone lit up again. <sv_text from="B">A is looking for you</sv_text>`,
    "",
    "## Names",
    ...(people.length
      ? [
          "Contacts so far, one person a line:",
          ...people.map((person) => {
            const also = others(person);
            return `- ${person.name}${also.length ? ` (also: ${also.join(", ")})` : ""}`;
          }),
          "For anyone on this list, NAME must be one of the names on that person's line, written exactly as it is there: the one that fits the language you are writing in, and no other nickname, title or spelling. Only someone who is truly not on the list gets a new name.",
        ]
      : ["Anyone in the story can be named."]),
    "",
    "## When",
    "Use a tag only when contact is called for, at the point where it fits the context naturally. Most replies need none. Keep a text as short as a real one.",
    "</phone_contact>",
  ].join("\n");
}

const sameName = (a, b) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();

// Letters and digits only, so spacing, case and punctuation don't make someone a stranger.
const plain = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
const words = (name) =>
  String(name || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The contact a written name means, or null: the name or one of its other spellings (별명, 다른 언어
 * 표기) as written; else the one contact it is part of or that is part of it ("Mina" for "Mina
 * Seo", "Dr. Mina Seo" for "Mina Seo"). Two who fit that way are nobody.
 */
export function contactNamed(written, contacts) {
  const wanted = plain(written);
  if (!wanted) return null;
  const namesOf = (contact) => [
    contact.name,
    ...String(contact.aliases || "").split(/[,\n]/),
  ];
  const exact = contacts.find((contact) =>
    namesOf(contact).some((name) => plain(name) === wanted),
  );
  if (exact) return exact;
  const parts = words(written);
  const close = contacts.filter((contact) =>
    namesOf(contact).some((name) => {
      const own = words(name);
      return (
        own.length > 0 &&
        (own.every((word) => parts.includes(word)) ||
          parts.every((word) => own.includes(word)))
      );
    }),
  );
  return close.length === 1 ? close[0] : null;
}

/**
 * What other extensions put into a drawn message (a status panel at its top, say), to be put back
 * where it was after the message is drawn again: elements of the message's own box with a class
 * that 실리태번's formatting doesn't give (it prefixes the message's own classes with "custom-" and
 * keeps only "fa-…", "note-…", "monospace" and "menu_button" as written), and not ours.
 */
function othersIn(text) {
  const theirs = (node) =>
    node.nodeType === 1 &&
    node.classList.length > 0 &&
    ![...node.classList].some(
      (name) =>
        /^(custom-|fa-|note-|sv-|voice-)/.test(name) ||
        ["monospace", "menu_button"].includes(name),
    ) &&
    !node.querySelector("[data-sv-text], [data-sv-call]");
  const nodes = [...text.childNodes];
  const first = nodes.findIndex(
    (node) => !theirs(node) && !(node.nodeType === 3 && !node.data.trim()),
  );
  const head = first === -1 ? nodes.length : first;
  return {
    before: nodes.slice(0, head).filter(theirs),
    after: nodes.slice(head).filter(theirs),
  };
}

export const chatTags = {
  /** The bot card of the open chat that has it switched on, or "". */
  chatTagCard() {
    if (this.visitOf || !this.isActive() || !this.phoneOn()) return "";
    if (!this.hasCharacterChat()) return "";
    const voices = this.config?.character_voices || {};
    return (
      (this.currentCardKeys?.() || []).find(
        (key) => key.startsWith("character:") && voices[key]?.chat_tags,
      ) || ""
    );
  },

  chatTagsOn() {
    return Boolean(this.chatTagCard());
  },

  /** Who the chat's model may send from: this chat's contacts, mine left out. */
  chatTagPeople() {
    const voices = this.config?.character_voices || {};
    return this.phoneContacts()
      .filter((contact) => !voices[contact.key]?.persona)
      .map((contact) => {
        // A card shown under a name of the user's own (in Korean, say) is still written by the
        // name its bot card has.
        const cardName =
          contact.key === contact.cardKey
            ? this.cardInfo(contact.key).name || ""
            : "";
        return {
          ...contact,
          aliases: [voices[contact.key]?.aliases, cardName]
            .filter(Boolean)
            .join(", "),
        };
      });
  },

  /** A person the chat brought in, still without a voice: no voice is made for them unasked. */
  voiceLeftUnmade(key) {
    const entry = this.config?.character_voices?.[key];
    return Boolean(entry?.from_chat && !entry.voice_id);
  },

  /**
   * A person the chat brought in (still without a voice) exists only where something of theirs
   * shows: on another swipe of the reply that named them, or in another chat of the card, they
   * are not among the contacts. Nobody is hidden before the chat has been looked at once.
   */
  chatPersonAway(key) {
    return Boolean(
      !this.visitOf &&
      this.chatPeopleHere &&
      this.voiceLeftUnmade(key) &&
      !this.chatPeopleHere.has(key),
    );
  },

  scheduleChatPeople() {
    if (this.visitOf) return;
    clearTimeout(this.chatPeopleTimer);
    this.chatPeopleTimer = setTimeout(
      () => this.run(() => this.refreshChatPeople()),
      250,
    );
  },

  /** Who has a text or a call showing in this chat as it stands, among the people it brought in. */
  async refreshChatPeople() {
    if (this.visitOf) return;
    const voices = this.config?.character_voices || {};
    const brought = Object.keys(voices).filter((key) =>
      this.voiceLeftUnmade(key),
    );
    const before = this.chatPeopleHere;
    const wasAway = brought.filter((key) => this.chatPersonAway(key)).join();
    if (!brought.length || !this.hasCharacterChat()) this.chatPeopleHere = null;
    else {
      const operation = this.captureChat();
      const here = new Set();
      const note = (key, name = "") => {
        if (key) here.add(this.livePersonKey?.(key, name) || key);
      };
      for (const item of await this.loadMessages()) {
        note(item.character_key, item.character_name);
        note(item.speaker_key, item.speaker_name);
      }
      const response = await this.request(
        `/api/plugins/scenevoice/phone/sessions?chat_id=${encodeURIComponent(this.getStateIdentity().chatId)}&limit=1000`,
        { cache: "no-store" },
      );
      const sessions = response.ok ? (await response.json()).items || [] : [];
      for (const session of sessions) {
        if (!this.anchorShown(session)) continue;
        note(session.character_key, session.character_name);
        for (const other of session.others || []) note(other.key, other.name);
        for (const turn of session.turns || [])
          note(turn.speaker_key, turn.speaker_name);
      }
      if (operation.signal.aborted) return;
      this.chatPeopleHere = here;
    }
    if (
      before !== undefined &&
      wasAway === brought.filter((key) => this.chatPersonAway(key)).join()
    )
      return;
    this.syncChatTagPrompt();
    const shell = document.getElementById("sv-smartphone");
    if (shell && !shell.classList.contains("hidden"))
      await this.renderSmartphone();
  },

  /** The instruction is in the chat's context while the feature is on, and gone when it isn't. */
  syncChatTagPrompt() {
    if (this.visitOf) return;
    const context = stOf(this) || {};
    if (typeof context.setExtensionPrompt !== "function") return;
    const text = this.chatTagsOn()
      ? chatTagPrompt(this.userCharacterName(), this.chatTagPeople())
      : "";
    // Compared with what 실리태번 holds now: it empties these itself at times.
    const held = context.extensionPrompts
      ? (context.extensionPrompts[PROMPT_KEY]?.value ?? "")
      : this.chatTagPromptShown;
    if (text === held) return;
    this.chatTagPromptShown = text;
    // In the chat, after its last message, as a system note.
    context.setExtensionPrompt(PROMPT_KEY, text, 1, 0, false, 0);
  },

  /** Written as my own character. */
  chatTagMine(from) {
    return (
      Boolean(from) &&
      (sameName(from, this.userCharacterName()) ||
        sameName(from, stOf(this)?.name1))
    );
  },

  /**
   * The tags of the chat's messages are drawn as bubbles where they stand (one message, or all
   * that are on screen). Done whether or not the feature is on: tags written while it was are
   * still in the messages. Under a translation the translated words are drawn, while it kept
   * the tags (one that lost them is left as the translation made it); a view with the original
   * and the translation side by side is another extension's own drawing and is left alone.
   */
  drawChatTags() {
    if (this.visitOf || !this.isActive()) return;
    const context = stOf(this) || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    if (typeof context.messageFormatting !== "function") return;
    let people = [];
    try {
      people = this.hasCharacterChat() ? this.chatTagPeople() : [];
    } catch {
      /* drawn under the names as written */
    }
    for (const element of document.querySelectorAll("#chat .mes[mesid]")) {
      const index = Number(element.getAttribute("mesid"));
      const message = chat[index];
      const text = element.querySelector(":scope > .mes_block > .mes_text");
      if (!message || !text || !HAS.test(message.mes || "")) continue;
      if (text.querySelector(".original_text, .translated_text")) continue;
      // Open in 실리태번's editor: its text box is inside, and drawing would take it away.
      if (text.querySelector("textarea")) continue;
      // Still being written: 실리태번 redraws it with every piece that comes.
      if (this.generatingSince && index === chat.length - 1) continue;
      const translated = this.translationShown(text, message);
      const shown = translated ? message.extra.display_text : message.mes;
      // A translation has come (or gone): the texts on the phone get its words.
      const version = simpleHash(message.extra?.display_text || "");
      if (text.dataset.svTagsOf !== version) {
        const first = text.dataset.svTagsOf === undefined;
        text.dataset.svTagsOf = version;
        if (!first || translated) this.syncChatTags(index);
      }
      if (!HAS.test(shown)) continue;
      const drawn = simpleHash(shown);
      if (
        text.dataset.svTags === drawn &&
        text.querySelector("[data-sv-text], [data-sv-call]")
      )
        continue;
      try {
        const kept = othersIn(text);
        text.innerHTML = context.messageFormatting(
          chatTagsDrawn(
            shown,
            (from) => this.chatTagMine(from),
            (from) => contactNamed(from, people)?.name || from,
          ),
          message.name,
          Boolean(message.is_system),
          Boolean(message.is_user),
          index,
        );
        text.prepend(...kept.before);
        text.append(...kept.after);
        text.dataset.svTags = drawn;
      } catch (error) {
        console.warn("[SceneVoice] 연락 표시를 그리지 못했습니다.", error);
      }
    }
  },

  /** Drawn now, and once more shortly: some events come before 실리태번 has redrawn the message. */
  scheduleChatTagDraw() {
    if (this.visitOf) return;
    this.drawChatTags();
    clearTimeout(this.chatTagDrawTimer);
    this.chatTagDrawTimer = setTimeout(() => this.drawChatTags(), 150);
  },

  /**
   * The phone follows the tags of one message (the swipe showing): `arrived` when its reply has
   * just come (texts are announced, a call rings), otherwise after an edit. One at a time, so two
   * events about the same message never both make its records.
   */
  syncChatTags(messageId, { arrived = false } = {}) {
    const card = this.chatTagCard();
    if (!card) return;
    const context = stOf(this) || {};
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const index = /^\d+$/.test(String(messageId ?? ""))
      ? Number(messageId)
      : chat.length - 1;
    const message = chat[index];
    if (!message || message.is_user || message.is_system) return;
    // A reply without tags has nothing to follow; an edit may have taken its tags out.
    if (arrived && !HAS.test(message.mes || "")) return;
    const operation = this.captureChat();
    const work = () =>
      this.followChatTags(card, index, message, arrived, operation);
    this.chatTagQueue = (this.chatTagQueue || Promise.resolve())
      .catch(() => undefined)
      .then(() => (operation.signal.aborted ? undefined : work()));
    this.run(() => this.chatTagQueue);
  },

  async followChatTags(card, index, message, arrived, operation) {
    const context = stOf(this) || {};
    if (context.chat?.[index] !== message) return;
    const people = this.chatTagPeople();
    const added = [];
    // A contact (under any spelling), or a new name: it becomes a person of this card. The one
    // contact when no name is written.
    const nameOf = (from) => {
      if (!from) return people.length === 1 ? people[0].name : "";
      const known =
        contactNamed(from, people)?.name ||
        added.find((name) => plain(name) === plain(from));
      if (known) return known;
      if (added.length >= NEW_PEOPLE || !usableName(from)) return "";
      added.push(from);
      return from;
    };
    const steps = parseChatTags(message.mes).map((item) =>
      this.chatTagMine(item.from)
        ? { ...item, mine: true, name: "" }
        : { ...item, mine: false, name: nameOf(item.from) },
    );
    // A text of mine with nobody named: whoever texted just before it in this reply, else whoever
    // does next, else the only contact.
    steps.forEach((step, at) => {
      if (!step.mine || step.type !== "text") return;
      const named =
        step.to && !this.chatTagMine(step.to) ? nameOf(step.to) : "";
      step.name =
        named ||
        steps
          .slice(0, at)
          .reverse()
          .find((other) => !other.mine && other.name)?.name ||
        steps.slice(at + 1).find((other) => !other.mine && other.name)?.name ||
        (people.length === 1 ? people[0].name : "");
    });
    // A translation of the message that kept every text tag: each text's own translation.
    const texts = steps.filter((step) => step.type === "text");
    const other = message.extra?.display_text;
    const theirs =
      other && other !== message.mes
        ? parseChatTags(other).filter((item) => item.type === "text")
        : [];
    if (theirs.length === texts.length)
      for (const step of texts) step.translation = theirs[step.n].text;
    if (added.length) await this.addChatPeople(card, added);
    this.assertChat(operation);
    const contacts = this.chatTagPeople();
    const personOf = (name) =>
      contacts.find((contact) => sameName(contact.name, name)) || null;
    // The records made from this message's tags, as they stand.
    const kept = (await this.loadMessages()).filter(
      (item) =>
        Number.isInteger(item.chat_tag) &&
        String(item.anchor_message_id) === String(index),
    );
    const changed = new Set();
    const remove = async (record) => {
      await this.request(
        `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(record.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: record.chat_id }),
        },
      );
      changed.add(this.messageThreadOf(record));
    };
    const wanted = new Set();
    for (const step of steps) {
      if (step.type !== "text") continue;
      const role = step.mine ? "user" : "character";
      let record = kept.find((item) => item.chat_tag === step.n);
      // A text of mine that nothing in the reply places any more (the text it answered was
      // deleted, say) stays in the conversation it is in.
      const person =
        personOf(step.name) ||
        (step.mine && record?.role === "user"
          ? contacts.find(
              (contact) => contact.key === this.messageThreadOf(record),
            )
          : null);
      if (!person) continue;
      this.assertChat(operation);
      wanted.add(step.n);
      // Another sender or receiver after an edit: the old one goes, a new one is made.
      if (
        record &&
        (record.role !== role || this.messageThreadOf(record) !== person.key)
      ) {
        await remove(record);
        record = null;
      }
      if (!record) {
        await this.textFromChatTag(person, step, index, arrived);
        changed.add(person.key);
      } else if (
        record.text !== step.text ||
        (step.translation !== undefined &&
          (record.translation || "") !== step.translation)
      ) {
        const response = await this.request(
          `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(record.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: record.chat_id,
              text: step.text,
              language: this.scriptLanguage(step.text) || this.chatLanguage(),
              translation: step.translation || "",
            }),
          },
        );
        if (response.ok) changed.add(person.key);
      }
    }
    // A tag taken out of the message: its record goes with it.
    for (const record of kept)
      if (!wanted.has(record.chat_tag)) await remove(record);
    this.assertChat(operation);
    for (const thread of changed)
      await this.persistTextThreadMemory(thread, index);
    if (changed.size) {
      const shell = document.getElementById("sv-smartphone");
      if (shell && !shell.classList.contains("hidden"))
        await this.renderSmartphone();
    }
    // A call rings once, for the reply that has just come.
    const call = arrived
      ? steps.find((step) => step.type === "call" && !step.mine && step.name)
      : null;
    const person = call && personOf(call.name);
    if (person) {
      const once = `${this.getStateIdentity().chatId}\u0000${index}\u0000${message.swipe_id ?? 0}`;
      this.chatCallsRung ||= new Set();
      if (!this.chatCallsRung.has(once)) {
        this.chatCallsRung.add(once);
        await this.callFromChat(person, index);
      }
    }
    this.syncChatTagPrompt();
    await this.refreshChatPeople();
  },

  /**
   * The chat message follows a text changed on the phone (고치기, 삭제): the tag it came from says
   * the new words, or leaves the message, on the swipe the text was made on (showing or not). A
   * translation of the message that has the same tags follows too.
   */
  async chatMessageFollows(item, { removed = false } = {}) {
    if (this.visitOf || !Number.isInteger(item?.chat_tag)) return;
    const place = this.anchorPlace(item);
    if (place === "gone") return;
    const context = stOf(this) || {};
    const index = Number(item.anchor_message_id);
    const message = context.chat?.[index];
    if (!message) return;
    const shown = place === "here";
    const swipe = shown ? message.swipe_id : this.anchorSwipeOf(item);
    const before = shown ? message.mes : message.swipes?.[swipe];
    if (typeof before !== "string") return;
    const after = withChatTagText(
      before,
      item.chat_tag,
      removed ? null : item.text,
    );
    const extra = shown ? message.extra : message.swipe_info?.[swipe]?.extra;
    const other = extra?.display_text;
    const count = (text) =>
      parseChatTags(text).filter((tag) => tag.type === "text").length;
    const otherAfter =
      typeof other === "string" &&
      other !== before &&
      count(other) === count(before) &&
      (removed || item.translation)
        ? withChatTagText(
            other,
            item.chat_tag,
            removed ? null : item.translation,
          )
        : other;
    if (after === before && otherAfter === other) return;
    if (shown) message.mes = after;
    if (Array.isArray(message.swipes) && Number.isInteger(swipe))
      message.swipes[swipe] = after;
    if (otherAfter !== other) extra.display_text = otherAfter;
    await context.saveChat?.();
    if (!shown) return;
    // Drawn again by 실리태번, then its tags by us.
    if (typeof context.updateMessageBlock === "function")
      context.updateMessageBlock(index, message);
    this.scheduleChatTagDraw();
  },

  /** People named by the chat's model become people of the card: a name, no voice. */
  async addChatPeople(card, names) {
    const voices = { ...(this.config.character_voices || {}) };
    for (const name of names) {
      const key = `speaker:${contentKey({ card, name })}`;
      voices[key] ||= { name, card, from_chat: true };
      // The settings, open at this moment, would save over it otherwise.
      if (this.voiceDraft && document.getElementById("sv-overlay"))
        this.voiceDraft[key] ||= { ...voices[key] };
    }
    const response = await this.request("/api/plugins/scenevoice/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_voices: voices }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({}))).detail ||
          "새 인물을 추가하지 못했습니다.",
      );
    await this.loadConfig();
    // Here from now on (their text is about to be kept).
    for (const name of names)
      this.chatPeopleHere?.add(`speaker:${contentKey({ card, name })}`);
  },

  /**
   * The record of a text tag: theirs (announced when it has just arrived) or, written as my
   * character, mine in that conversation (nobody answers it: the chat goes on by itself).
   */
  async textFromChatTag(person, step, index, arrived) {
    const language = this.scriptLanguage(step.text) || this.chatLanguage();
    if (!step.mine) {
      const character = this.phoneContact(person.key);
      const record = await this.saveCharacterMessage({
        character,
        kind: "text",
        origin: "incoming",
        parsed: {
          text: step.text,
          language,
          translation: step.translation || "",
        },
        reason: "Written in the chat itself.",
        anchorIndex: index,
        chatTag: step.n,
      });
      const shell = document.getElementById("sv-smartphone");
      const viewing =
        shell &&
        !shell.classList.contains("hidden") &&
        this.phoneActiveTab === "message" &&
        this.messageThreadKey === character.key;
      if (arrived && !viewing)
        this.announceText(character.key, character.name, record?.text, "text");
      return;
    }
    const contact = this.threadContact(person.key);
    const response = await this.request(
      "/api/plugins/scenevoice/voice-messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.getStateIdentity().chatId,
          anchor_message_id: String(index),
          ...this.anchorStamp(index),
          character_key: person.key,
          character_name: contact.name,
          role: "user",
          kind: "text",
          origin: "reply",
          text: String(step.text).slice(0, 2000),
          ...(step.translation ? { translation: step.translation } : {}),
          language,
          chat_tag: step.n,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({}))).detail ||
          "문자를 저장하지 못했습니다.",
      );
  },

  /** Their call, started in the chat: it rings (not while another call has the line). */
  async callFromChat(person, index) {
    if (this.onCall()) return;
    const me = this.userCharacterName();
    await this.ringIncomingCall(
      {
        candidate: {
          type: "incoming_call",
          urgency: "normal",
          reason: `In the scene just written in <recent_chat>, they phone ${me} now. The call starts at that moment of the story.`,
        },
        callerKey: person.key,
        caller: person.name,
        // The user reads the reply before deciding: it doesn't ring out after a minute.
        waits: true,
      },
      String(index),
    );
  },
};
