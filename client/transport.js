// Runs the service in the page and gives it the 실리태번 endpoints it needs (files,
// ElevenLabs, the CORS proxy for Fish).
import { API, SceneService } from "../shared/service.js";
import { STFileStore } from "./st-store.js";
import { UserError } from "../shared/settings.js";
import { throwIfAborted } from "../shared/queue.js";

/** The ElevenLabs key an older 실리태번 (before 1.15) keeps in its TTS settings, in the page. */
const legacyElevenLabsKey = () =>
  window.SillyTavern?.getContext?.()?.extensionSettings?.tts?.ElevenLabs?.apiKey || "";
// `Response.json(value)`, which Safari before 17 lacks.
const jsonResponse = (value, init = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
export class Transport {
  mode = "st";
  constructor(getHeaders) {
    this.getHeaders = getHeaders;
  }
  /**
   * ElevenLabs (`kind`: "voices" or "synthesize"). 실리태번 1.15 and later send it from their server
   * with the key kept there; an older one is asked nothing: the page calls ElevenLabs itself with
   * the key in its TTS settings, as that 실리태번 did.
   */
  elevenLabs(kind, { voiceId = "", body = null, signal } = {}, timeout = 180000) {
    if (this.elevenLabsServer)
      return this.network(
        `/api/speech/elevenlabs/${kind}`,
        {
          method: "POST",
          ...(kind === "synthesize" ? { body: JSON.stringify({ voiceId, request: body }) } : {}),
          signal,
        },
        timeout,
      );
    const key = legacyElevenLabsKey();
    if (!key) return Promise.resolve(new Response("", { status: 401 }));
    const headers = { "xi-api-key": key };
    return kind === "synthesize"
      ? this.network(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
          { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), signal },
          timeout,
          true,
        )
      : this.network("https://api.elevenlabs.io/v1/voices", { headers, signal }, timeout, true);
  }
  /** `external`: another site, sent nothing of 실리태번's (no cookies, no request headers). */
  async network(url, options = {}, timeout = 180000, external = false) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("요청 시간이 초과되었습니다.", "TimeoutError"),
        ),
      timeout,
    );
    try {
      throwIfAborted(options.signal);
      return await fetch(
        url,
        external
          ? { ...options, signal: controller.signal }
          : {
              ...options,
              credentials: "same-origin",
              headers: { ...this.getHeaders(), ...options.headers },
              signal: controller.signal,
            },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  async init() {
    const account = await this.network("/api/users/me", {}, 10000);
    if (!account.ok) throw new Error("실리태번 사용자 계정을 확인할 수 없습니다.");
    const { handle } = await account.json();
    if (!handle) throw new Error("실리태번 계정 식별자가 없습니다.");
    const secrets = await import("/scripts/secrets.js");
    // 1.15 and later know the ElevenLabs key as a secret (and send it from the server).
    this.elevenLabsServer = Boolean(secrets.SECRET_KEYS?.ELEVENLABS);
    const store = new STFileStore(
      `scenevoice-v1-${handle}`,
      this.network.bind(this),
    );
    await store.storageReady;
    this.local = new SceneService(store, {
      mode: "st",
      engines: ["fish", "elevenlabs"],
      storageLabel:
        "실리태번 사용자 폴더의 user/files/scenevoice_* · 같은 계정에서 목록·설정 공유",
      enrichSettings: async (settings) => {
        settings.fish.has_api_key = Boolean(
          (await store.local.read()).settings.fish.api_key,
        );
        settings.elevenlabs.has_api_key = this.elevenLabsServer
          ? Boolean(secrets.secret_state[secrets.SECRET_KEYS.ELEVENLABS])
          : Boolean(legacyElevenLabsKey());
      },
      prepareSettings: async (patch) => {
        if (patch.elevenlabs?.api_key || patch.elevenlabs?.clear_api_key)
          throw new UserError(
            "ElevenLabs 키는 실리태번 기본 TTS 설정에서 관리해 주십시오.",
          );
        return patch;
      },
      synthesize: async (request, settings, signal) => {
        let response;
        if (request.engine === "fish") {
          if (!settings.fish.api_key)
            throw new UserError(
              "이 브라우저에서 Fish API 키를 먼저 저장해 주십시오.",
            );
          response = await this.network(
            "/proxy/https://api.fish.audio/v1/tts",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${settings.fish.api_key}`,
                model: request.model,
              },
              body: JSON.stringify(request.body),
              signal,
            },
          );
          if (response.status === 404 || response.status === 400) {
            const message = await response.clone().text();
            if (message.includes("CORS proxy is disabled"))
              throw new UserError(
                "실리태번 config.yaml의 enableCorsProxy를 true로 설정한 뒤 실리태번을 다시 켜 주십시오.",
              );
          }
        } else
          response = await this.elevenLabs("synthesize", {
            voiceId: request.voice,
            body: request.body,
            signal,
          });
        if (!response.ok) {
          const hints = {
            401: "API 키",
            402: "잔액",
            403: "키·모델 접근 권한",
            404: "목소리 ID·모델",
            429: "요청 한도",
          };
          throw new UserError(
            `${request.engine} 생성 실패 (${response.status}). ${hints[response.status] || "연결·설정"}을 확인해 주십시오. 자동 재시도하지 않습니다.`,
            502,
          );
        }
        if (
          !/audio|octet-stream/i.test(
            response.headers.get("Content-Type") || "",
          )
        )
          throw new UserError("서비스가 오디오를 반환하지 않았습니다.", 502);
        return new Uint8Array(await response.arrayBuffer());
      },
      // Free calls only: key → voice list (ElevenLabs) or API credit (Fish), then the default voice.
      checkEngine: async (engine, settings, signal) => {
        if (engine === "fish") {
          if (!settings.fish.api_key)
            return { ok: false, message: "이 브라우저에 Fish API 키가 없습니다." };
          const fish = (path) =>
            this.network(
              `/proxy/https://api.fish.audio${path}`,
              {
                headers: { Authorization: `Bearer ${settings.fish.api_key}` },
                signal,
              },
              20000,
            );
          const wallet = await fish("/wallet/self/api-credit");
          if (!wallet.ok) {
            const text = await wallet.text();
            if (text.includes("CORS proxy is disabled"))
              return {
                ok: false,
                message:
                  "실리태번 중계 기능이 꺼져 있습니다. config.yaml의 enableCorsProxy를 true로 바꾸고 실리태번을 다시 켜 주십시오.",
              };
            return {
              ok: false,
              message: [401, 403].includes(wallet.status)
                ? "Fish API 키가 올바르지 않습니다."
                : `Fish 응답 ${wallet.status}. 잠시 뒤 다시 확인해 주십시오.`,
            };
          }
          const credit = Number((await wallet.json().catch(() => ({}))).credit);
          const result = {
            ok: true,
            message: Number.isFinite(credit)
              ? `키 확인됨 · API 잔액 ${credit.toFixed(2)}`
              : "키 확인됨",
          };
          const id = settings.fish.reference_id;
          if (id) {
            const model = await fish(`/model/${encodeURIComponent(id)}`);
            if (model.ok)
              result.voice = `기본 보이스: ${(await model.json().catch(() => ({}))).title || id}`;
            else if ([400, 404].includes(model.status)) {
              result.ok = false;
              result.voice = "기본 Reference ID를 찾을 수 없습니다.";
            }
          } else result.voice = "기본 Reference ID가 비어 있습니다.";
          return result;
        }
        const response = await this.elevenLabs("voices", { signal }, 20000);
        if (!response.ok)
          return {
            ok: false,
            message: "실리태번 기본 TTS의 ElevenLabs 키를 확인해 주십시오.",
          };
        const voices = (await response.json().catch(() => ({}))).voices || [];
        // The male and female defaults, each checked against the account's voices.
        const named = [
          ["남성", settings.elevenlabs.voice_id_male],
          ["여성", settings.elevenlabs.voice_id_female || settings.elevenlabs.voice_id],
        ]
          .filter(([, id]) => id)
          .map(([label, id]) => `${label} 기본: ${voices.find((voice) => voice.voice_id === id)?.name || "내 보이스 목록에 없음"}`);
        return {
          ok: true,
          message: `키 확인됨 · 내 보이스 ${voices.length}개`,
          voice: named.length
            ? `${named.join(" · ")}${named.some((line) => line.endsWith("없음")) ? " (라이브러리 보이스라면 내 보이스에 추가했는지 확인해 주십시오)" : ""}`
            : "기본 목소리가 비어 있습니다.",
        };
      },
      voices: async (engine, settings, signal) => {
        if (engine !== "elevenlabs") return { items: [] };
        const response = await this.elevenLabs("voices", { signal });
        if (!response.ok)
          throw new UserError("실리태번 기본 TTS의 ElevenLabs 키를 확인해 주십시오.");
        return {
          items: ((await response.json()).voices || []).map((v) => ({
            id: v.voice_id,
            name: v.name,
            // A short description for the picker: gender, accent, age, and whether it is a clone.
            meta: [
              { female: "여성", male: "남성", neutral: "중성" }[v.labels?.gender] || "",
              v.labels?.accent,
              v.labels?.age,
              v.category === "cloned" ? "내 복제 목소리" : "",
            ]
              .filter((part) => typeof part === "string" && part.trim())
              .map((part) => part.trim().slice(0, 40))
              .join(" · "),
          })),
        };
      },
    });
  }
  /** The service's audio links become the address 실리태번 serves each file at. */
  audioURLs(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((x) => this.audioURLs(x));
    const result = { ...value };
    for (const [key, item] of Object.entries(result)) {
      if (key === "audio_url" && typeof item === "string" && item)
        result[key] = this.local.store.audioURL(item.split("/").at(-1));
      else if (item && typeof item === "object") result[key] = this.audioURLs(item);
    }
    return result;
  }
  async request(url, options = {}) {
    const parsed = new URL(url, location.href),
      route = parsed.pathname.slice(API.length),
      body = options.body ? JSON.parse(options.body) : {};
    if (route === "/state" && options.method === "DELETE")
      body.state_key ||= parsed.searchParams.get("state_key");
    try {
      const result = await this.local.handle(
        options.method || "GET",
        route,
        Object.fromEntries(parsed.searchParams),
        body,
        options.signal,
      );
      if (result.bytes)
        return new Response(result.bytes, { headers: result.headers });
      return jsonResponse(this.audioURLs(result.json));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return jsonResponse({ detail: error.message }, { status: error.status || 500 });
    }
  }
  dispose() {
    void this.local?.store.close();
  }
}
