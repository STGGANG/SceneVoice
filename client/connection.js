// 실리태번 연결 프로필: helper-model requests go through the connection profile the user picked.
import { contentKey } from "../shared/hash.js";
// Prompts are untagged instruction lines and tagged data blocks (see prompts.js). Only data
// blocks are shortened, and never the target lines or the speaker list.
const isRequiredSection = (section) =>
  !section.startsWith("<") ||
  section.startsWith("<dialogues>") ||
  section.startsWith("<speakers>");
/**
 * Shortens one section, keeping a data block's tags so the block stays well formed. The chat
 * so far keeps its newest messages (its oldest go); other material keeps its beginning.
 */
const truncateSection = (section, allowance) => {
  const closing = section.match(/\n<\/[\w-]+>$/)?.[0] || "";
  if (/^<recent_chat[\s>]/.test(section)) {
    const opening = section.match(/^<[^>\n]*>\n?/)[0];
    const body = section.slice(opening.length, section.length - closing.length);
    const keep = Math.max(0, allowance - opening.length - closing.length - 32);
    return `${opening}[older messages truncated]\n${body.slice(body.length - keep)}${closing}`;
  }
  return (
    section.slice(0, Math.max(0, allowance - 24 - closing.length)) +
    "\n[reference truncated]" +
    closing
  );
};
/** Characters of the sections that are never shortened (instructions, target lines and the speaker list). */
export function requiredPromptSize(messages) {
  return messages
    .filter((message) => message.role !== "system")
    .flatMap((message) => String(message.content).split("\n\n"))
    .filter(isRequiredSection)
    .reduce((total, section) => total + section.length, 0);
}
export function limitPrompt(messages, budget) {
  let remaining = budget;
  return messages.map((message) => {
    if (message.role === "system") return message;
    const sections = String(message.content).split("\n\n");
    const required = sections.filter(isRequiredSection);
    const requiredSize = required.reduce((n, x) => n + x.length, 0);
    if (requiredSize > remaining)
      throw new Error(
        "분석할 대사·화자 목록이 요청 한도를 넘었습니다.",
      );
    remaining -= requiredSize;
    const others = sections.filter((x) => !required.includes(x));
    // Small sections stay whole; the room they leave goes to the big ones, shared evenly.
    let allowance = Infinity;
    let left = remaining;
    let count = others.length;
    for (const size of others.map((x) => x.length).sort((a, b) => a - b)) {
      const share = Math.floor(left / count);
      if (size > share) {
        allowance = Math.max(0, share);
        break;
      }
      left -= size;
      count -= 1;
    }
    const content = sections
      .map((section) =>
        required.includes(section) || section.length <= allowance
          ? section
          : truncateSection(section, allowance),
      )
      .join("\n\n");
    remaining = Math.max(0, remaining - content.length + requiredSize);
    return { ...message, content };
  });
}
/** The connection profile's completion preset (chat or text completion), if it can be read. */
function profilePreset(service, profileId) {
  try {
    const profile = service.getProfile?.(profileId) || {};
    if (!profile.preset) return null;
    const context = window.SillyTavern.getContext();
    const manager = context.getPresetManager?.(
      service.validateProfile?.(profile)?.selected || "openai",
    );
    return manager?.getCompletionPresetByName?.(profile.preset) || null;
  } catch {
    return null;
  }
}
/**
 * ST's connection request sends the Vertex region (the profile's URL field) but not the
 * auth mode or express project, so Vertex profiles are completed here; region falls back to
 * "global". Gemini sources are also asked for a JSON reply, since every task answers in JSON.
 */
function geminiOverrides(service, profileId) {
  try {
    const context = window.SillyTavern.getContext();
    const profile = service.getProfile?.(profileId) || {};
    const source = context.CONNECT_API_MAP?.[profile.api]?.source || profile.api;
    if (!["vertexai", "makersuite"].includes(source)) return {};
    if (source === "makersuite") return { responseMimeType: "application/json" };
    const preset = profilePreset(service, profileId) || {};
    const current = context.chatCompletionSettings || {};
    const value = (key) => profile[key] ?? preset[key] ?? current[key];
    return {
      vertexai_region: profile["api-url"] || value("vertexai_region") || "global",
      vertexai_auth_mode: value("vertexai_auth_mode") || "express",
      vertexai_express_project_id: value("vertexai_express_project_id") || "",
      responseMimeType: "application/json",
    };
  } catch {
    return {};
  }
}
const positive = (...values) =>
  values.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
async function countTokens(text) {
  try {
    const counter = window.SillyTavern?.getContext?.()?.getTokenCountAsync;
    if (typeof counter === "function") return await counter(text);
  } catch {
    /* fall back to an estimate */
  }
  return Math.ceil(text.length / 2);
}
export function createConnectionBridge(service, app) {
  return {
    getSupportedProfiles: () => {
      try {
        return service.getSupportedProfiles();
      } catch {
        return [];
      }
    },
    fingerprint(profileId) {
      if (!profileId) return "";
      try {
        const profile = service.getProfile?.(profileId) || {};
        const safe = { ...profile };
        delete safe["secret-id"];
        delete safe.password;
        delete safe.api_key;
        const context = window.SillyTavern.getContext();
        const manager = context.getPresetManager?.(
          service.validateProfile?.(profile)?.selected || "openai",
        );
        // Only look up presets the profile names: ST logs an error for every missing one.
        return contentKey({
          profile: safe,
          preset: profile.preset
            ? manager?.getCompletionPresetByName?.(profile.preset) || null
            : null,
          instruct: profile.instruct
            ? context
                .getPresetManager?.("instruct")
                ?.getCompletionPresetByName?.(profile.instruct) || null
            : null,
        });
      } catch {
        return contentKey({ profileId, missing: true });
      }
    },
    // Pass message arrays to ST once. ST formats Text Completion with the profile's instruct preset.
    constructPrompt: (messages) => messages,
    async sendRequest(
      profileId,
      messages,
      maxTokens,
      options = {},
      overrides = {},
    ) {
      const operation = app.captureChat();
      const controller = new AbortController();
      const abort = () => controller.abort(operation.signal.reason);
      operation.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException("분석 응답 시간 초과", "TimeoutError"),
          ),
        120000,
      );
      const payload = { ...geminiOverrides(service, profileId), ...overrides };
      if (app.config.llm?.task_temperature === false)
        delete payload.temperature;
      try {
        app.assertChat(operation);
        // 0 = the profile preset's values.
        const preset = profilePreset(service, profileId);
        // A number set in SceneVoice wins. A preset sized for chat replies must not cut a JSON
        // reply short, so the preset's value only raises the task's own size.
        const outputTokens =
          positive(app.config.llm?.max_output_tokens) ||
          Math.max(positive(preset?.openai_max_tokens, preset?.genamt) || 0, maxTokens);
        const contextTokens = positive(
          app.config.llm?.max_input_tokens,
          preset?.openai_max_context,
          preset?.max_length,
        );
        // Material is sent whole. Only a request that would not fit the context is
        // shortened, keeping the target lines and speaker list intact.
        let prompt = messages;
        if (contextTokens) {
          const budget = Math.max(1000, contextTokens - outputTokens);
          const text = messages.map((message) => message.content).join("\n\n");
          const tokens = await countTokens(text);
          if (tokens > budget)
            prompt = limitPrompt(
              messages,
              Math.max(
                Math.floor(text.length * (budget / tokens) * 0.95),
                requiredPromptSize(messages) + 1000,
              ),
            );
        }
        app.assertChat(operation);
        const response = await service.sendRequest(
          profileId,
          prompt,
          outputTokens,
          {
            ...options,
            stream: false,
            extractData: true,
            includePreset: app.config.llm?.include_preset !== false,
            includeInstruct: true,
            signal: controller.signal,
          },
          payload,
        );
        app.assertChat(operation);
        return response;
      } catch (error) {
        if (operation.signal.aborted) throw operation.signal.reason;
        if (controller.signal.aborted) throw controller.signal.reason;
        throw new Error(
          error.cause?.message || error.message || "실리태번 연결 프로필 요청 실패",
        );
      } finally {
        clearTimeout(timer);
        operation.signal.removeEventListener("abort", abort);
      }
    },
  };
}
