# fontra-embed

Run the [Fontra](https://github.com/fontra/fontra) glyph editor
embedded in a static web page **without its Python backend** — no server, no
WebSocket. The editor's font object is duck-typed: instead of the shipped
`EditorController.fromBackend()` entry (which opens a WebSocket via
`getRemoteProxy`), we construct `new EditorController(font)` with a font
object whose methods proxy over `postMessage` to the embedding parent window.

**Status: production component of the avar2-studio browser demo.** The studio
iframes this bundle as the glyph editor for secondary-axis brace layers:
edits flow back over the bridge, rebuild in-browser via fontc-wasm, and
persist in the session/workspace zip. The focused studio UI (trimmed panels
and tools, sources-list narrowing, metrics HUD) lives in
`src/focused-ui.js` / `src/metrics-hud.js`.

## Deployment

The bundle deploys to GitHub Pages via `.github/workflows/pages.yml`
(push to `main`): vendor → npm install → build → deploy `dist/`.
The studio pins the deployed URL in its frontend
(`frontend/src/editor-bridge.js`, `embedEditorUrl()`), with a wire-protocol
version check (`v`) that fails loudly on a stale pairing.

## Provenance

Vendored from **googlefonts/fontra** (the Google fork, not fontra/fontra —
the pinned commit only exists there) at commit
[`726b854a19620d4e1c58a3960a33db2792b027f8`](https://github.com/googlefonts/fontra/commit/726b854a19620d4e1c58a3960a33db2792b027f8)
("726b854a1"). This is exactly the version installed in the avar2-studio
`.venv` (`fontra-0.1.dev11884+g726b854a1.dist-info/direct_url.json`), so the
embedded editor behaves like the desktop integration.

`./vendor.sh` reproduces the vendoring: clone at the pinned commit → copy
`src-js/{fontra-core,fontra-webcomponents,views-editor}` into `vendor/` and
the editor view's `assets/` into `src/assets/`.

## License

GPL v3 (see `LICENSE`). Fontra itself is GPLv3; the built embed artifact is
a Fontra derivative, so this sub-project is GPL too and stays separate from
any differently-licensed host project.

## Build & run

```
./vendor.sh          # one-time (or to re-pin): fetch + copy fontra sources
npm install
npm run build        # production bundle into dist/  (build:dev for dev)
```

Serve `dist/` statically with anything, e.g. `npx serve dist` or
`python3 -m http.server -d dist`, then open `/harness/index.html`. The
harness iframes `/editor.html`, answers the editor's RPC from a hardcoded
in-memory font (two masters "Light"/"Bold" on `wght` 300–700; an 11-node
arch glyph `n` with cubic off-curve nodes; a `period` glyph), and logs every
`editFinal` to the console and the on-page `<pre>`.

Headless gate (requires playwright-core; currently imported from the
avar2-studio checkout, path hardcoded at the top of `harness/verify.mjs`):

```
node harness/verify.mjs
```

## Wire protocol v0

All messages are `{ "avar2-embed": true, "v": 0, ... }`.

| direction       | message                                                        |
|-----------------|----------------------------------------------------------------|
| iframe → parent | `{type: "ready"}` — entry loaded, waiting for init             |
| parent → iframe | `{type: "init", font: {title}}` — start the editor             |
| iframe → parent | `{type: "rpc", id, method, args}`                              |
| parent → iframe | `{type: "rpc-result", id, value}` or `{..., error}`            |
| iframe → parent | `{type: "editFinal", change, rollbackChange, label}`           |
| iframe → parent | `{type: "editIncremental", change}` (live edits, fire+forget)  |
| iframe → parent | `{type: "editor-ready"}` — `start()` finished                  |

`editFinal` is fire-and-forget in v0: the client applies changes
optimistically and keeps undo client-side, so there is no result/error
round-trip. `init.font` carries only `title`; all font data goes over RPC
(the plan's bootstrap slot exists but v0 proxies everything, which also
makes the startup RPC sequence observable).

## What the font object must implement (as actually called at this commit)

Startup (`FontController.initialize`): `getGlyphMap`, `getAxes`,
`getSources`, `getUnitsPerEm`, `getCustomData`, `getBackEndInfo`,
`isReadOnly`. Editing: `getGlyph`, `editFinal`, `editIncremental`.
Subscriptions: `subscribeChanges`, `unsubscribeChanges` (may no-op).
Events: `on(event, cb)` for close/error/messageFromServer/externalChange/
reloadData/reconnect — may no-op as long as you never fire `"close"`
(`handleRemoteClose` would dereference `font.websocket.readyState`).

Beyond the documented set, this commit actually calls:

- **`findGlyphsThatUseGlyph(glyphName)`** — UNGATED, from the Related Glyphs
  sidebar panel on every selection change (panel-related-glyphs.js).
  `backendInfo.features` does not gate it. Must exist; may return `[]`.
- **`getKerning()`** — via `FontController.getKerningController` when
  kerning applies (scene-model defaults `applyKerning: true`). `{}` works.
- `getFeatures()` / `getFontInfo()` — only through `getData()` lazily;
  implemented for completeness.

Also required: `getBackEndInfo()` must return an object with **both**
`features` ({} gates background-image/find-glyphs actions) and
`projectManagerFeatures` ({} suffices; `ViewController.afterStart` reads
`projectManagerFeatures["export-as"]` unconditionally).

Data shapes: `getAxes()` → `{axes: [FontAxis], mappings: []}`;
`getSources()` → `{id: FontSource}` (a non-sparse source must sit at the
default location); `getGlyphMap()` → `{glyphName: [codePoints]}`;
`getGlyph()` → VariableGlyph `{name, axes, sources: [{name, layerName,
location}], layers: {layerName: {glyph: StaticGlyph}}}` with PackedPath
`{coordinates: [x,y,…], pointTypes: [...], contourInfo: [{endPoint,
isClosed}]}`; pointTypes: on-curve `0x00`, off-curve cubic `0x02`
(quad `0x01`), smooth flag `0x08` (fontra-core/src/var-path.js).

## Static assets the editor needs at runtime

Served from `dist/` root (copied from `@fontra/core` assets by the build):
`/css/*`, `/images/*`, `/tabler-icons/*` (inline-svg fetches at startup),
`/lang/<locale>.js` (dynamic import at startup, en falls back gracefully),
`/fonts/AdobeBlank.woff2` (`await FontFace.load()` in `EditorController.start()`),
`/data/glyph-data.csv` + `/data/language-mapping.json` (lazy, sidebar panels).

## Build output

Production: single 860 KiB minified JS entry (+ lazy chunks), ~4.1 MB total
`dist/` dominated by `data/glyph-data.csv` (2.3 MB) and tabler-icons.
Webpack rebuilds the editor from the unminified src-js sources with our
`src/embed-entry.js` swapped for the shipped `start.js`.

## Repo layout

- `vendor.sh` — reproducible vendoring (pinned commit)
- `webpack.config.cjs` — single-view build (`src/embed.html` → `dist/editor.html`), copies core assets + harness
- `src/embed.html` — `editor.html` @ pinned commit, entry script swapped
- `src/embed-entry.js` — handshake + `new EditorController(new EmbedFont())`
- `src/embed-font.js` — the postMessage font proxy (the duck type)
- `src/focused-ui.js` — studio "focused editor" shim (gated on session config)
- `src/metrics-hud.js` — studio reference-metrics HUD (RPC `getReferenceMetrics`)
- `src/assets/editor.css` — vendored view stylesheet
- `harness/` — parent page, hardcoded font, headless gate
