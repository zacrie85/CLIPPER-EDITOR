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
   WHISPER — Transkripsi lokal Bahasa Indonesia + English
   Model: Xenova/whisper-tiny / base / small
   ============================================================ */

let whisperCache: Record<string, any> = {};

export type WhisperModel = "tiny" | "base" | "small";

export const WHISPER_MODELS: Record<WhisperModel, { repo: string; label: string; size: string }> = {
  tiny: { repo: "Xenova/whisper-tiny", label: "TINY — DIBUNDEL · offline", size: "0 MB (sudah di aplikasi)" },
  base: { repo: "Xenova/whisper-base", label: "BASE — seimbang", size: "±85 MB" },
  small: { repo: "Xenova/whisper-small", label: "SMALL — akurat", size: "±270 MB" },
};

/** cek apakah model sudah tersimpan di Cache API browser (offline-ready) */
async function modelCached(repo: string): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(repo));
  } catch {
    return false;
  }
}

/** cek apakah model ikut dibundel di dalam aplikasi (/models/) */
async function modelBundled(repo: string): Promise<boolean> {
  try {
    const r = await fetch(`/models/${repo}/config.json`);
    return r.ok;
  } catch {
    return false;
  }
}

const ERR_OFFLINE =
  "Model belum tersedia offline & tidak ada koneksi internet. " +
  "Hubungkan internet SEKALI saja untuk unduh model, setelah itu offline permanen. " +
  "Atau pakai model TINY — sudah dibundel di dalam aplikasi, 100% offline.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** buat pipeline; unduhan HF gagal → ulangi maks 3× (tanpa mirror — CORS mati) */
async function buildPipeline(
  T: any,
  repo: string,
  onProgress?: (p: number) => void
): Promise<any> {
  const make = () =>
    T.pipeline("automatic-speech-recognition", repo, {
      dtype: "q8",
      progress_callback: (info: { status: string; progress?: number; file?: string }) => {
        if (info.status === "progress" && typeof info.progress === "number") {
          onProgress?.(info.progress / 100);
        }
      },
    });

  const attempts = 3;
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await make();
    } catch (e) {
      lastErr = e;
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline && !(await modelBundled(repo)) && !(await modelCached(repo))) {
        throw new Error(ERR_OFFLINE);
      }
      if (i < attempts - 1) await sleep(1200);
    }
  }
  throw new Error(
    `Gagal memuat model (${String((lastErr as Error)?.message ?? lastErr).slice(0, 140)}). ` +
      "Periksa koneksi internet lalu coba lagi — atau pakai model TINY (dibundel, 100% offline)."
  );
}

export async function getWhisper(
  model: WhisperModel,
  onProgress?: (p: number) => void
): Promise<any> {
  if (whisperCache[model]) return whisperCache[model];
  const T = await loadTransformers();
  const repo = WHISPER_MODELS[model].repo;
  const pipe = await buildPipeline(T, repo, onProgress);
  whisperCache[model] = pipe;
  return pipe;
}

export interface WhisperResult {
  cues: { start: number; end: number; text: string }[];
  text: string;
}

export async function transcribe(
  audio16k: Float32Array,
  opts: {
    model: WhisperModel;
    language: "id" | "en" | "auto";
    task?: "transcribe" | "translate";
    onProgress?: (p: number, stage: string) => void;
  }
): Promise<WhisperResult> {
  const info = WHISPER_MODELS[opts.model];
  const bundled = await modelBundled(info.repo);
  const cached = (await modelCached(info.repo)) || bundled;
  const pipe = await getWhisper(opts.model, (p) =>
    opts.onProgress?.(
      p * 0.9,
      bundled
        ? `Memuat model ${opts.model.toUpperCase()} dari aplikasi — 100% offline…`
        : cached
          ? `Memuat model ${opts.model.toUpperCase()} dari cache — offline…`
          : `Mengunduh model ${opts.model.toUpperCase()} ${info.size} (sekali saja) — ${Math.round(p * 100)}%`
    )
  );
  opts.onProgress?.(0.92, "Transkripsi berjalan — 100% lokal");

  const language = opts.language === "auto" ? undefined : opts.language;
  const out = await pipe(audio16k, {
    language,
    task: opts.task ?? "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });

  opts.onProgress?.(1, "Selesai");

  const chunks: any[] = out?.chunks ?? [];
  const cues = chunks
    .map((c) => ({
      start: (c.timestamp?.[0] ?? 0) as any as number,
      end: (c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 2) as any as number,
      text: String(c.text ?? "").trim(),
    }))
    .filter((c) => c.text && isFinite(c.start) && isFinite(c.end));

  return { cues, text: String(out?.text ?? "").trim() };
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
