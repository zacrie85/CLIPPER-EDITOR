"use client";

/* ============================================================
   CLIPPER EDITOR — Split Adegan Otomatis
   Analisis 100% offline: piksel + histogram,
   ambang adaptif median + k·MAD → potong tepat di pergantian adegan
   ============================================================ */

import { colorHistogram, histDistance, sampleFrames } from "./frames";
import { median, mad } from "./format";

export interface SceneResult {
  cuts: number[]; // waktu potong (detik), tidak termasuk 0 dan akhir
  scores: { t: number; d: number }[];
  threshold: number;
}

/**
 * Deteksi pergantian adegan.
 * @param url objectURL video
 * @param duration durasi
 * @param sensitivity 0..1 (makin tinggi makin peka → adegan lebih banyak)
 * @param minScene panjang adegan minimum (detik)
 * @param sampleFps laju sampling analisis (fps analisis, bukan fps video)
 */
export async function detectScenes(
  url: string,
  duration: number,
  sensitivity = 0.5,
  minScene = 2,
  sampleFps = 4,
  onProgress?: (p: number) => void
): Promise<SceneResult> {
  const W = 160;
  const H = 90;
  const total = Math.max(2, Math.floor(duration * sampleFps));
  const times: number[] = [];
  for (let i = 0; i < total; i++) times.push(i / sampleFps);

  const frames = await sampleFrames(url, times, W, H, (p) => onProgress?.(p * 0.8));

  // histogram per frame
  const hists: Float32Array[] = [];
  for (const f of frames) {
    const ctx = f.getContext("2d", { willReadFrequently: true })!;
    hists.push(colorHistogram(ctx, W, H));
  }

  // jarak antar frame berurutan
  const scores: { t: number; d: number }[] = [];
  for (let i = 1; i < frames.length; i++) {
    scores.push({ t: times[i], d: histDistance(hists[i - 1], hists[i]) });
  }

  const ds = scores.map((s) => s.d);
  const med = median(ds);
  const m = mad(ds, med);

  // k = koefisien kepekaan: 0.2 (peka) .. 2.2 (kaku)
  const k = 2.2 - sensitivity * 2.0;
  const threshold = med + k * Math.max(m, 0.004);

  // kumpulkan kandidat potong
  const cuts: number[] = [];
  let lastCut = 0;
  for (const s of scores) {
    if (s.d > threshold && s.t - lastCut >= minScene) {
      cuts.push(s.t);
      lastCut = s.t;
    }
  }

  onProgress?.(1);
  frames.forEach((f) => (f.width = 0));
  return { cuts, scores, threshold };
}

/** split per detik → batas tiap N detik */
export function splitBySeconds(duration: number, seconds: number): number[] {
  const cuts: number[] = [];
  for (let t = seconds; t < duration - 0.4; t += seconds) cuts.push(t);
  return cuts;
}

/** split jadi N bagian sama panjang */
export function splitByParts(duration: number, parts: number): number[] {
  const cuts: number[] = [];
  const n = Math.max(2, Math.floor(parts));
  for (let i = 1; i < n; i++) cuts.push((duration * i) / n);
  return cuts;
}
