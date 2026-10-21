"use client";

/* ============================================================
   CLIPPER EDITOR — Status bar + toast
   ============================================================ */

import { useEffect } from "react";
import { Brain, Radar } from "lucide-react";
import { useClipper } from "@/lib/clipper/store";

export function StatusBar() {
  const busy = useClipper((s) => s.busy);
  const toast = useClipper((s) => s.toast);
  const setToast = useClipper((s) => s.setToast);
  const models = useClipper((s) => s.models);
  const jobsRunning = useClipper((s) => s.jobs.filter((j) => j.status === "running" || j.status === "queued").length);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  const dot = (st: string) =>
    st === "ready" ? "bg-emerald-400" : st === "downloading" ? "bg-amber-400 animate-pulse" : st === "error" ? "bg-primary" : "bg-muted-foreground/40";

  return (
    <div className="relative">
      {toast && (
        <div className="absolute bottom-full left-3 right-3 mb-2 z-50">
          <div className="clip-panel border border-primary/40 rounded px-3 py-2 text-[11px] shadow-[0_0_30px_rgba(0,0,0,0.7)]">
            {toast}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border/60 text-[10px] text-muted-foreground bg-sidebar">
        <span className="flex items-center gap-1.5">
          <span className="clip-led" style={{ width: 6, height: 6 }} /> CLIPPER EDITOR v1.0 · SIARAN LOKAL
        </span>
        <span className="flex items-center gap-1.5" title="Whisper — transkripsi lokal">
          <Brain size={11} className={models.whisper === "ready" ? "text-emerald-400" : "text-muted-foreground"} />
          WHISPER
          <span className={`w-1.5 h-1.5 rounded-full ${dot(models.whisper)}`} />
          {models.whisper === "downloading" && ` ${Math.round(models.whisperProgress * 100)}%`}
        </span>
        <span className="flex items-center gap-1.5" title="YOLOS-tiny — deteksi orang">
          <Radar size={11} className={models.detector === "ready" ? "text-emerald-400" : "text-muted-foreground"} />
          YOLOS-TINY
          <span className={`w-1.5 h-1.5 rounded-full ${dot(models.detector)}`} />
          {models.detector === "downloading" && ` ${Math.round(models.detectorProgress * 100)}%`}
        </span>
        {jobsRunning > 0 && (
          <span className="text-primary uppercase tracking-widest">{jobsRunning} JOB EKSPOR BERJALAN</span>
        )}
        <span className="ml-auto truncate max-w-[40%]">{busy ? `⚙ ${busy}` : "SIAP"}</span>
      </div>
    </div>
  );
}
