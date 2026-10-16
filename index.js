import { getRequestHeaders } from "/script.js";
// A namespace import: on a 실리태번 older than 1.12.14 (no profile requests yet) the extension still
// loads and says what it needs, instead of failing without a word.
import * as shared from "/scripts/extensions/shared.js";
import { SceneVoice } from "./client/app.js";
import { Transport } from "./client/transport.js";
import { createConnectionBridge } from "./client/connection.js";

async function start() {
  const transport = new Transport(getRequestHeaders);
  const { ConnectionManagerRequestService } = shared;
  if (!ConnectionManagerRequestService) {
    SceneVoice.notify("씬보이스는 실리태번 1.12.14 이상에서 동작합니다. 실리태번을 업데이트해 주십시오.", "error");
    return;
  }
  try {
    window.SceneVoice?.dispose?.();
    await transport.init();
    await SceneVoice.init({
      transport,
      connectionService: createConnectionBridge(
        ConnectionManagerRequestService,
        SceneVoice,
      ),
    });
    window.SceneVoice = SceneVoice;
  } catch (error) {
    SceneVoice.dispose();
    transport.dispose();
    SceneVoice.notify(`시작 실패: ${error.message}`, "error");
    console.error("[SceneVoice] 초기화 실패", error.name);
  }
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else void start();
