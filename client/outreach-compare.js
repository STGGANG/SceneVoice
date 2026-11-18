// 연락 방식 비교: a window that sets the three ways people reach out side by side, in plain
// words: how each runs, what it is good and bad at, and what the numbers come to. The numbers are
// worked out from the same constants the dice use.

import { RANDOM_OUTREACH_BASE } from "../shared/settings.js";
import {
  URGENCY_WEIGHT,
  BUSY_WEIGHT,
  CHANCE_CAP,
  randomChance,
} from "./outreach.js";

const RATES = [
  [10, "거의 안 함"],
  [30, "가끔"],
  [50, "보통"],
  [70, "자주"],
  [90, "매우 자주"],
];
const percent = (value) => `${Math.round(value * 100)}%`;

// Each step says whether it costs an AI request: [what happens, the mark].
const AI = "AI 요청";
const FREE = "요청 없음";
const WAYS = [
  {
    key: "state",
    icon: "heart-pulse",
    name: "인물별 상태 추적",
    line: "이야기에 맞는 순간에 연락",
    steps: [
      ["답변이 몇 개 쌓일 때마다 보조모델이 인물들의 상태를 살핍니다", AI],
      ["같은 요청에서 ‘지금 연락할 만한 사람’도 함께 고릅니다", FREE],
      ["고른 사람이 자기 선연락 빈도만큼의 확률로 연락합니다", FREE],
      ["연락하게 되면 그 전화·문자를 AI가 씁니다", AI],
    ],
    good: [
      "상황에 가장 잘 맞습니다. 같이 있거나 자는 중에는 오지 않습니다",
      "급한 일일수록 잘 옵니다",
      "상태 탭에서 인물이 지금 어떤지도 볼 수 있습니다",
    ],
    bad: [
      "연락이 없어도 주기마다 AI 요청이 1번 듭니다",
      "얼마나 자주 고르는지는 보조모델에 따라 다릅니다",
    ],
    fit: "서사를 진행하며 자연스러운 연락을 받고 싶을 때",
  },
  {
    key: "random",
    icon: "dice",
    name: "랜덤",
    line: "답변이 올 때마다 주사위",
    steps: [
      ["AI 답변이 올 때마다 인물별로 주사위를 굴립니다", FREE],
      ["걸린 사람의 전화·문자를 AI가 씁니다", AI],
      [
        "‘상황에 맞을 때만 연락’이 켜져 있으면, 그 요청 안에서 어색한지 보고 넘깁니다",
        FREE,
      ],
    ],
    good: [
      "걸리기 전에는 AI 요청이 들지 않습니다",
      "별일 없는 때에도 꾸준히 옵니다",
      "얼마나 자주 올지 정하기 쉽습니다",
    ],
    bad: [
      "이야기의 중요한 순간을 알아채지 못합니다",
      "상황 확인을 끄면 같이 있거나 자는 중에도 옵니다",
      "어색해서 넘긴 연락에도 AI 요청이 1번 듭니다",
    ],
    fit: "AI 요청을 아끼면서 가끔씩 연락받고 싶을 때",
  },
  {
    key: "time",
    icon: "clock",
    name: "시간",
    line: "채팅을 안 해도 시간이 지나면",
    steps: [
      ["정해 둔 시간 사이에 무작위로 차례가 옵니다(예: 30~120분)", FREE],
      [
        "켜 둔 것 중 한 가지가 뽑힙니다(나에게 연락, 단체방 대화, 음성 메모 등)",
        FREE,
      ],
      [
        "뽑힌 일을 AI가 씁니다. 나에게 오는 연락이면 선연락 빈도가 높은 인물이 잘 뽑힙니다",
        AI,
      ],
    ],
    good: [
      "실리태번에서 채팅을 하지 않아도 옵니다(실제 메신저처럼)",
      "다른 봇카드와 채팅하고 있을 때도 문자는 옵니다",
      "하루에 몇 번까지 올지 정할 수 있습니다(봇카드별)",
    ],
    bad: [
      "실리태번 창이 열려 있는 동안에만 됩니다",
      "이야기 흐름과 어긋날 수 있습니다",
      "채팅과 별개로 AI 요청이 듭니다",
    ],
    fit: "서사 없이 스마트폰만 쓰거나, 주기적 연락을 받고 싶을 때",
  },
];

const list = (items) =>
  `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

function wayCard(way) {
  return `<article class="sv-way" data-way="${way.key}">
      <header><span class="sv-way-icon" aria-hidden="true"><i class="fa-solid fa-${way.icon}"></i></span><div><strong>${way.name}</strong><small>${way.line}</small></div></header>
      <ol class="sv-way-steps">${way.steps.map(([step, mark]) => `<li><span>${step}</span><em class="${mark === AI ? "sv-way-ai" : "sv-way-free"}">${mark}</em></li>`).join("")}</ol>
      <div class="sv-way-part sv-way-good"><b><i class="fa-solid fa-circle-plus" aria-hidden="true"></i>좋은 점</b>${list(way.good)}</div>
      <div class="sv-way-part sv-way-bad"><b><i class="fa-solid fa-circle-minus" aria-hidden="true"></i>아쉬운 점</b>${list(way.bad)}</div>
      <p class="sv-way-fit"><i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>${way.fit}</p>
    </article>`;
}

const table = (caption, head, rows) =>
  `<div class="sv-compare-table" role="region" aria-label="${caption}" tabindex="0"><table><thead><tr>${head.map((cell) => `<th scope="col">${cell}</th>`).join("")}</tr></thead><tbody>${rows.map(([first, ...cells]) => `<tr><th scope="row">${first}</th>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

/** The window's body: the three ways, a table across them, and what the numbers come to. */
export function outreachCompareHtml() {
  const stateChance = (rate, urgency, busy = false) =>
    Math.min(
      CHANCE_CAP,
      (rate / 100) * URGENCY_WEIGHT[urgency] * (busy ? BUSY_WEIGHT : 1),
    );
  const every = (level, rate) =>
    `${Math.round(1 / randomChance(level, rate))}개마다`;
  const share = (rate) => percent(rate / (90 + 50 + 10));
  return `<section class="sv-compare-ways">${WAYS.map(wayCard).join("")}</section>
    <section>
      <h4>나란히 놓고 보면</h4>
      ${table(
        "세 방식 비교",
        ["", "상태 추적", "랜덤", "시간"],
        [
          [
            "언제 연락이 정해지나",
            "답변 몇 개마다",
            "답변마다",
            "정한 시간마다",
          ],
          [
            "그때 드는 AI 요청",
            "매번 1번(연락이 없어도)",
            "걸렸을 때만",
            "차례마다",
          ],
          ["누가 연락할지", "보조모델이 고른 뒤 주사위", "주사위", "주사위"],
          ["인물이 지금 어떤지 아나", "앎", "모름", "모름"],
          ["실리태번 채팅을 해야 오나", "예", "예", "아니요"],
          [
            "이야기의 중요한 순간",
            "잘 잡음",
            "우연히 맞을 때만",
            "상관없이 옴",
          ],
          ["별일 없는 구간", "가볍게 가끔", "꾸준함", "꾸준함"],
        ],
      )}
      <p class="sv-compare-note">어느 방식이든 나에게는 한 번에 두 명까지 연락하고, 그중 전화는 한 명까지만 가능합니다. 봇카드마다 다른 방식을 쓸 수도 있습니다(‘캐릭터’ 탭 → 봇카드 공통 설정 → 스마트폰).</p>
    </section>
    <section>
      <h4>얼마나 자주 오나</h4>
      <h5><span class="sv-compare-way">상태 추적</span>보조모델이 고른 사람이 실제로 연락할 확률</h5>
      ${table(
        "상태 추적 확률",
        ["그 인물의 선연락 빈도", "가벼운 일", "보통", "급한 일"],
        RATES.map(([rate, name]) => [
          `${name} (${rate}%)`,
          percent(stateChance(rate, "low")),
          percent(stateChance(rate, "medium")),
          percent(stateChance(rate, "high")),
        ]),
      )}
      <p class="sv-compare-note">고르지 않은 사람은 연락하지 않습니다. 인물이 바쁘면 절반으로 줄고, 자는 중이면 연락하지 않습니다.</p>
      <h5><span class="sv-compare-way">랜덤</span>한 인물이 평균 답변 몇 개마다 한 번 연락하나</h5>
      ${table(
        "랜덤 빈도",
        ["그 인물의 선연락 빈도", "공통 빈도 드물게", "보통", "자주"],
        RATES.map(([rate, name]) => [
          `${name} (${rate}%)`,
          every("low", rate),
          every("normal", rate),
          every("high", rate),
        ]),
      )}
      <p class="sv-compare-note">답변마다 굴리는 확률은 공통 연락 빈도(드물게 ${percent(RANDOM_OUTREACH_BASE.low)} · 보통 ${percent(RANDOM_OUTREACH_BASE.normal)} · 자주 ${percent(RANDOM_OUTREACH_BASE.high)})에 인물별 빈도를 곱한 값입니다. 인물이 여럿이면 그만큼 자주 옵니다.</p>
      <h5><span class="sv-compare-way">시간</span>차례가 왔을 때 누가 뽑히나 (예: 세 명)</h5>
      ${table(
        "시간 방식에서 뽑히는 비율",
        ["인물", "선연락 빈도", "뽑힐 비율"],
        [
          ["A", "매우 자주 (90%)", share(90)],
          ["B", "보통 (50%)", share(50)],
          ["C", "거의 안 함 (10%)", share(10)],
        ],
      )}
      <p class="sv-compare-note">차례는 정해 둔 ‘연락 간격’(기본 30~120분) 사이에서 무작위로 오고, 나에게 오는 연락은 봇카드마다 ‘하루 최대’까지만 옵니다. 열려 있지 않은 봇카드에서는 문자만 옵니다. 차례 한 번에는 한 가지만 일어납니다(나에게 오는 연락은 두 명까지).</p>
    </section>
    <section>
      <h4>어떤 걸 고를까</h4>
      <ul class="sv-compare-pick">
        <li><b>이야기에 맞는 순간에 오는 것</b>: 상태 추적이 가장 정확하고, 그 순간의 확률도 가장 높습니다.</li>
        <li><b>조용할 때도 가끔 오는 것</b>: 랜덤이 낫습니다. ‘상황에 맞을 때만 연락’을 켜 두면 어색한 연락은 걸러 줍니다.</li>
        <li><b>서사와 상관없이 오는 것</b>: 시간 방식. 차례가 오면 거의 항상 보내고, 연락하는 이유는 AI가 가볍게 만듭니다.</li>
        <li>랜덤과 시간에서 ‘상황에 맞을 때만 연락’을 끄면, 같이 있거나 자는 중에도 연락이 옵니다.</li>
      </ul>
    </section>`;
}

export const outreachCompare = {
  openOutreachCompare() {
    if (document.getElementById("sv-compare-dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "sv-compare-dialog";
    dialog.className = "sv-dialog";
    dialog.innerHTML = `<form method="dialog">
      <header class="sv-dialog-head">
        <span class="sv-dialog-icon" aria-hidden="true"><i class="fa-solid fa-scale-balanced"></i></span>
        <div><h3>연락 방식 비교</h3><small>세 방식이 언제, 어떻게 연락하는지</small></div>
      </header>
      <div class="sv-compare">${outreachCompareHtml()}</div>
      <footer class="sv-dialog-actions"><button type="submit" class="sv-btn sv-btn-primary" value="ok" autofocus>확인</button></footer>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  },
};
