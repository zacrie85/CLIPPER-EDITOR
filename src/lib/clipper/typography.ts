"use client";

/* ============================================================
   CLIPPER EDITOR — Tipografi Sinematik
   10 font sinematik, digambar sebagai lapisan canvas.
   Pastikan font sudah dimuat: document.fonts.load()
   ============================================================ */

export interface CinematicFont {
  key: string;
  family: string;
  label: string;
  weight: number;
}

export const FONTS: CinematicFont[] = [
  { key: "cinzel", family: "Cinzel", label: "CINZEL — epik klasik", weight: 700 },
  { key: "anton", family: "Anton", label: "ANTON — tebal tegas", weight: 400 },
  { key: "bebas", family: "Bebas Neue", label: "BEBAS — poster", weight: 400 },
  { key: "oswald", family: "Oswald", label: "OSWALD — modern", weight: 600 },
  { key: "playfair", family: "Playfair Display", label: "PLAYFAIR — elegan", weight: 700 },
  { key: "archivo", family: "Archivo Black", label: "ARCHIVO — blok", weight: 400 },
  { key: "montserrat", family: "Montserrat", label: "MONTSERRAT — bersih", weight: 800 },
  { key: "orbitron", family: "Orbitron", label: "ORBITRON — futuristik", weight: 700 },
  { key: "marker", family: "Permanent Marker", label: "MARKER — meme", weight: 400 },
  { key: "caveat", family: "Caveat", label: "CAVEAT — tulisan tangan", weight: 700 },
];

export function fontOf(key: string): CinematicFont {
  return FONTS.find((f) => f.key === key) ?? FONTS[1];
}

/** pastikan semua font siap dipakai canvas */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const jobs: Promise<unknown>[] = [];
  for (const f of FONTS) {
    try {
      jobs.push(document.fonts.load(`${f.weight} 100px "${f.family}"`));
    } catch {
      /* abaikan */
    }
  }
  try {
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((res) => setTimeout(res, 5000)),
    ]);
  } catch {
    /* abaikan */
  }
}

/* ---------- gaya gambar judul ---------- */

export interface TextDraw {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** 0..1 progres animasi masuk */
  enter: number;
  /** 0..1 progres animasi keluar */
  exit: number;
}

interface DrawOpts extends TextDraw {
  text: string;
  sub: string;
  family: string;
  weight: number;
  posY: number;
  sizePct: number;
  color: string;
  accent: string;
  style: string;
  anim: string;
}

export function drawTextLayer(o: DrawOpts) {
  const { ctx, w, h } = o;
  const size = Math.max(14, (o.sizePct / 100) * w);
  const cy = o.posY * h;

  ctx.save();

  // animasi
  let alpha = Math.min(o.enter, 1 - o.exit);
  let dx = 0;
  let dy = 0;
  let scale = 1;
  if (o.anim === "fade") {
    alpha *= Math.min(1, o.enter * 1.2) * (1 - o.exit);
  } else if (o.anim === "slide") {
    dx = (1 - o.enter) * w * 0.12 - o.exit * w * 0.12;
  } else if (o.anim === "zoom") {
    scale = 0.85 + 0.15 * o.enter + o.exit * 0.1;
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(w / 2 + dx, cy);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const fontStr = `${o.weight} ${size}px "${o.family}", sans-serif`;
  ctx.font = fontStr;

  const subSize = size * 0.34;
  const hasSub = !!o.sub.trim();

  if (o.style === "epic") {
    // judul besar + garis emas + sub spasi lebar
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = size * 0.12;
    ctx.fillStyle = o.color;
    ctx.fillText(o.text, 0, hasSub ? -subSize * 0.6 : 0);
    ctx.shadowBlur = 0;
    // garis aksen
    const lw = ctx.measureText(o.text).width;
    ctx.fillStyle = o.accent;
    ctx.fillRect(-lw / 2, size * 0.62, lw, Math.max(2, size * 0.035));
    if (hasSub) {
      ctx.font = `400 ${subSize}px "Montserrat", sans-serif`;
      ctx.fillStyle = o.color;
      // spasi antar huruf manual
      const spaced = o.sub.toUpperCase().split("").join(" ");
      ctx.fillText(spaced, 0, size * 1.05);
    }
  } else if (o.style === "lower-third") {
    // kotak samping kiri-bawah gaya berita/MotoGP
    const tw = Math.max(ctx.measureText(o.text).width, size * 3);
    const boxH = size * (hasSub ? 1.7 : 1.15);
    const bx = -w * 0.46;
    const by = -boxH * 0.55;
    ctx.globalAlpha *= 0.95;
    ctx.fillStyle = "rgba(10,10,12,0.82)";
    ctx.fillRect(bx, by, tw + size * 0.8, boxH);
    ctx.fillStyle = o.accent;
    ctx.fillRect(bx, by, Math.max(4, size * 0.07), boxH);
    ctx.textAlign = "left";
    ctx.fillStyle = o.color;
    ctx.textBaseline = "top";
    ctx.fillText(o.text, bx + size * 0.3, by + size * 0.14);
    if (hasSub) {
      ctx.font = `500 ${subSize}px "Montserrat", sans-serif`;
      ctx.fillStyle = o.accent;
      ctx.fillText(o.sub.toUpperCase(), bx + size * 0.3, by + size * 1.05);
    }
  } else if (o.style === "neon") {
    ctx.shadowColor = o.accent;
    ctx.shadowBlur = size * 0.35;
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = Math.max(1.5, size * 0.02);
    ctx.strokeText(o.text, 0, 0);
    ctx.fillStyle = o.color;
    ctx.fillText(o.text, 0, 0);
    if (hasSub) {
      ctx.font = `600 ${subSize}px "Orbitron", sans-serif`;
      ctx.shadowBlur = subSize * 0.3;
      ctx.fillStyle = o.accent;
      ctx.fillText(o.sub.toUpperCase(), 0, size * 0.95);
    }
  } else if (o.style === "quote") {
    // tanda kutip besar + teks serif
    ctx.font = `700 ${size * 1.4}px "Playfair Display", serif`;
    ctx.fillStyle = o.accent;
    ctx.globalAlpha *= 0.6;
    ctx.fillText("\u201C", -w * 0.36, -size * 0.55);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `700 ${size * 0.78}px "Playfair Display", serif`;
    ctx.fillStyle = o.color;
    wrapText(ctx, o.text, 0, 0, w * 0.8, size * 0.95);
    if (hasSub) {
      ctx.font = `500 ${subSize}px "Montserrat", sans-serif`;
      ctx.fillStyle = o.accent;
      ctx.fillText(`— ${o.sub}`, 0, size * 1.1);
    }
  } else {
    // meme — teks kapital outline hitam tebal
    const txt = o.text.toUpperCase();
    ctx.font = `400 ${size * 0.9}px "Permanent Marker", "Anton", sans-serif`;
    ctx.lineWidth = Math.max(3, size * 0.09);
    ctx.strokeStyle = "#000";
    ctx.lineJoin = "round";
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = o.color;
    ctx.fillText(txt, 0, 0);
    if (hasSub) {
      ctx.strokeText(o.sub.toUpperCase(), 0, size * 0.95);
      ctx.fillStyle = o.accent;
      ctx.fillText(o.sub.toUpperCase(), 0, size * 0.95);
    }
  }

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  lineH: number
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  lines.forEach((ln, i) => {
    ctx.fillText(ln, cx, cy + (i - (lines.length - 1) / 2) * lineH);
  });
}
