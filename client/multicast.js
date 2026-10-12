// MultiCast TTS (another chat TTS extension) side by side with SceneVoice. Only its public
// window.MultiCastTTS (apiVersion 1) is used:
// - whoever starts playing last is heard (the other one stops);
// - MultiCast's auto play waits while a call rings or goes on, and while 음성 준비 reads;
// - the smartphone sits in MultiCast's quick menu too;
// - its cast is kept in step with the people here (캐릭터별 목소리 → MultiCast 출연진 자동 연동);
// - its sound files go into calls and voice messages (when it shares them: listSfx / sfxAudio),
//   following its own 겹쳐 재생 setting and 🔁 sounds (sfxOverlay, { loop } per sound).
import { contentKey } from "../shared/hash.js";
import { personNames, globalUsedIn, rangeStep } from "../shared/casting.js";
import { mergeConfig } from "./common.js";
import { wavBlob, blobBase64 } from "./wav.js";

// A phone line's sound-effect tag, and the tags ahead of its first word.
const SOUND_TAG = /\[sfx:\s*([^\]]+)\]/gi;
const leadingTags = (text) => /^(?:\s*\[[^\]]*\])*/.exec(text)[0].length;
const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

const QUICK_ACTION = "scenevoice-phone";
// MultiCast's temperaments and the emotional range each stands for (its own table).
const TEMPER_RANGE = { calm: 2, hot: 5, cold: 1, gentle: 2, cheerful: 4, shy: 2, playful: 3 };
const HOLDS = ["scenevoice-call", "scenevoice-reading"];

// MultiCast's 🔁 loudness when one, two or three loops play together.
const BED_GAIN = [1, 0.8, 0.65];

export const multicast = {
  multicastApi() {
    const api = window.MultiCastTTS;
    return api && Number(api.apiVersion) >= 1 ? api : null;
  },

  /** Hooks in now, or when MultiCast says it is ready (it may load after SceneVoice). */
  bindMultiCast() {
    const attach = () => {
      const api = this.multicastApi();
      if (!api || this.multicastAttached) return;
      this.multicastAttached = true;
      // MultiCast starts playing: what SceneVoice plays stops (a call goes on, only its voice stops).
      const started = () => {
        if (this.currentAudio) this.stopPlayback();
      };
      api.on?.("playstart", started);
      // A change to its cast (when MultiCast tells) is brought in at once.
      const changed = () => {
        clearTimeout(this.multicastCastTimer);
        this.multicastCastTimer = setTimeout(() => this.run(() => this.syncMultiCastCast()), 400);
      };
      api.on?.("castchange", changed);
      this.eventCleanups.push(() => {
        api.off?.("playstart", started);
        api.off?.("castchange", changed);
      });
      this.syncMultiCast();
      this.run(() => this.syncMultiCastCast());
    };
    attach();
    if (!this.multicastAttached)
      document.addEventListener("multicast:ready", attach, {
        once: true,
        signal: this.lifetimeController?.signal,
      });
  },

  /** MultiCast's sounds, when it shares them: [{ name, words }], or null. */
  multicastSounds() {
    const api = this.multicastApi();
    if (!this.multicastAttached || typeof api?.listSfx !== "function" || typeof api?.sfxAudio !== "function")
      return null;
    try {
      const list = api.listSfx();
      return Array.isArray(list) && list.length ? list : null;
    } catch {
      return null;
    }
  },

  /**
   * The names of those sounds for the phone prompts: { mine, library }, the user's own sounds
   * (which MultiCast itself prefers) apart from its bundled ones; up to 40 in all.
   */
  soundChoices() {
    const names = (sounds) => [
      ...new Set(
        sounds.flatMap((sound) =>
          (Array.isArray(sound?.words) && sound.words.length ? sound.words : [sound?.name])
            .map((word) => String(word || "").trim())
            .filter((word) => word && !word.startsWith("~")),
        ),
      ),
    ];
    const all = this.multicastSounds() || [];
    const mine = names(all.filter((sound) => sound?.mine)).slice(0, 20);
    const library = names(all.filter((sound) => !sound?.mine))
      .filter((name) => !mine.includes(name))
      .slice(0, 40 - mine.length);
    return { mine, library };
  },

  /** Every sound name there is (for the settings hint). */
  soundNames() {
    const { mine, library } = this.soundChoices();
    return [...mine, ...library];
  },

  /**
   * The sound for a tag ("door slam"): { url, blob, loop } (loop: one of the user's 🔁 sounds
   * that runs quietly under the voice), or null when MultiCast has none. Kept per tag.
   */
  // A step that never settles (a sound fetched or decoded on a phone) would keep the voice waiting
  // forever; past this the line plays with its sounds around it instead.
  soundFor(tag) {
    const api = this.multicastApi();
    const key = String(tag || "").trim().toLowerCase();
    if (!key || typeof api?.sfxAudio !== "function") return Promise.resolve(null);
    this.soundFiles ||= new Map();
    if (!this.soundFiles.has(key))
      this.soundFiles.set(
        key,
        Promise.resolve()
          .then(() => Promise.race([api.sfxAudio(`[${key}]`), wait(8000).then(() => null)]))
          .then(async (answer) => {
            // A file, a same-origin URL, or { blob, loop }.
            const given = answer?.blob instanceof Blob ? answer.blob : answer;
            const blob =
              given instanceof Blob
                ? given
                : typeof given === "string" && given
                  ? await fetch(given).then((response) => (response.ok ? response.blob() : null))
                  : null;
            return blob ? { url: URL.createObjectURL(blob), blob, loop: Boolean(answer?.loop) } : null;
          })
          .catch(() => null)
          .then((found) => {
            // Not found is asked again next time: a sound added (or 🔞 switched on) in MultiCast.
            if (!found) this.soundFiles?.delete(key);
            return found;
          }),
      );
    return this.soundFiles.get(key);
  },

  /**
   * MultiCast 확장's ElevenLabs settings for SceneVoice to use (getVoiceSettings, when its version
   * offers it and it is switched on): { model, stability, similarity_boost, style, speed }, or null.
   */
  multicastVoiceSettings() {
    const api = this.multicastApi();
    if (!this.multicastAttached || typeof api?.getVoiceSettings !== "function") return null;
    try {
      if (api.isEnabled?.() === false) return null;
      const given = api.getVoiceSettings();
      if (!given || typeof given !== "object") return null;
      return {
        model: given.model,
        stability: given.stability,
        similarity_boost: given.similarity_boost ?? given.similarity,
        style: given.style,
        speed: given.speed,
      };
    } catch {
      return null;
    }
  },

  /** The phone's voices follow MultiCast 확장's settings: it offers them and the chat isn't read here. */
  followsMultiCastEngine() {
    return this.chatVoiceOn?.() === false && Boolean(this.multicastVoiceSettings());
  },

  /** MultiCast's 효과음을 대사랑 겹쳐서 재생: a sound starts and the voice comes in right away. */
  soundOverlay() {
    try {
      return Boolean(this.multicastApi()?.sfxOverlay?.());
    } catch {
      return false;
    }
  },

  /**
   * A phone line's voice with its sounds mixed in, as MultiCast plays them: sounds ahead of the
   * first word, then the voice (at once when 겹쳐 재생 is on), then the rest; 🔁 sounds quietly
   * under the voice, fading out after it. { blob (WAV), sounds, overlay } or null without sounds.
   */
  async mixLineSounds(voice, script) {
    const text = String(script || "");
    const lead = leadingTags(text);
    const sounds = [];
    for (const match of text.matchAll(SOUND_TAG)) {
      const sound = await this.soundFor(match[1]);
      if (sound) sounds.push({ ...sound, name: match[1].trim(), before: match.index < lead });
    }
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!sounds.length || !Offline) return null;
    const rate = 32000;
    const decoder = new Offline(1, 1, rate);
    const decode = async (blob) => {
      const bytes = await blob.arrayBuffer();
      const decoded = await Promise.race([
        new Promise((resolve, reject) => decoder.decodeAudioData(bytes, resolve, reject)),
        wait(8000),
      ]);
      if (!decoded) throw new Error("decoding took too long");
      return decoded;
    };
    const speech = await decode(voice);
    for (const sound of sounds) sound.buffer = await decode(sound.blob);
    // As MultiCast plays and saves them: a sound in turn waits its place (a short breath around
    // the voice); with 겹쳐 재생 it starts at 85% and the voice comes in at once; 🔁 sounds loop
    // at 30% under the voice (softer the more there are, three at most) and fade out over 1.8 s.
    const overlay = this.soundOverlay();
    const gap = 0.15;
    const plan = [];
    let at = 0;
    const once = sounds.filter((sound) => !sound.loop);
    for (const sound of once.filter((item) => item.before)) {
      plan.push({ buffer: sound.buffer, at, gain: overlay ? 0.85 : 1 });
      if (!overlay) at += sound.buffer.duration + gap;
    }
    plan.push({ buffer: speech, at });
    const voiceEnd = at + speech.duration;
    at = voiceEnd;
    for (const sound of once.filter((item) => !item.before)) {
      if (overlay) {
        plan.push({ buffer: sound.buffer, at, gain: 0.85 });
        continue;
      }
      plan.push({ buffer: sound.buffer, at: at + gap });
      at += gap + sound.buffer.duration;
    }
    const loops = sounds.filter((sound) => sound.loop).slice(0, BED_GAIN.length);
    for (const sound of loops)
      plan.push({ buffer: sound.buffer, at: 0, loop: true, until: voiceEnd, gain: 0.3 * BED_GAIN[loops.length - 1] });
    const total = Math.max(...plan.map((part) => (part.loop ? part.until + 1.9 : part.at + part.buffer.duration)));
    const mixer = new Offline(1, Math.ceil(total * rate), rate);
    for (const part of plan) {
      const source = mixer.createBufferSource();
      source.buffer = part.buffer;
      const gain = mixer.createGain();
      gain.gain.value = part.gain ?? 1;
      source.connect(gain).connect(mixer.destination);
      source.start(part.at);
      if (part.loop) {
        source.loop = true;
        gain.gain.setValueAtTime(0, part.at);
        gain.gain.setTargetAtTime(part.gain, part.at, 0.12);
        gain.gain.setTargetAtTime(0, part.until, 1.8 / 4);
        source.stop(part.until + 1.9);
      }
    }
    const mixed = await mixer.startRendering();
    return { blob: wavBlob(mixed.getChannelData(0), rate), sounds: sounds.map((sound) => sound.name), overlay };
  },

  /**
   * The voice just made for a phone line, with its sounds mixed in and saved in its place:
   * { blob, id, filename }, or null (no sounds, or mixing failed: then they play around it).
   */
  async mixedLine(voice, script, generationId) {
    if (!generationId || !/\[sfx:/i.test(script || "") || !this.multicastSounds()) return null;
    try {
      const mix = await Promise.race([this.mixLineSounds(voice, script), wait(20000).then(() => null)]);
      if (!mix) return null;
      const response = await this.request("/api/plugins/scenevoice/audio/mix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation_id: generationId,
          data: await blobBase64(mix.blob),
          sounds: mix.sounds,
          overlay: mix.overlay,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `효과음 저장 실패 (${response.status})`);
      return { blob: mix.blob, id: data.id, filename: data.audio_filename };
    } catch (error) {
      console.warn("[SceneVoice] sound effects not mixed in", error);
      return null;
    }
  },

  /** SceneVoice is about to play: MultiCast stops first. */
  quietMultiCast() {
    const api = this.multicastApi();
    try {
      if (api?.isPlaying?.()) api.stop();
    } catch (error) {
      console.warn("[SceneVoice] MultiCast stop failed", error);
    }
  },

  /** Holds MultiCast's auto play as needed, and shows or hides the phone in its quick menu. */
  syncMultiCast() {
    const api = this.multicastApi();
    if (!api || !this.multicastAttached) return;
    const wanted = {
      "scenevoice-call":
        ["ringing", "active"].includes(this.phoneSession?.status) ||
        this.phonePendingEvent?.type === "incoming_call",
      "scenevoice-reading": Boolean(this.messageJobs?.size),
    };
    this.multicastHolds ||= new Set();
    try {
      for (const reason of HOLDS) {
        const on = this.isActive() && wanted[reason];
        if (on === this.multicastHolds.has(reason)) continue;
        if (on) {
          api.holdAutoPlay?.(reason);
          this.multicastHolds.add(reason);
        } else {
          api.releaseAutoPlay?.(reason);
          this.multicastHolds.delete(reason);
        }
      }
      const menu = this.phoneOn() && this.backendConnected;
      if (menu !== Boolean(this.multicastMenu)) {
        if (menu)
          api.addQuickAction?.({
            id: QUICK_ACTION,
            icon: "fa-mobile-screen-button",
            label: "씬보이스 스마트폰",
            hint: "전화·문자",
            run: () => this.run(() => this.openSmartphone()),
          });
        else api.removeQuickAction?.(QUICK_ACTION);
        this.multicastMenu = menu;
      }
    } catch (error) {
      console.warn("[SceneVoice] MultiCast sync failed", error);
    }
  },

  /** On the way out: holds released, the quick menu row taken back. */
  releaseMultiCast() {
    const api = this.multicastApi();
    if (!api || !this.multicastAttached) return;
    try {
      for (const reason of this.multicastHolds || []) api.releaseAutoPlay?.(reason);
      if (this.multicastMenu) api.removeQuickAction?.(QUICK_ACTION);
    } catch (_) {
      /* MultiCast went away first */
    }
    this.multicastHolds?.clear();
    this.multicastMenu = false;
    this.multicastAttached = false;
    for (const file of this.soundFiles?.values() || [])
      file.then((sound) => sound && URL.revokeObjectURL(sound.url));
    this.soundFiles = null;
  },

  /**
   * MultiCast's cast as people (MultiCast에서 가져오기, and 자동 연동). A row of a bot card goes
   * under that card (its persona row as the card's persona), a shared row becomes a global person
   * switched off until turned on in a bot card (이 봇 카드에서 사용), a group chat's row a global
   * person used in that group's cards. Someone already here by the same name (in that card, or a global person used there)
   * is linked instead of doubled. Linked people follow MultiCast: its name, voice, gender, tags,
   * note and emotional range win where it sets them. A row gone from MultiCast takes the person
   * it made with it; someone registered here first is only unlinked.
   * Works on the given lists (the panel's drafts by default) and returns what changed.
   */
  importMultiCastCast({ voices = this.voiceDraft, notes = this.noteDraft } = {}) {
    const api = this.multicastApi();
    if (!api?.getCast) throw new Error("MultiCast 확장을 찾을 수 없습니다.");
    const cast = api.getCast({ scope: "all" });
    if (!Array.isArray(cast)) throw new Error("MultiCast 확장 출연진을 읽지 못했습니다.");
    // MultiCast keeps a persona row in each bot's cast that follows whichever persona is on until
    // it gets a voice: not a person yet, so it isn't brought in.
    const rows = cast.filter((row) => row?.id && row?.name && !(row.isUser && !row.voiceId));
    const context = window.SillyTavern?.getContext?.() || {};
    // Rows from before MultiCast handed out these two: read from its saved cast, by id.
    const saved = context.extensionSettings?.voice_cast || {};
    const stored = new Map(
      [...(saved.cast || []), ...Object.values(saved.castByBot || {}).flat()]
        .filter((row) => row?.id)
        .map((row) => [row.id, row]),
    );
    const place = (row) => {
      const bot = String(row.botKey || "");
      if (row.scope === "bot" && bot.startsWith("char:"))
        return { card: `character:${bot.slice(5)}`, order: 0 };
      if (row.scope === "bot" && bot.startsWith("group:")) {
        const group = (context.groups || []).find((item) => String(item.id) === bot.slice(6));
        return {
          card: "",
          cards: (group?.members || []).map((avatar) => `character:${avatar}`),
          order: 2,
        };
      }
      return { card: "", order: 1 };
    };
    const linked = () =>
      new Map(
        Object.entries(voices)
          .filter(([, entry]) => entry?.multicast_id)
          .map(([key, entry]) => [entry.multicast_id, key]),
      );
    let ids = linked();
    const result = { added: 0, updated: 0, linked: 0, skipped: 0, removed: 0 };
    const seen = new Set();
    const ordered = rows
      .map((row) => ({ row, where: place(row) }))
      .sort((a, b) => a.where.order - b.where.order);
    for (const { row, where } of ordered) {
      const names = [row.name, ...(row.aliases || [])].map((name) => String(name).trim().toLowerCase());
      const sameName = ([key, entry]) =>
        key.startsWith("speaker:") && entry && personNames(entry).some((name) => names.includes(name));
      // Someone global, used in this row's card, by the same name: the same person (one global
      // person may stand for this name in several cards' rows).
      const globalTwin = (card) =>
        Object.entries(voices).find(
          (item) => sameName(item) && !item[1].card && globalUsedIn(item[1], card),
        );
      let key = ids.get(row.id);
      // Brought in under the card while the same person was already global there: one person.
      if (key && where.card && voices[key]?.card === where.card) {
        const twin = globalTwin(where.card);
        if (twin) {
          delete voices[key];
          delete notes[key];
          key = twin[0];
        }
      }
      if (!key) {
        // A group chat's row for someone already under one of its cards is that person.
        if (
          where.cards?.length &&
          Object.entries(voices).some((item) => sameName(item) && where.cards.includes(item[1].card))
        ) {
          result.skipped++;
          continue;
        }
        key =
          Object.entries(voices).find(
            (item) => sameName(item) && !item[1].multicast_id && (item[1].card || "") === where.card,
          )?.[0] || (where.card ? globalTwin(where.card)?.[0] : undefined);
      }
      const fresh = !key;
      const linkedNow = !fresh && !voices[key]?.multicast_id;
      key ||= `speaker:${contentKey({ multicast: row.id })}`;
      const before = JSON.stringify([voices[key], notes[key]]);
      // Kept in its own field order, so an unchanged person compares (and saves) as unchanged.
      const entry = { ...(voices[key] || { engine: "inherit" }) };
      const set = (field, value) => {
        if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
        entry[field] = value;
      };
      // Names: a person's own name stays; MultiCast's names it lacks join its aliases.
      if (!entry.name) entry.name = String(row.name).trim().slice(0, 120);
      const aliases = String(entry.aliases || "")
        .split(/[,，、/|]/)
        .map((name) => name.trim())
        .filter(Boolean);
      for (const name of [row.name, ...(row.aliases || [])].map((item) => String(item).trim()))
        if (name && !personNames({ name: entry.name, aliases: aliases.join(",") }).includes(name.toLowerCase()))
          aliases.push(name);
      set("aliases", aliases.join(", ").slice(0, 600));
      set("gender", { m: "male", f: "female" }[row.gender]);
      if (row.voiceId && row.voiceId !== entry.voice_id) {
        // A thought voice that only repeated the old voice follows the new one.
        if (entry.thought_voice_id === entry.voice_id) delete entry.thought_voice_id;
        entry.voice_id = row.voiceId;
      }
      set("always_tags", (row.alwaysTags || []).slice(0, 4));
      const own = stored.get(row.id) || {};
      const range = row.range ?? own.range ?? TEMPER_RANGE[row.temper ?? own.temper];
      if (Number(range) >= 1 && Number(range) <= 5) {
        const step = rangeStep(range);
        if (step) entry.expressiveness = step;
        else delete entry.expressiveness;
      } else if ("range" in row || "temper" in row) {
        // MultiCast says this person has no range of their own (set back to none there).
        delete entry.expressiveness;
      }
      if (row.isUser) entry.persona = true;
      if (fresh && where.card) entry.card = where.card;
      if (fresh && !where.card) entry.use_cards = where.cards || [];
      // The first row it was linked to stays its id.
      if (!entry.multicast_id) {
        entry.multicast_id = row.id;
        if (fresh) entry.multicast_made = true;
      }
      voices[key] = entry;
      seen.add(key);
      if (row.actingNote) notes[key] = String(row.actingNote).slice(0, 4000);
      ids = linked();
      if (fresh) result.added++;
      else if (linkedNow) result.linked++;
      else if (JSON.stringify([voices[key], notes[key]]) !== before) result.updated++;
    }
    // Gone from MultiCast: what it made goes too; someone registered here first stays, unlinked.
    for (const [key, entry] of Object.entries(voices)) {
      if (!entry?.multicast_id || seen.has(key)) continue;
      if (entry.multicast_made) {
        delete voices[key];
        delete notes[key];
      } else {
        delete entry.multicast_id;
      }
      result.removed++;
    }
    return result;
  },

  /**
   * MultiCast 출연진 자동 연동: its cast brought in again when it may have changed (chat opened,
   * phone or settings opened, MultiCast saying so); saved only when something changed. Not while
   * the settings panel is open (its drafts would write over it; opening it syncs first).
   */
  async syncMultiCastCast({ panel = false } = {}) {
    if (!this.multicastAttached || !this.isActive() || this.config.casting?.multicast_sync === false)
      return null;
    if (!panel && document.getElementById("sv-overlay")) return null;
    if (this.multicastSyncing) return this.multicastSyncing;
    this.multicastSyncing = (async () => {
      const voices = structuredClone(this.config.character_voices || {});
      const notes = structuredClone(this.config.character_notes || {});
      const before = JSON.stringify([voices, notes]);
      const result = this.importMultiCastCast({ voices, notes });
      if (JSON.stringify([voices, notes]) === before) return result;
      const response = await this.request("/api/plugins/scenevoice/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character_voices: voices, character_notes: notes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `MultiCast 확장 연동 저장 실패 (${response.status})`);
      this.config = mergeConfig(data.settings || {});
      if (result.added || result.linked)
        this.notify(
          `MultiCast 확장 인물을 연락처·화자에 반영했습니다${result.added ? ` (새 인물 ${result.added}명)` : ""}.`,
          "info",
        );
      return result;
    })()
      .catch((error) => {
        console.warn("[SceneVoice] MultiCast sync failed", error);
        return null;
      })
      .finally(() => {
        this.multicastSyncing = null;
      });
    return this.multicastSyncing;
  },
};
