// Which chat is which, whatever its file is called. The chat's own file keeps the id its records
// are under and the chats it came from (a branch, a copy, an import), so a renamed chat stays
// itself and one that came from another inherits its records. See shared/lineage.js.
import { contentKey, newId } from "../shared/hash.js";
import { personNames } from "../shared/casting.js";
import { stOf } from "./common.js";

const LINE_KEY = "scenevoice_line";
const HIDDEN_KEY = "scenevoice_line_hidden";
const TOLD_KEY = "scenevoice_line_told";
const nameId = (name, card) => contentKey({ chatId: name, character: card });
const lineIn = (metadata) => {
  const line = metadata?.[LINE_KEY];
  return Array.isArray(line) &&
    line.length &&
    line.every((step) => step && typeof step.id === "string" && step.id)
    ? line
    : null;
};
const lower = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

export const chatLine = {
  /** The id this very chat's file names for its records ("" when it names none for it). */
  stampedChatId(context, name, card) {
    if (!name || context.groupId != null || !card.startsWith("character:"))
      return "";
    const self = lineIn(context.chatMetadata)?.at(-1);
    if (self?.name === name && self.card === card) return self.id;
    // Being worked out (settleChatLine): a renamed chat keeps its id, a copy gets its own.
    const settled = this.lineSettled;
    return settled?.name === name && settled.card === card ? settled.id : "";
  },

  /** A chat that isn't open: its id by its name, unless its file gave it another. */
  chatIdOf(name, card) {
    const id = nameId(name, card);
    return this.lineIndex?.get(id) || id;
  },

  /** The chat's line as its file has it now (실리태번 swaps the metadata object when it is updated). */
  liveLine() {
    return lineIn((stOf(this) || {}).chatMetadata);
  },

  /**
   * Every id this chat's lines and analyses may have been keyed with: its own first, then the
   * ones it had before and those of the chats it came from.
   */
  chatKeyBases() {
    const own = this.currentChatId();
    const line = this.liveLine();
    const input = `${own}\n${line ? JSON.stringify(line) : ""}\n${(this.lineMoreKeys || []).join()}`;
    if (this.keyBasesCache?.input === input) return this.keyBasesCache.value;
    const out = [own];
    const add = (id) => id && !out.includes(id) && out.push(id);
    if (line?.at(-1)?.id === own)
      for (const step of [...line].reverse()) {
        add(step.id);
        (step.keys || []).forEach(add);
      }
    (this.lineMoreKeys || []).forEach(add);
    this.keyBasesCache = { input, value: out };
    return out;
  },

  /**
   * Ids only tried, and only for a line the chat keeps a voice at that nothing claimed: the one
   * the chat's name gives (a chat renamed before 씬보이스 kept lines has its voices under the
   * name it had then) and ids nothing but kept analyses name. One a voice is found under is
   * kept with the chat (keepKeyBase).
   */
  chatTriedBases() {
    const context = stOf(this) || {};
    const sure = this.chatKeyBases();
    const card = this.getCurrentCharacterProfile().key;
    const out = [];
    const add = (id) =>
      id && !sure.includes(id) && !out.includes(id) && out.push(id);
    if (context.chatId && card.startsWith("character:") && !this.visitOf)
      add(nameId(String(context.chatId), card));
    (this.lineOrphans || []).slice(0, 40).forEach(add);
    return out;
  },

  /** A voice was found under an id that was only being tried: the chat's file keeps it as a key. */
  keepKeyBase(base) {
    const id = this.currentChatId();
    this.keptBases ||= new Set();
    if (this.keptBases.has(`${id}\n${base}`)) return;
    this.keptBases.add(`${id}\n${base}`);
    if (this.liveLine()?.at(-1)?.id !== id) return;
    // Kept with the chat (unless another chat stands under that id); the analyses still under
    // it come along, and the lines are then looked at again.
    const card = this.getCurrentCharacterProfile().key;
    void this.cardChatNames(card)
      .then((names) => {
        // No chat of the card has that id now: what stands under it besides is nobody's.
        const sure =
          Boolean(names) &&
          ![...names].some((name) => this.chatIdOf(name, card) === base);
        return this.transport.request(
          "/api/plugins/scenevoice/chats/line/key",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, key: base, sure }),
          },
        );
      })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const self = this.liveLine()?.at(-1);
        if (!data || data.taken || self?.id !== id) return;
        self.keys = [...new Set([...(self.keys || []), base])].slice(0, 20);
        (stOf(this) || {}).saveMetadataDebounced?.();
        if (!data.analyses) return;
        this.redrawnChat();
        this.scheduleScan?.(null);
      })
      .catch(() => undefined);
  },

  /** The names of a bot card's chats as they are now, or null when they can't be read. */
  async cardChatNames(card) {
    const list = await this.transport
      .network?.("/api/characters/chats", {
        method: "POST",
        body: JSON.stringify({
          avatar_url: card.slice("character:".length),
          simple: true,
        }),
      })
      .then((result) => (result?.ok ? result.json() : null))
      .catch(() => null);
    return Array.isArray(list)
      ? new Set(
          list.map((item) =>
            String(item.file_id || item.file_name || "").replace(
              /\.jsonl$/,
              "",
            ),
          ),
        )
      : null;
  },

  async lookLines(ids, { people = [], orphans = false, self = "" } = {}) {
    const response = await this.transport.request(
      `/api/plugins/scenevoice/chats/line?ids=${encodeURIComponent(ids.join(","))}&people=${encodeURIComponent(people.join(","))}${orphans ? `&orphans=1&self=${encodeURIComponent(self)}` : ""}`,
    );
    const data = response.ok ? await response.json() : {};
    return {
      counts: data.counts || {},
      alias: data.alias || {},
      cards: data.cards || {},
      known: data.known || {},
      held: data.held || {},
      entry: data.entry || null,
      people: data.people || [],
      orphans: data.orphans || [],
    };
  },

  /** Chats whose records are under another id than their name gives (for chats that aren't open). */
  async loadLineIndex() {
    const response = await this.transport
      .request("/api/plugins/scenevoice/chats/line?index=1")
      .catch(() => null);
    const index = response?.ok ? (await response.json()).index || {} : {};
    this.lineIndex = new Map(Object.entries(index));
  },

  /**
   * The people of chats of another bot card this chat came from, each matched with someone here
   * of the same name or alias (`swap`); those with nobody here stay to read and hear (`locked`).
   */
  async matchLinePeople(line, card) {
    const foreign = line.slice(0, -1).filter((step) => step.card !== card);
    if (!foreign.length) return { swap: null, locked: null };
    const look = await this.lookLines([line.at(-1).id], {
      people: foreign.map((step) => step.id),
    });
    const voices = this.config.character_voices || {};
    const own = new Set(
      [
        this.getCurrentCharacterProfile().name,
        ...personNames(voices[card] || {}),
      ]
        .map(lower)
        .filter(Boolean),
    );
    const swap = {};
    const locked = {};
    for (const person of look.people) {
      const names = person.names.map(lower).filter(Boolean);
      let target = "";
      if (voices[person.key] && !voices[person.key].card)
        // Someone registered for every bot card is the same person here.
        target = person.key;
      else if (person.key.startsWith("character:"))
        target = names.some((name) => own.has(name)) ? card : "";
      else
        target =
          person.names
            .map((name) => this.livePersonKey(person.key, name))
            .find((key) => key && key !== person.key && voices[key]) || "";
      if (!target) (locked[person.from] ||= []).push(person.key);
      else if (target !== person.key)
        (swap[person.from] ||= {})[person.key] = target;
    }
    return { swap, locked };
  },

  /**
   * Works out which chat this is when it opens. Its file's line names it (same name, same bot
   * card): nothing to do. Another name on the same card: renamed if no chat has the old name any
   * more (it stays itself), else a branch or copy (a new step in the line). Another bot card: a
   * copy. No line yet: its id by name, with the chat it branched from (실리태번's main_chat) before
   * it; written into the file once it has records.
   */
  async settleChatLine() {
    const mark = () =>
      `${(stOf(this) || {}).chatId || ""}\n${this.getCurrentCharacterProfile().key}`;
    const chat = mark();
    // One at a time for a chat; started again when the chat was drawn anew meanwhile.
    if (this.lineSettling?.chat === chat) return this.lineSettling.done;
    const done = (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await this.settleChatLineOnce();
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (mark() !== chat) return;
        }
      }
    })().finally(() => {
      if (this.lineSettling?.done === done) this.lineSettling = null;
    });
    this.lineSettling = { chat, done };
    return done;
  },

  async settleChatLineOnce() {
    const context = stOf(this) || {};
    const card = this.getCurrentCharacterProfile().key;
    const name = String(context.chatId || "");
    this.lineSettled = null;
    this.linePending = null;
    this.lineMoreKeys = [];
    if (
      !name ||
      context.groupId != null ||
      !card.startsWith("character:") ||
      this.visitOf
    )
      return;
    // Only another chat opening (or this one loaded anew) stops this: what other things do in
    // the chat meanwhile (a message edited, a translation drawn) is no reason to.
    const loaded = context.chat;
    const still = () => {
      const now = stOf(this) || {};
      if (
        String(now.chatId || "") !== name ||
        now.chat !== loaded ||
        this.getCurrentCharacterProfile().key !== card
      )
        throw new DOMException("채팅이 바뀌었습니다.", "AbortError");
    };
    // 실리태번 puts a new object in place of the metadata whenever anything updates it: always
    // the one there is now.
    const meta = () => (stOf(this) || {}).chatMetadata || {};
    await this.loadLineIndex();
    still();
    const idBefore = this.currentChatId();
    let line = structuredClone(lineIn(meta()) || []);
    const hashed = nameId(name, card);
    let changed = false;
    // The file has no line but the records know this very chat (its file was written over by
    // an older copy, or brought back from a backup): its line as the records keep it.
    if (!line.length) {
      const lost = this.lineIndex.get(hashed) || hashed;
      const kept = (await this.lookLines([lost])).entry;
      still();
      if (
        Array.isArray(kept?.line) &&
        kept.line.at(-1)?.id === lost &&
        kept.card === card &&
        kept.name === name
      ) {
        line = structuredClone(kept.line);
        changed = true;
      }
    }
    const stamped = line.length > 0;
    // The chat a branch came from, as 실리태번 keeps it: for a chat whose line has no chat
    // before it yet (a branch made before lines were kept).
    const mainChat = meta().main_chat;
    const parentName =
      line.length <= 1 && typeof mainChat === "string" ? mainChat : "";
    const named =
      parentName && parentName !== name ? this.chatIdOf(parentName, card) : "";
    const look = await this.lookLines(
      [
        ...new Set(
          [hashed, named, ...line.map((step) => step.id)].filter(Boolean),
        ),
      ],
      { orphans: true, self: idBefore },
    );
    still();
    // That chat may have been renamed since (its records then stand under another id, and the
    // lines made before keep keys built from the old one).
    let parent = named;
    let parentKeys = [];
    if (named && look.alias[named]) {
      parent = look.alias[named];
      parentKeys = [named];
      look.counts[parent] =
        (await this.lookLines([parent])).counts[parent] || 0;
      still();
    }
    const now = new Date().toISOString();
    // A copy opened for the first time is as long as it was made: what the chat it came from
    // kept at later messages never was this one's. (For a branch made before lines were kept
    // the length it has now: what stands past that can't be its either.)
    const length = Array.isArray(loaded) ? loaded.length : undefined;
    const parentStep = () => ({
      id: parent,
      card,
      name: parentName,
      since: "",
      ...(parentKeys.length ? { keys: parentKeys } : {}),
    });
    const hasParent = parent && parent !== hashed && look.counts[parent] > 0;
    // A bot card renamed since the file was written: the ids and keys the records have now.
    for (const step of line) {
      if (look.alias[step.id] && look.alias[step.id] !== line.at(-1).id) {
        step.keys = [...new Set([...(step.keys || []), step.id])];
        step.id = look.alias[step.id];
        changed = true;
      }
      for (let hop = 0; look.cards[step.card] && hop < 5; hop++) {
        step.card = look.cards[step.card];
        changed = true;
      }
    }
    // The id its name gives, unless anything is kept under that already (a chat that had this
    // name before): then one of its own.
    const fresh = () => (look.held[hashed] ? newId() : hashed);
    const self = line.at(-1);
    if (self && self.card === card && self.name === name) {
      // Itself. A branch whose parent wasn't found before gets it now.
      if (line.length === 1 && hasParent && parent !== self.id) {
        line.unshift(parentStep());
        self.since ||= now;
        if (!Number.isInteger(self.at)) self.at = length;
        changed = true;
      }
    } else if (self && self.card === card) {
      const names = await this.cardChatNames(card);
      still();
      if (names?.has(self.name)) {
        line.push({ id: fresh(), card, name, since: now, at: length });
        changed = true;
      } else if (names) {
        self.name = name;
        changed = true;
      }
      // The list can't be read: taken as itself for now, and looked at again next time.
      else this.lineSettled = { name, card, id: self.id };
    } else if (self) {
      line.push({ id: fresh(), card, name, since: now, at: length });
      changed = true;
    } else if (look.known[hashed]) {
      // The records keep this id for a chat of another name. No chat has that name any more:
      // this is that chat, renamed while its file had no line. Else another chat's file names
      // this id (it had this name once), and this one gets its own.
      const kept = look.entry;
      const names = kept?.card === card ? await this.cardChatNames(card) : null;
      still();
      if (kept?.card === card && !names) {
        // The chats can't be listed: looked at again next time.
        return;
      }
      if (kept?.card === card && !names.has(kept.name)) {
        line = structuredClone(kept.line);
        line.at(-1).name = name;
      } else line = [{ id: newId(), card, name, since: now }];
      changed = true;
    } else {
      line = [{ id: hashed, card, name, since: "" }];
      // Records made under an id the chat had before 씬보이스 kept lines (an older rename).
      if (look.entry?.keys?.length) line[0].keys = look.entry.keys;
      if (hasParent) {
        line.unshift(parentStep());
        line[1].since = now;
        line[1].at = length;
        changed = true;
      } else changed = look.counts[hashed] > 0 || Boolean(line[0].keys);
    }
    // Ids kept analyses name and nothing else does: tried as keys once lines are drawn.
    this.lineOrphans = look.orphans;
    if (!changed && !stamped) {
      // Nothing kept yet: the file is written when something first is (ensureChatStamp).
      this.linePending = { name, card, line };
      return;
    }
    let saving = null;
    if (changed) {
      this.lineSettled = { name, card, id: line.at(-1).id };
      saving = this.saveChatLine(line, still);
    }
    // The records first: what shows the chat needn't wait for its file to be written.
    await this.registerChatLine(line, card, name, still);
    // The records are another chat's than the one first taken, or more of them are in sight now.
    if (this.currentChatId() !== idBefore || this.lineRegisteredAnew)
      await this.chatRecordsMoved({ quiet: true });
    await saving;
    await this.tellImportedChat(line, card);
  },

  /**
   * The line into the chat's file. Written into the metadata as it is at that moment, and looked
   * at again after the save: something else updating the metadata meanwhile must not lose it.
   */
  async saveChatLine(line, still = () => {}) {
    for (let turn = 0; turn < 3; turn++) {
      const context = stOf(this) || {};
      if (!context.chatMetadata) return;
      context.chatMetadata[LINE_KEY] = line;
      try {
        await (context.saveMetadata?.() ?? context.saveChat?.());
      } catch (error) {
        console.warn("[SceneVoice] 채팅 파일에 계보를 적지 못했습니다.", error);
        return;
      }
      still();
      if (this.liveLine()?.at(-1)?.id === line.at(-1).id) return;
    }
  },

  /** The records get the line as the file has it, and what the chat put out of sight. */
  async registerChatLine(line, card, name, still = () => {}) {
    const hiddenNow = () => (stOf(this) || {}).chatMetadata?.[HIDDEN_KEY] || {};
    const { swap, locked } = await this.matchLinePeople(line, card);
    still();
    this.lineLocked = [...new Set(Object.values(locked || {}).flat())];
    const body = JSON.stringify({
      id: line.at(-1).id,
      card,
      name,
      line,
      hidden: hiddenNow(),
      swap,
      locked,
    });
    // Said already as it is (this page, this chat): nothing to write again.
    this.lineSaid ||= new Map();
    if (this.lineSaid.get(line.at(-1).id) === body) {
      this.lineRegisteredAnew = false;
      return;
    }
    const response = await this.transport.request(
      "/api/plugins/scenevoice/chats/line",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
    );
    const data = response.ok ? await response.json() : {};
    if (response.ok) this.lineSaid.set(line.at(-1).id, body);
    this.lineRegisteredAnew = data.changed === true && line.length > 1;
    this.lineMoreKeys = data.keys || [];
    still();
    // Put out of sight while the chat wasn't open (or on another device): the file follows.
    const hidden = data.hidden || {};
    const context = stOf(this) || {};
    if (
      context.chatMetadata &&
      Object.keys(hidden).some((id) => !Object.hasOwn(hiddenNow(), id))
    ) {
      context.chatMetadata[HIDDEN_KEY] = { ...hiddenNow(), ...hidden };
      context.saveMetadataDebounced?.();
    }
    void this.loadLineIndex();
  },

  /** Something is kept for this chat for the first time: its file gets its line. */
  async ensureChatStamp() {
    const pending = this.linePending;
    const context = stOf(this) || {};
    if (
      !pending ||
      pending.name !== String(context.chatId || "") ||
      pending.card !== this.getCurrentCharacterProfile().key ||
      this.liveLine()
    )
      return;
    this.linePending = null;
    this.lineSettled = {
      name: pending.name,
      card: pending.card,
      id: pending.line.at(-1).id,
    };
    await this.saveChatLine(pending.line);
    await this.registerChatLine(pending.line, pending.card, pending.name).catch(
      (error) =>
        console.warn("[SceneVoice] 계보를 등록하지 못했습니다.", error),
    );
  },

  /** What the open chat took away of the records it inherits: kept in its file. */
  keepLineHidden(chat, ids) {
    const context = stOf(this) || {};
    if (chat !== this.currentChatId() || !context.chatMetadata) return;
    const now = new Date().toISOString();
    const hidden = { ...context.chatMetadata[HIDDEN_KEY] };
    for (const id of ids) hidden[id] ||= now;
    context.chatMetadata[HIDDEN_KEY] = hidden;
    this.lineSaid?.delete(chat);
    context.saveMetadataDebounced?.();
  },

  /** Once per chat brought over from another bot card: how its people are told apart. */
  async tellImportedChat(line, card) {
    const context = stOf(this) || {};
    const metadata = context.chatMetadata || {};
    if (
      metadata[TOLD_KEY] ||
      !this.lineLocked?.length ||
      !line.slice(0, -1).some((step) => step.card !== card)
    )
      return;
    metadata[TOLD_KEY] = true;
    context.saveMetadataDebounced?.();
    this.notify(
      `다른 봇카드에서 가져온 채팅입니다. 이름이 같은 인물의 스마트폰 기록은 이어졌고, ${this.lineLocked.length}명의 기록은 보기만 할 수 있습니다. ‘캐릭터’ 탭에 같은 이름이나 별명으로 화자를 등록하면 이어집니다.`,
      "info",
    );
  },
};
