/* ============================================================
   CLIPPER EDITOR — Tipe data inti
   ============================================================ */

export type AspectMode = "16:9" | "9:16";
export type ResolutionKey = "720p" | "1080p" | "2k" | "4k";
export type FpsKey = 24 | 30 | 60;

export interface ResolutionPreset {
  key: ResolutionKey;
  label: string;
  short: string;
  landscape: { w: number; h: number };
  portrait: { w: number; h: number };
  /** bitrate video Mbps @30fps */
  mbps30: number;
  mbps60: number;
  /** H.264 level idc: 0x28=4.0, 0x2a=4.2, 0x33=5.1, 0x34=5.2 */
  level: number;
}

export const RESOLUTIONS: Record<ResolutionKey, ResolutionPreset> = {
  "720p": {
    key: "720p", label: "720p HD", short: "720p",
    landscape: { w: 1280, h: 720 }, portrait: { w: 720, h: 1280 },
    mbps30: 6, mbps60: 9, level: 0x28,
  },
  "1080p": {
    key: "1080p", label: "1080p FULL HD", short: "1080p",
    landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 },
    mbps30: 10, mbps60: 15, level: 0x2a,
  },
  "2k": {
    key: "2k", label: "2K QHD", short: "2K",
    landscape: { w: 2560, h: 1440 }, portrait: { w: 1440, h: 2560 },
    mbps30: 20, mbps60: 28, level: 0x33,
  },
  "4k": {
    key: "4k", label: "4K ULTRA HD", short: "4K",
    landscape: { w: 3840, h: 2160 }, portrait: { w: 2160, h: 3840 },
    mbps30: 40, mbps60: 56, level: 0x34,
  },
};

export interface MediaItem {
  id: string;
  name: string;
  type: "video" | "audio";
  mime: string;
  size: number;
  duration: number; // detik
  width: number;
  height: number;
  fpsGuess: number;
  hasAudio: boolean;
  url: string; // objectURL
  thumb?: string; // dataURL
  /** pesan bila browser tidak bisa memutar */
  broken?: string;
  addedAt: number;
}

/* ---------- SPLIT / PARTS ---------- */

export type SplitMode = "manual" | "seconds" | "parts" | "scene";

export interface Part {
  id: string;
  start: number;
  end: number;
  label: string;
  origin: SplitMode;
}

/* ---------- SUBTITLE ---------- */

export interface SubCue {
  start: number;
  end: number;
  text: string;
  /** hasil terjemahan opsional */
  translated?: string;
}

export type SubtitleRenderMode = "burnin" | "srt" | "off";
export type SubtitlePos = "bottom" | "center" | "top";

export interface SubtitleConfig {
  mode: SubtitleRenderMode;
  cues: SubCue[];
  fontSize: number; // % tinggi frame
  position: SubtitlePos;
  style: "karaoke" | "box" | "outline" | "minimal";
  color: string;
  highlight: string;
  showTranslated: boolean;
}

/* ---------- ZOOM PEMBICARA ---------- */

export type SpeakerTransition = "pan" | "fade" | "cut";
export type SpeakerSpeed = "fast" | "normal" | "slow";
export type SilentBehavior = "hold" | "all";

export interface SpeakerConfig {
  enabled: boolean;
  transition: SpeakerTransition;
  speed: SpeakerSpeed;
  silent: SilentBehavior;
  useFace: boolean;
  useAudio: boolean;
  model: "yolos-tiny";
}

export interface SpeakerSegment {
  t0: number;
  t1: number;
  /** indeks orang aktif: 0..n-1, -1 = semua (wide) */
  person: number;
  /** 0 = kiri, 1 = kanan, -1 = semua (fallback 2-bagian) */
  zone: 0 | 1 | -1;
  conf: number;
}

/* ---------- MUSIK ---------- */

export type MusicPreset = "epic" | "lofi" | "cinematic" | "uplift" | "tension" | "none";

export interface MusicConfig {
  preset: MusicPreset;
  gain: number; // 0..1
  duckOriginal: number; // 0..1
  customUrl?: string;
  customName?: string;
  customBuffer?: AudioBuffer;
  loopCustom: boolean;
  fadeOut: number; // detik
}

/* ---------- TIPOGRAFI ---------- */

export interface TextLayer {
  id: string;
  text: string;
  sub: string;
  font: string;
  style: "epic" | "lower-third" | "neon" | "quote" | "meme";
  start: number;
  end: number;
  posY: number; // 0..1
  size: number; // % lebar frame
  color: string;
  accent: string;
  anim: "fade" | "slide" | "zoom" | "none";
}

/* ---------- TRACKER ---------- */

export interface TrackerConfig {
  enabled: boolean;
  anchorTime: number;
  box: { x: number; y: number; w: number; h: number } | null;
  label: { text: string; sub: string; color: string };
  /** jadwal per 0.1s, koordinat normalisasi */
  path: { t: number; x: number; y: number; w: number; h: number; found: boolean }[];
}

/* ---------- EFEK VISUAL ---------- */

export type EffectKey =
  | "none" | "bw" | "warm" | "cool" | "vignette" | "grain"
  | "mirror" | "contrast" | "dreamy" | "glitch";

export interface EffectConfig {
  main: EffectKey;
  intensity: number; // 0..1
}

/* ---------- ZOOM/PAN MANUAL ---------- */

export interface ZoomPanConfig {
  zoom: number; // 1..4
  panX: number; // -0.5..0.5
  panY: number;
}

/* ---------- EKSPOR ---------- */

export type ExportTarget = "current" | "split" | "batch" | "merge" | "range";

export interface ExportSettings {
  resolution: ResolutionKey;
  /** AUTO = ikuti skala 100/75/50%; chip resolusi ↔ skala saling mengunci dua arah */
  autoMode: boolean;
  scale: 100 | 75 | 50;
  fps: FpsKey;
  quality: "high" | "balanced" | "compact";
  targetMB: number | null;
  aspect: AspectMode;
  /** akselerasi encoder: GPU (prefer-hardware) / CPU / auto */
  hw?: "auto" | "gpu" | "cpu";
}

export interface ExportRange {
  mediaId: string;
  start: number;
  end: number;
}

export interface ExportJob {
  id: string;
  name: string;
  target: ExportTarget;
  ranges: ExportRange[];
  settings: ExportSettings;
  status: "queued" | "running" | "done" | "error" | "canceled";
  progress: number;
  stage: string;
  resultUrl?: string;
  resultName?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

/* ---------- MODEL AI ---------- */

export interface ModelStatus {
  whisper: "idle" | "downloading" | "ready" | "error";
  whisperProgress: number;
  whisperReady: string | null;
  detector: "idle" | "downloading" | "ready" | "error";
  detectorProgress: number;
}

/* ---------- WATERMARK ---------- */

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number;
  scale: number;
  corner: "tl" | "tr" | "bl" | "br";
}

/* ---------- KONFIGURASI GLOBAL ---------- */

export interface ClipSettings {
  split: { mode: SplitMode; seconds: number; parts: number; minScene: number; sensitivity: number };
  subtitle: SubtitleConfig;
  speaker: SpeakerConfig;
  music: MusicConfig;
  texts: TextLayer[];
  tracker: TrackerConfig;
  effects: EffectConfig;
  zoomPan: ZoomPanConfig;
  watermark: WatermarkConfig;
  export: ExportSettings;
}

export function defaultSettings(): ClipSettings {
  return {
    split: { mode: "seconds", seconds: 30, parts: 4, minScene: 2, sensitivity: 0.5 },
    subtitle: {
      mode: "off", cues: [], fontSize: 5, position: "bottom",
      style: "karaoke", color: "#ffffff", highlight: "#ef2b2b",
      showTranslated: false,
    },
    speaker: {
      enabled: false, transition: "fade", speed: "normal",
      silent: "hold", useFace: true, useAudio: true, model: "yolos-tiny",
    },
    music: { preset: "none", gain: 0.35, duckOriginal: 0.3, loopCustom: true, fadeOut: 2 },
    texts: [],
    tracker: {
      enabled: false, anchorTime: 0, box: null,
      label: { text: "OBJEK 01", sub: "TERLACAK", color: "#ef2b2b" }, path: [],
    },
    effects: { main: "none", intensity: 0.6 },
    zoomPan: { zoom: 1, panX: 0, panY: 0 },
    watermark: { enabled: false, text: "@CLIPPER", opacity: 0.7, scale: 3.2, corner: "br" },
    export: {
      resolution: "1080p", autoMode: false, scale: 100,
      fps: 30, quality: "high", targetMB: null, aspect: "16:9",
    },
  };
}
