// verify.mjs — headless gate for the fontra-embed spike.
//
// Serves dist/ statically, opens harness/index.html in headless Chrome, and
// asserts:
//   1. the editor iframe loads and reports "editor-ready"
//   2. no WebSocket is ever constructed (in either frame)
//   3. the parent's RPC log shows the editor's startup calls
//   4. a programmatic node move through the editor's own API makes the
//      client issue editFinal
//   5. the editFinal change payload is structurally valid and targets the
//      edited glyph
//
// Usage: node harness/verify.mjs        (expects dist/ to be built)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/Users/agyei/Documents/avar2-studio/frontend/node_modules/playwright-core/index.mjs";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".csv": "text/csv",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (urlPath.endsWith("/")) {
        urlPath += "index.html";
      }
      const filePath = path.join(root, urlPath);
      if (!filePath.startsWith(root)) {
        throw new Error("path escape");
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = await serve(distDir);
const port = server.address().port;
console.log(`serving ${distDir} on http://127.0.0.1:${port}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push(`[${msg.location().url || "?"}] ${msg.text()}`);
  }
});
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.addInitScript(() => {
  window.__webSocketConstructions = [];
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args) {
      window.__webSocketConstructions.push(String(args[0]));
      return Reflect.construct(target, args);
    },
  });
});

let exitCode = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/harness/index.html`);

  // 1. editor iframe loads and becomes ready
  await page.waitForFunction(() => window.rpcLog !== undefined, null, { timeout: 15000 });
  const editorFrame = page.frame({ url: /editor\.html/ });
  check("editor iframe loaded", !!editorFrame, editorFrame?.url());

  await page.waitForFunction(
    () => window.rpcLog.some((r) => r.method === "isReadOnly"),
    null,
    { timeout: 30000 }
  );

  // editor-ready was posted (window.editorController set + start() finished)
  const editorReady = await editorFrame.evaluate(
    () => !!window.editorController?.fontController
  );
  check("editor-controller constructed and started", editorReady);

  // 2. no WebSocket constructed anywhere
  const wsMain = await page.evaluate(() => window.__webSocketConstructions);
  const wsFrame = await editorFrame.evaluate(() => window.__webSocketConstructions);
  check(
    "no WebSocket constructed",
    wsMain.length === 0 && wsFrame.length === 0,
    `main=${JSON.stringify(wsMain)} iframe=${JSON.stringify(wsFrame)}`
  );

  // 3. startup RPC calls seen by parent
  const rpcMethods = await page.evaluate(() => window.rpcLog.map((r) => r.method));
  const expected = ["getGlyphMap", "getAxes", "getSources", "getUnitsPerEm", "getCustomData", "getBackEndInfo", "isReadOnly"];
  const missing = expected.filter((m) => !rpcMethods.includes(m));
  check(
    "startup RPC calls observed",
    missing.length === 0,
    `seen: ${[...new Set(rpcMethods)].join(", ")}${missing.length ? ` MISSING: ${missing}` : ""}`
  );

  // 4. programmatic node move through the editor's own API:
  //    put "n" in the text, enter edit mode, select first node, nudge it.
  await editorFrame.evaluate(async () => {
    const ed = window.editorController;
    ed.sceneSettings.text = "n";
    await new Promise((resolve) => setTimeout(resolve, 200));
    ed.sceneSettings.selectedGlyph = { lineIndex: 0, glyphIndex: 0, isEditing: true };
  });
  await editorFrame.evaluate(async () => {
    const ed = window.editorController;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (
        ed.sceneSettings.selectedGlyphName === "n" &&
        ed.sceneModel.getSelectedPositionedGlyph()?.glyph?.canEdit
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `glyph did not enter edit mode: selectedGlyphName=${ed.sceneSettings.selectedGlyphName}`
    );
  });
  const getGlyphCalls = await page.evaluate(
    () => window.rpcLog.filter((r) => r.method === "getGlyph").length
  );
  check("getGlyph fetched over RPC", getGlyphCalls > 0, `${getGlyphCalls} calls`);

  await editorFrame.evaluate(async () => {
    const ed = window.editorController;
    ed.sceneController.selection = new Set(["point/0"]);
    await ed.sceneController.handleArrowKeys({
      key: "ArrowRight",
      preventDefault() {},
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  // 5. parent received editFinal with a structurally valid change payload
  await page.waitForFunction(() => window.editFinalLog.length > 0, null, { timeout: 10000 });
  const edit = await page.evaluate(() => window.editFinalLog[0]);
  const change = edit.change;
  // A change node is {p: [...]} plus either an operation (f, optional a) or
  // child changes (c). Child nodes inherit the parent path, so only the
  // top-level node must carry p.
  const isChangeNode = (node, isRoot) =>
    node &&
    (!isRoot || Array.isArray(node.p)) &&
    (typeof node.f === "string" || (Array.isArray(node.c) && node.c.length > 0)) &&
    (node.a === undefined || Array.isArray(node.a)) &&
    (node.c === undefined || (Array.isArray(node.c) && node.c.every((c) => isChangeNode(c, false))));
  const changeOk = isChangeNode(change, true);
  const prefixOk = changeOk && change.p[0] === "glyphs" && change.p[1] === "n";
  check("editFinal received with valid {p, f, a} payload", changeOk, JSON.stringify(change));
  check("editFinal change targets glyph 'n'", prefixOk, `p=${JSON.stringify(change?.p)}`);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  if (consoleErrors.length) {
    console.log("\nconsole errors seen (informational):");
    for (const line of consoleErrors.slice(0, 20)) {
      console.log("  " + line);
    }
  }
} catch (error) {
  check("gate completed without exceptions", false, String(error));
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  exitCode = 1;
}
console.log(exitCode === 0 ? "GATE: PASS" : "GATE: FAIL");
process.exit(exitCode);
