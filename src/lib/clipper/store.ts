"use client";

/* ============================================================
   CLIPPER EDITOR — Store global (Zustand)
   Setelan ekspor & efek tersimpan di localStorage:
   "setelan tetap aktif untuk video berikutnya"
   ============================================================ */

import { create } from "zustand";
import {
  defaultSettings, type ClipSettings, type ExportJob, type MediaItem,
  type ModelStatus, type Part, type SplitMode, type TextLayer,
} from "./types";
import { uid } from "./format";

const LS_KEY = "clipper-editor-settings-v1";

function loadPersisted(): Partial<ClipSettings> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClipSettings>;
    return parsed;
  } catch {
    return null;
  }
}

function persist(settings: ClipSettings) {
  if (typeof window === "undefined") return;
  try {
    // AudioBuffer & objectURL tidak bisa diserialisasi — buang sebelum simpan
    const clean: ClipSettings = {
      ...settings,
      music: { ...settings.music, customBuffer: undefined, customUrl: undefined },
      subtitle: { ...settings.subtitle, cues: [] },
      tracker: { ...settings.tracker, path: [], box: null, enabled: false },
    };
    localStorage.setItem(LS_KEY, JSON.stringify(clean));
  } catch {
    /* kuota penuh — abaikan */
  }
}

interface ClipperState {
  media: MediaItem[];
  selectedId: string | null;
  parts: Record<string, Part[]>; // per mediaId
  settings: ClipSettings;
  jobs: ExportJob[];
  models: ModelStatus;
  /* playback */
  playing: boolean;
  time: number;
  /* UI */
  tab: string;
  busy: string | null; // teks status proses berat
  toast: string | null;

  setMedia: (m: MediaItem[]) => void;
  addMedia: (m: MediaItem) => void;
  removeMedia: (id: string) => void;
  select: (id: string | null) => void;
  selected: () => MediaItem | undefined;

  setParts: (mediaId: string, parts: Part[]) => void;
  partsOf: (mediaId: string) => Part[];

  patch: (p: Partial<ClipSettings>) => void;
  patchSplit: (p: Partial<ClipSettings["split"]>) => void;
  patchSubtitle: (p: Partial<ClipSettings["subtitle"]>) => void;
  patchSpeaker: (p: Partial<ClipSettings["speaker"]>) => void;
  patchMusic: (p: Partial<ClipSettings["music"]>) => void;
  patchTracker: (p: Partial<ClipSettings["tracker"]>) => void;
  patchEffects: (p: Partial<ClipSettings["effects"]>) => void;
  patchZoomPan: (p: Partial<ClipSettings["zoomPan"]>) => void;
  patchWatermark: (p: Partial<ClipSettings["watermark"]>) => void;
  patchExport: (p: Partial<ClipSettings["export"]>) => void;
  addText: (t: TextLayer) => void;
  patchText: (id: string, p: Partial<TextLayer>) => void;
  removeText: (id: string) => void;

  addJob: (j: ExportJob) => void;
  updateJob: (id: string, p: Partial<ExportJob>) => void;
  removeJob: (id: string) => void;

  setModels: (p: Partial<ModelStatus>) => void;
  setPlaying: (p: boolean) => void;
  setTime: (t: number) => void;
  setTab: (t: string) => void;
  setBusy: (s: string | null) => void;
  setToast: (s: string | null) => void;

  /** terapkan mode split + hasilkan parts */
  applySplit: (mediaId: string, mode: SplitMode, boundaries: number[]) => void;
}

export const useClipper = create<ClipperState>((set, get) => ({
  media: [],
  selectedId: null,
  parts: {},
  settings: { ...defaultSettings(), ...(loadPersisted() ?? {}) },
  jobs: [],
  models: { whisper: "idle", whisperProgress: 0, whisperReady: null, detector: "idle", detectorProgress: 0 },
  playing: false,
  time: 0,
  tab: "split",
  busy: null,
  toast: null,

  setMedia: (m) => set({ media: m }),
  addMedia: (m) => set((s) => ({ media: [...s.media, m] })),
  removeMedia: (id) =>
    set((s) => {
      const item = s.media.find((x) => x.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      const media = s.media.filter((x) => x.id !== id);
      const parts = { ...s.parts };
      delete parts[id];
      return {
        media, parts,
        selectedId: s.selectedId === id ? media[0]?.id ?? null : s.selectedId,
      };
    }),
  select: (id) => set({ selectedId: id, time: 0, playing: false }),
  selected: () => get().media.find((m) => m.id === get().selectedId),

  setParts: (mediaId, parts) => set((s) => ({ parts: { ...s.parts, [mediaId]: parts } })),
  partsOf: (mediaId) => get().parts[mediaId] ?? [],

  patch: (p) =>
    set((s) => {
      const next = { ...s.settings, ...p };
      persist(next);
      return { settings: next };
    }),
  patchSplit: (p) => get().patch({ split: { ...get().settings.split, ...p } }),
  patchSubtitle: (p) => get().patch({ subtitle: { ...get().settings.subtitle, ...p } }),
  patchSpeaker: (p) => get().patch({ speaker: { ...get().settings.speaker, ...p } }),
  patchMusic: (p) => get().patch({ music: { ...get().settings.music, ...p } }),
  patchTracker: (p) => get().patch({ tracker: { ...get().settings.tracker, ...p } }),
  patchEffects: (p) => get().patch({ effects: { ...get().settings.effects, ...p } }),
  patchZoomPan: (p) => get().patch({ zoomPan: { ...get().settings.zoomPan, ...p } }),
  patchWatermark: (p) => get().patch({ watermark: { ...get().settings.watermark, ...p } }),
  patchExport: (p) => get().patch({ export: { ...get().settings.export, ...p } }),

  addText: (t) => get().patch({ texts: [...get().settings.texts, t] }),
  patchText: (id, p) =>
    get().patch({ texts: get().settings.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }),
  removeText: (id) => get().patch({ texts: get().settings.texts.filter((t) => t.id !== id) }),

  addJob: (j) => set((s) => ({ jobs: [j, ...s.jobs].slice(0, 30) })),
  updateJob: (id, p) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) })),
  removeJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

  setModels: (p) => set((s) => ({ models: { ...s.models, ...p } })),
  setPlaying: (playing) => set({ playing }),
  setTime: (time) => set({ time }),
  setTab: (tab) => set({ tab }),
  setBusy: (busy) => set({ busy }),
  setToast: (toast) => set({ toast }),

  applySplit: (mediaId, mode, boundaries) => {
    const item = get().media.find((m) => m.id === mediaId);
    if (!item) return;
    const pts = [0, ...boundaries.filter((b) => b > 0.05 && b < item.duration - 0.05), item.duration];
    const parts: Part[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      parts.push({
        id: uid("part"),
        start: pts[i],
        end: pts[i + 1],
        label: mode === "scene" ? `ADEGAN ${String(i + 1).padStart(2, "0")}` : `BAGIAN ${String(i + 1).padStart(2, "0")}`,
        origin: mode,
      });
    }
    set((s) => ({ parts: { ...s.parts, [mediaId]: parts }, settings: { ...s.settings, split: { ...s.settings.split, mode } } }));
  },
}));

// handle debug global (dipakai konsol & pengembangan)
if (typeof window !== "undefined") {
  (window as unknown as { __clipper?: unknown }).__clipper = useClipper;
}
