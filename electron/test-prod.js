/* ============================================================
   TEST HEADLESS: bukti fix layar hitam
   LOAD_MODE=file → cara LAMA (loadFile, bug)
   LOAD_MODE=app  → cara BARU (app://, fix)
   Jalankan: LOAD_MODE=app xvfb-run -a electron electron/test-prod.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODE = process.env.LOAD_MODE || "app";
const OUT_DIR = path.join(__dirname, "..", "out");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

app.whenReady().then(async () => {
  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".map": "application/json",
    ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
    ".ico": "image/x-icon", ".txt": "text/plain",
  };
  protocol.handle("app", async (request) => {
    try {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(OUT_DIR, p));
      if (!file.startsWith(OUT_DIR)) return new Response("forbidden", { status: 403 });
      const res = await net.fetch(pathToFileURL(file).toString());
      const mime = MIME[path.extname(file).toLowerCase()];
      if (mime && res.ok) {
        const headers = new Headers(res.headers);
        headers.set("Content-Type", mime);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  const logs = [];
  win.webContents.on("console-message", (...args) => {
    // Electron >= 30: (event, level, message, line, sourceId) | terbaru: (event, details)
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message) logs.push(`[c${d.level ?? "?"}] ${String(d.message).slice(0, 220)}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) =>
    logs.push(`[fail-load] ${code} ${desc} ${url}`)
  );

  try {
    if (MODE === "file") await win.loadFile(path.join(OUT_DIR, "index.html"));
    else await win.loadURL("app://./index.html");
  } catch (e) {
    logs.push(`[load-error] ${e.message}`);
  }

  // tunggu hidrasi React
  await new Promise((r) => setTimeout(r, 8000));

  let diag = {};
  try {
    diag = await win.webContents.executeJavaScript(
      `({
        href: location.href,
        ready: document.readyState,
        hasNext: typeof window.next !== "undefined",
        styleSheets: document.styleSheets.length,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyTextLen: (document.body.innerText || "").trim().length,
        bodySample: (document.body.innerText || "").trim().slice(0, 140).replace(/\\n+/g, " | "),
        interactive: !!document.querySelector("button, input, [role='button']"),
        scripts: document.scripts.length,
      })`,
      true
    );
  } catch (e) {
    diag = { error: e.message };
  }

  console.log(`\n================ MODE: ${MODE} ================`);
  console.log(JSON.stringify(diag, null, 2));
  console.log("--- event/console ---");
  for (const m of logs.slice(0, 18)) console.log(m);

  // verdict
  const ok = diag.hasNext === true && diag.styleSheets > 0;
  console.log(`\nVERDICT ${MODE}: ${ok ? "✓ APP HIDUP (JS+CSS termuat)" : "✗ MATI (layar hitam)"}`);
  app.exit(0);
});
