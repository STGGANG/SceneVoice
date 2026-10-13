// 백업 복원: the restore dialog for a settings/records JSON or a full zip, with a preview first,
// and the bot card · kind choice it shares with the backup dialog.
import { escapeHtml } from "./common.js";
import { infoTip, bindInfoTips } from "./ui.js";
import { readZip } from "./zip.js";
import { BACKUP_CATALOG } from "./maintenance.js";
import {
  BACKUP_ITEMS,
  COMMON,
  GLOBAL,
  audioHolders,
  backupSummary,
  pickBackup,
  wholeChoice,
} from "../shared/backup-scope.js";

const SHORT = { people: "인물", records: "생성 기록", phone: "통화·문자", states: "상태" };

export const backup = {
  backupScopeName(scope, settings) {
    if (scope === GLOBAL) return "글로벌 인물";
    const name = this.cardInfo?.(scope)?.name;
    if (name && name !== scope) return name;
    return settings?.character_voices?.[scope]?.name || scope.replace(/^character:/, "").replace(/\.[a-z]+$/i, "");
  },

  /** Bot cards (with 공통 설정 and 글로벌 인물) and kinds to choose, all chosen at first. */
  backupPickHtml({ common, scopes, items, summary, settings }) {
    const option = (name, value, label, hint) =>
      `<label class="sv-pick-option"><input type="checkbox" name="${name}" value="${escapeHtml(value)}" checked><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></span></label>`;
    const counts = (scope) =>
      BACKUP_ITEMS.map(([key]) => (summary.get(scope)?.[key] ? `${SHORT[key]} ${summary.get(scope)[key]}` : ""))
        .filter(Boolean)
        .join(" · ") || "비어 있음";
    const named = scopes.map((scope) => [scope, this.backupScopeName(scope, settings)]);
    named.sort(([a, x], [b, y]) => (a === GLOBAL) - (b === GLOBAL) || x.localeCompare(y, "ko"));
    return `<fieldset class="sv-pick">
        <legend><span>범위</span><button type="button" class="sv-btn sv-btn-sm sv-btn-ghost" data-pick-all>모두 해제</button></legend>
        <div class="sv-pick-list">
          ${common ? option("scope", COMMON, "공통 설정", "엔진·읽기 규칙·스마트폰 설정 등") : ""}
          ${named.map(([scope, name]) => option("scope", scope, name, counts(scope))).join("")}
        </div>
      </fieldset>
      <fieldset class="sv-pick">
        <legend><span>항목</span><small>고른 봇카드마다</small></legend>
        <div class="sv-pick-items">${BACKUP_ITEMS.filter(([key]) => items.includes(key))
          .map(([key, label, hint]) => option("item", key, label, hint))
          .join("")}</div>
      </fieldset>`;
  },

  backupPickChoice(form) {
    const values = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    const scopes = values("scope");
    return {
      common: scopes.includes(COMMON),
      scopes: scopes.filter((scope) => scope !== COMMON),
      items: values("item"),
    };
  },

  /** Follows the choice: `onChange(choice, empty)`; 모두 해제 ⇄ 모두 선택 for the scopes. */
  bindBackupPick(form, onChange) {
    const all = form.querySelector("[data-pick-all]");
    const boxes = () => [...form.querySelectorAll('input[name="scope"]')];
    const refresh = () => {
      all.textContent = boxes().every((box) => box.checked) ? "모두 해제" : "모두 선택";
      const choice = this.backupPickChoice(form);
      onChange(choice, !choice.common && !(choice.scopes.length && choice.items.length));
    };
    all.addEventListener("click", () => {
      const on = !boxes().every((box) => box.checked);
      for (const box of boxes()) box.checked = on;
      refresh();
    });
    form.addEventListener("change", refresh);
    refresh();
  },

  /** JSON backups restore the list only; zip backups also bring back the audio files they hold. */
  async openRestore(file) {
    if (!file) return;
    // Recognise a zip by its signature, so a renamed backup still restores.
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const zipped =
      head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
    const audio = new Map();
    let input;
    if (zipped) {
      const files = readZip(await file.arrayBuffer());
      const catalog = files.get(BACKUP_CATALOG);
      if (!catalog)
        throw new Error("씬보이스 백업 zip이 아닙니다. (목록 파일 없음)");
      input = JSON.parse(new TextDecoder().decode(catalog));
      for (const [name, bytes] of files)
        if (name.startsWith("audio/")) audio.set(name.slice(6), bytes);
    } else {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("목록 백업은 25MB 이하 파일을 선택해 주십시오.");
      input = JSON.parse(await file.text());
    }
    const preview = await this.transport.local.store.previewRestore(input);
    const fromZip = preview.missing.filter((name) => audio.has(name));
    document.getElementById("sv-restore-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "sv-restore-dialog";
    dialog.className = "sv-dialog";
    const data = preview.data;
    const stat = (label, value, warn = false) =>
      `<div class="${warn ? "sv-stat-warn" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`;
    const lost = preview.missing.length - fromZip.length;
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></span>
        <div><h3>백업 복원</h3><small class="sv-file-name"><i class="fa-solid fa-file-code" aria-hidden="true"></i>${escapeHtml(file.name)}</small></div>
        ${infoTip("복원하기 전 목록은 실리태번의 scenevoice_*_previous.json에 한 개씩 보관됩니다. 미리보기를 연 뒤 다른 기기에서 목록이 바뀌면 파일을 다시 골라야 합니다.\n여러 봇카드가 같이 쓰는 인물과 그 기록은 ‘글로벌 인물’에 있습니다.", "백업 복원 설명")}
      </header>
      ${this.backupPickHtml({ ...preview.contents, summary: backupSummary(data), settings: data.settings })}
      ${zipped || lost ? `<dl class="sv-stats">${zipped ? stat("zip에서 되살릴 음성", `${fromZip.length}개`) : ""}${stat("없는 음성 파일", `${lost}개`, lost > 0)}</dl>` : ""}
      <p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${zipped ? "음성 파일이 든 백업입니다. 이 실리태번에 없는 음성 파일은 zip에서 다시 올립니다." : "이 JSON에는 음성 파일이 들어 있지 않습니다. 없는 파일은 대사 기록만 복원합니다."} 기존 API 키와 이미 있는 음성 파일은 그대로 둡니다.</span></p>
      <p class="sv-notice sv-notice-danger"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>고른 봇카드의 고른 항목은 지금 기록이 지워지고 백업 파일 내용으로 바뀝니다. 합쳐지지 않습니다. 고르지 않은 것은 그대로 둡니다.</span></p>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn">취소</button><button type="button" id="sv-restore-apply" class="sv-btn sv-btn-primary">선택한 범위 복원</button></footer></form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    const form = dialog.querySelector("form");
    const apply = dialog.querySelector("#sv-restore-apply");
    this.bindBackupPick(form, (choice, empty) => {
      apply.disabled = empty;
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("#sv-restore-apply").onclick = () =>
      this.run(async () => {
        if (
          document.querySelector(".sv-loading,.sv-queued") ||
          this.phoneBusy ||
          this.voiceMessageBusy ||
          this.stateTrackingBusy
        )
          throw new Error("진행 중인 작업이 끝난 뒤 복원해 주십시오.");
        dialog.querySelectorAll("button").forEach((x) => {
          x.disabled = true;
        });
        try {
          const choice = this.backupPickChoice(form);
          // Only the voices the chosen records use come out of the zip.
          const needed = wholeChoice(choice, preview.contents)
            ? null
            : new Set(audioHolders(pickBackup(data, choice)).map((row) => row.audio_filename));
          const staged = fromZip.filter((name) => !needed || needed.has(name));
          if (staged.length) {
            const store = this.transport.local.store;
            for (const name of staged) await store.stageAudio(name, audio.get(name));
            const restored = new Set(staged);
            preview.missing = preview.missing.filter((name) => !restored.has(name));
          }
          await this.transport.local.store.restoreCatalog(preview, choice);
          this.resetChat();
          await this.loadConfig();
          this.removeDecorations();
          this.scheduleScan();
          dialog.close();
          await this.openPanel();
          this.notify("선택한 백업 내용을 복원했습니다.", "success");
        } finally {
          dialog.querySelectorAll("button").forEach((x) => {
            x.disabled = false;
          });
        }
      });
    dialog.showModal();
  },
};
