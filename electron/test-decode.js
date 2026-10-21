/* ============================================================
   TEST: decodeAudioData per format container di Electron asli
   Meniru persis decodeAudioFile() di src/lib/clipper/audio.ts
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
const MEDIA = path.join(__dirname, "..", "scripts", "testmedia");

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
  await win.loadURL("app://./index.html");

  const results = {};
  for (const name of ["a.mp4", "a.mkv", "a.webm", "a.ts"]) {
    const b64 = fs.readFileSync(path.join(MEDIA, name)).toString("base64");
    results[name] = await win.webContents.executeJavaScript(
      `(async () => {
        const b64 = "${b64}";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        try {
          const actx = new AudioContext();
          const buf = await actx.decodeAudioData(bytes.buffer);
          return { ok: true, dur: buf.duration.toFixed(2), ch: buf.numberOfChannels, sr: buf.sampleRate };
        } catch (e) {
          return { ok: false, err: String(e && e.message || e).slice(0, 120) };
        }
      })()`,
      true
    );
    console.log(`${name.padEnd(8)} → ${JSON.stringify(results[name])}`);
  }

  const fails = Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => k);
  console.log(`\nVERDICT: ${fails.length ? "✗ GAGAL decode: " + fails.join(", ") : "✓ semua format ter-decode"}`);
  app.exit(0);
});
