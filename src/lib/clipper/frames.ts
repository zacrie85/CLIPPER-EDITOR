"use client";

/* ============================================================
   CLIPPER EDITOR — Frame engine
   Ekstraksi frame presisi via seek elemen video + canvas.
   Dipakai scene detection, zoom pembicara, tracker, ekspor.
   ============================================================ */

/** seek presisi: set currentTime dan tunggu frame benar-benar siap */
export function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState < 1) {
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        seekVideo(v, t).then(resolve).catch(reject);
      };
      v.addEventListener("loadedmetadata", onMeta);
      return;
    }
    const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.001));
    const onSeeked = () => {
      cleanup();
      // tunggu satu frame render agar pixel benar-benar siap
      requestAnimationFrame(() => resolve());
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Gagal seek video"));
    };
    const cleanup = () => {
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onErr);
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", onErr);
    const eps = Math.abs(v.currentTime - target);
    if (eps < 0.0005 && v.readyState >= 2) {
      cleanup();
      requestAnimationFrame(() => resolve());
      return;
    }
    try {
      v.currentTime = target;
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error("Seek error"));
    }
  });
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** ambil 1 frame ke canvas (dengan ukuran custom) */
export async function grabFrame(
  v: HTMLVideoElement,
  t: number,
  w?: number,
  h?: number
): Promise<HTMLCanvasElement> {
  await seekVideo(v, t);
  const cw = w ?? v.videoWidth;
  const ch = h ?? v.videoHeight;
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  ctx.drawImage(v, 0, 0, cw, ch);
  return c;
}

/** sampling banyak frame secara berurutan pada video tersembunyi */
export async function sampleFrames(
  url: string,
  times: number[],
  w: number,
  h: number,
  onProgress?: (p: number) => void
): Promise<HTMLCanvasElement[]> {
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  await new Promise<void>((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error("Tidak dapat membuka video untuk sampling"));
  });
  const out: HTMLCanvasElement[] = [];
  try {
    for (let i = 0; i < times.length; i++) {
      out.push(await grabFrame(v, times[i], w, h));
      onProgress?.((i + 1) / times.length);
    }
  } finally {
    v.removeAttribute("src");
    v.load();
  }
  return out;
}

/* ---------- fitur frame untuk analisis ---------- */

/** histogram warna terkuantisasi (RGB 3-bit/channel = 512 bin) */
export function colorHistogram(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const hist = new Float32Array(512);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] >> 5;
    const g = data[i * 4 + 1] >> 5;
    const b = data[i * 4 + 2] >> 5;
    hist[(r << 6) | (g << 3) | b]++;
  }
  // normalisasi
  for (let i = 0; i < 512; i++) hist[i] /= n;
  return hist;
}

export function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d * 0.5; // total variation distance 0..1
}

/** selisih piksel kasar (untuk gerakan mulut/wajah) */
export function regionDiff(
  a: CanvasRenderingContext2D, b: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number
): number {
  const A = a.getImageData(x, y, w, h).data;
  const B = b.getImageData(x, y, w, h).data;
  let sum = 0;
  const n = w * h;
  for (let i = 0; i < n; i += 2) {
    sum += Math.abs(A[i * 4] - B[i * 4]) + Math.abs(A[i * 4 + 1] - B[i * 4 + 1]);
  }
  return (sum / (n / 2)) / 255; // 0..1 kasar
}
