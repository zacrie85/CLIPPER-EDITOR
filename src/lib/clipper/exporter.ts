"use client";

/* ============================================================
   CLIPPER EDITOR — Engine Ekspor MP4 (WebCodecs + mp4-muxer)
   H.264 + AAC · 720p/1080p/2K/4K · rasio terkunci konsisten
   · bitrate otomatis (4K ≈ 4× 1080p) · KOMPRES PINTAR target MB
   · GPU/CPU · BATCH EKSPOR · GABUNG VIDEO · SPLIT per bagian
   ============================================================ */

import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from "mp4-muxer";
import {
  RESOLUTIONS, type ClipSettings, type ExportJob, type ExportRange,
  type ExportSettings, type MediaItem, type SpeakerSegment,
} from "./types";
import { drawComposite } from "./render";
import { seekVideo, makeCanvas, openVideo } from "./frames";
import { decodeAudioFile, renderMix } from "./audio";
import { composeMusic } from "./music";
import { analyzeSpeaker, buildCropKeys, type SpeakerAnalysis } from "./speaker";
import { ensureSubtitle, ensureMoments } from "./autopilot";
import { cancelWhisper } from "./whisper";
import { ensureFontsLoaded } from "./typography";
import { downloadBlob, safeName, uid } from "./format";
import { obtainSaveDir, resolveSaveFile, getSaveMode } from "./savedir";

/* ============================================================
   v1.2.8 — PENJAGA DIALOG FOLDER
   Ditemukan di regresi E2E OTOMATIS CERDAS: showDirectoryPicker
   bisa TIDAK PERNAH selesai (dialog tidak terlihat / tidak dijawab
   / window tersembunyi) → seluruh antrean ekspor menggantung diam
   di "Membaca audio…" tanpa pesan apa pun. Kini setiap permintaan
   folder diberi batas waktu 120 dtk — lewat itu otomatis jatuh ke
   jalur UNDUHAN (blob) dan ekspor tetap jalan.
   ============================================================ */
function obtainSaveDirSafe(): Promise<FileSystemDirectoryHandle | null> {
  return Promise.race([
    obtainSaveDir(false).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
  ]);
}

/** resolveSaveFile dengan penjaga dialog (120 dtk) → null = jalur unduhan */
function resolveSaveFileSafe(name: string): Promise<FileSystemFileHandle | null> {
  return Promise.race([
    resolveSaveFile(name).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
  ]);
}

/* ============================================================
   v1.2.6 — ANTI-FREEZE EKSPOR
   Laporan: "Encoding video 270/7239… 1%" beku + job lain mati di
   "Menunggu antrean… 0%" selamanya + tombol BATAL tidak bereaksi.

   Akar masalah yang diperbaiki di file ini:
   1. await seekVideo() bisa menggantung selamanya (rAF mati saat
      window minimize / event seeked hilang) → kini dilindungi
      raceStall(): batas waktu 45 dtk + BATAL tetap bereaksi.
   2. Tunggu onloadedmetadata video tanpa batas → kini openVideo()
      dengan timeout + pesan jelas.
   3. Loop backpressure encoder bisa berputar selamanya bila encoder
      mati → kini dibatasi 30 dtk + cek encodeErr/state tiap putaran.
   4. EKSPOR PARTS menumpuk SEMUA blob di RAM dulu (20 bagian ×
      ratusan MB = OOM crash) → kini tiap bagian DIUNDUH SEGERA.
   5. EKSPOR PARTS decode audio penuh 48 kHz BERULANG per bagian
      (20× decode!) → kini dibaca SEKALI untuk semua bagian.
   6. BATCH SEMUA hanya memakai media[0] untuk semua range →
      output video ke-2 dst SALAH → kini tiap video diproses sendiri.
   7. GABUNG VIDEO: timestamp audio mulai dari 0 per sumber →
      audio saling tumpang → kini offset global berjalan.
   ============================================================ */

/** lindungi promise dari menggantung selamanya: batas waktu + BATAL aktif.
    isCancelled dicek tiap 250 ms — tombol BATALKAN bekerja bahkan saat
    seek/encode sedang macet. */
function raceStall<T>(
  p: Promise<T>,
  isCancelled: (() => boolean) | undefined,
  ms: number,
  err: Error
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let iv: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (iv) { clearInterval(iv); iv = null; }
    };
    if (isCancelled) {
      iv = setInterval(() => {
        if (!done && isCancelled()) {
          done = true;
          cleanup();
          reject(new Error("Dibatalkan"));
        }
      }, 250);
    }
    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

/* ---------- cache analisis pembicara per media ---------- */
const speakerCache = new Map<string, SpeakerAnalysis>();

export async function getCachedSpeaker(
  media: MediaItem,
  cfg: ClipSettings["speaker"],
  onProgress?: (p: number, s: string) => void
): Promise<SpeakerAnalysis> {
  const key = `${media.id}|${cfg.useFace}|${cfg.useAudio}|${cfg.silent}`;
  const hit = speakerCache.get(key);
  if (hit) return hit;
  const a = await analyzeSpeaker(media.url, media.duration, cfg, onProgress);
  speakerCache.set(key, a);
  return a;
}

/* ---------- dimensi & bitrate ---------- */

export function outputDims(settings: ExportSettings, srcW: number, srcH: number): { w: number; h: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (settings.autoMode) {
    const k = settings.scale / 100;
    const dims = even(srcW * k), evenh = even(srcH * k);
    // rasio mengikuti sumber; vertikal dibalik sesuai konvensi
    return { w: dims, h: evenh };
  }
  // v1.2.7 — guard: resolusi tak dikenal (mis. localStorage korup) jangan
  // sampai TypeError merobohkan seluruh UI — jatuh ke 720p.
  const r = RESOLUTIONS[settings.resolution] ?? RESOLUTIONS["720p"];
  const d = settings.aspect === "9:16" ? r.portrait : r.landscape;
  return { w: d.w, h: d.h };
}

export function videoBitrate(settings: ExportSettings, duration: number, srcW: number, srcH: number): number {
  const q = settings.quality === "high" ? 1 : settings.quality === "balanced" ? 0.65 : 0.42;
  let mbps: number;
  if (settings.autoMode) {
    const dims = outputDims(settings, srcW, srcH);
    // skala bitrate terhadap piksel relatif ke 1080p
    const px = (dims.w * dims.h) / (1920 * 1080);
    mbps = Math.max(2, 10 * Math.sqrt(px));
  } else {
    const r = RESOLUTIONS[settings.resolution];
    mbps = settings.fps >= 60 ? r.mbps60 : r.mbps30;
  }
  let bitrate = Math.round(mbps * 1e6 * q);

  // KOMPRES PINTAR — target MB diutamakan bila diisi
  if (settings.targetMB && settings.targetMB > 0 && duration > 0) {
    const totalBits = settings.targetMB * 8 * 1048576;
    const audioBits = 160_000 * duration;
    const vb = Math.max(300_000, Math.floor(totalBits - audioBits) / duration);
    bitrate = Math.min(bitrate, Math.round(vb));
  }
  return bitrate;
}

/** codec string H.264 dengan level otomatis (5.1/5.2 utk 2K/4K incl 60fps) */
export function h264Codec(settings: ExportSettings, w: number, h: number): string {
  if (settings.autoMode) {
    const px = w * h;
    if (px >= 1920 * 2160) return settings.fps >= 60 ? "avc1.640034" : "avc1.640033";
    if (px >= 1280 * 1440) return "avc1.640033";
    if (px >= 1280 * 720) return "avc1.64002a";
    return "avc1.640028";
  }
  const r = RESOLUTIONS[settings.resolution];
  if (r.key === "4k") return settings.fps >= 60 ? "avc1.640034" : "avc1.640033";
  if (r.key === "2k") return "avc1.640033";
  if (r.key === "1080p") return "avc1.64002a";
  return "avc1.640028";
}

/* ---------- opsi render per frame ---------- */

interface RenderCtx {
  media: MediaItem;
  settings: ExportSettings;
  clip: ClipSettings;
  keys: CropKey[] | null;
  seg: SpeakerSegment[] | null;
}

type CropKey = ReturnType<typeof buildCropKeys>[number];

/* ---------- ekspor satu file ---------- */

/* ============================================================
   v1.2.7 — PENGECCEK KESEHATAN BLOB
   Di mesin RAM kecil / setelah encoding berat, data blob bisa
   TIDAK TERBACA (paging memori gagal) padahal size-nya benar —
   hasil unduhan 0 byte. Baca slice kepala + ekor sebelum diunduh;
   gagal = error JELAS (bukan file rusak diam-diam).
   ============================================================ */
async function assertBlobOk(blob: Blob, label: string): Promise<void> {
  try {
    await blob.slice(0, 64).arrayBuffer();
    const tail = Math.max(0, blob.size - 65_536);
    await blob.slice(tail).arrayBuffer();
  } catch {
    throw new Error(
      `${label}: hasil encode tidak dapat dibaca (memori penuh) — pilih SIMPAN KE FOLDER PILIHAN di panel Ekspor (ditulis langsung ke disk), atau tutup aplikasi lain lalu ulangi.`
    );
  }
}

export interface ExportOneOptions {
  media: MediaItem;
  ranges: { start: number; end: number }[];
  clip: ClipSettings;
  name: string;
  onProgress?: (p: number, stage: string) => void;
  shouldCancel?: () => boolean;
  /** v1.2.6 — audio 48 kHz hasil decode pemanggil (null = video tanpa audio).
      undefined = decode di sini (perilaku lama). Dipakai EKSPOR PARTS agar
      audio dibaca SEKALI untuk semua bagian, bukan N× decode penuh. */
  audioPre?: AudioBuffer | null;
  /** v1.2.7 — bila diisi: MP4 DITULIS LANGSUNG KE DISK selagi di-encode
      (File System Access API) — tanpa blob besar di memori. Return
      exportOne menjadi null (file sudah tersimpan; tidak perlu diunduh). */
  fileHandle?: FileSystemFileHandle | null;
}

export async function exportOne(opts: ExportOneOptions): Promise<Blob | null> {
  const { media, clip, name } = opts;
  const settings = clip.export;
  const totalDur = opts.ranges.reduce((a, r) => a + (r.end - r.start), 0);
  if (totalDur <= 0.05) throw new Error("Rentang ekspor kosong");

  await ensureFontsLoaded();
  opts.onProgress?.(0.01, "Menyiapkan encoder…");

  const dims = outputDims(settings, media.width || 1920, media.height || 1080);
  const bitrate = videoBitrate(settings, totalDur, media.width || 1920, media.height || 1080);
  const codec = h264Codec(settings, dims.w, dims.h);
  const fps = settings.fps;
  const frameDurUs = Math.round(1e6 / fps);

  const hw = settings.hw === "gpu" ? "prefer-hardware" : settings.hw === "cpu" ? "prefer-software" : "no-preference";

  const videoCfg: VideoEncoderConfig = {
    codec,
    width: dims.w,
    height: dims.h,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
    hardwareAcceleration: hw as VideoEncoderConfig["hardwareAcceleration"],
  };
  const vsup = await VideoEncoder.isConfigSupported(videoCfg);
  if (!vsup.supported) {
    // fallback tanpa hw preference
    const fallback = { ...videoCfg, hardwareAcceleration: "no-preference" as const };
    const f2 = await VideoEncoder.isConfigSupported(fallback);
    if (!f2.supported) throw new Error(`Encoder H.264 ${dims.w}×${dims.h} tidak didukung browser ini`);
    Object.assign(videoCfg, fallback);
  }

  /* ----- audio ----- */
  let audioSetup: AudioSetup | null = null;
  let mixed: AudioBuffer | null = null;
  let original: AudioBuffer | null = null;
  if (opts.audioPre !== undefined) {
    // v1.2.6 — sudah di-decode pemanggil (sekali untuk semua bagian split)
    original = opts.audioPre;
  } else {
    try {
      opts.onProgress?.(0.02, "Membaca audio video…");
      original = media.type === "video" ? await decodeAudioFile(media.url) : null;
    } catch {
      original = null;
    }
  }

  let musicBuf: AudioBuffer | null = null;
  if (clip.music.preset !== "none") {
    if (clip.music.customBuffer) {
      musicBuf = clip.music.customBuffer;
    } else {
      opts.onProgress?.(0.03, "Mengomposisi musik AI…");
      musicBuf = await composeMusic(clip.music.preset, totalDur, clip.music.fadeOut);
    }
  }

  const hasOriginalAudio = !!original && media.type === "video";
  const hasMusic = !!musicBuf;
  if (hasOriginalAudio || hasMusic) {
    opts.onProgress?.(0.05, "Mencampur audio…");
    audioSetup = await pickAudioConfig(48000);
    if (audioSetup) {
      mixed = await renderMix({
        duration: totalDur,
        sampleRate: audioSetup.cfg.sampleRate,
        channels: audioSetup.cfg.numberOfChannels,
        original: hasOriginalAudio ? original : null,
        originalStart: opts.ranges[0]?.start ?? 0,
        // ducking: kecilkan audio asli saat musik dipakai
        originalGain: hasMusic ? 1 - clip.music.duckOriginal * 0.8 : 1,
        music: musicBuf,
        musicGain: clip.music.gain,
        musicLoop: true,
        fadeIn: 0.4,
        fadeOut: clip.music.fadeOut,
      });
    }
  }

  /* ----- muxer -----
     v1.2.7 — fileHandle → tulis langsung ke disk (StreamTarget),
     tanpa buffer raksasa di RAM (menyembuhkan blob 0 byte di mesin
     RAM kecil). fastStart false = moov ditulis saat finalize. */
  let writable: FileSystemWritableFileStream | null = null;
  let target: ArrayBufferTarget | FileSystemWritableFileStreamTarget = new ArrayBufferTarget();
  if (opts.fileHandle) {
    try {
      writable = await opts.fileHandle.createWritable();
      target = new FileSystemWritableFileStreamTarget(writable);
    } catch {
      writable = null; // gagal buka file → jatuh ke blob
    }
  }
  if (!writable) target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: dims.w, height: dims.h, frameRate: fps },
    ...(audioSetup
      ? {
          audio: {
            codec: audioSetup.muxerCodec,
            sampleRate: audioSetup.cfg.sampleRate,
            numberOfChannels: audioSetup.cfg.numberOfChannels,
          },
        }
      : {}),
    fastStart: writable ? false : ("in-memory" as const),
  });

  /* ----- encoder video ----- */
  let encodeErr: Error | null = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        encodeErr = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      encodeErr = e instanceof Error ? e : new Error(String(e));
    },
  });
  venc.configure(videoCfg);

  /* ----- encoder audio ----- */
  let aenc: AudioEncoder | null = null;
  if (audioSetup && mixed) {
    aenc = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addAudioChunk(chunk, meta);
        } catch (e) {
          encodeErr = e instanceof Error ? e : new Error(String(e));
        }
      },
      error: (e) => {
        encodeErr = e instanceof Error ? e : new Error(String(e));
      },
    });
    aenc.configure(audioSetup.cfg);
  }

  /* ----- render frame per frame ----- */
  const canvas = makeCanvas(dims.w, dims.h);
  // v1.2.6 — openVideo: selalu ada batas waktu + pesan jelas
  const v = await openVideo(media.url, 30000);

  // siapkan keyframe zoom pembicara bila aktif
  let keys: CropKey[] | null = null;
  if (clip.speaker.enabled) {
    opts.onProgress?.(0.08, "Analisis zoom pembicara…");
    const analysis = await getCachedSpeaker(media, clip.speaker);
    keys = buildCropKeys(analysis, clip.speaker, (media.width || 16) / (media.height || 9));
  }

  const totalFrames = Math.ceil(totalDur * fps);
  let done = 0;
  let outTs = 0; // timestamp output mikrodetik

  for (const range of opts.ranges) {
    const nFrames = Math.ceil((range.end - range.start) * fps);
    for (let i = 0; i < nFrames; i++) {
      if (opts.shouldCancel?.()) {
        try { venc.close(); } catch { /* aman */ }
        if (aenc) { try { aenc.close(); } catch { /* aman */ } }
        throw new Error("Dibatalkan");
      }
      if (encodeErr) throw encodeErr;
      if (venc.state !== "configured") {
        throw new Error("Encoder video berhenti di tengah proses (driver/GPU) — coba ENCODER → CPU");
      }

      const t = range.start + i / fps;
      // v1.2.6 — seek dilindungi batas waktu 45 dtk + tombol BATAL tetap hidup.
      // Dulu: seek menggantung selamanya (rAF mati saat window minimize) →
      // job beku di frame terakhir dan seluruh antrean mati.
      await raceStall(
        seekVideo(v, t),
        opts.shouldCancel,
        45_000,
        new Error(
          `Seek frame ${done + 1}/${totalFrames} (t=${t.toFixed(2)} dtk) macet >45 dtk — job dihentikan otomatis`
        )
      );
      drawComposite({
        src: v,
        srcW: v.videoWidth || media.width,
        srcH: v.videoHeight || media.height,
        out: canvas,
        t,
        aspect: settings.aspect,
        zoomPan: clip.zoomPan,
        speakerKeys: keys,
        speakerCfg: clip.speaker,
        subtitle: clip.subtitle,
        texts: clip.texts,
        tracker: clip.tracker,
        watermark: clip.watermark,
        effects: clip.effects,
      });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(outTs),
        duration: frameDurUs,
      });
      venc.encode(frame, { keyFrame: done % (fps * 2) === 0 });
      frame.close();
      outTs += frameDurUs;
      done++;

      if (done % 5 === 0 || done === totalFrames) {
        opts.onProgress?.(
          0.1 + (done / totalFrames) * 0.82,
          `Encoding video ${done}/${totalFrames} frame · ${dims.w}×${dims.h}`
        );
        // beri napas UI & flush antrean agar mem stabil
        // v1.2.6 — tunggu antrean dibatasi 30 dtk + cek error encoder tiap putaran
        if (venc.encodeQueueSize > 12) {
          await new Promise((r) => setTimeout(r, 0));
          const t0 = Date.now();
          while (venc.encodeQueueSize > 6) {
            if (encodeErr) throw encodeErr;
            if (venc.state !== "configured") {
              throw new Error("Encoder video berhenti (antrean tidak berkurang) — coba ENCODER → CPU");
            }
            if (opts.shouldCancel?.()) throw new Error("Dibatalkan");
            if (Date.now() - t0 > 30_000) {
              throw new Error("Encoder video macet (antrean encode tidak berkurang 30 dtk) — job dihentikan otomatis");
            }
            await new Promise((r) => setTimeout(r, 8));
          }
        } else {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }

  opts.onProgress?.(0.94, "Finalisasi video…");
  await venc.flush();
  venc.close();

  /* ----- audio chunks ----- */
  if (aenc && mixed) {
    opts.onProgress?.(0.96, "Encoding audio AAC…");
    const sr = mixed.sampleRate;
    const chunkFrames = 4800; // 0.1s @48k
    const chans = Math.min(2, mixed.numberOfChannels);
    for (let off = 0; off < mixed.length; off += chunkFrames) {
      const n = Math.min(chunkFrames, mixed.length - off);
      const data = new Float32Array(n * chans);
      for (let c = 0; c < chans; c++) {
        const src = mixed.getChannelData(Math.min(c, mixed.numberOfChannels - 1));
        data.set(src.subarray(off, off + n), c * n);
      }
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate: sr,
        numberOfFrames: n,
        numberOfChannels: chans,
        timestamp: Math.round((off / sr) * 1e6),
        data,
      });
      aenc.encode(ad);
      ad.close();
      // v1.2.6 — antrean audio benar-benar dikuras (dulu cuma sleep 4 ms
      // tanpa menunggu → bisa membengkak di video panjang)
      if (aenc.encodeQueueSize > 16) {
        const t0 = Date.now();
        while (aenc.encodeQueueSize > 8) {
          if (encodeErr) throw encodeErr;
          if (Date.now() - t0 > 30_000) throw new Error("Encoder audio macet — job dihentikan otomatis");
          await new Promise((r) => setTimeout(r, 4));
        }
      }
    }
    await aenc.flush();
    aenc.close();
  }

  if (encodeErr) throw encodeErr;

  muxer.finalize();
  opts.onProgress?.(1, "Selesai");
  v.removeAttribute("src");
  v.load();
  canvas.width = 0;
  // v1.2.7 — jalur file: data sudah tertulis di disk selagi encode;
  // close() menyelesaikan file. Tidak ada blob, tidak ada unduhan.
  if (writable) {
    try { await writable.close(); } catch { /* file sudah tertulis */ }
    return null;
  }
  const blob = new Blob([(target as ArrayBufferTarget).buffer], { type: "video/mp4" });
  return blob;
}

/* ============================================================
   ANTREAN EKSPOR (job target: current / split / batch / merge)
   ============================================================ */

let cancelFlags = new Set<string>();

export function cancelJob(jobId: string) {
  cancelFlags.add(jobId);
}

/* ---------- pemilih encoder audio (AAC → Opus fallback) ---------- */

interface AudioSetup {
  cfg: AudioEncoderConfig;
  muxerCodec: "aac" | "opus";
}

async function pickAudioConfig(preferSampleRate = 48000): Promise<AudioSetup | null> {
  const bitrate = 160_000;
  const candidates: AudioEncoderConfig[] = [
    { codec: "mp4a.40.2", sampleRate: preferSampleRate, numberOfChannels: 2, bitrate },
    { codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate },
    { codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 1, bitrate },
    { codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate },
  ];
  for (const c of candidates) {
    try {
      if (!("AudioEncoder" in window)) return null;
      const sup = await AudioEncoder.isConfigSupported(c);
      if (sup.supported) {
        return {
          cfg: (sup.config as AudioEncoderConfig) ?? c,
          muxerCodec: c.codec === "opus" ? "opus" : "aac",
        };
      }
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return null;
}

async function runJob(job: ExportJob, media: MediaItem[], clip: ClipSettings, update: (p: Partial<ExportJob>) => void) {
  const rangesAll = job.ranges;
  try {
    update({ status: "running", stage: "Mulai…", progress: 0, startedAt: Date.now() });

    /* ============================================================
       v1.2.8 — OTOMATIS CERDAS
       Centangan di panel EKSPOR dijalankan DI SINI, sebelum encode:
       1. SUBTITLE AI — transkripsi bila video belum punya cue;
          hasil masuk ke store + snapshot clip job ini.
       2. AI MOMEN — cari momen viral; RENTANG EKSPOR DIGANTI jadi
          daftar momen (target otomatis berperilaku seperti split).
       3. PEMBICARA — zoom pembicara dinyalakan untuk job ini
          (analisis berjalan otomatis di exportOne). */
    const auto = job.auto;
    let clipUse = clip;
    let ranges = rangesAll;
    if (auto?.subtitle || auto?.moment || auto?.speaker) {
      const main = media[0];
      if (auto?.subtitle && main && main.type === "video") {
        const cues = await ensureSubtitle(main, {
          onProgress: (p, stage) => update({ progress: Math.min(p, 0.05), stage }),
          isCancelled: () => cancelFlags.has(job.id),
        });
        clipUse = {
          ...clipUse,
          subtitle: {
            ...clipUse.subtitle,
            cues,
            mode:
              cues.length && clipUse.subtitle.mode === "off"
                ? "burnin"
                : clipUse.subtitle.mode,
          },
        };
      }
      if (auto?.moment && main && main.type === "video") {
        let moments;
        try {
          moments = await ensureMoments(main, {
            onProgress: (p, stage) => update({ progress: 0.06 + p * 0.04, stage }),
            isCancelled: () => cancelFlags.has(job.id),
          });
          ranges = moments.map((m) => ({ mediaId: main.id, start: m.start, end: m.end }));
        } catch (me) {
          const msg = me instanceof Error ? me.message : String(me);
          if (/Dibatalkan/.test(msg)) throw me;
          // momen gagal / kosong → lanjut pakai rentang asli, jangan gagalkan ekspor
          update({ stage: `AI MOMEN dilewati — ${msg.slice(0, 90)}` });
        }
      }
      if (auto?.speaker) {
        clipUse = {
          ...clipUse,
          speaker: { ...clipUse.speaker, enabled: true },
        };
      }
    }

    if (job.target === "split") {
      // ekspor tiap bagian sebagai file terpisah
      const parts = ranges;
      /* v1.2.6 — audio 48 kHz dibaca SEKALI untuk semua bagian.
         Dulu: tiap bagian melakukan fetch + decode penuh berulang
         (20 bagian = 20× decode video panjang) → lambat & RAM meledak. */
      let audioPre: AudioBuffer | null = null;
      if (media[0].type === "video") {
        update({ stage: `Membaca audio (sekali untuk ${parts.length} bagian)…`, progress: 0.1 });
        try {
          audioPre = await decodeAudioFile(media[0].url);
        } catch {
          audioPre = null; // tanpa audio / codec aneh → lanjut tanpa audio
        }
      }
      let ok = 0;
      // v1.2.7 — folder simpanan diminta SEKALI di awal (bila mode FOLDER)
      // v1.2.8 — diberi batas waktu: dialog tak dijawab = jatuh ke UNDUHAN
      const useDir = getSaveMode() === "folder" ? await obtainSaveDirSafe() : null;
      for (let i = 0; i < parts.length; i++) {
        if (cancelFlags.has(job.id)) throw new Error("Dibatalkan");
        const r = parts[i];
        const partName = `${safeName(job.name)}_BAGIAN_${String(i + 1).padStart(2, "0")}.mp4`;
        const fh = useDir ? await resolveSaveFile(partName) : null;
        const blob = await exportOne({
          media: media[0],
          ranges: [{ start: r.start, end: r.end }],
          clip: clipUse,
          name: `${job.name}_part${String(i + 1).padStart(2, "0")}`,
          audioPre,
          fileHandle: fh,
          onProgress: (p, stage) =>
            update({ progress: 0.1 + ((i + p) / parts.length) * 0.89, stage: `Bagian ${i + 1}/${parts.length} — ${stage}` }),
          shouldCancel: () => cancelFlags.has(job.id),
        });
        if (blob) {
          /* v1.2.6 — tiap bagian DIUNDUH SEGERA setelah jadi.
             Dulu semua blob ditumpuk di RAM sampai bagian terakhir
             (20 × ratusan MB) → renderer OOM crash di tengah proses. */
          await assertBlobOk(blob, `Bagian ${i + 1}`);
          downloadBlob(blob, partName);
        }
        ok++;
        await new Promise((res) => setTimeout(res, 600));
      }
      update({ status: "done", progress: 1, stage: `${ok} file${useDir ? ` tersimpan di "${useDir.name}"` : " terunduh"}`, finishedAt: Date.now() });
      return;
    }

    if (job.target === "batch") {
      /* v1.2.6 — BUG LAMA: batch memakai media[0] untuk SEMUA range →
         video ke-2 dst ter-export SALAH (frame video pertama di-clamp).
         Kini tiap video diproses sendiri + diunduh segera. */
      let ok = 0;
      const gagal: string[] = [];
      // v1.2.7 — folder simpanan diminta SEKALI di awal (bila mode FOLDER)
      // v1.2.8 — diberi batas waktu: dialog tak dijawab = jatuh ke UNDUHAN
      const useDirB = getSaveMode() === "folder" ? await obtainSaveDirSafe() : null;
      for (let i = 0; i < rangesAll.length; i++) {
        if (cancelFlags.has(job.id)) throw new Error("Dibatalkan");
        const r = rangesAll[i];
        const m = media[i] ?? media[0];
        try {
          /* v1.2.8 — OTOMATIS CERDAS per video: subtitle & momen
             dianalisis untuk SETIAP video di batch (bukan hanya video
             pertama), lalu encode memakai hasilnya. */
          let clipV = clipUse;
          let rangesV: { start: number; end: number }[] = [{ start: r.start, end: r.end }];
          if (auto?.subtitle && m.type === "video") {
            const cuesV = await ensureSubtitle(m, {
              onProgress: (p, stage) =>
                update({ progress: (i + Math.min(p, 0.05)) / rangesAll.length * 0.95, stage: `Video ${i + 1}/${rangesAll.length} — ${stage}` }),
              isCancelled: () => cancelFlags.has(job.id),
            });
            clipV = {
              ...clipV,
              subtitle: {
                ...clipV.subtitle,
                cues: cuesV,
                mode: cuesV.length && clipV.subtitle.mode === "off" ? "burnin" : clipV.subtitle.mode,
              },
            };
          }
          if (auto?.moment && m.type === "video") {
            try {
              const mo = await ensureMoments(m, {
                onProgress: (p, stage) =>
                  update({ progress: (i + 0.06 + p * 0.04) / rangesAll.length * 0.95, stage: `Video ${i + 1}/${rangesAll.length} — ${stage}` }),
                isCancelled: () => cancelFlags.has(job.id),
              });
              rangesV = mo.map((x) => ({ start: x.start, end: x.end }));
            } catch (me) {
              if (/Dibatalkan/.test(me instanceof Error ? me.message : String(me))) throw me;
              /* momen kosong → video ini diekspor utuh */
            }
          }
          const outName = `${safeName(m.name)}_${String(i + 1).padStart(2, "0")}.mp4`;
          const fh = useDirB ? await resolveSaveFile(outName) : null;
          const blob = await exportOne({
            media: m,
            ranges: rangesV,
            clip: clipV,
            name: `${job.name}_video${String(i + 1).padStart(2, "0")}`,
            fileHandle: fh,
            onProgress: (p, stage) =>
              update({
                progress: (i + 0.1 + p * 0.85) / rangesAll.length,
                stage: `Video ${i + 1}/${rangesAll.length} (${m.name.slice(0, 24)}) — ${stage}`,
              }),
            shouldCancel: () => cancelFlags.has(job.id),
          });
          if (blob) {
            await assertBlobOk(blob, m.name.slice(0, 24));
            downloadBlob(blob, outName);
          }
          ok++;
          await new Promise((res) => setTimeout(res, 600));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "Dibatalkan") throw e;
          gagal.push(`${m.name.slice(0, 24)}: ${msg.slice(0, 80)}`);
        }
      }
      if (!ok) throw new Error(gagal.join(" · ") || "Semua video gagal");
      update({
        status: "done", progress: 1, finishedAt: Date.now(),
        stage: `${ok}/${rangesAll.length} video${useDirB ? ` tersimpan di "${useDirB.name}"` : " terunduh"}${gagal.length ? ` · ${gagal.length} gagal` : ""}`,
      });
      return;
    }

    // current / range — satu file output dari satu sumber
    if (job.target !== "merge" || media.length === 1) {
      // v1.2.7 — SIMPAN KE FOLDER: MP4 ditulis langsung ke disk selagi
      // encode (tanpa blob besar di RAM). Gagal pilih folder → jalur
      // unduhan browser + pengeccek kesehatan blob (bukan 0 byte diam).
      const outName = `${safeName(job.name)}.mp4`;
      // v1.2.8 — penjaga dialog: tak dijawab 120 dtk → jatuh ke unduhan
      const fh = getSaveMode() === "folder" ? await resolveSaveFileSafe(outName) : null;
      const blob = await exportOne({
        media: media[0],
        ranges: ranges.map((r) => ({ start: r.start, end: r.end })),
        clip: clipUse,
        name: job.name,
        fileHandle: fh,
        onProgress: (p, stage) => update({ progress: 0.1 + p * 0.89, stage }),
        shouldCancel: () => cancelFlags.has(job.id),
      });
      if (blob) {
        await assertBlobOk(blob, "Ekspor video");
        downloadBlob(blob, outName);
        update({ status: "done", progress: 1, stage: "MP4 terunduh", finishedAt: Date.now() });
      } else {
        update({ status: "done", progress: 1, stage: `MP4 tersimpan: ${outName}`, finishedAt: Date.now() });
      }
      return;
    }

    // merge multi-sumber
    const mergeName = `${safeName(job.name)}.mp4`;
    // v1.2.8 — penjaga dialog: tak dijawab 120 dtk → jatuh ke unduhan
    const mergeFh = getSaveMode() === "folder" ? await resolveSaveFileSafe(mergeName) : null;
    // v1.2.8 — momen hanya mengganti rentang bila merge satu sumber;
    // merge banyak video tetap memakai rentang utuh per video.
    const mergeRanges = auto?.moment && media.length > 1 ? rangesAll : ranges;
    const blob = await exportMerge(
      media.map((m, i) => ({ media: m, ranges: [mergeRanges[i] ?? rangesAll[i]] })),
      clipUse,
      job.name,
      (p, stage) => update({ progress: 0.1 + p * 0.89, stage }),
      () => cancelFlags.has(job.id),
      mergeFh
    );
    if (blob) {
      await assertBlobOk(blob, "Gabung video");
      downloadBlob(blob, mergeName);
      update({ status: "done", progress: 1, stage: "Gabungan MP4 terunduh", finishedAt: Date.now() });
    } else {
      update({ status: "done", progress: 1, stage: `Gabungan tersimpan: ${mergeName}`, finishedAt: Date.now() });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // v1.2.8 — bila dibatalkan di tengah transkripsi otomatis, matikan
    // worker Whisper agar tidak terus berjalan di latar belakang.
    if (msg === "Dibatalkan") {
      try { cancelWhisper(); } catch { /* aman */ }
    }
    update({
      status: msg === "Dibatalkan" ? "canceled" : "error",
      error: msg,
      stage: msg === "Dibatalkan" ? "Dibatalkan" : "Gagal",
      finishedAt: Date.now(),
    });
  } finally {
    cancelFlags.delete(job.id);
  }
}

/** GABUNG VIDEO — banyak sumber menjadi satu MP4 (hard cut) */
export async function exportMerge(
  items: { media: MediaItem; ranges: { start: number; end: number }[] }[],
  clip: ClipSettings,
  name: string,
  onProgress?: (p: number, stage: string) => void,
  shouldCancel?: () => boolean,
  fileHandle?: FileSystemFileHandle | null
): Promise<Blob | null> {
  // gabung jadi satu daftar range lintas sumber; exportOne memproses berurutan
  // implementasi: render per sumber ke buffer frame → terlalu berat; gunakan
  // strategi encode berurutan dengan muxer bersama via exportMulti
  return exportMulti(items.map((it) => ({ media: it.media, ranges: it.ranges })), clip, onProgress, shouldCancel, fileHandle);
}

/** ekspor multi-sumber ke SATU file (dipakai gabung video) */
async function exportMulti(
  sources: { media: MediaItem; ranges: { start: number; end: number }[] }[],
  clip: ClipSettings,
  onProgress?: (p: number, stage: string) => void,
  shouldCancel?: () => boolean,
  fileHandle?: FileSystemFileHandle | null
): Promise<Blob | null> {
  const settings = clip.export;
  const first = sources[0].media;
  const totalDur = sources.reduce((a, s) => a + s.ranges.reduce((b, r) => b + r.end - r.start, 0), 0);
  await ensureFontsLoaded();

  const dims = outputDims(settings, first.width || 1920, first.height || 1080);
  const bitrate = videoBitrate(settings, totalDur, first.width || 1920, first.height || 1080);
  const codec = h264Codec(settings, dims.w, dims.h);
  const fps = settings.fps;
  const frameDurUs = Math.round(1e6 / fps);

  const audioSetup = await pickAudioConfig(48000);
  // v1.2.7 — dukung tulis langsung ke disk (sama seperti exportOne)
  let writable: FileSystemWritableFileStream | null = null;
  let target: ArrayBufferTarget | FileSystemWritableFileStreamTarget = new ArrayBufferTarget();
  if (fileHandle) {
    try {
      writable = await fileHandle.createWritable();
      target = new FileSystemWritableFileStreamTarget(writable);
    } catch {
      writable = null;
    }
  }
  if (!writable) target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: dims.w, height: dims.h, frameRate: fps },
    ...(audioSetup
      ? {
          audio: {
            codec: audioSetup.muxerCodec,
            sampleRate: audioSetup.cfg.sampleRate,
            numberOfChannels: audioSetup.cfg.numberOfChannels,
          },
        }
      : {}),
    fastStart: writable ? false : ("in-memory" as const),
  });

  let encodeErr: Error | null = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeErr = e instanceof Error ? e : new Error(String(e))),
  });
  venc.configure({
    codec, width: dims.w, height: dims.h, bitrate, framerate: fps,
    latencyMode: "quality",
  } as VideoEncoderConfig);

  const aenc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (encodeErr = e instanceof Error ? e : new Error(String(e))),
  });
  if (audioSetup) aenc.configure(audioSetup.cfg);

  const canvas = makeCanvas(dims.w, dims.h);
  const totalFrames = Math.ceil(totalDur * fps);
  let done = 0;
  let outTs = 0;
  /* v1.2.6 — timestamp audio GLOBAL: dulu mulai dari 0 per sumber,
     sehingga audio video ke-2 menimpa audio video pertama di muxer
     (output rusak/saling tumpang). Kini offset berjalan sepanjang gabungan. */
  let audioTsUs = 0;

  for (const src of sources) {
    // v1.2.6 — openVideo: batas waktu + pesan jelas per sumber
    const v = await openVideo(src.media.url, 30000).catch((e) => {
      throw new Error(`${src.media.name}: ${e instanceof Error ? e.message : e}`);
    });

    let keys: CropKey[] | null = null;
    if (clip.speaker.enabled) {
      const analysis = await getCachedSpeaker(src.media, clip.speaker);
      keys = buildCropKeys(analysis, clip.speaker, (src.media.width || 16) / (src.media.height || 9));
    }

    // audio sumber → decode sekali per sumber
    let origBuf: AudioBuffer | null = null;
    try {
      origBuf = await decodeAudioFile(src.media.url);
    } catch { origBuf = null; }

    let musicBuf: AudioBuffer | null = null;
    if (clip.music.preset !== "none") {
      musicBuf = clip.music.customBuffer ?? (await composeMusic(clip.music.preset, totalDur, clip.music.fadeOut));
    }

    const segDur = src.ranges.reduce((a, r) => a + r.end - r.start, 0);
    let mixedSeg: AudioBuffer | null = null;
    if (audioSetup && (origBuf || musicBuf)) {
      mixedSeg = await renderMix({
        duration: segDur,
        sampleRate: audioSetup.cfg.sampleRate,
        channels: audioSetup.cfg.numberOfChannels,
        original: origBuf,
        originalStart: src.ranges[0]?.start ?? 0,
        originalGain: musicBuf ? 1 - clip.music.duckOriginal * 0.8 : 1,
        music: musicBuf,
        musicGain: clip.music.gain,
        musicLoop: true,
        fadeIn: 0.3,
        fadeOut: 0.3,
      });
    }

    for (const range of src.ranges) {
      const nFrames = Math.ceil((range.end - range.start) * fps);
      for (let i = 0; i < nFrames; i++) {
        if (shouldCancel?.()) {
          try { venc.close(); aenc.close(); } catch { /* aman */ }
          throw new Error("Dibatalkan");
        }
        if (encodeErr) throw encodeErr;
        if (venc.state !== "configured") {
          throw new Error("Encoder video berhenti di tengah proses — coba ENCODER → CPU");
        }
        const t = range.start + i / fps;
        // v1.2.6 — seek dilindungi batas waktu + BATAL tetap bereaksi
        await raceStall(
          seekVideo(v, t),
          shouldCancel,
          45_000,
          new Error(`Seek macet >45 dtk (t=${t.toFixed(2)} dtk) — job dihentikan otomatis`)
        );
        drawComposite({
          src: v,
          srcW: v.videoWidth || src.media.width,
          srcH: v.videoHeight || src.media.height,
          out: canvas,
          t,
          aspect: settings.aspect,
          zoomPan: clip.zoomPan,
          speakerKeys: keys,
          speakerCfg: clip.speaker,
          subtitle: clip.subtitle,
          texts: clip.texts,
          tracker: clip.tracker,
          watermark: clip.watermark,
          effects: clip.effects,
        });
        const frame = new VideoFrame(canvas, { timestamp: Math.round(outTs), duration: frameDurUs });
        venc.encode(frame, { keyFrame: done % (fps * 2) === 0 });
        frame.close();
        outTs += frameDurUs;
        done++;
        if (done % 5 === 0 || done === totalFrames) {
          onProgress?.(0.05 + (done / totalFrames) * 0.9, `Gabung ${done}/${totalFrames} frame`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }

    // audio segmen ini — timestamp GLOBAL (v1.2.6)
    if (mixedSeg && audioSetup) {
      const sr = mixedSeg.sampleRate;
      const chunkFrames = 4800;
      const chans = Math.min(2, mixedSeg.numberOfChannels);
      for (let off = 0; off < mixedSeg.length; off += chunkFrames) {
        const n = Math.min(chunkFrames, mixedSeg.length - off);
        const data = new Float32Array(n * chans);
        for (let c = 0; c < chans; c++) {
          const s = mixedSeg.getChannelData(Math.min(c, mixedSeg.numberOfChannels - 1));
          data.set(s.subarray(off, off + n), c * n);
        }
        const ad = new AudioData({
          format: "f32-planar", sampleRate: sr, numberOfFrames: n,
          numberOfChannels: chans,
          timestamp: Math.round(audioTsUs + (off / sr) * 1e6), data,
        });
        aenc.encode(ad);
        ad.close();
        if (aenc.encodeQueueSize > 16) {
          const t0 = Date.now();
          while (aenc.encodeQueueSize > 8) {
            if (encodeErr) throw encodeErr;
            if (Date.now() - t0 > 30_000) throw new Error("Encoder audio macet — job dihentikan otomatis");
            await new Promise((r) => setTimeout(r, 4));
          }
        }
      }
      audioTsUs += Math.round((mixedSeg.length / sr) * 1e6);
    }

    v.removeAttribute("src");
    v.load();
  }

  onProgress?.(0.96, "Finalisasi…");
  await venc.flush();
  venc.close();
  if (audioSetup) {
    await aenc.flush();
    aenc.close();
  }
  if (encodeErr) throw encodeErr;
  muxer.finalize();
  canvas.width = 0;
  // v1.2.7 — jalur file: sudah tertulis di disk; jalur blob: bungkus buffer
  if (writable) {
    try { await writable.close(); } catch { /* file sudah tertulis */ }
    return null;
  }
  return new Blob([(target as ArrayBufferTarget).buffer], { type: "video/mp4" });
}

/* ---------- antrean utama ---------- */

export async function processJob(
  job: ExportJob,
  getMedia: (id: string) => MediaItem | undefined,
  clip: ClipSettings,
  update: (p: Partial<ExportJob>) => void
) {
  const media = job.ranges.map((r) => getMedia(r.mediaId)).filter(Boolean) as MediaItem[];
  if (!media.length) {
    update({ status: "error", error: "Media tidak ditemukan" });
    return;
  }
  await runJob(job, media, clip, update);
}

export function newJobId(): string {
  return uid("job");
}
