/* PROBE: import lokal transformers + ort mjs di halaman app:// */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

app.whenReady().then(async () => {
  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  };
  const requests = [];
  protocol.handle("app", async (request) => {
    try {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(OUT_DIR, p));
      if (!file.startsWith(OUT_DIR)) return new Response("forbidden", { status: 403 });
      const res = await net.fetch(pathToFileURL(file).toString());
      requests.push(`${res.status} ${new URL(request.url).pathname} (${res.headers.get("content-type")})`);
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

  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  await win.loadURL("app://./index.html");

  const out = await win.webContents.executeJavaScript(
    `(async () => {
      const r = {};
      // 1) runtime lokal
      try { const m = await import("/transformers.min.js"); r.runtime = "OK " + Object.keys(m).length + " exports"; }
      catch (e) { r.runtime = "FAIL " + e.message; }
      // 2) ort mjs non-jsep
      try { await import("/ort/ort-wasm-simd-threaded.mjs"); r.ortPlain = "OK"; }
      catch (e) { r.ortPlain = "FAIL " + e.message; }
      // 3) ort mjs jsep
      try { await import("/ort/ort-wasm-simd-threaded.jsep.mjs"); r.ortJsep = "OK"; }
      catch (e) { r.ortJsep = "FAIL " + e.message.slice(0, 80); }
      // 4) env + pipeline detail error
      try {
        const m = await import("/transformers.min.js");
        m.env.backends.onnx.wasm.wasmPaths = "/ort/";
        m.env.backends.onnx.wasm.numThreads = 1;
        m.env.allowLocalModels = true;
        m.env.localModelPath = "/models/";
        try {
          const pipe = await m.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { dtype: "q8" });
          r.pipeline = "OK";
          const o = await pipe(new Float32Array(16000), { return_timestamps: true });
          r.infer = String(o.text).slice(0, 30);
        } catch (e) { r.pipeline = "FAIL " + String(e.message).slice(0, 220); }
      } catch (e) { r.pipeline = "FAIL " + e.message; }
      return r;
    })()`,
    true
  );

  console.log(JSON.stringify(out, null, 2));
  console.log("--- request yang dilayani handler ---");
  for (const r of requests) console.log(r);
  app.exit(0);
});
