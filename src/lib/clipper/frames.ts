"use client";

/* ============================================================
   CLIPPER EDITOR — Frame engine
   Ekstraksi frame presisi via seek elemen video + canvas.
   Dipakai scene detection, zoom pembicara, tracker, ekspor.
   ============================================================ */

/* ============================================================
   v1.2.6 — ANTI-FREEZE
   Dulu seekVideo menunggu requestAnimationFrame + event "seeked"
   TANPA batas waktu. Saat jendela di-minimize/tertutup jendela lain
   (atau Chromium kehilangan event seeked pada file tertentu), rAF bisa
   BERHENTI TOTAL → await seekVideo() menggantung SELAMANYA →
   ekspor beku di frame terakhir (mis. "Encoding 270/7239… 1%"),
   tombol BATAL tidak bereaksi, dan SELURUH ANTREAN EKSPOR MATI
   (job berikutnya "Menunggu antrean… 0%" selamanya).

   Solusi:
   1. Kesiapan pixel TIDAK lagi bergantung pada rAF saja —
      dirace dengan setTimeout 80 ms (timer tetap jalan di background).
   2. Event "seeked" diberi batas waktu (default 20 dtk) → gagal JELAS,
      job berhenti dengan pesan (antrean lanjut), bukan beku selamanya.
   ============================================================ */

const raf =
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
const caf =
  typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame
    : ((h: number) => clearTimeout(h)) as (h: number) => void;

/** tunggu 1 frame render — rAF dirace timer agar TIDAK PERNAH menggantung
    saat jendela minimize (rAF bisa mati total di background) */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      caf(handle);
      clearTimeout(timer);
      resolve();
    };
    const handle = raf(fin);
    const timer = setTimeout(fin, 80); // cadangan — timer tetap hidup di background
  });
}

/** seek presisi: set currentTime dan tunggu frame benar-benar siap.
    timeoutMs: batas tunggu event seeked (0 = tanpa batas — hindari). */
export function seekVideo(v: HTMLVideoElement, t: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onErr);
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const onSeeked = () => {
      cleanup();
      // tunggu satu frame render agar pixel benar-benar siap (anti-hang)
      nextPaint().then(resolve, () => resolve());
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Gagal seek video — file mungkin rusak pada bagian ini"));
    };

    if (v.readyState < 1) {
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        seekVideo(v, t, timeoutMs).then(resolve).catch(reject);
      };
      v.addEventListener("loadedmetadata", onMeta);
      return;
    }

    const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.001));
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", onErr);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Seek video macet (batas ${Math.round(timeoutMs / 1000)} dtk) pada t=${target.toFixed(2)} dtk`
          )
        );
      }, timeoutMs);
    }
    const eps = Math.abs(v.currentTime - target);
    if (eps < 0.0005 && v.readyState >= 2) {
      cleanup();
      nextPaint().then(resolve, () => resolve());
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

/** buka elemen video untuk diproses — SELALU selesai (timeout + pesan jelas).
    v1.2.6 — dulu exporter menunggu onloadedmetadata tanpa batas: media
    gagal dibuka = job menggantung diam tanpa status. */
export function openVideo(url: string, timeoutMs = 30000): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      v.onloadedmetadata = null;
      v.onerror = null;
      v.removeAttribute("src");
      v.load();
      reject(new Error("Video tidak dapat dibuka untuk diproses (timeout) — format mungkin tidak didukung"));
    }, timeoutMs);
    v.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.onloadedmetadata = null;
      v.onerror = null;
      resolve(v);
    };
    v.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.onloadedmetadata = null;
      v.onerror = null;
      reject(new Error("Video tidak dapat dibuka untuk diproses — codec tidak didukung browser"));
    };
    v.src = url;
  });
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** ambil 1 frame ke canvas (dengan ukuran custom).
    v1.2.8 — `into` (opsional): pakai ulang canvas yang sama (hemat alokasi
    untuk refine adegan & analisis panjang); bila kosong dibuat baru. */
export async function grabFrame(
  v: HTMLVideoElement,
  t: number,
  w?: number,
  h?: number,
  into?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  await seekVideo(v, t);
  const cw = w ?? v.videoWidth;
  const ch = h ?? v.videoHeight;
  const c = into ?? makeCanvas(cw, ch);
  if (c.width !== cw) c.width = cw;
  if (c.height !== ch) c.height = ch;
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
  // v1.2.6 — openVideo: selalu ada batas waktu + pesan jelas
  const v = await openVideo(url, 30000).catch((e) => {
    throw e instanceof Error ? e : new Error("Tidak dapat membuka video untuk sampling");
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

/** histogram warna terkuantisasi (RGB 3-bit/channel = 512 bin).
    v1.2.8 — `out` (opsional): tulis ke array yang sama (tanpa alokasi baru). */
export function colorHistogram(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  out?: Float32Array
): Float32Array {
  const hist = out && out.length === 512 ? out : new Float32Array(512);
  hist.fill(0);
  const data = ctx.getImageData(0, 0, w, h).data;
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
