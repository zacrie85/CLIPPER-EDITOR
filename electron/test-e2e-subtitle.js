/* ============================================================
   TEST E2E SUBTITLE AI — drive UI asli di Electron:
   impor video → tab SUBTITLE AI → MULAI TRANSKRIPSI LOKAL
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
const VIDEO = path.join(__dirname, "..", "scripts", "testmedia", "speech.mp4");
const FRESH = !!process.env.FRESH;      // profil kosong — simulasi user pertama kali
const OFFLINE = !!process.env.OFFLINE;  // blokir semua request eksternal
const MODEL = process.env.MODEL || "tiny"; // model yang dipilih di UI

if (FRESH) {
  app.setPath("userData", path.join(os.tmpdir(), "clipper-test-fresh-" + Date.now()));
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    width: 1560,
    height: 940,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  if (OFFLINE) {
    // blokir semua request eksternal (simulasi tanpa internet)
    win.webContents.session.webRequest.onBeforeRequest(
      (details, cb) => cb({ cancel: !details.url.startsWith("app://") && !details.url.startsWith("blob:") && !details.url.startsWith("data:") && !details.url.startsWith("file:") })
    );
  }

  const logs = [];
  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message && !String(d.message).includes("Security Warning")) {
      const src = d.sourceId ? ` @${String(d.sourceId).split("/").pop()}:${d.lineNumber ?? "?"}` : "";
      logs.push(`[c${d.level}] ${String(d.message).slice(0, 160)}${src}`);
    }
  });

  await win.loadURL("app://./index.html");
  await sleep(4000);

  // 1) impor video via input[type=file] — tunggu sampai input siap (maks 30 dtk)
  const b64 = fs.readFileSync(VIDEO).toString("base64");
  let imported = { ok: false, err: "timeout menunggu input" };
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    imported = await win.webContents.executeJavaScript(
      `(async () => {
        const input = document.querySelector('input[type="file"]');
        if (!input) return { ok: false, err: "input file tidak ditemukan" };
        const bin = atob("${b64}");
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], "speech.mp4", { type: "video/mp4" });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      })()`,
      true
    );
    if (imported.ok) break;
  }
  console.log("impor:", JSON.stringify(imported));
  if (!imported.ok) { app.exit(1); return; }

  let mediaOk = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    mediaOk = await win.webContents.executeJavaScript(
      `document.body.innerText.includes("KOTAK MEDIA (1)")`, true);
    if (mediaOk) break;
  }
  console.log("media terdaftar:", mediaOk);

  // 2) buka tab SUBTITLE AI
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll("button")].find(b => b.textContent.includes("SUBTITLE AI"))?.click()`,
    true
  );
  await sleep(800);

  // 2b) pilih model bila bukan default tiny
  if (MODEL !== "tiny") {
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "${MODEL.toUpperCase()}")?.click()`,
      true
    );
    await sleep(400);
  }

  // 3) klik MULAI TRANSKRIPSI LOKAL
  const clicked = await win.webContents.executeJavaScript(
    `(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.textContent.includes("MULAI TRANSKRIPSI"));
      if (!btn) return { ok: false, err: "tombol tidak ada" };
      if (btn.disabled) return { ok: false, err: "tombol disabled" };
      btn.click();
      return { ok: true };
    })()`,
    true
  );
  console.log("klik transkripsi:", JSON.stringify(clicked));

  // 4) pantau (maks 6 menit) — polling sederhana & tahan error
  let last = "";
  let st = {};
  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    try {
      st = await win.webContents.executeJavaScript(
        `(function () {
          try {
            var text = String(document.body.innerText || "");
            var g = text.indexOf("gagal");
            var failLine = g >= 0 ? text.slice(Math.max(0, g - 40), g + 120) : null;
            var s = text.indexOf("Mengunduh");
            var s2 = text.indexOf("Mengekstrak");
            var s3 = text.indexOf("Transkripsi berjalan");
            var stage = s >= 0 ? "MENGUNDUH MODEL" : s2 >= 0 ? "EKSTRAK AUDIO" : s3 >= 0 ? "PROSES" : null;
            return { href: location.href.slice(0, 30), rs: document.readyState,
                     len: text.length,
                     cues: text.indexOf("BAKAR KE VIDEO") >= 0,
                     fail: failLine ? failLine.slice(0, 170) : null,
                     stage: stage };
          } catch (e) { return { innerErr: String(e) }; }
        })()`,
        true
      );
    } catch (e) {
      st = { jsErr: String(e.message).slice(0, 100) };
    }
    const line = JSON.stringify(st);
    if (line !== last) {
      console.log("[" + i * 3 + "s]", line);
      last = line;
    }
    if (st.cues || st.fail) break;
  }

  console.log("\nFINAL:", JSON.stringify(st));
  console.log("--- console renderer ---");
  for (const m of logs.slice(0, 20)) console.log(m);
  console.log("\nVERDICT: " + (st.cues ? "✓ SUBTITLE AI JALAN E2E" : "✗ GAGAL E2E — lihat fail di atas"));
  app.exit(0);
});
