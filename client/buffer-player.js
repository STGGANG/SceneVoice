// The player for voices that go through effects. An <audio> element sent into Web Audio loses
// the start of every play in WebKit (Safari, every iPhone browser): about a tenth of a second,
// again after each pause. A decoded buffer starts on its first sample everywhere.

/** Decoded audio; the callback form too (Safari before 14.1 has no promise here). */
export const decodeAudio = (context, bytes) =>
  new Promise((resolve, reject) => {
    context.decodeAudioData(bytes, resolve, reject)?.catch?.(reject);
  });

const TICK = 200;

// An iPhone in silent mode mutes Web Audio unless the page is also playing media. A second of
// silence in a loop, in an element beside the voice, makes it count as that (as the voice did
// while it was an element itself).
let silence = "";
const silentLoop = () => {
  if (!silence) {
    const bytes = new Uint8Array(44 + 8000).fill(128);
    const view = new DataView(bytes.buffer);
    const word = (at, text) =>
      [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    word(0, "RIFF");
    view.setUint32(4, 36 + 8000, true);
    word(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    word(36, "data");
    view.setUint32(40, 8000, true);
    silence = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  }
  const audio = new Audio(silence);
  audio.loop = true;
  return audio;
};

/**
 * The parts of an <audio> element the extension uses (src, play, pause, currentTime, duration,
 * paused, muted, onended, timeupdate), sounding only through `svSource`: the node the effects
 * are wired from. A file that can't be fetched or decoded makes play() reject with
 * `svUnplayable` set, and the caller hands it to the clean player.
 */
export class BufferPlayer extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.svSource = context.createGain();
    // Needs no tap of its own to be allowed to sound; its silent element does (see bless).
    this.svBlessed = true;
    this.keeper = silentLoop();
    this.blessed = false;
    this.onended = null;
    this.onerror = null;
    this.volume = 1;
    this.url = "";
    this.buffer = null;
    this.loading = null;
    this.node = null;
    this.offset = 0;
    this.startedAt = 0;
    this.ticker = 0;
    this.wanted = 0;
  }

  get src() {
    return this.url;
  }

  set src(url) {
    this.halt();
    this.wanted += 1;
    this.offset = 0;
    if (url === this.url && this.buffer) return;
    this.url = String(url || "");
    this.buffer = null;
    // Fetched now: an object URL may be released once its play is over.
    const loading = fetch(this.url)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then((bytes) => decodeAudio(this.context, bytes))
      .then((buffer) => {
        if (this.loading !== loading) return buffer;
        this.buffer = buffer;
        this.dispatchEvent(new Event("loadedmetadata"));
        return buffer;
      });
    loading.catch(() => undefined);
    this.loading = loading;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : NaN;
  }

  get paused() {
    return !this.node;
  }

  get muted() {
    return this.svSource.gain.value === 0;
  }

  set muted(value) {
    this.svSource.gain.value = value ? 0 : 1;
  }

  get currentTime() {
    if (!this.node) return this.offset;
    return Math.min(
      this.buffer.duration,
      this.offset + this.context.currentTime - this.startedAt,
    );
  }

  set currentTime(value) {
    const playing = Boolean(this.node);
    this.halt();
    this.offset = Math.max(0, Number(value) || 0);
    if (playing && this.buffer) this.start();
  }

  async play() {
    if (this.node) return;
    const wanted = (this.wanted += 1);
    const aborted = () => {
      if (this.wanted !== wanted)
        throw new DOMException("The play was interrupted.", "AbortError");
    };
    let buffer;
    try {
      buffer = await this.loading;
    } catch (error) {
      aborted();
      throw Object.assign(new Error("The audio could not be decoded."), {
        svUnplayable: true,
        cause: error,
      });
    }
    aborted();
    this.buffer = buffer;
    this.start();
  }

  /**
   * Called in a tap: the silent element plays for a moment, so a phone lets it play later
   * beside a voice that starts by itself.
   */
  bless() {
    if (this.blessed || this.node) return;
    this.blessed = true;
    Promise.resolve(this.keeper.play())
      .then(() => {
        if (!this.node) this.keeper.pause();
      })
      .catch(() => {
        this.blessed = false;
      });
  }

  pause() {
    this.wanted += 1;
    if (!this.node) return;
    const at = this.currentTime;
    this.halt();
    this.offset = at;
  }

  start() {
    const from = this.offset >= this.buffer.duration ? 0 : this.offset;
    const node = this.context.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.svSource);
    node.onended = () => {
      if (this.node !== node) return;
      this.halt();
      this.offset = this.buffer.duration;
      this.dispatchEvent(new Event("timeupdate"));
      this.dispatchEvent(new Event("ended"));
      this.onended?.();
    };
    this.node = node;
    this.offset = from;
    this.startedAt = this.context.currentTime;
    node.start(0, from);
    Promise.resolve(this.keeper.play()).catch(() => undefined);
    this.ticker = setInterval(
      () => this.dispatchEvent(new Event("timeupdate")),
      TICK,
    );
  }

  /** The sound stops where it is; where that was is the caller's to keep. */
  halt() {
    clearInterval(this.ticker);
    const node = this.node;
    this.node = null;
    if (!node) return;
    this.keeper.pause();
    node.onended = null;
    try {
      node.stop();
    } catch {
      /* already over */
    }
    node.disconnect();
  }
}
