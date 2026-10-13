// 음성 전달: a past call or a voice message passed on to someone in their text thread, with a note
// if I like (never a voice memo: it is the character's own secret). It arrives as a forwarded
// card (its voice plays from it when it has one), and they answer having just heard it.
import { escapeHtml } from "./common.js";

const KIND_LABEL = { call: "통화", voice: "음성 메시지", memo: "음성 메모" };

export const forward = {
  /** The forwarded card at the top of my message: what it is, its first lines, ▶ for its voice. */
  forwardCardHtml(item, playing = "") {
    const sent = item?.forward;
    if (!sent) return "";
    const lines = sent.lines.slice(0, 3);
    return `<div class="sv-msg-bubble sv-msg-forward">
        <small><i class="fa-solid fa-share" aria-hidden="true"></i>전달한 ${escapeHtml(KIND_LABEL[sent.type] || "녹음")} · ${escapeHtml(sent.title)}</small>
        ${lines.map((line) => `<p><b>${escapeHtml(line.from)}</b> ${escapeHtml(line.text)}</p>`).join("")}${
          sent.lines.length > lines.length ? `<p class="sv-msg-forward-more">외 ${sent.lines.length - lines.length}줄</p>` : ""
        }
        ${
          item.audio_url
            ? `<button type="button" class="sv-msg-forward-play sv-msg-play${playing}" data-id="${escapeHtml(item.id)}" aria-label="전달한 음성 재생" title="재생"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
            : ""
        }
      </div>`;
  },

  shareVoiceMessage(item) {
    return this.shareRecording({
      type: "voice",
      title: `${item.character_name || ""}의 음성 메시지`,
      lines: [{ from: item.character_name || "", text: item.text }],
      source_id: item.id,
      audio: item.audio_filename || "",
      skip: item.character_key,
    });
  },

  shareCall(session) {
    const me = this.userCharacterName?.() || "나";
    return this.shareRecording({
      type: "call",
      title: `${this.callNames(session).join(", ")} 통화`,
      lines: (session.turns || []).map((turn) => ({
        from: turn.role === "user" ? me : turn.speaker_name || session.character_name || "",
        text: turn.text,
      })),
      source_id: session.id,
      audio: "",
    });
  },

  /** Asks who gets it (and a note), sends it, and opens their conversation for the answer. */
  async shareRecording({ skip = "", audio = "", ...sent }) {
    const people = this.phoneContacts().filter((contact) => !contact.group);
    if (!people.length) throw new Error("들려줄 연락처가 없습니다.");
    const picked = await this.openShareSheet(sent, people, skip);
    if (!picked) return;
    const note = picked.note.trim().slice(0, 1000);
    await this.sendTextMessage(picked.key, note || sent.title, "", {
      forward: { ...sent, ...(note ? { note: true } : {}) },
      ...(audio ? { audio_filename: audio } : {}),
    });
    this.messageThreadKey = picked.key;
    this.phoneActiveTab = "message";
    await this.renderSmartphone();
  },

  /** A sheet over the phone screen: to whom, and a note. Resolves with {key, note}, or null. */
  openShareSheet(sent, people, skip = "") {
    const screen = document.querySelector("#sv-smartphone .sv-phone-screen");
    if (!screen) return Promise.resolve(null);
    screen.querySelector(".sv-ph-sheet")?.remove();
    const first = people.find((person) => person.key !== skip) || people[0];
    const sheet = document.createElement("div");
    sheet.className = "sv-ph-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "공유");
    sheet.innerHTML = `
      <form class="sv-ph-sheet-card sv-share-sheet">
        <strong>들려주기</strong>
        <p class="sv-share-what"><i class="fa-solid fa-share" aria-hidden="true"></i>${escapeHtml(KIND_LABEL[sent.type] || "녹음")} · ${escapeHtml(sent.title)}</p>
        <label class="sv-room-name"><span>누구에게</span><select name="key">${people
          .map((person) => `<option value="${escapeHtml(person.key)}" ${person.key === first.key ? "selected" : ""}>${escapeHtml(person.name)}</option>`)
          .join("")}</select></label>
        <textarea name="note" rows="2" maxlength="1000" placeholder="같이 보낼 말 (비워도 됩니다)" aria-label="같이 보낼 말"></textarea>
        <small>그 사람 문자방으로 보내고, 들은 뒤 답장이 옵니다.</small>
        <div class="sv-contact-edit-actions"><button type="button" data-share-cancel>취소</button><button type="submit" class="sv-contact-save">보내기</button></div>
      </form>`;
    screen.append(sheet);
    const form = sheet.querySelector("form");
    return new Promise((resolve) => {
      const close = (value) => {
        sheet.remove();
        resolve(value);
      };
      sheet.querySelector("[data-share-cancel]").addEventListener("click", () => close(null));
      sheet.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close(null);
        }
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.unlockAudioForMobile();
        close({ key: form.elements.key.value, note: form.elements.note.value });
      });
    });
  },
};
