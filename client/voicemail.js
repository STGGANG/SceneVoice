// 음성사서함 (내가 건 전화): with state tracking on, a call to someone busy goes to their voicemail:
// their greeting (written once by the helper model and kept), a beep, and what I leave, if
// anything. A few minutes later they get back to me by text or call, unless I call again first
// (then they pick up).
import { escapeHtml, mergeConfig } from "./common.js";
import { dataBlock, phoneMessages, voicemailGreetingFinal, voicemailGreetingSystem } from "./prompts.js";
import { wavBlob } from "./wav.js";

// They get back to me this long after the call (a random point in it).
const ANSWER_AFTER_MS = [120000, 300000];

export const voicemail = {
  /** A call to this person goes to voicemail now: state tracking on, and their state says busy. */
  async callGoesToVoicemail(contact) {
    if (!this.config.state_tracking?.enabled || !contact?.key) return false;
    const entry = this.config.character_voices?.[contact.key];
    if (entry?.persona || entry?.no_state) return false;
    // Called again before they got back: this time they pick up.
    if (this.voicemailAnswers?.has(contact.key)) {
      this.cancelVoicemailAnswer(contact.key);
      return false;
    }
    const found = await this.stateForPrompt(contact.key).catch(() => null);
    if (!found?.unknown) return found?.state?.contact?.availability === "busy";
    // 행방 모름 (out of the scene, nowhere named): the availability last saved, as the state tab
    // shows it (a hand-set 바쁨 included), still counts.
    const person = this.statePeople?.().find((item) => item.key === contact.key);
    const record = person ? await this.loadPersonState(person).catch(() => null) : null;
    return record?.state?.contact?.availability === "busy";
  },

  /** Opens their voicemail on the call screen: greeting, beep, then what I may leave. */
  async openVoicemailBox(contact) {
    const box = (this.voicemailBox = { contact, stage: "connecting", greeting: null, text: "", saving: false });
    this.phoneActiveTab = "call";
    await this.renderSmartphone();
    try {
      box.greeting = await this.voicemailGreeting(contact).catch((error) => {
        console.warn("[SceneVoice] voicemail greeting failed", error);
        return null;
      });
      if (this.voicemailBox !== box) return;
      box.stage = "greeting";
      await this.renderSmartphone();
      await this.playVoicemailGreeting(box);
      if (this.voicemailBox !== box) return;
      await this.voicemailBeep();
    } finally {
      if (this.voicemailBox === box && box.stage !== "record") {
        box.stage = "record";
        await this.renderSmartphone();
      }
    }
  },

  /** Their greeting: kept with the person once written; written now only the first time. */
  async voicemailGreeting(contact) {
    const saved = this.config.character_voices?.[contact.key]?.voicemail_greeting;
    if (saved?.text) return saved;
    const profileId = this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService) return null;
    const language = this.conversationLanguage([], "", contact.key);
    const translation = this.wantsTranslation(language);
    const messages = phoneMessages(
      voicemailGreetingSystem({
        emotions: Array.from(this.analysisEmotionCandidates()).sort(),
        language,
        translation,
      }),
      [
        dataBlock("target_character", contact.name),
        dataBlock("profile", this.phoneRoleplayProfile()),
        dataBlock("performance_note", contact.note || "", { range: this.emotionalRange(contact.key) }),
      ],
      voicemailGreetingFinal(contact.name, language),
    );
    const draft = this.normalizePhoneDraft(await this.requestSpokenReply(profileId, messages, 400));
    if (!draft.text) return null;
    const greeting = {
      text: draft.text,
      script: draft.script,
      language: draft.language || language,
      translation: draft.translation || "",
    };
    await this.keepVoicemailGreeting(contact, greeting);
    return greeting;
  },

  async keepVoicemailGreeting(contact, greeting) {
    const voices = structuredClone(this.config.character_voices || {});
    voices[contact.key] = { ...(voices[contact.key] || { name: contact.name }), voicemail_greeting: greeting };
    const response = await this.request("/api/plugins/scenevoice/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_voices: voices }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `인사말 저장 실패 (${response.status})`);
    this.config = mergeConfig(data.settings || {});
    // An open settings window saving its drafts later keeps it too.
    if (this.voiceDraft?.[contact.key]) this.voiceDraft[contact.key].voicemail_greeting = greeting;
  },

  /** The greeting in their voice, through the phone sound; done when it ends (or can't be made). */
  async playVoicemailGreeting(box) {
    const { contact, greeting } = box;
    if (!greeting) return;
    const session = {
      chat_id: this.currentChatId(),
      anchor_message_id: "voicemail",
      character_key: contact.key,
      character_name: contact.name,
    };
    const line = { role: "character", text: greeting.text, script: greeting.script, language: greeting.language, turn_index: 0, intensity: 0.4 };
    let voice;
    try {
      voice = await this.speakPhoneLine(session, line);
    } catch (error) {
      console.warn("[SceneVoice] voicemail greeting voice failed", error);
      return;
    }
    if (this.voicemailBox !== box) return;
    const url = this.createAudioUrl(voice.mixed?.blob || voice.blob);
    await new Promise((resolve) =>
      this.playWithSounds(url, line.script, null, true, {
        mixed: Boolean(voice.mixed),
        communicationFilter: this.shouldApplyCommunicationFilter("phone"),
        onEnded: resolve,
        onStop: resolve,
      }),
    );
  },

  /** 삐: a short tone before the recording, played like any other line (unlocked on phones). */
  voicemailBeep() {
    const rate = 22050;
    const samples = new Float32Array(Math.round(rate * 0.45));
    for (let i = 0; i < samples.length; i++) {
      const fade = Math.min(1, i / 300, (samples.length - i) / 300);
      samples[i] = 0.25 * fade * Math.sin((2 * Math.PI * 1000 * i) / rate);
    }
    const url = this.createAudioUrl(wavBlob(samples, rate));
    return new Promise((resolve) => {
      this.playWithSounds(url, "", null, true, { onEnded: resolve, onStop: resolve });
      // A beep that never sounds (blocked audio) doesn't hold the recording back.
      setTimeout(resolve, 1500);
    });
  },

  renderVoicemailBox(body) {
    const box = this.voicemailBox;
    const { contact, greeting, stage } = box;
    const state = {
      connecting: "연결하는 중…",
      greeting: "음성사서함",
      record: "삐— 메시지를 남겨 주십시오",
    }[stage];
    body.innerHTML = `
      <div class="sv-call-screen sv-voicemail-box" data-phone-wallpaper>
        <div class="sv-call-identity">
          ${this.contactAvatarMarkup(contact)}
          <h2>${escapeHtml(contact.name)}</h2>
          <span class="sv-call-state"><i class="fa-solid fa-voicemail" aria-hidden="true"></i><span>${state}</span></span>
        </div>
        <div class="sv-call-live-line">${
          stage === "connecting"
            ? '<div class="sv-call-thinking"><span class="sv-typing" aria-hidden="true"><i></i><i></i><i></i></span><span>전화를 받지 않습니다</span></div>'
            : `<div class="sv-call-caption"><small>${escapeHtml(contact.name)} · 음성사서함</small><p>${escapeHtml(greeting?.text || "지금은 전화를 받을 수 없습니다.")}</p>${greeting ? this.translationHtml(greeting) : ""}</div>`
        }</div>
        ${
          stage === "record"
            ? `<form class="sv-call-compose sv-voicemail-compose">
                 <textarea id="sv-voicemail-text" rows="1" maxlength="2000" placeholder="남길 말 (안 남기고 끊어도 됩니다)" aria-label="음성사서함에 남길 말" ${box.saving ? "disabled" : ""}>${escapeHtml(box.text)}</textarea>
                 <button type="submit" aria-label="남기기" title="남기기" ${box.saving ? "disabled" : ""}><i class="fa-solid ${box.saving ? "fa-spinner fa-spin" : "fa-arrow-up"}" aria-hidden="true"></i></button>
               </form>`
            : ""
        }
        <div class="sv-call-controls"><button type="button" class="sv-call-end" data-voicemail-end aria-label="끊기" ${box.saving ? "disabled" : ""}><i class="fa-solid fa-phone-slash" aria-hidden="true"></i></button><small>끊기</small></div>
      </div>`;
    const field = body.querySelector("#sv-voicemail-text");
    field?.addEventListener("input", () => {
      box.text = field.value;
    });
    field?.focus({ preventScroll: true });
    body.querySelector(".sv-voicemail-compose")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.run(() => this.closeVoicemailBox(box.text));
    });
    body.querySelector("[data-voicemail-end]")?.addEventListener("click", () => this.run(() => this.closeVoicemailBox("")));
  },

  /**
   * Hangs up: the call is kept as one they didn't pick up, with what I left (in my persona's
   * voice when there is one); either way they know I called and get back to me later.
   */
  async closeVoicemailBox(left = "") {
    const box = this.voicemailBox;
    if (!box || box.saving) return;
    if (box.stage !== "record") this.stopPlayback?.();
    box.saving = true;
    await this.renderSmartphone();
    const text = String(left || "").trim().slice(0, 2000);
    let session = null;
    try {
      const anchor = this.currentPhoneAnchor();
      const response = await this.request("/api/plugins/scenevoice/phone/voicemail-left", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.getStateIdentity().chatId,
          anchor_message_id: String(anchor.index),
          ...this.anchorStamp(anchor.index),
          character_key: box.contact.key,
          character_name: box.contact.name,
          text,
          language: this.scriptLanguage(text) || this.chatLanguage(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `음성사서함 저장 실패 (${response.status})`);
      session = data.session;
      await this.persistPhoneSessionToMessage(session);
    } finally {
      if (this.voicemailBox === box) this.voicemailBox = null;
      this.phoneActiveTab = "history";
      await this.renderSmartphone();
    }
    // My message in my persona's voice, made now so it's ready in 통화 기록.
    const mine = session?.turns?.[0];
    if (mine && this.personaVoiceReady())
      this.makePhoneTurnAudio(session, mine).catch((error) => console.warn("[SceneVoice] voicemail voice failed", error));
    this.answerVoicemailLater(box.contact, text);
  },

  /** In a few minutes they text or call back about it, unless I reach them before then. */
  answerVoicemailLater(contact, left) {
    this.voicemailAnswers ||= new Map();
    this.cancelVoicemailAnswer(contact.key);
    const operation = this.captureChat();
    const [least, most] = ANSWER_AFTER_MS;
    const timer = setTimeout(() => {
      if (this.voicemailAnswers.get(contact.key) !== timer) return;
      this.voicemailAnswers.delete(contact.key);
      if (operation.signal.aborted) return;
      this.run(() => this.answerVoicemail(contact, left));
    }, least + Math.random() * (most - least));
    this.voicemailAnswers.set(contact.key, timer);
  },

  cancelVoicemailAnswer(key) {
    const timer = this.voicemailAnswers?.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.voicemailAnswers.delete(key);
  },

  /** They get back to me: a call when their calls are on and the line is free, else a text. */
  async answerVoicemail(contact, left) {
    const me = this.userCharacterName();
    const reason = left
      ? `${me} called while they were busy and couldn't pick up, and left a voicemail: "${left.replace(/\s+/g, " ").slice(0, 300)}". Now they get back to ${me} about it.`
      : `${me} called while they were busy and couldn't pick up (no message left). Now they get back to ${me}.`;
    const free = !this.phoneSession && !this.phonePendingEvent && !this.voicemailBox;
    if (this.autoCallOn() && free && Math.random() < 0.5) {
      await this.ringIncomingCall(
        { candidate: { type: "incoming_call", urgency: "normal", reason }, callerKey: contact.key, caller: contact.name },
        "",
      );
      return;
    }
    if (!this.phoneOn()) return;
    this.incomingTexts.push({
      type: "text_message",
      urgency: "normal",
      reason,
      callerKey: contact.key,
      sourceMessageId: "",
      createdAt: new Date().toISOString(),
    });
    await this.drainIncomingTexts();
  },
};
