// The app: every client module is a set of methods (a mixin) spread into this one SceneVoice
// object, so they share state through `this`.
import { EMOTIONS, mergeConfig } from "./common.js";
import { casting } from "./casting.js";
import { shell } from "./shell.js";
import { calls } from "./calls.js";
import { messages } from "./messages.js";
import { callHistory } from "./call-history.js";
import { groups } from "./groups.js";
import { ghostwrite } from "./ghostwrite.js";
import { lore } from "./lore.js";
import { memory } from "./memory.js";
import { dialogue } from "./dialogue.js";
import { character } from "./character.js";
import { stateTab } from "./state-tab.js";
import { outreach } from "./outreach.js";
import { analysis } from "./analysis.js";
import { playback } from "./playback.js";
import { language } from "./language.js";
import { panel } from "./panel.js";
import { history } from "./history.js";
import { lifecycle } from "./lifecycle.js";
import { runtime } from "./runtime.js";

import { backup } from "./backup.js";
import { lineEdits } from "./line-edits.js";
import { messageGeneration } from "./message-generation.js";
import { contacts } from "./contacts.js";
import { maintenance } from "./maintenance.js";
import { reading } from "./reading.js";
import { voicePicker } from "./voice-picker.js";
import { multicast } from "./multicast.js";
import { publicApi } from "./public-api.js";
import { updates } from "./updates.js";
import { callVideo } from "./call-video.js";
import { voicemail } from "./voicemail.js";
import { memos } from "./memos.js";
import { forward } from "./forward.js";
import { groupCall } from "./group-call.js";
import { radio } from "./radio.js";

export const SceneVoice = {
  connectionService: null,
  config: mergeConfig(),
  availableEmotions: Array.from(EMOTIONS),
  favoritesPath: "",
  analysisCache: new Map(),
  queue: Promise.resolve(),
  observer: null,
  scanTimer: null,
  currentAudio: null,
  currentPlayButton: null,
  currentAudioObjectUrl: "",
  currentAudioNodes: [],
  communicationAudioContext: null,
  audioUnlocked: false,
  stateScanTimer: null,
  stateTrackingBusy: false,
  lastStateTrackingSource: "",
  // The last state update round, and the person the state tab shows.
  lastStateRound: null,
  statePersonKey: "",
  phoneSession: null,
  phoneActiveTab: "home",
  phoneBusy: false,
  phoneAudioBusyTurnId: "",
  // A call ringing (incoming_call); texts and voice messages people decided to send, waiting to be
  // written, and the one being written now.
  phonePendingEvent: null,
  incomingTexts: [],
  incomingText: null,
  phoneOperationToken: 0,
  phoneTimer: null,
  voiceMessageBusy: false,
  // Messaging app: the open conversation, contacts with unread replies, and the reply in progress.
  messageThreadKey: "",
  unreadThreads: new Set(),
  // 적용 기억 or 미적용 기억, per app (message, history).
  phoneShelf: {},
  // Replies waiting per conversation (a short pause for more texts), the one being written, and
  // conversations texted meanwhile, answered next in turn.
  textReplyTimers: new Map(),
  textReplyBusy: "",
  textReplyAgain: new Set(),
  // Group conversations of the open chat, and the group being made or changed.
  messageGroups: [],
  groupEditor: null,
  chatMemoryPromptKeys: new Set(),
  chatMemoryRefreshTimer: null,
  chatMemoryEventsBound: false,
  backendConnected: false,
  backendError: "",

  ...backup,
  ...lineEdits,
  ...messageGeneration,
  ...contacts,
  ...maintenance,
  ...reading,
  ...voicePicker,
  ...multicast,
  ...publicApi,
  ...updates,
  ...callVideo,
  ...voicemail,
  ...memos,
  ...forward,
  ...groupCall,
  ...radio,
  ...casting,
  ...shell,
  ...calls,
  ...messages,
  ...callHistory,
  ...groups,
  ...ghostwrite,
  ...lore,
  ...memory,
  ...dialogue,
  ...character,
  ...stateTab,
  ...outreach,
  ...analysis,
  ...playback,
  ...language,
  ...panel,
  ...history,
  ...lifecycle,
  ...runtime,
};
