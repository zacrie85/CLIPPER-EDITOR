/* DEBUG: apa yang terjadi saat OFFLINE? */
const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
app.setPath("userData", path.join(os.tmpdir(), "clipper-dbg-" + Date.now()));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
  const blocked = [];
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

  const win = new BrowserWindow({ width: 1560, height: 940, show: false });
  win.webContents.session.webRequest.onBeforeRequest((details, cb) => {
    const ext = !details.url.startsWith("app://") && !details.url.startsWith("blob:") && !details.url.startsWith("data:");
    if (ext) blocked.push(details.url.slice(0, 90));
    cb({ cancel: ext });
  });

  const logs = [];
  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message) logs.push(`[c${d.level}] ${String(d.message).slice(0, 150)}`);
  });

  await win.loadURL("app://./index.html");
  await sleep(10000);

  const state = await win.webContents.executeJavaScript(
    `(function () {
      try {
        return { hasNext: typeof window.next !== "undefined", ready: document.readyState,
                 len: String(document.body.innerText || "").length,
                 sample: String(document.body.innerText || "").slice(0, 200),
                 hasInput: !!document.querySelector('input[type="file"]') };
      } catch (e) { return { err: String(e) }; }
    })()`,
    true
  ).catch((e) => ({ jsErr: e.message }));

  console.log("STATE:", JSON.stringify(state, null, 2));
  console.log("--- diblokir (eksternal) ---");
  for (const b of blocked.slice(0, 10)) console.log(b);
  console.log("--- console renderer ---");
  for (const m of logs.slice(0, 15)) console.log(m);
  app.exit(0);
});
