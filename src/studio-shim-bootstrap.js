// studio-shim-bootstrap.js — host bootstrap for the STANDALONE build of the
// studio shim. build-studio-shim.mjs concatenates src/metrics-hud.js +
// src/focused-ui.js + this file into one self-contained classic script
// (dist/studio-shim.js) that avar2-studio carries as
// src/avar2_studio/fontra/embed-shim.js and injects into proxied Fontra
// pages. The webpack bundle never imports this file — embed-entry.js drives
// applyFocusedUI directly with the init-message session.
//
// Both hosts feed the shim the SAME session shape ({studio, tag, axis_name,
// axis_default, glyph, auto_enable_edits?, allow_computed_edits?}); only the
// delivery and the reference-metrics channel differ:
//   - desktop (avar2-studio's Fontra proxy; the editor page is always served
//     under /fontra/): the session comes from GET /api/fontra-shim-config,
//     same origin; reference metrics over HTTP at
//     /api/control-axes/<tag>/reference-metrics.
//   - browser embed: the session rides the bridge init message (wire
//     protocol v0; embed-entry.js also stashes it on window.embedSession);
//     reference metrics go over the bridge's own postMessage RPC, with ids
//     namespaced ("shim-N") so they can't collide with the EmbedFont
//     channel's numeric ids.

const EMBED_MESSAGE_KEY = "avar2-embed";

function desktopMetricsHost(cfg) {
  return {
    getReferenceMetrics(refs, location) {
      return fetch(
        "/api/control-axes/" +
          encodeURIComponent(cfg.tag) +
          "/reference-metrics?glyph=" +
          encodeURIComponent(cfg.glyph || "") +
          "&refs=" +
          encodeURIComponent(refs) +
          (location ? "&location=" + encodeURIComponent(JSON.stringify(location)) : "")
      ).then((r) => (r.ok ? r.json() : null));
    },
  };
}

function embedMetricsHost() {
  let nextRequestId = 0;
  const pending = new Map();
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.[EMBED_MESSAGE_KEY] && message.type === "rpc-result" && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) {
        reject(new Error(message.error));
      } else {
        resolve(message.value);
      }
    }
  });
  return {
    getReferenceMetrics(refs, location) {
      const id = "shim-" + ++nextRequestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.parent.postMessage(
          {
            [EMBED_MESSAGE_KEY]: true,
            v: 0,
            type: "rpc",
            id,
            method: "getReferenceMetrics",
            args: [refs, location],
          },
          "*"
        );
      });
    },
  };
}

export function bootstrapStudioShim(start) {
  const startIfStudio = (session, host) => {
    if (session?.studio) {
      start(session, host);
    }
  };
  if (window.embedSession) {
    // Embed, after the bundle's entry has consumed the init message.
    startIfStudio(window.embedSession, embedMetricsHost());
    return;
  }
  if (!location.pathname.startsWith("/fontra/")) {
    // Embed, before init: the session arrives in the bridge init message.
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message?.[EMBED_MESSAGE_KEY] && message.type === "init") {
        startIfStudio(message.session, embedMetricsHost());
      }
    });
    return;
  }
  // Desktop studio proxy: same-origin session endpoint.
  fetch("/api/fontra-shim-config")
    .then((r) => r.json())
    .then((cfg) => startIfStudio(cfg, desktopMetricsHost(cfg)))
    .catch((e) => console.warn("avar2-studio shim:", e));
}
