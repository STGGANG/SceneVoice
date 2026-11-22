/**
 * A line's words with every mark that means the same written one way, to tell whether two lines
 * are the same line whatever wrote their marks (a theme's or an extension's auto-correct, a
 * regex script, the way the chat is drawn). Full-width forms become plain ones; quotes of any
 * shape, dashes of any length and every way to write an ellipsis each become one mark; spacing
 * is left out. Only for comparing: nothing shown or spoken comes from it.
 */
export function looseWords(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[“”„‟〝〞«»「」『』]/g, '"')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/。/g, ".")
    .replace(/、/g, ",")
    .replace(/⋯/g, "...")
    .replace(/[·・]{2,}/g, "...")
    .replace(/\.{2,}/g, "...")
    .replace(/[‐‑‒–—―─━−-]+/g, "-")
    .replace(/[〜∼]/g, "~")
    .replace(/\s+/g, "");
}
