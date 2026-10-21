/* ============================================================
   TEST E2E FULL (v1.2.6) — drive UI asli di Electron:
   PHASE=split-subtitle : impor → SPLIT (UI) → SUBTITLE AI (Whisper)
   PHASE=export         : impor → split (store) → EKSPOR PARTS → EKSPOR VIDEO INI
   Semua unduhan ditangkap main process → diverifikasi header MP4 (ftyp).
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
const VIDEO = path.join(__dirname, "..", "scripts", "testmedia", "speech.mp4");
const PHASE = process.env.PHASE || "split-subtitle";
const DL_DIR = path.join(os.tmpdir(), "clipper-e2e-dl-" + Date.now());
fs.mkdirSync(DL_DIR, { recursive: true });

app.setPath("userData", path.join(os.tmpdir(), "clipper-test-e2e-" + Date.now()));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
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

  // tangkap SEMUA unduhan → folder sementara → diverifikasi
  const downloads = [];
  win.webContents.session.on("will-download", (_e, item) => {
    const safe = item.getFilename().replace(/[^\w.\- ]+/g, "_");
    const target = path.join(DL_DIR, safe);
    item.setSavePath(target);
    // v1.2.7 DIAGNOSTIK — ukuran blob saat unduhan dimulai + progres penulisan
    console.log(`[dl-start] ${item.getFilename()} · totalBytes=${item.getTotalBytes()} · mime=${item.getMimeType()}`);
    const probe = setInterval(() => {
      try { console.log(`[dl-prog] ${item.getFilename()} · ${item.getReceivedBytes()}/${item.getTotalBytes()} · ${item.getState()}`); }
      catch { clearInterval(probe); }
    }, 1000);
    item.once("done", (_ev, state) => {
      clearInterval(probe);
      let ok = false, size = 0;
      try {
        size = fs.statSync(target).size;
        const fd = fs.openSync(target, "r");
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        ok = state === "completed" && size > 1024 && buf.includes("ftyp");
      } catch { ok = false; }
      downloads.push({ name: item.getFilename(), state, size, mp4: ok });
      console.log(`[unduhan] ${item.getFilename()} · ${state} · ${(size / 1048576).toFixed(1)} MB · MP4-VALID=${ok}`);
    });
  });

  const logs = [];
  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message && !String(d.message).includes("Security Warning")) {
      const line = `[c${d.level}] ${String(d.message).slice(0, 200)}`;
      logs.push(line);
      // v1.2.7 — echo LANGSUNG agar urutan kejadian terlihat
      console.log(line);
    }
  });
  win.webContents.on("render-process-gone", (_e, d) => console.error("[FATAL] renderer gone:", d.reason, d.exitCode));

  await win.loadURL("app://./index.html");
  await sleep(4000);

  const click = async (label) => {
    // v1.2.7 — retry 5×: panel kadang belum selesai render saat klik dikirim
    let last = { ok: false, err: "belum dicoba" };
    for (let a = 0; a < 5; a++) {
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
      `(function(){ try { var s = window.__clipper.getState(); return { media: s.media.length, sel: s.selectedId, parts: (s.parts[s.selectedId]||[]).length, cues: s.settings.subtitle.cues.length, jobs: s.jobs.map(function(j){ return { name:j.name, target:j.target, status:j.status, pct: Math.round(j.progress*100), stage: String(j.stage).slice(0,80), error: j.error ? String(j.error).slice(0,120) : null }; }) }; } catch(e){ return { err: String(e) }; } })()`,
      true
    );

  // ============ 1) IMPOR ============
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

  let s = {};
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    s = await store();
    if (s.media === 1) break;
  }
  console.log("media terdaftar:", JSON.stringify(s));
  if (s.media !== 1) { console.log("VERDICT: ✗ IMPOR GAGAL"); app.exit(1); return; }

  // ============ 2) SPLIT ============
  if (PHASE === "split-subtitle") {
    await click("SPLIT");
    await sleep(600);
    // mode PER DETIK default; set 7 detik via store (Range input sulit di-drive)
    await win.webContents.executeJavaScript(`window.__clipper.getState().patchSplit({ mode: "seconds", seconds: 7 })`, true);
    const clickedSplit = await click("JALANKAN SPLIT OTOMATIS");
    console.log("klik split:", JSON.stringify(clickedSplit));
    let parts = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      s = await store();
      parts = s.parts || 0;
      if (parts >= 2) break;
    }
    console.log(`SPLIT: ${parts} bagian`);
    const splitOk = parts >= 2;
    if (!splitOk) { console.log("VERDICT: ✗ SPLIT GAGAL"); app.exit(1); return; }
    console.log("VERDICT-PART: ✓ SPLIT JALAN (" + parts + " bagian dari video 29.7 dtk)");

    // ============ 3) SUBTITLE AI ============
    await click("SUBTITLE AI");
    await sleep(600);
    const clickedSub = await click("MULAI TRANSKRIPSI");
    console.log("klik transkripsi:", JSON.stringify(clickedSub));
    let cues = 0, lastStage = "";
    for (let i = 0; i < 135; i++) { // maks ±9 menit
      await sleep(4000);
      s = await store();
      if (s.cues > 0) break;
      // ambil baris status yang tampil di panel (progress/eror/toast)
      const ui = await win.webContents.executeJavaScript(
        `(function(){ var t = String(document.body.innerText||""); var keys = ["Membaca audio","Men-decode","Menyatukan","Menyiapkan audio","Menyiapkan mesin","Mengunduh","Transkripsi","Selesai","gagal","Error","error","BATALKAN","Worker","Tidak dapat"]; var out=[]; t.split("\\n").forEach(function(l){ l=l.trim(); if(l && keys.some(function(k){return l.includes(k);}) && out.length<4) out.push(l.slice(0,110)); }); return out.join(" || "); })()`,
        true
      );
      if (ui !== lastStage) { console.log(`[${i * 4}s] cues=${s.cues} UI: ${ui || "(kosong)"}`); lastStage = ui; }
      if (/gagal|Error:/i.test(ui)) { console.log("[fail-fast] error terlihat di UI"); break; }
    }
    cues = s.cues || 0;
    console.log(`SUBTITLE: ${cues} baris`);
    console.log("VERDICT: " + (cues > 0 ? "✓ SPLIT + SUBTITLE AI JALAN E2E" : "✗ SUBTITLE GAGAL"));
    if (cues === 0) { for (const m of logs.slice(0, 25)) console.log(m); }
    app.exit(cues > 0 ? 0 : 1);
    return;
  }

  // ============ PHASE EXPORT ============
  // split via store (parts untuk EKSPOR PARTS)
  await win.webContents.executeJavaScript(
    `window.__clipper.getState().patchSplit({ mode: "seconds", seconds: 15 });
     (function(){ var st = window.__clipper.getState(); var m = st.media.find(x => x.id === st.selectedId);
       var cuts = []; for (var t = 15; t < m.duration - 0.4; t += 15) cuts.push(t);
       st.applySplit(m.id, "seconds", cuts); })()`,
    true
  );
  await sleep(500);
  s = await store();
  console.log("parts (via applySplit):", s.parts);

  // resolusi 720p + 24fps agar uji cepat (setelan tersedia di UI)
  await win.webContents.executeJavaScript(
    `window.__clipper.getState().patchExport({ resolution: "720p", fps: 24, quality: "balanced", autoMode: false });
     // v1.2.7 — uji jalur UNDUHAN (blob): folder picker tak bisa dijawab headless.
     // Jalur FOLDER (tulis ke disk) dibuktikan terpisah oleh test-speed.js via OPFS.
     try { localStorage.setItem("clipper-save-mode", "download"); } catch {}`,
    true
  );

  await click("EKSPOR");
  await sleep(600);
  const clickedParts = await click("EKSPOR PARTS");
  console.log("klik EKSPOR PARTS:", JSON.stringify(clickedParts));

  // tunggu semua job selesai (maks 9 menit)
  let allDone = false;
  for (let i = 0; i < 135; i++) {
    await sleep(4000);
    s = await store();
    const jobs = s.jobs || [];
    if (jobs.length && jobs.every((j) => j.status === "done" || j.status === "error" || j.status === "canceled")) { allDone = true; break; }
    if (i % 5 === 0) console.log(`[${i * 4}s]`, JSON.stringify(s.jobs));
  }
  console.log("jobs akhir (parts):", JSON.stringify(s.jobs));
  const partsJobsOk = (s.jobs || []).filter((j) => j.target === "split" && j.status === "done").length > 0;

  // ============ EKSPOR VIDEO INI (current) ============
  await click("EKSPOR VIDEO INI");
  let curDone = false;
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    s = await store();
    const cur = (s.jobs || []).find((j) => j.target === "current");
    if (cur && (cur.status === "done" || cur.status === "error" || cur.status === "canceled")) { curDone = cur.status === "done"; break; }
  }
  console.log("jobs akhir (semua):", JSON.stringify(s.jobs));

  // tunggu SEMUA unduhan mencapai keadaan akhir (maks 40 dtk)
  const expected = (s.parts || 0) + 1; // parts + 1 file gabungan
  let settled = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const doneStates = downloads.every((d) => d.state === "completed" || d.state === "interrupted");
    if (downloads.length >= expected && doneStates) { settled = true; break; }
  }
  console.log(`unduhan settle=${settled} (${downloads.length}/${expected})`);
  const dls = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR) : [];
  console.log(`folder unduhan: ${DL_DIR}`);
  console.log("unduhan:", JSON.stringify(downloads, null, 1));

  const bagian = downloads.filter((d) => d.name.includes("BAGIAN") && d.mp4);
  const single = downloads.filter((d) => !d.name.includes("BAGIAN") && d.mp4 && d.name.endsWith(".mp4"));
  const errJobs = (s.jobs || []).filter((j) => j.status === "error");

  console.log(`\nPARTS MP4 valid: ${bagian.length}`);
  console.log(`SINGLE MP4 valid: ${single.length}`);
  console.log(`job error: ${errJobs.length ? JSON.stringify(errJobs) : "tidak ada"}`);
  const verdict = partsJobsOk && bagian.length >= 2 && curDone && single.length >= 1 && errJobs.length === 0;
  console.log("\nVERDICT: " + (verdict ? "✓ EKSPOR PARTS + EKSPOR VIDEO INI JALAN E2E (antrean serial, MP4 valid)" : "✗ EKSPOR GAGAL"));
  if (!verdict) { for (const m of logs.slice(0, 20)) console.log(m); }
  app.exit(verdict ? 0 : 1);
});
