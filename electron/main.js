/* ============================================================
   CLIPPER EDITOR — Electron main process
   Mode dev : load http://localhost:3000
   Mode prod: load build statik dari ../out (next build + export)
   ============================================================ */

const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");

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
    win.loadFile(path.join(__dirname, "../out/index.html"));
    // server statik tidak ada — fetch model AI tetap lewat internet saat pertama
  }

  win.once("ready-to-show", () => win.show());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
