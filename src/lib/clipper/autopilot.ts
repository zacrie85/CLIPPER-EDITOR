"use client";

/* ============================================================
   CLIPPER EDITOR — OTOMATIS CERDAS (v1.2.8)
   Centang di panel EKSPOR → antrean ekspor menjalankan sendiri:
   • SUBTITLE AI  — transkripsi Whisper bila video belum punya teks
   • AI MOMEN     — cari momen viral (hook/pacing/konteks) lalu
                    tiap momen dijadikan bagian ekspor tersendiri
   • PEMBICARA    — zoom pembicara otomatis (dijalankan exporter
                    via clip.speaker.enabled — tidak lewat file ini)

   Semua hasil DISIMPAN di store + cache, jadi:
   → panel Subtitle/Momen menampilkan hasil yang sama (tidak diulang)
   → ekspor berikutnya langsung loncat ke encode

   v1.2.8 kecepatan: audio didecode 16 kHz (3–4× lebih cepat &
   hemat RAM daripada 48 kHz) + cache adegan dipakai bersama
   panel SPLIT + AI MOMEN.
   ============================================================ */

import { useClipper } from "./store";
import { decodeAudioFile16k, decodeAudioFile, rmsEnvelope } from "./audio";
import { detectScenes } from "./scenedetect";
import { analyzeMoments, type MomentSuggestion } from "./momentfinder";
import {
  transcribe, whisperRunning, whisperReset,
  subPersistedModel, subPersistedLang,
  WHISPER_MODELS, type WhisperModel,
} from "./whisper";
import type { MediaItem } from "./types";

export interface AutoProgress {
  (p: number, stage: string): void;
}

/* ---------- SUBTITLE AI OTOMATIS ---------- */

/** id media yang cue subtitle-nya sedang tersimpan di store */
let lastSubMediaId: string | null = null;

export function subtitleBelongsTo(): string | null {
  return lastSubMediaId;
}

/** paksa cache cue dianggap kosong (mis. pengguna hapus manual) */
export function invalidateSubtitleCache() {
  lastSubMediaId = null;
}

/**
 * Pastikan video punya cue subtitle. Sudah ada → langsung pakai
 * (instan, tanpa AI). Belum ada → transkripsi Whisper offline.
 */
export async function ensureSubtitle(
  media: MediaItem,
  opts?: {
    onProgress?: AutoProgress;
    isCancelled?: () => boolean;
  }
): Promise<{ start: number; end: number; text: string }[]> {
  const st = useClipper.getState();
  const existing = st.settings.subtitle.cues;

  // 1) sudah ada cue untuk video ini → pakai (tidak diulang)
  if (existing.length > 0 && lastSubMediaId === media.id) {
    opts?.onProgress?.(0.02, "Subtitle sudah tersedia — langsung dipakai");
    return existing;
  }

  // 2) transkripsi sedang berjalan manual? → jangan tabrakan
  if (whisperRunning()) {
    throw new Error(
      "SUBTITLE AI sedang berjalan di panel Subtitle — tunggu selesai lalu ulangi ekspor."
    );
  }

  const model: WhisperModel = subPersistedModel();
  const language = subPersistedLang();
  const cancel = opts?.isCancelled;

  opts?.onProgress?.(0.01, `SUBTITLE AI otomatis — membaca audio (${WHISPER_MODELS[model].repo})…`);

  /* decode 16 kHz — sama seperti panel Subtitle (hemat RAM & waktu) */
  const pcm = await decodeAudioFile16k(
    media.url,
    (mb, totalMb) => {
      opts?.onProgress?.(
        0.02,
        totalMb
          ? `SUBTITLE AI — membaca audio ${mb.toFixed(0)}/${totalMb.toFixed(0)} MB…`
          : `SUBTITLE AI — membaca audio ${mb.toFixed(0)} MB…`
      );
    },
    () => !!cancel?.(),
    (s) => opts?.onProgress?.(0.04, `SUBTITLE AI — ${s}`)
  );
  if (cancel?.()) throw new Error("Dibatalkan");

  opts?.onProgress?.(0.06, `SUBTITLE AI — transkripsi lokal (${model.toUpperCase()})…`);

  const res = await transcribe(pcm, {
    model,
    language,
    onProgress: (p, stage) => {
      opts?.onProgress?.(0.06 + p * 0.09, `SUBTITLE AI — ${stage}`);
    },
  });

  if (cancel?.()) throw new Error("Dibatalkan");

  // simpan ke store → panel Subtitle & ekspor berikutnya ikut memakai
  const st2 = useClipper.getState();
  st2.patchSubtitle({
    cues: res.cues,
    mode: st2.settings.subtitle.mode === "off" ? "burnin" : st2.settings.subtitle.mode,
  });
  st2.setModels({ whisper: "ready", whisperProgress: 1, whisperReady: WHISPER_MODELS[model].repo });
  lastSubMediaId = media.id;

  if (!res.cues.length) {
    whisperReset();
    // tanpa cue → lanjut tanpa subtitle, jangan gagalkan ekspor
  }
  return res.cues;
}

/* ---------- AI MOMEN OTOMATIS ---------- */

/**
 * Analisis momen viral untuk video. Hasil tersimpan di store
 * (panel AI Momen menampilkan daftar yang sama).
 * cues bila tersedia dipakai → jalankan subtitle dulu agar skor akurat.
 */
export async function ensureMoments(
  media: MediaItem,
  opts?: {
    lens?: number | number[];
    onProgress?: AutoProgress;
    isCancelled?: () => boolean;
  }
): Promise<MomentSuggestion[]> {
  const st = useClipper.getState();

  // 1) hasil analisis sebelumnya untuk video ini → pakai ulang (instan)
  const cached = st.moments[media.id];
  if (cached && cached.length > 0) {
    opts?.onProgress?.(0.05, "AI MOMEN — pakai hasil analisis terakhir");
    return cached;
  }

  const cancel = opts?.isCancelled;
  if (cancel?.()) throw new Error("Dibatalkan");

  // 2) envelope audio — 16 kHz (v1.2.8: 3–4× lebih cepat dari 48 kHz)
  opts?.onProgress?.(0.02, "AI MOMEN — membaca gelombang audio…");
  let env: { t: number; rms: number }[] = [];
  try {
    const buf = await decodeAudioFile(media.url, 120_000, 16000);
    env = rmsEnvelope(buf, 0.25);
  } catch {
    env = []; // tanpa audio → analisis visual saja
  }
  if (cancel?.()) throw new Error("Dibatalkan");

  // 3) potongan adegan — cache dipakai bersama panel SPLIT
  let cuts: number[] = [];
  if (media.type === "video") {
    opts?.onProgress?.(0.15, "AI MOMEN — memetakan potongan adegan…");
    try {
      const sc = await detectScenes(media.url, media.duration, 0.55, 1.5, 0, (p) =>
        opts?.onProgress?.(0.15 + p * 0.55, "AI MOMEN — memetakan potongan adegan…")
      );
      cuts = sc.cuts;
    } catch {
      cuts = [];
    }
  }
  if (cancel?.()) throw new Error("Dibatalkan");

  // 4) skor HOOK · PACING · KONTEKS — pakai cue bila sudah ada
  const cues = st.settings.subtitle.cues;
  const lensList =
    opts?.lens === undefined
      ? [10, 15, 20, 30, 45, 60, 90, 120, 180].filter((L) => L <= media.duration)
      : Array.isArray(opts.lens)
        ? opts.lens
        : [opts.lens];
  if (!lensList.length) lensList.push(Math.max(8, Math.floor(media.duration)));

  opts?.onProgress?.(0.75, "AI MOMEN — menyusun skor HOOK · PACING · KONTEKS…");
  const res = analyzeMoments({
    duration: media.duration,
    cuts,
    cues,
    envelope: env,
    lens: lensList,
  });

  st.setMoments(media.id, res);
  if (!res.length) {
    throw new Error(
      "AI MOMEN tidak menemukan momen menonjol — video mungkin terlalu pendek/monoton. Ekspor dilanjutkan tanpa pembagian momen."
    );
  }
  return res;
}
