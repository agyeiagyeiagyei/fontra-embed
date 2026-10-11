// metrics-hud.js — the studio's reference-measurements HUD, ported from
// avar2-studio's server-side injection (avar2_studio/server.py, the second
// half of _FONTRA_STUDIO_SHIM_JS).
//
// Correcting a glyph's horizontals means matching it to the glyphs that
// already read right — E's bar to H's, at the same designspace point.
// Fontra's ruler can measure what you have drawn, but it cannot tell you
// what to aim at, because the target lives in a different glyph. This HUD
// supplies those numbers: the parent bridge measures the PRISTINE source
// model at this layer's exact coordinates (the control axis pinned to
// default) and answers over RPC; the edited glyph's own row is its
// PRE-EDIT state, not what is on the canvas right now.
//
// Deliberately a plain DOM panel rather than a canvas visualization layer:
// it needs none of Fontra's internals, so a Fontra upgrade cannot silently
// break it. The ONE Fontra coupling is livePath() below, which reads
// window.editorController's scene model (set by embed-entry.js) — an API
// coupling, not a selector one.
//
// Loaded only for studio sessions with a glyph (applyFocusedUI gates it);
// on non-studio parents the getReferenceMetrics RPC fails and the panel
// simply shows dashes.

// Scanline stroke measurement, matching the parent's rule so the live and
// reference numbers are comparable: a horizontal cut low in the letter
// reads its vertical stems, a vertical cut mid-advance reads its
// horizontal bars, and the THINNEST run of each is the stroke weight.
function measure(contours, advance) {
  const runs = (coord, vertical) => {
    const vals = [];
    for (const c of contours) {
      for (let i = 0; i < c.length; i++) {
        const P = c[i];
        const Q = c[(i + 1) % c.length];
        const a1 = vertical ? P[0] : P[1];
        const b1 = vertical ? P[1] : P[0];
        const a2 = vertical ? Q[0] : Q[1];
        const b2 = vertical ? Q[1] : Q[0];
        if ((a1 <= coord && coord < a2) || (a2 <= coord && coord < a1)) {
          vals.push(b1 + ((coord - a1) * (b2 - b1)) / (a2 - a1));
        }
      }
    }
    vals.sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i + 1 < vals.length; i += 2) {
      const w = vals[i + 1] - vals[i];
      if (w > 5) {
        out.push([w, vals[i], vals[i + 1]]);
      }
    }
    return out;
  };
  const ys = [];
  for (const c of contours) {
    for (const pt of c) {
      ys.push(pt[1]);
    }
  }
  if (!ys.length) {
    return {};
  }
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  // Scan coordinates + the winning (thinnest) run extents ride along so
  // the overlay can draw EXACTLY what produced each number.
  const scanY = yMin + (yMax - yMin) * 0.25;
  const scanX = advance * 0.5;
  const stems = runs(scanY, false);
  const bars = runs(scanX, true);
  const r = { scanY, scanX };
  if (stems.length) {
    const m = stems.reduce((a, b) => (b[0] < a[0] ? b : a));
    r.stem = m[0];
    r.stemRun = [m[1], m[2]];
  }
  if (bars.length) {
    const m = bars.reduce((a, b) => (b[0] < a[0] ? b : a));
    r.bar = m[0];
    r.barRun = [m[1], m[2]];
  }
  if (r.stem && r.bar) {
    r.contrast = r.stem / r.bar;
  }
  return r;
}

// Fontra's live path for the glyph being edited: a flat coordinate array
// plus contourInfo endpoints. Reading it is what makes the figure track
// the points as they move, rather than reporting the last build.
function livePath() {
  const ec = window.editorController;
  const pg =
    ec &&
    ec.sceneController &&
    ec.sceneController.sceneModel &&
    ec.sceneController.sceneModel.getSelectedPositionedGlyph &&
    ec.sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!pg || !pg.glyph || !pg.glyph.path) {
    return null;
  }
  const path = pg.glyph.path;
  const co = path.coordinates;
  const info = path.contourInfo;
  if (!co || !info) {
    return null;
  }
  const contours = [];
  let startPt = 0;
  for (const ci of info) {
    const pts = [];
    for (let i = startPt; i <= ci.endPoint; i++) {
      pts.push([co[i * 2], co[i * 2 + 1]]);
    }
    if (pts.length > 2) {
      contours.push(pts);
    }
    startPt = ci.endPoint + 1;
  }
  return { name: pg.glyph.name, contours, advance: pg.glyph.xAdvance };
}

// The location being edited RIGHT NOW: Fontra's scene follows the selected
// source/layer (axis-NAME-keyed, source space). The reference must be
// measured there — a glyph can carry several layers on the axis, and the
// session's opening layer is not necessarily the one on the canvas.
function editLocation() {
  const ec = window.editorController;
  const ss =
    ec &&
    ec.sceneController &&
    ((ec.sceneController.sceneModel && ec.sceneController.sceneModel.sceneSettings) ||
      ec.sceneController.sceneSettings);
  const loc = ss && ss.fontLocationSourceMapped;
  if (!loc || typeof loc !== "object") {
    return null;
  }
  const out = {};
  for (const k of Object.keys(loc)) {
    const v = Number(loc[k]);
    if (isFinite(v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function startMetricsHud(session, font) {
  const num = (v) =>
    v === undefined || v === null ? "\u2013" : (Math.round(v * 10) / 10).toFixed(1);
  let refData = null;
  let refGlyph = "";
  let lastLive = null;

  const box = document.createElement("div");
  box.id = "avar2-studio-metrics";
  box.innerHTML =
    '<div class="hd"></div>' +
    '<table><tr><th></th><th>bar</th><th>stem</th><th>s/b</th></tr>' +
    '<tr class="live"><td class="g"></td><td class="b"></td><td class="s"></td><td class="c"></td></tr>' +
    '<tr class="ref"><td class="g"><input id="avar2-ref-glyph" value="" placeholder="H" maxlength="12" spellcheck="false"></td>' +
    '<td class="b"></td><td class="s"></td><td class="c"></td></tr></table>' +
    '<div class="ft">live vs reference, measured at this location. ' +
    "Type a glyph name to compare \u2014 its outline is drawn in the editor " +
    "under the glyph (scan cuts marked). Clear the field to hide it.</div>";
  const st = document.createElement("style");
  st.textContent =
    "#avar2-studio-metrics{position:fixed;right:12px;bottom:12px;z-index:99999;" +
    "background:rgba(28,28,30,.94);color:#eee;font:11px/1.45 ui-monospace,monospace;" +
    "padding:8px 10px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.4);min-width:200px}" +
    "#avar2-studio-metrics .hd{color:#9a9aa0;margin-bottom:5px;font-size:10px}" +
    "#avar2-studio-metrics table{border-collapse:collapse;width:100%}" +
    "#avar2-studio-metrics th{color:#8a8a90;font-weight:400;text-align:right;" +
    "padding:0 0 2px 10px;font-size:10px}" +
    "#avar2-studio-metrics td{text-align:right;padding:1px 0 1px 10px}" +
    "#avar2-studio-metrics td.g{text-align:left;padding-left:0;color:#9a9aa0}" +
    "#avar2-studio-metrics tr.live td{color:#ffd479}" +
    "#avar2-studio-metrics input{width:5.5em;background:#3a3a3e;border:1px solid #55555a;" +
    "color:#eee;font:inherit;border-radius:3px;padding:0 3px}" +
    "#avar2-studio-metrics .ft{color:#7a7a80;margin-top:6px;font-size:9.5px;" +
    "max-width:215px;white-space:normal;line-height:1.35}";
  document.head.appendChild(st);
  document.body.appendChild(box);

  const cell = (sel, v) => {
    const e = box.querySelector(sel);
    if (e) {
      e.textContent = v;
    }
  };
  // CANVAS OVERLAY. The reference outline is drawn in the drawing editor
  // itself, under the glyph being edited: editorController
  // .visualizationLayers.definitions IS Fontra's live registry array, so a
  // definition spliced in at runtime (zIndex-ordered, exactly what
  // registerVisualizationLayerDefinition does) paints on every frame and
  // pans/zooms with the canvas. Scan cuts are marked on both shapes \u2014
  // gray for the reference, amber for the live glyph \u2014 so the table's
  // numbers are visible as geometry, in place, at drawing scale.
  const LAYER_ID = "avar2.studio.reference";
  const overlay = { contours: null, bbox: null, refCuts: null, liveCuts: null, sig: null };
  let layerInstalled = false;
  const repaint = () => {
    const ec = window.editorController;
    if (ec && ec.canvasController) {
      ec.canvasController.requestUpdate();
    }
  };
  const drawOverlay = (context, positionedGlyph, parameters) => {
    const contours = overlay.contours;
    if (!contours) {
      return;
    }
    const path = new Path2D();
    for (const c of contours) {
      path.moveTo(c[0][0], c[0][1]);
      for (let i = 1; i < c.length; i++) {
        path.lineTo(c[i][0], c[i][1]);
      }
      path.closePath();
    }
    context.fillStyle = parameters.fillColor;
    context.fill(path, "nonzero");
    const line = (x1, y1, x2, y2, color, width, dashed) => {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.setLineDash(dashed ? [parameters.dash * 2, parameters.dash] : []);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    };
    const bb = overlay.bbox;
    const cuts = (m, color) => {
      if (!m || !bb) {
        return;
      }
      if (m.scanY !== undefined) {
        line(bb.x0, m.scanY, bb.x1, m.scanY, color, parameters.hair, true);
      }
      if (m.scanX !== undefined) {
        line(m.scanX, bb.y0, m.scanX, bb.y1, color, parameters.hair, true);
      }
      if (m.stemRun) {
        line(m.stemRun[0], m.scanY, m.stemRun[1], m.scanY, color, parameters.bold, false);
      }
      if (m.barRun) {
        line(m.scanX, m.barRun[0], m.scanX, m.barRun[1], color, parameters.bold, false);
      }
    };
    cuts(overlay.refCuts, parameters.refColor);
    cuts(overlay.liveCuts, parameters.liveColor);
  };
  const installLayer = () => {
    if (layerInstalled) {
      return true;
    }
    const ec = window.editorController;
    const vl = ec && ec.visualizationLayers;
    if (!vl || !Array.isArray(vl.definitions)) {
      return false;
    }
    const def = {
      identifier: LAYER_ID,
      name: "avar2 reference overlay",
      selectionFunc: (visContext) => {
        if (!overlay.contours) {
          return [];
        }
        const pg =
          visContext.model.getSelectedPositionedGlyph &&
          visContext.model.getSelectedPositionedGlyph();
        return pg ? [pg] : [];
      },
      zIndex: 100,
      // screenParameters are divided by the magnification before draw, so
      // these are screen pixels: constant weight at any zoom.
      screenParameters: { hair: 1, bold: 4, dash: 7 },
      colors: {
        fillColor: "rgba(128,128,136,0.30)",
        refColor: "rgba(96,96,104,0.85)",
        liveColor: "rgba(200,128,0,0.9)",
      },
      colorsDarkMode: {
        fillColor: "rgba(170,170,180,0.28)",
        refColor: "rgba(190,190,200,0.85)",
        liveColor: "rgba(255,212,121,0.9)",
      },
      draw: drawOverlay,
    };
    let idx = 0;
    while (idx < vl.definitions.length && vl.definitions[idx].zIndex <= def.zIndex) {
      idx++;
    }
    vl.definitions.splice(idx, 0, def);
    vl.toggle(LAYER_ID, true);
    layerInstalled = true;
    return true;
  };
  const syncOverlay = () => {
    installLayer();
    const refM = refGlyph && refData && refData.metrics && refData.metrics[refGlyph];
    if (!refM || !refM.contours || !refM.contours.length) {
      if (overlay.contours) {
        overlay.contours = null;
        overlay.sig = null;
        repaint();
      }
      return;
    }
    const pts = [];
    for (const c of refM.contours) {
      for (const pt of c) {
        pts.push(pt);
      }
    }
    if (lastLive) {
      for (const c of lastLive.contours) {
        for (const pt of c) {
          pts.push(pt);
        }
      }
    }
    const xs = pts.map((pt) => pt[0]);
    const ysv = pts.map((pt) => pt[1]);
    const bb = {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ysv),
      y1: Math.max(...ysv),
    };
    const refCuts = measure(refM.contours, refM.advance || 0);
    const liveCuts = lastLive ? measure(lastLive.contours, lastLive.advance) : null;
    const sig = JSON.stringify([refGlyph, bb, refCuts, liveCuts]);
    if (sig !== overlay.sig) {
      overlay.bbox = bb;
      overlay.refCuts = refCuts;
      overlay.liveCuts = liveCuts;
      overlay.contours = refM.contours;
      overlay.sig = sig;
      repaint();
    }
  };
  const paintRef = () => {
    const m = refData && refData.metrics && refData.metrics[refGlyph];
    cell("tr.ref td.b", m ? num(m.bar) : "\u2013");
    cell("tr.ref td.s", m ? num(m.stem) : "\u2013");
    cell("tr.ref td.c", m && m.contrast ? m.contrast.toFixed(2) : "\u2013");
  };
  let fetchedLocKey = null;
  const loadRef = (g) => {
    refGlyph = g;
    if (!g) {
      // Blank is the OFF state: no reference row, no overlay.
      refData = null;
      fetchedLocKey = null;
      cell(".hd", "");
      paintRef();
      syncOverlay();
      return;
    }
    const loc = editLocation();
    fetchedLocKey = loc ? JSON.stringify(loc) : null;
    font
      .getReferenceMetrics(g, loc || undefined)
      .then((m) => {
        if (!m) {
          return;
        }
        refData = m;
        const loc = Object.entries(m.location || {})
          .filter(([k]) => k.toLowerCase() !== "lcwd")
          .map(([k, v]) => k + " " + v)
          .join(" \u00b7 ");
        cell(".hd", "at " + loc);
        paintRef();
        syncOverlay();
      })
      .catch(() => {});
  };
  const input = box.querySelector("#avar2-ref-glyph");
  input.addEventListener("change", () => loadRef(input.value.trim()));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      input.blur();
    }
  });
  paintRef();

  setInterval(() => {
    // Reference follows the canvas: switching layers (or nudging the
    // location) re-measures at the NEW location.
    if (refGlyph) {
      const loc = editLocation();
      const key = loc ? JSON.stringify(loc) : null;
      if (key && key !== fetchedLocKey) {
        loadRef(refGlyph);
      }
    }
    const lp = livePath();
    if (lp) {
      lastLive = lp;
      const m = measure(lp.contours, lp.advance);
      cell("tr.live td.g", lp.name);
      cell("tr.live td.b", num(m.bar));
      cell("tr.live td.s", num(m.stem));
      cell("tr.live td.c", m.contrast ? m.contrast.toFixed(2) : "\u2013");
    }
    syncOverlay();
  }, 400);
}
