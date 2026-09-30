// focused-ui.js — the studio "focused editor" shim, ported into the embed
// bundle from avar2-studio's server-side page injection
// (avar2_studio/server.py: _fontra_focus_css + _FONTRA_STUDIO_SHIM_JS).
//
// Why here: the studio's static demo iframes this bundle cross-origin and
// cannot inject CSS/JS into it, so the slimmed-down UI must ship inside the
// bundle itself for the license separation to hold without a server.
//
// Active only for studio sessions — the parent bridge (avar2-studio
// frontend/src/editor-bridge.js) sends session config
// {studio: true, tag, axis_name, axis_default, glyph} in the init message.
// Non-studio embeds (harness, other hosts) get the full, unmodified UI.
// This module is UI-level narrowing only; the bridge enforces the actual
// write guards.
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
  const labelRe = new RegExp("(^|[\\s,])" + cfg.tag + "\\s+-?[\\d.]+");
  return (item) => {
    if (!item || item.isFontSource) {
      return false;
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

// Opens the designspace-navigation tab, trims the panel to the sources
// list, then keeps the list narrowed to the session's brace-layer rows:
// studio rows stay visible and get multi-source editing enabled once per
// layer (the designer can still toggle a row off); masters, font sources
// and other layers are hidden and never keep editing enabled. If no studio
// row exists the list is left untrimmed (fail open) and nothing is
// auto-enabled (fail closed).
//
// One deliberate deviation from the desktop shim: rows the bridge labels
// "<label> → computed" (correction targets — re-derived on every build)
// stay visible but are never editing-enabled. The desktop can afford to
// enable them (its writes self-heal on regen); here the bridge guards
// writes per layer and rejects any editFinal touching a computed layer,
// so enabling one would make EVERY edit bounce. The label is part of the
// bridge contract — the same contract the studio-item fallback below
// pattern-matches ("<corner> · <tag> <value>").
const COMPUTED_LABEL_RE = / → computed$/;

function startSourcesSweep(cfg) {
  const isStudioItem = makeIsStudioItem(cfg);
  let tabOpened = false;
  let panelTrimmed = false;
  const autoEnabled = new Set();

  const sweep = () => {
    const host = document.querySelector(
      `.sidebar-content[data-sidebar-name="${NAV_PANEL_NAME}"]`
    );
    const panel = host && host.children[0];
    if (!panel || !panel.sourcesList) {
      return;
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
    const anyStudio = items.some(isStudioItem);
    const rows = list.shadowRoot
      ? list.shadowRoot.querySelectorAll(".contents > .row")
      : [];
    rows.forEach((row) => {
      const item = items[Number(row.dataset.rowIndex)];
      if (!item) {
        return;
      }
      const studio = isStudioItem(item);
      const editTarget =
        studio && !COMPUTED_LABEL_RE.test(String(item.name || ""));
      row.style.display = anyStudio && !studio ? "none" : "";
      if (!anyStudio) {
        return;
      }
      if (editTarget) {
        if (!autoEnabled.has(item.layerName)) {
          autoEnabled.add(item.layerName);
          if (!item.editing) {
            item.editing = true;
          }
        }
      } else if (item.editing) {
        // Hard rule: masters, source layers and computed correction
        // targets are never batch-edit targets — Fontra's own init can
        // put the selected source here, so keep stripping it, not just
        // once.
        item.editing = false;
      }
    });
  };
  setInterval(sweep, 500);
}

// Entry point called from embed-entry.js on init. No-op for non-studio
// sessions. The metrics HUD (Phase 4b) rides the same gate, plus the
// session must name a glyph and the parent must answer the metrics RPC.
export function applyFocusedUI(session, font) {
  if (!session?.studio) {
    return;
  }
  injectFocusCSS();
  startSourcesSweep(session);
  if (session.glyph && font) {
    startMetricsHud(session, font);
  }
}
