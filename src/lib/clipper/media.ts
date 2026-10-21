"use client";

/* ============================================================
   CLIPPER EDITOR — Impor media: MP4 · MKV · TS · WEBM · MP3
   Metadata + thumbnail + estimasi fps (semua lokal, tanpa unggah)
   ============================================================ */

import type { MediaItem } from "./types";
import { uid } from "./format";

export const ACCEPT = ".mp4,.mkv,.ts,.webm,.mp3,.m4a,.mov,.m4v,audio/*,video/*";

const isAudioFile = (f: File) =>
  f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg)$/i.test(f.name);

/** probing metadata via elemen <video>/<audio> — decodability dicek browser */
export function probeFile(file: File): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = isAudioFile(file);
    const el = document.createElement(audio ? "audio" : "video") as HTMLVideoElement;
    el.preload = "metadata";
    el.muted = true;
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
    };

    const fail = (msg: string) => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };

    const timer = setTimeout(() => fail(`Timeout membaca ${file.name}`), 20000);

    el.onerror = () => {
      clearTimeout(timer);
      fail(
        `Browser tidak dapat mendekode "${file.name}". ` +
        `Coba konversi ke MP4 (H.264) / WEBM terlebih dahulu — MKV/TS tertentu tidak didukung decoder bawaan.`
      );
    };

    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = isFinite(el.duration) ? el.duration : 0;
      if (duration <= 0) {
        fail(`Durasi "${file.name}" tidak terbaca — kemungkinan format tidak didukung.`);
        return;
      }
      const item: MediaItem = {
        id: uid("med"),
        name: file.name,
        type: audio ? "audio" : "video",
        mime: file.type || (audio ? "audio/mpeg" : "video/mp4"),
        size: file.size,
        duration,
        width: audio ? 0 : el.videoWidth,
        height: audio ? 0 : el.videoHeight,
        fpsGuess: 30,
        hasAudio: true,
        url,
        addedAt: Date.now(),
      };
      cleanup();
      resolve(item);
    };
    el.src = url;
  });
}

/** ambil thumbnail + perkiraan fps via sampling rVFC */
export async function makeThumb(item: MediaItem): Promise<Partial<MediaItem>> {
  if (item.type === "audio") {
    return { thumb: undefined, fpsGuess: 30 };
  }
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.src = item.url;
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;

    const done = (fps: number) => {
      try {
        const c = document.createElement("canvas");
        const scale = Math.min(1, 320 / Math.max(1, v.videoWidth));
        c.width = Math.max(2, Math.round(v.videoWidth * scale));
        c.height = Math.max(2, Math.round(v.videoHeight * scale));
        const ctx = c.getContext("2d")!;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        resolve({ thumb: c.toDataURL("image/jpeg", 0.7), fpsGuess: fps });
      } catch {
        resolve({ fpsGuess: fps });
      }
      v.removeAttribute("src");
      v.load();
    };

    let frames = 0;
    let t0 = 0;
    let stopped = false;
    const anyV = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };

    const onSeeked = () => {
      // sampling fps: mainkan 0.6s dan hitung frame
      if (anyV.requestVideoFrameCallback && !stopped) {
        t0 = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - t0 < 600) {
            anyV.requestVideoFrameCallback!(tick);
          } else {
            const fps = Math.round((frames / Math.max(1, performance.now() - t0)) * 1000);
            v.pause();
            stopped = true;
            done(Math.min(60, Math.max(15, fps)));
          }
        };
        anyV.requestVideoFrameCallback(tick);
        v.play().catch(() => {
          stopped = true;
          done(30);
        });
      } else {
        done(30);
      }
    };

    v.onseeked = onSeeked;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, item.duration * 0.1);
    };
    v.onerror = () => resolve({});
    setTimeout(() => resolve({}), 15000);
  });
}

export async function importFiles(files: File[]): Promise<{
  items: MediaItem[];
  errors: string[];
}> {
  const items: MediaItem[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      const item = await probeFile(f);
      const extra = await makeThumb(item);
      const full: MediaItem = { ...item, ...extra } as MediaItem;
      if (full.type === "audio") full.width = 0;
      items.push(full);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { items, errors };
}
