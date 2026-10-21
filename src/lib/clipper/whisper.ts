"use client";

/* ============================================================
   CLIPPER EDITOR — Loader AI (Transformers.js) — RUMAH LOKAL
   Urutan pemuatan runtime (semua dicoba berurutan):
     1. /transformers.min.js  → file lokal di dalam aplikasi
        (disalin build-app.mjs) → jalan TANPA internet
     2. CDN jsdelivr          → cadangan bila file lokal rusak
     3. CDN unpkg             → cadangan kedua
   Model Whisper unduh SEKALI dari HuggingFace → Cache API browser
   → setelah itu 100% offline permanen (runtime + wasm juga lokal).
   Bila unduhan gagal → otomatis coba mirror hf-mirror.com.

   v1.2.3: WHISPER pindah ke WEB WORKER (public/whisper-worker.js)
   → UI tidak pernah beku lagi. Kecepatan: WebGPU + WASM
   multithread + VAD (lewati bagian senyap). Loader di file ini
   tetap dipakai modul lain (YOLOS/detection) di main thread.
   ============================================================ */

let transformersMod: any = null;
let loadingPromise: Promise<any> | null = null;

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js",
  "https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.min.js",
];

async function cdnImport(url: string): Promise<unknown> {
  const fn = new Function("u", "return import(u)");
  return await fn(url);
}

/** arahkan wasm ONNX ke file lokal aplikasi + model bundel + matikan thread */
async function applyLocalEnv(T: any) {
  try {
    // pakai wasm lokal bila tersedia (build Electron); di dev → default CDN
    let ortLocal = false;
    try {
      ortLocal = (await fetch("/ort/ort-wasm-simd-threaded.mjs", { method: "HEAD" })).ok;
    } catch {
      ortLocal = false;
    }
    const wasm = T?.env?.backends?.onnx?.wasm;
    if (wasm && ortLocal) {
      wasm.wasmPaths = "/ort/";
      wasm.numThreads = 1;
      wasm.proxy = false;
    }
    if (T?.env) {
      // model dicari di folder aplikasi dulu (/models/) → 404 → lanjut HuggingFace
      let modelsLocal = false;
      try {
        modelsLocal = (await fetch("/models/Xenova/whisper-tiny/config.json", { method: "HEAD" })).ok;
      } catch {
        modelsLocal = false;
      }
      T.env.allowLocalModels = modelsLocal;
      if (modelsLocal) T.env.localModelPath = "/models/";
      T.env.allowRemoteModels = true;
      T.env.useBrowserCache = true;
    }
  } catch {
    /* env tidak tersedia — biarkan default */
  }
}

export async function loadTransformers(
  onProgress?: (stage: string, p: number) => void
): Promise<any> {
  if (transformersMod) return transformersMod;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.("Memuat runtime AI (lokal)…", 0.02);
    let mod: unknown = null;
    let lastErr: unknown = null;

    // 1) runtime lokal di dalam aplikasi — tanpa internet
    try {
      mod = await cdnImport("/transformers.min.js");
    } catch (e) {
      lastErr = e;
    }

    // 2–3) CDN cadangan
    if (!mod) {
      for (const url of CDN_URLS) {
        try {
          mod = await cdnImport(url);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
    }

    if (!mod) {
      throw new Error(
        `Gagal memuat runtime AI: ${String(lastErr)}. File aplikasi bisa jadi rusak — install ulang .exe, atau hubungkan internet sekali.`
      );
    }
    transformersMod = mod;
    applyLocalEnv(transformersMod);
    onProgress?.("Runtime siap", 0.1);
    return transformersMod;
  })();

  return loadingPromise;
}

export function getTransformers(): any {
  return transformersMod;
}

/* ============================================================
   WHISPER VIA WEB WORKER — Transkripsi lokal ID + EN
   Model: whisper-tiny / base / small (WebGPU → fallback WASM)
   ============================================================ */

export type WhisperModel = "tiny" | "base" | "small";

export const WHISPER_MODELS: Record<WhisperModel, { repo: string; label: string; size: string }> = {
  tiny: { repo: "Xenova/whisper-tiny", label: "TINY — DIBUNDEL · offline", size: "0 MB (sudah di aplikasi)" },
  base: { repo: "Xenova/whisper-base", label: "BASE — seimbang", size: "±85 MB" },
  small: { repo: "Xenova/whisper-small", label: "SMALL — akurat", size: "±270 MB" },
};

export interface TranscribeMeta {
  backend?: "webgpu" | "wasm";
  threads?: number;
  speechPct?: number;
  done?: number;
  total?: number;
  elapsed?: number; // detik berjalan
  eta?: number; // estimasi sisa detik
}

export interface WhisperRunState {
  running: boolean;
  p: number;
  stage: string;
  meta: TranscribeMeta;
}

/* ---------- status transkripsi global (bisa dilanggan UI) ---------- */

let runState: WhisperRunState = { running: false, p: 0, stage: "", meta: {} };
const listeners = new Set<(s: WhisperRunState) => void>();

function setState(patch: Partial<WhisperRunState>) {
  runState = { ...runState, ...patch };
  for (const l of Array.from(listeners)) {
    try {
      l(runState);
    } catch {
      /* listener mati — abaikan */
    }
  }
}

export function subscribeWhisper(cb: (s: WhisperRunState) => void): () => void {
  listeners.add(cb);
  cb(runState);
  return () => {
    listeners.delete(cb);
  };
}

export function whisperRunning(): boolean {
  return runState.running;
}

/* ---------- worker singleton ---------- */

let worker: Worker | null = null;
let activeReject: ((e: Error) => void) | null = null;

function spawnWorker(): Worker {
  if (worker) return worker;
  // URL relatif → aman di app:// (Electron) maupun http:// (dev)
  worker = new Worker("whisper-worker.js", { type: "module" });
  return worker;
}

/** hentikan transkripsi sekarang juga (worker dimatikan & dibuat ulang nanti) */
export function cancelWhisper() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  const rej = activeReject;
  activeReject = null;
  if (rej) rej(new Error("Dibatalkan"));
  setState({ running: false, p: 0, stage: "Dibatalkan" });
}

export interface WhisperResult {
  cues: { start: number; end: number; text: string }[];
  text: string;
  meta: TranscribeMeta;
}

export async function transcribe(
  audio16k: Float32Array,
  opts: {
    model: WhisperModel;
    language: "id" | "en" | "auto";
    task?: "transcribe" | "translate";
    onProgress?: (p: number, stage: string) => void;
    onMeta?: (meta: TranscribeMeta) => void;
  }
): Promise<WhisperResult> {
  if (runState.running) {
    throw new Error("Transkripsi sudah berjalan — tunggu selesai atau tekan BATAL.");
  }
  const w = spawnWorker();
  setState({ running: true, p: 0.01, stage: "Menyiapkan mesin AI di worker…", meta: {} });

  const res: any = await new Promise<any>((resolve, reject) => {
    activeReject = reject;
    const onMsg = (ev: MessageEvent) => {
      const m: any = ev.data;
      if (!m || m.runId === undefined) return;
      switch (m.type) {
        case "stage": {
          const p = typeof m.p === "number" ? m.p : runState.p;
          setState({ p, stage: m.stage ?? "" });
          opts.onProgress?.(p, m.stage ?? "");
          break;
        }
        case "meta": {
          const meta: TranscribeMeta = {
            ...runState.meta,
            backend: m.backend,
            threads: m.threads,
            ...(typeof m.speechPct === "number" ? { speechPct: m.speechPct } : {}),
          };
          setState({ meta });
          opts.onMeta?.(meta);
          break;
        }
        case "progress": {
          const meta: TranscribeMeta = {
            backend: m.backend,
            threads: m.threads,
            speechPct: m.speechPct,
            done: m.done,
            total: m.total,
            elapsed: m.elapsed,
            eta: m.eta,
          };
          const stage = `Transkripsi ${m.done}/${m.total} bagian${m.backend === "webgpu" ? " · WEBGPU" : ""}`;
          setState({ p: m.p, stage, meta });
          opts.onProgress?.(m.p, stage);
          opts.onMeta?.(meta);
          break;
        }
        case "done":
          w.removeEventListener("message", onMsg);
          activeReject = null;
          resolve(m);
          break;
        case "error":
          w.removeEventListener("message", onMsg);
          activeReject = null;
          reject(new Error(m.message ?? "Whisper worker error"));
          break;
      }
    };
    w.addEventListener("message", onMsg);
    // kirim PCM (transfer — tanpa salinan, hemat memori untuk video panjang)
    w.postMessage(
      {
        type: "run",
        pcm: audio16k,
        model: opts.model,
        language: opts.language,
        task: opts.task ?? "transcribe",
      },
      [audio16k.buffer]
    );
  });

  const meta: TranscribeMeta = {
    backend: res.backend,
    threads: res.threads,
    speechPct: res.speechPct,
  };
  setState({ running: false, p: 1, stage: "Selesai", meta });

  const cues = (res.cues ?? [])
    .map((c: any) => ({
      start: Number(c.start) || 0,
      end: Number(c.end) || 0,
      text: String(c.text ?? "").trim(),
    }))
    .filter((c: any) => c.text && c.end > c.start);

  return { cues, text: String(res.text ?? "").trim(), meta };
}

/* ---------- SRT ---------- */

function srtTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function cuesToSRT(
  cues: { start: number; end: number; text: string }[],
  useTranslated = false
): string {
  return cues
    .map((c, i) => {
      const txt = useTranslated && (c as { translated?: string }).translated ? (c as { translated?: string }).translated! : c.text;
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${txt}\n`;
    })
    .join("\n");
}
