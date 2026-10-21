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
}

app.whenReady().then(() => {
  // handler app:// — layani file dari out/; path absolut /\_next/… resolve
  // ke app://./\_next/… karena scheme diberi privileges "standard"
  protocol.handle("app", (request) => {
    try {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p === "/" || p === "") p = "/index.html";
      const file = path.normalize(path.join(OUT_DIR, p));
      // cegah path traversal keluar folder out/
      if (!file.startsWith(OUT_DIR)) {
        return new Response("forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(file).toString());
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
