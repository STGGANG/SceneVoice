// A small MP4 writer for the call video: one H.264 track and one AAC track, each one run of
// samples in the file, with the index (moov) ahead of the data so players can start at once.

const ascii = (value) => Array.from(value, (char) => char.charCodeAt(0));
const u16 = (value) => [(value >>> 8) & 255, value & 255];
const u32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const zeros = (count) => new Array(count).fill(0);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

function box(type, ...parts) {
  const bytes = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const size = 8 + bytes.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  out.set([...u32(size), ...ascii(type)]);
  let at = 8;
  for (const part of bytes) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
const fullBox = (type, version, flags, ...parts) => box(type, [version, ...u32(flags).slice(1)], ...parts);

// Run-length sample durations.
function stts(durations) {
  const runs = [];
  for (const duration of durations) {
    const last = runs.at(-1);
    if (last && last[1] === duration) last[0]++;
    else runs.push([1, duration]);
  }
  return fullBox("stts", 0, 0, u32(runs.length), runs.flatMap(([count, duration]) => [...u32(count), ...u32(duration)]));
}

function sampleTable(entry, track, offset) {
  const keys = track.keys ? track.samples.flatMap((sample, index) => (sample.key ? [index + 1] : [])) : null;
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    stts(track.durations),
    ...(keys ? [fullBox("stss", 0, 0, u32(keys.length), keys.flatMap(u32))] : []),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(track.samples.length), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(track.samples.length), track.samples.flatMap((sample) => u32(sample.data.length))),
    fullBox("stco", 0, 0, u32(1), u32(offset)),
  );
}

function trak(id, track, offset) {
  const video = track.kind === "video";
  const length = track.durations.reduce((sum, duration) => sum + duration, 0);
  const movieLength = Math.round((length / track.timescale) * 1000);
  const entry = video
    ? box(
        "avc1",
        zeros(6),
        u16(1),
        zeros(16),
        u16(track.width),
        u16(track.height),
        u32(0x00480000),
        u32(0x00480000),
        zeros(4),
        u16(1),
        zeros(32),
        u16(0x18),
        u16(0xffff),
        box("avcC", track.description),
      )
    : box(
        "mp4a",
        zeros(6),
        u16(1),
        zeros(8),
        u16(track.channels),
        u16(16),
        zeros(4),
        u32(track.timescale * 65536),
        esds(track.description),
      );
  return box(
    "trak",
    fullBox(
      "tkhd",
      0,
      3,
      zeros(8),
      u32(id),
      zeros(4),
      u32(movieLength),
      zeros(8),
      zeros(4),
      u16(video ? 0 : 0x0100),
      zeros(2),
      MATRIX,
      u32(video ? track.width * 65536 : 0),
      u32(video ? track.height * 65536 : 0),
    ),
    box(
      "mdia",
      fullBox("mdhd", 0, 0, zeros(8), u32(track.timescale), u32(length), u16(0x55c4), zeros(2)),
      fullBox("hdlr", 0, 0, zeros(4), ascii(video ? "vide" : "soun"), zeros(12), ascii(video ? "Video\0" : "Sound\0")),
      box(
        "minf",
        video ? fullBox("vmhd", 0, 1, zeros(8)) : fullBox("smhd", 0, 0, zeros(4)),
        box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
        sampleTable(entry, track, offset),
      ),
    ),
  );
}

// The AAC decoder setup, in the MPEG-4 descriptor form MP4 files keep it in. WebKit's encoder
// gives that whole descriptor already (it starts with the ES tag, 0x03) instead of the bare setup.
function esds(config) {
  if (config[0] === 0x03) return fullBox("esds", 0, 0, config);
  const descriptor = (tag, ...parts) => {
    const body = parts.flat();
    return [tag, body.length, ...body];
  };
  return fullBox(
    "esds",
    0,
    0,
    descriptor(
      0x03,
      u16(1),
      [0],
      descriptor(0x04, [0x40, 0x15], zeros(3), u32(0), u32(0), descriptor(0x05, Array.from(config))),
      descriptor(0x06, [0x02]),
    ),
  );
}

/**
 * The parts of an .mp4 file (for a Blob). `video`: {width, height, timescale, description (avcC),
 * samples: [{data, key}], durations}; `audio`: {timescale (its sample rate), channels,
 * description (AudioSpecificConfig), samples: [{data}], durations}.
 */
export function mp4Parts(video, audio) {
  const tracks = [
    { ...video, kind: "video", keys: true },
    { ...audio, kind: "audio" },
  ];
  const ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
  const seconds = Math.max(
    ...tracks.map((track) => track.durations.reduce((sum, duration) => sum + duration, 0) / track.timescale),
  );
  const moov = (offsets) =>
    box(
      "moov",
      fullBox(
        "mvhd",
        0,
        0,
        zeros(8),
        u32(1000),
        u32(Math.round(seconds * 1000)),
        u32(0x00010000),
        u16(0x0100),
        zeros(10),
        MATRIX,
        zeros(24),
        u32(tracks.length + 1),
      ),
      ...tracks.map((track, index) => trak(index + 1, track, offsets[index])),
    );
  const sizes = tracks.map((track) => track.samples.reduce((sum, sample) => sum + sample.data.length, 0));
  // The index's size doesn't depend on the offsets in it.
  const start = ftyp.length + moov([0, 0]).length + 8;
  const offsets = [start, start + sizes[0]];
  return [
    ftyp,
    moov(offsets),
    Uint8Array.from([...u32(8 + sizes[0] + sizes[1]), ...ascii("mdat")]),
    ...tracks.flatMap((track) => track.samples.map((sample) => sample.data)),
  ];
}
