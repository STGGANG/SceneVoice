// 문자 카드 and 인용 답장 in the messaging app: a photo (described in words, or a picture the user
// attaches for a model that reads images), a location, an appointment, money, a gift. Either
// side sends them; which kinds are in use is switched in the + menu itself.
import { escapeHtml, mergeConfig } from "./common.js";
import { validReaction } from "../shared/store.js";

// type, name, icon, what its two boxes hold ("" = no second box), English word for prompts.
export const CARD_KINDS = [
  ["photo", "사진", "image", "사진 설명 (짧은 문장)", "", "Photo"],
  ["location", "위치", "location-dot", "장소", "", "Location"],
  ["appointment", "약속", "calendar-check", "장소", "시간", "Appointment"],
  [
    "transfer",
    "송금",
    "coins",
    "금액 (예: 30,000원)",
    "메모 (선택)",
    "Money sent",
  ],
  ["gift", "선물", "gift", "선물 (예: 커피 쿠폰)", "메모 (선택)", "Gift"],
  [
    "song",
    "노래",
    "music",
    "제목 (예: 가수 - 곡 이름)",
    "한마디 (선택)",
    "Song shared",
  ],
  [
    "video",
    "영상",
    "clapperboard",
    "제목 (예: 채널 - 영상 제목)",
    "한마디 (선택)",
    "Video shared",
  ],
  ["poll", "투표", "square-poll-vertical", "항목", "질문 (선택)", "Poll"],
];
// 투표: how many choices one can hold.
export const POLL_MAX = 8;
/** A poll's choices: its title split at " / " (at commas when it has no slash). */
export const pollChoices = (card) => {
  const title = String(card?.title || "");
  return title
    .split(title.includes("/") ? /\s*\/\s*/ : /\s*,\s*/)
    .map((choice) => choice.trim())
    .filter(Boolean)
    .slice(0, POLL_MAX);
};
// The emoji offered at a tap for a reaction; any one emoji can be left (mine typed, theirs chosen).
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"];
const kindOf = (type) => CARD_KINDS.find(([key]) => key === type);
// Answering the other side's card (mine with a button, theirs in their reply): what each button
// says, what the answer is called on screen, and how a prompt reads it.
const CARD_ANSWERS = {
  appointment: {
    accept: ["좋아", "약속 수락", "Accepted the appointment"],
    decline: ["다음에", "약속은 다음에", "Turned the appointment down for now"],
  },
  transfer: {
    accept: ["받기", "송금 받음", "Accepted the money"],
    decline: ["거절", "송금 거절", "Declined the money"],
  },
  gift: {
    accept: ["받기", "선물 받음", "Accepted the gift"],
    decline: ["거절", "선물 거절", "Declined the gift"],
    // Opened a random draw and got nothing.
    miss: ["", "꽝", "Opened the gift draw and got nothing"],
  },
};
/**
 * A card of mine in a group shared out at random (`claim`): the dice are rolled when it is sent
 * but nothing shows until a member opens it in a reply, each finding their own result then.
 * Cards sent before this (shares or a winner with no `claim`) just landed, with no answer.
 */
export const cardCanBeAnswered = (card) =>
  Boolean(CARD_ANSWERS[card?.type]) &&
  (Boolean(card.claim) || (!card.shares && !card.winner));
/** What `name` finds on opening a claim card: an amount, an item, or "" (nothing). */
export const claimOutcome = (card, name) =>
  (card?.type === "transfer"
    ? card.shares?.find((share) => share.name === name)?.amount
    : card?.prizes?.find((prize) => prize.name === name)?.item) || "";
/** The members a claim card is shared among. */
export const claimNames = (card) =>
  card?.among?.length
    ? card.among
    : (card?.shares || card?.prizes || []).map((row) => row.name);
// 송금의 통화: code, name in the list, how an amount reads with it. "" = 직접 작성.
export const CURRENCIES = [
  ["KRW", "원 (KRW)", (amount) => `${amount}원`],
  ["JPY", "엔 (JPY)", (amount) => `${amount}엔`],
  ["CNY", "위안 (CNY)", (amount) => `${amount}위안`],
  ["USD", "달러 (USD)", (amount) => `$${amount}`],
  ["EUR", "유로 (EUR)", (amount) => `€${amount}`],
  ["GBP", "파운드 (GBP)", (amount) => `£${amount}`],
];
const LAST_CURRENCY = "scenevoice_currency";
function lastCurrency() {
  try {
    const saved = localStorage.getItem(LAST_CURRENCY);
    return saved === "" || CURRENCIES.some(([code]) => code === saved)
      ? saved
      : "KRW";
  } catch {
    return "KRW";
  }
}
function keepCurrency(code) {
  try {
    localStorage.setItem(LAST_CURRENCY, code);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}
/** Digits, separators and one decimal point: what an amount box takes with a currency picked. */
const onlyNumber = (text) => {
  const kept = String(text ?? "").replace(/[^0-9.,]/g, "");
  const dot = kept.indexOf(".");
  return dot < 0
    ? kept
    : kept.slice(0, dot + 1) + kept.slice(dot + 1).replace(/[.]/g, "");
};
/** Thousands separators for the digits of an amount as it is typed ("30000원" → "30,000원"). */
export function groupDigits(text) {
  return String(text ?? "").replace(/\d[\d,]*\d|\d/g, (found, at, whole) => {
    const digits = found.replace(/,/g, "");
    // The part after a decimal point is left alone.
    if (whole[at - 1] === "." || digits.length < 4)
      return digits.length < 4 ? digits : found;
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  });
}
/**
 * `amount` ("30,000원") split among `names` at random, everyone getting something: the same
 * wording with each share's number, or null when there is no whole number big enough to split.
 */
export function randomShares(amount, names, random = Math.random) {
  const found = String(amount || "").match(/\d[\d,]*/);
  if (!found || /^[.]\d/.test(amount.slice(found.index + found[0].length)))
    return null;
  const total = Number(found[0].replace(/,/g, ""));
  const count = names.length;
  if (!Number.isSafeInteger(total) || count < 2 || total < count) return null;
  // Round shares where the amount is big enough for it to look natural.
  const unit = total >= count * 1000 ? 100 : total >= count * 100 ? 10 : 1;
  const units = Math.floor(total / unit);
  const weights = names.map(() => 0.15 + random() ** 1.5);
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map(
    (weight) => 1 + Math.floor(((units - count) * weight) / sum),
  );
  let left = units - shares.reduce((a, b) => a + b, 0);
  while (left-- > 0) shares[Math.floor(random() * count) % count] += 1;
  const amounts = shares.map((share) => share * unit);
  // What the rounding left over goes to whoever got the most.
  amounts[amounts.indexOf(Math.max(...amounts))] += total - units * unit;
  const write = (value) =>
    amount.slice(0, found.index) +
    groupDigits(String(value)) +
    amount.slice(found.index + found[0].length);
  return names.map((name, index) => ({ name, amount: write(amounts[index]) }));
}
// 위치: a small drawn map (a park, water, streets, a main road) with a pin on the place.
const MAP_ART = `<svg class="sv-card-map" viewBox="0 0 216 92" preserveAspectRatio="xMidYMid slice" focusable="false">
  <rect width="216" height="92" fill="#f5f2ec"/>
  <path d="M146 -4h76v40q-26 16-58 6-24-12-18-46z" fill="#d9eed0"/>
  <path d="M-6 66q26-10 46 2t34 30h-80z" fill="#c5e1f6"/>
  <g fill="#ebe7df"><rect x="12" y="8" width="20" height="13" rx="2.5"/><rect x="60" y="36" width="26" height="12" rx="2.5"/><rect x="118" y="34" width="20" height="13" rx="2.5"/><rect x="62" y="6" width="24" height="12" rx="2.5"/><rect x="184" y="52" width="22" height="12" rx="2.5"/></g>
  <g stroke="#fff" stroke-linecap="round" fill="none">
    <path d="M-8 28L224 22" stroke-width="5"/><path d="M-8 56L224 50" stroke-width="4"/>
    <path d="M44-8l8 108" stroke-width="4"/><path d="M100-8l6 108" stroke-width="5"/><path d="M172-8l6 108" stroke-width="4"/>
  </g>
  <path d="M-8 86L224 68" stroke="#ffe9b0" stroke-width="8" fill="none"/>
  <ellipse cx="103" cy="54" rx="7" ry="2.4" fill="#000" opacity=".16"/>
  <path d="M103 52c-8.5-10.5-12.5-15.5-12.5-22a12.5 12.5 0 0 1 25 0c0 6.5-4 11.5-12.5 22z" fill="#ee5a52"/>
  <circle cx="103" cy="30" r="4.4" fill="#fff"/>
</svg>`;
// A picture goes out no larger than this (the long side, then the quality), small enough to keep
// inline where 실리태번 can't store files.
const IMAGE_STEPS = [
  [1024, 0.8],
  [768, 0.7],
  [512, 0.6],
];
const IMAGE_LIMIT = 370000;
// Pictures of the latest messages shown to the model with a reply.
const IMAGES_PER_REQUEST = 3;
const IMAGE_REACH = 8;

export const cards = {
  /** A gift in a group holds at most one thing per member. */
  giftItemsMax(key) {
    return Math.max(1, (this.messageGroup(key)?.members || []).length);
  },

  /** The card kinds switched on (설정 없이 문자 화면의 + 메뉴에서 켜고 끔). */
  cardKindsOn() {
    const chosen = this.config.voice_message?.cards || {};
    return CARD_KINDS.map(([type]) => type).filter(
      (type) => chosen[type] !== false,
    );
  },

  /** A card as prompts and the chat memory read it: one bracket line. */
  cardLine(card) {
    if (card?.type === "reply") {
      const words = CARD_ANSWERS[card.about]?.[card.answer]?.[2];
      return words ? `[${words}: ${card.detail || card.title}]` : "";
    }
    const kind = kindOf(card?.type);
    if (!kind) return "";
    // A picture without my own words is told by what the model saw in it (noted at first sight).
    const title =
      card.title ||
      (card.image
        ? card.seen
          ? `${card.seen} (attached image)`
          : "(attached image)"
        : "");
    const detail = card.detail
      ? card.type === "appointment"
        ? ` / ${card.detail}`
        : ` (${card.detail})`
      : "";
    // A claim card's results stay out of this line (it is read on screen and in the chat memory):
    // they come out one by one, in the members' own answers.
    const luck = card.claim
      ? card.type === "transfer"
        ? ", split at random among the members who open it"
        : ", drawn at random among the members who open it"
      : card.shares?.length
        ? `, split at random among the members: ${card.shares.map((share) => `${share.name} ${share.amount}`).join(", ")}`
        : card.winner
          ? `, drawn at random among the members: only ${card.winner} gets it`
          : "";
    return `[${kind[5]}: ${title}${luck}${detail}]`;
  },

  quoteLine(quote) {
    return quote?.text
      ? `[Replying to ${quote.from || "an earlier message"}: “${quote.text}”]`
      : "";
  },

  /** A model reply's card (its `card` field), kept only when its kind is switched on. */
  cardFromReply(parsed) {
    const card = parsed?.card;
    if (!card || typeof card !== "object") return null;
    const type = String(card.type || "").toLowerCase();
    const title = String(card.title ?? "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();
    if (!this.cardKindsOn().includes(type) || !title) return null;
    const translation = String(card.translation ?? "")
      .replace(/\[[^\]]*\]/g, "")
      .trim()
      .slice(0, 300);
    return {
      type,
      title: title.slice(0, 240),
      detail: String(card.detail ?? "")
        .replace(/\[[^\]]*\]/g, "")
        .trim()
        .slice(0, 240),
      // What the card says in Korean, when it was written in another language.
      ...(translation && translation !== title ? { translation } : {}),
    };
  },

  /** The message a reply quotes (its `reply_to`: the n of a message in the thread it was shown). */
  quoteFromReply(parsed, thread = []) {
    const item = thread[Number(parsed?.reply_to) - 1];
    return item ? this.quoteOfMessage(item) : null;
  },

  quoteOfMessage(item) {
    const text = String(
      item.forward && !item.forward.note
        ? item.forward.title
        : item.card?.solo
          ? this.cardLabel(item.card)
          : item.text || "",
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" / ")
      .slice(0, 600);
    return text
      ? {
          id: item.id,
          from:
            item.role === "user"
              ? this.userCharacterName()
              : item.character_name || "",
          text,
        }
      : null;
  },

  cardLabel(card) {
    if (card?.type === "reply") return card.title || "";
    const kind = kindOf(card?.type);
    return kind ? `${kind[1]}${card.title ? ` · ${card.title}` : ""}` : "";
  },

  quoteHtml(item) {
    const quote = item?.quote;
    if (!quote?.text) return "";
    return `<div class="sv-msg-quote"><b><i class="fa-solid fa-reply" aria-hidden="true"></i>${escapeHtml(quote.from || "")}</b><span>${escapeHtml(quote.text)}</span></div>`;
  },

  /**
   * A card as the messaging app shows it: a picture part on top (a little map, a wrapped gift,
   * the amount sent, a calendar page, the photo itself) and its words under it.
   */
  cardHtml(item, { answered = "", canAnswer = false, claims = null } = {}) {
    const card = item?.card;
    // Any other answer to a card: a small line of its own, not a card with a picture.
    // Money or a gift taken: a card like the one that was sent, saying who has it now.
    if (
      card?.type === "reply" &&
      card.answer === "accept" &&
      (card.about === "transfer" || card.about === "gift")
    ) {
      const money = card.about === "transfer";
      const what = escapeHtml(card.detail || "");
      const who =
        item.role === "user"
          ? ""
          : escapeHtml(item.from || item.character_name || "");
      const got = `${who ? `${who} 님이 ` : ""}${money ? "" : "선물을 "}받았습니다!`;
      const badge =
        '<span class="sv-card-got" aria-hidden="true"><i class="fa-solid fa-check"></i></span>';
      const art = money
        ? `<div class="sv-card-art"><span class="sv-card-coin" aria-hidden="true"><i class="fa-solid fa-coins"></i></span><b>${what}</b>${badge}</div>`
        : `<div class="sv-card-art"><span class="sv-card-bow" aria-hidden="true"><i class="fa-solid fa-gift"></i></span>${badge}</div>`;
      return `<div class="sv-msg-bubble sv-msg-card sv-card-received" data-card="${card.about}" data-card-answered="accept">${art}<div class="sv-card-words"><small><i class="fa-solid fa-circle-check" aria-hidden="true"></i>${money ? "송금 완료" : "선물 전달 완료"}</small>${!money && what ? `<strong>${what}</strong>` : ""}<span>${got}</span></div></div>`;
    }
    if (card?.type === "reply")
      return `<div class="sv-msg-bubble sv-msg-card-answer" data-card-answered="${escapeHtml(card.answer)}"><i class="fa-solid fa-${card.answer === "accept" ? "check" : "xmark"}" aria-hidden="true"></i><span><b>${escapeHtml(card.title || "")}</b>${card.detail ? escapeHtml(card.detail) : ""}</span></div>`;
    const kind = kindOf(card?.type);
    if (!kind) return "";
    const [type, name, icon] = kind;
    const title = escapeHtml(card.title || "");
    const detail = escapeHtml(card.detail || "");
    const art = {
      photo: card.image
        ? `<img class="sv-msg-card-image" src="${escapeHtml(card.image.startsWith("data:") ? card.image : this.apiUrl(card.image))}" alt="${escapeHtml(card.title || card.seen || "보낸 사진")}" loading="lazy">`
        : '<div class="sv-card-art" aria-hidden="true"><span class="sv-card-sun"></span><span class="sv-card-hill"></span><span class="sv-card-hill"></span></div>',
      location: `<div class="sv-card-art" aria-hidden="true">${MAP_ART}</div>`,
      appointment:
        '<div class="sv-card-art" aria-hidden="true"><span class="sv-card-page"><i class="fa-solid fa-calendar-check"></i></span></div>',
      transfer: `<div class="sv-card-art"><span class="sv-card-coin" aria-hidden="true"><i class="fa-solid fa-coins"></i></span><b>${title}</b></div>`,
      gift: '<div class="sv-card-art" aria-hidden="true"><span class="sv-card-bow"><i class="fa-solid fa-gift"></i></span></div>',
      song: '<div class="sv-card-art" aria-hidden="true"><span class="sv-card-disc"><i class="fa-solid fa-music"></i></span></div>',
      video:
        '<div class="sv-card-art" aria-hidden="true"><span class="sv-card-screen"><i class="fa-solid fa-play"></i></span></div>',
      poll: "",
    }[type];
    if (type === "poll") {
      const choices = pollChoices(card);
      const picked = answered.startsWith("pick:") ? answered.slice(5) : "";
      const mine = item.role === "user";
      // Theirs is answered by a tap (it goes out as my text, quoting the card); mine just shows.
      const list = choices
        .map((choice) =>
          !mine && canAnswer && !picked
            ? `<button type="button" data-poll-pick="${escapeHtml(choice)}" data-id="${escapeHtml(item.id)}">${escapeHtml(choice)}</button>`
            : `<span class="${picked === choice ? "sv-poll-picked" : ""}">${picked === choice ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : ""}${escapeHtml(choice)}</span>`,
        )
        .join("");
      return `<div class="sv-msg-bubble sv-msg-card" data-card="poll"><div class="sv-card-words"><small><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${name}</small>${detail ? `<strong>${detail}</strong>` : ""}${card.translation && this.config.phone?.show_translation !== false ? `<em class="sv-card-translation">${escapeHtml(card.translation)}</em>` : ""}</div><div class="sv-card-options">${list}</div></div>`;
    }
    // In Korean under it, when the card came in another language (한국어 번역: 함께 보기).
    const korean =
      card.translation && this.config.phone?.show_translation !== false
        ? `<em class="sv-card-translation">${escapeHtml(card.translation)}</em>`
        : "";
    // Money shows its amount in the picture part; under it, only the note.
    const words =
      type === "transfer"
        ? `<small><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${name}</small>${detail ? `<span>${detail}</span>` : ""}${korean}`
        : `<small><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${name}</small>${title ? `<strong>${title}</strong>` : ""}${detail ? `<span>${detail}</span>` : ""}${korean}`;
    // Answered once, by a button (theirs) or in their reply (mine): the card then says how.
    const answers = cardCanBeAnswered(card) ? CARD_ANSWERS[type] : null;
    // A claim card: who opened it so far and what they found; nothing shows before that.
    const opened = claims || [];
    const among = claimNames(card).length;
    const luck = card.claim
      ? `${
          opened.length
            ? `<ul class="sv-card-shares">${opened
                .map(
                  (row) =>
                    `<li${row.answer === "accept" ? "" : ' class="sv-card-share-none"'}><span>${escapeHtml(row.name)}</span><b>${row.answer === "accept" ? escapeHtml(row.detail) : row.answer === "miss" ? "꽝" : "거절"}</b></li>`,
                )
                .join("")}</ul>`
            : ""
        }<p class="sv-card-winner"><i class="fa-solid fa-dice" aria-hidden="true"></i><span>${type === "transfer" ? "랜덤으로 나눔" : "랜덤 추첨"}</span><b>${opened.length ? `${among}명 중 ${opened.length}명 열어 봄` : "아직 아무도 안 열어 봄"}</b></p>`
      : card.shares?.length
        ? `<ul class="sv-card-shares">${card.shares.map((share) => `<li><span>${escapeHtml(share.name)}</span><b>${escapeHtml(share.amount)}</b></li>`).join("")}</ul>`
        : card.winner
          ? `<p class="sv-card-winner"><i class="fa-solid fa-dice" aria-hidden="true"></i><span>랜덤 당첨</span><b>${escapeHtml(card.winner)}</b></p>`
          : "";
    const foot = !answers
      ? ""
      : answered
        ? `<div class="sv-card-answered" data-answer="${escapeHtml(answered)}"><i class="fa-solid fa-${answered === "decline" ? "xmark" : "check"}" aria-hidden="true"></i>${answers[answered]?.[1] || ""}</div>`
        : canAnswer && item.role !== "user"
          ? `<div class="sv-card-actions">${Object.entries(answers)
              .map(
                ([answer, [label]]) =>
                  `<button type="button" class="${answer === "accept" ? "sv-card-yes" : ""}" data-card-answer="${answer}" data-id="${escapeHtml(item.id)}">${label}</button>`,
              )
              .join("")}</div>`
          : "";
    // A song or video is found by its name (a link a model wrote would be made up).
    const link =
      (type === "song" || type === "video") && card.title
        ? `<div class="sv-card-actions"><a class="sv-card-link" href="https://www.youtube.com/results?search_query=${encodeURIComponent(card.title)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span>유튜브에서 찾기</span></a></div>`
        : "";
    return `<div class="sv-msg-bubble sv-msg-card" data-card="${type}">${art}<div class="sv-card-words">${words}</div>${luck}${foot}${link}</div>`;
  },

  /** The card that answers the other side's card (see CARD_ANSWERS): mine goes out on its own. */
  cardAnswer(item, answer, member = null) {
    const card = item?.card;
    // A claim card opened: the member's own share or prize, or nothing.
    const found =
      card?.claim && answer === "accept"
        ? claimOutcome(card, member?.name)
        : "";
    if (card?.claim && answer === "accept" && !found) answer = "miss";
    const words = CARD_ANSWERS[card?.type]?.[answer];
    if (!words) return null;
    return {
      type: "reply",
      about: card.type,
      answer,
      re: item.id,
      title: words[1],
      detail:
        found ||
        [card.title, card.type === "appointment" ? card.detail : ""]
          .filter(Boolean)
          .join(" / "),
      ...(item.role === "user" ? {} : { solo: true }),
    };
  },

  /**
   * Cards answered so far in a thread: message id → "accept" or "decline"; a pick-one of theirs
   * I answered by a tap → "pick:" and the choice.
   */
  cardAnswers(thread = []) {
    // A claim card is answered by each member in turn (see cardClaims), never as a whole.
    const claim = new Set(
      thread.filter((item) => item.card?.claim).map((item) => item.id),
    );
    const answers = new Map(
      thread
        .filter(
          (item) =>
            item.card?.type === "reply" &&
            item.card.re &&
            !claim.has(item.card.re),
        )
        .map((item) => [item.card.re, item.card.answer]),
    );
    const polls = new Set(
      thread
        .filter((item) => item.card?.type === "poll" && item.role !== "user")
        .map((item) => item.id),
    );
    for (const item of thread)
      if (item.role === "user" && polls.has(item.quote?.id))
        answers.set(item.quote.id, `pick:${item.text}`);
    return answers;
  },

  /**
   * Who opened each claim card so far: message id → [{ key, name, answer, detail }], in the
   * order they did.
   */
  cardClaims(thread = []) {
    const claims = new Map(
      thread.filter((item) => item.card?.claim).map((item) => [item.id, []]),
    );
    for (const item of thread)
      if (item.card?.type === "reply" && claims.has(item.card.re))
        claims.get(item.card.re).push({
          key: item.character_key || "",
          name: item.character_name || "",
          answer: item.card.answer,
          detail: item.card.detail || "",
        });
    return claims;
  },

  /** The members of a claim card who haven't opened it yet (names). */
  claimLeft(item, claims) {
    const done = new Set((claims.get(item.id) || []).map((row) => row.name));
    return claimNames(item.card).filter((name) => !done.has(name));
  },

  /** The emoji left on a text, as chips under it; mine is taken back by a tap. */
  reactionsHtml(item) {
    const list = Array.isArray(item?.reactions) ? item.reactions : [];
    if (!list.length) return "";
    return `<span class="sv-msg-reactions">${list
      .map((reaction) =>
        reaction.by === "user"
          ? `<button type="button" data-react="${escapeHtml(reaction.emoji)}" data-id="${escapeHtml(item.id)}" aria-label="내 반응 ${escapeHtml(reaction.emoji)} 지우기" title="내 반응 · 눌러서 지우기">${escapeHtml(reaction.emoji)}</button>`
          : `<span title="${escapeHtml(reaction.name || "")}">${escapeHtml(reaction.emoji)}${reaction.name && item.thread_key ? `<small>${escapeHtml(reaction.name)}</small>` : ""}</span>`,
      )
      .join("")}</span>`;
  },

  /** A reply's reaction (its `react`: {n, emoji}) to a text that isn't the sender's own. */
  reactionFromReply(parsed, thread = [], sender = "") {
    const item = thread[Number(parsed?.react?.n) - 1];
    const emoji = String(parsed?.react?.emoji || "").trim();
    if (
      !item ||
      !validReaction(emoji) ||
      (item.role !== "user" && item.character_key === sender)
    )
      return null;
    return { id: item.id, emoji };
  },

  /** Leaves (or takes back) an emoji on a text: mine, or a character's own. */
  async reactToMessage(id, emoji, { by = "user", name = "" } = {}) {
    const response = await this.request(
      "/api/plugins/scenevoice/voice-messages/react",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.getStateIdentity().chatId,
          id,
          emoji,
          by,
          name,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json()).detail || "반응을 남기지 못했습니다.",
      );
  },

  /** A card of mine still waiting for their answer is in the thread. */
  hasOpenCard(thread = []) {
    const answers = this.cardAnswers(thread);
    const claims = this.cardClaims(thread);
    return thread.some(
      (item) =>
        item.role === "user" &&
        cardCanBeAnswered(item.card) &&
        (item.card.claim
          ? this.claimLeft(item, claims).length > 0
          : !answers.has(item.id)),
    );
  },

  /** Their reply answers a card of mine (its `card_answer`: {n, answer}), once. */
  cardAnswerFromReply(parsed, thread = [], member = null) {
    const item = thread[Number(parsed?.card_answer?.n) - 1];
    const answer = String(parsed?.card_answer?.answer || "").toLowerCase();
    if (
      !item ||
      item.role !== "user" ||
      !["accept", "decline"].includes(answer)
    )
      return null;
    // A claim card: each member once, and only someone it is shared among.
    if (item.card?.claim)
      return member?.name &&
        this.claimLeft(item, this.cardClaims(thread)).includes(member.name)
        ? this.cardAnswer(item, answer, member)
        : null;
    if (this.cardAnswers(thread).has(item.id)) return null;
    return this.cardAnswer(item, answer);
  },

  /** Whether pictures are sent along with texts (not over a connection known to be text-only). */
  textsSeeImages() {
    const profileId =
      this.config.phone?.connection_profile_id ||
      this.config.connection_profile_id ||
      "";
    return this.connectionService?.seesImages?.(profileId) !== false;
  },

  /** Shrinks a chosen picture and stores it; returns its URL. */
  async uploadCardImage(file) {
    if (!/^image\//.test(file?.type || ""))
      throw new Error("사진 파일을 골라 주십시오.");
    const source = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
        element.src = source;
      });
      let dataUrl = "";
      for (const [side, quality] of IMAGE_STEPS) {
        const scale = Math.min(
          1,
          side / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp"))
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= IMAGE_LIMIT) break;
      }
      if (dataUrl.length > IMAGE_LIMIT)
        throw new Error("사진이 너무 큽니다. 더 작은 사진을 골라 주십시오.");
      const [head, data] = dataUrl.split(",");
      const response = await this.request(
        "/api/plugins/scenevoice/images",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: head.slice(5, head.indexOf(";")),
            data,
          }),
        },
        30000,
      );
      const saved = await response.json();
      if (!response.ok)
        throw new Error(saved.detail || "사진을 저장하지 못했습니다.");
      return saved.url;
    } finally {
      URL.revokeObjectURL(source);
    }
  },

  /**
   * The pictures in the latest messages of a thread, as data URLs for the model (none when it
   * can't see them). `unseen`: for each, its message while nothing is noted of it yet (else null).
   */
  async threadImages(thread = []) {
    const images = [];
    const unseen = [];
    if (!this.textsSeeImages()) return { images, unseen };
    const items = thread
      .slice(-IMAGE_REACH)
      .filter((item) => item.card?.image)
      .slice(-IMAGES_PER_REQUEST);
    for (const item of items) {
      const url = item.card.image;
      const before = images.length;
      if (url.startsWith("data:")) images.push(url);
      else
        await this.readCardImage(url)
          .then((image) => images.push(image))
          .catch((error) =>
            console.warn("[SceneVoice] 첨부 사진을 읽지 못했습니다.", error),
          );
      if (images.length > before)
        unseen.push(item.card.title || item.card.seen ? null : item);
    }
    return { images, unseen };
  },

  /** What the model says it saw in the pictures just shown (photos_seen), kept with their messages. */
  async notePhotosSeen(parsed, unseen = []) {
    const notes = Array.isArray(parsed?.photos_seen) ? parsed.photos_seen : [];
    for (const [index, item] of unseen.entries()) {
      const seen = String(notes[index] ?? "")
        .replace(/[<>\[\]]/g, " ")
        .trim()
        .slice(0, 300);
      if (!item || !seen) continue;
      item.card.seen = seen;
      await this.request(
        `/api/plugins/scenevoice/voice-messages/${encodeURIComponent(item.id)}/seen`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.getStateIdentity().chatId,
            seen,
          }),
        },
      ).catch((error) =>
        console.warn("[SceneVoice] 사진 내용 메모 저장 실패", error),
      );
    }
  },

  /** A file in 실리태번's user files as a data URL, read as it is (not one of this extension's own routes). */
  async readCardImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 16384)
      binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
    // The type goes by the file's name: a server may hand the file over as plain bytes.
    const type =
      { webp: "image/webp", jpg: "image/jpeg", png: "image/png" }[
        url.split(".").pop()
      ] || "image/webp";
    return `data:${type};base64,${btoa(binary)}`;
  },

  /** A card kind switched on or off, from the + menu (saved at once, on every device). */
  async setCardKind(type, on) {
    const next = {
      ...(this.config.voice_message?.cards || {}),
      [type]: Boolean(on),
    };
    const response = await this.request("/api/plugins/scenevoice/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_message: { cards: next } }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || `설정 저장 실패 (${response.status})`);
    this.config = mergeConfig(data.settings || {});
  },

  /**
   * The + tray over the text box: the card kinds to send, one being filled in, or their
   * switches. `tray`: {key, mode: "menu" | "form" | "kinds", type, title, detail, image, busy}.
   */
  cardTrayHtml(key) {
    const tray = this.cardTray?.key === key ? this.cardTray : null;
    if (!tray) return "";
    const on = this.cardKindsOn();
    if (tray.mode === "kinds")
      return `<div class="sv-card-tray" data-card-tray>
          <div class="sv-card-tray-head"><strong>쓸 카드 고르기</strong><button type="button" data-card-close aria-label="닫기" title="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
          <p class="sv-card-tray-note">꺼 둔 카드는 나도 상대도 보내지 않습니다.</p>
          ${CARD_KINDS.map(([type, name, icon]) => `<label class="sv-ph-toggle sv-card-kind"><span><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${name}</span><input type="checkbox" data-card-kind="${type}" ${on.includes(type) ? "checked" : ""}></label>`).join("")}
          <div class="sv-card-tray-actions"><button type="button" data-card-back>돌아가기</button></div>
        </div>`;
    if (tray.mode === "form") {
      const [type, name, icon, first, second] = kindOf(tray.type);
      const photo = type === "photo";
      const currency =
        type === "transfer"
          ? (tray.currency ?? (tray.currency = lastCurrency()))
          : "";
      return `<div class="sv-card-tray" data-card-tray>
          <div class="sv-card-tray-head"><strong><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${name} 보내기</strong><button type="button" data-card-close aria-label="닫기" title="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
          ${
            photo
              ? `<div class="sv-card-photo">${
                  tray.image
                    ? `<img src="${escapeHtml(tray.image.startsWith("data:") ? tray.image : this.apiUrl(tray.image))}" alt="고른 사진"><button type="button" data-card-photo-clear>사진 빼기</button>`
                    : `<label class="sv-card-photo-pick"><input type="file" accept="image/*" data-card-file hidden><i class="fa-solid ${tray.busy ? "fa-spinner fa-spin" : "fa-paperclip"}" aria-hidden="true"></i><span>${tray.busy ? "사진 올리는 중…" : "사진 파일 고르기"}</span></label>`
                }</div><p class="sv-card-tray-note">고른 사진을 AI에게 함께 보냅니다(이미지를 읽는 모델에서만 알아봄). 사진을 고르면 설명은 비워도 됩니다.</p>`
              : ""
          }
          ${
            type === "transfer"
              ? `<div class="sv-card-amount"><select data-card-currency aria-label="통화">${CURRENCIES.map(([code, label]) => `<option value="${code}" ${currency === code ? "selected" : ""}>${label}</option>`).join("")}<option value="" ${currency ? "" : "selected"}>직접 작성</option></select><input type="text" data-card-title maxlength="${currency ? 20 : 240}" ${currency ? 'inputmode="decimal"' : ""} placeholder="${currency ? "금액 (숫자만)" : escapeHtml(first)}" value="${escapeHtml(tray.title || "")}" autocomplete="off" aria-label="금액"></div>`
              : type === "poll"
                ? `<input type="text" data-card-detail maxlength="240" placeholder="${second}" value="${escapeHtml(tray.detail || "")}" autocomplete="off" aria-label="${second}">
                  <div class="sv-poll-edit">${(tray.options ||= ["", ""]).map((option, index) => `<input type="text" data-poll-option="${index}" maxlength="40" placeholder="항목 ${index + 1}" value="${escapeHtml(option)}" autocomplete="off" aria-label="항목 ${index + 1}">`).join("")}</div>
                  <button type="button" class="sv-poll-add" data-poll-add ${tray.options.length >= POLL_MAX ? "disabled" : ""}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>항목 추가</span></button>`
                : type === "gift" && this.isGroupThread(key)
                  ? `<div class="sv-poll-edit">${(tray.items ||= [tray.title || ""]).map((option, index) => `<input type="text" data-gift-item="${index}" maxlength="80" placeholder="${index ? `선물 ${index + 1}` : first}" value="${escapeHtml(option)}" autocomplete="off" aria-label="선물 ${index + 1}">`).join("")}</div>
                  <button type="button" class="sv-poll-add" data-gift-add ${tray.items.length >= this.giftItemsMax(key) ? "disabled" : ""}><i class="fa-solid fa-plus" aria-hidden="true"></i><span>선물 추가 (인원수까지)</span></button>`
                  : `<input type="text" data-card-title maxlength="240" placeholder="${first}" value="${escapeHtml(tray.title || "")}" autocomplete="off" aria-label="${first}">`
          }
          ${second && type !== "poll" ? `<input type="text" data-card-detail maxlength="240" placeholder="${second}" value="${escapeHtml(tray.detail || "")}" autocomplete="off" aria-label="${second}">` : ""}
          ${
            this.isGroupThread(key) && (type === "transfer" || type === "gift")
              ? `<label class="sv-card-random"><input type="checkbox" data-card-random ${tray.random || (tray.items?.length || 0) > 1 ? "checked" : ""} ${(tray.items?.length || 0) > 1 ? "disabled" : ""}><span>${type === "transfer" ? "인물별 금액 랜덤 추첨 (돈 뿌리기)" : (tray.items?.length || 0) > 1 ? "랜덤 추첨 (선물마다 한 명씩)" : "랜덤 추첨 (한 명만 수령)"}</span></label>`
              : ""
          }
          ${type === "song" || type === "video" ? '<p class="sv-card-tray-note">제목을 적습니다. AI는 링크를 열어 볼 수 없어 주소로는 알아보지 못합니다.</p>' : ""}
          <div class="sv-card-tray-actions"><button type="button" data-card-back>돌아가기</button><button type="button" class="sv-card-send" data-card-send ${tray.busy ? "disabled" : ""}>보내기</button></div>
        </div>`;
    }
    return `<div class="sv-card-tray" data-card-tray>
        <div class="sv-card-tray-head"><strong>카드 보내기</strong><button type="button" data-card-kinds aria-label="쓸 카드 고르기" title="쓸 카드 고르기: 안 쓰는 카드를 끕니다"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button><button type="button" data-card-close aria-label="닫기" title="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        ${
          on.length
            ? `<div class="sv-card-menu">${CARD_KINDS.filter(([type]) =>
                on.includes(type),
              )
                .map(
                  ([type, name, icon]) =>
                    `<button type="button" data-card-pick="${type}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${name}</span></button>`,
                )
                .join("")}</div>`
            : '<p class="sv-card-tray-note">모든 카드가 꺼져 있습니다. 오른쪽 위 버튼에서 켤 수 있습니다.</p>'
        }
      </div>`;
  },

  /** Wires the + button, the tray and the quote bar of the open conversation. */
  bindCardTray(body, key, send) {
    const redraw = () => this.renderSmartphone();
    body.querySelector("[data-card-open]")?.addEventListener("click", () => {
      this.cardTray = this.cardTray?.key === key ? null : { key, mode: "menu" };
      redraw();
    });
    body.querySelector("[data-quote-clear]")?.addEventListener("click", () => {
      this.replyTarget = null;
      redraw();
    });
    const box = body.querySelector("[data-card-tray]");
    const tray = this.cardTray;
    if (!box || !tray) return;
    box.querySelector("[data-card-close]")?.addEventListener("click", () => {
      this.cardTray = null;
      redraw();
    });
    box.querySelector("[data-card-kinds]")?.addEventListener("click", () => {
      tray.mode = "kinds";
      redraw();
    });
    box.querySelector("[data-card-back]")?.addEventListener("click", () => {
      this.cardTray = { key, mode: "menu" };
      redraw();
    });
    box.querySelectorAll("[data-card-pick]").forEach((button) =>
      button.addEventListener("click", async () => {
        this.cardTray = {
          key,
          mode: "form",
          type: button.dataset.cardPick,
          title: "",
          detail: "",
          image: "",
        };
        await redraw();
        // The keyboard comes up only where typing was already under way (not on a phone).
        if (!this.isMobilePhoneLayout())
          document.querySelector("[data-card-title]")?.focus();
      }),
    );
    box
      .querySelectorAll("[data-card-kind]")
      .forEach((input) =>
        input.addEventListener("change", () =>
          this.run(() =>
            this.setCardKind(input.dataset.cardKind, input.checked),
          ),
        ),
      );
    box
      .querySelector("[data-card-title]")
      ?.addEventListener("input", (event) => {
        const input = event.target;
        // An amount gets its thousands separators as it is typed (the caret keeps its place);
        // with a currency picked, only the number can be typed.
        if (tray.type === "transfer") {
          const digits = (text) => (tray.currency ? onlyNumber(text) : text);
          const kept = digits(
            input.value.slice(0, input.selectionStart ?? input.value.length),
          ).replace(/,/g, "").length;
          const grouped = groupDigits(digits(input.value));
          if (grouped !== input.value) {
            input.value = grouped;
            let at = 0;
            for (let seen = 0; at < grouped.length && seen < kept; at += 1)
              if (grouped[at] !== ",") seen += 1;
            input.setSelectionRange?.(at, at);
          }
        }
        tray.title = input.value;
      });
    box
      .querySelector("[data-card-random]")
      ?.addEventListener(
        "change",
        (event) => (tray.random = event.target.checked),
      );
    box
      .querySelector("[data-card-detail]")
      ?.addEventListener(
        "input",
        (event) => (tray.detail = event.target.value),
      );
    box.querySelector("[data-card-file]")?.addEventListener("change", (event) =>
      this.run(async () => {
        const file = event.target.files?.[0];
        if (!file) return;
        tray.busy = true;
        await redraw();
        try {
          tray.image = await this.uploadCardImage(file);
        } finally {
          tray.busy = false;
          await redraw();
        }
      }),
    );
    box
      .querySelector("[data-card-photo-clear]")
      ?.addEventListener("click", () => {
        tray.image = "";
        redraw();
      });
    box
      .querySelector("[data-card-currency]")
      ?.addEventListener("change", (event) => {
        tray.currency = event.target.value;
        keepCurrency(tray.currency);
        // A number typed so far stays; words typed in 직접 작성 don't fit a currency.
        if (tray.currency)
          tray.title = groupDigits(onlyNumber(String(tray.title || "")));
        redraw();
      });
    box.querySelectorAll("[data-poll-option]").forEach((input) =>
      input.addEventListener("input", () => {
        tray.options[Number(input.dataset.pollOption)] = input.value;
      }),
    );
    box
      .querySelector("[data-poll-add]")
      ?.addEventListener("click", async () => {
        if (tray.options.length >= POLL_MAX) return;
        tray.options.push("");
        await redraw();
        if (!this.isMobilePhoneLayout())
          document
            .querySelector(`[data-poll-option="${tray.options.length - 1}"]`)
            ?.focus();
      });
    box.querySelectorAll("[data-gift-item]").forEach((input) =>
      input.addEventListener("input", () => {
        tray.items[Number(input.dataset.giftItem)] = input.value;
      }),
    );
    box
      .querySelector("[data-gift-add]")
      ?.addEventListener("click", async () => {
        if (tray.items.length >= this.giftItemsMax(key)) return;
        tray.items.push("");
        await redraw();
        if (!this.isMobilePhoneLayout())
          document
            .querySelector(`[data-gift-item="${tray.items.length - 1}"]`)
            ?.focus();
      });
    const submit = () => {
      // 선물 여러 개 (a group): kept in the title one after another, like a poll's choices.
      const gifts =
        tray.type === "gift" && tray.items
          ? tray.items
              .map((item) =>
                String(item)
                  .trim()
                  .replace(/\s*\/\s*/g, "·"),
              )
              .filter(Boolean)
          : null;
      if (gifts) tray.title = gifts.join(" / ").slice(0, 240);
      // 투표: its choices are kept in the title, one after another (a slash inside one would part it).
      if (tray.type === "poll") {
        const choices = (tray.options || [])
          .map((option) =>
            String(option)
              .trim()
              .replace(/\s*\/\s*/g, "·"),
          )
          .filter(Boolean);
        if (choices.length < 2)
          return this.notify("항목을 두 개 이상 적어 주십시오.", "info");
        tray.title = choices.join(" / ").slice(0, 240);
      }
      const typed = String(tray.title || "").trim();
      const title =
        tray.type === "transfer" && tray.currency && typed
          ? (
              CURRENCIES.find(([code]) => code === tray.currency)?.[2] ||
              ((amount) => amount)
            )(typed)
          : typed;
      const detail = String(tray.detail || "").trim();
      const second = kindOf(tray.type)[4];
      if (!title && !tray.image)
        return this.notify("보낼 내용을 적어 주십시오.", "info");
      if (tray.type === "appointment" && !detail)
        return this.notify("약속 시간을 적어 주십시오.", "info");
      // 랜덤으로 나누기 (a group only): the dice are rolled here, once, and kept with the card,
      // unseen until the members open it (claim).
      const luck = {};
      if (
        (tray.random || (gifts?.length || 0) > 1) &&
        this.isGroupThread(key)
      ) {
        const names = (this.messageGroup(key)?.members || []).map(
          (member) => this.memberContact(member).name,
        );
        if (tray.type === "transfer") {
          luck.shares = randomShares(title, names);
          if (!luck.shares)
            return this.notify(
              "랜덤으로 나누려면 금액을 숫자로, 인원수 이상으로 적어 주십시오.",
              "info",
            );
          luck.claim = true;
        } else if (tray.type === "gift" && names.length) {
          const drawn = [...names];
          for (let at = drawn.length - 1; at > 0; at -= 1) {
            const other = Math.floor(Math.random() * (at + 1));
            [drawn[at], drawn[other]] = [drawn[other], drawn[at]];
          }
          luck.prizes = (gifts?.length ? gifts : [title])
            .slice(0, names.length)
            .map((item, index) => ({ name: drawn[index], item }));
          luck.among = names;
          luck.claim = true;
        }
      }
      this.cardTray = null;
      send({
        type: tray.type,
        title,
        detail: second ? detail : "",
        ...(tray.image ? { image: tray.image } : {}),
        ...luck,
      });
    };
    box.querySelector("[data-card-send]")?.addEventListener("click", submit);
    box.querySelectorAll("input[type=text]").forEach((input) =>
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          submit();
        }
      }),
    );
  },
};
