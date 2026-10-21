"use client";

/* ============================================================
   CLIPPER EDITOR — Shell utama
   Tema gelap sinematik · aksen merah-putih · monospace
   ============================================================ */

import { useEffect } from "react";
import {
  Scissors, Captions, Users, Music, Type, Target, Package, Clapperboard, Zap,
} from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { MediaBar } from "./mediabar";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { StatusBar } from "./statusbar";
import { SplitPanel, SubtitlePanel, SpeakerPanel } from "./inspector/panels-a";
import { MusicPanel, TextPanel, TrackerPanel, ExportPanel } from "./inspector/panels-b";
import { Chip } from "./bits";

const TABS = [
  { key: "split", label: "SPLIT", icon: Scissors },
  { key: "subtitle", label: "SUBTITLE AI", icon: Captions },
  { key: "speaker", label: "PEMBICARA", icon: Users },
  { key: "music", label: "MUSIK", icon: Music },
  { key: "text", label: "TEKS", icon: Type },
  { key: "tracker", label: "LACAK", icon: Target },
  { key: "export", label: "EKSPOR", icon: Package },
];

export function EditorShell() {
  const tab = useClipper((s) => s.tab);
  const setTab = useClipper((s) => s.setTab);
  const setToast = useClipper((s) => s.setToast);

  /* cek dukungan WebCodecs */
  useEffect(() => {
    const ok = typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
    if (!ok) {
      setToast("Browser ini belum mendukung WebCodecs — gunakan Chrome/Edge terbaru untuk ekspor MP4 H.264.");
    }
  }, [setToast]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      {/* ===== TOP BAR ===== */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-sidebar/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 rounded bg-primary shadow-[0_0_20px_rgba(226,29,29,0.5)]">
            <Clapperboard size={16} className="text-white" />
          </div>
          <div className="leading-none">
            <div className="text-[15px] font-bold tracking-[0.22em] clip-glow-text">
              CLIPPER<span className="text-primary">·</span>EDITOR
            </div>
            <div className="text-[8.5px] tracking-[0.3em] text-muted-foreground mt-1">
              AI CLIP STUDIO — 100% OFFLINE ENGINE
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 text-[9.5px] text-muted-foreground">
          <span className="hidden lg:flex items-center gap-1 border border-border rounded px-2 py-1">
            <Zap size={10} className="text-primary" /> WEBCODECS · WASM · WEBGPU-READY
          </span>
          <span className="hidden md:inline border border-border rounded px-2 py-1">7.2K · 1080p · 2K · 4K</span>
          <span className="hidden md:inline border border-primary/50 text-primary/90 rounded px-2 py-1">
            ELEKTRON SIAP — LIHAT PANDUAN .EXE
          </span>
        </div>
      </header>

      {/* ===== BODY ===== */}
      <div className="flex-1 min-h-0 flex">
        {/* kiri: media */}
        <aside className="w-56 shrink-0 border-r border-border bg-sidebar/50 hidden md:flex flex-col">
          <MediaBar />
        </aside>

        {/* tengah: pratinjau + timeline */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <Preview />
          </div>
          <Timeline />
        </main>

        {/* kanan: inspektur */}
        <aside className="w-[21rem] shrink-0 border-l border-border bg-sidebar/50 flex flex-col min-h-0">
          <nav className="flex flex-wrap gap-1 p-2 border-b border-border/60">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                  <Icon size={10} className="inline mr-1" />
                  {t.label}
                </Chip>
              );
            })}
          </nav>
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
            {tab === "split" && <SplitPanel />}
            {tab === "subtitle" && <SubtitlePanel />}
            {tab === "speaker" && <SpeakerPanel />}
            {tab === "music" && <MusicPanel />}
            {tab === "text" && <TextPanel />}
            {tab === "tracker" && <TrackerPanel />}
            {tab === "export" && <ExportPanel />}
          </div>
        </aside>
      </div>

      <StatusBar />
    </div>
  );
}
