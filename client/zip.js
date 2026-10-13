// Minimal ZIP (stored, no compression) for full backups. Audio is already MP3, so
// compressing again gains little; storing keeps the code small and dependency-free.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, bytes: Uint8Array }] → Blob */
export function makeZip(entries, now = new Date()) {
  const encoder = new TextEncoder();
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local, nameBytes, bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  const size = central.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/** Reads a stored (uncompressed) ZIP into Map<name, Uint8Array>. */
export function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  )
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("zip 파일 형식이 아닙니다.");
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(position, true) !== 0x02014b50)
      throw new Error("zip 목록이 손상되었습니다.");
    const method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const offset = view.getUint32(position + 42, true);
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (method !== 0)
      throw new Error(
        "다시 압축된 zip은 읽을 수 없습니다. 씬보이스에서 받은 백업 파일을 그대로 선택해 주십시오.",
      );
    const start =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    files.set(name, bytes.subarray(start, start + size));
    position += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
