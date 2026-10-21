"use client";

/* ============================================================
   CLIPPER EDITOR — ANTREAN EKSPOR GLOBAL (v1.2.6)
   Satu jalur antrean untuk SEMUA tombol ekspor di aplikasi:
   EKSPOR VIDEO INI · EKSPOR PARTS · BATCH SEMUA · GABUNG VIDEO
   · ekspor momen di panel AI MOMEN.

   v1.2.6 — dulu ada 2 masalah fatal:
   1. Antrean hidup di useRef panel Ekspor → pindah tab (unmount) =
      antrean hilang; kembali ke tab = antrean BARU bisa berlari
      BERSAMAAN dengan loop lama → 2 encoding serentak → RAM meledak.
   2. Panel AI MOMEN memanggil processJob LANGSUNG tanpa antrean →
      job momen & job ekspor bisa jalan serentak juga.
   Kini: antrean serial di level modul — hanya SATU job yang pernah
   jalan kapan pun, bertahan meski panel dibuka/tutup/pindah tab.
   ============================================================ */

import { processJob } from "./exporter";
import type { ClipSettings, ExportJob, MediaItem } from "./types";

export interface QueueCtx {
  getMedia: (id: string) => MediaItem | undefined;
  getClip: () => ClipSettings;
  update: (id: string, p: Partial<ExportJob>) => void;
}

const pending: { job: ExportJob; ctx: QueueCtx }[] = [];
let running = false;
let ctxDefault: QueueCtx | null = null;

/** pasang konteks bawaan (dipanggil panel; aman dipanggil berulang) */
export function setQueueCtx(ctx: QueueCtx) {
  ctxDefault = ctx;
}

/** jumlah job yang masih menunggu giliran */
export function queueWaiting(): number {
  return pending.length;
}

/** masukkan job ke antrean — akan diproses berurutan */
export function enqueueExportJob(job: ExportJob, ctx?: QueueCtx): void {
  const c = ctx ?? ctxDefault;
  if (!c) {
    // tanpa konteks tidak mungkin memproses — tandai job gagal agar UI tidak menggantung
    ctx?.update(job.id, { status: "error", error: "Antrean belum siap", stage: "Gagal", finishedAt: Date.now() });
    return;
  }
  pending.push({ job, ctx: c });
  void drain();
}

/** batal menunggu (job belum jalan) — dipakai tombol X pada job "queued" */
export function dequeueExportJob(id: string): boolean {
  const i = pending.findIndex((p) => p.job.id === id);
  if (i >= 0) {
    pending.splice(i, 1);
    return true;
  }
  return false;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const item = pending.shift()!;
      try {
        await processJob(item.job, item.ctx.getMedia, item.ctx.getClip(), (p) =>
          item.ctx.update(item.job.id, p)
        );
      } catch {
        /* processJob sudah menangkap error ke status job — lapis ganda di sini */
      }
    }
  } finally {
    running = false;
  }
}
