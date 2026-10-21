"use client";

/* ============================================================
   CLIPPER EDITOR — Renderer Komposit
   Menggambar 1 frame output: sumber → crop (rasio/zoom/pembicara)
   → efek → subtitle → teks sinematik → label tracker → watermark.
   Dipakai bersama oleh pratinjau & ekspor (konsisten piksel).
   ============================================================ */

import type {
  AspectMode, EffectConfig, SpeakerConfig, SubtitleConfig, TextLayer,
  TrackerConfig, WatermarkConfig, ZoomPanConfig,
} from "./types";
import { cropAt, lerpCrop, type CropKey } from "./speaker";
import { trackAt } from "./tracker";
import { drawTextLayer, fontOf } from "./typography";

export interface RenderFrameOpts {
  src: HTMLVideoElement | HTMLCanvasElement | ImageBitmap;
  srcW: number;
  srcH: number;
  out: HTMLCanvasElement;
  t: number;
  aspect: AspectMode;
  zoomPan: ZoomPanConfig;
  speakerKeys?: CropKey[] | null;
  speakerCfg?: SpeakerConfig | null;
  subtitle?: SubtitleConfig | null;
  texts?: TextLayer[];
  tracker?: TrackerConfig | null;
  watermark?: WatermarkConfig | null;
  effects?: EffectConfig;
}

/** crop dasar: fit rasio target dari sumber + zoom/pan manual */
export function baseCrop(
  srcW: number,
  srcH: number,
  aspect: AspectMode,
  zoomPan: ZoomPanConfig
): { x: number; y: number; w: number; h: number } {
  const A = aspect === "9:16" ? 9 / 16 : 16 / 9;
  const SA = srcW / srcH;
  // w/h (normalisasi) yang memberi rasio A
  let w: number;
  let h: number;
  if (A / SA < 1) {
    w = A / SA;
    h = 1;
  } else {
    w = 1;
    h = SA / A;
  }
  const z = Math.max(1, zoomPan.zoom);
  w /= z;
  h /= z;
  // pan: fraksi dari ruang gerak yang tersedia
  const ax = 1 - w;
  const ay = 1 - h;
  const x = (1 - w) / 2 + zoomPan.panX * ax;
  const y = (1 - h) / 2 + zoomPan.panY * ay;
  return {
    x: Math.max(0, Math.min(1 - w, x)),
    y: Math.max(0, Math.min(1 - h, y)),
    w, h,
  };
}

function effectFilter(e: EffectConfig | undefined): string {
  if (!e || e.main === "none") return "none";
  const k = e.intensity;
  switch (e.main) {
    case "bw": return `grayscale(${k})`;
    case "warm": return `sepia(${k * 0.45}) saturate(${1 + k * 0.35}) hue-rotate(-8deg)`;
    case "cool": return `saturate(${1 + k * 0.2}) hue-rotate(${k * 18}deg) brightness(${1 + k * 0.04})`;
    case "contrast": return `contrast(${1 + k * 0.6}) saturate(${1 + k * 0.2})`;
    case "dreamy": return `brightness(${1 + k * 0.08}) saturate(${1 + k * 0.3}) blur(${k * 0.6}px)`;
    default: return "none";
  }
}

let grainCanvas: HTMLCanvasElement | null = null;
function getGrain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = Math.floor(Math.random() * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  o: RenderFrameOpts,
  crop: { x: number; y: number; w: number; h: number },
  alpha: number
) {
  const out = o.out;
  const ow = out.width;
  const oh = out.height;
  const sx = crop.x * o.srcW;
  const sy = crop.y * o.srcH;
  const sw = crop.w * o.srcW;
  const sh = crop.h * o.srcH;
  ctx.save();
  ctx.globalAlpha = alpha;
  // mirror: gambar sumber terbalik
  if (o.effects?.main === "mirror") {
    ctx.translate(ow, 0);
    ctx.scale(-1, 1);
  }
  try {
    ctx.drawImage(o.src as CanvasImageSource, sx, sy, sw, sh, 0, 0, ow, oh);
  } catch {
    /* frame belum siap — biarkan hitam */
  }
  ctx.restore();
}

/** gambar satu frame komposit lengkap */
export function drawComposite(o: RenderFrameOpts): void {
  const out = o.out;
  const ow = out.width;
  const oh = out.height;
  const ctx = out.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ow, oh);

  // ==== LAPISAN VIDEO (dengan crop + transisi pembicara) ====
  ctx.filter = effectFilter(o.effects);
  let drewBase = false;
  let finalCrop: { x: number; y: number; w: number; h: number } | null = null;
  if (o.speakerKeys && o.speakerCfg && o.speakerCfg.enabled && o.speakerKeys.length) {
    const r = cropAt(o.speakerKeys, o.t, o.speakerCfg, o.srcH ? o.srcW / o.srcH : 16 / 9);
    if (r.b && r.mix > 0) {
      if (o.speakerCfg.transition === "fade") {
        // crossfade: gambar lama penuh, lalu baru dengan alpha
        if (r.a.crop) drawCrop(ctx, o, r.a.crop, 1);
        if (r.b.crop) drawCrop(ctx, o, r.b.crop, r.mix);
        finalCrop = r.mix >= 0.5 ? r.b.crop : r.a.crop;
        drewBase = true;
      } else {
        // geser halus: lerp posisi
        const c = lerpCrop(r.a, r.b, r.mix);
        drawCrop(ctx, o, c, 1);
        finalCrop = c;
        drewBase = true;
      }
    } else if (r.a.crop) {
      drawCrop(ctx, o, r.a.crop, 1);
      finalCrop = r.a.crop;
      drewBase = true;
    }
  }
  if (!drewBase || !finalCrop) {
    finalCrop = baseCrop(o.srcW, o.srcH, o.aspect, o.zoomPan);
    drawCrop(ctx, o, finalCrop, 1);
  }
  ctx.filter = "none";

  // ==== EFEK LAYAR ====
  const e = o.effects;
  if (e && e.main === "vignette") {
    const g = ctx.createRadialGradient(ow / 2, oh / 2, Math.min(ow, oh) * 0.42, ow / 2, oh / 2, Math.max(ow, oh) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${0.75 * e.intensity})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ow, oh);
  }
  if (e && e.main === "grain") {
    const g = getGrain();
    ctx.save();
    ctx.globalAlpha = 0.10 * e.intensity;
    ctx.globalCompositeOperation = "overlay";
    const ox = Math.floor(Math.random() * 256);
    const oy = Math.floor(Math.random() * 256);
    for (let y = -oy; y < oh; y += 256) {
      for (let x = -ox; x < ow; x += 256) ctx.drawImage(g, x, y);
    }
    ctx.restore();
  }
  if (e && e.main === "glitch" && Math.random() < 0.25 + e.intensity * 0.3) {
    const slices = 3 + Math.floor(e.intensity * 5);
    for (let i = 0; i < slices; i++) {
      const sy0 = Math.random() * oh;
      const sh0 = 6 + Math.random() * 40;
      const dx = (Math.random() - 0.5) * 60 * e.intensity;
      try {
        ctx.drawImage(out, 0, sy0, ow, sh0, dx, sy0 + (Math.random() - 0.5) * 6, ow, sh0);
      } catch { /* aman */ }
    }
  }

  // ==== SUBTITLE ====
  if (o.subtitle && (o.subtitle.mode === "burnin") && o.subtitle.cues.length) {
    const cue = o.subtitle.cues.find((c) => o.t >= c.start && o.t <= c.end);
    if (cue) drawSubtitle(ctx, ow, oh, cue.text, o.subtitle);
  }

  // ==== TEKS SINEMATIK ====
  if (o.texts?.length) {
    for (const tl of o.texts) {
      if (o.t < tl.start || o.t > tl.end) continue;
      const enter = Math.max(0, Math.min(1, (o.t - tl.start) / 0.45));
      const exit = Math.max(0, Math.min(1, (o.t - (tl.end - 0.45)) / 0.45));
      const f = fontOf(tl.font);
      drawTextLayer({
        ctx, w: ow, h: oh, enter, exit,
        text: tl.text, sub: tl.sub,
        family: f.family, weight: f.weight,
        posY: tl.posY, sizePct: tl.size,
        color: tl.color, accent: tl.accent,
        style: tl.style, anim: tl.anim,
      });
    }
  }

  // ==== LABEL TRACKER (ala MotoGP) ====
  if (o.tracker?.enabled && o.tracker.box && o.tracker.path.length) {
    const pos = trackAt(o.tracker.path, o.t);
    if (pos && pos.found && finalCrop) {
      // petakan koordinat sumber → koordinat output melalui crop aktif
      const tx = (pos.x - finalCrop.x) / finalCrop.w;
      const ty = (pos.y - finalCrop.y) / finalCrop.h;
      const tw = pos.w / finalCrop.w;
      const th = pos.h / finalCrop.h;
      if (tx + tw > -0.05 && tx < 1.05 && ty + th > -0.05 && ty < 1.05) {
        drawTrackerLabel(
          ctx, ow, oh,
          {
            x: Math.max(-0.1, tx),
            y: Math.max(-0.1, ty),
            w: Math.min(1.1, tw),
            h: Math.min(1.1, th),
          },
          o.tracker
        );
      }
    }
  }

  // ==== WATERMARK ====
  if (o.watermark?.enabled && o.watermark.text.trim()) {
    drawWatermark(ctx, ow, oh, o.watermark);
  }
}

/* ---------- subtitle ---------- */

function drawSubtitle(
  ctx: CanvasRenderingContext2D, ow: number, oh: number,
  text: string, cfg: SubtitleConfig
) {
  const size = (cfg.fontSize / 100) * oh;
  ctx.save();
  ctx.font = `700 ${size}px "Montserrat", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const margin = oh * 0.07;
  const y = cfg.position === "bottom" ? oh - margin - size / 2 : cfg.position === "center" ? oh / 2 : margin + size / 2;

  // bungkus teks maks 90% lebar
  const maxW = ow * 0.9;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  // v1.2.6 — teks kosong/whitespace → tidak ada baris; dulu Math.max([]) = -Infinity
  if (!lines.length) {
    ctx.restore();
    return;
  }

  const lineH = size * 1.25;
  const totalH = lines.length * lineH;
  const y0 = y - totalH / 2 + lineH / 2;

  if (cfg.style === "box") {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(
      ow / 2 - widest / 2 - size * 0.4, y0 - lineH / 2 - size * 0.18,
      widest + size * 0.8, totalH + size * 0.36
    );
  }

  lines.forEach((ln, i) => {
    const ly = y0 + i * lineH;
    if (cfg.style === "karaoke") {
      // putih dengan garis bawah aksen (gaya tiktok)
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineJoin = "round";
      ctx.strokeText(ln, ow / 2, ly);
      ctx.fillStyle = cfg.color;
      ctx.fillText(ln, ow / 2, ly);
      const tw = ctx.measureText(ln).width;
      ctx.fillStyle = cfg.highlight;
      ctx.fillRect(ow / 2 - tw / 2, ly + size * 0.72, tw, Math.max(2, size * 0.06));
    } else if (cfg.style === "outline") {
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineJoin = "round";
      ctx.strokeText(ln, ow / 2, ly);
      ctx.fillStyle = cfg.color;
      ctx.fillText(ln, ow / 2, ly);
    } else if (cfg.style === "minimal") {
      ctx.fillStyle = cfg.color;
      ctx.globalAlpha = 0.92;
      ctx.fillText(ln, ow / 2, ly);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = cfg.color;
      ctx.fillText(ln, ow / 2, ly);
    }
  });
  ctx.restore();
}

/* ---------- label tracker ala MotoGP ---------- */

function drawTrackerLabel(
  ctx: CanvasRenderingContext2D, ow: number, oh: number,
  pos: { x: number; y: number; w: number; h: number },
  cfg: TrackerConfig
) {
  const bx = pos.x * ow;
  const by = pos.y * oh;
  const bw = pos.w * ow;
  const bh = pos.h * oh;
  ctx.save();

  // kotak penanda
  ctx.strokeStyle = cfg.label.color;
  ctx.lineWidth = Math.max(2, ow * 0.0025);
  ctx.strokeRect(bx, by, bw, bh);
  // sudut tebal ala HUD
  const cLen = Math.min(bw, bh) * 0.28;
  ctx.lineWidth = Math.max(3, ow * 0.004);
  ctx.beginPath();
  ctx.moveTo(bx, by + cLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cLen, by);
  ctx.moveTo(bx + bw - cLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cLen);
  ctx.moveTo(bx, by + bh - cLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cLen, by + bh);
  ctx.moveTo(bx + bw - cLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cLen);
  ctx.stroke();

  // chip label
  const fs = Math.max(12, ow * 0.016);
  const fsSub = fs * 0.62;
  ctx.font = `700 ${fs}px "Montserrat", sans-serif`;
  const tw = Math.max(ctx.measureText(cfg.label.text).width, fs * 4);
  ctx.font = `600 ${fsSub}px "Montserrat", sans-serif`;
  const twSub = cfg.label.sub ? ctx.measureText(cfg.label.sub.toUpperCase()).width : 0;
  const chipW = Math.max(tw, twSub) + fs * 1.2;
  const chipH = cfg.label.sub ? fs * 2.5 : fs * 1.8;
  let chipX = bx + bw + fs * 0.5;
  if (chipX + chipW > ow - 8) chipX = bx - chipW - fs * 0.5;
  const chipY = Math.max(8, Math.min(oh - chipH - 8, by));

  ctx.fillStyle = "rgba(8,8,10,0.88)";
  ctx.fillRect(chipX, chipY, chipW, chipH);
  ctx.fillStyle = cfg.label.color;
  ctx.fillRect(chipX, chipY, Math.max(3, fs * 0.14), chipH);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${fs}px "Montserrat", sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(cfg.label.text, chipX + fs * 0.6, chipY + fs * 0.28);
  if (cfg.label.sub) {
    ctx.font = `600 ${fsSub}px "Montserrat", sans-serif`;
    ctx.fillStyle = cfg.label.color;
    ctx.fillText(cfg.label.sub.toUpperCase(), chipX + fs * 0.6, chipY + fs * 1.45);
  }

  // garis penghubung
  ctx.strokeStyle = cfg.label.color;
  ctx.lineWidth = Math.max(1.5, fs * 0.1);
  ctx.beginPath();
  const linkFromX = chipX < bx ? chipX + chipW : chipX;
  const linkToX = chipX < bx ? bx : bx + bw;
  ctx.moveTo(linkFromX, chipY + chipH / 2);
  ctx.lineTo(linkToX, by + bh * 0.5);
  ctx.stroke();

  ctx.restore();
}

/* ---------- watermark ---------- */

function drawWatermark(ctx: CanvasRenderingContext2D, ow: number, oh: number, wm: WatermarkConfig) {
  const size = (wm.scale / 100) * ow;
  ctx.save();
  ctx.globalAlpha = wm.opacity;
  ctx.font = `600 ${size}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";
  const m = ow * 0.035;
  const tw = ctx.measureText(wm.text).width;
  const x = wm.corner === "tl" || wm.corner === "bl" ? m : ow - tw - m;
  const y = wm.corner === "tl" || wm.corner === "tr" ? m : oh - size - m;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = size * 0.3;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(wm.text, x, y);
  ctx.restore();
}
