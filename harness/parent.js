// parent.js — bare parent page: iframes the built editor, answers its RPC
// from the hardcoded in-memory font, and logs every editFinal to the console
// and the on-page <pre>.
import { FONT_DATA } from "./font-data.js";

const MESSAGE_KEY = "avar2-embed";

const logLines = [];
const logElement = document.getElementById("log");

function log(line) {
  console.log(line);
  logLines.push(line);
  if (logLines.length > 500) {
    logLines.splice(0, logLines.length - 500);
  }
  logElement.textContent = logLines.join("\n");
  logElement.scrollTop = logElement.scrollHeight;
}

// State the verify script inspects.
window.rpcLog = [];
window.editFinalLog = [];

const rpcHandlers = {
  getGlyphMap: () => FONT_DATA.glyphMap,
  getAxes: () => FONT_DATA.axes,
  getSources: () => FONT_DATA.sources,
  getUnitsPerEm: () => FONT_DATA.unitsPerEm,
  getCustomData: () => FONT_DATA.customData,
  getBackEndInfo: () => FONT_DATA.backEndInfo,
  isReadOnly: () => FONT_DATA.readOnly,
  getGlyph: (glyphName) => FONT_DATA.glyphs[glyphName] ?? null,
  getKerning: () => ({}),
  getFeatures: () => ({}),
  getFontInfo: () => ({}),
  findGlyphsThatUseGlyph: () => [],
};

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message?.[MESSAGE_KEY]) {
    return;
  }
  const editorFrame = document.getElementById("editor").contentWindow;
  const reply = (response) =>
    editorFrame.postMessage({ [MESSAGE_KEY]: true, v: 0, ...response }, "*");

  switch (message.type) {
    case "ready":
      log("<< ready");
      reply({ type: "init", font: { title: "fontra-embed harness" } });
      break;

    case "editor-ready":
      log("<< editor-ready");
      break;

    case "error":
      log(`<< ERROR from editor: ${message.error}`);
      break;

    case "rpc": {
      const handler = rpcHandlers[message.method];
      window.rpcLog.push({ method: message.method, args: message.args });
      log(`<< rpc ${message.method}(${message.args.map(String).join(", ")})`);
      if (!handler) {
        reply({ type: "rpc-result", id: message.id, error: `unknown method ${message.method}` });
        break;
      }
      Promise.resolve()
        .then(() => handler(...message.args))
        .then((value) => reply({ type: "rpc-result", id: message.id, value }))
        .catch((error) =>
          reply({ type: "rpc-result", id: message.id, error: String(error) })
        );
      break;
    }

    case "editFinal": {
      window.editFinalLog.push({
        change: message.change,
        rollbackChange: message.rollbackChange,
        label: message.label,
      });
      log(`<< editFinal [${message.label}]\n${JSON.stringify(message.change)}`);
      break;
    }

    case "editIncremental":
      console.log("<< editIncremental", message.change);
      break;
  }
});

log("harness parent loaded");
