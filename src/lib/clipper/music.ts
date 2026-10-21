"use client";

/* ============================================================
   CLIPPER EDITOR — Skor Musik AI (komposisi prosedural)
   Web Audio API 100% lokal: EPIC · LO-FI · CINEMATIC · UPLIFT · TENSION
   + dukungan MP3 manual sebagai backsound.
   ============================================================ */

import type { MusicPreset } from "./types";

export const MUSIC_PRESETS: { key: MusicPreset; label: string; desc: string; bpm: number }[] = [
  { key: "none", label: "TANPA MUSIK", desc: "Audio asli saja", bpm: 0 },
  { key: "epic", label: "EPIC", desc: "Drum besar, nagging brass, heroik", bpm: 90 },
  { key: "lofi", label: "LO-FI", desc: "Chill jazzy, vinyl, santai", bpm: 78 },
  { key: "cinematic", label: "CINEMATIC", desc: "Pad lebar, piano sinematik", bpm: 70 },
  { key: "uplift", label: "UPLIFT", desc: "Pluck cerah, energik positif", bpm: 110 },
  { key: "tension", label: "TENSION", desc: "Pulsing bass, ketegangan", bpm: 100 },
];

/* ---------- util ---------- */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NOTE = (semi: number) => 440 * Math.pow(2, (semi - 9) / 12); // semi 0 = C4? gunakan A4=440 base

// skala minor natural & mayor, derajat dihitung dari root (MIDI offset)
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const d = (scale: number[], deg: number, oct = 0) =>
  scale[((deg % 7) + 7) % 7] + 12 * (oct + Math.floor(deg / 7));

function noiseBuffer(ctx: OfflineAudioContext, dur: number, seed: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
  return buf;
}

/* ---------- instrumen ---------- */

interface Kit {
  ctx: OfflineAudioContext;
  out: GainNode;
  noise: AudioBuffer;
}

function kick(k: Kit, t: number, gain = 1, pitch = 150) {
  const { ctx } = k;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
  g.gain.setValueAtTime(0.9 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(g).connect(k.out);
  o.start(t);
  o.stop(t + 0.4);
}

function subDrop(k: Kit, t: number, dur: number, gain = 1) {
  const { ctx } = k;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(45, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7 * gain, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(k.out);
  o.start(t);
  o.stop(t + dur + 0.1);
}

function snare(k: Kit, t: number, gain = 1, bright = 1800) {
  const { ctx } = k;
  const s = ctx.createBufferSource();
  s.buffer = k.noise;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = bright;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  s.connect(f).connect(g).connect(k.out);
  s.start(t);
  s.stop(t + 0.25);
}

function hat(k: Kit, t: number, gain = 1) {
  const { ctx } = k;
  const s = ctx.createBufferSource();
  s.buffer = k.noise;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.16 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  s.connect(f).connect(g).connect(k.out);
  s.start(t);
  s.stop(t + 0.1);
}

function bassNote(k: Kit, t: number, freq: number, dur: number, gain = 1, type: OscillatorType = "sawtooth") {
  const { ctx } = k;
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  f.type = "lowpass";
  f.frequency.setValueAtTime(freq * 4, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 1.6), t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.34 * gain, t + 0.012);
  g.gain.setValueAtTime(0.3 * gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(f).connect(g).connect(k.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function padChord(k: Kit, t: number, freqs: number[], dur: number, gain = 1) {
  const { ctx } = k;
  freqs.forEach((freq, i) => {
    [-6, 5].forEach((det) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = det + i;
      f.type = "lowpass";
      f.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 * gain, t + dur * 0.35);
      g.gain.setValueAtTime(0.045 * gain, t + dur * 0.75);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(k.out);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  });
}

function pluck(k: Kit, t: number, freq: number, gain = 1, bright = 5200) {
  const { ctx } = k;
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.value = freq;
  f.type = "lowpass";
  f.frequency.setValueAtTime(bright, t);
  f.frequency.exponentialRampToValueAtTime(500, t + 0.4);
  g.gain.setValueAtTime(0.28 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(f).connect(g).connect(k.out);
  o.start(t);
  o.stop(t + 0.6);
}

function piano(k: Kit, t: number, freq: number, dur: number, gain = 1) {
  const { ctx } = k;
  [1, 2.01, 2.98].forEach((mul, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = i === 0 ? "sine" : "triangle";
    o.frequency.value = freq * mul;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((i === 0 ? 0.3 : 0.09) * gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * (1 - i * 0.22));
    o.connect(g).connect(k.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function riser(k: Kit, t: number, dur: number, gain = 1) {
  const { ctx } = k;
  const s = ctx.createBufferSource();
  s.buffer = k.noise;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(6500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.22 * gain, t + dur * 0.9);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
  s.connect(f).connect(g).connect(k.out);
  s.start(t);
  s.stop(t + dur + 0.1);
}

function vinyl(k: Kit, t: number, dur: number, gain = 1) {
  const { ctx } = k;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(k.ctx, Math.min(4, dur), 777);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 3000;
  const g = ctx.createGain();
  g.gain.value = 0.012 * gain;
  s.connect(f).connect(g).connect(k.out);
  s.start(t);
  s.stop(t + dur);
}

/* ---------- komposisi utama ---------- */

export async function composeMusic(
  preset: MusicPreset,
  duration: number,
  fadeOut = 2
): Promise<AudioBuffer | null> {
  if (preset === "none" || duration < 1) return null;

  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 0.5) * sr), sr);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // sedikit "ruang" lewat delay lembut
  const delay = ctx.createDelay(0.5);
  const fb = ctx.createGain();
  fb.gain.value = 0.22;
  const wet = ctx.createGain();
  wet.gain.value = 0.16;
  master.connect(ctx.destination);
  master.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(ctx.destination);

  const kit: Kit = { ctx, out: master, noise: noiseBuffer(ctx, 1.2, 42) };

  const r = rng(hash(preset));
  let chordDeg: number[] = [];
  let scale = MINOR;
  const root = -3; // ~C3-ish base

  switch (preset) {
    case "epic": {
      scale = MINOR;
      chordDeg = [0, 5, 3, 6]; // i - vi - iv - vii
      const bpm = 90;
      const beat = 60 / bpm;
      const bar = beat * 4;
      const bars = Math.ceil(duration / bar);
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar;
        if (t0 > duration) break;
        const deg = chordDeg[b % chordDeg.length];
        // pad + brass-ish chord
        padChord(kit, t0, [0, 2, 4].map((i) => NOTE(root + d(scale, deg + i, 1))), bar * 0.98, 0.9);
        bassNote(kit, t0, NOTE(root + d(scale, deg, -1)), bar * 0.9, 1, "square");
        // drum
        kick(kit, t0, 1.1, 180);
        kick(kit, t0 + beat * 2, 1, 160);
        if (b % 2 === 1) snare(kit, t0 + beat * 3, 0.8, 1200);
        hat(kit, t0 + beat, 0.7);
        hat(kit, t0 + beat * 3, 0.7);
        // hit epik tiap 4 bar
        if (b % 4 === 3) {
          subDrop(kit, t0 + bar - beat, beat, 1);
          riser(kit, t0 + bar - beat * 2, beat * 2, 0.9);
        }
        // melodi heroik
        for (let i = 0; i < 4; i++) {
          if (r() > 0.4) {
            const n = d(scale, deg + [0, 2, 4, 6][Math.floor(r() * 4)], 2);
            pluck(kit, t0 + i * beat, NOTE(root + n), 0.8);
          }
        }
      }
      break;
    }
    case "lofi": {
      scale = MINOR;
      chordDeg = [0, 3, 5, 4]; // i - iv - vi - v
      const bpm = 78;
      const beat = 60 / bpm;
      const bar = beat * 4;
      const bars = Math.ceil(duration / bar);
      vinyl(kit, 0, duration, 1);
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar;
        if (t0 > duration) break;
        const deg = chordDeg[b % chordDeg.length];
        // gitar/piano jazzy 7th
        [0, 2, 4, 6].forEach((i, k) =>
          piano(kit, t0 + k * 0.02, NOTE(root + d(scale, deg + i, 1)), bar * 0.9, 0.8)
        );
        bassNote(kit, t0 + beat * 0.5, NOTE(root + d(scale, deg, -1)), beat * 1.6, 0.9, "sine");
        bassNote(kit, t0 + beat * 2.5, NOTE(root + d(scale, deg + 4, -1)), beat * 1.4, 0.8, "sine");
        kick(kit, t0, 0.7, 110);
        snare(kit, t0 + beat * 2, 0.45, 900);
        hat(kit, t0 + beat, 0.5);
        hat(kit, t0 + beat * 3, 0.5);
        if (r() > 0.5) hat(kit, t0 + beat * 3.5, 0.3);
      }
      break;
    }
    case "cinematic": {
      scale = MINOR;
      chordDeg = [0, 5, 2, 6];
      const bpm = 70;
      const beat = 60 / bpm;
      const bar = beat * 4;
      const bars = Math.ceil(duration / bar);
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar;
        if (t0 > duration) break;
        const deg = chordDeg[b % chordDeg.length];
        padChord(kit, t0, [0, 2, 4, 6].map((i) => NOTE(root + d(scale, deg + i, 1))), bar, 1);
        // piano sparse
        if (r() > 0.25) piano(kit, t0 + beat * (r() > 0.5 ? 1 : 2.5), NOTE(root + d(scale, deg, 2)), beat * 2, 0.9);
        if (r() > 0.6) piano(kit, t0 + beat * 3, NOTE(root + d(scale, deg + 2, 2)), beat, 0.6);
        // swell sub
        subDrop(kit, t0, bar * 0.5, 0.5);
        if (b % 4 === 0 && b > 0) riser(kit, t0 - beat, beat, 0.5);
      }
      break;
    }
    case "uplift": {
      scale = MAJOR;
      chordDeg = [0, 4, 5, 3]; // I - V - vi - IV
      const bpm = 110;
      const beat = 60 / bpm;
      const bar = beat * 4;
      const bars = Math.ceil(duration / bar);
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar;
        if (t0 > duration) break;
        const deg = chordDeg[b % chordDeg.length];
        padChord(kit, t0, [0, 2, 4].map((i) => NOTE(root + d(scale, deg + i, 1))), bar * 0.95, 0.55);
        for (let i = 0; i < 4; i++) {
          bassNote(kit, t0 + i * beat, NOTE(root + d(scale, deg, -1)), beat * 0.8, 0.9, "sawtooth");
          kick(kit, t0 + i * beat, 0.8, 150);
          hat(kit, t0 + i * beat + beat / 2, 0.6);
        }
        snare(kit, t0 + beat, 0.5, 1500);
        snare(kit, t0 + beat * 3, 0.5, 1500);
        // arpeggio pluck
        for (let i = 0; i < 8; i++) {
          const n = d(scale, deg + [0, 2, 4, 2][i % 4], 2);
          pluck(kit, t0 + i * beat * 0.5, NOTE(root + n), 0.55, 6000);
        }
      }
      break;
    }
    case "tension": {
      scale = MINOR;
      chordDeg = [0, 1, 0, 6]; // i - ii disonan
      const bpm = 100;
      const beat = 60 / bpm;
      const bar = beat * 4;
      const bars = Math.ceil(duration / bar);
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar;
        if (t0 > duration) break;
        const deg = chordDeg[b % chordDeg.length];
        // bass pulsing 8th
        for (let i = 0; i < 8; i++) {
          bassNote(kit, t0 + i * beat * 0.5, NOTE(root + d(scale, deg, -1)), beat * 0.45, 1, "sawtooth");
        }
        // strings disonan
        padChord(kit, t0, [0, 1, 4].map((i) => NOTE(root + d(scale, deg + i, 1))), bar, 0.7);
        kick(kit, t0, 0.9, 130);
        snare(kit, t0 + beat * 2.5, 0.35, 2400);
        if (b % 2 === 1) hat(kit, t0 + beat * 1.5, 0.5);
        if (b % 8 === 7) riser(kit, t0 + bar - beat * 2, beat * 2, 1);
      }
      break;
    }
  }

  const buf = await ctx.startRendering();
  // fade out terakhir
  if (fadeOut > 0) {
    const fadeSamples = Math.floor(fadeOut * sr);
    const chs = buf.numberOfChannels;
    for (let c = 0; c < chs; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < fadeSamples; i++) {
        const idx = data.length - 1 - i;
        if (idx < 0) break;
        data[idx] *= i / fadeSamples;
      }
    }
  }
  return buf;
}
