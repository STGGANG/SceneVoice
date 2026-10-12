// WAV files made in the page: voices joined (내려받기) and phone lines with their sound effects mixed in.

export function pcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    out[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return out;
}

/** Parts are not copied into one buffer, to spare memory on long files. */
export function wavFromParts(parts, rate) {
  const bytes = parts.reduce((total, part) => total + part.byteLength, 0);
  const view = new DataView(new ArrayBuffer(44));
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  return new Blob([view, ...parts], { type: "audio/wav" });
}

/** 16-bit mono PCM WAV of the samples. */
export function wavBlob(samples, rate) {
  return wavFromParts([pcm16(samples)], rate);
}

/** A file's bytes as base64, for sending in JSON. */
export async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
