/* CLIPPER EDITOR — preload (jembatan aman renderer <-> main) */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipperDesktop", {
  isElectron: true,
  version: "1.2.5",
  onDownloadDone: (cb) => ipcRenderer.on("clipper-download-done", (_e, name) => cb(name)),
});
