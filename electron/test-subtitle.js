/* ============================================================
   TEST HEADLESS v1.2.3: WHISPER WORKER di protokol app://
   Membuktikan:
     1. whisper-worker.js termuat (module worker di app://)
     2. VAD membagi region suara/senyap dengan benar
     3. inferensi tiny (bundel offline) selesai → cues dikirim balik
     4. COOP/COEP aktif → crossOriginIsolated → WASM multithread
   Jalankan:
     Xvfb :99 -screen 0 1280x820x24 &
     DISPLAY=:99 node_modules/.bin/electron electron/test-subtitle.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
      const headers = new Headers(res.headers);
      const mime = MIME[path.extname(file).toLowerCase()];
      if (mime) headers.set("Content-Type", mime);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      return new Response(res.body, { status: res.status, headers });
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
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message) logs.push(`[c${d.level ?? "?"}] ${String(d.message).slice(0, 200)}`);
  });

  try {
    await win.loadURL("app://./index.html");
  } catch (e) {
    logs.push(`[load-error] ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 6000));

  const testJs = `(async () => {
    const sr = 16000;
    const pcm = new Float32Array(sr * 8);
    for (let i = 0; i < sr * 2.5; i++) pcm[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.5;
    for (let i = Math.floor(3.5 * sr); i < Math.floor(6.5 * sr); i++) pcm[i] = Math.sin(2 * Math.PI * 180 * i / sr) * 0.4;
    const msgs = [];
    const w = new Worker("whisper-worker.js", { type: "module" });
    const result = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("timeout 300s")), 300000);
      w.onmessage = (ev) => {
        const m = ev.data;
        const tag = m.type + (m.stage ? ":" + m.stage : "") + (typeof m.p === "number" ? ":" + Math.round(m.p * 100) + "%" : "");
        msgs.push(tag);
        if (m.type === "done") { clearTimeout(to); resolve(m); }
        if (m.type === "error") { clearTimeout(to); reject(new Error(m.message)); }
      };
      w.postMessage({ type: "run", pcm, model: "tiny", language: "id", task: "transcribe" }, [pcm.buffer]);
    });
    return {
      backend: result.backend,
      threads: result.threads,
      speechPct: result.speechPct,
      cueCount: result.cues.length,
      sample: result.cues.slice(0, 3).map((c) => c.start.toFixed(1) + "-" + c.end.toFixed(1) + " " + c.text.slice(0, 24)),
      isolated: self.crossOriginIsolated,
      gpuApi: !!navigator.gpu,
      tookSec: Math.round(result.tookSec),
      msgs: msgs.slice(-14),
    };
  })()`;

  let diag = {};
  try {
    diag = await win.webContents.executeJavaScript(testJs, true);
  } catch (e) {
    diag = { error: String(e.message || e).slice(0, 400) };
  }

  console.log("\n========== TEST WHISPER WORKER (app://) ==========");
  console.log(JSON.stringify(diag, null, 2));
  console.log("--- console renderer (terakhir) ---");
  for (const m of logs.slice(-10)) console.log(m);

  const ok = diag.backend && Array.isArray(diag.sample) && !diag.error;
  console.log(`\nVERDICT: ${ok ? "✓ WORKER SUBTITLE HIDUP (inferensi selesai)" : "✗ GAGAL"}`);
  app.exit(ok ? 0 : 1);
});
