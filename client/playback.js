// Playback: two reusable audio players (see audioPlayer), the call filter and the thought
// effect, short message tones, and voices joined into files to save.
import { pcm16, wavFromParts } from "./wav.js";

// A saved file is cut every 30 minutes, so a long conversation stays within a phone's memory.
const FILE_SECONDS = 1800;

export const playback = {
  shouldApplyCommunicationFilter(kind, record = undefined) {
    // One switch for every phone sound (폰 음질 효과); `kind` is kept for the callers' sake.
    const enabled = this.config.phone?.audio_filter !== false;
    if (!enabled) return false;
    // A clip saved with the filter already in it isn't filtered twice.
    if (record === undefined) return true;
    return record?.audio_filtered !== true && record?.audio_filtered !== 1;
  },

  /** `aside`: a remark in the background on a call (someone near the phone): fainter, duller. */
  connectCommunicationAudioFilter(audio, { aside = false, filter = true, radio = false } = {}) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (
      !this.communicationAudioContext ||
      this.communicationAudioContext.state === "closed"
    ) {
      this.communicationAudioContext = new AudioContextClass();
    }
    const context = this.communicationAudioContext;
    const source = this.mediaSource(audio, context);
    const nodes = [
      ...(filter ? (radio ? this.radioNodes(context) : this.communicationNodes(context)) : []),
      ...(aside ? this.asideNodes(context) : []),
    ];
    source.connect(nodes[0]);
    nodes.at(-1).connect(context.destination);
    this.currentAudioNodes = [source, ...nodes];
    return context;
  },

  /** 라디오: a clean broadcast voice (fuller than the phone, warm low end, gently compressed). */
  radioNodes(context) {
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const warmth = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    highpass.type = "highpass";
    highpass.frequency.value = 160;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 6000;
    warmth.type = "lowshelf";
    warmth.frequency.value = 220;
    warmth.gain.value = 2;
    presence.type = "peaking";
    presence.frequency.value = 2500;
    presence.Q.value = 0.8;
    presence.gain.value = 2.5;
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.2;
    highpass.connect(lowpass).connect(warmth).connect(presence).connect(compressor);
    return [highpass, lowpass, warmth, presence, compressor];
  },

  asideNodes(context) {
    const lowpass = context.createBiquadFilter();
    const gain = context.createGain();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1700;
    gain.gain.value = 0.45;
    lowpass.connect(gain);
    return [lowpass, gain];
  },

  communicationNodes(context) {
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    highpass.type = "highpass";
    highpass.frequency.value = 300;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 4500;
    presence.type = "peaking";
    presence.frequency.value = 1800;
    presence.Q.value = 0.9;
    presence.gain.value = 3;
    compressor.threshold.value = -20;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.12;
    highpass.connect(lowpass).connect(presence).connect(compressor);
    return [highpass, lowpass, presence, compressor];
  },

  async renderCommunicationFilter(buffer, { radio = false } = {}) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const context = new Offline(1, buffer.length, buffer.sampleRate);
    const source = context.createBufferSource();
    const nodes = radio ? this.radioNodes(context) : this.communicationNodes(context);
    source.buffer = buffer;
    source.connect(nodes[0]);
    nodes.at(-1).connect(context.destination);
    source.start();
    return context.startRendering();
  },

  fileStamp(value = Date.now()) {
    const date = new Date(value);
    const at = Number.isNaN(date.getTime()) ? new Date() : date;
    const two = (number) => String(number).padStart(2, "0");
    return `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
  },

  /** Joins clips into WAV files and saves them. `clips`: [{ url, filter, radio }]; returns the file count. */
  async downloadJoinedAudio(clips, name, { gap = 0.5, rate = 24000 } = {}) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = new Offline(1, 1, rate);
    const files = [];
    let parts = [];
    let length = 0;
    const close = () => {
      if (parts.length) files.push(wavFromParts(parts, rate));
      parts = [];
      length = 0;
    };
    for (const clip of clips) {
      const response = await fetch(clip.url);
      if (!response.ok) throw new Error(`음성 파일을 읽지 못했습니다 (${response.status}).`);
      let buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      if (clip.filter) buffer = await this.renderCommunicationFilter(buffer, { radio: clip.radio });
      const mono = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
      }
      if (length && length + mono.length > rate * FILE_SECONDS) close();
      if (length) {
        const pause = new Int16Array(Math.round(rate * gap));
        parts.push(pause);
        length += pause.length;
      }
      parts.push(pcm16(mono));
      length += mono.length;
    }
    close();
    for (const [index, blob] of files.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 600));
      this.saveFile(blob, files.length > 1 ? `${name}-${index + 1}.wav` : `${name}.wav`);
    }
    return files.length;
  },

  saveFile(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = String(name).replace(/[\\/:*?"<>|]+/g, "").trim() || "scenevoice";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  },

  /**
   * An inner voice: a little quieter, softened at the top, with a short faint room around it.
   * Playback only; the saved file stays clean.
   */
  connectThoughtAudioEffect(audio) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (
      !this.communicationAudioContext ||
      this.communicationAudioContext.state === "closed"
    )
      this.communicationAudioContext = new AudioContextClass();
    const context = this.communicationAudioContext;
    if (!this.thoughtImpulse || this.thoughtImpulse.sampleRate !== context.sampleRate) {
      // A 0.9 s decaying noise tail: a small, soft room.
      const length = Math.round(context.sampleRate * 0.9);
      const impulse = context.createBuffer(2, length, context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++)
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
      }
      this.thoughtImpulse = impulse;
    }
    const source = this.mediaSource(audio, context);
    const soften = context.createBiquadFilter();
    const dry = context.createGain();
    const room = context.createConvolver();
    const wet = context.createGain();
    soften.type = "lowpass";
    soften.frequency.value = 5200;
    dry.gain.value = 0.78;
    room.buffer = this.thoughtImpulse;
    wet.gain.value = 0.22;
    source.connect(soften);
    soften.connect(dry).connect(context.destination);
    soften.connect(room).connect(wet).connect(context.destination);
    this.currentAudioNodes = [source, soften, dry, room, wet];
    return context;
  },

  /** Thought lines get the inner-voice effect unless it is switched off. */
  wantsThoughtEffect(button) {
    return button?.dataset?.kind === "thought" && this.config.reading?.thought_effect !== false;
  },

  /**
   * The page's two audio players, kept for the whole visit: a phone browser lets an element
   * play later (a reply voiced after a wait) only if that element already played during a tap.
   * One plays clean; the other feeds Web Audio for the call filter and the thought effect (an
   * element can be wired to Web Audio only once, and then always sounds through it).
   */
  audioPlayer(effect = false) {
    const key = effect ? "effectAudioElement" : "plainAudioElement";
    const context = this.communicationAudioContext;
    // Wired to an audio context that was closed since: that element can't sound any more.
    if (effect && this[key]?.svSource && this[key].svSource.context !== context) this[key] = null;
    if (!this[key]) {
      const audio = new Audio();
      audio.preload = "auto";
      if (effect) audio.crossOrigin = "anonymous";
      this[key] = audio;
    }
    return this[key];
  },

  /** The Web Audio source of the effect player, made once per element. */
  mediaSource(audio, context) {
    audio.svSource ||= context.createMediaElementSource(audio);
    return audio.svSource;
  },

  playAudio(
    url,
    button = null,
    revokeObjectUrl = false,
    { communicationFilter = false, thoughtEffect = false, aside = false, radio = false, onEnded = null, onStop = null } = {},
  ) {
    if (!url) return;
    // Another TTS extension playing now stops first.
    this.quietMultiCast?.();
    // The audio playing until now was cut short.
    const stopped = this.currentAudioStop;
    this.currentAudioStop = null;
    stopped?.();
    if (this.currentAudio) {
      const previous = this.currentAudio;
      this.playToken = (this.playToken || 0) + 1;
      previous.onended = null;
      previous.onerror = null;
      previous.pause();
      this.currentAudio = null;
      this.currentAudioNodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (_) {
          /* already disconnected */
        }
      });
      this.currentAudioNodes = [];
      this.currentPlayButton?.classList.remove("sv-playing");
      if (this.currentAudioObjectUrl)
        URL.revokeObjectURL(this.currentAudioObjectUrl);
      this.currentAudioObjectUrl = "";
      if (this.currentPlayButton === button) {
        this.currentPlayButton = null;
        this.hideNowReading(true);
        return;
      }
    }
    const effect = communicationFilter || thoughtEffect || aside;
    if (effect) this.ensureAudioContext();
    const audio = this.audioPlayer(effect);
    const token = (this.playToken = (this.playToken || 0) + 1);
    const live = () => this.playToken === token;
    this.currentAudioStop = onStop;
    audio.muted = false;
    audio.src = url;
    this.currentAudio = audio;
    this.currentPlayButton = button;
    this.currentAudioObjectUrl = revokeObjectUrl ? url : "";
    button?.classList.add("sv-playing");
    const chatLine = Boolean(button?.classList?.contains("sv-play-btn"));
    if (chatLine) this.showNowReading(button, audio);
    else this.hideNowReading(true);
    this.syncPublicState?.({ playing: true, kind: chatLine ? "chat" : "phone" });
    let audioContext = null;
    if (communicationFilter || aside) {
      try {
        audioContext = this.connectCommunicationAudioFilter(audio, { aside, filter: communicationFilter, radio });
      } catch (error) {
        console.warn(
          "[SceneVoice] playback-only communication filter unavailable; using clean audio",
          error,
        );
        this.currentAudioNodes = [];
      }
    } else if (thoughtEffect) {
      try {
        audioContext = this.connectThoughtAudioEffect(audio);
      } catch (error) {
        console.warn("[SceneVoice] thought effect unavailable; using clean audio", error);
        this.currentAudioNodes = [];
      }
    }
    // The effect player sounds only through Web Audio; with no effect wired, route it straight.
    if (effect && !this.currentAudioNodes.length && audio.svSource && this.communicationAudioContext) {
      audio.svSource.connect(this.communicationAudioContext.destination);
      this.currentAudioNodes = [audio.svSource];
      audioContext = this.communicationAudioContext;
    }
    const cleanup = () => {
      if (!live()) return;
      // Done with this element: a late error from it (iOS reloading a released blob URL when the
      // page comes back) must not show "can't play" for audio that played fine.
      audio.onended = null;
      audio.onerror = null;
      this.playToken += 1;
      button?.classList.remove("sv-playing");
      if (chatLine) this.hideNowReading();
      this.currentAudioNodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (_) {
          /* already disconnected */
        }
      });
      this.currentAudioNodes = [];
      if (this.currentAudioObjectUrl)
        URL.revokeObjectURL(this.currentAudioObjectUrl);
      this.currentAudioObjectUrl = "";
      this.currentAudio = null;
      this.currentPlayButton = null;
      this.syncPublicState?.({ playing: false });
    };
    // Played to the end (or unplayable): the next line in a row may follow.
    const finished = () => {
      if (!live()) return;
      this.currentAudioStop = null;
      cleanup();
      onEnded?.();
    };
    audio.onended = finished;
    audio.onerror = () => {
      if (!live()) return;
      this.notify("오디오를 재생할 수 없습니다.", "error");
      finished();
    };
    // A phone may leave the context "interrupted" (another app, a tab switch), not just suspended,
    // and its resume() may never settle outside a tap: playing is tried after a moment anyway.
    const resume =
      audioContext && audioContext.state !== "running"
        ? Promise.race([audioContext.resume(), new Promise((resolve) => setTimeout(resolve, 1500))])
        : Promise.resolve();
    Promise.resolve(resume)
      .then(() => {
        if (live()) return audio.play();
      })
      .catch((error) => {
        if (!live() || error.name === "AbortError") return;
        this.notify(
          error.name === "NotAllowedError"
            ? "음성이 준비되었습니다. 브라우저에서 자동 재생을 막았으니 재생 버튼을 한 번 더 눌러 주세요."
            : `재생 실패: ${error.message}`,
          error.name === "NotAllowedError" ? "info" : "error",
        );
        this.currentAudioStop = null;
        cleanup();
        onStop?.();
      });
  },

  /**
   * A phone line's [sfx: name] tags with a sound file: those before its words, and the rest.
   * Tags without a file are not played (the voice was made without them).
   */
  async lineSounds(script) {
    const text = String(script || "");
    const found = [...text.matchAll(/\[sfx:\s*([^\]]+)\]/gi)];
    if (!found.length || !this.soundFor) return { before: [], after: [], loops: [] };
    // Tags ahead of the first word: played before the voice; any others after it. 🔁 sounds
    // run under the voice wherever they are.
    const lead = /^(?:\s*\[[^\]]*\])*/.exec(text)[0].length;
    const before = [];
    const after = [];
    const loops = [];
    for (const match of found) {
      const sound = await this.soundFor(match[1]);
      if (!sound) continue;
      if (sound.loop) loops.push(sound.url);
      else (match.index < lead ? before : after).push(sound.url);
    }
    return { before, after, loops };
  },

  /**
   * The script a phone line's voice is made from: its [sfx: name] tags taken out (their sound
   * files play around it), or, without a file, left to ElevenLabs v4 as a plain tag when it can
   * perform one, otherwise dropped.
   */
  async voiceScript(script, speakerKey) {
    const text = String(script || "");
    if (!/\[sfx:/i.test(text)) return text;
    let result = "";
    let at = 0;
    for (const match of text.matchAll(/\[sfx:\s*([^\]]+)\]/gi)) {
      result += text.slice(at, match.index);
      at = match.index + match[0].length;
      const file = await this.soundFor?.(match[1]);
      if (!file && this.soundEffectsFor?.(speakerKey)) result += `[${match[1].trim()}]`;
    }
    return (result + text.slice(at)).replace(/[ \t]{2,}/g, " ").trim();
  },

  /**
   * Plays a phone line with its sounds: those before the words, the voice, then the rest. One
   * stop ends them all; `onEnded` once the last one has played. A file with its sounds already
   * mixed in (`mixed`) just plays.
   */
  /** Sounds playing alongside a voice (겹쳐 재생, 🔁) stop with it. */
  stopSideSounds() {
    for (const sound of this.sideSounds || []) {
      clearInterval(sound.svFade);
      sound.pause();
    }
    this.sideSounds = [];
  },

  /** A side sound's volume moved to `to` over `ms` (a loop fading in or out). */
  fadeSideSound(sound, to, ms, then = null) {
    const from = sound.volume;
    const start = performance.now();
    clearInterval(sound.svFade);
    sound.svFade = setInterval(() => {
      const step = Math.min(1, (performance.now() - start) / ms);
      sound.volume = Math.min(1, Math.max(0, from + (to - from) * step));
      if (step >= 1) {
        clearInterval(sound.svFade);
        then?.();
      }
    }, 40);
  },

  async playWithSounds(url, script, button, revoke, { mixed = false, ...options } = {}) {
    const { before, after, loops } = mixed
      ? { before: [], after: [], loops: [] }
      : await this.lineSounds(script);
    if (!before.length && !after.length && !loops.length)
      return this.playAudio(url, button, revoke, options);
    // As MultiCast plays them (and as a saved mix sounds): with 겹쳐 재생 a sound starts at 85%
    // and the voice comes in at once; otherwise it takes its turn. 🔁 sounds loop at 30% under
    // the voice and fade out after it.
    const overlay = Boolean(this.soundOverlay?.());
    // Sounds of the line before may still be fading out under this one (as in MultiCast).
    this.sideSounds = (this.sideSounds || []).filter((sound) => !sound.paused && !sound.ended);
    const side = (src, volume, loop = false) => {
      const sound = new Audio(src);
      sound.volume = loop ? 0 : volume;
      sound.loop = loop;
      sound.svVolume = volume;
      sound.play().catch(() => undefined);
      this.sideSounds.push(sound);
      return sound;
    };
    const beds = loops.slice(0, 3).map((src, _, all) => side(src, 0.3 * [1, 0.8, 0.65][all.length - 1], true));
    for (const bed of beds) this.fadeSideSound(bed, bed.svVolume, 400);
    if (overlay) for (const src of before) side(src, 0.85);
    const parts = [...(overlay ? [] : before), url, ...(overlay ? [] : after)];
    let index = 0;
    const next = () => {
      if (index >= parts.length) {
        if (overlay) for (const src of after) side(src, 0.85);
        for (const bed of beds) this.fadeSideSound(bed, 0, 1800, () => bed.pause());
        return options.onEnded?.();
      }
      const part = parts[index++];
      this.playAudio(part, button, part === url && revoke, { ...options, onEnded: next });
    };
    next();
  },

  /**
   * 읽는 대사 자막: the line being read, in a strip under 실리태번's top bar. "auto" shows it only
   * for lines read off screen (the original behind a translation). Lines take over from one
   * another without the strip blinking; a line wider than the strip glides sideways once, over
   * about as long as it is spoken.
   */
  showNowReading(button, audio = null) {
    const mode = this.config.playback?.caption || "always";
    const text = String(button.dataset.text || "").trim();
    // "auto": a line read off screen, or one whose play buttons are hidden.
    const unseen =
      !button.isConnected || document.body.classList.contains("sv-hide-line-buttons");
    if (mode === "off" || (mode === "auto" && !unseen) || !text) {
      this.hideNowReading(true);
      return;
    }
    clearTimeout(this.nowReadingTimer);
    let bar = document.getElementById("sv-now-reading");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "sv-now-reading";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.innerHTML =
        '<span class="sv-now-reading-who" hidden></span><div class="sv-now-reading-window"><span class="sv-now-reading-text"></span></div>';
      document.body.appendChild(bar);
    }
    const label = bar.querySelector(".sv-now-reading-text");
    const token = (this.nowReadingToken = (this.nowReadingToken || 0) + 1);
    const glide = (overflow) => {
      const spoken = audio?.duration;
      const seconds = Number.isFinite(spoken) && spoken > 2 ? spoken - 1 : overflow / 30 + 3;
      label.style.setProperty("--sv-scroll-time", `${Math.max(4, seconds).toFixed(1)}s`);
    };
    // Who is speaking, in a small tag on the strip's top edge (no room taken from the line).
    const who = bar.querySelector(".sv-now-reading-who");
    const swap = () => {
      if (token !== this.nowReadingToken) return;
      label.textContent = text;
      if (who) {
        who.textContent = button.dataset.speakerName || "";
        who.hidden = !who.textContent;
      }
      label.classList.toggle("sv-thought", button.dataset.kind === "thought");
      label.classList.remove("sv-scroll");
      requestAnimationFrame(() => {
        if (token !== this.nowReadingToken) return;
        const room = label.parentElement;
        // A long line gets soft edges and more room; measured again with them.
        bar.classList.toggle("sv-long", label.scrollWidth - room.clientWidth > 4);
        const overflow = label.scrollWidth - room.clientWidth;
        if (overflow > 4) {
          label.style.setProperty("--sv-shift", `${-overflow}px`);
          glide(overflow);
          // The length is known a moment later; the glide waits a second before it moves.
          audio?.addEventListener(
            "loadedmetadata",
            () => {
              if (token === this.nowReadingToken) glide(overflow);
            },
            { once: true },
          );
          label.classList.add("sv-scroll");
        }
        label.classList.remove("sv-swap");
      });
    };
    if (bar.classList.contains("sv-shown") && label.textContent) {
      label.classList.add("sv-swap");
      setTimeout(swap, 160);
    } else {
      swap();
      requestAnimationFrame(() => bar.classList.add("sv-shown"));
    }
  },

  /** Hides the strip; by default after a moment, so the next line in a row can take over. */
  hideNowReading(now = false) {
    clearTimeout(this.nowReadingTimer);
    const hide = () => {
      this.nowReadingToken = (this.nowReadingToken || 0) + 1;
      document.getElementById("sv-now-reading")?.classList.remove("sv-shown");
    };
    if (now) hide();
    else this.nowReadingTimer = setTimeout(hide, 900);
  },

  /**
   * Short tones for a text sent (rising swoosh) and received (two soft notes); off in settings.
   * One tone per sender's turn: several bubbles, or more texts from the same person in a row,
   * chime once; the next person (or the same one after someone else) chimes again, a beat after.
   */
  playMessageTone(kind, sender = "") {
    if (this.config.voice_message?.sounds === false) return;
    const now = Date.now();
    const turn = `${kind}:${sender}`;
    if (this.lastTone?.turn === turn && now - this.lastTone.at < 8000) {
      this.lastTone.at = now;
      return;
    }
    // Close after another tone: a beat apart, so two people's tones don't run together.
    const wait = Math.max(0, (this.lastTone?.at || 0) + 650 - now);
    this.lastTone = { turn, at: now + wait };
    if (wait) {
      setTimeout(() => this.chime(kind), wait);
      return;
    }
    this.chime(kind);
  },

  chime(kind) {
    this.playTones(
      kind === "send"
        ? [[0, 520, 880, 0.14]]
        : [
            [0, 880, 880, 0.12],
            [0.13, 1318, 1318, 0.18],
          ],
      0.11,
    );
  },

  /**
   * Short tones ([start, from Hz, to Hz, length] each) through the shared audio context, which
   * the user's taps keep unlocked: a context made just for them would start silenced on phones.
   */
  playTones(notes, volume = 0.06) {
    const context = this.ensureAudioContext();
    if (!context) return;
    if (context.state !== "running") context.resume().catch(() => undefined);
    try {
      for (const [offset, from, to, length] of notes) {
        const start = context.currentTime + offset;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(from, start);
        oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      }
    } catch {
      /* Without Web Audio the message still arrives silently. */
    }
  },

  /** The shared Web Audio context (call filter, thought effect), made when first needed. */
  ensureAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (
        AudioContextClass &&
        (!this.communicationAudioContext || this.communicationAudioContext.state === "closed")
      )
        this.communicationAudioContext = new AudioContextClass();
    } catch (_) {
      /* Web Audio is optional; clean playback remains available. */
    }
    return this.communicationAudioContext || null;
  },

  /**
   * Called on every tap: wakes the audio context (a phone suspends or interrupts it) and, once
   * per player, plays a moment of silence so the browser lets that player sound later without a
   * tap, e.g. a call reply voiced several seconds after the user sent their line.
   */
  unlockAudioForMobile() {
    const context = this.ensureAudioContext();
    if (context && context.state !== "running") context.resume().catch(() => undefined);
    const silentWav =
      "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";
    for (const effect of [false, true]) {
      const audio = this.audioPlayer(effect);
      if (audio.svBlessed || this.currentAudio === audio) continue;
      audio.svBlessed = true;
      audio.muted = true;
      audio.src = silentWav;
      const stillSilent = () => audio.src === silentWav;
      Promise.resolve(audio.play())
        .then(() => {
          if (!stillSilent()) return;
          audio.pause();
          audio.muted = false;
          this.audioUnlocked = true;
        })
        .catch(() => {
          audio.svBlessed = false;
          if (stillSilent()) audio.muted = false;
        });
    }
  },
};
