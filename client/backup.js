// 백업 복원: the restore dialog for a settings/records JSON or a full zip, with a preview first.
import { escapeHtml } from "./common.js";
import { infoTip, fieldHtml, bindInfoTips } from "./ui.js";
import { readZip } from "./zip.js";
import { BACKUP_CATALOG } from "./maintenance.js";
export const backup = {
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
        throw new Error("씬보이스 전체 백업 zip이 아닙니다. (목록 파일 없음)");
      input = JSON.parse(new TextDecoder().decode(catalog));
      for (const [name, bytes] of files)
        if (name.startsWith("audio/")) audio.set(name.slice(6), bytes);
    } else {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("목록 백업은 25MB 이하 파일을 선택해 주세요.");
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
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></span>
        <div><h3>백업 복원</h3><small class="sv-file-name"><i class="fa-solid fa-file-code" aria-hidden="true"></i>${escapeHtml(file.name)}</small></div>
        ${infoTip("복원하기 전 목록은 실리태번의 scenevoice_*_previous.json에 한 개씩 보관됩니다. 미리보기를 연 뒤 다른 기기에서 목록이 바뀌면 파일을 다시 골라야 합니다.", "백업 복원 설명")}
      </header>
      <dl class="sv-stats">
        ${stat("생성 기록", `${data.generations.length}개`)}
        ${stat("보관함", `${data.favorites.length}개`)}
        ${stat("전화", `${data.sessions.length}개`)}
        ${zipped ? stat("zip에서 되살릴 음성", `${fromZip.length}개`) : ""}
        ${stat("없는 음성 파일", `${preview.missing.length - fromZip.length}개`, preview.missing.length - fromZip.length > 0)}
      </dl>
      <p class="sv-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${zipped ? "전체 백업입니다. ‘설정·목록 교체’를 고르면 이 실리태번에 없는 음성 파일을 zip에서 다시 올립니다." : "이 JSON에는 음성 파일이 들어 있지 않습니다. 없는 파일은 대사 기록만 복원합니다."} 기존 API 키와 이미 있는 음성 파일은 그대로 둡니다.</span></p>
      ${fieldHtml({ id: "sv-restore-mode", label: "복원 범위", control: '<select id="sv-restore-mode"><option value="settings">설정만 복원 (현재 기록 유지)</option><option value="all">설정·목록을 백업 내용으로 교체</option></select>' })}
      <p class="sv-notice sv-notice-danger sv-restore-warning" hidden><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>현재 생성 기록·보관함·전화 기록 목록이 백업 내용으로 바뀝니다.</span></p>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn">취소</button><button type="button" id="sv-restore-apply" class="sv-btn sv-btn-primary">선택한 범위 복원</button></footer></form>`;
    document.body.append(dialog);
    bindInfoTips(dialog);
    const mode = dialog.querySelector("#sv-restore-mode");
    mode.addEventListener("change", () => {
      dialog.querySelector(".sv-restore-warning").hidden =
        mode.value !== "all";
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
          throw new Error("진행 중인 작업이 끝난 뒤 복원해 주세요.");
        dialog.querySelectorAll("button").forEach((x) => {
          x.disabled = true;
        });
        try {
          const settingsOnly =
            dialog.querySelector("#sv-restore-mode").value === "settings";
          if (!settingsOnly && fromZip.length) {
            const store = this.transport.local.store;
            for (const name of fromZip) await store.stageAudio(name, audio.get(name));
            const restored = new Set(fromZip);
            preview.missing = preview.missing.filter((name) => !restored.has(name));
          }
          await this.transport.local.store.restoreCatalog(preview, settingsOnly);
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
