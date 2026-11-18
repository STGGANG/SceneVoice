// 업데이트 안내: shown once, and again only when the notes themselves change; ⋯ → 업데이트 내역
// shows them any time.
import { escapeHtml } from "./common.js";

const SEEN_KEY = "scenevoice_seen_update";

// Newest first. Short and plain: what a user notices, not how it works. `bubble`: a line said
// on top; `highlight`: [title, lines] in a tinted box under it; `fold`: kept under 이전 업데이트
// (folded) instead of shown open.
export const UPDATE_NOTES = [
  {
    version: "1.3.2",
    sections: [
      [
        "새로 생긴 것",
        ["음성 메모를 바로 내려받기 (음성을 만든 메모 아래 ⤓ 버튼)"],
      ],
      [
        "고친 것",
        [
          "발음 사전에 보리차 같은 일반 단어까지 자동으로 들어가던 것 (이제 이름·고유명사·지어낸 용어만)",
          "버텍스 연결 프로필의 키가 지금 연결의 키와 달라 요청이 거절되거나 다른 키로 보내질 때, 두 키를 맞추라고 안내 (실리태번이 버텍스 요청을 지금 연결의 키로 보내는 문제)",
        ],
      ],
    ],
  },
  {
    version: "1.3.1",
    sections: [
      [
        "새로 생긴 것",
        [
          "미적용 기억의 대화를 원래 메시지(같은 번호)에 다시 적용하기 (그 메시지에 다른 기록이 있으면 덮어쓸지 확인 · 대화가 그 뒤로 이어졌으면 시간 순서대로 끼워진다고 안내)",
          "채팅 기억에서 해당 통화·문자를 스마트폰으로 바로 열기 (‘스마트폰에서 보기’)",
        ],
      ],
    ],
  },
  {
    version: "1.3.0",
    highlight: [
      "꼭 확인해 주세요",
      [
        "선연락 기능을 쓰던 분: 이제 봇카드마다 [캐릭터] 탭 → 봇카드 공통 설정 → 스마트폰의 ‘선연락 받기’를 켜야 옵니다.",
        "‘캐릭터’ 탭의 ‘상태 추적 사용’ 스위치가 없어졌습니다. 상태 추적은 [스마트폰] 탭의 ‘선연락’을 켜고, 연락 방식을 ‘인물별 상태 추적’으로 골랐을 때 돕니다.",
        "실효성이 없는 인물의 ‘생각 목소리’ 칸을 없애고 대사 목소리와 통합했습니다.",
        "‘최대 입력 토큰’·‘최대 출력 토큰’ 설정을 없앴습니다. 이제 연결 프로필의 최대 입력·출력 토큰을 따릅니다.",
      ],
    ],
    sections: [
      [
        "새로 생긴 것",
        [
          "첫 설정 안내: 엔진·키·연결·쓸 기능을 차례로 고르고, 세 탭이 무엇을 정하는 곳인지 알려 주는 안내 (⋯ 메뉴에서 다시 보기)",
          "선연락 ‘랜덤’ 방식: 상태 분석 없이 확률로 연락 (빈도 조절, 상황에 맞을 때만 보내기)",
          "선연락 ‘시간’ 방식: 채팅을 하지 않아도 정한 시간 간격으로 연락 (하루 최대 횟수는 봇카드별)",
          "시간 방식인 봇카드는 다른 봇카드와 채팅 중일 때도 문자를 보냄 (알림을 누르면 채팅을 옮기지 않고 스마트폰에서 바로 보고 답장, 플로팅 버튼에 보낸 인물의 사진)",
          "선연락 전체 스위치와 봇카드별 ‘선연락 받기’(스위치 아래 안내에서 바로가기), 봇카드마다 다른 연락 방식 고르기",
          "봇카드별 ‘연락하지 않는 시간’: 그 시간에는 인물들이 먼저 연락하지 않음 (랜덤·시간 방식)",
          "연락 방식 비교: 세 방식이 도는 순서, 좋은 점·아쉬운 점, 빈도 예시를 한눈에",
          "스스로 대화하기: 인물들이 이야기에 맞을 때 나 없는 방을 만들어 대화",
          "자기가 속한 다른 문자·전화 내용 알기 (보완), 문자에서 들은 것을 다른 인물에게 전하기",
          "발음 사전: 음성 엔진이 잘못 읽는 이름·단어의 읽는 법 지정 (분석할 때 알아서 찾기, 봇카드별 구분)",
          "메시지 액션버튼 ‘분석 보기’ 창: 이제 바로 분석하지 않고 리스트를 보여준 뒤 골라서 다시 분석·고치기·음성 재생성·내려받기 가능",
          "채팅창에서 빠른 대사별 음성 내려받기 (대사 옆 ⋯)",
          "채팅 기억을 말풍선 모양으로 보기 (기본값, 설정 → 스마트폰 → 화면에서 원문으로 바꿀 수 있음)",
          "문자별 음성 내려받기 (문자 아래 ⋯)",
          "미적용 기억의 문자 대화 한 번에 듣기",
          "설정 이름 옆에 AI 요청 횟수 표시",
          "추가 지침: 직접 적은 글을 모든 보조모델 요청의 맨 끝에 항상 덧붙임 (설정 → 공통)",
          "문자 카드: 사진·위치·약속·송금·선물·노래·영상·투표를 주고받고, 받은 쪽이 수락·거절하거나 투표 항목을 고름",
          "문자에 이모지 반응 남기기 (문자 아래 ⋯에서 고르거나 원하는 이모지를 직접 입력), 인물도 가끔 반응을 남김",
          "문자에 사진 첨부 (이미지를 읽는 모델, Chat Completion 연결)",
          "인용 답장, 읽음 표시",
          "단체방에서 내보내진 사람이 따로 문자를 보냄 (먼저 문자 보내기가 켜져 있을 때)",
          "음성 메모 길이 고르기 (기본 / 길게)",
          "프롬프트 직접 수정: 1:1 전화·문자의 말투 지시문을 직접 고치기",
          "공간감 및 좌우 효과: 대사가 들리는 방향과 거리",
          "인물별 음량 맞춤: 인물마다 다른 목소리 크기를 비슷하게",
          "목소리 고르기 드롭다운 메뉴에서 종류·언어 필터와 미리 듣기",
          "글로벌 인물 폴더기능 및 빠른 사용 설정",
          "이어 듣는 중 자막 띠에서 앞·다음 대사로 넘기기",
        ],
      ],
      [
        "좋아진 것",
        [
          "메시지의 [음성] 버튼이 실리태번 기본 버튼 모양을 따라가고, 이름은 ‘이어 듣기’로 통일",
          "스마트폰 설정을 기본 / 전화·문자·앱 / 선연락·인물별 상태 추적으로 정리",
          "단체방 기본값: 따로 정하지 않은 단체방은 설정의 값(대화 주기·하루 최대·한 번에 생성할 대사)을 따르고, 방 설정에서 ‘이 방만 따로 정하기’로 바꿀 수 있음",
          "음성 엔진의 키 저장 여부를 표시",
          "전화·문자의 말투 지시문 보강 (인물의 관점과 삶, 자연스러운 문자 말투)",
          "생성 음성 전체 삭제는 ⋯ → 데이터 초기화로 이동",
          "나에게 오는 연락은 어느 방식이든 한 번에 두 명까지 (전화는 한 명)",
          "랜덤·시간 방식의 전화: 울리기 전에 첫 대사를 미리 써서, 받으면 바로 시작 (확인 요청을 따로 보내지 않음)",
          "상태 추적: 별일 없는 순간에도 가볍게 연락하고, 다툰 뒤에는 인물 성격에 따라 연락하게",
          "상태 추적: 상태를 채팅 언어로 기록 (전에는 영어, 이미 저장된 상태는 다음에 바뀔 때부터)",
          "QR로 받은 답변(/sendas 등)은 상태 추적·전화·문자가 읽지 않고 답변 수에도 세지 않음 (설정 → 공통 → 보조모델 분석 → 채팅 읽기에서 끌 수 있음)",
          "숨긴 메시지 읽는 방식 고르기: 원문 그대로 읽기(기본) / 요약으로 대신 읽기 (요약 확장이 채팅에 주입하는 글을 씬보이스도 읽음)",
          "이유 없이 뽑힌 연락이 없던 일을 구실로 지어내지 않게 지시문 보강",
          "설정 화면 정리: 공통 탭을 기본(음성 엔진) / 채팅 대사 / 보조모델 분석으로, 묶음을 모두 접을 수 있게, 봇카드의 스마트폰 설정을 한 섹션으로, 겹치던 선 정리",
          "만들어 둔 채팅 대사 음성이 설정을 바꾼 뒤에도 그대로 남아 바로 재생 (전에는 새로고침하면 음성이 없다고 뜸. 메시지나 대사를 고친 경우는 새로 만들어야 함)",
          "한 번 한 대사 분석도 설정을 바꾸거나 업데이트한 뒤에 그대로 남음 (새로 분석하려면 분석 보기 → 다시 분석 · 업데이트 직후 한 번은 음성이 없는 메시지가 분석 전으로 보일 수 있음)",
          "골라서 백업·복원의 종류를 ‘채팅 대사’와 ‘스마트폰’으로 구분",
          "설정 표현 통일 (보조모델, 월드인포, 말투·연기 메모, 공통 연락 빈도 등)",
          "감정·소리 태그 제안에 음성 엔진 공식 안내의 태그 보강, 태그 칩을 감정 흐름 순서대로",
          "감정 태그를 분석하는 프롬프트를 보완하였습니다. NSFW 장면에 숨소리 등을 더 적극 활용하고, 그 외 장면에서도 정확도를 높이려했습니다.",
          "감정이 격한 대사는 ‘연기 일관성’ 설정에서 조금 더 풀어서 연기합니다 (평범한 대사는 설정값 그대로).",
          "문자 아래 버튼 정리: 재생만 밖에 두고 나머지는 ⋯ 안으로, 답변 재생성은 아랫줄로",
          "저절로 오는 문자·음성 메모·엿듣는 통화의 요청이 실패하면 잠시 뒤 한 번 더 시도 (전에는 그냥 넘어감)",
          "스마트폰 파란 테마 색을 부드럽게",
        ],
      ],
      [
        "고친 것",
        [
          "‘글로벌로 옮기기’를 하면 모든 봇카드에 해당 인물이 켜지던 문제",
          "목소리 목록에서 Esc를 누르면 설정 창까지 닫히던 문제",
          "봇카드를 열지 않은 화면에서 ‘SillyTavern System’이 인물 목록에 생기던 문제",
          "일부 테마에서 문자 입력칸 글자가 위로 쏠리던 문제",
          "봇카드 하나의 기록만 인물 설정 없이 백업한 파일이 제대로 복원되지 않던 문제",
          "실리태번에서 채팅 이름을 바꾸면 그 채팅의 전화·문자 기록과 상태가 안 보이던 문제 (이미 바꾼 채팅도 열면 되찾음)",
        ],
      ],
    ],
  },
  {
    version: "1.2.6",
    fold: true,
    highlight: [
      "기타 안내",
      [
        "스마트폰 관련 프롬프트는 보완 및 테스트 중으로, 유의미한 변경이 있으면 추가 안내하겠습니다.",
      ],
    ],
    sections: [
      [
        "새로 생긴 것",
        [
          "보조모델 연결에 ‘현재 연결 사용’: 연결 프로필 없이 실리태번에 지금 연결된 API·모델로 분석·전화·문자 (실리태번 1.15 이상 · 예전 ‘사용 안 함’은 ‘분석 끔’으로 이름이 바뀜)",
        ],
      ],
      [
        "좋아진 것",
        [
          "보조모델 요청에서 채팅용 설정(정지 문자열·웹 검색 등)을 빼고 보내, 답이 끊기거나 깨지는 일을 줄임 (프리필은 그대로)",
          "분석이 실패하면 알림에 이유를 같이 표시 (빈 답이면 검열이나 출력 한도 부족일 수 있다고 알려 줌)",
          "메시지 ‘정지’를 누르면 진행 중인 분석 요청도 바로 멈춤",
        ],
      ],
      [
        "고친 것",
        [
          "새로고침하거나 채팅을 다시 열면, 같이 분석된 다른 대사의 화자가 ⋯ 메뉴에 ‘자동’으로 보이던 문제",
        ],
      ],
    ],
  },
  {
    version: "1.2.5",
    fold: true,
    sections: [
      [
        "좋아진 것",
        [
          "실리태번 1.12.14부터 쓸 수 있게 (전에는 1.19 이상만)",
          "보조모델 응답을 2분이 아니라 10분까지 기다리게",
        ],
      ],
    ],
  },
  {
    version: "1.2.4",
    fold: true,
    sections: [
      [
        "새로 생긴 것",
        [
          "라디오에 ‘시나리오’ 방송: 내가 적은 흐름(설정·순서·결말)대로 비슷하게 만들어 주는 방송",
          "라디오 전화 연결: 진행자가 아닌 인물이 전화로 연결돼 의견을 말하거나 질문을 받기 (어울릴 때 알아서, 또는 직접 고르기)",
          "라디오 기억: 기억을 켠 방송은 다음 방송이 내용을 알고 시작 (라디오끼리만 · 기본 꺼짐)",
          "연락처 상태메시지: 인물이 어울릴 때 직접 바꾸는 프로필 한 줄 (상태가 갱신될 때나 문자를 주고받다가 · 연락처 편집에서 직접 고치기도 가능)",
        ],
      ],
      [
        "좋아진 것",
        [
          "새 채팅에 첫 메시지(그리팅)만 있을 때는 상태를 자동으로 분석하지 않음 (필요하면 상태 탭 ‘지금 분석’)",
        ],
      ],
      [
        "고친 것",
        [
          "‘상태 추적 사용’을 끄고 먼저 연락하기만 켜 두면, ‘바쁨’인 인물에게도 전화가 연결되고 음성 메모도 알아서 남지 않던 문제",
        ],
      ],
    ],
  },
  {
    version: "1.2.3",
    fold: true,
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
    fold: true,
    sections: [
      [
        "새로 생긴 것",
        [
          "라디오 (번외): 인물들이 지금까지 이야기를 두고 떠드는 토크, 또는 내 사연을 읽어 주는 방송",
          "실시간 단체 통화: 연락처나 단체 문자방에서 여러 명에게 한꺼번에 전화 (사칭 X 직접 통화)",
          "들려주기: 지난 통화·음성 메시지를 (공유 ↗) 버튼으로 다른 인물에게 보내면, 듣고 답장",
          "통화 중 옆에 있는 인물이 뒤에서 한마디 하거나, 전화를 바꿔 받기도 함 (‘○○ 바꿔 줘’도 됩니다)",
          "음성 메모 앱: 인물이 혼자 스마트폰에 남긴 음성 메모 엿듣기 (직접 만들기 · 상태 추적 시 알아서)",
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
          "목소리 하나로 통일한 봇카드도 언어·선연락 빈도·상태 분석 제외 정하기",
        ],
      ],
      [
        "좋아진 것",
        [
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

function notesHash(entry) {
  const text = JSON.stringify(entry || "");
  let hash = 5381;
  for (let i = 0; i < text.length; i++)
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Changes with the newest notes' wording only: a new version number alone doesn't bring them up. */
export function updateNotesKey() {
  return `notes-${notesHash({ ...UPDATE_NOTES[0], version: undefined })}`;
}

/**
 * These notes were seen: under today's key, or under the key kept before (`<version>-<hash>`, the
 * hash taken with that version in it), so a browser that saw them as 1.2.2 isn't shown them again.
 */
function notesSeen(seen) {
  if (!seen) return false;
  if (seen === updateNotesKey()) return true;
  const at = seen.lastIndexOf("-");
  const version = at > 0 ? seen.slice(0, at) : "";
  return (
    Boolean(version) &&
    version !== "notes" &&
    seen === `${version}-${notesHash({ ...UPDATE_NOTES[0], version })}`
  );
}

const listHtml = (lines) =>
  `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
const notesHtml = (entry) =>
  (entry.bubble
    ? `<div class="sv-update-bubble"><span class="sv-update-face" aria-hidden="true"><i class="fa-solid fa-microphone-lines"></i></span><p>${escapeHtml(entry.bubble)}</p></div>`
    : "") +
  (entry.highlight?.[1]?.length
    ? `<div class="sv-update-highlight"><h4>${escapeHtml(entry.highlight[0])}</h4>${listHtml(entry.highlight[1])}</div>`
    : "") +
  entry.sections
    .map(([title, lines]) => `<h4>${escapeHtml(title)}</h4>${listHtml(lines)}`)
    .join("");

export const updates = {
  /** `force`: from the ⋯ menu, even when this version was already seen. */
  showUpdateNotes({ force = false } = {}) {
    const [latest, ...rest] = UPDATE_NOTES;
    const open = rest.filter((entry) => !entry.fold);
    const older = rest.filter((entry) => entry.fold);
    if (!latest || document.getElementById("sv-update-dialog")) return;
    const key = updateNotesKey();
    try {
      const seen = notesSeen(localStorage.getItem(SEEN_KEY));
      localStorage.setItem(SEEN_KEY, key);
      if (!force && seen) return;
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
        .map(
          (entry) =>
            `<h4 class="sv-update-version sv-update-open">v${escapeHtml(entry.version)}</h4>${notesHtml(entry)}`,
        )
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
