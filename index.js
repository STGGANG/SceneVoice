import { getRequestHeaders } from "/script.js";
import { ConnectionManagerRequestService } from "/scripts/extensions/shared.js";
import { SceneVoice } from "./client/app.js";
import { Transport } from "./client/transport.js";
import { createConnectionBridge } from "./client/connection.js";

async function start() {
  const transport = new Transport(getRequestHeaders);
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
