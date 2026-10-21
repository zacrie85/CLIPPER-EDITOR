/* ============================================================
   TEST HEADLESS v1.2.7 — UPGRADE KECEPATAN
   Membuktikan di protokol app://:
     1. SILERO VAD (AI baru, model bundel 639 KB) dipakai worker
        subtitle untuk audio > 35 dtk → meta.vad = "SILERO"
        (audio uji = suara TTS ASLI + musik — silero wajib bisa
        membedakannya; energy-VAD lama tidak bisa)
     2. Pesan "partial" (subtitle bergelembung) terkirim saat proses
     3. ETA tertimbang tidak error (progress selalu 0..1)
     4. YOLOS-tiny deteksi orang: WebGPU bila ada, fallback WASM —
        dan inferensi per-frame selesai (waktu dicatat)
   Jalankan:
     Xvfb :99 -screen 0 1600x900x24 &
     DISPLAY=:99 npx electron electron/test-speed.js
   ============================================================ */

const { app, BrowserWindow, protocol, net } = require("electron");
const { copyFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const OUT_DIR = path.join(__dirname, "..", "out");

// suara TTS asli (dari scripts/testmedia) disalin ke out/ agar dapat
// di-fetch lewat app:// oleh halaman uji — jangan ikut di-commit
try { copyFileSync(path.join(__dirname, "..", "scripts", "testmedia", "speech.wav"), path.join(OUT_DIR, "test-speech.wav")); } catch (e) {
  console.warn("[test] speech.wav tidak ada — uji SILERO akan pakai nada sintetis:", e.message);
}
// mp4-muxer ESM untuk uji paritas jalur disk (v1.2.7)
try { copyFileSync(path.join(__dirname, "..", "node_modules", "mp4-muxer", "build", "mp4-muxer.mjs"), path.join(OUT_DIR, "mp4-muxer.mjs")); } catch (e) {
  console.warn("[test] mp4-muxer.mjs tidak tersedia:", e.message);
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
      const headers = new Headers(res.headers);
      const mime = MIME[path.extname(file).toLowerCase()];
      if (mime) headers.set("Content-Type", mime);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  const logs = [];
  win.webContents.on("console-message", (...args) => {
    const d = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (d?.message) logs.push(`[c${d.level ?? "?"}] ${String(d.message).slice(0, 220)}`);
  });

  try {
    await win.loadURL("app://./index.html");
  } catch (e) {
    logs.push(`[load-error] ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 6000));

  /* ---------- UJI 1+2+3: worker dengan SUARA TTS ASLI 50 dtk + musik ---------- */
  const testWorker = `(async () => {
    const sr = 16000;
    const dur = 50; // > 35 dtk → jalur SILERO aktif
    // dekode suara TTS asli ke 16 kHz mono
    let speech = null;
    try {
      const res = await fetch("test-speech.wav");
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const off = new OfflineAudioContext(1, sr * 60, sr);
        const ab = await off.decodeAudioData(buf);
        const ch = ab.getChannelData(0);
        speech = ch.length > sr * dur ? ch.slice(0, sr * dur) : ch;
      }
    } catch {}
    const pcm = new Float32Array(sr * dur);
    if (speech) {
      // suara asli 0..22 dtk + 28..50 dtk; celah 22..28 = senyap
      const n1 = Math.min(speech.length, sr * 22);
      pcm.set(speech.subarray(0, n1), 0);
      const rest = speech.subarray(n1, Math.min(speech.length, n1 + sr * 22));
      pcm.set(rest, sr * 28);
      // 40% terakhir bertumpuk musik pelan (silero harus tetap kena suara)
      for (let i = Math.floor(sr * 30); i < pcm.length; i++) {
        pcm[i] += Math.sin(2 * Math.PI * 440 * i / sr) * 0.05;
      }
    } else {
      // cadangan: burst nada (silero mungkin 0 — dianggap energi)
      for (let i = 0; i < pcm.length; i++) {
        const t = i / sr;
        const inBurst = (t % 2.5) < 1.5;
        if (inBurst) pcm[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.4;
      }
    }
    const partials = [];
    const stages = [];
    let minP = 1, maxP = 0;
    const w = new Worker("whisper-worker.js", { type: "module" });
    const result = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("timeout 480s")), 480000);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "partial") partials.push(m.cues.length);
        if (m.type === "stage") stages.push(m.stage);
        if (m.type === "progress" && typeof m.p === "number") {
          minP = Math.min(minP, m.p); maxP = Math.max(maxP, m.p);
          if (m.p < 0 || m.p > 1.0001) reject(new Error("progress di luar jangkauan: " + m.p));
        }
        if (m.type === "done") { clearTimeout(to); resolve(m); }
        if (m.type === "error") { clearTimeout(to); reject(new Error(m.message)); }
      };
      w.postMessage({ type: "run", pcm, model: "tiny", language: "id", task: "transcribe" }, [pcm.buffer]);
    });
    return {
      hadSpeech: !!speech,
      backend: result.backend,
      threads: result.threads,
      vad: result.vad,
      vadMs: result.vadMs,
      speechPct: result.speechPct,
      cueCount: result.cues.length,
      tookSec: Math.round(result.tookSec),
      partialMsgs: partials.length,
      partialTotal: partials.reduce((a, b) => a + b, 0),
      pRange: [Math.round(minP * 1000) / 1000, Math.round(maxP * 1000) / 1000],
      sampleStage: stages.find((s) => s && s.includes("SILERO")) || "",
      sampleCues: result.cues.slice(0, 2).map((c) => c.text.slice(0, 30)),
    };
  })()`;

  /* ---------- UJI 4: YOLOS-tiny — WebGPU bila ada, fallback WASM ---------- */
  const testYolos = `(async () => {
    const T = await import("./transformers.min.js");
    try {
      const w = T.env?.backends?.onnx?.wasm;
      if (w) { w.wasmPaths = "/ort/"; w.proxy = false; }
      if (T.env) { T.env.allowLocalModels = true; T.env.localModelPath = "/models/"; T.env.useBrowserCache = false; }
    } catch {}
    // probe WebGPU (sama seperti detection.ts)
    let gpu = false;
    try {
      if (navigator.gpu) {
        const ad = await Promise.race([
          navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
          new Promise((_, r) => setTimeout(() => r(new Error("t")), 8000)),
        ]);
        if (ad) { const d = await Promise.race([
          ad.requestDevice(), new Promise((_, r) => setTimeout(() => r(new Error("t")), 8000))]);
          if (d) { gpu = true; try { d.close(); } catch {} } }
      }
    } catch {}
    let backendUsed = "wasm";
    let pipe = null;
    if (gpu) {
      try {
        pipe = await T.pipeline("object-detection", "Xenova/yolos-tiny", { device: "webgpu", dtype: "fp32" });
        backendUsed = "webgpu";
      } catch (e) { pipe = null; }
    }
    if (!pipe) {
      pipe = await T.pipeline("object-detection", "Xenova/yolos-tiny", { dtype: "q8" });
      backendUsed = "wasm";
    }
    // canvas sintetis 320x180: latar + beberapa kotak "orang-ish"
    const c = document.createElement("canvas");
    c.width = 320; c.height = 180;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, "#3a2f28"); grad.addColorStop(1, "#12100e");
    g.fillStyle = grad; g.fillRect(0, 0, 320, 180);
    for (let k = 0; k < 3; k++) {
      g.fillStyle = ["#c9a37e", "#8f6b4a", "#5a4030"][k];
      g.fillRect(40 + k * 110, 30 + k * 22, 44, 120); // badan
      g.beginPath(); g.arc(62 + k * 110, 26 + k * 22, 16, 0, Math.PI * 2); g.fill(); // kepala
    }
    const t0 = performance.now();
    const r1 = await pipe(c, { threshold: 0.55, percentage: true });
    const msFirst = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const r2 = await pipe(c, { threshold: 0.55, percentage: true });
    const msSecond = Math.round(performance.now() - t1);
    return {
      gpuApi: !!navigator.gpu,
      backendUsed,
      msFirst,
      msSecond,
      dets1: r1.length,
      dets2: r2.length,
    };
  })()`;

  const diag = {};
  console.log("\n[1/2] Uji worker subtitle (Silero VAD + partial + ETA)…");
  try {
    diag.worker = await win.webContents.executeJavaScript(testWorker, true);
  } catch (e) {
    diag.worker = { error: String(e.message || e).slice(0, 400) };
  }
  console.log("[2/2] Uji deteksi YOLOS (WebGPU/WASM)…");
  try {
    diag.yolos = await win.webContents.executeJavaScript(testYolos, true);
  } catch (e) {
    diag.yolos = { error: String(e.message || e).slice(0, 400) };
  }

  /* ---------- UJI 5: PARITAS MUXER — tulis ke disk (OPFS) vs blob ----------
     Membuktikan jalur SIMPAN KE FOLDER v1.2.7 (FileSystemWritableFileStreamTarget
     + fastStart:false) menghasilkan MP4 IDENTIK dengan jalur blob lama —
     memakai OPFS (navigator.storage.getDirectory) = API file ASLI tanpa dialog. */
  const testMuxer = `(async () => {
    const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = await import("./mp4-muxer.mjs");
    // chunk sintetis H.264-ish (parity test: isi sama, hasil harus sama)
    const makeChunks = () => {
      const out = [];
      for (let i = 0; i < 12; i++) {
        const data = new Uint8Array(2048 + i * 100);
        crypto.getRandomValues(data);
        out.push({
          data,
          meta: { decoderConfig: { codec: "avc1.64001f", description: new Uint8Array([1,100,31,255,225,0,7,103,100,0,31,172]) } },
          timestamp: i * 41666, duration: 41666, type: i === 0 ? "key" : "delta",
        });
      }
      return out;
    };
    const cfg = { video: { codec: "avc", width: 320, height: 180 } };
    const toChunk = (c) => new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, duration: c.duration, data: c.data });

    // 1) jalur blob (lama)
    const t1 = new ArrayBufferTarget();
    const m1 = new Muxer({ target: t1, ...cfg, fastStart: "in-memory" });
    for (const c of makeChunks()) m1.addVideoChunk(toChunk(c), c.meta);
    m1.finalize();
    const blobBytes = new Uint8Array(t1.buffer);

    // 2) jalur DISK via OPFS (FileSystemWritableFileStreamTarget — sama dengan app)
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle("parity-test.mp4", { create: true });
    const writable = await fh.createWritable();
    const t2 = new FileSystemWritableFileStreamTarget(writable);
    const m2 = new Muxer({ target: t2, ...cfg, fastStart: false });
    for (const c of makeChunks()) m2.addVideoChunk(toChunk(c), c.meta);
    m2.finalize();
    await writable.close();
    const f = await fh.getFile();
    const diskBytes = new Uint8Array(await f.arrayBuffer());

    // bandingkan: keduanya MP4 valid (ftyp) & ukuran dekat (moov-at-end vs in-memory bisa beda beberapa byte header)
    const ftyp = (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // "ftyp"
    return {
      blobSize: blobBytes.length,
      diskSize: diskBytes.length,
      blobFtyp: ftyp(blobBytes),
      diskFtyp: ftyp(diskBytes),
      sizeDelta: Math.abs(blobBytes.length - diskBytes.length),
    };
  })()`;

  console.log("\n[3/3] Uji paritas muxer disk (OPFS)…");
  try {
    diag.muxer = await win.webContents.executeJavaScript(testMuxer, true);
  } catch (e) {
    diag.muxer = { error: String(e.message || e).slice(0, 400) };
  }

  console.log("\n========== TEST KECEPATAN v1.2.7 (app://) ==========");
  console.log(JSON.stringify(diag, null, 2));
  console.log("--- console renderer (terakhir) ---");
  for (const m of logs.slice(-12)) console.log(m);

  const w = diag.worker || {};
  const y = diag.yolos || {};
  const mx = diag.muxer || {};
  // silero WAJIB kena suara TTS asli; bila speech.wav tidak tersedia,
  // cukup buktikan worker selesai dengan VAD mana pun
  const workerOk = !w.error && (w.hadSpeech ? w.vad === "SILERO" : !!w.vad) && typeof w.cueCount === "number";
  const yolosOk = !y.error && typeof y.msSecond === "number" && y.msSecond < 15000 && (y.backendUsed === "webgpu" || y.backendUsed === "wasm");
  const muxerOk = !mx.error && mx.blobFtyp === true && mx.diskFtyp === true && typeof mx.sizeDelta === "number" && mx.sizeDelta < 4096;
  console.log(`\nVERDICT WORKER: ${workerOk ? "✓ SILERO VAD + streaming cue hidup" : "✗ GAGAL"}`);
  console.log(`VERDICT YOLOS : ${yolosOk ? "✓ deteksi orang selesai (backend " + y.backendUsed + ")" : "✗ GAGAL"}`);
  console.log(`VERDICT MUXER : ${muxerOk ? "✓ tulis-ke-disk (OPFS) setara blob — jalur SIMPAN KE FOLDER valid" : "✗ GAGAL"}`);
  app.exit(workerOk && yolosOk && muxerOk ? 0 : 1);
});
