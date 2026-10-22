"use client";

/* ============================================================
   CLIPPER EDITOR — Deteksi Orang (YOLOS-tiny ONNX ±10 MB)
   Unduh sekali via Transformers.js → offline permanen.
   Dipakai: zoom pembicara otomatis.

   v1.2.7 — KECEPATAN:
   • WEBGPU didahulukan (fp32) → deteksi orang ±5–10× lebih cepat
     daripada WASM. Probe adapter + device diberi batas waktu 8 dtk
     (driver macet tidak menggantung aplikasi).
   • Bila WebGPU gagal memuat / crash saat dipakai → otomatis pulih
     ke WASM q8 SEKALI JALAN (tidak mengulang percobaan GPU tiap
     frame) — hasil analisis tetap jalan di semua mesin.
   ============================================================ */

import { loadTransformers } from "./whisper";

 
let detectorCache: any = null;
let backendKind: "webgpu" | "wasm" = "wasm";
let gpuBroken = false; // GPU sudah terbukti gagal saat dipakai → jangan coba lagi

const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(label + " timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** probe WebGPU 8 dtk — requestAdapter/requestDevice yang menggantung = tidak ada */
async function webgpuOk(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: any })?.gpu;
    if (typeof navigator === "undefined" || !gpu) return false;
    const ad = await withTimeout(
      gpu.requestAdapter({ powerPreference: "high-performance" }),
      8000,
      "requestAdapter"
    );
    if (!ad) return false;
    const dev = (ad as unknown as { requestDevice: () => Promise<any> }).requestDevice();
    const devOk = await withTimeout(dev, 8000, "requestDevice");
    try { devOk?.close?.(); } catch {}
    return !!devOk;
  } catch {
    return false;
  }
}

export async function getDetector(
  onProgress?: (p: number) => void
   
): Promise<any> {
  if (detectorCache) return detectorCache;
  const T = await loadTransformers();
  const cb = (info: { status: string; progress?: number }) => {
    if (info.status === "progress" && typeof info.progress === "number") {
      onProgress?.(info.progress / 100);
    }
  };

  // 1) coba WEBGPU (cepat) — sekali saja, tidak saat gpuBroken
  if (!gpuBroken && (await webgpuOk())) {
    try {
      detectorCache = await withTimeout(
        T.pipeline("object-detection", "Xenova/yolos-tiny", {
          device: "webgpu",
          dtype: "fp32",
          progress_callback: cb,
        }),
        120_000,
        "Memuat model WebGPU"
      );
      backendKind = "webgpu";
      return detectorCache;
    } catch {
      // muat GPU gagal (driver lama / unduhan putus) → jatuh ke WASM
      detectorCache = null;
    }
  }

  // 2) WASM q8 — selalu bisa (±10 MB)
  detectorCache = await T.pipeline("object-detection", "Xenova/yolos-tiny", {
    dtype: "q8",
    progress_callback: cb,
  });
  backendKind = "wasm";
  return detectorCache;
}

/** mesin deteksi aktif — "webgpu" | "wasm" (untuk tampilan panel) */
export function detectorBackend(): "webgpu" | "wasm" {
  return backendKind;
}

/* v1.2.8 — PEMANASAN DETEKTOR DI LATAR BELAKANG.
   YOLOS-tiny (±10 MB) diunduh & diinit saat pengguna masih memilih
   split — saat analisis pembicara dimulai, AI sudah siap. Aman
   dipanggil berkali-kali (hanya sekali yang benar-benar memuat). */
let warmStarted = false;
export function warmDetector() {
  if (warmStarted || detectorCache) return;
  warmStarted = true;
  getDetector().catch(() => {
    warmStarted = false; // gagal (mis. offline) → boleh coba lagi nanti
  });
}

export interface DetBox {
  /** koordinat normalisasi 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  label: string;
}

/** deteksi orang pada satu frame canvas → kotak normalisasi.
    v1.2.7 — bila inferensi WebGPU gagal/crash di tengah pemakaian,
    detector dibangun ulang sebagai WASM SEKALI lalu dicoba ulang. */
export async function detectPersons(canvas: HTMLCanvasElement): Promise<DetBox[]> {
  const run = async (): Promise<DetBox[]> => {
    const pipe = await getDetector();
    const out = await pipe(canvas, { threshold: 0.55, percentage: true });
    const boxes: DetBox[] = [];
   
    for (const r of out as any[]) {
      const label = String(r.label ?? "").toLowerCase();
      if (label !== "person" && label !== "human") continue;
      const score = Number(r.score ?? 0);
      if (score < 0.55) continue;
      let { xmin, ymin, xmax, ymax } = r.box ?? {};
      if (xmin === undefined) continue;
      boxes.push({
        x: Math.max(0, Math.min(1, xmin)),
        y: Math.max(0, Math.min(1, ymin)),
        w: Math.max(0.02, Math.min(1, xmax - xmin)),
        h: Math.max(0.02, Math.min(1, ymax - ymin)),
        score,
        label,
      });
    }
    // urutkan kiri → kanan agar stabil (pembicara 1 = kiri, 2 = kanan)
    boxes.sort((a, b) => a.x - b.x);
    return boxes;
  };

  try {
    return await run();
  } catch (e) {
    if (backendKind === "webgpu" && !gpuBroken) {
      gpuBroken = true;
      detectorCache = null;
      try { console.warn("[detection] WebGPU gagal saat inferensi — pulih ke WASM sekali:", String(e).slice(0, 120)); } catch {}
      return await run(); // percobaan tunggal dengan WASM
    }
    throw e;
  }
}

/* ---------- pelacakan antar sampel (asosiasi IoU) ---------- */

export interface PersonTrack {
  id: number;
  /** rata-rata kotak (normalisasi) */
  box: DetBox;
  samples: number;
}

function iou(a: DetBox, b: DetBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

export class PersonTracker {
  tracks: PersonTrack[] = [];
  nextId = 0;

  /** masukkan kotak frame baru; kembalikan id per kotak */
  update(boxes: DetBox[]): number[] {
    const assigned: number[] = [];
    const used = new Set<number>();
    for (const b of boxes) {
      let bestId = -1;
      let bestIou = 0.25;
      let bestIdx = -1;
      this.tracks.forEach((tr, idx) => {
        if (used.has(tr.id)) return;
        const s = iou(tr.box, b);
        if (s > bestIou) {
          bestIou = s;
          bestId = tr.id;
          bestIdx = idx;
        }
      });
      if (bestId >= 0) {
        used.add(bestId);
        assigned.push(bestId);
        // perbarui rata-rata bergerak
        const tr = this.tracks[bestIdx];
        const k = Math.min(0.7, 1 / (tr.samples + 1));
        tr.box = {
          ...b,
          x: tr.box.x * (1 - k) + b.x * k,
          y: tr.box.y * (1 - k) + b.y * k,
          w: tr.box.w * (1 - k) + b.w * k,
          h: tr.box.h * (1 - k) + b.h * k,
          score: tr.box.score * 0.7 + b.score * 0.3,
        };
        tr.samples++;
      } else {
        const id = this.nextId++;
        this.tracks.push({ id, box: { ...b }, samples: 1 });
        used.add(id);
        assigned.push(id);
      }
    }
    // buang trek sudah lama tidak terlihat
    this.tracks = this.tracks.filter((tr) => used.has(tr.id) || tr.samples > 3);
    this.tracks = this.tracks.filter((tr) => used.has(tr.id));
    return assigned;
  }
}
