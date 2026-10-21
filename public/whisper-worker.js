/* ============================================================
   CLIPPER EDITOR — WHISPER WORKER (v1.2.7)
   ============================================================
   AI Subtitle berjalan di SINI — Web Worker terpisah.
   Main thread (UI) TIDAK PERNAH BEKU lagi walau video 1 jam.

   EMPAT LAPIS KECEPATAN:
   1. WEBGPU  — GPU Windows (fp32 encoder + q4 decoder)
                ± 8–15× lebih cepat dari WASM 1-thread
   2. WASM MULTITHREAD — SharedArrayBuffer (COOP/COEP aktif)
                memakai semua core CPU (dulu terkunci 1 thread)
   3. SILERO VAD (BARU v1.2.7) — AI neural 639 KB ter-bundel
                offline. Jauh lebih pintar dari energy-VAD lama
                membedakan SUARA MANUSIA vs musik/derau → bagian
                musik/iklan di-skip → transkripsi 1,5–3× lebih
                cepat di video bermusik + timing cue lebih presisi.
                Fallback otomatis ke energy-VAD bila gagal.
   4. SUBTITLE MUNCUL BERGELOMBANG — tiap region selesai langsung
                dikirim ke UI (pesan "partial") → user melihat teks
                tumbuh saat proses berjalan, tidak menunggu selesai.

   ETA kini DITIMBANG DURASI region (dulu jumlah region — angka
   lompat-lompat karena region 5 dtk dihitung sama dengan 30 dtk).
   ============================================================ */

let T = null;            // modul transformers.js
let pipes = {};          // cache pipeline per key "repo|device"
let currentRun = 0;
let gpuPref = "auto";    // "auto" | "off" — disetel dari pesan run
let sileroModel = null;  // AI VAD silero — dimuat sekali, dipakai lintas run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- runtime loader: lokal dulu → CDN cadangan ---------- */
async function loadT() {
  if (T) return T;
  const tries = [
    "./transformers.min.js",
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js",
    "https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.min.js",
  ];
  let lastErr = null;
  for (const u of tries) {
    try {
      T = await import(/* webpackIgnore: true */ u);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!T) throw new Error("Gagal memuat runtime AI: " + String(lastErr).slice(0, 120));
  return T;
}

function ortWasmLocal() {
  return fetch("/ort/ort-wasm-simd-threaded.mjs", { method: "HEAD" })
    .then((r) => r.ok).catch(() => false);
}
function modelsLocal() {
  return fetch("/models/Xenova/whisper-tiny/config.json", { method: "HEAD" })
    .then((r) => r.ok).catch(() => false);
}

async function cachedInBrowser(sub) {
  try {
    if (await AI_CACHE.has(sub)) return true;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(sub));
  } catch {
    return false;
  }
}

/* ---------- konfigurasi model ---------- */
const MODELS = {
  tiny:  { oc: "onnx-community/whisper-tiny",  xenova: "Xenova/whisper-tiny"  },
  base:  { oc: "onnx-community/whisper-base",  xenova: "Xenova/whisper-base"  },
  small: { oc: "onnx-community/whisper-small", xenova: "Xenova/whisper-small" },
};

function numThreads() {
  const hc = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const iso = typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false;
  return iso ? Math.min(8, Math.max(2, hc - 1)) : 1;
}

/* ---------- cache IndexedDB — satu-satunya cache yang bisa simpan di app:// ----------
   Cache API browser menolak scheme "app" (Request scheme unsupported) → tanpa ini
   model akan terus diunduh ulang setiap buka aplikasi. Migrasi otomatis: file yang
   sudah ada di cache lama (transformers-cache) tetap dipakai. */
class IdbCache {
  constructor() {
    this.dbp = null;
    this.browserCache = null; // cache lama — baca saja
  }
  db() {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open("clipper-ai-cache", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch(() => null);
    }
    return this.dbp;
  }
  key(request) {
    if (typeof request === "string") return request;
    if (request && typeof request.url === "string") return request.url;
    return String(request);
  }
  async oldCache() {
    if (this.browserCache !== null) return this.browserCache;
    try {
      this.browserCache = await caches.open("transformers-cache");
    } catch {
      this.browserCache = false;
    }
    return this.browserCache;
  }
  async match(request) {
    try {
      const url = this.key(request);
      const db = await this.db();
      if (db) {
        const rec = await new Promise((resolve) => {
          try {
            const tx = db.transaction("files", "readonly");
            const get = tx.objectStore("files").get(url);
            get.onsuccess = () => resolve(get.result ?? undefined);
            get.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        });
        if (rec && rec.blob) {
          return new Response(rec.blob, { status: rec.status ?? 200, headers: rec.headers ?? {} });
        }
      }
      // migrasi: model yang pernah diunduh versi lama masih terbaca
      const old = await this.oldCache();
      if (old) {
        const hit = await old.match(url).catch(() => undefined);
        if (hit) return hit;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  async put(request, response) {
    try {
      const url = this.key(request);
      const db = await this.db();
      if (!db) return;
      const blob = await response.clone().blob();
      const headers = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      await new Promise((resolve) => {
        try {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put({ status: response.status, headers, blob, at: Date.now() }, url);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    } catch {
      /* kuota penuh / gagal — biarkan, jangan ganggu transkripsi */
    }
  }
  /** cek apakah ada file dengan substring url (mis. "onnx-community/whisper-tiny") */
  async has(sub) {
    try {
      const db = await this.db();
      if (!db) return false;
      const keys = await new Promise((resolve) => {
        try {
          const tx = db.transaction("files", "readonly");
          const req = tx.objectStore("files").getAllKeys();
          req.onsuccess = () => resolve(req.result ?? []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
      return keys.some((k) => String(k).includes(sub));
    } catch {
      return false;
    }
  }
}

const AI_CACHE = new IdbCache();

async function webgpuAvailable() {
  // v1.2.4 — dulu requestAdapter bisa MENGGANTUNG SELAMANYA di driver GPU
  // Windows bermasalah (UI diam total). Sekarang: probe dengan batas waktu
  // 10 dtk + coba requestDevice — gagal/gantung = anggap tidak ada WebGPU.
  const withTimeout = async (p, ms, label) => {
    let timer = null;
    try {
      return await Promise.race([
        p,
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(label + " timeout")), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    if (typeof navigator === "undefined" || !navigator.gpu) return false;
    const ad = await withTimeout(
      navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
      10_000,
      "requestAdapter"
    );
    if (!ad) return false;
    // cek device benar-benar bisa dibuat (driver macet terdeteksi di sini)
    const dev = await withTimeout(ad.requestDevice(), 10_000, "requestDevice");
    try { dev?.close?.(); } catch {}
    return !!dev;
  } catch {
    return false;
  }
}

/* pipeline WebGPU: fp32 encoder + q4 decoder (resep resmi demo HF) */
async function buildPipe(modelKey, onModelProgress, forceWasm = false) {
  const info = MODELS[modelKey];
  const onProgress = (info2) => {
    if (info2 && info2.status === "progress" && typeof info2.progress === "number") {
      onModelProgress(info2.progress / 100);
    }
  };

  // v1.2.4 — gpuPref dari panel: "off" = user melarang WebGPU (WASM langsung)
  const gpu = forceWasm || gpuPref === "off" ? false : await webgpuAvailable();
  const gpuCached = gpu ? await cachedInBrowser("onnx-community/whisper-" + modelKey) : false;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  if (gpu && (gpuCached || online)) {
    try {
      const key = info.oc + "|webgpu";
      if (!pipes[key]) {
        pipes[key] = await T.pipeline("automatic-speech-recognition", info.oc, {
          device: "webgpu",
          dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
          progress_callback: onProgress,
        });
      }
      return { pipe: pipes[key], backend: "webgpu", repo: info.oc, threads: 1 };
    } catch (e) {
      /* GPU gagal (driver lama, fp32 habis memori, dsb) → jatuh ke WASM */
      try { console.warn("[worker] WebGPU gagal, fallback WASM:", String(e).slice(0, 160)); } catch {}
    }
  }

  // WASM q8 — Xenova; tiny ter-bundel offline di /models/
  const key = info.xenova + "|wasm";
  if (!pipes[key]) {
    pipes[key] = await T.pipeline("automatic-speech-recognition", info.xenova, {
      dtype: "q8",
      progress_callback: onProgress,
    });
  }
  return { pipe: pipes[key], backend: "wasm", repo: info.xenova, threads: numThreads() };
}

/* ---------- streamer penghitung token untuk progress halus ---------- */
function makeCounter(onTick) {
  let n = 0;
  return {
    get count() { return n; },
    reset() { n = 0; },
    put(tokens) {
      try {
        const arr = typeof tokens === "bigint" ? [tokens] : (tokens?.tolist ? tokens.tolist() : tokens);
        n += Array.isArray(arr) ? arr.length : 1;
      } catch {
        n += 1;
      }
      if (onTick) onTick(n);
    },
    end() {},
  };
}

/* ============================================================
   v1.2.7 — SILERO VAD (AI offline baru)
   Model: onnx-community/silero-vad (q8, 639 KB) — TER-BUNDEL di
   /models/onnx-community/silero-vad/ → jalan tanpa internet.
   Interface graph: input float32 [B,512] @16kHz, state [2,1,128],
   sr int64; output: output [B,1] = peluang suara, stateN.
   ============================================================ */
async function getSilero() {
  if (sileroModel) return sileroModel;
  sileroModel = await T.AutoModel.from_pretrained("onnx-community/silero-vad", {
    config: { model_type: "silero_vad" }, // tak dikenal → fallback generic model (session langsung)
    dtype: "q8",
  });
  return sileroModel;
}

/** loop seluruh PCM → larik peluang suara per 512 sampel (32 ms) */
async function sileroProbs(pcm, onFrac) {
  const model = await getSilero();
  const CHUNK = 512;
  const total = Math.floor(pcm.length / CHUNK);
  const probs = new Float32Array(total);
  let state = new T.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  const srT = new T.Tensor("int64", BigInt64Array.of(16000n), []);
  for (let i = 0; i < total; i++) {
    const inT = new T.Tensor("float32", pcm.subarray(i * CHUNK, (i + 1) * CHUNK), [1, CHUNK]);
    const out = await model({ input: inT, state, sr: srT });
    probs[i] = Number(out.output?.data?.[0] ?? 0);
    if (out.stateN) state = out.stateN;
    if (onFrac && i % 128 === 0) onFrac(i / total);
  }
  return probs;
}

/** peluang silero → region suara (bentuk sama dengan energy VAD) */
function probsToRegions(probs, pcm) {
  const dur = pcm.length / 16000;
  const step = 512 / 16000; // 32 ms
  const thrHi = 0.5, thrLo = 0.35;
  let runs = [];
  let st = -1;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (st < 0) {
      if (p >= thrHi) st = i;
    } else if (p < thrLo) {
      runs.push([st * step, i * step]);
      st = -1;
    }
  }
  if (st >= 0) runs.push([st * step, probs.length * step]);

  // gabung celah kecil + buang run pendek
  const gap = 0.3, minRun = 0.25;
  let merged = [];
  for (const r of runs) {
    if (r[1] - r[0] < minRun) continue;
    if (merged.length && r[0] - merged[merged.length - 1][1] < gap) {
      merged[merged.length - 1][1] = r[1];
    } else merged.push([...r]);
  }

  const pad = 0.24;
  let regions = merged
    .map(([a, b]) => [Math.max(0, a - pad), Math.min(dur, b + pad)])
    .filter(([a, b]) => b - a >= 0.4);

  // pecah region > 30 dtk di titik peluang TERENDAH (paling sunyi)
  const out = [];
  for (let [a, b] of regions) {
    while (b - a > 30.5) {
      let bestCut = a + 25;
      let bestP = Infinity;
      const center = a + 25;
      for (let t = center - 3; t <= Math.min(center + 3, b - 4); t += 0.1) {
        const idx = Math.floor(t / step);
        if (idx < 0 || idx >= probs.length) continue;
        if (probs[idx] < bestP) { bestP = probs[idx]; bestCut = t; }
      }
      out.push([a, bestCut]);
      a = bestCut;
    }
    out.push([a, b]);
  }
  return out
    .map(([a, b]) => ({ start: a, end: b }))
    .filter((r) => r.end - r.start >= 0.4);
}

/* ---------- VAD — deteksi bagian ada suara ---------- */
function detectSpeechRegions(pcm, sr) {
  const frame = Math.round(sr * 0.032);
  const n = Math.floor(pcm.length / frame);
  if (n < 8) return [{ start: 0, end: pcm.length / sr }];
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const b = i * frame;
    for (let j = 0; j < frame; j += 2) s += pcm[b + j] * pcm[b + j];
    rms[i] = Math.sqrt(s / (frame / 2));
  }
  const sorted = Float32Array.from(rms).sort();
  const noise = sorted[Math.floor(n * 0.2)] || 0.001;
  const peak = sorted[Math.floor(n * 0.95)] || 0.05;
  const thr = Math.max(noise * 3.2, peak * 0.11, 0.0012);

  const fDur = frame / sr;
  let runs = [];
  let st = -1;
  for (let i = 0; i < n; i++) {
    if (rms[i] > thr) {
      if (st < 0) st = i;
    } else if (st >= 0) {
      runs.push([st * fDur, i * fDur]);
      st = -1;
    }
  }
  if (st >= 0) runs.push([st * fDur, n * fDur]);

  // buang run terlalu pendek, gabung celah kecil
  const minRun = 0.3, gap = 0.45;
  let merged = [];
  for (const r of runs) {
    if (r[1] - r[0] < minRun) continue;
    if (merged.length && r[0] - merged[merged.length - 1][1] < gap) {
      merged[merged.length - 1][1] = r[1];
    } else merged.push([...r]);
  }

  const dur = pcm.length / sr;
  const pad = 0.25;
  let regions = merged
    .map(([a, b]) => [Math.max(0, a - pad), Math.min(dur, b + pad)])
    .filter(([a, b]) => b - a >= 0.5);

  let speech = regions.reduce((s, [a, b]) => s + (b - a), 0);
  // hampir semua bagian bersuara → 1 region penuh (pakai chunking bawaan)
  if (speech / Math.max(dur, 0.001) > 0.93) {
    return [{ start: 0, end: dur, full: true }];
  }

  // pecah region > 30 dtk di titik paling sunyi
  const out = [];
  for (let [a, b] of regions) {
    while (b - a > 30.5) {
      let bestCut = a + 25;
      let bestRms = Infinity;
      const center = a + 25;
      for (let t = center - 3; t <= Math.min(center + 3, b - 4); t += 0.1) {
        const idx = Math.floor(t / fDur);
        if (idx < 0 || idx >= n) continue;
        if (rms[idx] < bestRms) { bestRms = rms[idx]; bestCut = t; }
      }
      out.push([a, bestCut]);
      a = bestCut;
    }
    out.push([a, b]);
  }
  return out
    .map(([a, b]) => ({ start: a, end: b }))
    .filter((r) => r.end - r.start >= 0.4);
}

/* ---------- bersihkan cue: offset, filter derau, dedupe ---------- */
const NOISE_RE =
  /^[\s([（(]*(?:♪|♫|♬|\[?music\]?|\[?musik\]?|\[?applause\]?|\[?tepuk tangan\]?|\[?ketawa\]?|\[?laughter\]?|\[?suara\]?|…+|\.+|-+|\[?senyap\]?|\[?silence\]?)[\s)\]）.…]*$/i;

function cleanCues(rawChunks, offset) {
  const out = [];
  let prevEnd = offset;
  let prevText = "";
  for (const c of rawChunks || []) {
    const text = String(c?.text ?? "").trim();
    if (!text || NOISE_RE.test(text)) continue;
    let start = c?.timestamp?.[0];
    let end = c?.timestamp?.[1];
    start = isFinite(start) ? start : 0;
    end = isFinite(end) && end > start ? end : start + 1.2;
    start += offset;
    end += offset;
    // rapikan tumpang tindih
    if (start < prevEnd) start = prevEnd + 0.02;
    if (end <= start) end = start + 0.8;
    // dedupe beruntun
    if (text === prevText && start - prevEnd < 0.4) {
      prevEnd = end;
      continue;
    }
    out.push({ start, end, text });
    prevEnd = end;
    prevText = text;
  }
  return out;
}

/* ---------- pesan utama ---------- */
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg?.type !== "run") return;
  const runId = ++currentRun;
  const { pcm, model, language, task, gpu } = msg;
  if (gpu === "off" || gpu === "auto" || gpu === "on") gpuPref = gpu;
  const send = (m) => {
    if (runId === currentRun) self.postMessage({ ...m, runId });
  };

  try {
    /* 1. runtime */
    send({ type: "stage", stage: "Memuat mesin AI…", p: 0.02 });
    T = await loadT();
    send({ type: "stage", stage: "Menyetel mesin AI…", p: 0.04 });
    try {
      const [ortLocal, mdlLocal] = await Promise.all([ortWasmLocal(), modelsLocal()]);
      const w = T.env?.backends?.onnx?.wasm;
      if (w && ortLocal) {
        w.wasmPaths = "/ort/";
        w.proxy = false;
        w.numThreads = numThreads();
      }
      if (T.env) {
        T.env.allowLocalModels = true;
        T.env.localModelPath = "/models/";
        T.env.allowRemoteModels = true;
        T.env.useBrowserCache = false; // Cache API menolak scheme app://
        T.env.customCache = AI_CACHE; // IndexedDB — awet offline permanen
      }
    } catch { /* env default */ }

    /* 2. model (WebGPU → WASM) */
    const t0 = performance.now();
    const onModel = (p) => {
      send({ type: "stage", stage: `Memuat model ${model.toUpperCase()} — ${Math.round(p * 100)}%`, p: 0.05 + p * 0.1 });
    };
    let built;
    try {
      built = await buildPipe(model, onModel);
    } catch (e) {
      // WebGPU bermasalah → paksa WASM q8 (cache pipeline GPU dibuang)
      send({ type: "stage", stage: "WebGPU tak tersedia — memakai WASM…", p: 0.06 });
      pipes = {};
      built = await buildPipe(model, onModel, true);
    }

    const { pipe, backend, threads } = built;
    const meta = { backend, threads };
    send({ type: "meta", ...meta });
    send({ type: "stage", stage: "Menganalisis suara (VAD)…", p: 0.16 });

    /* 3. VAD — v1.2.7: SILERO AI dulu, energy sebagai cadangan */
    const dur = pcm.length / 16000;
    let regions;
    let vadName = "ENERGY";
    let vadMs = 0;
    if (dur > 35) {
      const energy = detectSpeechRegions(pcm, 16000);
      if (energy.length === 1 && energy[0].full) {
        // hampir semua bersuara → chunking bawaan; VAD tidak dibutuhkan
        regions = energy;
      } else {
        try {
          const tS = performance.now();
          send({ type: "stage", stage: "AI VAD SILERO menganalisis suara…", p: 0.16, ...meta });
          const probs = await sileroProbs(pcm, (f) => {
            send({ type: "stage", stage: `AI VAD SILERO menganalisis suara… ${Math.round(f * 100)}%`, p: 0.16, ...meta });
          });
          vadMs = performance.now() - tS;
          const sil = probsToRegions(probs, pcm);
          if (!sil.length) throw new Error("silero tidak menemukan suara");
          regions = sil;
          vadName = "SILERO";
        } catch (e) {
          // silero gagal (model tidak ada/jaringan/error ORT) → energy lama
          try { console.warn("[worker] Silero VAD gagal, pakai energy:", String(e).slice(0, 120)); } catch {}
          regions = energy;
          vadName = "ENERGY";
        }
      }
    } else {
      regions = [{ start: 0, end: dur, full: true }];
    }
    const speechSum = regions.reduce((s, r) => s + (r.end - r.start), 0);
    const speechPct = Math.round((speechSum / Math.max(dur, 0.001)) * 100);
    send({ type: "meta", ...meta, speechPct, vad: vadName });

    /* 4. transkripsi per-region — ETA DITIMBANG DURASI (v1.2.7) */
    const lang = language === "auto" ? undefined : language;
    const cues = [];
    let textAll = [];
    const total = regions.length;
    const loadFrac = 0.16;
    const tStart = performance.now();
    let lastPing = 0;
    let lastKnownFrac = loadFrac;
    const totalW = Math.max(0.001, regions.reduce((s, r) => s + (r.end - r.start), 0));
    let doneW = 0;

    for (let i = 0; i < total; i++) {
      if (runId !== currentRun) return;
      const r = regions[i];
      const sub = pcm.subarray(Math.floor(r.start * 16000), Math.min(pcm.length, Math.ceil(r.end * 16000)));
      const regionLen = r.end - r.start;
      const nativeChunk = r.full && regionLen > 30;
      const counter = makeCounter();
      const streamer = { put: (t) => counter.put(t), end: () => {} };
      counter.reset();

      const opts = {
        language: lang,
        task: task || "transcribe",
        return_timestamps: true,
        force_full_sequences: false,
        streamer,
      };
      if (nativeChunk) {
        opts.chunk_length_s = 30;
        opts.stride_length_s = 5;
      }

      // v1.2.4 — ping tiap 5 dtk selama satu region dikerjakan: watchdog di
      // sisi UI tetap hidup & user melihat aktifitas walau region panjang sunyi
      const ping = setInterval(() => {
        send({ type: "stage", stage: `Menulis teks bagian ${i + 1}/${total}…`, p: lastKnownFrac, ...meta });
      }, 5000);

      let out;
      try {
        out = await pipe(sub, opts);
      } finally {
        clearInterval(ping);
      }
      if (runId !== currentRun) return;

      /* v1.2.7 — SUBTITLE MUNCUL BERGELOMBANG: cue region ini langsung
         dikirim ke UI; user melihat daftar subtitle tumbuh saat proses */
      const newCues = cleanCues(out?.chunks, r.start);
      cues.push(...newCues);
      if (newCues.length) send({ type: "partial", cues: newCues, ...meta });
      if (out?.text) textAll.push(out.text.trim());

      const done = i + 1;
      const now = performance.now();
      if (now - lastPing > 200 || done === total) {
        lastPing = now;
        doneW += regionLen;
        const fracW = Math.min(1, doneW / totalW);
        const frac = loadFrac + fracW * (1 - loadFrac - 0.01);
        lastKnownFrac = frac;
        const elapsed = (now - tStart) / 1000;
        // ETA tertimbang: akumulasi detik audio selesai vs sisa detik audio
        const eta = fracW > 0.02 ? (elapsed / fracW) * (1 - fracW) : (elapsed / done) * (total - done);
        send({
          type: "progress",
          p: frac,
          done,
          total,
          elapsed,
          eta,
          ...meta,
          speechPct,
          vad: vadName,
        });
      }
    }

    const tookSec = (performance.now() - t0) / 1000;
    send({ type: "stage", stage: "Menyusun subtitle…", p: 0.99 });
    send({
      type: "done",
      cues,
      text: textAll.join(" ").trim(),
      speechPct,
      tookSec,
      vad: vadName,
      vadMs: Math.round(vadMs),
      ...meta,
    });
  } catch (e) {
    send({ type: "error", message: String(e?.message ?? e).slice(0, 300) });
  }
};
