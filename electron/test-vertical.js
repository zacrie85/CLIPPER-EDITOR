/* ============================================================
   TEST E2E VERTIKAL 9:16 SEJATI (v1.2.9) — keluhan user:
   "hasil video AI MOMEN tidak jadi vertikal 9:16 … maksud
   zoom = potong kiri & kanannya sehingga fokus ke pembicara"

   Yang diuji (video sumber 640×360 LANDSCAPE):
   A. outputDims — mode AUTO 100% kini MENGHORMATI rasio:
      9:16 → teks OUTPUT di panel ekspor = 360×640 (portrait)
      dulu: 640×360 (landscape — bug, rasio diabaikan)
   B. outputDims — resolusi tetap 1080p + 9:16 = 1080×1920
   C. Panel AI MOMEN → ANALISIS MOMEN VIRAL → EKSPOR SEMUA:
      - job.settings.aspect dipaksa "9:16"
      - zoom pembicara otomatis (job.auto.speaker = true)
      - file hasil BENAR-BENAR PORTRAIT (ffprobe: h > w)
   Jalankan:
     Xvfb :99 -screen 0 1600x900x24 &
     DISPLAY=:99 npx electron electron/test-vertical.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const OUT_DIR = path.join(__dirname, "..", "out");
const VIDEO = path.join(__dirname, "..", "scripts", "testmedia", "speech15.mp4");
const DL_DIR = path.join(os.tmpdir(), "clipper-vertical-dl-" + Date.now());
fs.mkdirSync(DL_DIR, { recursive: true });

app.setPath("userData", path.join(os.tmpdir(), "clipper-test-vert-" + Date.now()));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ffprobe → { w, h } video stream pertama */
function probe(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  ).trim();
  const [w, h] = out.split(",").map((n) => parseInt(n, 10));
  return { w, h };
}

app.whenReady().then(async () => {
  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".map": "application/json",
    ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
    ".onnx": "application/octet-stream", ".ico": "image/x-icon", ".txt": "text/plain",
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
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  const win = new BrowserWindow({
    width: 1560, height: 940, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
  });

  const downloads = [];
  win.webContents.session.on("will-download", (_e, item) => {
    const safe = item.getFilename().replace(/[^\w.\- ]+/g, "_");
    const target = path.join(DL_DIR, safe);
    item.setSavePath(target);
    item.once("done", (_ev, state) => {
      let ok = false, size = 0, dims = null;
      try {
        size = fs.statSync(target).size;
        const fd = fs.openSync(target, "r");
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        ok = state === "completed" && size > 1024 && buf.includes("ftyp");
        if (ok) dims = probe(target);
      } catch (e) { ok = false; dims = { err: String(e).slice(0, 80) }; }
      downloads.push({ name: item.getFilename(), state, size, mp4: ok, dims });
      console.log(`[unduhan] ${item.getFilename()} · ${state} · ${(size / 1048576).toFixed(2)} MB · MP4=${ok} · DIMS=${JSON.stringify(dims)}`);
    });
  });

  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message && !/Security Warning|content-length|No available adapters/.test(String(d.message))) {
      console.log(`[c${d.level}] ${String(d.message).slice(0, 160)}`);
    }
  });
  win.webContents.on("render-process-gone", (_e, d) => console.error("[FATAL] renderer gone:", d.reason, d.exitCode));

  await win.loadURL("app://./index.html");
  await sleep(4000);

  const click = async (label, max = 5) => {
    let last = { ok: false, err: "belum dicoba" };
    for (let a = 0; a < max; a++) {
      last = await win.webContents.executeJavaScript(
        `(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!b) return { ok:false, err:"tombol tidak ada: ${label}" }; if (b.disabled) return { ok:false, err:"tombol disabled: ${label}" }; b.click(); return { ok:true }; })()`,
        true
      );
      if (last.ok) return last;
      await sleep(800);
    }
    return last;
  };

  const store = async () =>
    win.webContents.executeJavaScript(
      `(function(){ try { var s = window.__clipper.getState(); return { media: s.media.length, sel: s.selectedId, aspect: s.settings.export.aspect, autoMode: s.settings.export.autoMode, moments: (s.moments[s.selectedId]||[]).length, jobs: s.jobs.map(function(j){ return { name:j.name, target:j.target, aspect: j.settings && j.settings.aspect, auto: j.auto || null, status:j.status, pct: Math.round(j.progress*100), stage: String(j.stage).slice(0,90), error: j.error ? String(j.error).slice(0,140) : null }; }) }; } catch(e){ return { err: String(e) }; } })()`,
      true
    );

  const outputText = async () =>
    win.webContents.executeJavaScript(
      `(function(){ var m = String(document.body.innerText).match(/OUTPUT:\\s*([0-9]+×[0-9]+)/); return m ? m[1] : null; })()`,
      true
    );

  /* ---------- 1) IMPOR ---------- */
  const b64 = fs.readFileSync(VIDEO).toString("base64");
  let imported = { ok: false };
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    imported = await win.webContents.executeJavaScript(
      `(async () => {
        const input = document.querySelector('input[type="file"]');
        if (!input) return { ok: false };
        const bin = atob("${b64}");
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], "speech15.mp4", { type: "video/mp4" });
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
  if (!imported.ok) { console.log("VERDICT: ✗ IMPOR GAGAL"); app.exit(1); return; }
  let s = {};
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    s = await store();
    if (s.media === 1) break;
  }
  console.log("media terdaftar:", JSON.stringify({ media: s.media, aspect: s.aspect }));
  if (s.media !== 1) { console.log("VERDICT: ✗ MEDIA TAK TERDAFTAR"); app.exit(1); return; }

  // mode UNDUHAN (headless tak bisa menjawab dialog folder)
  await win.webContents.executeJavaScript(`localStorage.setItem("clipper-save-mode", "download")`, true);

  /* ---------- 2) TES A: AUTO 100% + 9:16 → portrait ---------- */
  await win.webContents.executeJavaScript(
    `window.__clipper.getState().patchExport({ autoMode: true, scale: 100, aspect: "9:16" })`, true
  );
  await win.webContents.executeJavaScript(`window.__clipper.getState().setTab("export")`, true);
  await sleep(900);
  const outA = await outputText();
  console.log(`TES A — AUTO 100% + 9:16 → OUTPUT teks = ${outA} (harap 360×640, dulu bug = 640×360)`);
  const tesA = outA === "360×640";

  /* ---------- 3) TES B: resolusi tetap 1080p + 9:16 ---------- */
  await win.webContents.executeJavaScript(
    `window.__clipper.getState().patchExport({ autoMode: false, resolution: "1080p", aspect: "9:16" })`, true
  );
  await sleep(900);
  const outB = await outputText();
  console.log(`TES B — 1080p + 9:16 → OUTPUT teks = ${outB} (harap 1080×1920)`);
  const tesB = outB === "1080×1920";

  /* ---------- 4) TES C: panel AI MOMEN → ekspor semua → portrait ---------- */
  await win.webContents.executeJavaScript(`window.__clipper.getState().setTab("moments")`, true);
  await sleep(700);
  const clickedAn = await click("ANALISIS MOMEN VIRAL");
  console.log("klik ANALISIS MOMEN VIRAL:", JSON.stringify(clickedAn));
  let moments = 0;
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) { // maks 4 menit
    await sleep(4000);
    s = await store();
    moments = s.moments || 0;
    if (moments > 0) break;
  }
  console.log(`momen ditemukan: ${moments} (${Math.round((Date.now() - t0) / 1000)}s)`);
  if (!moments) { console.log(`VERDICT: ✗ TIDAK ADA MOMEN — A=${tesA} B=${tesB}`); app.exit(1); return; }

  const clickedExp = await click("EKSPOR SEMUA");
  console.log("klik EKSPOR SEMUA:", JSON.stringify(clickedExp));
  if (!clickedExp.ok) { console.log(`VERDICT: ✗ TOMBOL EKSPOR SEMUA — A=${tesA} B=${tesB}`); app.exit(1); return; }

  // pantau antrean sampai semua job selesai
  let last = "";
  let done = false;
  const t1 = Date.now();
  let jobInfo = null;
  for (let i = 0; i < 240; i++) { // maks ±16 menit (YOLOS wasm di VM)
    await sleep(4000);
    s = await store();
    jobInfo = (s.jobs || []).find((j) => (j.name || "").startsWith("momen_")) || (s.jobs || [])[0] || null;
    const line = jobInfo ? `${jobInfo.status} ${jobInfo.pct}% ${jobInfo.stage}` : "(tanpa job)";
    if (line !== last) { console.log(`[${Math.round((Date.now() - t1) / 1000)}s] JOB: ${line}`); last = line; }
    if (jobInfo && (jobInfo.status === "done" || jobInfo.status === "error" || jobInfo.status === "canceled")) { done = true; break; }
  }
  if (!done) { console.log(`VERDICT: ✗ JOB TIMEOUT — A=${tesA} B=${tesB}`); app.exit(1); return; }
  console.log("job akhir:", JSON.stringify(jobInfo));
  await sleep(2500); // beri waktu event will-download selesai

  const jobAspect = jobInfo && jobInfo.aspect;
  const jobSpeaker = !!(jobInfo && jobInfo.auto && jobInfo.auto.speaker);
  console.log(`job.settings.aspect = ${jobAspect} (harap 9:16) · job.auto.speaker = ${jobSpeaker} (harap true)`);

  // verifikasi semua unduhan portrait
  const files = downloads.filter((d) => d.mp4 && /\.mp4$/i.test(d.name));
  let allPortrait = files.length > 0;
  for (const f of files) {
    const portrait = f.dims && f.dims.h > f.dims.w;
    console.log(`  ${f.name}: ${f.dims ? `${f.dims.w}×${f.dims.h}` : "?"} → ${portrait ? "PORTRAIT ✓" : "BUKAN PORTRAIT ✗"}`);
    if (!portrait) allPortrait = false;
  }

  const tesC = jobAspect === "9:16" && jobSpeaker && allPortrait && jobInfo.status === "done";
  const verdict = tesA && tesB && tesC
    ? "✓✓✓ VERTIKAL 9:16 SEJATI — AUTO hormat rasio + AI MOMEN dipaksa 9:16 + hasil PORTRAIT + zoom pembicara jalan"
    : `✗ GAGAL — A(AUTO portrait)=${tesA} B(1080p portrait)=${tesB} C(momen 9:16+speaker+file portrait)=${tesC}`;
  console.log("VERDICT:", verdict);
  app.exit(verdict.startsWith("✓") ? 0 : 1);
});
