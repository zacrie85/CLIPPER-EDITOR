/* ============================================================
   CLIPPER EDITOR — Electron main process
   Mode dev : load http://localhost:3000
   Mode prod: load build statik dari ../out via protokol app://

   ⚠️ PENTING: build statik Next.js memakai path absolut (/\_next/…).
   Kalau dimuat via loadFile (file://), path itu resolve ke root drive
   (file:///C:/\_next/…) → CSS & JS gagal → LAYAR HITAM.
   Solusi: protokol kustom app:// yang memetakan /\_next/… ke folder out/.
   ============================================================ */

const { app, BrowserWindow, shell, Menu, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");

// protokol kustom — WAJIB didaftarkan sebelum app ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // wajib utk WebAssembly.instantiateStreaming (Whisper)
      codeCache: true,
    },
  },
]);

const isDev = !app.isPackaged;
let win = null;

/* v1.2.4 — dulu ada switch "enable-unsafe-webgpu" + "WebGPUAllowUnsafeAPIs".
   Itu MEMAKSA enumerasi WebGPU di hardware/driver yang tidak didukung —
   penyebab dugaan utama GPU process crash → jendela BLANK saat tombol
   transkripsi ditekan. WebGPU di Chromium/Electron 44 sudah stabil & aktif
   default di Windows; worker tetap probe dengan batas waktu + fallback WASM. */

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#08080a",
    title: "CLIPPER EDITOR",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // WebCodecs + akselerasi GPU video
      backgroundThrottling: false,
    },
  });

  // izinkan unduhan tanpa dialog tambahan (tetap pakai dialog bawaan Chromium)
  win.webContents.session.on("will-download", (_e, item) => {
    item.once("done", (_ev, state) => {
      if (state === "completed") {
        win?.webContents.send("clipper-download-done", item.getFilename());
      }
    });
  });

  // buka link eksternal di browser default
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    win.loadURL("http://localhost:3000");
  } else {
    win.loadURL("app://./index.html");
    // server statik tidak ada — fetch model AI tetap lewat internet saat pertama
  }

  win.once("ready-to-show", () => win.show());

  /* v1.2.4 — PEMULIHAN CRASH: dulu renderer mati (mis. OOM decode video
     panjang) = jendela BLANK permanen, semua menu mati — persis laporan bug.
     Kini: renderer yang mati otomatis dimuat ulang (maks 3× per menit)
     sehingga aplikasi pulih sendiri alih-alih blank selamanya. */
  let reloads = [];
  win.webContents.on("render-process-gone", (_e, details) => {
    const now = Date.now();
    reloads = reloads.filter((t) => now - t < 60_000);
    console.error("[main] renderer gone:", details.reason, details.exitCode);
    if (reloads.length >= 3) return; // cegah loop reload tak berujung
    reloads.push(now);
    setTimeout(() => {
      try {
        if (win && !win.isDestroyed()) win.webContents.reload();
      } catch { /* abaikan */ }
    }, 1200);
  });
  app.on("child-process-gone", (_e, details) => {
    // GPU process mati dicatat — Chromium biasanya pulih sendiri
    if (details.type === "GPU") console.error("[main] GPU process gone:", details.reason);
  });
}

app.whenReady().then(() => {
  // MIME wajib eksplisit — net.fetch(file://) tidak mengenali .mjs/.wasm,
  // padahal modul ES butuh text/javascript & WASM butuh application/wasm
  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".map": "application/json",
    ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  };

  // handler app:// — layani file dari out/; path absolut /\_next/… resolve
  // ke app://./\_next/… karena scheme diberi privileges "standard"
  protocol.handle("app", async (request) => {
    try {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(OUT_DIR, p));
      // cegah path traversal keluar folder out/
      if (!file.startsWith(OUT_DIR)) {
        return new Response("forbidden", { status: 403 });
      }
      const res = await net.fetch(pathToFileURL(file).toString());
      const mime = MIME[path.extname(file).toLowerCase()];
      const headers = new Headers(res.headers);
      if (mime) headers.set("Content-Type", mime);
      // COOP/COEP → crossOriginIsolated = true → SharedArrayBuffer aktif
      // → WASM ONNX memakai SEMUA core CPU (sebelumnya terkunci 1 thread = lambat)
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      if (res.ok) {
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
