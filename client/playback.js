// Playback: two reusable audio players (see audioPlayer), the call filter and the thought
// effect, short message tones, and voices joined into files to save.
import { BufferPlayer } from "./buffer-player.js";
import { stOf } from "./common.js";
import { MOVING_SIDES, sideAt } from "../shared/place.js";
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

  /** The page's audio context for effects, made on first use. */
  effectContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (
      !this.communicationAudioContext ||
      this.communicationAudioContext.state === "closed"
    )
      this.communicationAudioContext = new AudioContextClass();
    return this.communicationAudioContext;
  },

  /**
   * Wires the player through each group of nodes in turn, then to the speakers. A group is
   * already connected inside: its first node takes the sound in, its last gives it out.
   */
  wireEffects(audio, context, groups) {
    const source = this.mediaSource(audio, context);
    const wired = [source];
    let tail = source;
    for (const nodes of groups) {
      if (!nodes.length) continue;
      tail.connect(nodes[0]);
      tail = nodes.at(-1);
      wired.push(...nodes);
      if (nodes.sway) this.swayWith(audio, context, nodes.sway);
    }
    this.currentAudioNodes = [...wired, ...this.toSpeakers(context, tail)];
    return context;
  },

  /**
   * A voice that moves while its line is said (see sideAt): the lean follows the player's own
   * time, so a pause or a jump in the line keeps them together. It aims a moment ahead and
   * glides there, on every frame and on the player's own ticks (frames stop in a hidden tab).
   * Ends by itself once its nodes are no longer the ones playing.
   */
  swayWith(audio, context, { panner, side, reach }) {
    const AHEAD = 0.15;
    const at = (ahead) =>
      sideAt(side, (audio.currentTime || 0) + ahead, audio.duration) * reach;
    let placed = false;
    const follow = () => {
      if (!this.currentAudioNodes.includes(panner)) {
        audio.removeEventListener("timeupdate", follow);
        return false;
      }
      // Where a crossing starts depends on the line's length, known only once it has loaded.
      if (!placed && audio.duration > 0) {
        placed = true;
        panner.pan.setValueAtTime(at(0), context.currentTime);
      }
      if (!audio.paused)
        panner.pan.setTargetAtTime(at(AHEAD), context.currentTime, AHEAD);
      return true;
    };
    const frame = () => {
      if (follow()) requestAnimationFrame(frame);
    };
    audio.addEventListener("timeupdate", follow);
    requestAnimationFrame(frame);
  },

  /**
   * The end of every chain: to the speakers, through a gain when this play is turned down
   * (음량 맞춤). Returns the node it added, if any.
   */
  toSpeakers(context, ...tails) {
    const level = this.playLevel ?? 1;
    const gain = level < 0.99 ? context.createGain() : null;
    if (gain) {
      gain.gain.value = level;
      gain.connect(context.destination);
    }
    for (const tail of tails) tail.connect(gain || context.destination);
    return gain ? [gain] : [];
  },

  /**
   * `aside`: a remark in the background on a call (someone near the phone): fainter, duller.
   * `place`: how the voice reaches the phone (before the line), or a side on the radio (after it).
   */
  connectCommunicationAudioFilter(
    audio,
    { aside = false, filter = true, radio = false, place = null } = {},
  ) {
    const context = this.effectContext();
    if (!context) return null;
    const placed = place ? this.placeNodes(context, place) : [];
    return this.wireEffects(audio, context, [
      radio ? [] : placed,
      filter
        ? radio
          ? this.radioNodes(context)
          : this.communicationNodes(context)
        : [],
      aside ? this.asideNodes(context) : [],
      radio ? placed : [],
    ]);
  },

  /** 공간감 on a chat line. Playback only; the saved file stays clean. */
  connectPlaceEffect(audio, place) {
    const context = this.effectContext();
    return (
      context &&
      this.wireEffects(audio, context, [this.placeNodes(context, place)])
    );
  },

  /** A 0.9 s decaying noise tail: a small, soft room. */
  roomImpulse(context) {
    if (
      !this.thoughtImpulse ||
      this.thoughtImpulse.sampleRate !== context.sampleRate
    ) {
      const length = Math.round(context.sampleRate * 0.9);
      const impulse = context.createBuffer(2, length, context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++)
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
      }
      this.thoughtImpulse = impulse;
    }
    return this.thoughtImpulse;
  },

  /**
   * 공간감: where a voice is heard from. `side` leans it to the left or right (never all the
   * way: a wrong guess must not grate), or moves it between the two as the line is said (the
   * nodes then carry `sway` for swayWith).
   * `space`: close (fuller, a touch louder), far (thin, quiet, in a room) or muffled (dull, as
   * through a door).
   */
  placeNodes(context, { side = "", space = "" } = {}) {
    const input = context.createGain();
    const nodes = [input];
    let tail = input;
    const add = (node) => {
      tail.connect(node);
      nodes.push(node);
      tail = node;
      return node;
    };
    const filter = (type, frequency, gain = 0) => {
      const node = add(context.createBiquadFilter());
      node.type = type;
      node.frequency.value = frequency;
      node.gain.value = gain;
    };
    const level = (value) => {
      add(context.createGain()).gain.value = value;
    };
    if (space === "close") {
      filter("lowshelf", 220, 4);
      filter("highshelf", 5000, 2);
      level(1.1);
    } else if (space === "muffled") {
      filter("lowpass", 900);
      level(0.8);
    } else if (space === "far") {
      filter("highpass", 260);
      filter("lowpass", 3400);
      level(0.5);
    }
    const reach = space === "close" ? 0.725 : 0.575;
    const moves = MOVING_SIDES.includes(side);
    const lean = sideAt(side) * reach;
    let sway = null;
    if ((lean || moves) && context.createStereoPanner) {
      const panner = add(context.createStereoPanner());
      panner.pan.value = lean;
      if (moves) sway = { panner, side, reach };
    }
    const output = context.createGain();
    tail.connect(output);
    if (space === "far") {
      // The room it carries across, beside the voice itself.
      const room = context.createConvolver();
      const wet = context.createGain();
      room.buffer = this.roomImpulse(context);
      wet.gain.value = 0.3;
      tail.connect(room).connect(wet).connect(output);
      nodes.push(room, wet);
    }
    nodes.push(output);
    if (sway) nodes.sway = sway;
    return nodes;
  },

  /**
   * Whose picture on a call or radio screen pulses: the one whose voice sounds now. Called with
   * no key after such a screen is drawn again, to mark it as it is.
   */
  markSpeaking(key = this.speakingKey || "") {
    this.speakingKey = key;
    document
      .querySelectorAll(
        "#sv-smartphone .sv-call-identity .sv-phone-avatar[data-key]",
      )
      .forEach((avatar) =>
        avatar.classList.toggle(
          "sv-speaking",
          Boolean(key) && avatar.dataset.key === key,
        ),
      );
  },

  /** Who says a call's line, as their picture is keyed; nobody for a remark from behind. */
  turnSpeaker(session, turn) {
    if (!turn || turn.aside) return "";
    return turn.role === "user"
      ? this.personaKey()
      : turn.speaker_key || session?.character_key || "";
  },

  /** A call line's place: how the voice reaches the phone. */
  turnPlace(turn) {
    return turn?.space ? { space: turn.space } : null;
  },

  /** A chat line's place, when 공간감 is on and the line has one. Thoughts stay where they are. */
  linePlace(button) {
    if (
      this.config.playback?.spatial === false ||
      button?.dataset?.kind === "thought"
    )
      return null;
    const { side = "", space = "" } = button?.dataset || {};
    return side || space ? { side, space } : null;
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
    highpass
      .connect(lowpass)
      .connect(warmth)
      .connect(presence)
      .connect(compressor);
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
    // Kept light: a phone's narrower band, not a tinny line (it tired the ear at 300–4500 Hz).
    highpass.type = "highpass";
    highpass.frequency.value = 200;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 6000;
    presence.type = "peaking";
    presence.frequency.value = 1800;
    presence.Q.value = 0.9;
    presence.gain.value = 1.5;
    compressor.threshold.value = -18;
    compressor.ratio.value = 2;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.12;
    highpass.connect(lowpass).connect(presence).connect(compressor);
    return [highpass, lowpass, presence, compressor];
  },

  async renderCommunicationFilter(buffer, { radio = false } = {}) {
    const Offline =
      window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const context = new Offline(1, buffer.length, buffer.sampleRate);
    const source = context.createBufferSource();
    const nodes = radio
      ? this.radioNodes(context)
      : this.communicationNodes(context);
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
    const Offline =
      window.OfflineAudioContext || window.webkitOfflineAudioContext;
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
      if (!response.ok)
        throw new Error(`음성 파일을 읽지 못했습니다 (${response.status}).`);
      let buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      if (clip.filter)
        buffer = await this.renderCommunicationFilter(buffer, {
          radio: clip.radio,
        });
      const mono = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++)
          mono[i] += data[i] / buffer.numberOfChannels;
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
      this.saveFile(
        blob,
        files.length > 1 ? `${name}-${index + 1}.wav` : `${name}.wav`,
      );
    }
    return files.length;
  },

  saveFile(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download =
      String(name)
        .replace(/[\\/:*?"<>|]+/g, "")
        .trim() || "scenevoice";
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
    const context = this.effectContext();
    if (!context) return null;
    const source = this.mediaSource(audio, context);
    const soften = context.createBiquadFilter();
    const dry = context.createGain();
    const room = context.createConvolver();
    const wet = context.createGain();
    soften.type = "lowpass";
    soften.frequency.value = 5200;
    dry.gain.value = 0.78;
    room.buffer = this.roomImpulse(context);
    wet.gain.value = 0.22;
    source.connect(soften);
    soften.connect(dry);
    soften.connect(room).connect(wet);
    this.currentAudioNodes = [
      source,
      soften,
      dry,
      room,
      wet,
      ...this.toSpeakers(context, dry, wet),
    ];
    return context;
  },

  /** Thought lines get the inner-voice effect unless it is switched off. */
  wantsThoughtEffect(button) {
    return button?.dataset?.kind === "thought";
  },

  /**
   * The page's two audio players, kept for the whole visit. The clean one is an element: a
   * phone browser lets it play later (a reply voiced after a wait) only if it already played
   * during a tap. The other sounds through Web Audio, for every effect and for 음량 맞춤: a
   * BufferPlayer, or an element where there is no Web Audio.
   */
  audioPlayer(effect = false) {
    const key = effect ? "effectAudioElement" : "plainAudioElement";
    const context = this.communicationAudioContext;
    // Made for an audio context that was closed since, or before there was one: a new player.
    if (
      effect &&
      context &&
      this[key] &&
      (this[key].svSource?.context !== context ||
        !(this[key] instanceof BufferPlayer))
    )
      this[key] = null;
    if (!this[key]) {
      if (effect && context) this[key] = new BufferPlayer(context);
      else {
        const audio = new Audio();
        audio.preload = "auto";
        if (effect) audio.crossOrigin = "anonymous";
        this[key] = audio;
      }
    }
    return this[key];
  },

  /** Where the effects are wired from: the effect player's own node (see BufferPlayer). */
  mediaSource(audio, context) {
    audio.svSource ||= context.createMediaElementSource(audio);
    return audio.svSource;
  },

  playAudio(
    url,
    button = null,
    revokeObjectUrl = false,
    {
      communicationFilter = false,
      thoughtEffect = false,
      aside = false,
      radio = false,
      place = null,
      speaker = "",
      level = 1,
      onEnded = null,
      onStop = null,
    } = {},
  ) {
    if (!url) return;
    if (
      this.playbackPaused &&
      button &&
      this.currentPlayButton === button &&
      this.currentAudio
    ) {
      this.resumePlayback();
      return;
    }
    this.markPaused(false);
    // Another TTS extension playing now stops first.
    this.quietMultiCast?.();
    // The audio playing until now was cut short.
    const stopped = this.currentAudioStop;
    this.currentAudioStop = null;
    stopped?.();
    this.currentAudioAway?.();
    this.currentAudioAway = null;
    if (this.currentAudio) {
      const previous = this.currentAudio;
      this.playToken = (this.playToken || 0) + 1;
      previous.onended = null;
      previous.onerror = null;
      previous.pause();
      this.currentAudio = null;
      this.markSpeaking("");
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
    // 공간감 off: nothing is placed, whoever asks.
    if (this.config.playback?.spatial === false) place = null;
    // 음량 맞춤: this play turned down by `level` (never up).
    this.playLevel =
      this.config.playback?.level === false
        ? 1
        : Math.min(1, Math.max(0.4, Number(level) || 1));
    const leveled = this.playLevel < 0.99;
    const effect =
      communicationFilter ||
      thoughtEffect ||
      aside ||
      Boolean(place) ||
      leveled;
    if (effect) this.ensureAudioContext();
    let audio = this.audioPlayer(effect);
    const token = (this.playToken = (this.playToken || 0) + 1);
    const live = () => this.playToken === token;
    this.currentAudioStop = onStop;
    audio.muted = false;
    // (The clean player's own volume is used only when it stands in for the effect player.)
    if (!effect) audio.volume = 1;
    audio.src = url;
    this.currentAudio = audio;
    this.currentPlayButton = button;
    this.currentAudioObjectUrl = revokeObjectUrl ? url : "";
    button?.classList.add("sv-playing");
    this.markSpeaking(speaker);
    const chatLine = Boolean(button?.classList?.contains("sv-play-btn"));
    if (chatLine) this.showNowReading(button, audio);
    else this.hideNowReading(true);
    this.syncPublicState?.({
      playing: true,
      kind: chatLine ? "chat" : "phone",
    });
    let audioContext = null;
    if (communicationFilter || aside || (place && !thoughtEffect && radio)) {
      try {
        audioContext = this.connectCommunicationAudioFilter(audio, {
          aside,
          filter: communicationFilter,
          radio,
          place,
        });
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
        console.warn(
          "[SceneVoice] thought effect unavailable; using clean audio",
          error,
        );
        this.currentAudioNodes = [];
      }
    } else if (place) {
      try {
        audioContext = this.connectPlaceEffect(audio, place);
      } catch (error) {
        console.warn(
          "[SceneVoice] place effect unavailable; using clean audio",
          error,
        );
        this.currentAudioNodes = [];
      }
    } else if (leveled) {
      try {
        const context = this.effectContext();
        audioContext = context && this.wireEffects(audio, context, []);
      } catch (error) {
        console.warn(
          "[SceneVoice] level unavailable; using clean audio",
          error,
        );
        this.currentAudioNodes = [];
      }
    }
    // The effect player sounds only through Web Audio; with no effect wired, route it straight.
    if (
      effect &&
      !this.currentAudioNodes.length &&
      audio.svSource &&
      this.communicationAudioContext
    ) {
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
      this.currentAudioAway?.();
      this.currentAudioAway = null;
      this.playToken += 1;
      this.markPaused(false);
      this.markSpeaking("");
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
    const failed = () => {
      if (!live()) return;
      this.notify("오디오를 재생할 수 없습니다.", "error");
      finished();
    };
    audio.onended = finished;
    audio.onerror = failed;
    // The effect player sounds only through Web Audio: with a context that is not running (the
    // browser suspended or interrupted it and it didn't wake outside a tap), or one whose clock
    // stands still, it would play in silence with everything showing as playing. Then the clean
    // player takes over where the voice is: no effect for this one, its level by the player's
    // own volume (where the browser lets a page set it).
    const playClean = () => {
      const from = audio;
      const at = from.currentTime || 0;
      from.onended = null;
      from.onerror = null;
      from.pause();
      this.currentAudioNodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (_) {
          /* already disconnected */
        }
      });
      this.currentAudioNodes = [];
      audio = this.audioPlayer(false);
      audio.muted = false;
      audio.volume = this.playLevel;
      audio.src = url;
      audio.onended = finished;
      audio.onerror = failed;
      if (at > 0.05)
        audio.addEventListener(
          "loadedmetadata",
          () => {
            if (live()) audio.currentTime = at;
          },
          { once: true },
        );
      this.currentAudio = audio;
      return audio.play();
    };
    const sounding = () => !audioContext || audioContext.state === "running";
    // Away from the page (another tab or app) a phone browser may leave the audio asleep or
    // refuse to start a sound. That is not a failure: the play waits for the page to come back
    // (a show playing in a row would otherwise end there, line after line).
    let waitingBack = null;
    const afterBack = (then) => {
      document.removeEventListener("visibilitychange", waitingBack);
      waitingBack = () => {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", waitingBack);
        waitingBack = null;
        if (live()) then();
      };
      document.addEventListener("visibilitychange", waitingBack);
    };
    const begin = () => {
      // A phone may leave the context "interrupted", not just suspended, and its resume() may
      // never settle outside a tap: playing is tried after a moment anyway.
      const resume = sounding()
        ? Promise.resolve()
        : Promise.race([
            audioContext.resume(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
      Promise.resolve(resume)
        .then(() => {
          if (!live() || this.playbackPaused) return;
          if (!sounding())
            return document.hidden ? afterBack(begin) : playClean();
          const effectPlayer = audio;
          const clock = audioContext?.currentTime;
          // Running by its state, but its clock doesn't move: a context the browser left stuck.
          // The next tap makes a new one (see unlockAudioForMobile).
          if (audioContext)
            setTimeout(() => {
              if (!live() || this.playbackPaused || audio !== effectPlayer)
                return;
              const stuck = sounding() && audioContext.currentTime === clock;
              if (!stuck && sounding()) return;
              if (document.hidden) return afterBack(begin);
              if (stuck) this.audioContextStuck = audioContext;
              playClean().catch(() => undefined);
            }, 700);
          return audio.play();
        })
        .catch((error) => {
          if (!live() || error.name === "AbortError") return;
          // A file the effect player can't decode may still play as it is.
          if (error.svUnplayable && audio !== this.plainAudioElement)
            return playClean().catch(() => failed());
          if (document.hidden) return afterBack(begin);
          this.notify(
            error.name === "NotAllowedError"
              ? "음성이 준비되었습니다. 브라우저에서 자동 재생을 막았으니 재생 버튼을 한 번 더 눌러 주십시오."
              : `재생 실패: ${error.message}`,
            error.name === "NotAllowedError" ? "info" : "error",
          );
          this.currentAudioStop = null;
          cleanup();
          onStop?.();
        });
    };
    // Back on the page with the voice held where the audio fell asleep: it goes on once the
    // audio wakes (see lifecycle's `back`), or from the clean player if it doesn't.
    const back = () => {
      if (document.hidden || waitingBack) return;
      setTimeout(() => {
        if (
          !live() ||
          this.playbackPaused ||
          sounding() ||
          audio === this.plainAudioElement
        )
          return;
        playClean().catch(() => undefined);
      }, 1500);
    };
    document.addEventListener("visibilitychange", back);
    this.currentAudioAway = () => {
      document.removeEventListener("visibilitychange", back);
      document.removeEventListener("visibilitychange", waitingBack);
    };
    begin();
  },

  /**
   * A phone line's [sfx: name] tags with a sound file: those before its words, and the rest.
   * Tags without a file are not played (the voice was made without them).
   */
  async lineSounds(script) {
    const text = String(script || "");
    const found = [...text.matchAll(/\[sfx:\s*([^\]]+)\]/gi)];
    if (!found.length || !this.soundFor)
      return { before: [], after: [], loops: [] };
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
      if (!file && this.soundEffectsFor?.(speakerKey))
        result += `[${match[1].trim()}]`;
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

  async playWithSounds(
    url,
    script,
    button,
    revoke,
    { mixed = false, ...options } = {},
  ) {
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
    this.sideSounds = (this.sideSounds || []).filter(
      (sound) => !sound.paused && !sound.ended,
    );
    const side = (src, volume, loop = false) => {
      const sound = new Audio(src);
      sound.volume = loop ? 0 : volume;
      sound.loop = loop;
      sound.svVolume = volume;
      sound.play().catch(() => undefined);
      this.sideSounds.push(sound);
      return sound;
    };
    const beds = loops
      .slice(0, 3)
      .map((src, _, all) =>
        side(src, 0.3 * [1, 0.8, 0.65][all.length - 1], true),
      );
    for (const bed of beds) this.fadeSideSound(bed, bed.svVolume, 400);
    if (overlay) for (const src of before) side(src, 0.85);
    const parts = [...(overlay ? [] : before), url, ...(overlay ? [] : after)];
    let index = 0;
    const next = () => {
      if (index >= parts.length) {
        if (overlay) for (const src of after) side(src, 0.85);
        for (const bed of beds)
          this.fadeSideSound(bed, 0, 1800, () => bed.pause());
        return options.onEnded?.();
      }
      const part = parts[index++];
      this.playAudio(part, button, part === url && revoke, {
        ...options,
        // A sound before or after the words isn't the person speaking.
        speaker: part === url ? options.speaker : "",
        onEnded: next,
      });
    };
    next();
  },

  /**
   * 읽는 대사 자막: the line being read, in a strip under 실리태번's top bar. "auto" shows it only
   * for lines read off screen (the original behind a translation). Lines take over from one
   * another without the strip blinking; a line wraps onto a second line, and one longer than
   * two moves up line by line as it is spoken.
   */
  showNowReading(button, audio = null, waiting = false) {
    const mode = this.config.playback?.caption || "always";
    const text = String(button.dataset.text || "").trim();
    // The words on screen for it, when a translation is there and the line as written is read.
    const shown = String(button.dataset.shownText || "").trim();
    // "auto": a line read off screen or in other words than the screen shows, or one whose
    // play buttons are hidden.
    const unseen =
      !button.isConnected ||
      Boolean(shown) ||
      document.body.classList.contains("sv-hide-line-buttons");
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
      bar.title = "누르면 멈춤 · 이어 듣기";
      bar.innerHTML =
        '<span class="sv-now-reading-who" hidden><i class="sv-now-reading-icon fa-solid fa-pause" aria-hidden="true"></i><span class="sv-now-reading-name"></span></span><div class="sv-now-reading-window"><span class="sv-now-reading-lines"><span class="sv-now-reading-text"></span></span><span class="sv-now-reading-sub" hidden></span></div>' +
        '<i class="sv-now-sep" aria-hidden="true"></i><span class="sv-now-steps" hidden><button type="button" data-step="-1" aria-label="앞 대사" title="앞 대사"><i class="fa-solid fa-backward-step" aria-hidden="true"></i></button><button type="button" data-step="1" aria-label="다음 대사" title="다음 대사"><i class="fa-solid fa-forward-step" aria-hidden="true"></i></button></span>' +
        '<button type="button" class="sv-now-close" aria-label="멈추고 닫기" title="멈추고 닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
      bar.addEventListener("click", (event) => {
        const step = event.target.closest("[data-step]");
        if (event.target.closest(".sv-now-close")) this.closeNowReading();
        else if (step) this.stepMessageLine(Number(step.dataset.step));
        else this.togglePause();
      });
      document.body.appendChild(bar);
    }
    this.syncLineSteps();
    // `waiting`: 이어 듣기 has come to a line still being made; the strip shows it as coming.
    bar.classList.toggle("sv-waiting", waiting);
    const icon = bar.querySelector(".sv-now-reading-icon");
    icon?.classList.toggle("fa-spinner", waiting);
    icon?.classList.toggle("fa-spin", waiting);
    icon?.classList.toggle("fa-pause", !waiting && !this.playbackPaused);
    icon?.classList.toggle("fa-play", !waiting && Boolean(this.playbackPaused));
    const bottom = this.config.playback?.caption_at === "bottom";
    bar.classList.toggle("sv-at-bottom", bottom);
    if (bottom) this.placeNowReading(bar);
    const label = bar.querySelector(".sv-now-reading-text");
    const token = (this.nowReadingToken = (this.nowReadingToken || 0) + 1);
    // Who is speaking, in a small tag on the strip's top edge (no room taken from the line).
    const who = bar.querySelector(".sv-now-reading-who");
    // 번역 화면의 자막: the line read, the words on screen in its place, or under it.
    const words = this.config.playback?.caption_translation;
    const other = shown && shown !== text ? shown : "";
    const swap = () => {
      if (token !== this.nowReadingToken) return;
      label.textContent = other && words === "shown" ? other : text;
      const sub = bar.querySelector(".sv-now-reading-sub");
      if (sub) {
        sub.textContent = words === "source" || words === "shown" ? "" : other;
        sub.hidden = !sub.textContent;
        bar.classList.toggle("sv-with-sub", !sub.hidden);
      }
      if (who) {
        who.querySelector(".sv-now-reading-name").textContent = waiting
          ? "생성 중"
          : button.dataset.speakerName || "";
        this.syncNowTag(bar);
      }
      label.classList.toggle("sv-thought", button.dataset.kind === "thought");
      label.classList.remove("sv-scroll");
      label.style.removeProperty("--sv-shift");
      requestAnimationFrame(() => {
        if (token !== this.nowReadingToken) return;
        const room = label.parentElement;
        // (The line height the stylesheet gives the words.)
        const LINE = 22;
        // Measured as a one-line strip (a wide screen has a rule on either side of that one).
        bar.classList.remove("sv-tall");
        bar.classList.toggle("sv-tall", label.offsetHeight > LINE * 1.5);
        // Past two lines: soft edges, and the rest comes up as it is spoken.
        const overflow = label.offsetHeight - room.clientHeight;
        bar.classList.toggle("sv-long", overflow > 4);
        if (overflow > 4 && audio) {
          // The words move up a whole line at a time, so that the line being spoken (by how far
          // the sound is) stays among the two in view.
          const rows = Math.round(overflow / LINE);
          const follow = () => {
            if (token !== this.nowReadingToken) {
              audio.removeEventListener("timeupdate", follow);
              return;
            }
            const length = audio.duration;
            if (!Number.isFinite(length) || length <= 0) return;
            const spoken = (audio.currentTime / length) * (rows + 2);
            const top = Math.min(rows, Math.max(0, Math.floor(spoken - 0.5)));
            label.style.setProperty("--sv-shift", `${-top * LINE}px`);
          };
          audio.addEventListener("timeupdate", follow);
        }
        label.classList.toggle("sv-scroll", overflow > 4);
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

  /**
   * 이어 듣기 waits for a line that is still being made: after a moment (so lines already made
   * don't flash it) the strip shows that line with "생성 중".
   */
  showNowWaiting(button) {
    clearTimeout(this.nowWaitingTimer);
    this.nowWaitingTimer = setTimeout(() => {
      if (this.messageRun) this.showNowReading(button, null, true);
    }, 350);
  },
  /** The wait is over; a strip still saying "생성 중" with nothing to play goes away. */
  endNowWaiting(hide = false) {
    clearTimeout(this.nowWaitingTimer);
    if (
      hide &&
      document
        .getElementById("sv-now-reading")
        ?.classList.contains("sv-waiting")
    )
      this.hideNowReading(true);
  },

  /** The strip's ‹ ›: there while a message's lines play in a row; › is off at the last line. */
  syncLineSteps() {
    const steps = document.querySelector("#sv-now-reading .sv-now-steps");
    if (!steps) return;
    const run = this.messageRun;
    steps.hidden = !run || run.buttons.length < 2;
    if (run)
      steps.lastElementChild.disabled =
        run.state.position >= run.buttons.length - 1;
  },

  /**
   * The strip's ×: the sound stops and the strip goes. For 이어 듣기 it is the message's own stop
   * (the making stops with it, and it goes on from this line when pressed again).
   */
  closeNowReading() {
    clearTimeout(this.nowWaitingTimer);
    const run = this.messageRun;
    const job =
      run &&
      [...this.messageJobs].find(([, held]) => held.playback === run.state);
    if (job) this.queueMessageGeneration(null, job[0]);
    else {
      if (run) run.state.stopped = true;
      this.stopPlayback();
    }
    this.hideNowReading(true);
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
   * 자막 위치 "아래": just above 실리태번's input area (with the QR bar), followed as it grows
   * (a longer message typed, the QR bar wrapping).
   */
  placeNowReading(bar = document.getElementById("sv-now-reading")) {
    if (!bar) return;
    const form = document.getElementById("form_sheld");
    const viewport = window.visualViewport;
    const visibleTop = viewport?.offsetTop || 0;
    const visibleBottom = visibleTop + (viewport?.height || window.innerHeight);
    const rect = form?.getBoundingClientRect();
    // Use one coordinate space: anchor the strip's bottom edge to the input's top.
    // iOS keyboards/browser bars can shrink and move the visible viewport independently.
    const inputTop =
      rect?.height > 0 && rect.top > visibleTop && rect.top < visibleBottom
        ? rect.top
        : visibleBottom - 90;
    const edge = Math.max(
      visibleTop + bar.offsetHeight + 20,
      Math.min(inputTop - 14, visibleBottom - 20),
    );
    bar.style.setProperty("--sv-now-top", `${Math.round(edge)}px`);
    if (this.nowReadingWatch) return;
    // Scrolling fires often: the strip, while shown at the bottom, is placed again at most once a
    // frame (each placing measures the page).
    let queued = false;
    const follow = () => {
      const shown = document.getElementById("sv-now-reading");
      if (
        queued ||
        !shown?.classList.contains("sv-at-bottom") ||
        !shown.classList.contains("sv-shown")
      )
        return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.placeNowReading();
      });
    };
    const watch =
      typeof ResizeObserver === "function" ? new ResizeObserver(follow) : null;
    if (form) watch?.observe(form);
    watch?.observe(bar);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    viewport?.addEventListener("resize", follow);
    viewport?.addEventListener("scroll", follow);
    this.nowReadingWatch = watch || true;
    this.eventCleanups.push(() => {
      watch?.disconnect();
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      viewport?.removeEventListener("resize", follow);
      viewport?.removeEventListener("scroll", follow);
      this.nowReadingWatch = null;
    });
  },

  /**
   * 멈춤 / 이어 듣기 (a tap on the caption strip, or /sv-pause): the voice holds where it is, and
   * the row it is part of waits with it. Nothing playing: nothing to do.
   */
  togglePause() {
    if (!this.currentAudio) return false;
    if (this.playbackPaused) this.resumePlayback();
    else this.pausePlayback();
    return true;
  },

  pausePlayback() {
    const audio = this.currentAudio;
    if (!audio || this.playbackPaused) return;
    this.markPaused(true);
    audio.pause();
    // The radio's music runs in Web Audio, beside the voice: it holds too.
    if (this.radioBeds?.length && this.communicationAudioContext?.suspend) {
      this.pauseSuspended = true;
      this.communicationAudioContext.suspend().catch(() => undefined);
    }
    for (const sound of this.sideSounds || [])
      if (!sound.paused) {
        sound.svHeld = true;
        sound.pause();
      }
  },

  resumePlayback() {
    const audio = this.currentAudio;
    if (!audio || !this.playbackPaused) return;
    this.markPaused(false);
    const context = this.communicationAudioContext;
    if (context && context.state !== "running")
      context.resume().catch(() => undefined);
    audio.play().catch(() => undefined);
    for (const sound of this.sideSounds || [])
      if (sound.svHeld) {
        sound.svHeld = false;
        sound.play().catch(() => undefined);
      }
  },

  /** The strip and the line's button show the pause (▶ to go on). */
  markPaused(paused) {
    if (!paused && !this.playbackPaused) return;
    this.playbackPaused = paused;
    if (!paused && this.pauseSuspended) {
      this.pauseSuspended = false;
      this.communicationAudioContext?.resume().catch(() => undefined);
    }
    this.currentPlayButton?.classList?.toggle("sv-paused", paused);
    const bar = document.getElementById("sv-now-reading");
    if (!bar) return;
    bar.classList.toggle("sv-paused", paused);
    const icon = bar.querySelector(".sv-now-reading-icon");
    icon?.classList.toggle("fa-pause", !paused);
    icon?.classList.toggle("fa-play", paused);
    this.syncNowTag(bar);
  },

  /**
   * The tag on the strip's top edge: the speaker's name, with ▶ before it while paused (the tag
   * alone carries it when there is no name) and a spinner while the line is being made.
   */
  syncNowTag(bar) {
    const who = bar.querySelector(".sv-now-reading-who");
    if (!who) return;
    who.hidden =
      !who.querySelector(".sv-now-reading-name")?.textContent &&
      !bar.classList.contains("sv-paused");
  },

  /** /sv-pause: the same 멈춤 / 이어 듣기, for a QR button (or typed). */
  registerPauseCommand() {
    const { SlashCommandParser, SlashCommand } = stOf(this) || {};
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps)
      return;
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sv-pause",
        callback: () => {
          this.togglePause();
          return "";
        },
        helpString:
          "씬보이스: 지금 읽는 음성을 멈추고, 한 번 더 하면 멈춘 곳부터 이어 듣습니다.",
      }),
    );
  },

  /** QR에 추가: a "SceneVoice" quick reply set with the ⏸ button, shown on the QR bar. */
  async addPauseQuickReply() {
    const api = globalThis.quickReplyApi;
    if (!api?.createQuickReply)
      throw new Error(
        "실리태번의 빠른 답장(Quick Reply) 확장을 찾을 수 없습니다.",
      );
    const set = "SceneVoice";
    const label = "씬보이스 멈춤·이어 듣기";
    if (!api.getSetByName(set)) await api.createSet(set);
    if (!api.getQrByLabel(set, label))
      api.createQuickReply(set, label, {
        icon: "fa-pause",
        showLabel: false,
        message: "/sv-pause",
        title: "씬보이스 멈춤 · 이어 듣기",
      });
    api.addGlobalSet(set, true);
    this.notify(
      api.settings?.isEnabled === false
        ? "QR 세트 ‘SceneVoice’에 ⏸ 버튼을 넣었습니다. 빠른 답장 확장이 꺼져 있어서, 켜야 버튼이 보입니다."
        : "QR 바에 ⏸ 버튼을 넣었습니다(세트 ‘SceneVoice’). 빼려면 빠른 답장 설정에서 세트를 지우면 됩니다.",
      "success",
    );
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
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (
        AudioContextClass &&
        (!this.communicationAudioContext ||
          this.communicationAudioContext.state === "closed")
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
    // A context found stuck (see playAudio) is given up for a new one, made here in a tap.
    const stuck = this.audioContextStuck;
    this.audioContextStuck = null;
    if (stuck && stuck === this.communicationAudioContext) {
      this.communicationAudioContext = null;
      Promise.resolve(stuck.close?.()).catch(() => undefined);
    }
    const context = this.ensureAudioContext();
    if (context && context.state !== "running")
      context.resume().catch(() => undefined);
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
