"use client";

/* ============================================================
   CLIPPER EDITOR — Pelacak Objek (NCC + template)
   Pilih kotak objek pada satu frame → template dicocokkan
   ke frame berikutnya dengan Normalized Cross-Correlation
   (pencarian kasar→halus). Label grafis ala MotoGP mengikuti.
   ============================================================ */

import type { TrackerConfig } from "./types";
import { grabFrame } from "./frames";

export interface NCCBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

function gray(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): Float32Array {
  const img = ctx.getImageData(x0, y0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = (img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114) / 255;
  }
  return out;
}

/** NCC antara template dan kandidat */
function ncc(tpl: Float32Array, patch: Float32Array): number {
  const n = tpl.length;
  let mt = 0;
  let mp = 0;
  for (let i = 0; i < n; i++) {
    mt += tpl[i];
    mp += patch[i];
  }
  mt /= n;
  mp /= n;
  let num = 0;
  let dt = 0;
  let dp = 0;
  for (let i = 0; i < n; i++) {
    const a = tpl[i] - mt;
    const b = patch[i] - mp;
    num += a * b;
    dt += a * a;
    dp += b * b;
  }
  const den = Math.sqrt(dt * dp);
  return den < 1e-9 ? 0 : num / den;
}

/**
 * Lacak objek sepanjang video.
 * @param cfg kotak template di anchorTime (normalisasi)
 * @param stepSec interval hasil path (mis. 0.1s)
 * @returns path posisi objek
 */
export async function trackObject(
  url: string,
  duration: number,
  cfg: TrackerConfig,
  onProgress?: (p: number) => void
): Promise<TrackerConfig["path"]> {
  if (!cfg.box || !cfg.enabled) return [];

  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  await new Promise<void>((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error("Video tidak dapat dibuka untuk tracking"));
  });

  const W = v.videoWidth;
  const H = v.videoHeight;
  const workW = 480;
  const scale = workW / W;
  const workH = Math.round(H * scale);

  // frame anchor → template
  const anchorCanvas = await grabFrame(v, cfg.anchorTime, workW, workH);
  const actx = anchorCanvas.getContext("2d", { willReadFrequently: true })!;
  const bx = Math.round(cfg.box.x * workW);
  const by = Math.round(cfg.box.y * workH);
  const bw = Math.max(12, Math.round(cfg.box.w * workW));
  const bh = Math.max(12, Math.round(cfg.box.h * workH));
  const tpl = gray(actx, bx, by, bw, bh);

  const stepSec = 0.1;
  const times: number[] = [];
  for (let t = 0; t < duration; t += stepSec) times.push(t);

  const path: TrackerConfig["path"] = [];
  // posisi terlacak saat ini (koordinat work space)
  let cx = bx;
  let cy = by;
  let lost = 0;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    try {
      const frame = await grabFrame(v, t, workW, workH);
      const fctx = frame.getContext("2d", { willReadFrequently: true })!;

      // pencarian kasar → halus di sekitar posisi terakhir
      const search = Math.max(24, Math.round(bw * 0.6));
      let best = { x: cx, y: cy, score: -2 };
      const stepCoarse = 6;
      for (let dy = -search; dy <= search; dy += stepCoarse) {
        for (let dx = -search; dx <= search; dx += stepCoarse) {
          const px = Math.round(cx + dx);
          const py = Math.round(cy + dy);
          if (px < 0 || py < 0 || px + bw > workW || py + bh > workH) continue;
          const patch = gray(fctx, px, py, bw, bh);
          const s = ncc(tpl, patch);
          if (s > best.score) best = { x: px, y: py, score: s };
        }
      }
      // haluskan ±3px
      const fx0 = Math.max(0, best.x - 4);
      const fy0 = Math.max(0, best.y - 4);
      for (let dy = 0; dy <= 8; dy++) {
        for (let dx = 0; dx <= 8; dx++) {
          const px = fx0 + dx;
          const py = fy0 + dy;
          if (px < 0 || py < 0 || px + bw > workW || py + bh > workH) continue;
          const patch = gray(fctx, px, py, bw, bh);
          const s = ncc(tpl, patch);
          if (s > best.score) best = { x: px, y: py, score: s };
        }
      }

      const ok = best.score > 0.42;
      if (ok) {
        cx = best.x;
        cy = best.y;
        lost = 0;
      } else {
        lost++;
      }
      path.push({
        t,
        x: cx / workW,
        y: cy / workH,
        w: bw / workW,
        h: bh / workH,
        found: ok,
      });
      frame.width = 0;
    } catch {
      path.push({ t, x: cx / workW, y: cy / workH, w: bw / workW, h: bh / workH, found: false });
    }
    onProgress?.((i + 1) / times.length);
  }

  v.removeAttribute("src");
  v.load();
  void anchorCanvas;
  void H;
  return path;
}

/** interpolasi posisi path tracking pada waktu t */
export function trackAt(
  path: TrackerConfig["path"],
  t: number
): { x: number; y: number; w: number; h: number; found: boolean } | null {
  if (!path.length) return null;
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].t >= t) {
      const a = path[i - 1];
      const b = path[i];
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        w: a.w + (b.w - a.w) * p,
        h: a.h + (b.h - a.h) * p,
        found: b.found,
      };
    }
  }
  return path[path.length - 1];
}
