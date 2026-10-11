// Storage that stays in this browser (IndexedDB) for what is never shared: the Fish API key.
import {
  emptyDatabase,
  checkDatabase,
  validAudioName,
} from "../shared/store.js";
export class BrowserStore {
  constructor(name) {
    this.ready = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("records");
        request.result.createObjectStore("audio", { keyPath: "name" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(
          new Error(
            "이 브라우저의 저장소를 사용할 수 없습니다. 비공개 모드 또는 저장 공간을 확인해 주세요.",
          ),
        );
    });
  }
  async operation(storeName, mode, run) {
    const database = await this.ready;
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      let result;
      let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure || tx.error || new Error("브라우저 저장이 취소되었습니다."),
        );
      tx.onerror = () => {};
      try {
        run(
          tx.objectStore(storeName),
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            tx.abort();
          },
        );
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }
  read() {
    return this.operation("records", "readonly", (store, done, fail) => {
      const req = store.get("data");
      req.onsuccess = () => {
        try {
          done(req.result ? checkDatabase(req.result) : emptyDatabase());
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  transaction(change) {
    return this.operation("records", "readwrite", (store, done, fail) => {
      const req = store.get("data");
      req.onsuccess = () => {
        try {
          const data = req.result ? checkDatabase(req.result) : emptyDatabase();
          const result = change(data);
          store.put(data, "data");
          done(result);
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async close() {
    (await this.ready).close();
  }
  check(name) {
    if (!validAudioName(name)) throw new Error("Invalid audio filename");
  }
  writeAudio(name, bytes) {
    this.check(name);
    return this.operation("audio", "readwrite", (store) =>
      store.put({ name, bytes, created: Date.now(), size: bytes.byteLength }),
    );
  }
  getAudio(name) {
    this.check(name);
    return this.operation("audio", "readonly", (store, done) => {
      const req = store.get(name);
      req.onsuccess = () => done(req.result?.bytes || null);
    });
  }
  deleteAudio(name) {
    this.check(name);
    return this.operation("audio", "readwrite", (store) => store.delete(name));
  }
  listAudio() {
    return this.operation("audio", "readonly", (store, done) => {
      const req = store.getAll();
      req.onsuccess = () =>
        done(
          req.result
            .filter((x) => !x.name.startsWith("fav_"))
            .map(({ name, size, created }) => ({ name, size, created })),
        );
    });
  }
}
