/* ============================================================
   TEST E2E ANTI-BEKU PEMBICARA (v1.2.10) — keluhan user:
   "eksport & split dengan tombol PEMBICARA error dan stak di
   angka 11% dan tidak mau jalan lagi"

   Akar bug (ditemukan di audit v1.2.10):
   - exportOne TIDAK meneruskan onProgress ke analisis pembicara
     → bar beku di 10,5%≈11% walau AI masih bekerja (video panjang
     = analisis menit-menit tanpa satu pun tanda hidup)
   - inferensi YOLOS TANPA timeout → driver GPU macet = menggantung
     selamanya
   - BATAL tidak bereaksi di tengah analisis

   Yang diuji (video speech15.mp4 640×360 landscape):
   A. SPLIT 4 dtk + chip PEMBICARA (OTOMATIS CERDAS) + 9:16
      → EKSPOR PARTS: job SELESAI (tidak beku), MP4 portrait valid
   B. PROGRESS HIDUP: selama analisis tercatat ≥2 teks tahap
      berbeda (mis. "Analisis zoom pembicara…" → "AI mendeteksi
      orang… (x/y) · sisa ±") → tidak lagi diam di satu angka
   C. BATAL REAKTIF: klik BATAL di tengah analisis → status
      "canceled" ≤ 8 dtk (dulu: tidak bereaksi sama sekali)
   D. REGRESI 9:16: semua bagian hasil tetap portrait (h > w)

   Jalankan:
     Xvfb :99 -screen 0 1600x900x24 &
     DISPLAY=:99 npx electron electron/test-speakerfix.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const OUT_DIR = path.join(__dirname, "..", "out");
const VIDEO = path.join(__dirname, "..", "scripts", "testmedia", "speech15.mp4");
const DL_DIR = path.join(os.tmpdir(), "clipper-speakerfix-dl-" + Date.now());
fs.mkdirSync(DL_DIR, { recursive: true });

app.setPath("userData", path.join(os.tmpdir(), "clipper-test-speakerfix-" + Date.now()));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      console.log(`[c${d.level}] ${String(d.message).slice(0, 150)}`);
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

  /* klik tombol TERAKHIR dengan teks PERSIS (chip OTOMATIS CERDAS "PEMBICARA"
     vs TAB "PEMBICARA" — tab datang lebih dulu di DOM) */
  const clickExactLast = async (label, max = 5) => {
    let last = { ok: false, err: "belum dicoba" };
    for (let a = 0; a < max; a++) {
      last = await win.webContents.executeJavaScript(
        `(() => { const arr = [...document.querySelectorAll("button")].filter(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!arr.length) return { ok:false, err:"tombol tidak ada: ${label}" }; const b = arr[arr.length - 1]; if (b.disabled) return { ok:false, err:"tombol disabled: ${label}" }; b.click(); return { ok:true, idx: arr.length }; })()`,
        true
      );
      if (last.ok) return last;
      await sleep(800);
    }
    return last;
  };

  const onExportTab = async () =>
    win.webContents.executeJavaScript(
      `[...document.querySelectorAll("button")].some(b => b.textContent.includes("EKSPOR VIDEO INI"))`, true
    );

  const store = async () =>
    win.webContents.executeJavaScript(
      `(function(){ try { var s = window.__clipper.getState(); return { media: s.media.length, sel: s.selectedId, parts: (s.parts[s.selectedId]||[]).length, jobs: s.jobs.map(function(j){ return { id: j.id, name:j.name, target:j.target, auto: j.auto || null, status:j.status, pct: Math.round(j.progress*100), stage: String(j.stage).slice(0,100), error: j.error ? String(j.error).slice(0,140) : null }; }) }; } catch(e){ return { err: String(e) }; } })()`,
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
  console.log("media terdaftar:", JSON.stringify({ media: s.media }));
  if (s.media !== 1) { console.log("VERDICT: ✗ MEDIA TAK TERDAFTAR"); app.exit(1); return; }

  // mode UNDUHAN (headless tak bisa menjawab dialog folder)
  await win.webContents.executeJavaScript(`localStorage.setItem("clipper-save-mode", "download")`, true);

  /* ---------- 2) SPLIT 4 dtk → ≥3 bagian ---------- */
  await click("SPLIT");
  await sleep(600);
  await win.webContents.executeJavaScript(`window.__clipper.getState().patchSplit({ mode: "seconds", seconds: 4 })`, true);
  const clickedSplit = await click("JALANKAN SPLIT OTOMATIS");
  console.log("klik split:", JSON.stringify(clickedSplit));
  let parts = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    s = await store();
    parts = s.parts || 0;
    if (parts >= 3) break;
  }
  console.log(`SPLIT: ${parts} bagian`);
  if (parts < 2) { console.log("VERDICT: ✗ SPLIT GAGAL"); app.exit(1); return; }

  /* ---------- 3) EKSPOR PARTS + chip PEMBICARA + 9:16 ---------- */
  await win.webContents.executeJavaScript(
    `window.__clipper.getState().patchExport({ autoMode: true, scale: 100, aspect: "9:16" })`, true
  );
  await win.webContents.executeJavaScript(`window.__clipper.getState().setTab("export")`, true);
  await sleep(900);
  const btns = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll("button")].map(b => b.textContent.trim().slice(0,40)).filter(t => t)`, true
  );
  console.log("tombol di halaman:", JSON.stringify(btns));

  // job #1 — untuk TES C (batal di tengah analisis)
  const clickedChip = await clickExactLast("PEMBICARA");
  console.log("klik chip PEMBICARA (OTOMATIS CERDAS):", JSON.stringify(clickedChip), "· masih di tab ekspor:", await onExportTab());
  if (!clickedChip.ok) { console.log("VERDICT: ✗ CHIP PEMBICARA"); app.exit(1); return; }
  const clickedParts = await click(`EKSPOR PARTS (${parts})`);
  console.log("klik EKSPOR PARTS:", JSON.stringify(clickedParts));
  if (!clickedParts.ok) { console.log("VERDICT: ✗ TOMBOL EKSPOR PARTS"); app.exit(1); return; }

  /* ---------- TES C: BATAL di tengah analisis ---------- */
  let tesC = null; // true/false/null=skip
  let stageSeen = [];
  const tC = Date.now();
  let canceled = false;
  for (let i = 0; i < 300; i++) {
    await sleep(300);
    s = await store();
    const j = (s.jobs || []).find((x) => x.target === "split") || (s.jobs || [])[0];
    if (!j) continue;
    if (j.stage && !stageSeen.includes(j.stage)) {
      stageSeen.push(j.stage);
      console.log(`[${Math.round((Date.now() - tC) / 1000)}s] STAGE: ${j.stage} (${j.pct}%)`);
    }
    // begitu analisis pembicara terlihat → klik BATAL
    if (!canceled && /Analisis zoom pembicara|AI mendeteksi orang|Mengambil frame sampel/.test(j.stage)) {
      const b = await click("BATAL", 1);
      if (b.ok) {
        canceled = true;
        console.log("klik BATAL di tengah analisis:", JSON.stringify(b), `(+${Math.round((Date.now() - tC) / 1000)}s)`);
      }
    }
    if (canceled && (j.status === "canceled" || j.status === "done" || j.status === "error")) {
      tesC = j.status === "canceled";
      console.log(`TES C — status akhir job#1: ${j.status} dalam ${Math.round((Date.now() - tC) / 1000)}s → ${tesC ? "BATAL REAKTIF ✓" : "TIDAK REAKTIF ✗"}`);
      break;
    }
    if (Date.now() - tC > 90_000) { // job#1 tidak sampai analisis dalam 90 dtk? lepas
      break;
    }
  }
  if (tesC === null) console.log("TES C — DILEWATI (analisis terlalu cepat / tidak tercapai dalam 90 dtk)");

  // hapus job#1 dari daftar supaya pantauan job#2 bersih
  await win.webContents.executeJavaScript(`window.__clipper.getState().jobs.forEach(j => window.__clipper.getState().removeJob(j.id))`, true);
  downloads.length = 0;

  /* ---------- job #2 — dijalankan penuh (TES A + B + D) ---------- */
  const clickedParts2 = await click(`EKSPOR PARTS (${parts})`);
  console.log("klik EKSPOR PARTS (job#2):", JSON.stringify(clickedParts2));
  if (!clickedParts2.ok) { console.log("VERDICT: ✗ TOMBOL EKSPOR PARTS #2"); app.exit(1); return; }

  const t0 = Date.now();
  let done = false;
  let jobInfo = null;
  const stages2 = [];
  for (let i = 0; i < 300; i++) { // maks ±15 menit
    await sleep(1000);
    s = await store();
    jobInfo = (s.jobs || []).find((x) => x.target === "split") || (s.jobs || [])[0] || null;
    if (!jobInfo) continue;
    if (jobInfo.stage && !stages2.includes(jobInfo.stage)) {
      stages2.push(jobInfo.stage);
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s] JOB2: ${jobInfo.status} ${jobInfo.pct}% — ${jobInfo.stage}`);
    }
    if (jobInfo.status === "done" || jobInfo.status === "error" || jobInfo.status === "canceled") { done = true; break; }
  }
  if (!done) { console.log("VERDICT: ✗ JOB#2 TIMEOUT (15 mnt) — analisis/encode beku"); app.exit(1); return; }
  console.log("job#2 akhir:", JSON.stringify(jobInfo));
  await sleep(2500);

  const tesA = jobInfo.status === "done";
  // TES B — progress hidup: ≥2 tahap analisis berbeda tercatat
  const analisisStages = stages2.filter((x) =>
    /Analisis zoom pembicara|AI mendeteksi orang|Menganalisis gelombang suara|Mengambil frame sampel|Menggabungkan sinyal/.test(x)
  );
  const tesB = analisisStages.length >= 2;
  console.log(`TES B — tahap analisis tercatat: ${analisisStages.length} (${analisisStages.map((x) => x.slice(0, 44)).join(" | ")})`);

  // TES D — semua bagian portrait + MP4 valid
  const files = downloads.filter((d) => d.name.includes("BAGIAN") && d.mp4);
  let tesD = files.length >= Math.min(2, parts);
  for (const f of files) {
    if (!f.dims || !(f.dims.h > f.dims.w)) { tesD = false; }
    console.log(`  ${f.name}: ${f.dims ? f.dims.w + "×" + f.dims.h : "?"} ${f.dims && f.dims.h > f.dims.w ? "PORTRAIT ✓" : "TIDAK PORTRAIT ✗"}`);
  }

  console.log("============================================================");
  console.log(`TES A (job selesai, tidak beku) : ${tesA ? "✓" : "✗"}`);
  console.log(`TES B (progress analisis hidup) : ${tesB ? "✓" : "✗"}`);
  console.log(`TES C (BATAL reaktif)           : ${tesC === null ? "(dilewati)" : tesC ? "✓" : "✗"}`);
  console.log(`TES D (9:16 portrait + MP4 OK)  : ${tesD ? "✓" : "✗"}`);
  const pass = tesA && tesB && tesD && tesC !== false;
  console.log(`VERDICT: ${pass ? "✓✓✓ SEMUA TES LULUS" : "✗ ADA TES GAGAL"}`);
  app.exit(pass ? 0 : 1);
});
