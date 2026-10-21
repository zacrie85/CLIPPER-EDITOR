/* ============================================================
   TEST HEADLESS v1.2.7 — ISOLASI UNDUHAN BLOB
   Pertanyaan: apakah unduhan anchor+blob:URL Chromium/Electron
   ini gagal (0 MB, interrupted) di ukuran tertentu DI LINGKUNGAN
   INI — terlepas dari kode aplikasi?
   Uji: blob 5, 8, 12, 14, 16 MB → a.download → will-download.
   Jalankan:
     Xvfb :99 -screen 0 1280x820x24 &
     DISPLAY=:99 npx electron electron/test-blob.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
const DL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clipper-blob-"));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

app.whenReady().then(async () => {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
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
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  const win = new BrowserWindow({ width: 1000, height: 700, show: false });
  const downloads = [];
  win.webContents.session.on("will-download", (_e, item) => {
    const target = path.join(DL_DIR, item.getFilename().replace(/[^\w.\-]+/g, "_"));
    item.setSavePath(target);
    console.log(`[dl-start] ${item.getFilename()} · totalBytes=${item.getTotalBytes()} · mime=${item.getMimeType()}`);
    item.once("done", (_ev, state) => {
      let size = 0;
      try { size = fs.statSync(target).size; } catch {}
      downloads.push({ name: item.getFilename(), state, size });
      console.log(`[unduhan] ${item.getFilename()} · ${state} · ${(size / 1048576).toFixed(2)} MB`);
    });
  });

  await win.loadURL("app://./index.html");
  await new Promise((r) => setTimeout(r, 3000));

  // buat blob ukuran MB berbeda → unduh berurutan, tunggu tiap unduhan
  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const sizes = [5, 8, 12, 14, 16, 24];
      const out = [];
      for (const mb of sizes) {
        const buf = new Uint8Array(mb * 1024 * 1024);
        crypto.getRandomValues(buf.subarray(0, 1024)); // sebagian acak
        const blob = new Blob([buf], { type: "video/mp4" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "probe_" + mb + "mb.mp4";
        document.body.appendChild(a);
        a.click();
        a.remove();
        out.push({ mb, urlLen: a.href.length, blobSize: blob.size });
        await new Promise((r) => setTimeout(r, 2500));
      }
      return out;
    })()`,
    true
  );
  console.log("blob dibuat:", JSON.stringify(result));

  // tunggu semua unduhan selesai
  for (let i = 0; i < 30 && downloads.length < result.length; i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 2000));

  console.log("\n=== RINGKASAN ===");
  let allOk = true;
  for (const d of downloads) {
    const expectMB = parseInt(d.name.match(/(\d+)mb/)?.[1] ?? "0", 10);
    const ok = d.state === "completed" && Math.abs(d.size / 1048576 - expectMB) < 0.1;
    if (!ok) allOk = false;
    console.log(`${ok ? "✓" : "✗"} ${d.name} · ${d.state} · ${(d.size / 1048576).toFixed(2)} MB`);
  }
  console.log(`\nVERDICT: ${allOk ? "✓ SEMUA UKURAN BLOB TERUNDUH UTUH" : "✗ ADA UKURAN BLOB GAGAL — batas Chromium terkonfirmasi"}`);
  app.exit(allOk ? 0 : 1);
});
