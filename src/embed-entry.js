// embed-entry.js — replacement for @fontra/views-editor/start.js.
//
// The shipped start.js does `EditorController.fromBackend()`, which opens a
// WebSocket to the Python server (Backend.remoteFont → getRemoteProxy). Here
// we construct `new EditorController(font)` directly with an EmbedFont whose
// methods proxy over postMessage to the embedding parent window.
//
// Wire protocol v0 (all messages carry {"avar2-embed": true, "v": 0}):
//   iframe -> parent  {"type": "ready"}                          (entry loaded)
//   parent -> iframe  {"type": "init", "font": {"title": ...},   (start editing)
//                      "session"?: {...}, "glyphName"?, "location"?}
//   iframe -> parent  {"type": "rpc", "id", "method", "args"}
//   parent -> iframe  {"type": "rpc-result", "id", "value" | "error"}
//   iframe -> parent  {"type": "editFinal", "change", "rollbackChange", "label"}
//   iframe -> parent  {"type": "editIncremental", "change"}
//   iframe -> parent  {"type": "editor-ready"}                   (start() done)
//   iframe -> parent  {"type": "dirty", "value"}                 (edits since last sync)
//   parent -> iframe  {"type": "reloadData", "pattern"}          (re-pull the model)
//   parent -> iframe  {"type": "message", "headline", "message"} (editor toast)
//
// Session init: the parent may pass the glyph + full location (keyed by axis
// DISPLAY NAME, the desktop contract) directly in `init`. We encode them as
// Fontra's viewInfo URL fragment ourselves (base64(zlib(JSON)), fflate's
// zlibSync) so navigation goes through Fontra's own loadURLFragment path
// either way — a studio-authored fragment already in the URL is replaced,
// and with no init location an existing fragment (or none) is left alone.
import "@fontra/core/theme-settings.js";

import { strToU8, zlibSync } from "fflate";
import { ensureLanguageHasLoaded } from "@fontra/core/localization.js";
import { EditorController } from "@fontra/views-editor/editor.js";
import { EmbedFont } from "./embed-font.js";
import { applyFocusedUI } from "./focused-ui.js";

const MESSAGE_KEY = "avar2-embed";
const PROTOCOL_VERSION = 0;

function postToParent(message) {
  window.parent.postMessage(
    { [MESSAGE_KEY]: true, v: PROTOCOL_VERSION, ...message },
    "*"
  );
}

// Mirror of Fontra's dumpURLFragment: "#" + base64(zlib(JSON.stringify(obj))).
function encodeViewInfoFragment(viewInfo) {
  const compressed = zlibSync(strToU8(JSON.stringify(viewInfo)));
  let binString = "";
  for (let i = 0; i < compressed.length; i++) {
    binString += String.fromCharCode(compressed[i]);
  }
  return "#" + btoa(binString);
}

async function startEmbed(initMessage) {
  await ensureLanguageHasLoaded;

  const font = new EmbedFont(PROTOCOL_VERSION);
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.[MESSAGE_KEY]) {
      font.handleMessage(message);
    }
  });

  document.title = initMessage.font?.title || "Fontra embed";
  // Kept for e2e introspection and debugging.
  window.embedSession = initMessage.session || null;
  // Studio sessions get the slimmed-down "focused editor" UI (CSS + sources
  // sweep poll + metrics HUD; all tolerate the DOM not being built yet).
  applyFocusedUI(window.embedSession, font);

  if (initMessage.glyphName || initMessage.location) {
    const viewInfo = {};
    if (initMessage.glyphName) {
      const glyphName = initMessage.glyphName;
      viewInfo.text = glyphName.length === 1 ? glyphName : "/" + glyphName;
      viewInfo.selectedGlyph = { lineIndex: 0, glyphIndex: 0, isEditing: true };
    }
    if (initMessage.location) {
      viewInfo.location = initMessage.location;
    }
    // replaceState, not location.hash assignment: no history entry, no
    // hashchange — the editor reads the fragment once it starts.
    history.replaceState(null, "", encodeViewInfoFragment(viewInfo));
  }

  const editorController = new EditorController(font);
  // The events fromBackend() wires on a remote font; we fire only these
  // two. Never fire "close"/"error": their handlers dereference
  // font.websocket, which an EmbedFont doesn't have.
  font.on("reloadData", (reloadPattern) =>
    editorController.reloadData(reloadPattern)
  );
  font.on("messageFromServer", (headline, msg) =>
    editorController.messageFromServer(headline, msg)
  );
  await editorController.start();
  editorController.afterStart();

  window.editorController = editorController;
  postToParent({ type: "editor-ready" });
}

let initialized = false;
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.[MESSAGE_KEY] && message.type === "init" && !initialized) {
    initialized = true;
    startEmbed(message).catch((error) => {
      console.error("fontra-embed: editor failed to start", error);
      postToParent({ type: "error", error: String(error) });
    });
  }
});

// The parent attaches its message listener when the iframe element mounts,
// which can race a fast local load of this entry: keep announcing readiness
// until an init arrives (or give up after ~10s).
const readyInterval = setInterval(() => {
  if (initialized) {
    clearInterval(readyInterval);
  } else {
    postToParent({ type: "ready" });
  }
}, 500);
setTimeout(() => clearInterval(readyInterval), 10000);
postToParent({ type: "ready" });
