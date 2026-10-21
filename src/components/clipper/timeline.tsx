"use client";

/* ============================================================
   CLIPPER EDITOR — Timeline bagian (parts) + kursor waktu
   ============================================================ */

import { useClipper } from "@/lib/clipper/store";
import { fmtTime } from "@/lib/clipper/format";
import { Film } from "lucide-react";

export function Timeline() {
  const media = useClipper((s) => s.media.find((m) => m.id === s.selectedId));
  const parts = useClipper((s) => (s.selectedId ? s.parts[s.selectedId] : undefined)) ?? [];
  const time = useClipper((s) => s.time);
  const setTime = useClipper((s) => s.setTime);
  const splitMode = useClipper((s) => s.settings.split.mode);

  const dur = media?.duration ?? 0;
  const pct = (t: number) => `${dur ? (t / dur) * 100 : 0}%`;

  return (
    <div className="px-3 py-2 border-t border-border/60">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Film size={11} className="text-primary" />
          <span className="clip-label">
            TIMELINE {media ? `· ${media.name.slice(0, 30)}` : ""} · MODE: {splitMode.toUpperCase()}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {fmtTime(time)} / {fmtTime(dur)}
        </span>
      </div>

      <div
        className="relative h-9 rounded bg-secondary/50 border border-border overflow-hidden cursor-pointer"
        onClick={(e) => {
          if (!media) return;
          const r = e.currentTarget.getBoundingClientRect();
          setTime(((e.clientX - r.left) / r.width) * media.duration);
        }}
      >
        {/* blok bagian */}
        {parts.map((p, i) => (
          <div
            key={p.id}
            className="absolute top-0 h-full border-r border-black/60 flex items-center px-1 overflow-hidden"
            style={{
              left: pct(p.start),
              width: pct(p.end - p.start),
              background: `linear-gradient(180deg, rgba(226,29,29,${0.28 + (i % 2) * 0.14}), rgba(226,29,29,${0.12 + (i % 2) * 0.1}))`,
            }}
          >
            <span className="text-[8.5px] tracking-wider text-white/90 truncate">{p.label}</span>
          </div>
        ))}
        {!parts.length && media && (
          <div className="absolute inset-0 flex items-center px-2">
            <span className="text-[9px] text-muted-foreground">
              {media.type === "audio" ? "♫ AUDIO" : `${media.width}×${media.height}`} — jalankan split untuk memecah
              jadi bagian
            </span>
          </div>
        )}
        {/* kursor */}
        <div className="absolute top-0 h-full w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" style={{ left: pct(time) }}>
          <div className="w-2 h-2 -ml-[3px] bg-white rotate-45 mt-[-2px]" />
        </div>
      </div>
    </div>
  );
}
