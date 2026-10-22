/* UJI: showDirectoryPicker di Electron headless — menggantung atau tidak? */
const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const OUT_DIR = path.join(__dirname, "..", "out");
app.setPath("userData", path.join(os.tmpdir(), "clipper-dlgtest-" + Date.now()));
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  protocol.handle("app", async (request) => {
    let p = decodeURIComponent(new URL(request.url).pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(OUT_DIR, p));
    if (!file.startsWith(OUT_DIR)) return new Response("x", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { preload: path.join(__dirname, "preload.js") } });
  await win.loadURL("app://./index.html");
  await sleep(2500);
  const r = await Promise.race([
    win.webContents.executeJavaScript(
      `(async () => {
        const out = { hasApi: typeof window.showDirectoryPicker === "function", activation: null, result: "" };
        try {
          out.activation = (navigator.userActivation || {}).hasBeenActive ?? "n/a";
        } catch {}
        if (!out.hasApi) { out.result = "no-api"; return out; }
        try {
          const h = await Promise.race([
            window.showDirectoryPicker({ mode: "readwrite" }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("DIALOG-HANG-8s")), 8000)),
          ]);
          out.result = "resolved:" + (h?.name ?? "?");
        } catch (e) {
          out.result = String(e.message || e).slice(0, 80);
        }
        return out;
      })()`,
      true
    ),
    new Promise((resolve) => setTimeout(() => resolve({ executeJS: "HANG" }), 15000)),
  ]);
  console.log("HASIL DIALOG:", JSON.stringify(r));
  app.exit(0);
});
