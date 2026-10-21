"use client";

/* ============================================================
   CLIPPER EDITOR — Loader CDN (Transformers.js)
   Dimuat via CDN dinamis agar bebas masalah bundling.
   Model unduh SEKALI → tersimpan di Cache API browser → offline permanen.
   ============================================================ */

 
let transformersMod: any = null;
let loadingPromise: Promise<any> | null = null;

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5",
  "https://unpkg.com/@huggingface/transformers@3.7.5/dist/transformers.min.js",
];

async function cdnImport(url: string): Promise<unknown> {
   
  const fn = new Function("u", "return import(u)");
  return await fn(url);
}

export async function loadTransformers(
  onProgress?: (stage: string, p: number) => void
   
): Promise<any> {
  if (transformersMod) return transformersMod;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.("Memuat runtime AI…", 0.02);
    let mod: unknown = null;
    let lastErr: unknown = null;
    for (const url of CDN_URLS) {
      try {
        mod = await cdnImport(url);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!mod) {
      throw new Error(
        `Gagal memuat runtime Transformers.js dari CDN: ${String(lastErr)}. Periksa koneksi internet pertama kali.`
      );
    }
    transformersMod = mod;
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
  tiny: { repo: "Xenova/whisper-tiny", label: "TINY — cepat", size: "±45 MB" },
  base: { repo: "Xenova/whisper-base", label: "BASE — seimbang", size: "±85 MB" },
  small: { repo: "Xenova/whisper-small", label: "SMALL — akurat", size: "±270 MB" },
};

export async function getWhisper(
  model: WhisperModel,
  onProgress?: (p: number) => void
   
): Promise<any> {
  if (whisperCache[model]) return whisperCache[model];
  const T = await loadTransformers();
  const repo = WHISPER_MODELS[model].repo;
  const pipe = await T.pipeline("automatic-speech-recognition", repo, {
    dtype: "q8",
    progress_callback: (info: { status: string; progress?: number; file?: string }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        onProgress?.(info.progress / 100);
      }
    },
  });
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
  const pipe = await getWhisper(opts.model, (p) =>
    opts.onProgress?.(p * 0.9, "Mengunduh model Whisper (sekali saja)")
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
