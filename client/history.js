// 기록·보관함 tabs: generated voices with filters, favourites, and cache cleanup.
import { escapeHtml, normalizeTags, LANGUAGE_CHOICES } from "./common.js";
import { infoTip, emptyHtml } from "./ui.js";

const LANGUAGE_NAMES = Object.fromEntries(LANGUAGE_CHOICES);

export const history = {
  historySpeakerTools(container, items, favorite = false) {
    const field = favorite ? "favoriteSpeakerFilter" : "historySpeakerFilter";
    const names = new Map(
      items.map((item) => [
        item.speaker_key || "",
        item.speaker_name || "기본 화자",
      ]),
    );
    const select = document.createElement("select");
    select.className = "sv-history-speaker";
    select.setAttribute("aria-label", "기록 화자별 보기");
    select.append(
      new Option("모든 화자", "__all__"),
      ...[...names].map(([key, name]) => new Option(name, key)),
    );
    select.value = names.has(this[field]) ? this[field] : "__all__";
    const apply = () => {
      this[field] = select.value;
      container.querySelectorAll(".sv-history-item").forEach((row) => {
        row.hidden =
          select.value !== "__all__" && row.dataset.speaker !== select.value;
      });
    };
    select.addEventListener("change", apply);
    const toolbar = container.querySelector(".sv-list-toolbar");
    if (toolbar) toolbar.prepend(select);
    else container.prepend(select);
    apply();
  },
  historyItemHtml(item, { favorite = false } = {}) {
    const thought = item.utterance_kind === "thought";
    const tags = normalizeTags(item);
    const meta = [
      tags.map((tag) => `[${tag}]`).join(""),
      LANGUAGE_NAMES[item.language] || item.language || "",
      item.engine === "elevenlabs" ? "ElevenLabs" : item.engine === "fish" ? "Fish" : item.engine || "",
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join(" · ");
    const audio = item.audio_url
      ? `<button type="button" class="sv-btn sv-btn-sm sv-history-play" data-url="${escapeHtml(item.audio_url)}"><i class="fa-solid fa-play" aria-hidden="true"></i><span>재생</span></button>
         <a class="sv-btn sv-btn-sm" href="${escapeHtml(this.apiUrl(item.audio_url))}" download${favorite ? `="${escapeHtml(item.download_name || "")}"` : ""}><i class="fa-solid fa-download" aria-hidden="true"></i><span>${favorite ? "파일 저장" : "저장"}</span></a>
         ${favorite ? "" : `<button type="button" class="sv-btn sv-btn-sm sv-history-favorite ${item.favorite_id ? "sv-is-kept" : ""}" data-id="${escapeHtml(item.id)}" ${item.favorite_id ? "disabled" : ""}><i class="fa-${item.favorite_id ? "solid" : "regular"} fa-star" aria-hidden="true"></i><span>${item.favorite_id ? "보관됨" : "영구 보관"}</span></button>`}`
      : `<span class="sv-no-audio"><i class="fa-solid fa-file-circle-xmark" aria-hidden="true"></i>${favorite ? "음성 파일 없음 · 기록만 보관" : "음성 파일 없음 · 대사 기록만 남아 있습니다"}</span>`;
    const remove = favorite
      ? `<button type="button" class="sv-btn sv-btn-sm sv-btn-ghost-danger sv-favorite-delete" data-id="${escapeHtml(item.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>보관함에서 삭제</span></button>`
      : `<button type="button" class="sv-btn sv-btn-sm sv-btn-ghost-danger sv-history-delete" data-id="${escapeHtml(item.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>삭제</span></button>`;
    return `<article class="sv-history-item" data-speaker="${escapeHtml(item.speaker_key || "")}">
        <header class="sv-history-meta">
          <strong class="sv-history-speaker-name">${escapeHtml(item.speaker_name || "기본 화자")}</strong>
          <span class="sv-badge ${thought ? "sv-badge-thought" : "sv-badge-dialogue"}">${thought ? "생각" : "대사"}</span>
          ${item.mode === "phone" ? '<span class="sv-badge sv-badge-phone"><i class="fa-solid fa-phone" aria-hidden="true"></i>전화</span>' : item.mode === "voice_message" ? '<span class="sv-badge sv-badge-phone"><i class="fa-solid fa-comment" aria-hidden="true"></i>문자</span>' : ""}
          <span class="sv-history-tags">${meta}</span>
          <time>${escapeHtml(this.formatDate(item.created_at))}</time>
        </header>
        <p class="sv-history-text">${escapeHtml(item.text)}</p>
        ${item.applied_control ? `<p class="sv-applied"><b>실제 적용</b><span>${escapeHtml(item.applied_control)}</span></p>` : ""}
        <div class="sv-history-actions">${audio}<span class="sv-spacer"></span>${remove}</div>
      </article>`;
  },

  async renderHistory() {
    const container = document.getElementById("sv-history-tab");
    if (!container) return;
    const token = (this.historyRenderToken =
      (this.historyRenderToken || 0) + 1);
    const filters = (this.historyFilters ||= {
      q: "",
      speaker_key: "",
      mode: "",
      from: "",
      to: "",
      offset: 0,
    });
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/history?${new URLSearchParams({ ...filters, limit: 50 })}`,
        ),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (token !== this.historyRenderToken || !container.isConnected) return;
      filters.offset = data.offset || 0;
      container.innerHTML = `<div class="sv-history-list">${data.items
        .map((item) => this.historyItemHtml(item))
        .join("")}</div>`;
      if (!data.items.length)
        container.innerHTML = emptyHtml(
          "magnifying-glass",
          "조건에 맞는 음성 기록이 없습니다",
          "검색어나 기간을 바꾸거나 초기화해 보세요.",
        );
      this.renderHistoryFilters(container, data);
    } catch (error) {
      if (token !== this.historyRenderToken) return;
      container.innerHTML = emptyHtml(
        "triangle-exclamation",
        "기록을 불러오지 못했습니다",
        error.message,
      );
    }
  },

  renderHistoryFilters(container, data) {
    const filters = this.historyFilters;
    const form = document.createElement("form");
    form.className = "sv-history-filters";
    form.innerHTML = `<div class="sv-filter-main">
        <label class="sv-search-box"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input name="q" type="search" maxlength="300" placeholder="대사·이름·태그 검색" aria-label="대사·이름·태그 검색"></label>
        <select name="speaker_key" class="sv-history-speaker" aria-label="화자"></select>
        <select name="mode" class="sv-history-mode" aria-label="종류">
          <option value="">모든 음성</option>
          <option value="dialogue">채팅 대사</option>
          <option value="phone">전화</option>
          <option value="voice_message">문자·음성 메시지</option>
        </select>
      </div>
      <div class="sv-filter-sub">
        <label class="sv-date-field"><span>시작일</span><input name="from" type="date"></label>
        <span class="sv-date-sep" aria-hidden="true">~</span>
        <label class="sv-date-field"><span>종료일</span><input name="to" type="date"></label>
        ${infoTip("전체 생성 기록에서 대사·화자 이름·연기 태그를 찾습니다. 날짜는 UTC 기준이며, 결과는 50개씩 보여 줍니다.", "기록 검색 설명")}
        <span class="sv-spacer"></span>
        <button type="button" class="sv-btn sv-search-reset" title="검색어·화자·날짜 조건을 비웁니다. 기록은 지우지 않습니다." ${filters.q || filters.speaker_key || filters.mode || filters.from || filters.to ? "" : "disabled"}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>검색 초기화</span></button>
        <button type="submit" class="sv-btn sv-btn-accent"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>검색</span></button>
      </div>`;
    form.elements.speaker_key.append(
      new Option("모든 화자", ""),
      ...(data.speakers || []).map((x) => new Option(x.name, x.key)),
    );
    for (const name of ["q", "speaker_key", "mode", "from", "to"])
      form.elements[name].value = filters[name] || "";
    const search = () => {
      this.historyFilters = {
        ...Object.fromEntries(new FormData(form)),
        offset: 0,
      };
      this.run(() => this.renderHistory());
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      search();
    });
    form.elements.speaker_key.addEventListener("change", search);
    form.elements.mode.addEventListener("change", search);
    form.querySelector(".sv-search-reset").onclick = () => {
      this.historyFilters = null;
      this.run(() => this.renderHistory());
    };
    container.prepend(form);
    const pages = document.createElement("div");
    pages.className = "sv-history-pages";
    const page = Math.floor(data.offset / data.limit) + 1;
    pages.innerHTML = `<button type="button" class="sv-btn sv-btn-sm sv-history-prev" ${data.offset ? "" : "disabled"}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>이전</span></button><span>총 ${data.total}개 · ${page}/${Math.max(1, Math.ceil(data.total / data.limit))}쪽</span><button type="button" class="sv-btn sv-btn-sm sv-history-next" ${data.offset + data.limit >= data.total ? "disabled" : ""}><span>다음</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`;
    for (const [selector, step] of [
      [".sv-history-prev", -1],
      [".sv-history-next", 1],
    ])
      pages.querySelector(selector).onclick = () => {
        filters.offset = Math.max(0, data.offset + step * data.limit);
        this.run(() => this.renderHistory());
      };
    container.append(pages);
  },

  async deleteHistory(historyId) {
    if (!historyId) return;
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/history/${encodeURIComponent(historyId)}`,
        ),
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`삭제 실패 (${response.status})`);
      this.stopPlayback();
      this.lineStatePromise = null;
      this.invalidateGeneratedButtons();
      await this.renderHistory();
    } catch (error) {
      this.notify(error.message || "기록을 삭제할 수 없습니다.", "error");
    }
  },

  async addFavorite(historyId) {
    if (!historyId) return;
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/favorites/${encodeURIComponent(historyId)}`,
        ),
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || `보관 실패 (${response.status})`);
      this.notify("음성을 영구 보관함에 저장했습니다.", "success");
      await this.renderHistory();
    } catch (error) {
      this.notify(error.message || "음성을 보관할 수 없습니다.", "error");
    }
  },

  async renderFavorites() {
    const container = document.getElementById("sv-favorites-tab");
    if (!container) return;
    container.innerHTML = '<div class="sv-loading-line">보관함을 불러오는 중…</div>';
    try {
      const response = await this.fetch(
        this.apiUrl("/api/plugins/scenevoice/favorites?limit=1000"),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.favoritesPath = data.path || this.favoritesPath;
      const toolbar = `<div class="sv-list-toolbar">
          <span class="sv-hint">영구 보관한 음성</span>
          ${infoTip("보관함 음성은 별도 사본으로 저장되어, 오래된 음성을 자동으로 지울 때도 남습니다. 전체 기록에서 ‘영구 보관’을 눌러 추가합니다. 저장 위치는 설정 → 저장 공간에 있습니다.", "보관함 설명")}
        </div>`;
      if (!data.items?.length) {
        container.innerHTML = `${toolbar}${emptyHtml("star", "아직 영구 보관한 음성이 없습니다", "기록 탭에서 마음에 드는 음성의 ‘영구 보관’을 눌러 보세요.")}`;
        return;
      }
      container.innerHTML = `${toolbar}<div class="sv-history-list">${data.items
        .map((item) => this.historyItemHtml(item, { favorite: true }))
        .join("")}</div>`;
      this.historySpeakerTools(container, data.items, true);
    } catch (error) {
      container.innerHTML = emptyHtml(
        "triangle-exclamation",
        "보관함을 불러오지 못했습니다",
        error.message,
      );
    }
  },

  async deleteFavorite(favoriteId) {
    if (!favoriteId || !confirm("영구 보관한 음성과 메타데이터를 삭제할까요?"))
      return;
    try {
      const response = await this.fetch(
        this.apiUrl(
          `/api/plugins/scenevoice/favorites/${encodeURIComponent(favoriteId)}`,
        ),
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`삭제 실패 (${response.status})`);
      await this.renderFavorites();
    } catch (error) {
      this.notify(error.message || "보관 음성을 삭제할 수 없습니다.", "error");
    }
  },

  /** After the limits were lowered: what is over them goes now, quietly unless anything went. */
  async pruneToLimits() {
    const response = await this.request("/api/plugins/scenevoice/cache/cleanup", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `정리 실패 (${response.status})`);
    if (!data.removed) return;
    this.lineStatePromise = null;
    this.invalidateGeneratedButtons();
    this.notify(`바뀐 기준에 맞춰 오래된 음성 ${data.removed}개를 지웠습니다.`, "info");
    this.renderStorageMeter?.().catch(() => undefined);
  },

  async cleanupCache(clearAll) {
    if (
      clearAll &&
      !confirm("즐겨찾기를 제외한 생성 기록과 캐시 오디오를 모두 삭제할까요?")
    )
      return;
    try {
      const response = await this.fetch(
        this.apiUrl(
          "/api/plugins/scenevoice/cache" + (clearAll ? "" : "/cleanup"),
        ),
        {
          method: clearAll ? "DELETE" : "POST",
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || `정리 실패 (${response.status})`);
      this.stopPlayback();
      this.lineStatePromise = null;
      this.invalidateGeneratedButtons();
      const status = document.getElementById("sv-cache-status");
      if (status)
        status.textContent = `${data.removed || 0}개 정리 · 현재 ${data.file_count || 0}개 / ${data.size_mb || 0}MB`;
      this.notify("캐시 정리를 마쳤습니다.", "success");
      this.renderStorageMeter?.().catch(() => undefined);
    } catch (error) {
      this.notify(error.message || "캐시를 정리할 수 없습니다.", "error");
    }
  },
};
