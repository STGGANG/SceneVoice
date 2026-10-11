import { dataBlock } from "./prompts.js";
import { escapeHtml } from "./common.js";

// 로어북 참고: which lorebooks and entries calls and texts may use, chosen per bot card.
// Books linked to the card are picked by default, with the entries ST has on.
// Of the chosen entries, an always-on one is always sent, a keyed one when a key turns up.

const SOURCES = {
  primary: "캐릭터 기본",
  extra: "캐릭터 추가",
  embedded: "카드 내장",
  chat: "현재 채팅",
  persona: "페르소나",
  global: "전역",
};

let worldModule = null;
async function loadWorldModule() {
  // ST's own module; absent outside ST (tests), where only the context functions are used.
  worldModule ??= import(/* @vite-ignore */ "/scripts/world-info.js").catch(() => ({}));
  return worldModule;
}

const keysOf = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((key) => String(key).trim())
    .filter(Boolean);

export const lore = {
  /** The bot card the lorebook choice belongs to: the chat's first card. */
  loreCardKey() {
    return this.currentCardKeys()[0] || "";
  },

  /** Books for this chat's card: linked ones first (picked by default), then every other book. */
  async discoverLoreBooks() {
    const context = window.SillyTavern?.getContext?.() || {};
    const world = await loadWorldModule();
    const card = context.characters?.[context.characterId];
    const books = new Map();
    const add = (name, source, { auto = false, embedded = null, key = `book:${name}` } = {}) => {
      if (!name) return;
      const found = books.get(key);
      if (found) {
        if (source && !found.sources.includes(source)) found.sources.push(source);
        found.auto ||= auto;
        return;
      }
      books.set(key, { key, name: String(name), sources: source ? [source] : [], auto, embedded });
    };
    const primary = card?.data?.extensions?.world;
    add(primary, SOURCES.primary, { auto: true });
    const fileName = String(card?.avatar || "").replace(/\.[^.]+$/, "");
    const charLore = world.world_info?.charLore?.find?.((item) => item.name === fileName);
    for (const name of charLore?.extraBooks || []) add(name, SOURCES.extra, { auto: true });
    if (!primary && card?.data?.character_book?.entries)
      add(card.data.character_book.name || "카드 내장 월드인포", SOURCES.embedded, {
        auto: true,
        embedded: card.data.character_book,
        key: `embedded:${card.avatar}`,
      });
    add(context.chatMetadata?.[world.METADATA_KEY || "world_info"], SOURCES.chat, { auto: true });
    add(context.powerUserSettings?.persona_description_lorebook, SOURCES.persona);
    for (const name of world.selected_world_info || []) add(name, SOURCES.global);
    const names =
      context.getWorldInfoNames?.() || (Array.isArray(world.world_names) ? world.world_names : []);
    for (const name of names) add(name, "");
    return [...books.values()];
  },

  /** A book's entries: uid, name, keys, content, whether ST has it on, always-on. */
  async loadLoreEntries(book) {
    const context = window.SillyTavern?.getContext?.() || {};
    const data = book.embedded
      ? book.embedded
      : typeof context.loadWorldInfo === "function"
        ? await context.loadWorldInfo(book.name)
        : (await loadWorldModule()).loadWorldInfo?.(book.name);
    const raw = data?.entries;
    if (!raw || typeof raw !== "object") return [];
    const list = Array.isArray(raw) ? raw.map((entry, index) => [String(index), entry]) : Object.entries(raw);
    return list
      .map(([fallback, entry]) => {
        if (!entry || typeof entry !== "object") return null;
        const keys = keysOf(entry.key ?? entry.keys);
        return {
          uid: String(entry.uid ?? entry.id ?? fallback),
          name: String(entry.comment || entry.name || keys.join(", ") || `항목 #${fallback}`),
          keys,
          content: typeof entry.content === "string" ? entry.content.trim() : "",
          enabled: entry.disable !== true && entry.disabled !== true && entry.enabled !== false,
          constant: Boolean(entry.constant),
        };
      })
      .filter((entry) => entry?.content);
  },

  /** The saved choice for a card: {books: {key: bool}, entries: {bookKey: {uid: bool}}}. */
  loreChoice(cardKey = this.loreCardKey(), source = this.loreDraft || this.config.phone?.world_info_choice) {
    return source?.[cardKey] || { books: {}, entries: {} };
  },

  /**
   * Lorebook entries for a call or text: of the chosen ones, always-on entries and those whose
   * key appears in the recent chat or this conversation. [] when 월드인포 참고 is off.
   */
  async worldInfoBlocks(lines = []) {
    const choice = this.loreChoice(this.loreCardKey(), this.config.phone?.world_info_choice);
    if (!choice.enabled) return [];
    try {
      const context = window.SillyTavern?.getContext?.() || {};
      const scan = [
        ...(context.chat || [])
          .filter((message) => !message?.is_system)
          .slice(-20)
          .map((message) => message.mes),
        ...lines.filter(Boolean).map(String),
      ]
        .join("\n")
        .toLowerCase();
      const picked = [];
      for (const book of await this.discoverLoreBooks()) {
        if (!(choice.books?.[book.key] ?? book.auto)) continue;
        const chosen = choice.entries?.[book.key] || {};
        for (const entry of await this.loadLoreEntries(book)) {
          if (!(chosen[entry.uid] ?? entry.enabled)) continue;
          const hit =
            entry.constant ||
            entry.keys.some((key) => {
              const pattern = /^\/(.+)\/([a-z]*)$/i.exec(key);
              if (pattern)
                try {
                  return new RegExp(pattern[1], pattern[2]).test(scan);
                } catch {
                  return false;
                }
              return scan.includes(key.toLowerCase());
            });
          if (hit) picked.push(`[${entry.name}]\n${entry.content}`);
        }
      }
      return picked.length ? [dataBlock("world_info", picked.join("\n"))] : [];
    } catch (error) {
      console.warn("[SceneVoice] lorebook lookup failed", error);
      return [];
    }
  },

  /** The book and entry picker under 캐릭터별 목소리 → 봇카드 → 월드인포 참고. */
  async renderLorePicker(shownCard = this.loreCardKey()) {
    const root = document.getElementById("sv-lore-picker");
    if (!root) return;
    const cardKey = this.loreCardKey();
    // The books come from the open chat's card: another card's are chosen in its own chat.
    if (!cardKey || !this.hasCharacterChat() || shownCard !== cardKey) {
      root.innerHTML = '<p class="sv-hint">이 봇카드의 채팅을 열면 월드인포를 고를 수 있습니다.</p>';
      return;
    }
    this.loreDraft ||= structuredClone(this.config.phone?.world_info_choice || {});
    root.innerHTML = '<p class="sv-hint">월드인포 목록을 읽는 중…</p>';
    const books = await this.discoverLoreBooks();
    this.loreBooks = books;
    const choice = this.loreChoice(cardKey);
    if (!books.length) {
      root.innerHTML = '<p class="sv-hint">고를 수 있는 월드인포가 없습니다.</p>';
      return;
    }
    root.innerHTML = `
      <ul class="sv-lore-books">${books
        .map(
          (book) => `<li class="sv-lore-book" data-book="${escapeHtml(book.key)}">
            <label class="sv-check"><input type="checkbox" data-lore-book ${(choice.books?.[book.key] ?? book.auto) ? "checked" : ""}><span>${escapeHtml(book.name)}</span></label>
            ${book.sources.map((source) => `<span class="sv-badge">${escapeHtml(source)}</span>`).join("")}
            <button type="button" class="sv-btn sv-btn-ghost sv-btn-sm" data-lore-open aria-expanded="false"><i class="fa-solid fa-list" aria-hidden="true"></i><span>항목</span></button>
            <div class="sv-lore-entries" hidden></div>
          </li>`,
        )
        .join("")}</ul>`;
  },

  async renderLoreEntries(item) {
    const book = this.loreBooks?.find((found) => found.key === item.dataset.book);
    const box = item.querySelector(".sv-lore-entries");
    if (!book || !box) return;
    box.innerHTML = '<p class="sv-hint">항목을 읽는 중…</p>';
    let entries = [];
    try {
      entries = await this.loadLoreEntries(book);
    } catch (error) {
      box.innerHTML = `<p class="sv-hint">${escapeHtml(error.message || "월드인포를 읽지 못했습니다.")}</p>`;
      return;
    }
    const chosen = this.loreChoice().entries?.[book.key] || {};
    box.innerHTML = entries.length
      ? entries
          .map(
            (entry) => `<label class="sv-check sv-lore-entry" title="${escapeHtml(entry.content.slice(0, 400))}">
              <input type="checkbox" data-lore-entry="${escapeHtml(entry.uid)}" ${(chosen[entry.uid] ?? entry.enabled) ? "checked" : ""}>
              <span>${escapeHtml(entry.name)}</span>
              ${entry.constant ? '<span class="sv-badge">상시</span>' : `<small>${escapeHtml(entry.keys.slice(0, 4).join(", "))}</small>`}
            </label>`,
          )
          .join("")
      : '<p class="sv-hint">내용이 있는 항목이 없습니다.</p>';
  },

  /** Clicks and changes in the picker; the choice is saved with the other settings. */
  bindLorePicker() {
    const root = document.getElementById("sv-lore-picker");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "true";
    const remember = (book, uid, value) => {
      const cardKey = this.loreCardKey();
      // Saved with the other settings: the change bubbles up to the settings form.
      this.loreDraft ||= structuredClone(this.config.phone?.world_info_choice || {});
      const choice = (this.loreDraft[cardKey] ||= { books: {}, entries: {} });
      if (uid === null) choice.books[book] = value;
      else (choice.entries[book] ||= {})[uid] = value;
    };
    root.addEventListener("click", (event) => {
      const open = event.target.closest("[data-lore-open]");
      if (!open) return;
      const item = open.closest(".sv-lore-book");
      const box = item.querySelector(".sv-lore-entries");
      box.hidden = !box.hidden;
      open.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden && !box.dataset.loaded) {
        box.dataset.loaded = "true";
        this.run(() => this.renderLoreEntries(item));
      }
    });
    root.addEventListener("change", (event) => {
      const item = event.target.closest(".sv-lore-book");
      if (!item) return;
      if (event.target.matches("[data-lore-book]"))
        remember(item.dataset.book, null, event.target.checked);
      else if (event.target.matches("[data-lore-entry]"))
        remember(item.dataset.book, event.target.dataset.loreEntry, event.target.checked);
    });
  },
};
