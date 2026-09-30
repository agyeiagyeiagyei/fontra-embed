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
      out.push(vals[i + 1] - vals[i]);
    }
    return out.filter((v) => v > 5);
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
  const stems = runs(yMin + (yMax - yMin) * 0.25, false);
  const bars = runs(advance * 0.5, true);
  const r = {};
  if (stems.length) {
    r.stem = Math.min(...stems);
  }
  if (bars.length) {
    r.bar = Math.min(...bars);
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

export function startMetricsHud(session, font) {
  const num = (v) =>
    v === undefined || v === null ? "–" : (Math.round(v * 10) / 10).toFixed(1);
  let refData = null;
  let refGlyph = "H";

  const box = document.createElement("div");
  box.id = "avar2-studio-metrics";
  box.innerHTML =
    '<div class="hd"></div>' +
    '<table><tr><th></th><th>bar</th><th>stem</th><th>s/b</th></tr>' +
    '<tr class="live"><td class="g"></td><td class="b"></td><td class="s"></td><td class="c"></td></tr>' +
    '<tr class="ref"><td class="g"><input id="avar2-ref-glyph" value="H" maxlength="12" spellcheck="false"></td>' +
    '<td class="b"></td><td class="s"></td><td class="c"></td></tr></table>' +
    '<div class="ft">live vs reference, measured at this location. ' +
    "Type any glyph name to compare against.</div>";
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
  const paintRef = () => {
    const m = refData && refData.metrics && refData.metrics[refGlyph];
    cell("tr.ref td.b", m ? num(m.bar) : "–");
    cell("tr.ref td.s", m ? num(m.stem) : "–");
    cell("tr.ref td.c", m && m.contrast ? m.contrast.toFixed(2) : "–");
  };
  const loadRef = (g) => {
    refGlyph = g;
    font
      .getReferenceMetrics(g)
      .then((m) => {
        if (!m) {
          return;
        }
        refData = m;
        const loc = Object.entries(m.location || {})
          .filter(([k]) => k.toLowerCase() !== "lcwd")
          .map(([k, v]) => k + " " + v)
          .join(" · ");
        cell(".hd", "at " + loc);
        paintRef();
      })
      .catch(() => {});
  };
  const input = box.querySelector("#avar2-ref-glyph");
  input.addEventListener("change", () => loadRef(input.value.trim() || "H"));
  input.addEventListener("keydown", (e) => e.stopPropagation());
  loadRef("H");

  setInterval(() => {
    const lp = livePath();
    if (!lp) {
      return;
    }
    const m = measure(lp.contours, lp.advance);
    cell("tr.live td.g", lp.name);
    cell("tr.live td.b", num(m.bar));
    cell("tr.live td.s", num(m.stem));
    cell("tr.live td.c", m.contrast ? m.contrast.toFixed(2) : "–");
  }, 400);
}
