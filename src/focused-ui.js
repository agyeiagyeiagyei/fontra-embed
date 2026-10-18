// focused-ui.js — the studio "focused editor" shim: THE ONE shared
// implementation for both studio hosts (T3.4; the desktop's
// avar2_studio/fontra/shim.js used to be a second, drifted copy).
//
//   - browser embed: bundled here, driven by the parent bridge
//     (avar2-studio frontend/src/editor-bridge.js) sending the session config
//     in the init message. The bridge enforces the actual write guards; this
//     module is UI-level narrowing only.
//   - desktop studio: avar2-studio's Fontra proxy injects a BUILT copy of
//     this file + metrics-hud.js (build-studio-shim.mjs → dist/studio-shim.js,
//     carried in avar2-studio as src/avar2_studio/fontra/embed-shim.js) with
//     the host bootstrap from src/studio-shim-bootstrap.js.
//
// Both hosts feed the SAME session shape: {studio, tag, axis_name,
// axis_default, glyph, auto_enable_edits?, allow_computed_edits?} — the
// bridge init message in the embed, GET /api/fontra-shim-config on the
// desktop. Non-studio sessions (harness, other hosts) get the full,
// unmodified UI.
//
// Reconciled divergences from the old desktop shim (its behavior is the
// reference):
//   - labelRe is regex-escaped and case-insensitive in BOTH hosts: labels
//     print the AUTHORED tag case, and a tag drift on either side must never
//     silently unmatch.
//   - the sources list sorts by source name (Fontra's own "by-source-name"
//     option), so the master/instance-labelled studio layers read A→Z by
//     style.
//   - the editing policy rides two session flags instead of diverging:
//     auto_enable_edits auto-enables studio rows once per layer (the embed
//     demo's behavior; the desktop leaves rows for the designer to toggle
//     deliberately); allow_computed_edits permits "→ computed" correction
//     targets as edit targets (the desktop — its writes self-heal on the
//     next shadow regen; the embed refuses them because the bridge guards
//     those layers read-only, so an enabled row would bounce EVERY edit).
//
// Why bundled: the studio's static demo iframes this bundle cross-origin and
// cannot inject CSS/JS into it, so the slimmed-down UI must ship inside the
// bundle itself for the license separation to hold without a server.
//
// ⚠ FONTRA VERSION DRIFT RISK — every selector below is coupled to the
// vendored Fontra DOM (googlefonts/fontra @ 726b854a1, see vendor.sh):
//   - sidebar tabs/contents: views-editor/src/sidebar.js sets
//     dataset.sidebarName (→ [data-sidebar-name="..."]) from each panel's
//     `identifier` property (views-editor/src/panel-*.js)
//   - edit tool buttons: views-editor/src/editor.js addEditTool() builds
//     #edit-tools > .tool-button[data-tool=...] plus .tool-button.multi-tool
//     wrappers; identifiers live in views-editor/src/edit-tools-*.js
//   - designspace-navigation internals: views-editor/src/
//     panel-designspace-navigation.js — the accordion items live TWO shadow
//     roots deep (panel → ui-accordion), rows come from ui-list's
//     .contents > .row[data-row-index]
// Re-audit THIS FILE when re-pinning Fontra; no other file in the bundle
// should carry these selectors.

import { startMetricsHud } from "./metrics-hud.js";

// Sidebar panels not useful for a brace-layer edit, keyed by panel
// identifier. "designspace-navigation" stays: its sources list is the
// multi-source editing surface. "characters-glyphs" has no panel at the
// pinned commit (stale carry-over from the server shim) — the selector
// simply matches nothing.
const HIDDEN_SIDEBAR_PANELS = [
  "text-entry",
  "selection-info",
  "reference-font",
  "glyph-search",
  "selection-transformation",
  "glyph-note",
  "related-glyphs",
  "characters-glyphs",
];

// Top-level chrome. The sidebar containers must stay visible so the
// designspace-navigation panel has somewhere to live.
const HIDDEN_CHROME = [".top-bar-container", "menu-bar"];

// Drawing tools hidden in studio sessions: structural edits would desync
// multi-source editing. Kept: pointer-tools, power-ruler-tool, metrics-tool,
// hand-tool, and the whole zoom-tools group.
const HIDDEN_EDIT_TOOLS = [
  "pen-tool",
  "pen-tool-cubic",
  "pen-tool-quad",
  "knife-tool",
  "shape-tool",
  "shape-tool-rectangle",
  "shape-tool-ellipse",
];

// designspace-navigation internals trimmed down to the glyph-sources list.
const NAV_PANEL_NAME = "designspace-navigation";
const HIDDEN_ACCORDION_ITEMS = [
  "#font-axes-accordion-item",
  "#glyph-axes-accordion-item",
  "#glyph-layers-accordion-item",
  "#sources-list-add-remove-buttons",
];

function injectFocusCSS() {
  // The desktop proxy already injects the same rules server-side
  // (avar2_studio/fontra/focus.css) — don't double up there.
  if (document.getElementById("avar2-studio-fontra-focus")) {
    return;
  }
  const panelRules = HIDDEN_SIDEBAR_PANELS.map(
    (name) =>
      `.sidebar-tab[data-sidebar-name="${name}"],\n` +
      `  .sidebar-content[data-sidebar-name="${name}"]`
  ).join(",\n  ");
  const toolRules =
    HIDDEN_EDIT_TOOLS.map(
      (tool) => `#edit-tools > .tool-button[data-tool="${tool}"]`
    ).join(",\n  ") +
    ',\n  .tool-button.multi-tool[data-tool="pen-tool"],\n' +
    '  .tool-button.multi-tool[data-tool="shape-tool"]';
  const style = document.createElement("style");
  style.id = "fontra-embed-focus";
  style.textContent = `${panelRules},\n  ${HIDDEN_CHROME.join(
    ",\n  "
  )},\n  ${toolRules} {\n  display: none !important;\n}`;
  document.head.appendChild(style);
}

// A sources-list row is a studio layer when its dense location sits OFF the
// session axis's default — only sidecar seeding creates such layers.
// Fallback: match the seed-time source-name label ("<corner> · <tag> <value>").
function makeIsStudioItem(cfg) {
  const keys = [cfg.axis_name, cfg.tag].filter(Boolean);
  // Regex-escaped and case-insensitive: labels print the AUTHORED tag case,
  // and a tag drift on either side must never silently unmatch.
  const tagEsc = String(cfg.tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = new RegExp("(^|[\\s,])" + tagEsc + "\\s+-?[\\d.]+", "i");
  return (item, sources) => {
    if (!item || item.isFontSource || item.isDefaultSource) {
      return false;
    }
    // A studio brace PINS this control axis explicitly in its own
    // source location — even when the pinned value IS the axis default
    // (the designer may rest the axis on the corrected end). Masters
    // never carry the key; the dense location always does (defaults
    // filled), which is why the old value!==default test went blind
    // once the default moved onto the braces' own value.
    const src =
      sources && typeof item.sourceIndex === "number"
        ? sources[item.sourceIndex]
        : null;
    const sparseLocation = (src && src.location) || null;
    if (sparseLocation) {
      for (const key of keys) {
        if (key in sparseLocation) {
          return true;
        }
      }
    }
    const denseLocation = item.denseLocation || {};
    for (const key of keys) {
      if (key in denseLocation) {
        return Number(denseLocation[key]) !== Number(cfg.axis_default);
      }
    }
    return labelRe.test(String(item.name || ""));
  };
}

// Rows the bridge labels "<label> → computed" are correction targets —
// re-derived on every build. Whether they may be editing targets rides the
// session's allow_computed_edits: the desktop allows them (writes into the
// shadow self-heal on regen); the embed refuses them, because its bridge
// guards writes per layer and rejects any editFinal touching a computed
// layer, so an enabled row would make EVERY edit bounce. The label is part
// of the bridge contract — the same contract the studio-item fallback above
// pattern-matches ("<corner> · <tag> <value>").
const COMPUTED_LABEL_RE = / → computed$/;

// Opens the designspace-navigation tab, sorts the sources list A→Z by
// source name, trims the panel to the sources list, then keeps the list
// narrowed to the session's brace-layer rows: studio rows stay visible;
// masters, font sources and other layers are hidden and never keep editing
// enabled. With the session's auto_enable_edits (the embed demo) studio
// rows also get multi-source editing enabled once per layer — the designer
// can still toggle a row off; without it (the desktop) rows come up
// untouched and an opened layer edits alone until toggled on. If no studio
// row exists the list is left untrimmed (fail open) and nothing is
// auto-enabled (fail closed).
function startSourcesSweep(cfg) {
  const isStudioItem = makeIsStudioItem(cfg);
  const autoEnable = cfg.auto_enable_edits === true;
  const allowComputed = cfg.allow_computed_edits === true;
  let tabOpened = false;
  let panelTrimmed = false;
  let sortSet = false;
  const autoEnabled = new Set();

  const sweep = () => {
    const host = document.querySelector(
      `.sidebar-content[data-sidebar-name="${NAV_PANEL_NAME}"]`
    );
    const panel = host && host.children[0];
    if (!panel || !panel.sourcesList) {
      return;
    }
    if (!sortSet) {
      // Alphabetical by source name — studio layers are labelled by
      // master/instance name, so the list reads A→Z by style. Retry until
      // the editor's settings object exists: the panel's DOM can be
      // queryable before the editor finishes wiring the controller.
      const settings =
        window.editorController &&
        window.editorController.sceneController &&
        window.editorController.sceneController.applicationSettings;
      if (settings) {
        if (settings.glyphSourcesSortOptions !== "by-source-name") {
          settings.glyphSourcesSortOptions = "by-source-name";
        }
        if (typeof panel._updateSources === "function") {
          panel._updateSources();
        }
        sortSet = true;
      }
    }
    if (!tabOpened) {
      const tab = document.querySelector(
        `.sidebar-tab[data-sidebar-name="${NAV_PANEL_NAME}"]`
      );
      if (tab && !tab.classList.contains("selected")) {
        tab.click();
      }
      tabOpened = true;
    }
    if (!panelTrimmed && panel.shadowRoot) {
      // The accordion items live TWO shadow roots deep —
      // panel-designspace-navigation#shadow > ui-accordion#shadow — so a
      // style appended to the panel's own root never reaches them.
      const rules = HIDDEN_ACCORDION_ITEMS.join(",") + "{display:none !important;}";
      const roots = [panel.shadowRoot];
      const accordion = panel.shadowRoot.querySelector("ui-accordion");
      if (accordion && accordion.shadowRoot) {
        roots.push(accordion.shadowRoot);
      }
      for (const root of roots) {
        const style = document.createElement("style");
        style.textContent = rules;
        root.appendChild(style);
      }
      // Only claim success once the inner root — the one that matters — was
      // actually reachable; otherwise retry on the next sweep, since the
      // accordion may not have upgraded yet.
      panelTrimmed = roots.length > 1;
    }
    const list = panel.sourcesList;
    const items = list.items || [];
    const ec = window.editorController;
    const positionedGlyph =
      ec &&
      ec.sceneController &&
      ec.sceneController.sceneModel &&
      ec.sceneController.sceneModel.getSelectedPositionedGlyph &&
      ec.sceneController.sceneModel.getSelectedPositionedGlyph();
    const sources =
      (positionedGlyph &&
        positionedGlyph.varGlyph &&
        positionedGlyph.varGlyph.glyph &&
        positionedGlyph.varGlyph.glyph.sources) ||
      null;
    const anyStudio = items.some((it) => isStudioItem(it, sources));
    const rows = list.shadowRoot
      ? list.shadowRoot.querySelectorAll(".contents > .row")
      : [];
    rows.forEach((row) => {
      const item = items[Number(row.dataset.rowIndex)];
      if (!item) {
        return;
      }
      const studio = isStudioItem(item, sources);
      const editTarget =
        studio && (allowComputed || !COMPUTED_LABEL_RE.test(String(item.name || "")));
      row.style.display = anyStudio && !studio ? "none" : "";
      if (!anyStudio) {
        return;
      }
      if (autoEnable && editTarget && !autoEnabled.has(item.layerName)) {
        autoEnabled.add(item.layerName);
        if (!item.editing) {
          item.editing = true;
        }
      } else if (!editTarget && item.editing) {
        // Hard rule: masters, source layers and (unless the host allows
        // computed edits) correction-target rows are never batch-edit
        // targets — Fontra's own init can put the selected source here, so
        // keep stripping it, not just once.
        item.editing = false;
      }
    });
  };
  setInterval(sweep, 500);
}

// Entry point. The embed calls it from embed-entry.js on init with the
// bridge session + the EmbedFont (whose getReferenceMetrics rides the
// bridge RPC); the desktop's standalone bootstrap (studio-shim-bootstrap.js)
// calls it with the /api/fontra-shim-config session + an HTTP metrics
// adapter. No-op for non-studio sessions. The metrics HUD rides the same
// gate, plus the session must name a glyph and the host must answer the
// metrics channel.
export function applyFocusedUI(session, host) {
  if (!session?.studio) {
    return;
  }
  injectFocusCSS();
  startSourcesSweep(session);
  if (session.glyph && host) {
    startMetricsHud(session, host);
  }
}
