// A chat sees the records of the chats it came from (a branch, a copy, an import) up to the
// moment it left them. Nothing is moved or copied for that: each request gets a view of the
// records in which the inherited ones stand as this chat's own, and what the request changed of
// them is kept as this chat's (the chat they came from keeps its own). See DEVELOPMENT.md.
import { sha256 } from "./hash.js";

/** Lists whose rows belong to a chat (`chat_id`) and carry an `id`. */
export const LINE_LISTS = [
  "sessions",
  "messages",
  "groups",
  "memos",
  "radio",
  "generations",
  "stateHistory",
];
/** Records kept by key, each naming its chat: read through the line, written as one's own. */
const KEYED = ["lineEdits", "analyses"];

const madeAt = (row) =>
  String(row?.created_at || row?.started_at || row?.updated_at || "");
const before = (row, until) => !until || !madeAt(row) || madeAt(row) < until;
const snap = (value) => JSON.stringify(value);

/** A person key swapped for another wherever it stands (a value, or the key of an object). */
function swapKeys(value, swap) {
  if (!swap?.size) return value;
  if (typeof value === "string") return swap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => swapKeys(item, swap));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value))
    out[swap.get(key) ?? key] = swapKeys(item, swap);
  return out;
}

/** The registered line of a chat: the chats it came from, then itself (last). */
const lineOf = (lines, chat) => {
  const line = lines?.[chat]?.line;
  return Array.isArray(line) ? line.filter((entry) => entry?.id) : [];
};

/** The chats `chat` came from, nearest first, each with the moment the line left it. */
export function ancestorsOf(lines, chat) {
  const line = lineOf(lines, chat);
  const at = line.findIndex((entry) => entry.id === chat);
  const out = [];
  // How many messages the line had when it left: the shortest of the steps after each chat.
  let upTo = Infinity;
  for (let index = at - 1; index >= 0; index--) {
    const length = line[index + 1].at;
    if (Number.isInteger(length) && length >= 0) upTo = Math.min(upTo, length);
    out.push({
      id: line[index].id,
      // Ids that chat had before (renamed by a version that moved its records): its as well.
      keys: Array.isArray(line[index].keys) ? line[index].keys : [],
      card: String(line[index].card || ""),
      until: String(line[index + 1].since || ""),
      upTo,
    });
  }
  return out;
}
/** Made at a message the line never had (after the point where it left that chat). */
const beyond = (row, upTo) => {
  const at = String(row?.anchor_message_id ?? row?.message_id ?? "");
  return /^\d+$/.test(at) && Number(at) >= upTo;
};

/** The chats that came straight from `chat`, by id, with the moment each left it. */
export function childrenOf(lines, chat) {
  const out = new Map();
  for (const id of Object.keys(lines || {})) {
    const line = lineOf(lines, id);
    const at = line.findIndex((entry) => entry.id === chat);
    if (at < 0 || at >= line.length - 1) continue;
    const child = line[at + 1];
    if (!out.has(child.id))
      out.set(child.id, {
        since: String(child.since || ""),
        upTo: Number.isInteger(child.at) && child.at >= 0 ? child.at : Infinity,
      });
  }
  return out;
}
/** `row` of `chat` is among what a chat that came from it inherits (see childrenOf). */
export const inheritedByChild = (lines, chat, row) =>
  [...childrenOf(lines, chat).values()].some(
    (left) => before(row, left.since) && !beyond(row, left.upTo),
  );

/**
 * Ids this chat put out of sight, and those a chat between it and their owner put out of sight
 * before this chat's line left that chat.
 */
function hiddenIds(lines, chat) {
  const out = new Set(Object.keys(lines?.[chat]?.hidden || {}));
  const line = lineOf(lines, chat);
  const at = line.findIndex((entry) => entry.id === chat);
  for (let index = 1; index < at; index++) {
    const until = String(line[index + 1].since || "");
    for (const [id, when] of Object.entries(
      lines?.[line[index].id]?.hidden || {},
    ))
      if (!until || String(when) < until) out.add(id);
  }
  return out;
}

const stateKeyFor = (key, chat, person) =>
  String(key).startsWith("state-round-")
    ? `state-round-${sha256(chat)}`
    : `${String(key).startsWith("state-status-") ? "state-status-" : "state-"}${sha256(`${chat}|${person || ""}`)}`;

/**
 * The records as `chat` sees them. `write`: the view will be changed and `commit` called (the
 * inherited rows are then deep copies, and what `chat`'s children would lose is kept for them).
 * A chat that came from nowhere and has no children gets the records themselves.
 */
export function openView(data, chat, { write = false } = {}) {
  const lines = data.lines || {};
  const ancestors = chat ? ancestorsOf(lines, chat) : [];
  const kids = write && chat ? childrenOf(lines, chat) : new Map();
  // Ids this chat itself had before: what is still kept by key under them is its own.
  const self = chat ? lineOf(lines, chat).at(-1) : null;
  const ownKeys = new Set(
    self?.id === chat
      ? [...(self.keys || []), ...(lines[chat]?.keys || [])].filter(
          (key) => key && key !== chat,
        )
      : [],
  );
  if (!ancestors.length && !kids.size && !ownKeys.size)
    return { view: data, inherited: false, commit: () => [] };

  const rank = new Map();
  const until = new Map();
  const upTo = new Map();
  ancestors.forEach((entry, index) => {
    for (const id of [entry.id, ...entry.keys]) {
      if (rank.has(id) || id === chat || ownKeys.has(id)) continue;
      rank.set(id, index);
      until.set(id, entry.until);
      upTo.set(id, entry.upTo);
    }
  });
  const hidden = hiddenIds(lines, chat);
  const swaps = new Map(
    Object.entries(lines?.[chat]?.swap || {}).map(([from, pairs]) => [
      from,
      new Map(Object.entries(pairs || {})),
    ]),
  );
  const copyOf = (row, extra = {}) => {
    const from = row.chat_id;
    const copy = swapKeys(
      write ? structuredClone(row) : { ...row },
      swaps.get(from),
    );
    Object.assign(copy, extra, {
      chat_id: chat,
      line_from: row.line_from || from,
    });
    return copy;
  };
  const view = { ...data };
  const tracked = {};

  // People's states: an ancestor's entry stands under the key this chat would use for it.
  const stateKeys = new Map();
  const stateCopies = new Map();
  if (ancestors.length) {
    view.states = { ...data.states };
    const nearest = new Map();
    for (const [key, item] of Object.entries(data.states || {})) {
      const place = rank.get(item?.chat_id);
      if (place === undefined) continue;
      const target = stateKeyFor(
        key,
        chat,
        swaps.get(item.chat_id)?.get(item.character_key) ?? item.character_key,
      );
      stateKeys.set(key, target);
      if (Object.hasOwn(data.states, target)) continue;
      const had = nearest.get(target);
      if (!had || rank.get(had.item.chat_id) > place)
        nearest.set(target, { key, item });
    }
    for (const [target, { key, item }] of nearest) {
      // What its chat learned after the line left it is that chat's alone.
      const cut = until.get(item.chat_id);
      const source = before({ created_at: item.updated_at }, cut)
        ? item
        : [...(data.stateHistory || [])]
            .reverse()
            .find((row) => row.state_key === key && before(row, cut));
      if (!source) continue;
      const copy = copyOf(
        { ...source, chat_id: item.chat_id },
        { state_key: target },
      );
      delete copy.id;
      view.states[target] = copy;
      stateCopies.set(target, write ? snap(copy) : "");
    }
  }

  for (const list of LINE_LISTS) {
    const base = data[list] || [];
    if (!ancestors.length) {
      tracked[list] = { base, copies: new Map(), away: [], stoodIn: new Set() };
      continue;
    }
    const own = new Set();
    const stoodIn = new Set();
    for (const row of base)
      if (row?.chat_id === chat) {
        own.add(row.id);
        if (row.line_from) stoodIn.add(row.id);
      }
    const pick = new Map();
    for (const row of base) {
      const place = rank.get(row?.chat_id);
      if (
        place === undefined ||
        own.has(row.id) ||
        hidden.has(row.id) ||
        !before(row, until.get(row.chat_id)) ||
        beyond(row, upTo.get(row.chat_id)) ||
        (list === "stateHistory" && !stateKeys.has(row.state_key))
      )
        continue;
      const had = pick.get(row.id);
      if (!had || rank.get(had.chat_id) > place) pick.set(row.id, row);
    }
    const copies = new Map();
    const away = [];
    const shown = [];
    for (const row of base) {
      if (pick.get(row?.id) === row) {
        const copy = copyOf(
          row,
          list === "stateHistory"
            ? { state_key: stateKeys.get(row.state_key) }
            : {},
        );
        copies.set(row.id, { original: row, was: write ? snap(copy) : "" });
        shown.push(copy);
      }
      // Another chat's row under an id this chat has its own of: out of sight for the request.
      else if (row?.chat_id !== chat && (own.has(row?.id) || pick.has(row?.id)))
        away.push(row);
      else shown.push(row);
    }
    view[list] = shown;
    tracked[list] = { base, copies, away, stoodIn };
  }

  const keyed = {};
  if (ancestors.length || ownKeys.size)
    for (const name of KEYED) {
      const base = data[name] || {};
      const originals = {};
      const shown = { ...base };
      for (const [key, item] of Object.entries(base)) {
        if (
          !ownKeys.has(item?.chat_id) &&
          (rank.get(item?.chat_id) === undefined ||
            !before(item, until.get(item.chat_id)))
        )
          continue;
        originals[key] = item;
        shown[key] = copyOf(item);
      }
      view[name] = shown;
      keyed[name] = originals;
    }

  // What this chat shows now of rows its children inherit: a child keeps it as it was.
  const shownBefore = new Map();
  if (kids.size)
    for (const list of LINE_LISTS)
      for (const row of view[list] || [])
        if (row?.chat_id === chat && row.id)
          shownBefore.set(`${list}\n${row.id}`, snap(row));

  const commit = () => {
    const gone = [];
    for (const list of LINE_LISTS) {
      const { base, copies, away, stoodIn } = tracked[list];
      const order = new Map(base.map((row, index) => [row, index]));
      const after = view[list] || [];
      const out = [];
      const alive = new Set();
      for (const row of after) {
        const copy =
          row?.chat_id === chat && row.line_from
            ? copies.get(row.id)
            : undefined;
        if (!copy || alive.has(row.id)) {
          out.push(row);
          continue;
        }
        alive.add(row.id);
        out.push(copy.original);
        // Changed here: this chat's own from now on, beside the one it came from.
        if (snap(row) !== copy.was) out.push(row);
      }
      const back = [...away];
      for (const [id, copy] of copies)
        if (!alive.has(id)) {
          back.push(copy.original);
          gone.push(id);
        }
      // Its own row in place of an inherited one, taken away: the inherited one stays away too.
      for (const id of stoodIn)
        if (!after.some((row) => row?.id === id && row.chat_id === chat))
          gone.push(id);
      back.sort((a, b) => order.get(a) - order.get(b));
      for (const row of back) {
        const at = order.get(row);
        const spot = out.findIndex((item) => (order.get(item) ?? -1) > at);
        out.splice(spot < 0 ? out.length : spot, 0, row);
      }
      if (kids.size) {
        const now = new Map();
        for (const row of after)
          if (row?.chat_id === chat && row.id) now.set(row.id, snap(row));
        for (const [mark, was] of shownBefore) {
          const [name, id] = mark.split("\n");
          if (name !== list || now.get(id) === was) continue;
          // Put out of sight here only: the children still see it where it came from.
          if (!now.has(id) && copies.has(id)) continue;
          const old = JSON.parse(was);
          for (const [kid, left] of kids) {
            if (
              !before(old, left.since) ||
              beyond(old, left.upTo) ||
              Object.hasOwn(lines?.[kid]?.hidden || {}, id) ||
              out.some((item) => item?.id === id && item.chat_id === kid)
            )
              continue;
            out.push({
              ...old,
              chat_id: kid,
              line_from: old.line_from || chat,
            });
          }
        }
      }
      data[list] = out;
    }
    if (ancestors.length) {
      for (const [target, was] of stateCopies)
        if (
          Object.hasOwn(view.states, target) &&
          snap(view.states[target]) === was
        )
          delete view.states[target];
    }
    data.states = view.states;
    // Kept by key: written under this chat's own keys only; the inherited ones stay theirs.
    for (const name of KEYED)
      data[name] = keyed[name] ? { ...view[name], ...keyed[name] } : view[name];
    // Everything else the request set (settings, files, favourites) is the records' own.
    for (const [key, value] of Object.entries(view))
      if (!LINE_LISTS.includes(key) && !KEYED.includes(key) && key !== "states")
        data[key] = value;
    if (gone.length) {
      data.lines ||= {};
      const entry = (data.lines[chat] ||= {});
      entry.hidden ||= {};
      const stamp = new Date().toISOString();
      for (const id of gone) entry.hidden[id] ||= stamp;
    }
    return gone;
  };
  return { view, inherited: ancestors.length > 0, commit };
}
