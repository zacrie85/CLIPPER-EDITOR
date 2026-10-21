"use client";

/* ============================================================
   CLIPPER EDITOR — Audio engine
   Decode, resample 16kHz mono (Whisper), envelope RMS (pembicara),
   mixing offline (musik + asli + ducking + fade)
   ============================================================ */

let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function decodeAudioFile(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  try {
    return await ctx().decodeAudioData(arr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/decod|encoding|unable/i.test(msg)) {
      throw new Error(
        "Audio di file ini tidak bisa didecode browser — biasanya video .TS / .M2TS atau codec AC3/DTS. " +
          "Konversi dulu ke MP4/MKV/WEBM, atau impor audionya langsung sebagai MP3/WAV."
      );
    }
    throw e;
  }
}

/** gabungkan channel → mono, resample ke 16kHz → Float32Array (format Whisper) */
export function toMono16k(buffer: AudioBuffer): Float32Array {
  const target = 16000;
  const length = Math.ceil(buffer.duration * target);
  const off = new OfflineAudioContext(1, length, target);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering().then((r) => r.getChannelData(0)) as unknown as Float32Array;
}

export async function mono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const target = 16000;
  const length = Math.max(1, Math.ceil(buffer.duration * target));
  const off = new OfflineAudioContext(1, length, target);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

/* ============================================================
   KHUSUS SUBTITLE — v1.2.4
   Masalah lama (v1.2.3 dan sebelumnya): decodeAudioFile() men_decode
   audio 48 kHz stereo di main thread (±1,4 GB per jam video), lalu
   mono16k() me-render ulang + .slice() (dobel memori lagi). Untuk
   video panjang RAM bisa > 2 GB → renderer OOM → LAYAR BLANK +
   aplikasi hang, tanpa satu pun indikator di UI.

   Solusi di sini:
   1. decodeAudioData pada AudioContext sampleRate 16.000 Hz —
      audio langsung di-resample saat decode → buffer 16 kHz
      (±3–5× lebih kecil dari 48 kHz stereo).
   2. Downmix stereo → mono dengan loop manual (cepat, tanpa
      OfflineAudioContext render) dan TANPA .slice().
   3. fetch streaming + onProgress(MB) → UI menunjukkan aktifitas.
   4. isCancelled() dicek tiap potongan unduhan → tombol BATALKAN
      bekerja bahkan sebelum transkripsi dimulai.
   ============================================================ */

export async function decodeAudioFile16k(
  url: string,
  onProgress?: (mb: number, totalMb: number | null) => void,
  isCancelled?: () => boolean
): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal membaca media (${res.status})`);

  // --- unduh streaming dengan progress (jangan tunggu seluruh file diam-diam) ---
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  let arr: ArrayBuffer;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      if (isCancelled?.()) throw new Error("Dibatalkan");
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded / 1048576, total ? total / 1048576 : null);
    }
    const joined = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.byteLength;
    }
    chunks.length = 0; // lepas referensi secepatnya
    arr = joined.buffer;
  } else {
    arr = await res.arrayBuffer();
  }

  if (isCancelled?.()) throw new Error("Dibatalkan");

  // --- decode LANGSUNG di 16 kHz (resample otomatis saat decode) ---
  let ctx16: AudioContext | null = null;
  try {
    ctx16 = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx16 = null; // browser aneh → pakai jalur lama
  }

  let buffer: AudioBuffer;
  try {
    buffer = ctx16
      ? await ctx16.decodeAudioData(arr)
      : await new AudioContext().decodeAudioData(arr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/decod|encoding|unable/i.test(msg)) {
      throw new Error(
        "Audio di file ini tidak bisa didecode browser — biasanya video .TS / .M2TS atau codec AC3/DTS. " +
          "Konversi dulu ke MP4/MKV/WEBM, atau impor audionya langsung sebagai MP3/WAV."
      );
    }
    throw e;
  } finally {
    // decodeAudioData melepas (detach) arr — tutup context agar memori bebas
    try { await ctx16?.close(); } catch { /* abaikan */ }
    ctx16 = null;
  }

  if (isCancelled?.()) throw new Error("Dibatalkan");

  // --- downmix mono manual (tanpa OfflineAudioContext, tanpa .slice()) ---
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = R ? (L[i] + R[i]) * 0.5 : L[i];
  }

  // resample manual bila decode tadi tidak di 16 kHz (jalur cadangan)
  const out = sr === 16000 ? mono : resampleLinear(mono, sr, 16000);
  void buffer; // AudioBuffer dikumpulkan GC — hanya pegang hasil
  return out;
}

/** resample linear sederhana (fallback bila AudioContext 16 kHz tak tersedia) */
function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

/** envelope RMS per jendela (detik) — untuk deteksi siapa bicara & waveform */
export function rmsEnvelope(buffer: AudioBuffer, winSec = 0.25): { t: number; rms: number }[] {
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.floor(winSec * sr));
  const n = Math.floor(chL.length / win);
  const out: { t: number; rms: number }[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let sumL = 0;
    let sumR = 0;
    const base = i * win;
    for (let j = 0; j < win; j += 4) {
      const l = chL[base + j];
      const r = chR[base + j];
      sum += (l + r) * 0.5;
      sumL += l * l;
      sumR += r * r;
    }
    const cnt = Math.ceil(win / 4);
    const rmsL = Math.sqrt(sumL / cnt);
    const rmsR = Math.sqrt(sumR / cnt);
    const total = Math.sqrt((sumL + sumR) / (2 * cnt));
    out.push({
      t: (i * win) / sr,
      rms: total,
      // side: selisih energi L vs R (positif = suara condong kiri)
      side: 0, // diisi di bawah
      ...( { l: rmsL, r: rmsR } as object),
    } as { t: number; rms: number; side: number; l: number; r: number });
    void sum;
  }
  return out as unknown as { t: number; rms: number }[];
}

export interface EnvelopePoint {
  t: number;
  rms: number;
  l: number;
  r: number;
}

/** versi dengan channel L/R terpisah */
export function stereoEnvelope(buffer: AudioBuffer, winSec = 0.25): EnvelopePoint[] {
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.floor(winSec * sr));
  const n = Math.floor(chL.length / win);
  const out: EnvelopePoint[] = [];
  for (let i = 0; i < n; i++) {
    let sumL = 0, sumR = 0;
    const base = i * win;
    for (let j = 0; j < win; j += 4) {
      sumL += chL[base + j] * chL[base + j];
      sumR += chR[base + j] * chR[base + j];
    }
    const cnt = Math.ceil(win / 4);
    out.push({
      t: (i * win) / sr,
      rms: Math.sqrt((sumL + sumR) / (2 * cnt)),
      l: Math.sqrt(sumL / cnt),
      r: Math.sqrt(sumR / cnt),
    });
  }
  return out;
}

/* ---------- MIXING UNTUK EKSPOR ---------- */

export interface MixOptions {
  duration: number;
  sampleRate: number; // 48000
  channels: number; // 2
  /** buffer audio asli (bisa null utk video tanpa audio) */
  original: AudioBuffer | null;
  originalStart: number; // offset dalam audio asli
  originalGain: number; // 1 normal, <1 jika ducking
  music: AudioBuffer | null;
  musicGain: number;
  musicLoop: boolean;
  fadeIn: number;
  fadeOut: number;
}

export async function renderMix(opts: MixOptions): Promise<AudioBuffer> {
  const { duration, sampleRate, channels } = opts;
  const len = Math.max(1, Math.ceil(duration * sampleRate));
  const off = new OfflineAudioContext(channels, len, sampleRate);

  if (opts.original) {
    const src = off.createBufferSource();
    src.buffer = opts.original;
    const g = off.createGain();
    g.gain.value = opts.originalGain;
    src.connect(g).connect(off.destination);
    src.start(0, Math.min(opts.originalStart, Math.max(0, opts.original.duration - 0.01)));
    src.stop(duration + 0.05);
  }

  if (opts.music) {
    const src = off.createBufferSource();
    src.buffer = opts.music;
    src.loop = opts.musicLoop;
    const g = off.createGain();
    const mg = Math.max(0.0001, opts.musicGain);
    // envelope fade in/out
    g.gain.setValueAtTime(0.0001, 0);
    if (opts.fadeIn > 0) {
      g.gain.exponentialRampToValueAtTime(mg, Math.min(opts.fadeIn, duration * 0.5));
    } else {
      g.gain.setValueAtTime(mg, 0);
    }
    if (opts.fadeOut > 0) {
      const t0 = Math.max(0, duration - opts.fadeOut);
      g.gain.setValueAtTime(mg, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, duration);
    }
    src.connect(g).connect(off.destination);
    src.start(0);
    src.stop(duration + 0.05);
  }

  return off.startRendering();
}

/** ambil sample rate & channel dari buffer */
export function audioFormat(buffer: AudioBuffer): { sampleRate: number; channels: number } {
  return { sampleRate: buffer.sampleRate, channels: Math.min(2, buffer.numberOfChannels) };
}
