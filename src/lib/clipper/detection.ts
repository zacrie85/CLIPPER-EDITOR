"use client";

/* ============================================================
   CLIPPER EDITOR — Deteksi Orang (YOLOS-tiny ONNX ±10 MB)
   Unduh sekali via Transformers.js → offline permanen.
   Dipakai: zoom pembicara otomatis.
   ============================================================ */

import { loadTransformers } from "./whisper";

 
let detectorCache: any = null;

export async function getDetector(
  onProgress?: (p: number) => void
   
): Promise<any> {
  if (detectorCache) return detectorCache;
  const T = await loadTransformers();
  const pipe = await T.pipeline("object-detection", "Xenova/yolos-tiny", {
    dtype: "q8",
    progress_callback: (info: { status: string; progress?: number }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        onProgress?.(info.progress / 100);
      }
    },
  });
  detectorCache = pipe;
  return pipe;
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

/** deteksi orang pada satu frame canvas → kotak normalisasi */
export async function detectPersons(canvas: HTMLCanvasElement): Promise<DetBox[]> {
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
