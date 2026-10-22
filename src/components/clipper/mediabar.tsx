"use client";

/* ============================================================
   CLIPPER EDITOR — Pustaka media (Kotak Impor)
   MP4 · MKV · TS · WEBM · MP3 — drag & drop, semua lokal
   ============================================================ */

import { useCallback, useRef, useState } from "react";
import { Film, Music2, Trash2, Upload, Box } from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { importFiles, ACCEPT } from "@/lib/clipper/media";
import { fmtTime, fmtSize } from "@/lib/clipper/format";
import { warmWhisper, subPersistedModel } from "@/lib/clipper/whisper";
import { warmDetector } from "@/lib/clipper/detection";

export function MediaBar() {
  const media = useClipper((s) => s.media);
  const addMedia = useClipper((s) => s.addMedia);
  const removeMedia = useClipper((s) => s.removeMedia);
  const selectedId = useClipper((s) => s.selectedId);
  const select = useClipper((s) => s.select);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (!arr.length) return;
      setBusy(`Membaca ${arr.length} file…`);
      const { items, errors } = await importFiles(arr);
      for (const it of items) addMedia(it);
      setBusy(null);
      if (items.length) {
        if (!selectedId) select(items[0].id);
        setToast(`${items.length} media masuk kotak${errors.length ? ` · ${errors.length} gagal` : ""}`);
        /* v1.2.8 — PANASKAN MESIN AI DI LATAR BELAKANG: model Whisper
           (worker) + YOLOS (detektor) dimuat SEKARANG, saat pengguna
           masih memilih mode split. Saat AI dipakai, sudah siap —
           tidak ada lagi "Memuat model…" di tengah proses.
           Keduanya DIJEDA BERBEDA agar tidak berebut CPU/disk saat
           impor besar berlangsung. */
        setTimeout(() => warmWhisper(subPersistedModel()), 350);
        setTimeout(() => warmDetector(), 3000);
      }
      if (errors.length) setToast(errors[0]);
    },
    [addMedia, select, selectedId, setBusy, setToast]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Box size={13} className="text-primary" />
          <span className="clip-label">KOTAK MEDIA ({media.length})</span>
        </div>
        <button
          className="text-[10px] uppercase tracking-widest text-primary hover:brightness-125 flex items-center gap-1"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={11} /> IMPOR
        </button>
      </div>

      <div
        className={
          "mx-2 mt-2 rounded border border-dashed p-3 text-center cursor-pointer transition-all " +
          (dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50")
        }
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload size={16} className="mx-auto mb-1 text-muted-foreground" />
        <div className="text-[10.5px] text-muted-foreground leading-relaxed">
          SERET & LEPAS VIDEO / AUDIO DI SINI
          <br />
          <span className="text-primary/80">MP4 · MKV · TS · WEBM · MP3</span>
          <br />
          <span className="text-[9px] text-muted-foreground/70">API WebCodecs — 100% lokal, tanpa unggah</span>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {media.map((m) => (
          <div
            key={m.id}
            onClick={() => select(m.id)}
            className={
              "group flex items-center gap-2 rounded p-1.5 cursor-pointer border transition-all " +
              (selectedId === m.id
                ? "border-primary/70 bg-primary/10"
                : "border-transparent bg-secondary/40 hover:border-border")
            }
          >
            <div className="w-14 h-9 shrink-0 rounded bg-black/60 border border-border overflow-hidden flex items-center justify-center">
              {m.thumb ? (
                 
                <img src={m.thumb} alt={m.name} className="w-full h-full object-cover" />
              ) : m.type === "audio" ? (
                <Music2 size={14} className="text-primary" />
              ) : (
                <Film size={14} className="text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] truncate">{m.name}</div>
              <div className="text-[9.5px] text-muted-foreground">
                {m.type === "audio"
                  ? `♫ AUDIO · ${fmtTime(m.duration)}`
                  : `${m.width}×${m.height} · ${fmtTime(m.duration)} · ${fmtSize(m.size)}`}
              </div>
            </div>
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                removeMedia(m.id);
              }}
              title="Hapus dari kotak"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!media.length && (
          <div className="text-center text-[10px] text-muted-foreground/60 pt-4">
            Kotak masih kosong — impor media pertamamu
          </div>
        )}
      </div>
    </div>
  );
}
