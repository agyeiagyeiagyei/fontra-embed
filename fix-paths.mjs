// Post-build: rewrite root-absolute asset URLs in dist/editor.html to
// relative ones. The Fontra client hardcodes root-absolute paths, which
// only resolve when dist/ is served at a domain root; we deploy under a
// Pages project path (/fontra-embed/). The html-bundler plugin passes
// absolute URLs through untouched (relative ones it tries to resolve as
// source modules), so the rewrite happens here, after the build.
// Relative URLs resolve against editor.html in both layouts: port-root
// dev serving and the Pages subpath.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("./dist/editor.html", import.meta.url);
let html = readFileSync(file, "utf8");
const before = html;
html = html
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replaceAll('"fontra/": "/"', '"fontra/": "./"');
writeFileSync(file, html);
console.log(`fix-paths: ${before === html ? "nothing to rewrite (!)" : "editor.html relativized"}`);
