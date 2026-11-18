// 실리태번 연결 프로필: helper-model requests go through the connection profile the user picked.
import { contentKey } from "../shared/hash.js";
// Only these data blocks are ever shortened, in any message. Instructions, rules, settings
// (profile, world info, notes) and the lines to analyze always go whole.
const TRIMMED_BLOCK =
  /^<(recent_chat|call_transcript|text_thread|previous_calls|recent_calls|state|current_time|call_situation|reason_to_call|reason_to_send|user_draft|current_message|private_texts|other_chats)[\s>]/;
const isRequiredSection = (section) => !TRIMMED_BLOCK.test(section);
// Conversations lose their oldest messages: the chat so far, a call, a text thread.
const NEWEST_KEPT =
  /^<(recent_chat|call_transcript|text_thread|private_texts|other_chats)[\s>]/;
// What gives way first when a request is too big: other rooms and calls the people writing are
// in (0), then their own texts with the user (1); the conversation itself and the rest share
// what is left before either of those gets any (2).
const tierOf = (section) =>
  /^<other_chats[\s>]/.test(section)
    ? 0
    : /^<private_texts[\s>]/.test(section)
      ? 1
      : 2;
/** Keeps the block's tags; a conversation keeps its newest whole messages, other data its beginning. */
const truncateSection = (section, allowance) => {
  const closing = section.match(/\n<\/[\w-]+>$/)?.[0] || "";
  if (NEWEST_KEPT.test(section)) {
    const opening = section.match(/^<[^>\n]*>\n?/)[0];
    const body = section.slice(opening.length, section.length - closing.length);
    const marker = "[older messages truncated]\n";
    const cut =
      body.length -
      Math.max(
        0,
        allowance - opening.length - closing.length - marker.length - 1,
      );
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
export function requiredPromptSize(messages) {
  return messages
    .flatMap((message) => String(message.content).split("\n\n"))
    .filter(isRequiredSection)
    .reduce((total, section) => total + section.length, 0);
}
/**
 * The messages with the user's 추가 지침 at the very end: joined to the last message when the user
 * says it (blank lines inside go, so it stays one piece when a request is shortened), else as a
 * user message of its own.
 */
export function withExtraInstructions(messages, text) {
  const extra = String(text ?? "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  if (!extra || !Array.isArray(messages) || !messages.length) return messages;
  const last = messages.at(-1);
  return last.role === "user" && typeof last.content === "string"
    ? [
        ...messages.slice(0, -1),
        { ...last, content: `${last.content}\n\n${extra}` },
      ]
    : [...messages, { role: "user", content: extra }];
}
/** Fits the messages into `budget` characters; big data blocks share the room left evenly. */
export function limitPrompt(messages, budget) {
  const split = messages.map((message) =>
    String(message.content).split("\n\n"),
  );
  const sections = split.flat();
  const requiredSize = sections
    .filter(isRequiredSection)
    .reduce((total, section) => total + section.length, 0);
  if (requiredSize > budget)
    throw new Error(
      "지시문·캐릭터 설정·분석할 대사만으로 요청 한도를 넘었습니다.",
    );
  const others = sections.filter((section) => !isRequiredSection(section));
  // Each tier takes what the ones before it left; within a tier big blocks share evenly.
  const allowances = {};
  let left = budget - requiredSize;
  for (const tier of [2, 1, 0]) {
    const sizes = others
      .filter((section) => tierOf(section) === tier)
      .map((section) => section.length)
      .sort((a, b) => a - b);
    let allowance = Infinity;
    let room = left;
    let count = sizes.length;
    for (const size of sizes) {
      const share = Math.floor(room / count);
      if (size > share) {
        allowance = Math.max(0, share);
        break;
      }
      room -= size;
      count -= 1;
    }
    allowances[tier] = allowance;
    left = Math.max(
      0,
      left -
        sizes.reduce((total, size) => total + Math.min(size, allowance), 0),
    );
  }
  return messages.map((message, index) => ({
    ...message,
    content: split[index]
      .map((section) =>
        isRequiredSection(section) ||
        section.length <= allowances[tierOf(section)]
          ? section
          : truncateSection(section, allowances[tierOf(section)]),
      )
      .join("\n\n"),
  }));
}
/**
 * A connection profile by id. 실리태번 1.15 and later look it up themselves; before that it is read
 * from the profile list the Connection Manager keeps (as 1.12.14 did inside its own request).
 */
function findProfile(service, profileId) {
  try {
    return (
      service.getProfile?.(profileId) ||
      window.SillyTavern?.getContext?.()?.extensionSettings?.connectionManager?.profiles?.find(
        (profile) => profile.id === profileId,
      ) ||
      {}
    );
  } catch {
    return {};
  }
}
const TEXT_ONLY_KINDS = [
  "textgenerationwebui",
  "novel",
  "kobold",
  "koboldhorde",
];
/** Chat Completion ("openai"), Text Completion ("textgenerationwebui") or another kind. */
function connectionKind(service, profileId) {
  try {
    const context = window.SillyTavern.getContext();
    if (profileId === CURRENT_CONNECTION) return context.mainApi || "";
    const profile = findProfile(service, profileId);
    return (
      context.CONNECT_API_MAP?.[profile.api]?.selected ||
      service.validateProfile?.(profile)?.selected ||
      ""
    );
  } catch {
    return "";
  }
}
/**
 * The connection profile's completion preset (chat or text completion), if it can be read. For
 * the current connection, 실리태번's own settings stand in for it (they hold the same values).
 */
function profilePreset(service, profileId) {
  try {
    if (profileId === CURRENT_CONNECTION) {
      const context = window.SillyTavern.getContext();
      return context.mainApi === "openai"
        ? context.chatCompletionSettings || null
        : { max_length: context.maxContext };
    }
    const profile = findProfile(service, profileId);
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
    // The current connection carries its own Vertex settings: only the JSON reply is asked for.
    if (profileId === CURRENT_CONNECTION)
      return context.mainApi === "openai" &&
        ["vertexai", "makersuite"].includes(
          context.chatCompletionSettings?.chat_completion_source,
        )
        ? { responseMimeType: "application/json" }
        : {};
    const profile = findProfile(service, profileId);
    const source =
      context.CONNECT_API_MAP?.[profile.api]?.source || profile.api;
    if (!["vertexai", "makersuite"].includes(source)) return {};
    if (source === "makersuite")
      return { responseMimeType: "application/json" };
    const preset = profilePreset(service, profileId) || {};
    const current = context.chatCompletionSettings || {};
    const value = (key) => profile[key] ?? preset[key] ?? current[key];
    return {
      vertexai_region:
        profile["api-url"] || value("vertexai_region") || "global",
      vertexai_auth_mode: value("vertexai_auth_mode") || "express",
      vertexai_express_project_id: value("vertexai_express_project_id") || "",
      responseMimeType: "application/json",
    };
  } catch {
    return {};
  }
}
// A helper-model reply may take long (a thinking model, a long message): it is waited for up to
// this long. Only a connection that hangs reaches it; the user can stop sooner (a message's 정지).
const HELPER_TIMEOUT_MS = 10 * 60 * 1000;
/** The 연결 choice that sends through whatever 실리태번 is connected to now (its API and model). */
export const CURRENT_CONNECTION = "__current__";
// Chat Completion settings made for chat replies that cut or break a task's JSON reply: the
// user's stop strings, web search or pictures, names put before messages. A prefill stays (it
// often keeps a model from refusing; the JSON is found after it).
const CHAT_ONLY_OFF = {
  stop: [],
  enable_web_search: false,
  request_images: false,
  user_name: "",
  char_name: "",
  group_names: [],
};
// 실리태번's word for a Gemini reply with no text in it (all thinking, or held back by a filter).
const EMPTY_REPLY = /candidate text empty/i;
const replyText = (value) =>
  typeof value === "string" ? value : value?.content;
const isEmptyReply = (value) => !String(replyText(value) ?? "").trim();
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
/**
 * 현재 연결 사용: the request built from 실리태번's current connection settings (as its own chat
 * would send, minus the chat-only settings), then sent. 실리태번 1.15 and later; before that the
 * request builder dropped the messages, so a profile has to be picked.
 */
async function sendCurrent(messages, maxTokens, payload, signal) {
  const context = window.SillyTavern.getContext();
  const later =
    "‘현재 연결 사용’은 실리태번 1.15 이상에서 됩니다. 연결 프로필을 골라 주십시오.";
  if (context.mainApi === "openai") {
    const service = context.ChatCompletionService;
    if (typeof service?.presetToGeneratePayload !== "function")
      throw new Error(later);
    const settings = context.chatCompletionSettings || {};
    const base = {
      messages: structuredClone(messages),
      chat_completion_source: settings.chat_completion_source,
      stream: false,
      max_tokens: maxTokens,
    };
    const model = context.getChatCompletionModel?.(settings);
    if (model) base.model = model;
    const request = await service.presetToGeneratePayload({}, {}, base);
    if (!Array.isArray(request?.messages)) throw new Error(later);
    return service.sendRequest(
      { ...request, ...payload, stream: false },
      true,
      signal,
    );
  }
  if (context.mainApi === "textgenerationwebui") {
    const service = context.TextCompletionService;
    if (typeof service?.presetToGeneratePayload !== "function")
      throw new Error(later);
    const settings = context.textCompletionSettings || {};
    const instruct = context.powerUserSettings?.instruct;
    const formatted =
      Boolean(instruct?.enabled) &&
      typeof service.constructPrompt === "function";
    const prompt = formatted
      ? service.constructPrompt(structuredClone(messages), instruct)
      : `${messages.map((message) => message.content).join("\n\n")}\n\n`;
    const base = {
      prompt,
      stream: false,
      max_tokens: maxTokens,
      api_type: settings.type,
    };
    const server = context.getTextGenServer?.(settings.type);
    if (server) base.api_server = server;
    const request = await service.presetToGeneratePayload({}, {}, base);
    if (request?.prompt == null) throw new Error(later);
    // Only the instruct template's own end marks stop it (chat stop strings would cut the JSON).
    let stops = [];
    if (formatted)
      try {
        const instructMode = await import("/scripts/instruct-mode.js");
        stops =
          instructMode.getInstructStoppingSequences?.({
            customInstruct: instruct,
            useStopStrings: false,
          }) || [];
      } catch {
        /* no stops then */
      }
    return service.sendRequest(
      {
        ...request,
        ...payload,
        stream: false,
        stop: stops,
        stopping_strings: stops,
      },
      true,
      signal,
    );
  }
  throw new Error(
    `‘현재 연결 사용’은 Chat Completion·Text Completion 연결에서만 됩니다(지금 연결: ${context.mainApi || "알 수 없음"}). 연결 프로필을 골라 주십시오.`,
  );
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
      if (profileId === CURRENT_CONNECTION)
        try {
          const context = window.SillyTavern.getContext();
          const settings = context.chatCompletionSettings || {};
          return contentKey({
            current: context.mainApi,
            source: settings.chat_completion_source || "",
            model:
              context.mainApi === "openai"
                ? context.getChatCompletionModel?.(settings) || ""
                : context.textCompletionSettings?.type || "",
          });
        } catch {
          return CURRENT_CONNECTION;
        }
      try {
        const profile = findProfile(service, profileId);
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
    /**
     * Pictures can go along with a request: any connection not known to be Text Completion (a
     * kind that can't be read is tried; the model itself must read images).
     */
    seesImages: (profileId) =>
      !TEXT_ONLY_KINDS.includes(connectionKind(service, profileId)),
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
      // The caller's own stop (options.signal) ends the request too.
      const stop = () => controller.abort(options.signal.reason);
      if (options.signal?.aborted) stop();
      else options.signal?.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException(
              "보조모델 응답이 10분 넘게 오지 않았습니다.",
              "TimeoutError",
            ),
          ),
        HELPER_TIMEOUT_MS,
      );
      const kind = connectionKind(service, profileId);
      const payload = {
        ...(kind === "openai" ? CHAT_ONLY_OFF : {}),
        ...geminiOverrides(service, profileId),
        ...overrides,
      };
      if (app.config.llm?.task_temperature === false)
        delete payload.temperature;
      try {
        app.assertChat(operation);
        const preset = profilePreset(service, profileId);
        // A preset sized for chat replies must not cut a JSON reply short, so the preset's value
        // only raises the task's own size.
        const outputTokens = Math.max(
          positive(preset?.openai_max_tokens, preset?.genamt) || 0,
          maxTokens,
        );
        const contextTokens = positive(
          preset?.openai_max_context,
          preset?.max_length,
        );
        // 추가 지침: the user's own words close every request, as the end of its last user
        // message (the request line), so they are the last thing read. Never shortened.
        messages = withExtraInstructions(
          messages,
          app.config.llm?.extra_instructions,
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
        // Pictures ride on the last message (the request line), as Chat Completion takes them.
        const images =
          !TEXT_ONLY_KINDS.includes(kind) && Array.isArray(options.images)
            ? options.images.filter(Boolean)
            : [];
        if (images.length)
          prompt = prompt.map((message, index) =>
            index === prompt.length - 1
              ? {
                  ...message,
                  content: [
                    { type: "text", text: message.content },
                    ...images.map((url) => ({
                      type: "image_url",
                      image_url: { url },
                    })),
                  ],
                }
              : message,
          );
        app.assertChat(operation);
        const send = (extra = {}) =>
          profileId === CURRENT_CONNECTION
            ? sendCurrent(
                prompt,
                outputTokens,
                { ...payload, ...extra },
                controller.signal,
              )
            : service.sendRequest(
                profileId,
                prompt,
                outputTokens,
                {
                  ...options,
                  images: undefined,
                  stream: false,
                  extractData: true,
                  includePreset: app.config.llm?.include_preset !== false,
                  includeInstruct: true,
                  signal: controller.signal,
                },
                { ...payload, ...extra },
              );
        // A reply with no text: a filter held it back, or the thinking took the whole output
        // limit. Said so (not asked again by itself: the user retries if they want).
        const empty = new Error(
          "보조모델이 빈 답을 돌려줬습니다. 검열에 걸렸거나, 생각하느라 출력 한도를 다 썼을 수 있습니다.",
        );
        let response;
        try {
          response = await send();
        } catch (error) {
          if (
            !controller.signal.aborted &&
            EMPTY_REPLY.test(String(error?.message))
          )
            throw empty;
          throw error;
        }
        if (kind === "openai" && isEmptyReply(response)) throw empty;
        app.assertChat(operation);
        return response;
      } catch (error) {
        if (operation.signal.aborted) throw operation.signal.reason;
        if (controller.signal.aborted) throw controller.signal.reason;
        throw new Error(
          error.cause?.message ||
            error.message ||
            "실리태번 연결 프로필 요청 실패",
        );
      } finally {
        clearTimeout(timer);
        operation.signal.removeEventListener("abort", abort);
        options.signal?.removeEventListener("abort", stop);
      }
    },
  };
}
