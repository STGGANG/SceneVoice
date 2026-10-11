// 백업 내려받기와 초기화: the ⋯ menu of the settings window.
import { escapeHtml, mergeConfig } from "./common.js";
import { DEFAULT_SETTINGS } from "../shared/settings.js";
import { validAudioName } from "../shared/store.js";
import { makeZip } from "./zip.js";
import { infoTip, bindInfoTips } from "./ui.js";

export const BACKUP_CATALOG = "scenevoice-catalog.json";

// Data groups that "데이터 초기화" can clear one by one.
const DATA_KINDS = [
  ["dialogue", "채팅 대사 음성·생성 기록", "대사 옆 재생 버튼으로 만든 음성"],
  ["phone", "전화 기록·통화 음성", "통화 내용과 통화 중 만든 음성"],
  ["voice_message", "메시지", "주고받은 문자와 음성 메시지"],
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
        "backup-zip": () => this.exportZipBackup(),
        "backup-json": () => this.exportJsonBackup(),
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

  async exportJsonBackup() {
    const data = await this.transport.local.store.exportCatalog();
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `scenevoice-catalog-${stamp()}.json`,
    );
  },

  /** Catalog plus every audio file in one zip. API keys are never in the catalog. */
  async exportZipBackup() {
    const store = this.transport.local.store;
    const catalog = await store.exportCatalog();
    const names = this.backupAudioNames(catalog.data);
    const size = names.reduce(
      (total, name) => total + (catalog.data.audioFiles?.[name]?.size || 0),
      0,
    );
    if (
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
    download(makeZip(entries), `scenevoice-backup-${stamp()}.zip`);
    this.notify(
      `전체 백업을 내려받았습니다.${missing ? ` 찾을 수 없는 음성 ${missing}개는 빠졌습니다.` : ""}`,
      "success",
    );
  },

  backupAudioNames(data) {
    return [
      ...new Set([
        ...Object.keys(data.audioFiles || {}),
        ...[
          ...(data.generations || []),
          ...(data.favorites || []),
          ...(data.messages || []),
          ...(data.sessions || []).flatMap((session) => session.turns || []),
        ]
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
      if (kinds.favorites) db.favorites = [];
      if (kinds.states) {
        db.states = {};
        db.stateHistory = [];
      }
      if (kinds.analyses) {
        db.analyses = {};
        db.lineEdits = {};
      }
      const used = new Set(
        [
          ...db.generations,
          ...db.favorites,
          ...db.messages,
          ...db.sessions.flatMap((session) => session.turns || []),
        ]
          .map((row) => row.audio_filename)
          .filter(Boolean),
      );
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
