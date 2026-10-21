"use client";

/* ============================================================
   CLIPPER EDITOR — Engine Ekspor MP4 (WebCodecs + mp4-muxer)
   H.264 + AAC · 720p/1080p/2K/4K · rasio terkunci konsisten
   · bitrate otomatis (4K ≈ 4× 1080p) · KOMPRES PINTAR target MB
   · GPU/CPU · BATCH EKSPOR · GABUNG VIDEO · SPLIT per bagian
   ============================================================ */

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import {
  RESOLUTIONS, type ClipSettings, type ExportJob, type ExportRange,
  type ExportSettings, type MediaItem, type SpeakerSegment,
} from "./types";
import { drawComposite } from "./render";
import { seekVideo, makeCanvas } from "./frames";
import { decodeAudioFile, renderMix } from "./audio";
import { composeMusic } from "./music";
import { analyzeSpeaker, buildCropKeys, type SpeakerAnalysis } from "./speaker";
import { ensureFontsLoaded } from "./typography";
import { downloadBlob, safeName, uid } from "./format";

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
  const r = RESOLUTIONS[settings.resolution];
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

export interface ExportOneOptions {
  media: MediaItem;
  ranges: { start: number; end: number }[];
  clip: ClipSettings;
  name: string;
  onProgress?: (p: number, stage: string) => void;
  shouldCancel?: () => boolean;
}

export async function exportOne(opts: ExportOneOptions): Promise<Blob> {
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
  try {
    original = media.type === "video" ? await decodeAudioFile(media.url) : null;
  } catch {
    original = null;
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

  /* ----- muxer ----- */
  const target = new ArrayBufferTarget();
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
    fastStart: "in-memory",
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
  const v = document.createElement("video");
  v.src = media.url;
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  await new Promise<void>((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error("Video tidak dapat dibuka untuk ekspor"));
  });

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

      const t = range.start + i / fps;
      await seekVideo(v, t);
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
        if (venc.encodeQueueSize > 12) {
          await new Promise((r) => setTimeout(r, 0));
          while (venc.encodeQueueSize > 6) {
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
      if (aenc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 4));
    }
    await aenc.flush();
    aenc.close();
  }

  if (encodeErr) throw encodeErr;

  muxer.finalize();
  const blob = new Blob([target.buffer], { type: "video/mp4" });
  opts.onProgress?.(1, "Selesai");
  v.removeAttribute("src");
  v.load();
  canvas.width = 0;
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

    if (job.target === "split") {
      // ekspor tiap bagian sebagai file terpisah
      const parts = rangesAll;
      const results: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const r = parts[i];
        const blob = await exportOne({
          media: media[0],
          ranges: [{ start: r.start, end: r.end }],
          clip: clip,
          name: `${job.name}_part${String(i + 1).padStart(2, "0")}`,
          onProgress: (p, stage) =>
            update({ progress: (i + p) / parts.length * 0.99, stage: `Bagian ${i + 1}/${parts.length} — ${stage}` }),
          shouldCancel: () => cancelFlags.has(job.id),
        });
        results.push({ name: `${safeName(job.name)}_BAGIAN_${String(i + 1).padStart(2, "0")}.mp4`, blob });
      }
      for (const r of results) {
        downloadBlob(r.blob, r.name);
        await new Promise((res) => setTimeout(res, 700));
      }
      update({ status: "done", progress: 1, stage: `${results.length} file terunduh`, finishedAt: Date.now() });
      return;
    }

    // current / range — satu file output dari satu sumber
    if (job.target !== "merge" || media.length === 1) {
      const blob = await exportOne({
        media: media[0],
        ranges: rangesAll.map((r) => ({ start: r.start, end: r.end })),
        clip: { ...clip },
        name: job.name,
        onProgress: (p, stage) => update({ progress: p * 0.99, stage }),
        shouldCancel: () => cancelFlags.has(job.id),
      });
      downloadBlob(blob, `${safeName(job.name)}.mp4`);
      update({ status: "done", progress: 1, stage: "MP4 terunduh", finishedAt: Date.now() });
      return;
    }

    // merge multi-sumber
    const blob = await exportMerge(
      media.map((m, i) => ({ media: m, ranges: [rangesAll[i]] })),
      clip,
      job.name,
      (p, stage) => update({ progress: p * 0.99, stage }),
      () => cancelFlags.has(job.id)
    );
    downloadBlob(blob, `${safeName(job.name)}.mp4`);
    update({ status: "done", progress: 1, stage: "Gabungan MP4 terunduh", finishedAt: Date.now() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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
  shouldCancel?: () => boolean
): Promise<Blob> {
  // gabung jadi satu daftar range lintas sumber; exportOne memproses berurutan
  // implementasi: render per sumber ke buffer frame → terlalu berat; gunakan
  // strategi encode berurutan dengan muxer bersama via exportMulti
  return exportMulti(items.map((it) => ({ media: it.media, ranges: it.ranges })), clip, onProgress, shouldCancel);
}

/** ekspor multi-sumber ke SATU file (dipakai gabung video) */
async function exportMulti(
  sources: { media: MediaItem; ranges: { start: number; end: number }[] }[],
  clip: ClipSettings,
  onProgress?: (p: number, stage: string) => void,
  shouldCancel?: () => boolean
): Promise<Blob> {
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
  const target = new ArrayBufferTarget();
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
    fastStart: "in-memory",
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

  for (const src of sources) {
    const v = document.createElement("video");
    v.src = src.media.url;
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error(`Tidak dapat membuka ${src.media.name}`));
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
        const t = range.start + i / fps;
        await seekVideo(v, t);
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

    // audio segmen ini
    if (mixedSeg) {
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
          numberOfChannels: chans, timestamp: Math.round((off / sr) * 1e6), data,
        });
        aenc.encode(ad);
        ad.close();
      }
    }

    v.removeAttribute("src");
    v.load();
  }

  onProgress?.(0.96, "Finalisasi…");
  await venc.flush();
  venc.close();
  await aenc.flush();
  aenc.close();
  if (encodeErr) throw encodeErr;
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: "video/mp4" });
  canvas.width = 0;
  return blob;
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
