// 백업 내려받기와 초기화: the ⋯ menu of the settings window.
import { escapeHtml, mergeConfig } from "./common.js";
import { DEFAULT_SETTINGS } from "../shared/settings.js";
import { validAudioName } from "../shared/store.js";
import { makeZip } from "./zip.js";
import { infoTip, bindInfoTips, switchHtml } from "./ui.js";
import { BACKUP_ITEMS, audioHolders, backupSummary, pickBackup } from "../shared/backup-scope.js";

export const BACKUP_CATALOG = "scenevoice-catalog.json";

// Data groups that "데이터 초기화" can clear one by one.
const DATA_KINDS = [
  ["dialogue", "채팅 대사 음성·생성 기록", "대사 옆 재생 버튼으로 만든 음성"],
  ["phone", "전화 기록·통화 음성", "통화 내용과 통화 중 만든 음성"],
  ["voice_message", "메시지", "주고받은 문자와 음성 메시지"],
  ["memos", "음성 메모", "인물들이 혼자 남긴 음성 메모"],
  ["radio", "라디오", "만든 라디오 방송"],
  ["favorites", "보관함", "영구 보관한 음성 사본"],
  ["states", "캐릭터 상태 기록", "현재 상태와 변화 기록"],
  ["analyses", "대사 분석·수동 지정", "저장된 화자·연기 태그 분석과 대사별 수동 지정"],
];

const stamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const maintenance = {
  bindMoreMenu() {
    const toggle = document.getElementById("sv-more");
    const menu = document.getElementById("sv-more-menu");
    if (!toggle || !menu) return;
    const close = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("button, label")?.focus();
    });
    document.getElementById("sv-overlay")?.addEventListener("click", (event) => {
      if (!event.target.closest("#sv-more-menu, #sv-more")) close();
    });
    menu.addEventListener("keydown", (event) => {
      const file = event.target.closest(".sv-menu-file");
      if (file && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        file.querySelector("input")?.click();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      toggle.focus();
    });
    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-sv-action]")?.dataset.svAction;
      if (!action) return;
      close();
      const tasks = {
        "update-notes": () => this.showUpdateNotes({ force: true }),
        backup: () => this.openBackupDialog(),
        relink: () => this.openRelinkDialog(),
        "reset-settings": () => this.openResetDialog("settings"),
        "reset-data": () => this.openResetDialog("data"),
        "reset-all": () => this.openResetDialog("all"),
      };
      this.run(async () => {
        await this.saveSettingsNow();
        await tasks[action]?.();
      });
    });
  },

  /**
   * A bot card's records moved from its old key to `to` (both "character:<file>"): what each of
   * its chats kept under the old key, and the people registered under it. Returns how many
   * records moved (0: nothing was there).
   */
  async relinkCard(from, to, name = "") {
    const context = window.SillyTavern?.getContext?.() || {};
    const avatar = to.slice("character:".length);
    const card = (context.characters || []).find((item) => item.avatar === avatar);
    // The card's chats keep their file names when it is renamed (only their folder moves).
    let chats = [];
    try {
      const response = await this.transport.network?.("/api/characters/chats", {
        method: "POST",
        body: JSON.stringify({ avatar_url: avatar, simple: true }),
      });
      const list = response?.ok ? await response.json() : [];
      if (Array.isArray(list)) chats = list.map((item) => String(item.file_id || item.file_name || "").replace(/\.jsonl$/, ""));
    } catch (error) {
      console.warn("[SceneVoice] chat list unavailable", error);
    }
    if (context.chatId && card && context.characterId !== undefined && context.characters?.[context.characterId]?.avatar === avatar)
      chats.push(String(context.chatId));
    // Not tied to the open chat: 실리태번 reloads it right after a rename, which would cancel it.
    const response = await this.transport.request(
      "/api/plugins/scenevoice/cards/relink",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, name: name || card?.name || "", chats: [...new Set(chats.filter(Boolean))] }),
      },
      30000,
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `기록을 옮기지 못했습니다 (${response.status})`);
    await this.loadConfig();
    this.chatIdCache = null;
    await this.refreshChatMemory?.();
    if (document.getElementById("sv-smartphone") && !document.getElementById("sv-smartphone").classList.contains("hidden"))
      await this.renderSmartphone?.();
    const { records = 0, states = 0, people = 0 } = data.moved || {};
    return records + states + people;
  },

  /**
   * 봇카드 기록 다시 잇기: for a card renamed before its records could follow it. Its old key is
   * picked from the ones the records still name (or typed as its old name), and moved to the card
   * open now.
   */
  async openRelinkDialog() {
    const context = window.SillyTavern?.getContext?.() || {};
    const current = context.characters?.[context.characterId];
    if (!current?.avatar || context.groupId)
      throw new Error("기록을 이어 줄 봇카드의 채팅을 먼저 열어 주세요. (단체 채팅 말고 1:1)");
    const to = `character:${current.avatar}`;
    const live = new Set((context.characters || []).map((item) => `character:${item.avatar}`));
    const response = await this.request("/api/plugins/scenevoice/cards/keys", { cache: "no-store" });
    const data = await response.json();
    const left = (data.items || []).filter((item) => !live.has(item.key));
    document.getElementById("sv-relink-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-relink-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-link"></i></span>
        <div><h3>봇카드 기록 다시 잇기</h3><small>이름을 바꾼 봇카드의 예전 기록을 지금 카드(${escapeHtml(current.name)})로 옮겨요.</small></div>
        ${infoTip("실리태번에서 캐릭터 이름을 바꾸면 카드 파일 이름이 바뀌어, 그 전에 쌓인 통화·문자·메모·라디오·상태와 등록한 인물이 이어지지 않아요. 예전 카드를 고르면 그 기록을 지금 카드로 옮깁니다.\n이제는 이름을 바꾸면 자동으로 옮겨지니, 이건 예전에 바꾼 카드에만 쓰면 돼요.", "다시 잇기 설명")}
      </header>
      <div class="sv-relink-list">${
        left.length
          ? left
              .map(
                (item, index) =>
                  `<label class="sv-check"><input type="radio" name="from" value="${escapeHtml(item.key)}" ${index === 0 ? "checked" : ""}><span>${escapeHtml(item.name || item.key.slice("character:".length))}<small>${escapeHtml(item.key.slice("character:".length))} · 기록 ${item.count}개</small></span></label>`,
              )
              .join("")
          : '<p class="sv-hint">남아 있는 예전 봇카드를 찾지 못했어요. 아래에 예전 이름을 적어 주세요.</p>'
      }</div>
      <label class="sv-field"><span class="sv-label-line">또는 예전 이름</span><input type="text" id="sv-relink-name" placeholder="예: 고죠 (예전 카드 파일 이름, .png는 빼고)" autocomplete="off"></label>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn">취소</button><button type="button" class="sv-btn sv-btn-primary" data-relink><i class="fa-solid fa-link" aria-hidden="true"></i><span>옮기기</span></button></footer>
    </form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("[data-relink]").addEventListener("click", () =>
      this.run(async () => {
        const typed = dialog.querySelector("#sv-relink-name").value.trim().replace(/\.png$/i, "");
        const from = typed ? `character:${typed}.png` : dialog.querySelector('input[name="from"]:checked')?.value;
        if (!from) throw new Error("옮길 예전 봇카드를 고르거나 예전 이름을 적어 주세요.");
        if (from === to) throw new Error("지금 카드와 같은 이름이에요.");
        const moved = await this.relinkCard(from, to, current.name);
        dialog.close();
        this.notify(
          moved ? `예전 기록을 ‘${current.name}’ 카드로 옮겼어요.` : "옮길 기록을 찾지 못했어요. 예전 이름을 다시 확인해 주세요.",
          moved ? "success" : "info",
        );
      }),
    );
    dialog.showModal();
  },

  /** 백업 파일 저장: bot cards and kinds to save (all at first), as a zip with voices or JSON. */
  async openBackupDialog() {
    const store = this.transport.local.store;
    const full = await store.exportCatalog();
    const summary = backupSummary(full.data);
    const scopes = [...summary.keys()];
    const items = BACKUP_ITEMS.map(([key]) => key);
    document.getElementById("sv-backup-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-backup-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-file-arrow-down"></i></span>
        <div><h3>백업 파일 저장</h3><small>저장할 봇카드와 항목을 고르세요.</small></div>
        ${infoTip("API 키는 들어가지 않습니다. 고른 봇카드의 고른 항목만 저장하고, 복원할 때도 파일에 든 것 중에서 다시 고를 수 있습니다.\n여러 봇카드가 같이 쓰는 인물과 그 기록은 ‘글로벌 인물’에 있습니다.", "백업 설명")}
      </header>
      ${this.backupPickHtml({ common: true, scopes, items, summary, settings: full.data.settings })}
      ${switchHtml({ id: "sv-backup-audio", label: "음성 파일도 함께 저장", hint: " ", checked: true })}
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn">취소</button><button type="button" class="sv-btn sv-btn-primary" data-backup-save><i class="fa-solid fa-download" aria-hidden="true"></i><span>내려받기</span></button></footer>
    </form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    const form = dialog.querySelector("form");
    const save = dialog.querySelector("[data-backup-save]");
    const whole = (choice) =>
      choice.common && scopes.every((scope) => choice.scopes.includes(scope)) && items.every((item) => choice.items.includes(item));
    const catalogFor = (choice) =>
      whole(choice)
        ? full
        : {
            ...full,
            data: pickBackup(full.data, choice),
            contents: { common: choice.common, scopes: choice.scopes, items: choice.items },
          };
    const audio = dialog.querySelector("#sv-backup-audio");
    this.bindBackupPick(form, (choice, empty) => {
      save.disabled = empty;
      const hint = audio.closest("label").querySelector(".sv-hint");
      if (!audio.checked || empty) {
        hint.textContent = "끄면 음성 없이 가벼운 JSON 파일로 저장합니다.";
        return;
      }
      const { data } = catalogFor(choice);
      const names = this.backupAudioNames(data);
      const bytes = names.reduce((total, name) => total + (data.audioFiles?.[name]?.size || 0), 0);
      hint.textContent = `음성 파일 ${names.length}개(약 ${Math.ceil(bytes / 1048576)}MB)를 함께 zip으로 저장합니다.`;
    });
    save.addEventListener("click", () =>
      this.run(async () => {
        const choice = this.backupPickChoice(form);
        const catalog = catalogFor(choice);
        // One bot card (or 글로벌 인물) names the file.
        const one = !whole(choice) && choice.scopes.length === 1 ? this.backupScopeName(choice.scopes[0], full.data.settings) : "";
        const label = whole(choice) ? "" : (one || "선택").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
        const zip = audio.checked;
        dialog.close();
        if (zip) await this.exportZipBackup(catalog, label);
        else
          download(
            new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" }),
            `scenevoice-${label || "catalog"}-${stamp()}.json`,
          );
      }),
    );
    dialog.showModal();
  },

  /**
   * The catalog plus its audio files in one zip; everything (asked first) when no `catalog` is
   * given. API keys are never in the catalog.
   */
  async exportZipBackup(catalog = null, label = "") {
    const store = this.transport.local.store;
    const asked = !catalog;
    catalog ||= await store.exportCatalog();
    const names = this.backupAudioNames(catalog.data);
    const size = names.reduce(
      (total, name) => total + (catalog.data.audioFiles?.[name]?.size || 0),
      0,
    );
    if (
      asked &&
      !confirm(
        `음성 파일 ${names.length}개(약 ${Math.ceil(size / 1048576)}MB)와 목록·설정을 zip으로 내려받습니다. API 키는 들어가지 않습니다. 계속할까요?`,
      )
    )
      return;
    this.notify(`음성 ${names.length}개를 모으는 중입니다…`, "info");
    const entries = [
      {
        name: BACKUP_CATALOG,
        bytes: new TextEncoder().encode(JSON.stringify(catalog, null, 2)),
      },
    ];
    let missing = 0;
    for (const name of names) {
      const bytes = await store.getAudio(name);
      if (bytes) entries.push({ name: `audio/${name}`, bytes });
      else missing++;
    }
    download(makeZip(entries), `scenevoice-${label || "backup"}-${stamp()}.zip`);
    this.notify(
      `백업을 내려받았습니다.${missing ? ` 찾을 수 없는 음성 ${missing}개는 빠졌습니다.` : ""}`,
      "success",
    );
  },

  backupAudioNames(data) {
    return [
      ...new Set([
        ...Object.keys(data.audioFiles || {}),
        ...audioHolders(data)
          .map((row) => row.audio_filename)
          .filter(Boolean),
      ]),
    ].filter(validAudioName);
  },

  async openResetDialog(kind) {
    const store = this.transport.local.store;
    const data = await store.read();
    const counts = {
      dialogue: data.generations.filter((row) => (row.mode || "dialogue") === "dialogue").length,
      phone: data.sessions.length,
      voice_message: data.messages.length,
      memos: (data.memos || []).length,
      radio: (data.radio || []).length,
      favorites: data.favorites.length,
      states: Object.keys(data.states || {}).length + data.stateHistory.length,
      analyses: Object.keys(data.analyses || {}).length + Object.keys(data.lineEdits || {}).length,
    };
    const titles = {
      settings: ["sliders", "설정 초기화", "설정을 처음 값으로 되돌립니다. 음성·기록 같은 데이터는 그대로 둡니다."],
      data: ["broom", "데이터 초기화", "지울 항목을 고르세요. 설정은 그대로 둡니다. 지운 데이터는 되돌릴 수 없습니다."],
      all: ["triangle-exclamation", "전체 초기화", "설정과 모든 데이터·음성 파일을 지우고 처음 설치한 상태로 되돌립니다. 되돌릴 수 없습니다."],
    };
    const [icon, title, lead] = titles[kind];
    const option = (name, label, hint, checked = false) =>
      `<label class="sv-reset-option"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></span></label>`;
    const body =
      kind === "settings"
        ? option("voices", "캐릭터별 목소리·말투 메모도 초기화", "등록한 화자·등장인물과 메모까지 지웁니다.")
        : kind === "data"
          ? DATA_KINDS.map(([name, label, hint]) =>
              option(name, `${label} (${counts[name]})`, hint),
            ).join("")
          : `${option("fish_key", "이 브라우저의 Fish API 키도 삭제", "ElevenLabs 키는 실리태번이 관리하므로 지우지 않습니다.")}
             ${option("confirm", "되돌릴 수 없다는 것을 확인했습니다", "먼저 ‘전체 백업’을 받아 두는 것을 권합니다.")}`;
    document.getElementById("sv-reset-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-reset-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon ${kind === "settings" ? "" : "sv-dialog-icon-danger"}" aria-hidden="true"><i class="fa-solid fa-${icon}"></i></span>
        <div><h3>${title}</h3><small>${lead}</small></div>
        ${kind === "data" ? infoTip("통화 기록을 지우면 통화 중 만든 음성도 함께 지웁니다. 다른 기록이 같은 음성 파일을 쓰고 있으면 그 파일은 남깁니다. 채팅 메시지에 저장된 통화·음성 채팅 기억은 각 채팅에서 따로 지웁니다.", "데이터 초기화 설명") : ""}
      </header>
      <div class="sv-reset-options">${body}</div>
      ${kind === "settings" ? '<p class="sv-hint">API 키는 그대로 둡니다.</p>' : ""}
      <footer class="sv-dialog-actions">
        ${kind === "all" ? '<button type="button" class="sv-btn" data-reset-backup><i class="fa-solid fa-file-zipper" aria-hidden="true"></i><span>먼저 전체 백업</span></button><span class="sv-spacer"></span>' : ""}
        <button type="submit" class="sv-btn">취소</button>
        <button type="button" class="sv-btn ${kind === "settings" ? "sv-btn-primary" : "sv-btn-danger"}" data-reset-apply ${kind === "settings" ? "" : "disabled"}>${kind === "data" ? "선택한 항목 지우기" : kind === "all" ? "전체 초기화" : "설정 초기화"}</button>
      </footer>
    </form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    const apply = dialog.querySelector("[data-reset-apply]");
    const form = dialog.querySelector("form");
    const refresh = () => {
      if (kind === "data")
        apply.disabled = !DATA_KINDS.some(([name]) => form.elements[name].checked);
      if (kind === "all") apply.disabled = !form.elements.confirm.checked;
    };
    form.addEventListener("change", refresh);
    dialog.querySelector("[data-reset-backup]")?.addEventListener("click", () =>
      this.run(() => this.exportZipBackup()),
    );
    apply.addEventListener("click", () =>
      this.run(async () => {
        if (this.phoneBusy || this.voiceMessageBusy || this.stateTrackingBusy)
          throw new Error("진행 중인 통화·분석이 끝난 뒤 초기화해 주세요.");
        dialog.querySelectorAll("button").forEach((button) => (button.disabled = true));
        try {
          if (kind === "settings")
            await this.resetSettings({ voices: form.elements.voices.checked });
          else if (kind === "data")
            await this.resetData(
              Object.fromEntries(
                DATA_KINDS.map(([name]) => [name, form.elements[name].checked]),
              ),
            );
          else await this.resetAll({ fishKey: form.elements.fish_key.checked });
          dialog.close();
        } finally {
          dialog.querySelectorAll("button").forEach((button) => (button.disabled = false));
          refresh();
        }
      }),
    );
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  },

  async resetSettings({ voices = false, fishKey = false } = {}) {
    // Pending form edits must not be saved back over the reset.
    clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    this.settingsDirty = false;
    const patch = structuredClone(DEFAULT_SETTINGS);
    delete patch.fish.api_key;
    delete patch.elevenlabs.api_key;
    if (fishKey) patch.fish.clear_api_key = true;
    if (!voices) {
      delete patch.character_voices;
      delete patch.character_notes;
    }
    const response = await this.request("/api/plugins/scenevoice/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.detail || `설정 초기화 실패 (${response.status})`);
    this.config = mergeConfig(result.settings || {});
    await this.afterReset("설정을 처음 값으로 되돌렸습니다.");
  },

  /** Clears the chosen record groups and deletes audio files nothing refers to anymore. */
  async resetData(kinds, { allAudio = false } = {}) {
    const store = this.transport.local.store;
    const orphaned = [];
    await store.transaction((db) => {
      const keep = (row) => !kinds[row.mode || "dialogue"];
      db.generations = db.generations.filter(keep);
      if (kinds.phone) db.sessions = [];
      if (kinds.voice_message) db.messages = [];
      if (kinds.memos) db.memos = [];
      if (kinds.radio) db.radio = [];
      if (kinds.favorites) db.favorites = [];
      if (kinds.states) {
        db.states = {};
        db.stateHistory = [];
      }
      if (kinds.analyses) {
        db.analyses = {};
        db.lineEdits = {};
      }
      // Earlier versions' voices (답변 재생성) are in use too.
      const used = new Set(audioHolders(db).map((row) => row.audio_filename).filter(Boolean));
      for (const name of Object.keys(db.audioFiles || {}))
        if (allAudio || !used.has(name)) {
          orphaned.push(name);
          delete db.audioFiles[name];
        }
    });
    let failed = 0;
    for (const name of orphaned) {
      if (!validAudioName(name)) continue;
      const response = await store.network("/api/files/delete", {
        method: "POST",
        body: JSON.stringify({ path: store.nativePath(name) }),
      });
      if (!response.ok && response.status !== 404) failed++;
    }
    if (kinds.phone) this.phoneSession = null;
    if (kinds.states) {
      this.lastStateRound = null;
      this.lastStateTrackingSource = "";
    }
    await this.afterReset(
      `선택한 데이터를 지웠습니다.${failed ? ` 음성 파일 ${failed}개는 지우지 못했습니다.` : ""}`,
    );
  },

  async resetAll({ fishKey = false } = {}) {
    this.resetQuiet = true;
    try {
      await this.resetData(
        Object.fromEntries(DATA_KINDS.map(([name]) => [name, true])),
        { allAudio: true },
      );
    } finally {
      this.resetQuiet = false;
    }
    await this.resetSettings({ voices: true, fishKey });
  },

  async afterReset(message) {
    if (this.resetQuiet) return;
    this.stopPlayback();
    this.analysisCache.clear();
    this.lineStatePromise = null;
    this.invalidateGeneratedButtons();
    this.removeDecorations();
    if (this.chatVoiceOn()) this.scheduleScan();
    this.createPhoneLauncher();
    await this.refreshChatMemory();
    if (document.getElementById("sv-overlay")) {
      // Rebuild the panel from the reset values without saving the old form.
      document.getElementById("sv-overlay").remove();
      await this.openPanel();
    }
    this.notify(message, "success");
  },
};
