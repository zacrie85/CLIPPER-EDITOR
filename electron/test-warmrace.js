/* REPRO v1.2.8 — race warm + run di whisper worker?
   A: warm lalu run SEGERA (3 dtk) — dugaan: gagal fetch model
   B: warm lalu run SETELAH warm-ok — dugaan: sukses
   C: run tanpa warm — kontrol
   Jalankan: DISPLAY=:99 npx electron electron/test-warmrace.js
*/
const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
app.setPath("userData", path.join(os.tmpdir(), "clipper-warmrace-" + Date.now()));
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".json": "application/json" };
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
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    } catch { return new Response("nf", { status: 404 }); }
  });

  const win = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { preload: path.join(__dirname, "preload.js") } });
  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message && !/No available adapters|content-length/.test(String(d.message))) {
      console.log("[c]", String(d.message).slice(0, 150));
    }
  });
  await win.loadURL("app://./index.html");
  await sleep(3000);

  const scenario = process.env.SCEN || "A";

  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const sr = 16000;
      const pcm = new Float32Array(sr * 3);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.3;
      const w = new Worker("whisper-worker.js", { type: "module" });
      const t0 = performance.now();
      const log = [];
      const run = new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("timeout 240s")), 240000);
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "stage") log.push("stage:" + String(m.stage).slice(0, 40));
          if (m.type === "warm-ok") log.push("WARM-OK " + Math.round(performance.now() - t0) + "ms");
          if (m.type === "warm-fail") log.push("WARM-FAIL: " + String(m.message).slice(0, 100));
          if (m.type === "done") { clearTimeout(to); resolve({ cues: m.cues.length, backend: m.backend }); }
          if (m.type === "error") { clearTimeout(to); reject(new Error(String(m.message).slice(0, 180))); }
        };
      });
      if ("${scenario}" === "A") { w.postMessage({ type: "warm", model: "tiny", gpu: "auto" }); setTimeout(() => w.postMessage({ type: "run", pcm, model: "tiny", language: "id", task: "transcribe" }, [pcm.buffer]), 3000); }
      if ("${scenario}" === "B") { w.postMessage({ type: "warm", model: "tiny", gpu: "auto" }); setTimeout(() => w.postMessage({ type: "run", pcm, model: "tiny", language: "id", task: "transcribe" }, [pcm.buffer]), 45000); }
      if ("${scenario}" === "C") { w.postMessage({ type: "run", pcm, model: "tiny", language: "id", task: "transcribe" }, [pcm.buffer]); }
      try {
        const r = await run;
        return { ok: true, ms: Math.round(performance.now() - t0), log: log.slice(-6), ...r };
      } catch (e) {
        return { ok: false, ms: Math.round(performance.now() - t0), err: String(e.message || e).slice(0, 180), log: log.slice(-6) };
      }
    })()`,
    true
  );
  console.log(`HASIL SKENARIO ${scenario}:`, JSON.stringify(result, null, 1));
  app.exit(0);
});
