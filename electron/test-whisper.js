/* ============================================================
   TEST: Subtitle AI di Electron asli (app://)
   Cari titik gagal: 1) import CDN  2) pipeline Whisper
   Jalankan: xvfb + DISPLAY=:99 electron electron/test-whisper.js
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
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message) logs.push(`[c${d.level ?? "?"}] ${String(d.message).slice(0, 300)}`);
  });

  await win.loadURL("app://./index.html");

  /* ---- TES 1: import CDN seperti yang dilakukan whisper.ts ---- */
  const t1 = await win.webContents.executeJavaScript(
    `(async () => {
      const urls = [
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5",
        "https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.min.js",
      ];
      const out = [];
      for (const u of urls) {
        try {
          const fn = new Function("u", "return import(u)");
          const mod = await fn(u);
          out.push({ url: u, ok: true, keys: Object.keys(mod).slice(0, 6) });
        } catch (e) {
          out.push({ url: u, ok: false, err: String(e).slice(0, 200) });
        }
      }
      return out;
    })()`,
    true
  );
  console.log("\n=== TES 1: IMPORT CDN ===");
  console.log(JSON.stringify(t1, null, 2));

  const okMod = t1.find((x) => x.ok);
  if (!okMod) {
    console.log("\nVERDICT: ✗ SEMUA CDN GAGAL → Whisper mustahil jalan");
    for (const m of logs.slice(0, 20)) console.log(m);
    app.exit(0);
    return;
  }

  /* ---- TES 2: buat pipeline whisper-tiny (unduh model ±45 MB) ---- */
  console.log("\n=== TES 2: PIPELINE whisper-tiny (unduh model) ===");
  const t2 = await win.webContents.executeJavaScript(
    `(async () => {
      const fn = new Function("u", "return import(u)");
      const urls = [
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5",
        "https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.min.js",
      ];
      let T = null;
      for (const u of urls) {
        try { T = await fn(u); break; } catch {}
      }
      if (!T) return { ok: false, err: "modul tidak termuat" };
      try {
        const files = [];
        const pipe = await T.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
          dtype: "q8",
          progress_callback: (info) => {
            if (info.status === "progress") files.push(info.file);
          },
        });
        // tes transkripsi 1 detik audio senyap
        const pcm = new Float32Array(16000);
        const out = await pipe(pcm, { return_timestamps: true });
        return {
          ok: true,
          files: [...new Set(files)].length,
          text: String(out.text ?? "").slice(0, 40),
          cacheKeys: (await caches.keys()).join(","),
        };
      } catch (e) {
        return { ok: false, err: String(e).slice(0, 400) };
      }
    })()`,
    true,
    { timeout: 300000 }
  ).catch((e) => ({ ok: false, err: "executeJavaScript: " + e.message }));

  console.log(JSON.stringify(t2, null, 2));
  console.log("\n--- console renderer ---");
  for (const m of logs.slice(0, 25)) console.log(m);

  console.log(`\nVERDICT: ${t2.ok ? "✓ WHISPER JALAN DI ELECTRON" : "✗ WHISPER GAGAL — lihat err di atas"}`);
  app.exit(0);
});
