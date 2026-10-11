// 실리태번 연결 프로필: helper-model requests go through the connection profile the user picked.
import { contentKey } from "../shared/hash.js";
// Prompts are instruction lines, tagged rule sections and tagged data blocks (see prompts.js),
// in system and user messages alike. Only these data blocks are shortened: the story and the
// conversation, past calls, saved states and the like. Everything else stays whole: the
// instructions and rules, the target lines and speaker list, and the settings the user put in
// (character profile, world info, performance notes, people's records).
const TRIMMED_BLOCK =
  /^<(recent_chat|call_transcript|text_thread|previous_calls|recent_calls|state|current_time|call_situation|reason_to_call|reason_to_send|user_draft|current_message)[\s>]/;
const isRequiredSection = (section) => !TRIMMED_BLOCK.test(section);
// Conversations lose their oldest messages: the chat so far, a call, a text thread.
const NEWEST_KEPT = /^<(recent_chat|call_transcript|text_thread)[\s>]/;
/**
 * Shortens one section, keeping a data block's tags so the block stays well formed. A
 * conversation keeps its newest messages, starting at a whole one; other material keeps its
 * beginning.
 */
const truncateSection = (section, allowance) => {
  const closing = section.match(/\n<\/[\w-]+>$/)?.[0] || "";
  if (NEWEST_KEPT.test(section)) {
    const opening = section.match(/^<[^>\n]*>\n?/)[0];
    const body = section.slice(opening.length, section.length - closing.length);
    const marker = "[older messages truncated]\n";
    const cut =
      body.length - Math.max(0, allowance - opening.length - closing.length - marker.length - 1);
    let tail;
    if (body.startsWith("[")) {
      // A JSON list (see dataBlock): its items start on lines indented by two.
      const start = body.indexOf("\n  {", cut);
      tail = start < 0 ? "[]" : `[${body.slice(start)}`;
    } else {
      const start = body.indexOf("\n", Math.max(0, cut - 1));
      tail = start < 0 ? "" : body.slice(start + 1);
    }
    return `${opening}${marker}${tail}${closing}`;
  }
  return (
    section.slice(0, Math.max(0, allowance - 24 - closing.length)) +
    "\n[reference truncated]" +
    closing
  );
};
/** Characters that are never shortened: everything but the data blocks that may be. */
export function requiredPromptSize(messages) {
  return messages
    .flatMap((message) => String(message.content).split("\n\n"))
    .filter(isRequiredSection)
    .reduce((total, section) => total + section.length, 0);
}
/**
 * Fits the messages into `budget` characters. Required sections stay whole, and so do small
 * data blocks; the room left is shared evenly by the big ones, whichever message holds them.
 */
export function limitPrompt(messages, budget) {
  const split = messages.map((message) => String(message.content).split("\n\n"));
  const sections = split.flat();
  const requiredSize = sections
    .filter(isRequiredSection)
    .reduce((total, section) => total + section.length, 0);
  if (requiredSize > budget)
    throw new Error("지시문·캐릭터 설정·분석할 대사만으로 요청 한도를 넘었습니다.");
  // Small sections stay whole; the room they leave goes to the big ones, shared evenly.
  const others = sections.filter((section) => !isRequiredSection(section));
  let allowance = Infinity;
  let left = budget - requiredSize;
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
  return messages.map((message, index) => ({
    ...message,
    content: split[index]
      .map((section) =>
        isRequiredSection(section) || section.length <= allowance
          ? section
          : truncateSection(section, allowance),
      )
      .join("\n\n"),
  }));
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
        // shortened (see limitPrompt), keeping instructions, settings and target lines intact.
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
