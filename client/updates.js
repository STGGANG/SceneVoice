// 업데이트 안내: shown once, and again only when the notes themselves change; ⋯ → 업데이트 내역
// shows them any time.
import { escapeHtml } from "./common.js";

const SEEN_KEY = "scenevoice_seen_update";

// Newest first. Short and plain: what a user notices, not how it works. `bubble`: a line said
// on top; `highlight`: [title, lines] in a tinted box under it.
export const UPDATE_NOTES = [
  {
    version: "1.1.1",
    bubble: "제작자가 몇가지 업데이트를 깜빡했다네요… 슬쩍 추가했습니다.",
    highlight: [
      "기타 안내",
      ["스마트폰 관련 프롬프트는 보완 및 테스트 중으로, 유의미한 변경이 있으면 추가 안내하겠습니다."],
    ],
    sections: [
      [
        "새로 생긴 것",
        [
          "통화 엿듣기에서 ‘나(페르소나)’도 고르기 (내 대사까지 쓰고, 내가 한 통화로 남겨요)",
          "지난 통화(엿들은 통화 포함)의 대사 고치기 · 음성 재생성 (통화 기록에서)",
          "백업을 봇카드·항목별로 골라서 저장하고, 복원할 때도 골라서 불러오기 (⋯ 메뉴)",
          "통화·문자방 음성을 파일 하나로 내려받기 (통화 기록의 ‘내려받기’, 문자방 위 다운로드 버튼)",
          "통화를 영상으로 내려받기 (통화 기록의 ‘영상’ 버튼)",
          "내가 보낸 문자도 ✏로 고치기",
          "대필이 다른 언어면 한국어 번역을 입력칸 아래에 함께 보여 주기",
          "폰 플로팅 버튼을 끌어서 옮기기",
          "엿듣는 통화 길이 고르기: 짧게 · 보통 · 길게",
          "통화 답변을 다시 받아도 이전 답은 남기기 (‹ › 로 넘겨 보기)",
          "기록 탭에서 한 화자의 기록 모두 지우기",
          "목소리 하나로 통일한 봇카드도 언어·먼저 연락하는 빈도·상태 분석 제외 정하기",
        ],
      ],
      [
        "좋아진 것",
        [
          "지난 통화의 ‘전체 듣기’도 통화 화면으로 (엿듣기처럼)",
          "단체방 메시지가 올라오는 간격을 글 길이에 맞게 자연스럽게",
          "문자 ‘한 번에 듣기’는 음성이 두 개 준비되면 시작 (중간에 덜 끊기게)",
          "재생 ▶ · 음성 재생성 ↻ · 답변 재생성 ⟳ · 고치기 ✎ 아이콘을 어디서나 같게",
          "통화 중 입력할 때 렉을 줄이고 폰 전체를 가볍게 (특히 모바일)",
          "수화기 필터를 덜 먹먹하게",
        ],
      ],
      [
        "고친 것",
        [
          "통화를 끊지 않고 나갔다 오면 뜬금없는 답이 붙던 문제",
          "아이폰에서 대사를 고친 뒤 음성이 로딩만 하고 재생되지 않던 문제",
        ],
      ],
    ],
  },
];

/** Changes with the newest notes' wording, not with the version number. */
export function updateNotesKey() {
  const text = JSON.stringify(UPDATE_NOTES[0] || "");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return `${UPDATE_NOTES[0]?.version || ""}-${hash.toString(36)}`;
}

const listHtml = (lines) => `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
const notesHtml = (entry) =>
  (entry.bubble
    ? `<div class="sv-update-bubble"><span class="sv-update-face" aria-hidden="true"><i class="fa-solid fa-microphone-lines"></i></span><p>${escapeHtml(entry.bubble)}</p></div>`
    : "") +
  (entry.highlight?.[1]?.length
    ? `<div class="sv-update-highlight"><h4>${escapeHtml(entry.highlight[0])}</h4>${listHtml(entry.highlight[1])}</div>`
    : "") +
  entry.sections.map(([title, lines]) => `<h4>${escapeHtml(title)}</h4>${listHtml(lines)}`).join("");

export const updates = {
  /** `force`: from the ⋯ menu, even when this version was already seen. */
  showUpdateNotes({ force = false } = {}) {
    const [latest, ...older] = UPDATE_NOTES;
    if (!latest || document.getElementById("sv-update-dialog")) return;
    const key = updateNotesKey();
    try {
      if (!force && localStorage.getItem(SEEN_KEY) === key) return;
      localStorage.setItem(SEEN_KEY, key);
    } catch {
      /* storage blocked */
    }
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
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  },
};
