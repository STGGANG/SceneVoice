// Storage on 실리태번's own file API: the shared records (split into a few JSON files, each
// with change detection and one backup) and the audio files.
import { validateBackup } from "../shared/backup.js";
import { BACKUP_ITEMS, applyBackup, audioHolders, backupContents, pickBackup, wholeChoice } from "../shared/backup-scope.js";
import { BrowserStore } from "./browser-store.js";
import {
  emptyDatabase,
  checkDatabase,
  validAudioName,
} from "../shared/store.js";
import { newId } from "../shared/hash.js";
import { UserError } from "../shared/settings.js";
const PART_FORMAT = "scenevoice-part-v1";
/**
 * The records, split by how often and how much each part changes, so a write sends only the
 * parts it changed: settings, the analysis cache, people's states, calls and texts, and voices.
 * Each part is its own file in 실리태번's user files, with its own revision and backup.
 */
export const PARTS = {
  core: ["version", "settings"],
  analyses: ["analyses"],
  states: ["states", "stateHistory"],
  phone: ["sessions", "messages", "groups", "memos", "radio"],
  media: ["generations", "favorites", "audioFiles", "lineEdits"],
};
const PART_NAMES = Object.keys(PARTS);
export const partFile = (name) => `scenevoice_${name}.json`;
const backupFile = (name) => `scenevoice_${name}_previous.json`;
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const pick = (data, name) => Object.fromEntries(PARTS[name].map((key) => [key, data[key]]));
const brokenFile = () =>
  new UserError("공유 목록 형식이 잘못되었습니다. 기존 파일을 덮어쓰지 않았습니다.");

export class STFileStore {
  tail = Promise.resolve();
  snapshot = null;
  // Bumped by every write: a read begun before it doesn't put back what the write replaced.
  generation = 0;
  // Per part: the ETag and revision last seen and its contents (null when it has no file yet).
  parts = {};
  constructor(name, network) {
    this.local = new BrowserStore(name);
    this.network = network;
    this.lockName = name + "-shared";
    this.storageReady = Promise.resolve();
  }
  async upload(name, bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    const response = await this.network("/api/files/upload", {
      method: "POST",
      body: JSON.stringify({ name, data: btoa(binary) }),
    });
    if (!response.ok)
      throw new UserError(
        `실리태번 파일 저장 실패 (${response.status}). 서버 저장 공간과 연결을 확인해 주세요.`,
        502,
      );
    const result = await response.json();
    const path = String(result.path || "").replace(/^\/+/, "");
    if (path !== `user/files/${name}`)
      throw new UserError("실리태번이 예상하지 않은 파일 경로를 반환했습니다.");
    return path;
  }
  /**
   * One part's file. Unless `fresh`, it is asked for only if changed (ETag); an unchanged part
   * keeps the same object, so callers can tell nothing moved.
   */
  async loadPart(name, { fresh = false } = {}) {
    const generation = this.generation;
    const known = this.parts[name];
    const conditional = !fresh && known?.etag;
    const response = await this.network(
      `/user/files/${partFile(name)}${fresh ? `?v=${Date.now()}` : ""}`,
      conditional
        ? { cache: "no-cache", headers: { "If-None-Match": known.etag } }
        : { cache: "no-store" },
    );
    if (response.status === 304 && conditional) return known;
    // Written meanwhile: what this request read is older than what is kept now.
    if (generation !== this.generation) return this.parts[name];
    if (response.status === 404)
      return (this.parts[name] = { etag: "", revision: "", value: null });
    if (!response.ok)
      throw new UserError(
        `실리태번 목록 읽기 실패 (${response.status}). 기존 목록은 유지됩니다.`,
      );
    const file = await response.json().catch(() => null);
    if (generation !== this.generation) return this.parts[name];
    if (
      file?.format !== PART_FORMAT ||
      file.part !== name ||
      typeof file.revision !== "string" ||
      !file.data ||
      typeof file.data !== "object"
    )
      throw brokenFile();
    return (this.parts[name] = {
      etag: response.headers.get("ETag") || "",
      revision: file.revision,
      value: file.data,
    });
  }
  /** The parts put together as one records object (what the service works with). */
  assemble() {
    const data = emptyDatabase();
    data.audioFiles = {};
    for (const name of PART_NAMES) {
      const value = this.parts[name]?.value;
      if (value) for (const key of PARTS[name]) if (value[key] !== undefined) data[key] = value[key];
    }
    // Restores compare this to see that nothing changed since their preview.
    data.revision = PART_NAMES.map((name) => this.parts[name]?.revision || "").join(".");
    checkDatabase(data);
    if (!data.audioFiles || typeof data.audioFiles !== "object") throw brokenFile();
    // Credentials are deliberately never loaded from publicly served files.
    for (const engine of ["fish", "elevenlabs"]) data.settings[engine].api_key = "";
    return data;
  }
  /** Writes one part from the records; returns its new revision. */
  async writePart(name, data) {
    const revision = newId();
    await this.upload(partFile(name), encode({ format: PART_FORMAT, part: name, revision, data: pick(data, name) }));
    this.generation++;
    this.parts[name] = { etag: "", revision, value: pick(data, name) };
    return revision;
  }
  /** The shared records. `clone: false` updates the kept copy without handing one out. */
  async loadShared({ fresh = false, clone = true } = {}) {
    const before = PART_NAMES.map((name) => this.parts[name]);
    await Promise.all(PART_NAMES.map((name) => this.loadPart(name, { fresh })));
    if (!this.snapshot || PART_NAMES.some((name, index) => this.parts[name] !== before[index]))
      this.snapshot = this.assemble();
    return clone ? structuredClone(this.snapshot) : this.snapshot;
  }
  async read() {
    await this.tail;
    // Reads come in bursts (a phone screen asks for messages and groups at once): reads made
    // while the files are being checked share that check, and each caller gets its own copy.
    // A check begun before the last write isn't shared: it can't know what was written.
    if (!this.reading || this.readingGeneration !== this.generation) {
      this.readingGeneration = this.generation;
      const reading = this.loadShared({ clone: false }).finally(() => {
        if (this.reading === reading) this.reading = null;
      });
      this.reading = reading;
    }
    await this.reading;
    const data = structuredClone(this.snapshot);
    data.settings.fish.api_key =
      (await this.local.read()).settings.fish.api_key || "";
    return data;
  }
  async changeShared(change) {
    const key = (await this.local.read()).settings.fish.api_key || "";
    for (let attempt = 0; attempt < 3; attempt++) {
      // Parts that didn't change since they were last seen answer "not modified" (ETag) and
      // aren't downloaded again; the parts about to be written are read fresh below anyway.
      const before = await this.loadShared({ fresh: attempt > 0 });
      const revisions = Object.fromEntries(PART_NAMES.map((name) => [name, this.parts[name].revision]));
      const data = structuredClone(before);
      data.settings.fish.api_key = key;
      const result = await change(data);
      const nextKey = data.settings.fish.api_key || "";
      for (const engine of ["fish", "elevenlabs"])
        data.settings[engine].api_key = "";
      // Only the parts that changed are written (compared as JSON text: native and fast).
      const changed = PART_NAMES.filter((name) =>
        PARTS[name].some((field) => JSON.stringify(data[field]) !== JSON.stringify(before[field])),
      );
      if (!changed.length) {
        if (nextKey !== key)
          await this.local.transaction((db) => {
            db.settings.fish.api_key = nextKey;
          });
        return result;
      }
      // Another device wrote one of these parts meanwhile: start again from its version.
      const current = await Promise.all(changed.map((name) => this.loadPart(name, { fresh: true })));
      if (current.some((part, index) => part.revision !== revisions[changed[index]])) continue;
      // Native ST upload has no compare-and-swap operation. Pre/post checks detect most overlaps;
      // simultaneous cross-device writes are not a serializable transaction (documented limitation).
      const written = {};
      for (const name of changed) {
        if (revisions[name])
          await this.upload(
            backupFile(name),
            encode({ format: PART_FORMAT, part: name, revision: revisions[name], data: pick(before, name) }),
          );
        written[name] = await this.writePart(name, data);
      }
      const check = await Promise.all(changed.map((name) => this.loadPart(name, { fresh: true })));
      if (check.some((part, index) => part.revision !== written[changed[index]])) {
        // The other device's version is what the next read must see.
        this.snapshot = null;
        throw new UserError(
          "다른 기기에서도 목록을 변경했습니다. 새로 불러온 뒤 다시 시도해 주세요. 직전 목록은 실리태번에 백업되어 있습니다.",
          409,
        );
      }
      if (nextKey !== key)
        await this.local.transaction((db) => {
          db.settings.fish.api_key = nextKey;
        });
      this.snapshot = this.assemble();
      return result;
    }
    throw new UserError(
      "다른 기기에서 목록을 변경 중입니다. 잠시 후 다시 시도해 주세요.",
      409,
    );
  }
  transaction(change) {
    const work = this.tail.then(() =>
      globalThis.navigator?.locks
        ? navigator.locks.request(this.lockName, () =>
            this.changeShared(change),
          )
        : this.changeShared(change),
    );
    this.tail = work.catch(() => {});
    return work;
  }
  check(name) {
    if (!validAudioName(name)) throw new Error("Invalid audio filename");
  }
  nativePath(name) {
    this.check(name);
    return `user/files/scenevoice_audio_${name}`;
  }
  /** A person's picture in ST's user files; returns the URL it is served at. */
  async uploadImage(name, bytes) {
    if (!/^scenevoice_avatar_[a-f0-9]{24}\.(webp|jpg|png)$/.test(name))
      throw new UserError("사진 파일 이름이 올바르지 않습니다.");
    return `/${await this.upload(name, bytes)}`;
  }
  async stageAudio(name, bytes) {
    this.check(name);
    await this.upload(`scenevoice_audio_${name}`, bytes);
    return {
      name,
      nativePath: this.nativePath(name),
      size: bytes.byteLength,
      created: Date.now(),
    };
  }
  async writeAudio(name, bytes) {
    const metadata = await this.stageAudio(name, bytes);
    await this.transaction((data) => {
      data.audioFiles[name] = metadata;
    });
  }
  async getAudio(name) {
    const response = await this.network("/" + this.nativePath(name), {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new UserError(`실리태번 음성 읽기 실패 (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }
  audioURL(name) {
    return "/" + this.nativePath(name);
  }
  /**
   * Deletes an audio file. `listed: false` leaves its entry in the records to the caller, which
   * removes many in one write (each write sends the whole records file).
   */
  async deleteAudio(name, { listed = true } = {}) {
    const response = await this.network("/api/files/delete", {
      method: "POST",
      body: JSON.stringify({ path: this.nativePath(name) }),
    });
    if (!response.ok && response.status !== 404)
      throw new UserError(`실리태번 음성 삭제 실패 (${response.status}).`);
    if (listed)
      await this.transaction((data) => {
        delete data.audioFiles[name];
      });
  }
  async listAudio() {
    return Object.values((await this.read()).audioFiles).filter(
      (row) => validAudioName(row.name) && !row.name.startsWith("fav_"),
    );
  }
  /** Everything, or with `choice` ({common, scopes, items}) only those, marked in `contents`. */
  async exportCatalog(choice = null) {
    const data = await this.loadShared();
    return {
      format: "scenevoice-catalog-v2",
      data: choice ? pickBackup(data, choice) : data,
      ...(choice
        ? { contents: { common: Boolean(choice.common), scopes: [...choice.scopes], items: [...choice.items] } }
        : {}),
      created_at: new Date().toISOString(),
    };
  }
  async previewRestore(input) {
    const data = validateBackup(input);
    const current = await this.loadShared({ fresh: true });
    const names = [
      ...new Set([
        ...Object.keys(data.audioFiles),
        ...audioHolders(data)
          .map((row) => row.audio_filename)
          .filter(Boolean),
      ]),
    ];
    const missing = [];
    for (let start = 0; start < names.length; start += 200) {
      const batch = names.slice(start, start + 200);
      const response = await this.network("/api/files/verify", {
        method: "POST",
        body: JSON.stringify({
          urls: batch.map((name) => this.nativePath(name)),
        }),
      });
      if (!response.ok)
        throw new UserError(
          "실리태번의 음성 파일 존재 여부를 확인하지 못했습니다. 복원을 중단했습니다.",
        );
      const found = await response.json();
      for (const name of batch)
        if (found[this.nativePath(name)] !== true) missing.push(name);
    }
    return { data, revision: current.revision, missing, contents: backupContents(input, data) };
  }
  /**
   * `choice` ({common, scopes, items}): what to take from the file; a chosen bot card's chosen
   * kinds are replaced, the rest stay. `true` takes the settings and people only, `false` all.
   */
  async restoreCatalog(preview, choice = true) {
    const data = validateBackup({
      format: "scenevoice-catalog-v2",
      data: preview.data,
    });
    const contents = preview.contents || backupContents(null, data);
    if (typeof choice === "boolean")
      choice = { common: true, scopes: contents.scopes, items: choice ? ["people"] : BACKUP_ITEMS.map(([key]) => key) };
    const allowed = new Set(contents.scopes);
    choice = {
      common: Boolean(choice.common && contents.common),
      scopes: (choice.scopes || []).filter((scope) => allowed.has(scope)),
      items: (choice.items || []).filter((item) => contents.items.includes(item)),
    };
    const missing = new Set(preview.missing);
    for (const row of audioHolders(data)) {
      if (missing.has(row.audio_filename)) {
        delete row.audio_filename;
        delete row.generation_id;
      }
    }
    for (const name of missing) delete data.audioFiles[name];
    return this.transaction((current) => {
      if (current.revision !== preview.revision)
        throw new UserError(
          "미리보기를 연 뒤 목록이 바뀌었습니다. 백업 파일을 다시 선택해 주세요.",
          409,
        );
      const key = current.settings.fish.api_key;
      applyBackup(current, data, choice);
      if (wholeChoice(choice, contents)) Object.assign(current.audioFiles, data.audioFiles);
      current.settings.fish.api_key = key;
      current.settings.elevenlabs.api_key = "";
      return { status: "success", missing: missing.size };
    });
  }
  close() {
    return this.local.close();
  }
}
