import { dataBlock, ghostwriteFinal, ghostwriteSystem, phoneMessages } from "./prompts.js";
import { stripTags } from "../shared/providers.js";

/**
 * 대필: the helper model drafts the user's next text or call line in their persona's voice.
 * The draft only fills the input box; the user reads, edits and sends it.
 */
export const ghostwrite = {
  /** The user's persona as the draft prompt sees it. */
  personaProfile() {
    const context = window.SillyTavern?.getContext?.() || {};
    return {
      name: String(context.name1 || "User").slice(0, 160),
      description: String(context.powerUserSettings?.persona_description || "").trim(),
      performance_note: String(this.config.character_notes?.user || "").trim(),
    };
  },

  /**
   * A draft of the user's next message. `mode`: "text" or "group" (with the conversation's
   * thread key) or "call" (the open call). `draft`: what the user already typed, kept in meaning.
   */
  async ghostwriteDraft(mode, key = "", draft = "") {
    const profileId =
      this.config.phone?.connection_profile_id || this.config.connection_profile_id || "";
    if (!profileId || !this.connectionService)
      throw new Error("대필에 쓸 실리태번 연결 프로필을 먼저 골라 주세요.");
    const operation = this.captureChat();
    const persona = this.personaProfile();
    let other, conversation, lines, otherKey;
    if (mode === "call") {
      const session = this.phoneSession;
      if (!session) throw new Error("통화 중이 아닙니다.");
      otherKey = session.character_key;
      other = this.phoneContact(otherKey);
      const turns = (session.turns || []).slice(-30);
      lines = turns.map((turn) => turn.text);
      conversation = dataBlock(
        "call_transcript",
        turns.map((turn) => ({
          speaker: turn.role === "user" ? persona.name : other.name,
          text: turn.text,
        })),
      );
    } else {
      const thread = (await this.loadMessages())
        .filter((item) => this.messageThreadOf(item) === key)
        .slice(-40);
      other = this.threadContact(key);
      otherKey = other.group ? "" : key;
      lines = thread.map((item) => item.text);
      conversation = dataBlock(
        "text_thread",
        thread.map((item) => ({
          from: item.role === "user" ? persona.name : item.character_name || other.name,
          text: item.text,
        })),
      );
    }
    // The language the other side speaks in this conversation.
    const language = this.conversationLanguage(lines.slice(-6), "", otherKey);
    // What the user typed goes in a user message of its own; the rest is data after the rules.
    const messages = phoneMessages(
      ghostwriteSystem({ mode, language }),
      [
        dataBlock("persona", persona),
        dataBlock(
          "other",
          other.group
            ? { group: other.name, members: other.members.map((member) => member.name) }
            : { name: other.name, description: String(other.description || "").slice(0, 1500) },
        ),
        dataBlock(
          "recent_chat",
          this.buildRecentChatContext(this.config.phone?.context_messages ?? 10),
        ),
        ...((await this.worldInfoBlocks?.(lines)) || []),
        ...this.currentTimeBlocks(otherKey ? [otherKey] : []),
        conversation,
      ],
      ghostwriteFinal(persona.name, language),
      draft.trim() ? [dataBlock("user_draft", draft.trim())] : [],
    );
    this.assertChat(operation);
    const parsed = await this.requestSpokenReply(profileId, messages, 600);
    this.assertChat(operation);
    const text = String(parsed?.text ?? "")
      .split("\n")
      .map((line) => stripTags(line).replace(/^["“「]|["”」]$/g, "").trim())
      .filter(Boolean)
      .join(mode === "call" ? " " : "\n");
    if (!text) throw new Error("보조 모델이 대필 내용을 돌려주지 않았습니다.");
    return text;
  },
};
