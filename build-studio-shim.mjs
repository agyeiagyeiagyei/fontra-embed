// build-studio-shim.mjs — build the standalone studio shim for the desktop.
//
// Concatenates the shared implementation (src/metrics-hud.js +
// src/focused-ui.js) and the host bootstrap (src/studio-shim-bootstrap.js)
// into ONE self-contained classic script, dist/studio-shim.js, which
// avar2-studio carries as src/avar2_studio/fontra/embed-shim.js and injects
// into proxied Fontra pages (routes/fontra.py) — the same implementation
// the webpack bundle gets via embed-entry.js's module imports.
//
// No bundler: the three files' only cross-reference is `startMetricsHud`,
// so the build is a concat with the module syntax stripped. Every strip is
// counted and asserted, so a source drift fails the build instead of
// emitting a silently broken script.
//
// Usage: node build-studio-shim.mjs [output]   (default: dist/studio-shim.js)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(root, "dist", "studio-shim.js"));

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

// Strip exactly the module syntax the concat can't carry; throw when the
// source moved on (the replacement list IS the inter-module import graph).
function stripModuleSyntax(source, replacements) {
  for (const [from, to, expected] of replacements) {
    const found = source.split(from).length - 1;
    if (found !== expected) {
      throw new Error(`expected ${expected} × ${JSON.stringify(from)}, found ${found}`);
    }
    source = source.split(from).join(to);
  }
  if (/^\s*(import|export)\b/m.test(source)) {
    throw new Error("module syntax left over after stripping");
  }
  return source.trimEnd();
}

const metricsHud = stripModuleSyntax(read("src/metrics-hud.js"), [
  ["export function startMetricsHud(", "function startMetricsHud(", 1],
]);
const focusedUi = stripModuleSyntax(read("src/focused-ui.js"), [
  ['import { startMetricsHud } from "./metrics-hud.js";\n\n', "", 1],
  ["export function applyFocusedUI(", "function applyFocusedUI(", 1],
]);
const bootstrap = stripModuleSyntax(read("src/studio-shim-bootstrap.js"), [
  ["export function bootstrapStudioShim(", "function bootstrapStudioShim(", 1],
]);

let revision = "unknown";
try {
  revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root })
    .toString()
    .trim();
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString().trim()) {
    revision += "-dirty";
  }
} catch {
  // Not a git checkout — the provenance header just says "unknown".
}

const header = `// avar2-studio Fontra shim — the SHARED desktop/embed implementation (T3.4).
// Built from fontra-embed @ ${revision} (src/metrics-hud.js + src/focused-ui.js +
// src/studio-shim-bootstrap.js) by build-studio-shim.mjs — DO NOT EDIT HERE:
// edit the fontra-embed sources, rebuild, re-copy. Injected into proxied
// Fontra pages by avar2-studio (routes/fontra.py); fontra/shim.js is the
// fallback when this file is absent.
`;

const body =
  header +
  "(function () {\n" +
  '  "use strict";\n' +
  metricsHud +
  "\n\n" +
  focusedUi +
  "\n\n" +
  bootstrap +
  "\n\n" +
  "  bootstrapStudioShim(applyFocusedUI);\n" +
  "})();\n";

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, body);
console.log(`wrote ${out} (${body.length} bytes, fontra-embed @ ${revision})`);
