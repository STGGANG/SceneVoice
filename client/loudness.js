// 음량 맞춤: voices come at different loudness. Each voice's chat lines are measured as they
// play, and a voice louder than the quietest one known is turned down towards it. Only ever
// down (a boost could clip), only by a little, and only in playback: the saved files stay as made.

const STORE = "scenevoice_voice_levels";
const MAX_CUT_DB = 6;
// A difference smaller than this is left alone.
const SLACK_DB = 1.5;

/** Loudness of the sounding part of a clip, in dB (the silence between words left out). */
export function activeLevel(samples, sampleRate) {
  const size = Math.max(1, Math.round(sampleRate * 0.05));
  const frames = [];
  for (let at = 0; at + size <= samples.length; at += size) {
    let sum = 0;
    for (let index = at; index < at + size; index++)
      sum += samples[index] * samples[index];
    frames.push(sum / size);
  }
  const loudest = Math.max(0, ...frames);
  if (!(loudest > 1e-8)) return null;
  const sounding = frames.filter((power) => power > loudest * 1e-3);
  return (
    10 *
    Math.log10(
      sounding.reduce((sum, power) => sum + power, 0) / sounding.length,
    )
  );
}

/**
 * How much to turn a voice down, as a gain (1: as it is). `levels` is { key: { db, n } }: each
 * voice's average and how many lines it is drawn from. A voice heard only once or twice is not
 * yet taken for the quietest, and its own cut comes in over its first lines.
 */
export function levelCut(levels = {}, key = "") {
  const own = levels[key];
  if (!own || own.n < 2) return 1;
  const settled = Object.values(levels).filter((item) => item.n >= 3);
  if (!settled.length) return 1;
  const over = own.db - Math.min(...settled.map((item) => item.db));
  if (!(over >= SLACK_DB)) return 1;
  return 10 ** (-(Math.min(MAX_CUT_DB, over) * Math.min(1, own.n / 3)) / 20);
}

/** A line's level joins its voice's average (a running mean, then a slow-moving one). */
export function addLevel(levels, key, db) {
  const own = levels[key] || { db, n: 0 };
  const n = Math.min(own.n + 1, 20);
  return { ...levels, [key]: { db: own.db + (db - own.db) / n, n } };
}

export const loudness = {
  measuredLines: new Set(),

  /** The voice a chat line is measured under. Thoughts are left out: they are quiet by design. */
  levelKey(button) {
    const name = button?.dataset?.speakerName;
    return name && button.dataset.kind !== "thought" ? name : "";
  },

  voiceLevels() {
    if (!this.levelStore) {
      try {
        this.levelStore = JSON.parse(localStorage.getItem(STORE) || "{}") || {};
      } catch {
        this.levelStore = {};
      }
    }
    return this.levelStore;
  },

  lineLevel(button) {
    if (this.config.playback?.level === false) return 1;
    const key = this.levelKey(button);
    return key ? levelCut(this.voiceLevels(), key) : 1;
  },

  /** Measures a line the first time it plays here. Quiet work: a failure only means no figure. */
  async noteLineLevel(button) {
    const key = this.levelKey(button);
    const url = button?.dataset?.audioUrl;
    if (
      !key ||
      !url ||
      this.config.playback?.level === false ||
      this.measuredLines.has(url)
    )
      return;
    this.measuredLines.add(url);
    try {
      const context = this.effectContext();
      if (!context) return;
      const bytes = await (await fetch(url)).arrayBuffer();
      // The callback form too: Safari before 14.1 has no promise here.
      const audio = await new Promise((resolve, reject) => {
        context.decodeAudioData(bytes, resolve, reject)?.catch?.(reject);
      });
      const db = activeLevel(audio.getChannelData(0), audio.sampleRate);
      if (db === null) return;
      const levels = Object.fromEntries(
        Object.entries(addLevel(this.voiceLevels(), key, db)).slice(-200),
      );
      this.levelStore = levels;
      try {
        localStorage.setItem(STORE, JSON.stringify(levels));
      } catch {
        // Kept for this visit only.
      }
    } catch {
      this.measuredLines.delete(url);
    }
  },
};
