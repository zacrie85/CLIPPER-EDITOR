/* ============================================================
   TEST E2E OTOMATIS CERDAS (v1.2.8) — drive UI asli di Electron:
   PHASE=autopilot : impor → centang SUBTITLE+MOMEN (localStorage)
                     → EKSPOR VIDEO INI → antrean menjalankan sendiri
                     Whisper + AI MOMEN → encode tiap momen (MP4 valid)
   PHASE=speaker   : impor → ANALISIS PEMBICARA SEKARANG (YOLOS
                     pipeline overlap v1.2.8) → hasil analisis tampil
   Jalankan:
     Xvfb :99 -screen 0 1600x900x24 &
     DISPLAY=:99 PHASE=autopilot npx electron electron/test-autopilot.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");
const VIDEO = path.join(__dirname, "..", "scripts", "testmedia", "speech.mp4");
const PHASE = process.env.PHASE || "autopilot";
const DL_DIR = path.join(os.tmpdir(), "clipper-auto-dl-" + Date.now());
fs.mkdirSync(DL_DIR, { recursive: true });

app.setPath("userData", path.join(os.tmpdir(), "clipper-test-auto-" + Date.now()));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      console.log(`[unduhan] ${item.getFilename()} · ${state} · ${(size / 1048576).toFixed(2)} MB · MP4-VALID=${ok}`);
    });
  });

  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message && !/Security Warning|content-length|No available adapters/.test(String(d.message))) {
      console.log(`[c${d.level}] ${String(d.message).slice(0, 180)}`);
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
      `(function(){ try { var s = window.__clipper.getState(); return { media: s.media.length, sel: s.selectedId, cues: s.settings.subtitle.cues.length, moments: (s.moments[s.selectedId]||[]).length, jobs: s.jobs.map(function(j){ return { name:j.name, target:j.target, auto: !!j.auto, status:j.status, pct: Math.round(j.progress*100), stage: String(j.stage).slice(0,90), error: j.error ? String(j.error).slice(0,140) : null }; }) }; } catch(e){ return { err: String(e) }; } })()`,
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
  if (!imported.ok) { console.log("VERDICT: ✗ IMPOR GAGAL"); app.exit(1); return; }
  let s = {};
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    s = await store();
    if (s.media === 1) break;
  }
  console.log("media terdaftar:", JSON.stringify({ media: s.media }));
  if (s.media !== 1) { console.log("VERDICT: ✗ MEDIA TAK TERDAFTAR"); app.exit(1); return; }

  /* ================= PHASE: PEMBICARA ================= */
  if (PHASE === "speaker") {
    await win.webContents.executeJavaScript(`window.__clipper.getState().setTab("speaker")`, true);
    await sleep(700);
    const clicked = await click("ANALISIS PEMBICARA SEKARANG");
    console.log("klik analisis pembicara:", JSON.stringify(clicked));
    if (!clicked.ok) { console.log("VERDICT: ✗ TOMBOL PEMBICARA TAK ADA"); app.exit(1); return; }
    let done = "";
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) { // maks ±13 menit (VM tanpa GPU)
      await sleep(4000);
      const ui = await win.webContents.executeJavaScript(
        `(function(){ var t = String(document.body.innerText||""); var out=[]; t.split("\\n").forEach(function(l){ l=l.trim(); if(l && (l.includes("AI mendeteksi")||l.includes("Orang terdeteksi")||l.includes("Mode cadangan")||l.includes("gelombang")||l.includes("Analisis gagal")||l.includes("mesin deteksi")) && out.length<3) out.push(l.slice(0,120)); }); return out.join(" || "); })()`,
        true
      );
      if (ui !== done) { console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${ui || "(kosong)"}`); done = ui; }
      if (/Orang terdeteksi|Mode cadangan/.test(ui)) break;
      if (/Analisis gagal/.test(ui)) break;
    }
    const verdict = /Orang terdeteksi|Mode cadangan/.test(done)
      ? "✓ ZOOM PEMBICARA (pipeline overlap v1.2.8) JALAN E2E"
      : "✗ ANALISIS PEMBICARA GAGAL/TIMEOUT";
    console.log("VERDICT:", verdict);
    app.exit(verdict.startsWith("✓") ? 0 : 1);
    return;
  }

  /* ================= PHASE: AUTOPILOT ================= */
  // centang OTOMATIS CERDAS via localStorage SEBELUM panel EKSPOR dirender
  await win.webContents.executeJavaScript(
    `localStorage.setItem("clipper-auto-flags", JSON.stringify({ moment: true, subtitle: true, speaker: false }))`,
    true
  );
  // mode UNDUHAN (tanpa dialog folder — headless tak bisa menjawab dialog)
  await win.webContents.executeJavaScript(
    `localStorage.setItem("clipper-save-mode", "download")`,
    true
  );
  await win.webContents.executeJavaScript(`window.__clipper.getState().setTab("export")`, true);
  await sleep(700);
  const clicked = await click("EKSPOR VIDEO INI");
  console.log("klik EKSPOR VIDEO INI:", JSON.stringify(clicked));
  if (!clicked.ok) { console.log("VERDICT: ✗ TOMBOL EKSPOR TAK ADA"); app.exit(1); return; }

  // pantau job sampai selesai (subtitle otomatis + momen otomatis + encode)
  let last = "";
  let stuckSince = 0;
  const t0 = Date.now();
  let job = null;
  for (let i = 0; i < 320; i++) { // maks ±21 menit
    await sleep(4000);
    s = await store();
    job = (s.jobs || [])[0];
    const line = job ? `${job.status} ${job.pct}% ${job.stage}` : "(tanpa job)";
    if (line !== last) { console.log(`[${Math.round((Date.now() - t0) / 1000)}s] cues=${s.cues} momen=${s.moments} JOB: ${line}`); last = line; stuckSince = Date.now(); }
    // DIAGNOSTIK: macet 90 dtk di pct sama → dump stack async via CDP
    if (job && job.status === "running" && Date.now() - stuckSince > 90_000) {
      console.log("[PROBE] dump stack async via CDP debugger…");
      try {
        const dbg = win.webContents.debugger;
        dbg.attach();
        await dbg.sendCommand("Debugger.enable");
        const { calls } = await dbg.sendCommand("Runtime.evaluate", {
          expression: `
            (async () => {
              // tandai: cari janji yang belum selesai pada rantai job ekspor
              return "eval-ok";
            })()
          `,
          awaitPromise: false,
        });
        void calls;
        const pause = await new Promise(async (resolve) => {
          dbg.on("message", (_e, method, params) => {
            if (method === "Debugger.paused") resolve(params);
          });
          await dbg.sendCommand("Debugger.pause");
          setTimeout(() => resolve(null), 8000);
        });
        if (pause && pause.callFrames) {
          const frames = pause.callFrames.slice(0, 12).map((f) => {
            const loc = f.location;
            const fn = f.functionName || "(anon)";
            return `${fn} @${loc.scriptId}:${loc.lineNumber}:${loc.columnNumber}`;
          });
          console.log("[STACK] " + JSON.stringify(frames, null, 1));
          // nama skrip
          try {
            const { result } = await dbg.sendCommand("Debugger.getScriptSource", { scriptId: pause.callFrames[0].location.scriptId });
            void result;
          } catch {}
        } else {
          console.log("[STACK] tidak ter-pause (main thread idel atau blocked native)");
        }
        try { await dbg.sendCommand("Debugger.resume"); } catch {}
        dbg.detach();
      } catch (e) {
        console.log("[PROBE] CDP gagal:", String(e.message || e).slice(0, 100));
      }
      // tetap jalankan probe fetch/decode
      const probeP = win.webContents.executeJavaScript(
        `(async () => {
          const s = window.__clipper.getState();
          const m = s.media[0];
          const race = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("HANG>" + ms + "ms")), ms))]);
          const out = {};
          try {
            const t0 = performance.now();
            const res = await race(fetch(m.url), 10000);
            const ab = await race(res.arrayBuffer(), 10000);
            out.blobFetch = "OK " + ab.byteLength + "B @" + Math.round(performance.now() - t0) + "ms";
          } catch (e) { out.blobFetch = "GAGAL: " + String(e.message || e).slice(0, 60); }
          try {
            const t0 = performance.now();
            const off = new OfflineAudioContext(2, 1, 48000);
            const ab2 = await race(off.decodeAudioData(new Uint8Array(await (await fetch(m.url)).arrayBuffer()).buffer), 15000);
            out.fullDecode48k = "OK " + ab2.duration.toFixed(1) + "s @" + Math.round(performance.now() - t0) + "ms";
          } catch (e) { out.fullDecode48k = String(e.message || e).slice(0, 70); }
          return out;
        })()`,
        true
      );
      const probe = await Promise.race([
        probeP,
        new Promise((resolve) => setTimeout(() => resolve("(executeJavaScript HANG — main thread terblokir total!)"), 25_000)),
      ]);
      console.log("[PROBE MACET]", JSON.stringify(probe));
      break;
    }
    if (job && (job.status === "done" || job.status === "error" || job.status === "canceled")) break;
  }

  await sleep(2500); // beri waktu unduhan selesai
  const okJob = job && job.status === "done";
  const okCues = (s.cues || 0) > 0;          // subtitle otomatis masuk store
  const okMoments = (s.moments || 0) > 0;    // momen otomatis masuk store
  const okFiles = downloads.length > 0 && downloads.every((d) => d.mp4);
  // store() mereduksi auto menjadi boolean (true = job membawa flag auto)
  const autoTag = !!(job && job.auto);

  console.log(`RINGKASAN: job=${okJob} subtitleAuto=${okCues} momenAuto=${okMoments} file=${downloads.length} semuaMP4valid=${okFiles} flagAutoTerkirim=${autoTag}`);
  for (const d of downloads) console.log(`  file: ${d.name} · ${(d.size / 1048576).toFixed(2)} MB · valid=${d.mp4}`);

  const verdict = okJob && okCues && okMoments && okFiles && autoTag
    ? "✓ OTOMATIS CERDAS JALAN E2E (subtitle → momen → encode → MP4 valid)"
    : "✗ OTOMATIS CERDAS GAGAL";
  console.log("VERDICT:", verdict);
  app.exit(verdict.startsWith("✓") ? 0 : 1);
});
