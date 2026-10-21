"use client";

/* ============================================================
   CLIPPER EDITOR — Pratinjau interaktif
   Canvas render realtime · transport · rasio 16:9/9:16
   · pan manual (geser kiri/kanan/atas/bawah) · gambar kotak tracker
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Pause, Move, Crosshair, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCcw,
} from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { drawComposite } from "@/lib/clipper/render";
import { seekVideo } from "@/lib/clipper/frames";
import { getCachedSpeaker } from "@/lib/clipper/exporter";
import { buildCropKeys } from "@/lib/clipper/speaker";
import { composeMusic } from "@/lib/clipper/music";
import { ensureFontsLoaded } from "@/lib/clipper/typography";
import { fmtTime } from "@/lib/clipper/format";
import { Chip } from "./bits";
import type { CropKey } from "@/lib/clipper/speaker";
import type { MediaItem } from "@/lib/clipper/types";

export function Preview() {
  const media = useClipper((s) => s.media.find((m) => m.id === s.selectedId));
  const settings = useClipper((s) => s.settings);
  const time = useClipper((s) => s.time);
  const playing = useClipper((s) => s.playing);
  const setTime = useClipper((s) => s.setTime);
  const setPlaying = useClipper((s) => s.setPlaying);
  const patchZoomPan = useClipper((s) => s.patchZoomPan);
  const patchTracker = useClipper((s) => s.patchTracker);
  const patchExport = useClipper((s) => s.patchExport);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const keysRef = useRef<CropKey[] | null>(null);
  const musicBufRef = useRef<{ preset: string; buf: AudioBuffer | null }>({ preset: "none", buf: null });
  const musicSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [boxMode, setBoxMode] = useState(false);
  const dragRef = useRef<{ x: number; y: number; pan: boolean; sx: number; sy: number } | null>(null);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const [fps, setFps] = useState(0);

  const aspect = settings.export.aspect;
  const speakerOn = settings.speaker.enabled;

  /* ---------- video element ---------- */
  useEffect(() => {
    if (!media || media.type === "audio") {
      videoRef.current = null;
      return;
    }
    const v = document.createElement("video");
    v.src = media.url;
    v.muted = false;
    v.preload = "auto";
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    videoRef.current = v;
    keysRef.current = null;
    return () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
      videoRef.current = null;
    };
  }, [media?.id, media?.url]);

  /* ---------- muat font (sekali) ---------- */
  useEffect(() => {
    ensureFontsLoaded();
  }, []);

  /* ---------- analisis pembicara (lazy, ter-cache) ---------- */
  useEffect(() => {
    let alive = true;
    if (!media || media.type === "audio" || !speakerOn) {
      keysRef.current = null;
      return;
    }
    (async () => {
      try {
        setBusy("Analisis zoom pembicara…");
        const a = await getCachedSpeaker(media as MediaItem, settings.speaker);
        if (!alive) return;
        keysRef.current = buildCropKeys(a, settings.speaker, (media.width || 16) / (media.height || 9));
        setBusy(null);
        setToast(
          a.fallback
            ? "AI sulit mengenali — mode cadangan 2-bagian (kiri/kanan) aktif"
            : `Pembicara terdeteksi: ${a.persons.length} · segmen: ${a.segments.length}`
        );
      } catch (e) {
        if (alive) {
          setBusy(null);
          setToast(`Analisis pembicara gagal: ${e instanceof Error ? e.message : e}`);
        }
      }
    })();
    return () => {
      alive = false;
    };
     
  }, [media?.id, speakerOn, settings.speaker.transition, settings.speaker.speed, settings.speaker.silent, settings.speaker.useFace, settings.speaker.useAudio]);

  /* ---------- ukuran canvas ---------- */
  const fitCanvas = useCallback(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const maxW = Math.max(320, wrap.clientWidth);
    const maxH = Math.max(240, wrap.clientHeight);
    const A = aspect === "9:16" ? 9 / 16 : 16 / 9;
    let w = Math.min(maxW, maxH * A);
    let h = w / A;
    if (h > maxH) {
      h = maxH;
      w = h * A;
    }
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${Math.round(w)}px`;
    c.style.height = `${Math.round(h)}px`;
  }, [aspect]);

  useEffect(() => {
    fitCanvas();
    const ro = new ResizeObserver(() => fitCanvas());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fitCanvas]);

  /* ---------- gambar frame ---------- */
  const drawAt = useCallback(
    (t: number) => {
      const c = canvasRef.current;
      const v = videoRef.current;
      if (!c) return;
      if (!media || media.type === "audio") {
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = "#8e8e98";
        ctx.font = `${Math.round(c.width / 32)}px "JetBrains Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(media ? "♫ AUDIO ONLY — GUNAKAN SEBAGAI BACKSOUND" : "IMPOR MEDIA UNTUK MULAI", c.width / 2, c.height / 2);
        return;
      }
      drawComposite({
        src: (v && v.readyState >= 2 ? v : v) as HTMLVideoElement,
        srcW: v?.videoWidth || media.width || 1920,
        srcH: v?.videoHeight || media.height || 1080,
        out: c,
        t,
        aspect: settings.export.aspect,
        zoomPan: settings.zoomPan,
        speakerKeys: keysRef.current,
        speakerCfg: settings.speaker,
        subtitle: settings.subtitle,
        texts: settings.texts,
        tracker: settings.tracker,
        watermark: settings.watermark,
        effects: settings.effects,
      });
    },
    [media, settings]
  );

  // loop render
  useEffect(() => {
    let last = performance.now();
    let frames = 0;
    let acc = 0;
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const v = videoRef.current;
      if (playing && v && !v.paused) {
        acc += dt;
        frames++;
        if (acc >= 0.5) {
          setFps(Math.round(frames / acc));
          frames = 0;
          acc = 0;
        }
        drawAt(v.currentTime);
        setTime(v.currentTime);
      } else if (!playing) {
        drawAt(time);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, time, drawAt, setTime]);

  /* ---------- musik pratinjau ---------- */
  const startMusic = useCallback(
    async (offset: number) => {
      const preset = settings.music.preset;
      if (preset === "none") return;
      try {
        if (musicBufRef.current.preset !== preset || !musicBufRef.current.buf) {
          setBusy("Mengomposisi musik AI…");
          const buf = await composeMusic(preset, 60, 0);
          musicBufRef.current = { preset, buf };
          setBusy(null);
        }
        const buf = musicBufRef.current.buf;
        if (!buf) return;
        const ctx = new AudioContext();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = settings.music.gain;
        src.connect(g).connect(ctx.destination);
        src.start(0, offset % buf.duration);
        musicSrcRef.current = src;
        musicGainRef.current = g;
         
        (src as any)._ctx = ctx;
      } catch (e) {
        setBusy(null);
        setToast(`Musik gagal: ${e instanceof Error ? e.message : e}`);
      }
    },
    [settings.music.preset, settings.music.gain]
  );

  const stopMusic = useCallback(() => {
    if (musicSrcRef.current) {
      try {
        musicSrcRef.current.stop();
         
        const ctx = (musicSrcRef.current as any)._ctx as AudioContext | undefined;
        ctx?.close();
      } catch { /* aman */ }
      musicSrcRef.current = null;
    }
  }, []);

  useEffect(() => () => stopMusic(), [stopMusic]);

  /* ---------- kontrol putar/jeda ---------- */
  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !media || media.type === "audio") return;
    if (playing) {
      v.pause();
      stopMusic();
      setPlaying(false);
    } else {
      try {
        await seekVideo(v, time >= media.duration - 0.05 ? 0 : time);
        await v.play();
        startMusic(time);
        setPlaying(true);
      } catch (e) {
        setToast(`Gagal memutar: ${e instanceof Error ? e.message : e}`);
      }
    }
     
  }, [playing, time, media, startMusic, stopMusic]);

  /* ---------- seek dari slider ---------- */
  const doSeek = useCallback(
    async (t: number) => {
      setTime(t);
      const v = videoRef.current;
      if (v && media) {
        v.pause();
        await seekVideo(v, t);
        drawAt(t);
      }
    },
    [media, setTime, drawAt]
  );

  /* ---------- pan / kotak dengan mouse ---------- */
  const normPos = (e: React.MouseEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const p = normPos(e);
    if (boxMode) {
      boxStartRef.current = p;
      return;
    }
    if (panMode) {
      dragRef.current = { x: p.x, y: p.y, pan: true, sx: settings.zoomPan.panX, sy: settings.zoomPan.panY };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (d?.pan) {
      const p = normPos(e);
      const z = settings.zoomPan.zoom;
      const k = 0.9 / z;
      patchZoomPan({
        panX: Math.max(-0.5, Math.min(0.5, d.sx - (p.x - d.x) * k)),
        panY: Math.max(-0.5, Math.min(0.5, d.sy - (p.y - d.y) * k)),
      });
      return;
    }
    if (boxMode && boxStartRef.current && media) {
      // gambar kotak sementara di overlay canvas via ctx langsung
      const c = canvasRef.current;
      if (!c) return;
      const p = normPos(e);
      drawAt(time);
      const ctx = c.getContext("2d")!;
      const x0 = boxStartRef.current.x * c.width;
      const y0 = boxStartRef.current.y * c.height;
      ctx.strokeStyle = settings.tracker.label.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, (p.x - boxStartRef.current.x) * c.width, (p.y - boxStartRef.current.y) * c.height);
      ctx.setLineDash([]);
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (boxMode && boxStartRef.current && media) {
      const p = normPos(e);
      const s = boxStartRef.current;
      const x = Math.min(s.x, p.x);
      const y = Math.min(s.y, p.y);
      const w = Math.abs(p.x - s.x);
      const h = Math.abs(p.y - s.y);
      if (w > 0.02 && h > 0.02) {
        patchTracker({ box: { x, y, w, h }, anchorTime: time, enabled: true, path: [] });
        setToast("Kotak template disimpan — tekan LACAK SEKARANG di panel LACAK OBJEK");
      }
      boxStartRef.current = null;
      setBoxMode(false);
      return;
    }
    dragRef.current = null;
  };

  const nudge = (dx: number, dy: number) => {
    patchZoomPan({
      panX: Math.max(-0.5, Math.min(0.5, settings.zoomPan.panX + dx)),
      panY: Math.max(-0.5, Math.min(0.5, settings.zoomPan.panY + dy)),
    });
  };

  const dur = media?.duration ?? 0;
  const A = aspect === "9:16" ? "9:16 VERTIKAL" : "16:9 LANDSCAPE";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header pratinjau */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="clip-led" />
          <span className="clip-label">PRATINJAU {media ? `· ${media.name.slice(0, 26)}` : ""}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Chip active={aspect === "16:9"} onClick={() => patchExport({ aspect: "16:9" })}>16:9</Chip>
          <Chip active={aspect === "9:16"} onClick={() => patchExport({ aspect: "9:16" })}>9:16</Chip>
        </div>
      </div>

      {/* area canvas */}
      <div ref={wrapRef} className="flex-1 min-h-0 flex items-center justify-center p-3 clip-grid-bg relative">
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          className={
            "clip-scanlines relative rounded shadow-[0_0_60px_rgba(0,0,0,0.8)] border border-border " +
            (panMode || boxMode ? "cursor-crosshair" : "cursor-default")
          }
        />
        {aspect === "9:16" && (
          <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1 bg-card/85 border border-border rounded p-1.5 backdrop-blur">
            <button className="p-1 hover:text-primary" title="Geser atas" onClick={() => nudge(0, -0.08)}>
              <ArrowUp size={14} />
            </button>
            <div className="flex gap-1">
              <button className="p-1 hover:text-primary" title="Geser kiri" onClick={() => nudge(-0.08, 0)}>
                <ArrowLeft size={14} />
              </button>
              <button className="p-1 hover:text-primary" title="Geser kanan" onClick={() => nudge(0.08, 0)}>
                <ArrowRight size={14} />
              </button>
            </div>
            <button className="p-1 hover:text-primary" title="Geser bawah" onClick={() => nudge(0, 0.08)}>
              <ArrowDown size={14} />
            </button>
          </div>
        )}
      </div>

      {/* transport */}
      <div className="px-3 py-2 border-t border-border/60 space-y-2">
        <input
          type="range"
          className="clip-range"
          style={{ ["--fill" as string]: `${dur ? (time / dur) * 100 : 0}%` }}
          min={0}
          max={dur || 1}
          step={0.01}
          value={time}
          onChange={(e) => doSeek(Number(e.target.value))}
          disabled={!media || media.type === "audio"}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              onClick={togglePlay}
              disabled={!media || media.type === "audio"}
              className="p-2 rounded bg-primary text-primary-foreground disabled:opacity-30 hover:brightness-110"
              title="Putar / Jeda"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <span className="text-[11px] text-foreground/70 tabular-nums">
              {fmtTime(time, true)} / {fmtTime(dur)}
            </span>
            {playing && <span className="text-[10px] text-muted-foreground">{fps} fps render</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Chip active={panMode} onClick={() => { setPanMode(!panMode); setBoxMode(false); }} title="Geser crop dengan mouse">
              <Move size={11} className="inline mr-1" />PAN
            </Chip>
            <Chip active={boxMode} onClick={() => { setBoxMode(!boxMode); setPanMode(false); }} title="Gambar kotak objek untuk tracker">
              <Crosshair size={11} className="inline mr-1" />KOTAK
            </Chip>
            <Chip onClick={() => { patchZoomPan({ zoom: 1, panX: 0, panY: 0 }); }} title="Reset zoom/pan">
              <RotateCcw size={11} className="inline mr-1" />RESET
            </Chip>
            <span className="text-[10px] text-muted-foreground hidden md:inline">{A}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
