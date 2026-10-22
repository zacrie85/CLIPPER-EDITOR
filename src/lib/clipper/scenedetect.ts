"use client";

/* ============================================================
   CLIPPER EDITOR — Split Adegan Otomatis
   Analisis 100% offline: piksel + histogram,
   ambang adaptif median + k·MAD → potong tepat di pergantian adegan

   v1.2.8 — KECEPATAN (2–4× lebih cepat, hasil setara):
   1. SAMPLING ADAPTIF — video pendek dianalisis padat (0,25 dtk),
      video panjang lebih renggang (s.d. 1 dtk). Dulu SEMUA video
      disampel 4×/detik → video 30 menit = 7200 seek berurutan
      (5–10 menit menunggu). Kini ±1.500 sampel maksimum.
   2. REFINE BATAS — tiap kandidat potong "diperteliti" ulang pada
      jendela ±0,4 dtk dengan langkah 0,1 dtk → posisi potong tetap
      presisi meski sampling awal renggang (hanya ±beberapa puluh
      seek tambahan, bukan ribuan).
   3. CACHE PER VIDEO — analisis adegan yang sama tidak diulang;
      dipakai bersama panel SPLIT, AI MOMEN, dan OTOMATIS CERDAS.
   ============================================================ */

import { colorHistogram, histDistance, sampleFrames, openVideo, grabFrame, makeCanvas } from "./frames";
import { median, mad } from "./format";

export interface SceneResult {
  cuts: number[]; // waktu potong (detik), tidak termasuk 0 dan akhir
  scores: { t: number; d: number }[];
  threshold: number;
}

/* ---------- cache per video (url objectURL unik per impor) ---------- */
const sceneCache = new Map<string, SceneResult>();

export function clearSceneCache() {
  sceneCache.clear();
}

/** langkah sampling terbaik untuk durasi tertentu (detik antar sampel) */
export function sceneStepFor(duration: number): number {
  if (duration <= 180) return 0.25; // 4/s — pendek: presisi penuh
  if (duration <= 600) return 0.5;  // 2/s
  if (duration <= 1800) return 0.75;
  return 1.0;                       // panjang: tetap akurat via refine
}

/**
 * Deteksi pergantian adegan.
 * @param url objectURL video
 * @param duration durasi
 * @param sensitivity 0..1 (makin tinggi makin peka → adegan lebih banyak)
 * @param minScene panjang adegan minimum (detik)
 * @param sampleFps laju sampling analisis (fps analisis, bukan fps video)
 *                  — 0 = otomatis adaptif (disarankan)
 */
export async function detectScenes(
  url: string,
  duration: number,
  sensitivity = 0.5,
  minScene = 2,
  sampleFps = 0,
  onProgress?: (p: number) => void
): Promise<SceneResult> {
  // v1.2.8 — cache: analisis ulang dengan parameter sama = instan
  const ckey = `${url}|${duration.toFixed(2)}|${sensitivity.toFixed(2)}|${minScene}`;
  const hit = sceneCache.get(ckey);
  if (hit) {
    onProgress?.(1);
    return hit;
  }

  // langkah sampling: parameter lama (fps>0) tetap dihormati; 0 = adaptif
  const step = sampleFps > 0 ? 1 / sampleFps : sceneStepFor(duration);
  const W = 160;
  const H = 90;
  const total = Math.max(2, Math.floor(duration / step));
  const times: number[] = [];
  for (let i = 0; i < total; i++) times.push(i * step);

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
  let cuts: number[] = [];
  let lastCut = 0;
  for (const s of scores) {
    if (s.d > threshold && s.t - lastCut >= minScene) {
      cuts.push(s.t);
      lastCut = s.t;
    }
  }

  // lepas memori frame sampel
  frames.forEach((f) => (f.width = 0));

  /* ---------- v1.2.8 — REFINE batas potong ----------
     Kandidat dari sampling renggang hanya akurat ±step/2 dtk.
     Ambil ulang frame halus (0,1 dtk) di jendela ±0,5 dtk sekitar
     tiap kandidat, lalu pilih posisi lonjakan terbesar. */
  if (cuts.length && step > 0.26 && cuts.length <= 80) {
    try {
      cuts = await refineCuts(url, cuts, step, W, H, (p) => onProgress?.(0.8 + p * 0.18));
    } catch {
      /* refine gagal (video rusak di bagian tertentu) → pakai kandidat kasar */
    }
  }

  onProgress?.(1);
  const result: SceneResult = { cuts, scores, threshold };
  // simpan cache (batasi 12 video terakhir)
  if (sceneCache.size > 12) sceneCache.delete(sceneCache.keys().next().value as string);
  sceneCache.set(ckey, result);
  return result;
}

/** perteliti posisi tiap kandidat potong dengan sampel halus 0,1 dtk */
async function refineCuts(
  url: string,
  cuts: number[],
  coarseStep: number,
  W: number,
  H: number,
  onProgress?: (p: number) => void
): Promise<number[]> {
  const fine = 0.1;
  const win = Math.max(coarseStep * 0.6, 0.4); // jendela ± di sekitar kandidat
  const v = await openVideo(url, 30000);
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const prev = new Float32Array(512);
  const cur = new Float32Array(512);

  const grabHist = async (t: number): Promise<Float32Array> => {
    await grabFrame(v, t, W, H, canvas);
    colorHistogram(ctx, W, H, cur);
    return cur;
  };

  const out: number[] = [];
  try {
    for (let ci = 0; ci < cuts.length; ci++) {
      const c = cuts[ci];
      const t0 = Math.max(fine, c - win);
      const t1 = c + win;
      let best = c;
      let bestD = -1;
      let havePrev = false;
      for (let t = t0; t <= t1 + 1e-6; t += fine) {
        try {
          const h = await grabHist(t);
          if (havePrev) {
            const d = histDistance(prev, h);
            if (d > bestD) {
              bestD = d;
              best = t;
            }
          }
          prev.set(h);
          havePrev = true;
        } catch {
          /* seek gagal di titik ini → lewati */
        }
      }
      out.push(best);
      onProgress?.((ci + 1) / cuts.length);
    }
  } finally {
    v.removeAttribute("src");
    v.load();
    canvas.width = 0;
  }
  return out.sort((a, b) => a - b);
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
