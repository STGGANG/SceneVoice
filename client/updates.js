// 업데이트 안내: shown once per version (until 확인), and again from ⋯ → 업데이트 내역.
import { escapeHtml } from "./common.js";

const SEEN_KEY = "scenevoice_seen_update";

// Newest first. Short and plain: what a user notices, not how it works.
export const UPDATE_NOTES = [
  {
    version: "1.0.5",
    sections: [
      [
        "새로 생긴 것",
        [
          "통화·문자방 음성을 파일 하나로 내려받기 (통화 기록의 ‘내려받기’, 문자방 위 다운로드 버튼)",
          "내가 보낸 문자도 ✏로 고치기",
          "대필이 다른 언어면 한국어 번역을 입력칸 아래에 함께 보여 주기",
          "폰 플로팅 버튼을 끌어서 옮기기 (설정 → 스마트폰에서 ‘처음 자리로’)",
          "엿듣는 통화 길이 고르기: 짧게 · 보통 · 길게",
        ],
      ],
      [
        "좋아진 것",
        [
          "스마트폰 프롬프트 보완",
          "통화 중 입력할 때 렉을 줄이고 폰 전체를 가볍게 (특히 모바일)",
          "수화기 필터를 덜 먹먹하게",
        ],
      ],
      [
        "고친 것",
        [
          "통화를 끊지 않고 나갔다 오면 뜬금없는 답이 붙던 문제",
        ],
      ],
    ],
  },
];

const notesHtml = (entry) =>
  entry.sections
    .map(([title, lines]) => `<h4>${escapeHtml(title)}</h4><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`)
    .join("");

export const updates = {
  /** `force`: from the ⋯ menu, even when this version was already seen. */
  showUpdateNotes({ force = false } = {}) {
    const [latest, ...older] = UPDATE_NOTES;
    if (!latest || document.getElementById("sv-update-dialog")) return;
    let seen = "";
    try {
      seen = localStorage.getItem(SEEN_KEY) || "";
    } catch {
      /* storage blocked: shown each time */
    }
    if (!force && seen === latest.version) return;
    const dialog = document.createElement("dialog");
    dialog.id = "sv-update-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-bullhorn"></i></span>
        <div><h3>씬보이스 업데이트</h3><small>v${escapeHtml(latest.version)}</small></div>
      </header>
      <div class="sv-update-notes">${notesHtml(latest)}${
        older.length
          ? `<details><summary>이전 업데이트</summary>${older.map((entry) => `<h4 class="sv-update-version">v${escapeHtml(entry.version)}</h4>${notesHtml(entry)}`).join("")}</details>`
          : ""
      }</div>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn sv-btn-primary" value="ok">확인</button></footer>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === "ok")
        try {
          localStorage.setItem(SEEN_KEY, latest.version);
        } catch {
          /* storage blocked */
        }
      dialog.remove();
    });
    dialog.showModal();
  },
};
