// 업데이트 안내: shown once, and again only when the notes themselves change; ⋯ → 업데이트 내역
// shows them any time.
import { escapeHtml } from "./common.js";

const SEEN_KEY = "scenevoice_seen_update";

// Newest first. Short and plain: what a user notices, not how it works. `bubble`: a line said
// on top; `highlight`: [title, lines] in a tinted box under it; `fold`: kept under 이전 업데이트
// (folded) instead of shown open.
export const UPDATE_NOTES = [
  {
    version: "1.2.2",
    highlight: [
      "기타 안내",
      ["스마트폰 관련 프롬프트는 보완 및 테스트 중으로, 유의미한 변경이 있으면 추가 안내하겠습니다."],
    ],
    sections: [
      [
        "새로 생긴 것",
        [
          "봇카드 이름을 바꿔도 스마트폰 기록이 그대로 이어짐 (이미 끊긴 건 ⋯ 메뉴 → ‘봇카드 기록 다시 잇기’)",
          "읽고 있는 대사 자막을 누르면 멈춤·이어 듣기 (QR 버튼용 /sv-pause · 설정에서 QR에 바로 추가)",
          "대사 자막 위치를 위(상단바 밑)·아래(입력창 위) 중에서 고르기",
        ],
      ],
      [
        "좋아진 것",
        [
          "메시지 버튼 이름을 짧게: 음성 · 재생 · 이어서 · 중지 / 분석 (‘건너뛰었습니다’ 알림은 없앰)",
        ],
      ],
    ],
  },
  {
    version: "1.2.1",
    sections: [
      [
        "새로 생긴 것",
        [
          "라디오 (번외): 인물들이 지금까지 이야기를 두고 떠드는 토크, 또는 내 사연을 읽어 주는 방송",
          "실시간 단체 통화: 연락처나 단체 문자방에서 여러 명에게 한꺼번에 전화 (사칭 X 직접 통화)",
          "들려주기: 지난 통화·음성 메시지를 (공유 ↗) 버튼으로 다른 인물에게 보내면, 듣고 답장",
          "통화 중 옆에 있는 인물이 뒤에서 한마디 하거나, 전화를 바꿔 받기도 함 (‘○○ 바꿔 줘’도 됩니다)",
          "음성 메모 앱: 인물이 혼자 휴대폰에 남긴 음성 메모 엿듣기 (직접 만들기 · 상태 추적 시 알아서)",
          "통화 맡기기: 나(페르소나)와 지정한 상대의 통화를 AI가 내 대사까지 통째로 작성 (사칭 O)",
          "통화 엿듣기·맡기기를 여러 명(최대 5명)도 가능하게, ‘이어 가며 듣기’로 다음 내용을 지시하며 길게 이어 가기",
          "‘바쁨’ 상태인 인물에게 전화하면 음성사서함으로 (상태 추적 사용 시 · 메시지를 남기면 나중에 연락이 옴 · 한 번 더 걸면 그냥 받음)",
          "지난 통화의 대사 고치기 · 음성 재생성",
        ],
      ],
      [
        "좋아진 것",
        [
          "지난 통화의 ‘전체 듣기’도 통화 화면으로",
          "폰 음질 효과를 스위치 하나로 (통화·음성 메시지·메모·라디오 모두)",
          "스마트폰: 가독성을 고려하여 UI 정리",
        ],
      ],
    ],
  },
  {
    version: "1.1.0",
    fold: true,
    sections: [
      [
        "새로 생긴 것",
        [
          "백업을 봇카드·항목별로 골라서 저장하고, 복원할 때도 골라서 불러오기 (⋯ 메뉴)",
          "통화를 영상으로 내려받기",
          "통화·문자방 음성을 파일 하나로 내려받기",
          "내가 보낸 문자도 ✏로 고치기",
          "대필이 다른 언어면 한국어 번역을 입력칸 아래에 함께 보여 주기",
          "폰 플로팅 버튼을 끌어서 옮기기",
          "엿듣는 통화 길이 고르기: 짧게 · 보통 · 길게",
          "통화 답변을 다시 받아도 이전 답은 남기기 (‹ › 로 넘겨 보기)",
          "기록 탭에서 한 화자의 기록 모두 지우기",
          "목소리 하나로 통일한 봇카드도 언어·먼저 연락하는 빈도·상태 분석 제외 정하기",
        ],
      ],
      ["좋아진 것", ["통화 중 입력할 때 렉을 줄이고 폰 전체를 가볍게 (특히 모바일)", "수화기 필터를 덜 먹먹하게"]],
      [
        "고친 것",
        ["통화를 끊지 않고 나갔다 오면 뜬금없는 답이 붙던 문제", "아이폰에서 대사를 고친 뒤 음성이 로딩만 하고 재생되지 않던 문제"],
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
    const [latest, ...rest] = UPDATE_NOTES;
    const open = rest.filter((entry) => !entry.fold);
    const older = rest.filter((entry) => entry.fold);
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
      <div class="sv-update-notes">${notesHtml(latest)}${open
        .map((entry) => `<h4 class="sv-update-version sv-update-open">v${escapeHtml(entry.version)}</h4>${notesHtml(entry)}`)
        .join("")}${
        older.length
          ? `<details class="sv-update-older"><summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>이전 업데이트 (${escapeHtml(older[0].version)}까지) 보기</summary>${older.map((entry) => `<h4 class="sv-update-version">v${escapeHtml(entry.version)}</h4>${notesHtml(entry)}`).join("")}</details>`
          : ""
      }</div>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn sv-btn-primary" value="ok" autofocus>확인</button></footer>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  },
};
