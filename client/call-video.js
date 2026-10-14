// 통화 영상: the call screen drawn on a canvas with the call's voices, as one video file. Made
// directly (WebCodecs, much faster than the call) where the browser can encode H.264 and AAC,
// otherwise recorded in real time.
import { mp4Parts } from "./mp4.js";

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 15;
const LEAD = 0.8;
const GAP = 0.5;
const TAIL = 1.2;
const BUTTON_Y = 1196;
const BUTTON_R = 44;
const VIDEO_CONFIG = { codec: "avc1.42001f", width: WIDTH, height: HEIGHT, bitrate: 1_500_000, framerate: FPS, avc: { format: "avc" } };
const AUDIO_CODEC = "mp4a.40.2";
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const FONT =
  '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Hiragino Sans", "Malgun Gothic", system-ui, sans-serif';

const recordingType = () =>
  [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";

const clock = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

// A line of mine without a voice stays on screen about as long as it takes to read.
const readingSeconds = (text) => Math.min(12, Math.max(1.6, 1.2 + Array.from(String(text || "")).length * 0.09));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lines that fit `width`: broken at spaces, or anywhere for text without them (Japanese, Chinese). */
function wrap(ctx, text, width) {
  const lines = [];
  for (const paragraph of String(text || "").split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\S+\s*|\s+/g) || []) {
      if (ctx.measureText(line + token).width <= width) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      for (const char of token) {
        if (ctx.measureText(line + char).width > width && line) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines;
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

function canvasOf(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The picture drawn to cover a w×h canvas. */
function cover(image, width, height) {
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext("2d");
  const scale = Math.max(width / image.width, height / image.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
  return canvas;
}

/** Some WebKit builds accept ctx.filter but draw nothing different: test that it really blurs. */
function canvasBlurWorks() {
  const ctx = canvasOf(20, 20).getContext("2d", { willReadFrequently: true });
  ctx.filter = "blur(4px)";
  ctx.fillRect(8, 8, 4, 4);
  return ctx.getImageData(3, 10, 1, 1).data[3] > 0;
}

/**
 * Drawn once. A canvas blur filter where it works; otherwise the picture is shrunk and grown
 * back in steps (one big step leaves blocks).
 */
function backdrop(image) {
  const canvas = canvasOf(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "#2a3651");
  gradient.addColorStop(0.55, "#121826");
  gradient.addColorStop(1, "#07090e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (!image) return canvas;
  if (canvasBlurWorks()) {
    ctx.filter = "blur(36px)";
    ctx.drawImage(cover(image, WIDTH + 160, HEIGHT + 160), -80, -80);
    ctx.filter = "none";
  } else {
    let step = cover(image, 24, 43);
    for (const [width, height] of [[48, 85], [96, 171], [192, 341], [WIDTH, HEIGHT]]) {
      const next = canvasOf(width, height);
      const draw = next.getContext("2d");
      draw.imageSmoothingQuality = "high";
      draw.drawImage(step, 0, 0, width, height);
      step = next;
    }
    ctx.drawImage(step, 0, 0);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas;
}

function avatar(image, name, size) {
  const canvas = canvasOf(size, size);
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    ctx.drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale);
  } else {
    ctx.fillStyle = "#3a4255";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(size * 0.42)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Array.from(String(name || "?").trim())[0] || "?", size / 2, size / 2 + 2);
  }
  return canvas;
}

const canEncode = () =>
  ["VideoEncoder", "AudioEncoder", "VideoFrame", "AudioData"].every((name) => typeof window[name] === "function");

async function encodesHere(rate) {
  if (!canEncode()) return false;
  try {
    const [video, sound] = await Promise.all([
      VideoEncoder.isConfigSupported(VIDEO_CONFIG),
      AudioEncoder.isConfigSupported({ codec: AUDIO_CODEC, sampleRate: rate, numberOfChannels: 1, bitrate: 128_000 }),
    ]);
    return Boolean(video.supported && sound.supported);
  } catch {
    return false;
  }
}

const bytesOf = (source) =>
  source instanceof ArrayBuffer ? new Uint8Array(source.slice(0)) : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));

/** Made directly, as fast as the browser encodes: the frames one by one and the voices at once. */
async function encodeVideo(canvas, draw, track, duration, view) {
  const rate = track.sampleRate;
  const video = { width: WIDTH, height: HEIGHT, timescale: 90000, samples: [], durations: [], description: null };
  const sound = { timescale: rate, channels: 1, samples: [], durations: [], description: null };
  let failed = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description) video.description = bytesOf(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      video.samples.push({ data, key: chunk.type === "key" });
    },
    error: (error) => (failed = error),
  });
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description) sound.description = bytesOf(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      sound.samples.push({ data });
      sound.durations.push(1024);
    },
    error: (error) => (failed = error),
  });
  const close = () => {
    for (const encoder of [videoEncoder, audioEncoder]) if (encoder.state !== "closed") encoder.close();
  };
  try {
    videoEncoder.configure(VIDEO_CONFIG);
    audioEncoder.configure({ codec: AUDIO_CODEC, sampleRate: rate, numberOfChannels: 1, bitrate: 128_000 });
    const pcm = track.getChannelData(0);
    for (let at = 0; at < pcm.length; at += rate) {
      const part = pcm.slice(at, Math.min(pcm.length, at + rate));
      const data = new AudioData({
        format: "f32-planar",
        sampleRate: rate,
        numberOfFrames: part.length,
        numberOfChannels: 1,
        timestamp: Math.round((at / rate) * 1e6),
        data: part,
      });
      audioEncoder.encode(data);
      data.close();
    }
    const frames = Math.ceil(duration * FPS);
    for (let index = 0; index < frames; index++) {
      if (view.cancelled) return null;
      if (failed) throw failed;
      draw(index / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      videoEncoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 });
      frame.close();
      video.durations.push(90000 / FPS);
      view.progress(index / frames);
      // Lets the encoder keep up and the page stay responsive.
      while (videoEncoder.encodeQueueSize > 6) await new Promise((resolve) => setTimeout(resolve, 4));
      if (index % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    if (failed) throw failed;
    if (!video.description) throw new Error("영상 설정을 받지 못했습니다.");
    if (!sound.description) {
      // AAC-LC, mono: the setup some encoders leave out.
      const index = Math.max(0, AAC_RATES.indexOf(rate));
      sound.description = Uint8Array.from([(2 << 3) | (index >> 1), ((index & 1) << 7) | (1 << 3)]);
    }
    return new Blob(mp4Parts(video, sound), { type: "video/mp4" });
  } finally {
    close();
  }
}

export const callVideo = {
  canMakeCallVideo() {
    if (!(window.AudioContext || window.webkitAudioContext)) return false;
    return canEncode() || Boolean(recordingType() && typeof HTMLCanvasElement.prototype.captureStream === "function");
  },

  /** 영상 of a past call. */
  async downloadCallVideo(body, session, away = false) {
    const current = await this.makeRecordingVideo({
      heading: "통화 영상 만들기",
      scene: session,
      gather: (onStep) => this.callClips(session, onStep, { captions: true }),
      name: this.callFileName(session),
    });
    if (current && current !== session && body.isConnected) this.renderPhoneHistoryDetail(body, current, away);
  },

  /**
   * Gathers the voices (`gather(onStep)`, asking before making missing ones), draws `scene` (a
   * call, or the radio: `call_direction` "radio") over them and saves the video. Returns what
   * `gather` gave as `current` (a call with the voices made meanwhile).
   */
  async makeRecordingVideo({ heading, scene, gather, name, trackOptions = null }) {
    if (!this.canMakeCallVideo()) throw new Error("이 브라우저에서는 영상을 만들 수 없습니다.");
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    // Made and resumed within the click, or phones keep it silent.
    const audio = new AudioContextClass();
    audio.resume?.();
    const view = this.openCallVideoDialog(heading);
    let gathered = { clips: [], left: 0 };
    try {
      gathered = await gather((done, total) => view.status(`목소리 준비 중 ${done + 1}/${total}`));
      if (!gathered.clips.some((clip) => clip.url)) throw new Error("영상에 넣을 음성이 없습니다.");
      const blob = await this.recordCallVideo(scene, gathered.clips, audio, view, await trackOptions?.(audio));
      if (blob) {
        const type = blob.type.includes("mp4") ? "mp4" : "webm";
        this.saveFile(blob, `${name}.${type}`);
        if (gathered.left) this.notify(`목소리가 없는 대사 ${gathered.left}개는 빠졌습니다.`, "info");
      }
    } finally {
      for (const clip of gathered.clips) if (clip.revoke) URL.revokeObjectURL(clip.url);
      audio.close?.();
      view.close();
    }
    return gathered.current;
  },

  openCallVideoDialog(heading = "통화 영상 만들기") {
    document.getElementById("sv-video-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-video-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-film"></i></span>
        <div><h3>${heading}</h3><small data-video-status>준비 중…</small></div>
      </header>
      <div class="sv-video-preview" data-video-preview></div>
      <div class="sv-video-bar" aria-hidden="true"><i data-video-bar></i></div>
      <p class="sv-hint" data-video-hint>다 될 때까지 이 화면을 띄워 두십시오. 다른 탭으로 가거나 화면을 끄면 잠시 멈췄다가, 돌아오면 이어서 만듭니다.</p>
      <footer class="sv-dialog-actions"><button type="button" class="sv-btn" data-video-cancel>멈추기</button></footer>
    </form>`;
    document.body.append(dialog);
    const view = {
      cancelled: false,
      onCancel: () => {},
      status: (text) => {
        dialog.querySelector("[data-video-status]").textContent = text;
      },
      hint: (text) => {
        dialog.querySelector("[data-video-hint]").textContent = text;
      },
      progress: (share) => {
        dialog.querySelector("[data-video-bar]").style.width = `${Math.round(Math.min(1, share) * 100)}%`;
      },
      show: (canvas) => dialog.querySelector("[data-video-preview]").append(canvas),
      close: () => dialog.remove(),
    };
    const cancel = () => {
      view.cancelled = true;
      view.onCancel();
    };
    dialog.querySelector("[data-video-cancel]").addEventListener("click", cancel);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    dialog.showModal();
    return view;
  },

  /**
   * The voices on one timeline (with the phone sound where it applies) and when each line plays.
   * `lead`, `gap`, `tail`: seconds before, between and after the lines; `mix(data, rate, lines)`
   * lays more on top (the radio's music).
   */
  async callVideoTrack(clips, audio, { lead = LEAD, gap = GAP, tail = TAIL, mix = null } = {}) {
    const decoded = [];
    for (const clip of clips) {
      if (clip.silent) {
        decoded.push({ seconds: readingSeconds(clip.turn.text), turn: clip.turn });
        continue;
      }
      const response = await fetch(clip.url);
      if (!response.ok) throw new Error(`음성 파일을 읽지 못했습니다 (${response.status}).`);
      const bytes = await response.arrayBuffer();
      let buffer = await new Promise((resolve, reject) => audio.decodeAudioData(bytes, resolve, reject));
      if (clip.filter) buffer = await this.renderCommunicationFilter(buffer, { radio: clip.radio });
      decoded.push({ buffer, turn: clip.turn });
    }
    const rate = audio.sampleRate;
    const frames = (seconds) => Math.round(seconds * rate);
    const lengthOf = ({ buffer, seconds }) => Math.ceil((buffer ? buffer.duration : seconds) * rate);
    const total =
      frames(lead + tail) +
      decoded.reduce((sum, item) => sum + lengthOf(item), 0) +
      frames(gap) * Math.max(0, decoded.length - 1);
    const track = audio.createBuffer(1, total, rate);
    const data = track.getChannelData(0);
    const lines = [];
    let at = frames(lead);
    for (const item of decoded) {
      const { buffer, turn } = item;
      const length = lengthOf(item);
      // A remark in the background on the call sounds fainter.
      const level = turn.aside ? 0.45 : 1;
      for (let channel = 0; channel < (buffer?.numberOfChannels || 0); channel++) {
        const source = buffer.getChannelData(channel);
        const step = buffer.sampleRate / rate;
        for (let i = 0; i < length; i++) data[at + i] += ((source[Math.floor(i * step)] || 0) * level) / buffer.numberOfChannels;
      }
      lines.push({ start: at / rate, end: (at + length) / rate, turn });
      at += length + frames(gap);
    }
    mix?.(data, rate, lines);
    return { track, lines, duration: total / rate };
  },

  async recordCallVideo(session, clips, audio, view, trackOptions = {}) {
    view.status("소리 준비 중…");
    const { track, lines, duration } = await this.callVideoTrack(clips, audio, trackOptions);
    if (view.cancelled) return null;
    const { canvas, draw } = await this.callVideoScene(session, lines);
    view.show(canvas);
    if (await encodesHere(track.sampleRate)) {
      view.status("영상 만드는 중…");
      view.hint("보통 금방 끝납니다. 다 될 때까지 이 화면을 띄워 두십시오.");
      try {
        return await encodeVideo(canvas, draw, track, duration, view);
      } catch (error) {
        // Recorded the slow way instead.
        console.warn("[SceneVoice] call video encoding failed", error);
      }
    }
    view.hint("통화 길이만큼 걸립니다. 다 될 때까지 이 화면을 띄워 두십시오. 다른 탭으로 가거나 화면을 끄면 잠시 멈췄다가, 돌아오면 이어서 만듭니다.");
    return this.recordCallVideoLive(canvas, draw, track, duration, audio, view);
  },

  /**
   * The call screen: who is on the call, the time, and the line being said (`draw(time)`). The
   * radio: its set at the top (ON AIR, the frequency on its dial), the hosts and the title, a
   * level meter that moves while someone talks, and no end-call button.
   */
  async callVideoScene(session, lines) {
    const between = session.call_direction === "overheard";
    const radio = session.call_direction === "radio";
    // Everyone on the call but my character, up to four pictures in a row.
    const people = (this.callMembers?.(session) || [this.phoneContact(session.character_key)]).slice(0, 4);
    const images = await Promise.all(people.map((person) => loadImage(person?.avatarUrl)));
    const background = backdrop(images[0]);
    // The radio has its set at the top, so everything under it sits lower and a little smaller.
    const size = (radio ? [170, 150, 130, 115] : [220, 180, 150, 130])[people.length - 1];
    const faceY = radio ? 432 : 300;
    const titleY = radio ? 594 : 490;
    const statusY = radio ? 640 : 540;
    const faces = people.map((person, index) => avatar(images[index], person?.name, size));
    const me = this.userCharacterName?.() || "나";
    const speakerOf = (turn) =>
      turn.role === "user" ? me : `${turn.speaker_name || session.character_name || ""}${turn.caller ? " · 전화 연결" : ""}`;
    const title = radio
      ? session.radio_title
      : (this.callNames?.(session) || [session.character_name || ""]).join(", ");

    const canvas = canvasOf(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    let caption = null;
    // The caption stays clear of the end-call button (the radio has none). A long line gets
    // smaller letters; one too long even then shows a part at a time while it is said, never cut.
    const top = radio ? 740 : 610;
    const room = (radio ? HEIGHT - 50 : BUTTON_Y - BUTTON_R - 24) - top;
    // The level meter in the phone's accent (the theme's colour when it has one).
    const accent =
      getComputedStyle(document.getElementById("sv-smartphone") || document.body).getPropertyValue("--ph-blue").trim() || "#0a84ff";
    const needle = Math.min(1, Math.max(0, (Number(session.radio_frequency) - 88) / 20));
    // ON AIR, the frequency, and the dial with its needle, as on the phone.
    const radioSet = () => {
      const x = 60;
      const y = 118;
      const w = 600;
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      roundRect(ctx, x, y, w, 196, 36);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = "rgba(255, 59, 48, 0.65)";
      ctx.shadowBlur = 26;
      ctx.fillStyle = "#ff3b30";
      roundRect(ctx, x + 36, y + 36, 152, 52, 12);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 26px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ON AIR", x + 36 + 76, y + 36 + 27);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "right";
      const right = x + w - 36;
      const base = y + 86;
      ctx.font = `700 24px ${FONT}`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillText("MHz", right, base);
      const unit = ctx.measureText("MHz").width + 12;
      ctx.font = `700 66px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(session.radio_frequency, right - unit, base);
      const number = ctx.measureText(session.radio_frequency).width + 12;
      ctx.font = `700 24px ${FONT}`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillText("FM", right - unit - number, base);
      const left = x + 40;
      const span = w - 80;
      const dial = y + 124;
      ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
      for (let tick = 0; tick <= 10; tick++) ctx.fillRect(left + (span * tick) / 10 - 1, dial, 2, 16);
      ctx.font = `500 20px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255, 255, 255, 0.66)";
      [88, 92, 96, 100, 104, 108].forEach((mark, index) => ctx.fillText(String(mark), left + (span * index) / 5, dial + 48));
      ctx.fillStyle = "#ff3b30";
      roundRect(ctx, left + span * needle - 2, dial - 7, 4, 32, 2);
      ctx.fill();
    };
    // Bars that move only while someone is talking.
    const meter = (time, talking) => {
      const bars = 9;
      const barWidth = 8;
      const gap = 8;
      const tall = 54;
      const from = 360 - (bars * barWidth + (bars - 1) * gap) / 2;
      ctx.fillStyle = accent;
      ctx.globalAlpha = talking ? 0.9 : 0.55;
      for (let bar = 0; bar < bars; bar++) {
        const swing = talking ? 0.22 + 0.78 * Math.abs(Math.sin(time * (5 + (bar % 3) * 1.7) + bar * 1.3)) : 0.18;
        const height = tall * swing;
        roundRect(ctx, from + bar * (barWidth + gap), 690 - height / 2, barWidth, height, 4);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const layout = (line) => {
      const sizes = [36, 32, 28];
      for (const size of sizes) {
        const small = Math.round(size * 0.75);
        const step = Math.round(size * 1.39);
        const smallStep = Math.round(small * 1.41);
        const height = (count, under) =>
          (count
            ? 76 + size + (count - 1) * step + (under ? smallStep + 16 + (under - 1) * smallStep : 0)
            : 76 + small + (under - 1) * smallStep) + 50;
        ctx.font = `500 ${size}px ${FONT}`;
        const text = wrap(ctx, line.turn.text, 560);
        ctx.font = `400 ${small}px ${FONT}`;
        const translation = line.turn.translation ? wrap(ctx, line.turn.translation, 560) : [];
        if (height(text.length, translation.length) > room && size !== sizes.at(-1)) continue;
        let count = 1;
        while (height(Math.ceil(text.length / count), Math.ceil(translation.length / count)) > room) count++;
        const part = (list, at) => {
          const per = Math.ceil(list.length / count);
          return list.slice(at * per, (at + 1) * per);
        };
        const pages = Array.from({ length: count }, (_, at) => ({ text: part(text, at), translation: part(translation, at) }));
        // Each part stays up for its share of the words.
        const weights = pages.map((page) => page.text.join("").length + page.translation.join("").length / 3 + 1);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let reached = 0;
        for (const [at, page] of pages.entries()) {
          page.height = height(page.text.length, page.translation.length);
          reached += weights[at] / total;
          page.until = reached;
        }
        return { line, pages, size, small, step, smallStep };
      }
    };
    const draw = (time) => {
      ctx.drawImage(background, 0, 0);
      if (radio) radioSet();
      const gap = 20;
      const row = faces.length * size + (faces.length - 1) * gap;
      faces.forEach((face, index) => ctx.drawImage(face, 360 - row / 2 + index * (size + gap), faceY - size / 2));
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${people.length > 1 ? 44 : 54}px ${FONT}`;
      ctx.fillText(title, 360, titleY, 660);
      ctx.font = `500 27px ${FONT}`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
      if (radio) ctx.fillText(`${(this.callNames?.(session) || []).join(", ")} · ${clock(time)}`, 360, statusY, 660);
      else {
        const status = `${between ? "엿듣는 중" : "통화 중"} · ${clock(time)}`;
        const width = ctx.measureText(status).width;
        ctx.fillText(status, 360 + 12, statusY);
        ctx.fillStyle = "#34c759";
        ctx.beginPath();
        ctx.arc(360 - width / 2 - 6, statusY - 9, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      const current = [...lines].reverse().find((line) => time >= line.start) || null;
      if (radio) meter(time, Boolean(current) && time < current.end);
      if (current && caption?.line !== current) caption = layout(current);
      if (current) {
        const { size, small, step, smallStep } = caption;
        const said = (time - current.start) / Math.max(0.001, current.end - current.start);
        const page = caption.pages.find((item) => said < item.until) || caption.pages.at(-1);
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        roundRect(ctx, 40, top, 640, page.height, 36);
        ctx.fill();
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
        ctx.font = `600 24px ${FONT}`;
        ctx.fillText(speakerOf(current.turn), 80, top + 56);
        ctx.fillStyle = "#ffffff";
        ctx.font = `500 ${size}px ${FONT}`;
        const first = top + 76 + size;
        page.text.forEach((text, index) => ctx.fillText(text, 80, first + index * step));
        if (page.translation.length) {
          const from = page.text.length ? first + (page.text.length - 1) * step + smallStep + 16 : top + 76 + small;
          ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
          ctx.font = `400 ${small}px ${FONT}`;
          page.translation.forEach((text, index) => ctx.fillText(text, 80, from + index * smallStep));
        }
      }
      if (radio) return;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.arc(360, BUTTON_Y, BUTTON_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, 360 - 26, BUTTON_Y - 6, 52, 12, 6);
      ctx.fill();
    };
    draw(0);
    return { canvas, draw };
  },

  /** Recorded while the voices play, where the browser can't encode the video itself. */
  async recordCallVideoLive(canvas, draw, track, duration, audio, view) {
    const output = audio.createMediaStreamDestination();
    const mute = audio.createGain();
    mute.gain.value = 0;
    const source = audio.createBufferSource();
    source.buffer = track;
    source.connect(output);
    source.connect(mute).connect(audio.destination);
    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...output.stream.getAudioTracks()]);
    const type = recordingType();
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 128_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });

    await audio.resume?.();
    recorder.start(1000);
    const startAt = audio.currentTime + 0.25;
    source.start(startAt);
    view.status("영상 만드는 중…");
    const finish = () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", away);
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((item) => item.stop());
    };
    // A hidden page stops drawing and may stop sound: both pause together and go on together.
    const away = () => {
      if (document.hidden) {
        if (recorder.state === "recording") recorder.pause();
        audio.suspend?.();
        view.status("화면을 벗어나서 잠시 멈췄습니다");
      } else {
        audio.resume?.();
        if (recorder.state === "paused") recorder.resume();
        view.status("영상 만드는 중…");
      }
    };
    document.addEventListener("visibilitychange", away);
    const timer = setInterval(() => {
      const time = Math.max(0, audio.currentTime - startAt);
      draw(time);
      view.progress(time / duration);
      if (time >= duration) finish();
    }, 1000 / FPS);
    view.onCancel = finish;
    await stopped;
    try {
      source.stop();
    } catch {
      /* already ended */
    }
    if (view.cancelled) return null;
    return new Blob(chunks, { type: (recorder.mimeType || type).split(";")[0] });
  },
};
