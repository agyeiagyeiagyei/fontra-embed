// EmbedFont — a font object that satisfies Fontra's client-side "backend"
// duck type, proxying every data call over postMessage to the parent window.
//
// The set of methods is what FontController/EditorController actually call
// (fontra-core/src/font-controller.js at the pinned commit). There is NO
// WebSocket anywhere: remote.js / backend-api.js are never imported.

const MESSAGE_KEY = "avar2-embed";

export class EmbedFont {
  constructor(protocolVersion) {
    this.protocolVersion = protocolVersion;
    this._nextRequestID = 1;
    this._pending = new Map();
    this._eventHandlers = {};
    this._dirty = false;
  }

  handleMessage(message) {
    if (message.type === "rpc-result") {
      const pending = this._pending.get(message.id);
      if (pending) {
        this._pending.delete(message.id);
        if (message.error !== undefined) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.value);
        }
      }
    } else if (message.type === "reloadData") {
      // The parent re-synced its model (an edit was applied and built, or
      // a guarded edit was rejected and must be reverted): re-pull through
      // the ViewController's reload path. Editor-side edits are all
      // persisted by the parent on receipt, so a reload means "in sync".
      this._setDirty(false);
      this._fire("reloadData", message.pattern);
    } else if (message.type === "message") {
      // Human-readable notice from the parent (e.g. a rejected edit) —
      // surfaced in the editor UI by the entry point's wiring.
      this._fire("messageFromServer", message.headline, message.message);
    }
  }

  _fire(event, ...args) {
    for (const callback of this._eventHandlers[event] || []) {
      callback(...args);
    }
  }

  _setDirty(value) {
    if (this._dirty !== value) {
      this._dirty = value;
      this._post({ type: "dirty", value });
    }
  }

  _rpc(method, args = []) {
    const id = this._nextRequestID++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._post({ type: "rpc", id, method, args });
    });
  }

  _post(message) {
    window.parent.postMessage(
      { [MESSAGE_KEY]: true, v: this.protocolVersion, ...message },
      "*"
    );
  }

  // --- startup data -------------------------------------------------------

  async getGlyphMap() {
    return this._rpc("getGlyphMap");
  }
  async getAxes() {
    return this._rpc("getAxes");
  }
  async getSources() {
    return this._rpc("getSources");
  }
  async getUnitsPerEm() {
    return this._rpc("getUnitsPerEm");
  }
  async getCustomData() {
    return this._rpc("getCustomData");
  }
  async getBackEndInfo() {
    return this._rpc("getBackEndInfo");
  }
  async isReadOnly() {
    return this._rpc("isReadOnly");
  }

  // --- glyph data ---------------------------------------------------------

  async getGlyph(glyphName) {
    return this._rpc("getGlyph", [glyphName]);
  }
  async getKerning() {
    return this._rpc("getKerning");
  }
  async getFeatures() {
    return this._rpc("getFeatures");
  }
  async getFontInfo() {
    return this._rpc("getFontInfo");
  }
  // Called UNGATED by the Related Glyphs sidebar panel on selection change
  // (panel-related-glyphs.js) — not optional despite what backendInfo.features
  // suggests.
  async findGlyphsThatUseGlyph(glyphName) {
    return this._rpc("findGlyphsThatUseGlyph", [glyphName]);
  }

  // --- studio session extras ------------------------------------------------

  // Not a Fontra backend method — the avar2-studio bridge's metrics channel
  // for the reference HUD (src/metrics-hud.js). Only present when the parent
  // is the studio bridge; other hosts answer "unknown method", which the
  // HUD treats as "no reference data".
  async getReferenceMetrics(refs) {
    return this._rpc("getReferenceMetrics", [refs]);
  }

  // --- editing ------------------------------------------------------------

  // editFinal is fire-and-forget in protocol v0: the client applies the
  // change optimistically and keeps undo client-side. The parent applies
  // each edit to its own model on receipt (guarded edits are reverted via
  // a reloadData push), so no result/error round-trip is needed.
  async editFinal(change, rollbackChange, label, broadcast) {
    this._setDirty(true);
    this._post({ type: "editFinal", change, rollbackChange, label });
    return undefined;
  }

  editIncremental(change) {
    this._post({ type: "editIncremental", change });
  }

  // --- change subscription (no-op: the parent never pushes changes) -------

  subscribeChanges(pathOrPattern, wantLiveChanges) {}
  unsubscribeChanges(pathOrPattern, wantLiveChanges) {}

  // --- remote-object event surface -----------------------------------------
  // ViewController.fromBackend() registers handlers for these events on the
  // remote font object. We never fire them: in particular, firing "close"
  // would make handleRemoteClose dereference this.websocket.readyState.
  on(event, callback) {
    (this._eventHandlers[event] ||= []).push(callback);
  }
}
