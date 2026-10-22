"use client";

/* ============================================================
   CLIPPER EDITOR — Panel: MUSIK AI · TEKS · TRACKER · EKSPOR
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Music, Type, Target, Package, Upload, Play, Crosshair, Trash2,
  Download, Layers, Merge, Boxes, X, Flame, Captions, Users,
} from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { MUSIC_PRESETS, composeMusic } from "@/lib/clipper/music";
import { decodeAudioFile } from "@/lib/clipper/audio";
import { trackObject } from "@/lib/clipper/tracker";
import { FONTS } from "@/lib/clipper/typography";
import { RESOLUTIONS, type ResolutionKey, type TextLayer } from "@/lib/clipper/types";
import { outputDims, videoBitrate, cancelJob, newJobId } from "@/lib/clipper/exporter";
import { enqueueExportJob, dequeueExportJob, setQueueCtx } from "@/lib/clipper/queue";
import { getSaveMode, setSaveMode, obtainSaveDir, type SaveMode } from "@/lib/clipper/savedir";
import { fmtTime, fmtSize, uid } from "@/lib/clipper/format";
import { Panel, Chip, Range, TextInput, ActionBtn, Progress, Note, Row } from "../bits";

function useSelected() {
  return useClipper((s) => s.media.find((m) => m.id === s.selectedId));
}

/* ================= MUSIK AI ================= */

export function MusicPanel() {
  const music = useClipper((s) => s.settings.music);
  const patchMusic = useClipper((s) => s.patchMusic);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = async () => {
    try {
      setBusy("Mengomposisi 8 detik musik…");
      const buf = music.customBuffer ?? (await composeMusic(music.preset, 8, 0.5));
      setBusy(null);
      if (!buf) return;
      const ctx = new AudioContext();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = music.gain;
      src.connect(g).connect(ctx.destination);
      src.start();
      src.onended = () => ctx.close();
    } catch (e) {
      setBusy(null);
      setToast(`Gagal: ${e instanceof Error ? e.message : e}`);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setBusy(`Mendekode ${f.name}…`);
      const url = URL.createObjectURL(f);
      const buf = await decodeAudioFile(url);
      patchMusic({ customUrl: url, customName: f.name, customBuffer: buf, preset: music.preset === "none" ? "cinematic" : music.preset });
      setToast(`Backsound "${f.name}" siap (${buf.duration.toFixed(1)}s)`);
    } catch (e) {
      setToast(`MP3 gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Skor Musik AI" icon={<Music size={12} className="text-primary" />}>
      <div className="grid grid-cols-2 gap-1.5">
        {MUSIC_PRESETS.filter((p) => p.key !== "none").map((p) => (
          <Chip key={p.key} active={music.preset === p.key}
            onClick={() => patchMusic({ preset: p.key, customBuffer: p.key === music.preset ? music.customBuffer : music.customBuffer })}
            title={p.desc}>
            {p.label}
          </Chip>
        ))}
        <Chip active={music.preset === "none"} onClick={() => patchMusic({ preset: "none" })}>TANPA MUSIK</Chip>
      </div>
      {music.preset !== "none" && (
        <Note>{MUSIC_PRESETS.find((p) => p.key === music.preset)?.desc} · komposisi prosedural Web Audio API — dibangkitkan lokal, bebas royalti.</Note>
      )}
      <Range label="VOLUME MUSIK" min={0} max={1} step={0.05} value={music.gain} onChange={(v) => patchMusic({ gain: v })} />
      <Range label="REDAM AUDIO ASLI (DUCKING)" min={0} max={1} step={0.05}
        value={music.duckOriginal} onChange={(v) => patchMusic({ duckOriginal: v })} />
      <Range label="FADE OUT (DETIK)" min={0} max={8} step={0.5} suffix="s"
        value={music.fadeOut} onChange={(v) => patchMusic({ fadeOut: v })} />

      <div className="flex gap-2">
        <ActionBtn onClick={() => fileRef.current?.click()}>
          <Upload size={12} className="inline mr-1" /> MP3 MANUAL
        </ActionBtn>
        <ActionBtn onClick={preview} disabled={music.preset === "none" && !music.customBuffer}>
          <Play size={12} className="inline mr-1" /> PRATINJAU 8s
        </ActionBtn>
      </div>
      <input ref={fileRef} type="file" accept="audio/*" className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])} />
      {music.customName && (
        <div className="flex items-center justify-between bg-secondary/40 rounded px-2 py-1.5 text-[10.5px]">
          <span>♫ {music.customName}</span>
          <button onClick={() => patchMusic({ customName: undefined, customUrl: undefined, customBuffer: undefined })}>
            <X size={12} className="hover:text-primary" />
          </button>
        </div>
      )}
    </Panel>
  );
}

/* ================= TEKS SINEMATIK ================= */

const emptyText = (start: number, end: number): TextLayer => ({
  id: uid("txt"),
  text: "JUDUL EPIK",
  sub: "subjudul sinematik",
  font: "cinzel",
  style: "epic",
  start,
  end,
  posY: 0.42,
  size: 12,
  color: "#ffffff",
  accent: "#e21d1d",
  anim: "fade",
});

export function TextPanel() {
  const texts = useClipper((s) => s.settings.texts);
  const addText = useClipper((s) => s.addText);
  const patchText = useClipper((s) => s.patchText);
  const removeText = useClipper((s) => s.removeText);
  const time = useClipper((s) => s.time);
  const duration = useClipper((s) => s.media.find((m) => m.id === s.selectedId)?.duration ?? 60);

  return (
    <Panel title="Tipografi Sinematik" icon={<Type size={12} className="text-primary" />}
      right={
        <ActionBtn onClick={() => addText({ ...emptyText(time, Math.min(duration, time + 3)) })}>
          <Layers size={11} className="inline mr-1" /> TAMBAH
        </ActionBtn>
      }>
      {!texts.length && <Note>Tambahkan judul sinematik — 10 font (Cinzel, Anton, Bebas, dll). Lapisan digambar di atas video dengan animasi masuk/keluar.</Note>}
      <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
        {texts.map((t) => (
          <div key={t.id} className="border border-border rounded p-2 space-y-2 bg-secondary/30">
            <div className="flex items-center gap-1.5">
              <TextInput value={t.text} onChange={(v) => patchText(t.id, { text: v })} placeholder="JUDUL" />
              <button onClick={() => removeText(t.id)} className="text-muted-foreground hover:text-primary shrink-0">
                <Trash2 size={13} />
              </button>
            </div>
            <TextInput value={t.sub} onChange={(v) => patchText(t.id, { sub: v })} placeholder="Subjudul (opsional)" />
            <Row label="GAYA">
              {(["epic", "lower-third", "neon", "quote", "meme"] as const).map((s) => (
                <Chip key={s} active={t.style === s} onClick={() => patchText(t.id, { style: s })}>{s.toUpperCase()}</Chip>
              ))}
            </Row>
            <select
              value={t.font}
              onChange={(e) => patchText(t.id, { font: e.target.value })}
              className="w-full bg-input/60 border border-border rounded px-2 py-1.5 text-xs"
            >
              {FONTS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <Row label="ANIMASI">
              {(["fade", "slide", "zoom", "none"] as const).map((a) => (
                <Chip key={a} active={t.anim === a} onClick={() => patchText(t.id, { anim: a })}>{a.toUpperCase()}</Chip>
              ))}
            </Row>
            <Range label="POSISI VERTIKAL" min={0.05} max={0.95} step={0.05} value={t.posY}
              onChange={(v) => patchText(t.id, { posY: v })} />
            <Range label="UKURAN (% LEBAR)" min={4} max={26} step={1} value={t.size}
              onChange={(v) => patchText(t.id, { size: v })} />
            <div className="flex items-center gap-2">
              <label className="clip-label">MULAI</label>
              <TextInput type="number" step={0.5} value={Number(t.start.toFixed(1))}
                onChange={(v) => patchText(t.id, { start: Number(v) })} className="w-20" />
              <label className="clip-label">AKHIR</label>
              <TextInput type="number" step={0.5} value={Number(t.end.toFixed(1))}
                onChange={(v) => patchText(t.id, { end: Number(v) })} className="w-20" />
              <input type="color" value={t.color} onChange={(e) => patchText(t.id, { color: e.target.value })}
                className="w-7 h-7 bg-transparent border border-border rounded cursor-pointer" title="Warna teks" />
              <input type="color" value={t.accent} onChange={(e) => patchText(t.id, { accent: e.target.value })}
                className="w-7 h-7 bg-transparent border border-border rounded cursor-pointer" title="Warna aksen" />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ================= TRACKER ================= */

export function TrackerPanel() {
  const media = useSelected();
  const tracker = useClipper((s) => s.settings.tracker);
  const patchTracker = useClipper((s) => s.patchTracker);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const time = useClipper((s) => s.time);
  const [progress, setProgress] = useState(0);

  const run = async () => {
    if (!media || media.type === "audio" || !tracker.box) {
      setToast("Gambar dulu kotak objek: tombol KOTAK di bawah pratinjau");
      return;
    }
    try {
      setBusy("Melacak objek (NCC)…");
      setProgress(0.01);
      const path = await trackObject(media.url, media.duration, { ...tracker, enabled: true }, (p) => setProgress(p));
      patchTracker({ path, enabled: true });
      const found = path.filter((p) => p.found).length;
      setToast(`Tracking selesai — ${found}/${path.length} frame terkunci (${((found / Math.max(1, path.length)) * 100).toFixed(0)}%)`);
    } catch (e) {
      setToast(`Tracking gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  return (
    <Panel title="Lacak Objek" icon={<Target size={12} className="text-primary" />}>
      <Note>
        Label grafis ala MotoGP. Cara: pause di frame yang memuat objek → tekan tombol <b>KOTAK</b> di bawah
        pratinjau → seret kotak pada objek → kembali ke sini → <b>LACAK SEKARANG</b>. Pelacak NCC + template
        mengikuti objek sepanjang video.
      </Note>
      <Row label="AKTIF">
        <Chip active={tracker.enabled} onClick={() => patchTracker({ enabled: !tracker.enabled })}>
          {tracker.enabled ? "MENYALA" : "MATI"}
        </Chip>
        <Chip onClick={() => patchTracker({ anchorTime: time })} title="Set frame template = posisi sekarang">
          <Crosshair size={11} className="inline mr-1" /> FRAME: {fmtTime(tracker.anchorTime)}
        </Chip>
      </Row>
      <TextInput value={tracker.label.text} onChange={(v) => patchTracker({ label: { ...tracker.label, text: v } })} placeholder="Label utama (mis. PEMBALAP 46)" />
      <TextInput value={tracker.label.sub} onChange={(v) => patchTracker({ label: { ...tracker.label, sub: v } })} placeholder="Sub-label (mis. TEAM)" />
      <div className="flex items-center gap-2">
        <span className="clip-label">WARNA</span>
        <input type="color" value={tracker.label.color} onChange={(e) => patchTracker({ label: { ...tracker.label, color: e.target.value } })}
          className="w-8 h-8 bg-transparent border border-border rounded cursor-pointer" />
        {tracker.box && (
          <span className="text-[10px] text-muted-foreground">
            kotak {(tracker.box.w * 100).toFixed(0)}×{(tracker.box.h * 100).toFixed(0)}% @ {fmtTime(tracker.anchorTime)}
          </span>
        )}
        {tracker.path.length > 0 && (
          <span className="text-[10px] text-primary ml-auto">{tracker.path.length} titik jalur</span>
        )}
      </div>
      <ActionBtn variant="primary" onClick={run} disabled={!media || !tracker.box} className="w-full">
        LACAK SEKARANG
      </ActionBtn>
      {progress > 0 && <Progress p={progress} />}
      {tracker.path.length > 0 && (
        <ActionBtn onClick={() => patchTracker({ path: [], enabled: false })}>HAPUS JALUR</ActionBtn>
      )}
    </Panel>
  );
}

/* ================= EKSPOR ================= */

/* v1.2.8 — centangan OTOMATIS CERDAS tersimpan antar sesi */
const AUTO_KEY = "clipper-auto-flags";
type AutoFlags = { moment: boolean; subtitle: boolean; speaker: boolean };
function loadAutoFlags(): AutoFlags {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { moment: !!p.moment, subtitle: !!p.subtitle, speaker: !!p.speaker };
    }
  } catch { /* abaikan */ }
  return { moment: false, subtitle: false, speaker: false };
}

export function ExportPanel() {
  const media = useSelected();
  const clip = useClipper((s) => s.settings);
  const patchExport = useClipper((s) => s.patchExport);
  const mediaAll = useClipper((s) => s.media);
  const parts = useClipper((s) => (s.selectedId ? s.parts[s.selectedId] : undefined)) ?? [];
  const addJob = useClipper((s) => s.addJob);
  const removeJob = useClipper((s) => s.removeJob);
  const setToast = useClipper((s) => s.setToast);

  const jobs = useClipper((s) => s.jobs);

  /* v1.2.7 — mode simpan: FOLDER PILIHAN (tulis langsung ke disk) / UNDUHAN */
  const [saveMode, setSaveModeState] = useState<SaveMode>(() => getSaveMode());
  const [dirLabel, setDirLabel] = useState<string | null>(null);

  /* v1.2.8 — OTOMATIS CERDAS: centang AI yang dijalankan saat ekspor */
  const [auto, setAuto] = useState<AutoFlags>(() => loadAutoFlags());
  useEffect(() => {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(auto)); } catch { /* abaikan */ }
  }, [auto]);
  const anyAuto = auto.moment || auto.subtitle || auto.speaker;

  /* v1.2.6 — konteks antrean global: bertahan walau panel ditutup/pindah tab,
     dan dipakai bersama panel AI MOMEN (dulu 2 jalur paralel = 2 encoding
     bersamaan = RAM meledak). */
  setQueueCtx({
    getMedia: (id) => useClipper.getState().media.find((m) => m.id === id),
    getClip: () => useClipper.getState().settings,
    update: (id, p) => useClipper.getState().updateJob(id, p),
  });

  const dims = useMemo(
    () => outputDims(clip.export, media?.width || 1920, media?.height || 1080),
    [clip.export, media?.width, media?.height]
  );
  const bitrate = useMemo(
    () => videoBitrate(clip.export, media?.duration || 60, media?.width || 1920, media?.height || 1080),
    [clip.export, media?.duration, media?.width, media?.height]
  );
  const estSize = ((bitrate / 8) * (media?.duration || 0)) / 1048576;

  const chipFromScale = (scale: number): ResolutionKey => {
    // kunci dua arah: skala → chip terdekat
    const h = (media?.height || 1080) * (scale / 100);
    if (h >= 1800) return "4k";
    if (h >= 1200) return "2k";
    if (h >= 900) return "1080p";
    return "720p";
  };
  const scaleFromChip = (key: ResolutionKey): 100 | 75 | 50 => {
    const target = RESOLUTIONS[key].portrait.h;
    const h = media?.height || 1080;
    if (h >= target * 0.92) return 100;
    if (h * 0.75 >= target * 0.92) return 75;
    return 50;
  };

  const queue = (
    name: string,
    target: "current" | "split" | "batch" | "merge",
    ranges: { mediaId: string; start: number; end: number }[]
  ) => {
    /* v1.2.8 — bila AI MOMEN dicentang: pembagian momen MENGANTIKAN
       rentang biasa. Ekspor Video Ini berubah menjadi "tiap momen satu
       file" (target split) — sama seperti tombol EKSPOR SEMUA di panel
       AI Momen, tapi tanpa perlu analisis manual dulu. */
    let effTarget = target;
    let effRanges = ranges;
    if (auto.moment && target === "current" && media) {
      effTarget = "split";
      effRanges = [{ mediaId: media.id, start: 0, end: media.duration }];
    }
    const job = {
      id: newJobId(),
      name,
      target: effTarget,
      ranges: effRanges,
      settings: { ...clip.export },
      status: "queued" as const,
      progress: 0,
      stage: anyAuto ? "Antre — AI otomatis akan berjalan dulu…" : "Menunggu antrean…",
      auto: anyAuto ? { subtitle: auto.subtitle, moment: auto.moment, speaker: auto.speaker } : undefined,
    };
    addJob(job);
    // v1.2.6 — antrean serial GLOBAL (satu job berjalan kapan pun,
    // bertahan meski panel ditutup / pindah tab)
    enqueueExportJob(job);
  };

  const videoMedia = mediaAll.filter((m) => m.type === "video");

  return (
    <Panel title="Ekspor MP4 · H.264 + AAC" icon={<Package size={12} className="text-primary" />}>
      <Row label="RESOLUSI">
        {(Object.keys(RESOLUTIONS) as ResolutionKey[]).map((k) => (
          <Chip
            key={k}
            active={!clip.export.autoMode && clip.export.resolution === k}
            onClick={() => {
              // chip ↔ skala saling mengunci dua arah
              patchExport({ resolution: k, autoMode: false, scale: scaleFromChip(k) });
            }}
          >
            {RESOLUTIONS[k].short}
          </Chip>
        ))}
      </Row>
      <Row label="SKALA OTOMATIS">
        {([100, 75, 50] as const).map((s) => (
          <Chip
            key={s}
            active={clip.export.autoMode && clip.export.scale === s}
            onClick={() => patchExport({ autoMode: true, scale: s, resolution: chipFromScale(s) })}
          >
            AUTO {s}%
          </Chip>
        ))}
      </Row>
      <Row label="RASIO">
        <Chip active={clip.export.aspect === "16:9"} onClick={() => patchExport({ aspect: "16:9" })}>16:9</Chip>
        <Chip active={clip.export.aspect === "9:16"} onClick={() => patchExport({ aspect: "9:16" })}>9:16 VERTIKAL</Chip>
        {auto.moment && clip.export.aspect !== "9:16" && (
          <span className="text-[9.5px] text-primary font-bold">⚠ AI MOMEN tetap dipaksa 9:16</span>
        )}
      </Row>
      <Row label="FPS">
        {([24, 30, 60] as const).map((f) => (
          <Chip key={f} active={clip.export.fps === f} onClick={() => patchExport({ fps: f })}>{f}</Chip>
        ))}
      </Row>
      <Row label="KUALITAS">
        <Chip active={clip.export.quality === "high"} onClick={() => patchExport({ quality: "high" })}>TINGGI</Chip>
        <Chip active={clip.export.quality === "balanced"} onClick={() => patchExport({ quality: "balanced" })}>SEIMBANG</Chip>
        <Chip active={clip.export.quality === "compact"} onClick={() => patchExport({ quality: "compact" })}>PADAT</Chip>
      </Row>
      <Row label="ENCODER">
        <Chip active={(clip.export.hw ?? "auto") === "auto"} onClick={() => patchExport({ hw: "auto" })}>AUTO</Chip>
        <Chip active={clip.export.hw === "gpu"} onClick={() => patchExport({ hw: "gpu" })}>GPU</Chip>
        <Chip active={clip.export.hw === "cpu"} onClick={() => patchExport({ hw: "cpu" })}>CPU</Chip>
      </Row>
      <div className="flex items-center gap-2">
        <span className="clip-label shrink-0">KOMPRES PINTAR</span>
        <TextInput
          type="number"
          min={1}
          step={1}
          value={clip.export.targetMB ?? ""}
          placeholder="target MB (kosong = ikut resolusi)"
          onChange={(v) => patchExport({ targetMB: v ? Number(v) : null })}
          className="w-44"
        />
        <span className="text-[10px] text-muted-foreground shrink-0">MB</span>
      </div>

      <div className="text-[10px] text-muted-foreground leading-relaxed bg-secondary/40 rounded p-2">
        OUTPUT: <b className="text-foreground">{dims.w}×{dims.h}</b> · {clip.export.fps}fps · ±
        <b className="text-foreground">{(bitrate / 1e6).toFixed(1)} Mbps</b> · est.
        <b className="text-foreground"> {fmtSize((estSize * 1048576) | 0)}</b>
        {clip.export.aspect === "9:16" && <> · vertikal dibalik sesuai konvensi TikTok/Shorts</>}
        {clip.export.resolution === "4k" || (clip.export.autoMode && dims.h >= 1800) ? " · H.264 level 5.1/5.2 otomatis" : ""}
        <br />
        Setelan terkunci & tetap aktif untuk video berikutnya — Batch Ekspor & Gabung Video mengikuti resolusi ini.
      </div>

      {/* v1.2.7 — SIMPAN KE: tulis langsung ke disk (tahan file besar di mesin RAM kecil) */}
      <Row label="SIMPAN KE">
        <Chip
          active={saveMode === "folder"}
          onClick={async () => {
            setSaveMode("folder");
            setSaveModeState("folder");
            const dir = await obtainSaveDir(true); // paksa dialog pilih folder
            setDirLabel(dir?.name ?? null);
          }}
          title="MP4 ditulis langsung ke folder pilihanmu — paling stabil untuk file besar"
        >
          FOLDER PILIHAN
        </Chip>
        <Chip
          active={saveMode === "download"}
          onClick={() => {
            setSaveMode("download");
            setSaveModeState("download");
          }}
          title="Cara lama: file masuk folder Unduhan browser"
        >
          UNDUHAN
        </Chip>
      </Row>
      {saveMode === "folder" && (
        <Note>
          Folder: <b className="text-foreground">{dirLabel ?? "belum dipilih — dialog muncul saat ekspor pertama"}</b> · file
          ditulis langsung ke disk selagi di-encode (tahan file ratusan MB, RAM stabil). Tetap aman: bila folder tak bisa
          dipakai, otomatis jatuh ke UNDUHAN.
        </Note>
      )}

      {/* ============ v1.2.8 — OTOMATIS CERDAS ============ */}
      <div className="border border-primary/40 rounded p-2 space-y-2 bg-primary/5">
        <div className="flex items-center justify-between gap-2">
          <span className="clip-label text-primary">OTOMATIS CERDAS — CENTANG SAAT EKSPOR</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Chip
            active={auto.moment}
            onClick={() => {
              const next = !auto.moment;
              setAuto((a) => ({ ...a, moment: next, speaker: next ? true : a.speaker }));
              /* v1.2.9 — AI MOMEN = klip vertikal: rasio otomatis pindah
                 ke 9:16 (potong kiri-kanan, fokus pembicara) + zoom
                 pembicara menyala supaya hasil langsung seperti TikTok. */
              if (next) patchExport({ aspect: "9:16" });
            }}
            title="AI cari momen viral (hook/pacing/konteks) → tiap momen jadi file vertikal 9:16 sendiri. Zoom pembicara menyala otomatis."
          >
            <Flame size={11} className="inline mr-1" /> AI MOMEN
          </Chip>
          <Chip
            active={auto.subtitle}
            onClick={() => setAuto((a) => ({ ...a, subtitle: !a.subtitle }))}
            title="Transkripsi Whisper otomatis bila video belum punya subtitle → teks dibakar ke hasil ekspor"
          >
            <Captions size={11} className="inline mr-1" /> SUBTITLE
          </Chip>
          <Chip
            active={auto.speaker}
            onClick={() => setAuto((a) => ({ ...a, speaker: !a.speaker }))}
            title="Zoom mengikuti orang yang sedang bicara. Video panjang: analisis 1–5 menit di BAGIAN PERTAMA saja (sekali untuk semua bagian) — progress selalu bergerak, AI bermasalah = lanjut mode audio otomatis."
          >
            <Users size={11} className="inline mr-1" /> PEMBICARA
          </Chip>
        </div>
        <div className="text-[10px] text-muted-foreground leading-relaxed">
          {anyAuto ? (
            <>
              <b className="text-foreground">Saat tombol ekspor ditekan, aplikasi berjalan sendiri:</b>{" "}
              {auto.subtitle && <>① SUBTITLE AI (transkripsi offline) </>}
              {auto.moment && <>② AI MOMEN (video dibagi ke momen terbaik — hasil <b className="text-primary">9:16 VERTIKAL, potong kiri-kanan</b> — bagian split diabaikan) </>}
              {auto.speaker && <>③ PEMBICARA (potongan kamera mengikuti orang yang bicara — video panjang: analisis 1–5 mnt di bagian pertama, sekali saja) </>}
              ④ ENCODE MP4. Hasil analisis tersimpan — panel AI Momen &amp; Subtitle menampilkan yang sama.
            </>
          ) : (
            <>Belum ada yang dicentang — ekspor murni encode. Centang di atas untuk AI otomatis: tiap momen jadi file vertikal / subtitle terbakar / kamera ikut pembicara.</>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <ActionBtn variant="primary" disabled={!media || media.type === "audio"}
          onClick={() =>
            media &&
            queue(`ekspor_${media.name.replace(/\.[^.]+$/, "")}`, "current", [
              { mediaId: media.id, start: 0, end: media.duration },
            ])}
          title="Seluruh video saat ini">
          <Download size={11} className="inline mr-1" /> EKSPOR VIDEO INI
        </ActionBtn>
        <ActionBtn disabled={!media || media.type === "audio" || !parts.length}
          onClick={() =>
            media &&
            queue(`parts_${media.name.replace(/\.[^.]+$/, "")}`, "split",
              parts.map((p) => ({ mediaId: media.id, start: p.start, end: p.end })))}
          title="Setiap bagian jadi file MP4 terpisah">
          <Boxes size={11} className="inline mr-1" /> EKSPOR PARTS ({parts.length})
        </ActionBtn>
        <ActionBtn disabled={videoMedia.length < 1}
          onClick={() =>
            queue(`batch_${videoMedia.length}video`, "batch",
              videoMedia.map((m) => ({ mediaId: m.id, start: 0, end: m.duration })))
          }
          title="Ekspor semua video di kotak — resolusi terkunci">
          <Layers size={11} className="inline mr-1" /> BATCH SEMUA ({videoMedia.length})
        </ActionBtn>
        <ActionBtn disabled={videoMedia.length < 2}
          onClick={() =>
            queue(`gabung_${videoMedia.length}video`, "merge",
              videoMedia.map((m) => ({ mediaId: m.id, start: 0, end: m.duration })))
          }
          title="Gabung semua video menjadi satu MP4">
          <Merge size={11} className="inline mr-1" /> GABUNG VIDEO
        </ActionBtn>
      </div>

      {/* antrean */}
      {jobs.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          <span className="clip-label">ANTREAN EKSPOR</span>
          {jobs.map((j) => (
            <div key={j.id} className="border border-border rounded p-2 space-y-1.5 bg-secondary/30">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] truncate flex-1">
                  {j.name} <span className="text-muted-foreground">· {j.target.toUpperCase()}</span>
                </span>
                {j.status === "running" ? (
                  <button className="text-[10px] text-primary hover:brightness-125"
                    onClick={() => cancelJob(j.id)}>BATAL</button>
                ) : (
                  <button className="text-muted-foreground hover:text-primary"
                    title={j.status === "queued" ? "Batalkan antrean" : "Hapus dari daftar"}
                    onClick={() => {
                      if (j.status === "queued") dequeueExportJob(j.id);
                      removeJob(j.id);
                    }}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <Progress p={j.progress} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="truncate">{j.stage}</span>
                <span className={
                  j.status === "done" ? "text-emerald-400" : j.status === "error" ? "text-primary" : ""
                }>
                  {(j.progress * 100).toFixed(0)}% {j.status === "error" ? `· ${j.error}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Note>
        Codec H.264 + AAC · faststart (siap streaming) · bitrate menyesuaikan resolusi (4K ≈ 4× 1080p).
        KOMPRES PINTAR menang bila target MB diisi.
      </Note>
    </Panel>
  );
}
