"use client";

/* ============================================================
   CLIPPER EDITOR — ZOOM PEMBICARA OTOMATIS (100% offline)
   Tiga sinyal digabung:
   1. AI deteksi orang   — YOLOS-tiny (posisi & ukuran)
   2. Gerakan mulut/wajah — selisih piksel area kepala antar frame
   3. Kapan ada suara     — envelope RMS stereo (kiri/kanan)
   + Mode cadangan 2-bagian (kiri/kanan) bila AI sulit mengenali
   ============================================================ */

import type { SpeakerConfig, SpeakerSegment } from "./types";
import { sampleFrames, regionDiff } from "./frames";
import { detectPersons, PersonTracker, type DetBox } from "./detection";
import { stereoEnvelope, decodeAudioFile, type EnvelopePoint } from "./audio";
import { clamp } from "./format";

export interface SpeakerAnalysis {
  segments: SpeakerSegment[];
  persons: { id: number; box: DetBox; samples: number }[];
  fallback: boolean; // true = memakai mode 2-bagian
  fps: number; // laju sampling analisis
}

const ANALYSIS_W = 320;
const ANALYSIS_H = 180;

export async function analyzeSpeaker(
  url: string,
  duration: number,
  cfg: SpeakerConfig,
  onProgress?: (p: number, stage: string) => void
): Promise<SpeakerAnalysis> {
  const step = 0.5; // analisis 2x per detik
  const n = Math.max(2, Math.floor(duration / step));
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(i * step);

  onProgress?.(0.02, "Mengambil frame sampel…");
  const frames = await sampleFrames(url, times, ANALYSIS_W, ANALYSIS_H, (p) =>
    onProgress?.(0.02 + p * 0.18, "Mengambil frame sampel…")
  );

  /* ---- Sinyal 1: deteksi orang + Sinyal 2: gerakan kepala/mulut ---- */
  const tracker = new PersonTracker();
  const perFrameIds: number[][] = [];
  const headMotion: Record<number, number[]> = {};

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const ctx = f.getContext("2d", { willReadFrequently: true })!;
    let boxes: DetBox[] = [];
    try {
      if (cfg.useFace) {
        boxes = await detectPersons(f);
        onProgress?.(0.2 + (i / frames.length) * 0.5, `AI mendeteksi orang… (${i + 1}/${frames.length})`);
      }
    } catch {
      boxes = [];
    }
    const ids = tracker.update(boxes);
    perFrameIds.push(ids);

    // gerakan area kepala per trek (bandingkan dengan frame sampel sebelumnya)
    if (i > 0 && boxes.length) {
      const prev = frames[i - 1].getContext("2d", { willReadFrequently: true })!;
      ids.forEach((id, bi) => {
        const b = boxes[bi];
        // area kepala = 35% atas kotak orang
        const x = Math.floor(clamp(b.x + b.w * 0.2, 0, 1) * ANALYSIS_W);
        const y = Math.floor(clamp(b.y + b.h * 0.08, 0, 1) * ANALYSIS_H);
        const w = Math.max(4, Math.floor(b.w * 0.6 * ANALYSIS_W));
        const h = Math.max(4, Math.floor(b.h * 0.3 * ANALYSIS_H));
        try {
          const d = regionDiff(prev, ctx, x, y, Math.min(w, ANALYSIS_W - x), Math.min(h, ANALYSIS_H - y));
          (headMotion[id] ??= []).push(d);
        } catch {
          (headMotion[id] ??= []).push(0);
        }
      });
    }
    void ctx;
  }

  const persons = tracker.tracks.map((t) => ({ id: t.id, box: t.box, samples: t.samples }));
  const fallback = persons.length < 2; // AI sulit → mode 2-bagian

  /* ---- Sinyal 3: audio (kapan suara + arah kiri/kanan) ---- */
  onProgress?.(0.75, "Menganalisis gelombang suara…");
  let env: EnvelopePoint[] = [];
  try {
    const buf = await decodeAudioFile(url);
    env = stereoEnvelope(buf, 0.25);
  } catch {
    env = [];
  }

  const rmsMax = Math.max(1e-6, ...env.map((e) => e.rms));
  const isLoud = (t: number) => {
    const e = env[Math.floor(t / 0.25)];
    return e ? e.rms > rmsMax * 0.18 : false;
  };
  const sideBias = (t: number): number => {
    // <0 condong kiri, >0 condong kanan, 0 netral/mono
    const e = env[Math.floor(t / 0.25)];
    if (!e) return 0;
    const tot = e.l + e.r;
    if (tot < 1e-6) return 0;
    return (e.r - e.l) / tot;
  };

  /* ---- gabungkan sinyal → pembicara aktif per jendela ---- */
  onProgress?.(0.85, "Menggabungkan sinyal AI + audio…");

  type Win = { t: number; person: number; conf: number };
  const wins: Win[] = [];

  // skor per trek per jendela
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const ids = perFrameIds[i] ?? [];
    const scores: Record<number, number> = {};
    ids.forEach((id) => {
      let s = 0;
      // gerakan kepala (normalisasi kasar)
      const mo = (headMotion[id]?.[i - 1] ?? 0);
      if (cfg.useFace) s += clamp(mo * 6, 0, 1) * 0.5;
      // posisi vs bias audio
      if (cfg.useAudio) {
        const tr = persons.find((p) => p.id === id);
        if (tr) {
          const cx = tr.box.x + tr.box.w / 2;
          const bias = sideBias(t);
          // kiri(-) cocok dengan cx kecil, kanan(+) cocok dengan cx besar
          s += clamp(0.5 - Math.abs((bias < 0 ? cx : 1 - cx)) * 0.5, 0, 0.3) * (Math.abs(bias) > 0.06 ? 1 : 0.2);
        }
      }
      // ukuran (orang terdekat kamera cenderung bicara)
      const tr2 = persons.find((p) => p.id === id);
      if (tr2 && cfg.useFace) s += clamp((tr2.box.w * tr2.box.h) / 0.12, 0, 0.25);
      scores[id] = s;
    });

    const loud = isLoud(t);
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    let person = -1;
    let conf = 0;

    if (entries.length) {
      const [topId, topS] = entries[0];
      const secondS = entries[1]?.[1] ?? 0;
      if (!loud && cfg.silent === "hold") {
        // senyap: pertahankan pembicara sebelumnya
        const prev = [...wins].reverse().find((w) => w.person >= 0);
        person = prev ? prev.person : -1;
        conf = 0.2;
      } else if (!loud && cfg.silent === "all") {
        person = -1;
        conf = 0.2;
      } else if (entries.length === 1 || topS - secondS > 0.12) {
        person = Number(topId);
        conf = clamp(topS + 0.2, 0, 1);
      } else if (topS > 0.35) {
        person = Number(topId);
        conf = 0.45;
      } else {
        person = cfg.silent === "all" ? -1 : Number(topId);
        conf = 0.3;
      }
    } else {
      // tidak ada deteksi → fallback 2-bagian pakai audio
      person = -1;
      conf = 0;
    }
    wins.push({ t, person, conf });
  }

  // mode cadangan 2-bagian penuh bila deteksi gagal total
  const segments: SpeakerSegment[] = [];
  if (fallback) {
    for (const w of wins) {
      const bias = sideBias(w.t);
      const loud = isLoud(w.t);
      const zone: 0 | 1 | -1 = !loud
        ? cfg.silent === "all" ? -1 : (segments.at(-1)?.zone ?? -1)
        : bias < -0.04 ? 0
        : bias > 0.04 ? 1
        : cfg.silent === "all" ? -1 : (segments.at(-1)?.zone ?? 0);
      segments.push({ t0: w.t, t1: w.t + step, person: zone === -1 ? -1 : (zone === 0 ? 0 : 1), zone, conf: loud ? 0.5 : 0.2 });
    }
  } else {
    // map id trek → indeks 0..n-1 (urut posisi rata-rata kiri→kanan)
    const order = [...persons].sort((a, b) => a.box.x - b.box.x);
    const idxOf = (id: number) => Math.max(0, order.findIndex((p) => p.id === id));
    for (const w of wins) {
      segments.push({
        t0: w.t,
        t1: w.t + step,
        person: w.person >= 0 ? idxOf(w.person) : -1,
        zone: w.person >= 0 ? (idxOf(w.person) === 0 ? 0 : 1) : -1,
        conf: w.conf,
      });
    }
  }

  // rapikan: gabungkan segmen berurutan dengan pembicara sama (histeresis)
  const merged: SpeakerSegment[] = [];
  const minHold = 1.0; // tahan minimal 1 detik agar tidak kedip-kedip
  for (const s of segments) {
    const last = merged.at(-1);
    if (last && last.person === s.person && last.zone === s.zone) {
      last.t1 = s.t1;
    } else if (last && s.t0 - last.t0 < minHold && last.person >= 0 && s.person >= 0) {
      // ganti terlalu cepat → biar yang lama menang
      last.t1 = s.t1;
    } else {
      merged.push({ ...s });
    }
  }
  merged.forEach((s, i) => (s.t1 = merged[i + 1]?.t0 ?? duration));

  onProgress?.(1, "Analisis pembicara selesai");
  frames.forEach((f) => (f.width = 0));

  return {
    segments: merged,
    persons: persons.map((p) => ({ id: p.id, box: p.box, samples: p.samples })),
    fallback,
    fps: 1 / step,
  };
}

/* ============================================================
   PERENCANA CROP — dipakai renderer & ekspor
   ============================================================ */

export interface CropKey {
  t: number;
  /** kotak crop sumber (normalisasi) yang akan di-fit ke 9:16 */
  crop: { x: number; y: number; w: number; h: number } | null;
  person: number;
}

const SPEED_DUR: Record<string, number> = { fast: 0.25, normal: 0.5, slow: 1.0 };

/** bangun keyframe crop dari hasil analisis */
export function buildCropKeys(
  analysis: SpeakerAnalysis,
  cfg: SpeakerConfig,
  srcAspect: number // w/h sumber
): CropKey[] {
  const keys: CropKey[] = [];
  const persons = analysis.persons.length
    ? [...analysis.persons].sort((a, b) => a.box.x - b.box.x)
    : [];

  const wideCrop = (): { x: number; y: number; w: number; h: number } => {
    // fit seluruh frame — 9:16 center crop lebar penuh
    const w = 1;
    const h = Math.min(1, w / (9 / 16) / srcAspect);
    return { x: 0, y: (1 - h) / 2, w, h };
  };

  const personCrop = (idx: number): { x: number; y: number; w: number; h: number } | null => {
    const p = persons[idx];
    if (!p) return null;
    const pad = 0.55; // ruang di sekitar orang
    let w = Math.min(1, p.box.w * (1 + pad * 2));
    // jaga rasio 9:16 pada crop
    let h = w / (9 / 16) / srcAspect;
    if (h > 1) {
      h = 1;
      w = h * (9 / 16) * srcAspect;
    }
    if (w > 1) { w = 1; h = w / (9 / 16) / srcAspect; }
    const cx = p.box.x + p.box.w / 2;
    const cy = p.box.y + p.box.h * 0.42; // sedikit di atas tengah (wajah)
    return {
      x: clamp(cx - w / 2, 0, 1 - w),
      y: clamp(cy - h / 2, 0, 1 - h),
      w, h,
    };
  };

  // fallback 2-bagian
  const zoneCrop = (zone: 0 | 1 | -1) => {
    if (zone === -1) return wideCrop();
    const w = 0.5;
    const h = w / (9 / 16) / srcAspect;
    if (h > 1) {
      const h2 = 1;
      const w2 = h2 * (9 / 16) * srcAspect;
      return { x: zone === 0 ? 0 : 1 - w2, y: 0, w: w2, h: h2 };
    }
    return { x: zone === 0 ? 0 : 0.5, y: (1 - h) / 2, w, h };
  };

  const activeCrop = (person: number, zone: 0 | 1 | -1) => {
    if (analysis.fallback || !persons.length) return zoneCrop(zone);
    if (person < 0) return wideCrop();
    return personCrop(person) ?? wideCrop();
  };

  for (const s of analysis.segments) {
    keys.push({ t: s.t0, crop: activeCrop(s.person, s.zone), person: s.person });
  }
  if (!keys.length) keys.push({ t: 0, crop: wideCrop(), person: -1 });
  return keys;
}

export interface CropAtResult {
  a: CropKey;
  b: CropKey | null;
  /** 0..1 posisi blending antara a → b (0 = penuh a) */
  mix: number;
}

/** interpolasi crop pada waktu t (geser halus = lerp, fade & cut = switch dengan mix utk crossfade) */
export function cropAt(
  keys: CropKey[],
  t: number,
  cfg: SpeakerConfig,
  duration: number
): CropAtResult {
  if (!keys.length) return { a: { t: 0, crop: null, person: -1 }, b: null, mix: 0 };
  const tDur = SPEED_DUR[cfg.speed] ?? 0.5;

  let i = 0;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t + 1e-6) i = k;
  const a = keys[i];
  const b = keys[i + 1] ?? null;

  if (!b) return { a, b: null, mix: 0 };

  const dist = b.t - a.t;
  if (dist <= 0.01) return { a, b: null, mix: 0 };

  const since = t - a.t;

  if (cfg.transition === "cut") {
    return { a, b: null, mix: 0 };
  }
  if (cfg.transition === "pan") {
    // lerp posisi crop selama tDur setelah pergantian
    const p = clamp(since / tDur, 0, 1);
    if (p >= 1) return { a, b: null, mix: 0 };
    // easing halus
    const e = p * p * (3 - 2 * p);
    return { a, b, mix: e };
  }
  // fade — crossfade selama tDur setelah pergantian
  const p = clamp(since / tDur, 0, 1);
  if (p >= 1) return { a, b: null, mix: 0 };
  return { a, b, mix: p };
}

export function lerpCrop(a: CropKey, b: CropKey, mix: number) {
  if (!a.crop) return b.crop!;
  if (!b.crop) return a.crop;
  return {
    x: a.crop.x + (b.crop.x - a.crop.x) * mix,
    y: a.crop.y + (b.crop.y - a.crop.y) * mix,
    w: a.crop.w + (b.crop.w - a.crop.w) * mix,
    h: a.crop.h + (b.crop.h - a.crop.h) * mix,
  };
}
