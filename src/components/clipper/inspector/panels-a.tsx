"use client";

/* ============================================================
   CLIPPER EDITOR — Panel: SPLIT · SUBTITLE AI · ZOOM PEMBICARA
   ============================================================ */

import { useState } from "react";
import {
  Scissors, Captions, Users, Download, Sparkles, Play, Wand2,
} from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { detectScenes, splitBySeconds, splitByParts } from "@/lib/clipper/scenedetect";
import { mono16k, decodeAudioFile } from "@/lib/clipper/audio";
import { transcribe, cuesToSRT, WHISPER_MODELS, type WhisperModel } from "@/lib/clipper/whisper";
import { getCachedSpeaker } from "@/lib/clipper/exporter";
import { downloadBlob, fmtTime } from "@/lib/clipper/format";
import { Panel, Chip, Range, TextInput, ActionBtn, Progress, Note, Row } from "../bits";
import type { MediaItem } from "@/lib/clipper/types";

function useSelected(): MediaItem | undefined {
  return useClipper((s) => s.media.find((m) => m.id === s.selectedId));
}

/* ================= SPLIT ================= */

export function SplitPanel() {
  const media = useSelected();
  const split = useClipper((s) => s.settings.split);
  const patchSplit = useClipper((s) => s.patchSplit);
  const applySplit = useClipper((s) => s.applySplit);
  const parts = useClipper((s) => (s.selectedId ? s.parts[s.selectedId] : undefined)) ?? [];
  const setParts = useClipper((s) => s.setParts);
  const setTime = useClipper((s) => s.setTime);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const patchExport = useClipper((s) => s.patchExport);
  const [progress, setProgress] = useState(0);

  const runSplit = async () => {
    if (!media || media.type === "audio") return;
    try {
      setBusy("Analisis adegan berjalan — 100% offline…");
      setProgress(0.02);
      let cuts: number[] = [];
      if (split.mode === "scene") {
        const res = await detectScenes(
          media.url,
          media.duration,
          split.sensitivity,
          split.minScene,
          4,
          (p) => setProgress(p)
        );
        cuts = res.cuts;
        setToast(`Adegan terdeteksi: ${res.cuts.length + 1} · ambang: ${res.threshold.toFixed(4)}`);
      } else if (split.mode === "seconds") {
        cuts = splitBySeconds(media.duration, split.seconds);
      } else if (split.mode === "parts") {
        cuts = splitByParts(media.duration, split.parts);
      } else {
        cuts = [];
      }
      applySplit(media.id, split.mode, cuts);
    } catch (e) {
      setToast(`Split gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const patchPart = (id: string, idx: number, v: number) => {
    const next = parts.map((p, i) => (i === idx ? { ...p, [id]: Math.max(0, Math.min(media?.duration ?? v, v)) } : p));
    setParts(media!.id, next);
  };

  return (
    <Panel title="Otomatis Terpisah" icon={<Scissors size={12} className="text-primary" />}>
      <Row label="MODE">
        <Chip active={split.mode === "seconds"} onClick={() => patchSplit({ mode: "seconds" })}>PER DETIK</Chip>
        <Chip active={split.mode === "parts"} onClick={() => patchSplit({ mode: "parts" })}>N BAGIAN</Chip>
        <Chip active={split.mode === "scene"} onClick={() => patchSplit({ mode: "scene" })}>PER ADEGAN</Chip>
      </Row>

      {split.mode === "seconds" && (
        <Range label="DURASI PER PART" min={3} max={180} step={1} suffix="s"
          value={split.seconds} onChange={(v) => patchSplit({ seconds: v })} />
      )}
      {split.mode === "parts" && (
        <Range label="JUMLAH BAGIAN" min={2} max={30} step={1}
          value={split.parts} onChange={(v) => patchSplit({ parts: v })} />
      )}
      {split.mode === "scene" && (
        <>
          <Range label="KEPEKAAN" min={0} max={1} step={0.05}
            value={split.sensitivity} onChange={(v) => patchSplit({ sensitivity: v })} />
          <Range label="ADEGAN MIN (DETIK)" min={0.5} max={10} step={0.5} suffix="s"
            value={split.minScene} onChange={(v) => patchSplit({ minScene: v })} />
          <Note>
            Analisis piksel + histogram, ambang adaptif median+MAD — potong tepat di pergantian adegan film,
            bukan per durasi.
          </Note>
        </>
      )}

      <ActionBtn variant="primary" onClick={runSplit} disabled={!media || media.type === "audio"} className="w-full">
        <Wand2 size={12} className="inline mr-1" /> JALANKAN SPLIT OTOMATIS
      </ActionBtn>
      {progress > 0 && <Progress p={progress} />}

      {parts.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <span className="clip-label">{parts.length} BAGIAN</span>
            <span className="clip-label">MULAI · SELESAI</span>
          </div>
          {parts.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1.5 bg-secondary/40 rounded px-2 py-1.5">
              <button
                className="text-[10px] text-primary hover:brightness-125 uppercase tracking-wider shrink-0 w-16 text-left"
                onClick={() => setTime(p.start)}
                title="Lompat ke awal bagian"
              >
                {p.label}
              </button>
              <TextInput type="number" step={0.1} value={Number(p.start.toFixed(2))}
                onChange={(v) => patchPart("start", i, Number(v))} className="w-20" />
              <TextInput type="number" step={0.1} value={Number(p.end.toFixed(2))}
                onChange={(v) => patchPart("end", i, Number(v))} className="w-20" />
              <button
                className="text-[10px] text-muted-foreground hover:text-primary ml-auto shrink-0"
                onClick={() => setParts(media!.id, parts.filter((x) => x.id !== p.id))}
              >
                HAPUS
              </button>
            </div>
          ))}
          <Note>Setelan part dipakai oleh EKSPOR PARTS di panel EKSPOR. Semua output terkunci ke resolusi pilihanmu.</Note>
        </div>
      )}
    </Panel>
  );
}

/* ================= SUBTITLE AI ================= */

export function SubtitlePanel() {
  const media = useSelected();
  const sub = useClipper((s) => s.settings.subtitle);
  const patchSubtitle = useClipper((s) => s.patchSubtitle);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const models = useClipper((s) => s.models);
  const setModels = useClipper((s) => s.setModels);
  const [model, setModel] = useState<WhisperModel>("tiny");
  const [lang, setLang] = useState<"id" | "en" | "auto">("id");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [translating, setTranslating] = useState(false);

  const runTranscribe = async () => {
    if (!media || media.type === "audio") return;
    try {
      setBusy("Menyiapkan Whisper…");
      setProgress(0.01);
      setStage("Mengekstrak audio 16 kHz…");
      const buf = await decodeAudioFile(media.url);
      const pcm = await mono16k(buf);
      setStage("");
      const res = await transcribe(pcm, {
        model,
        language: lang,
        onProgress: (p, s) => {
          setProgress(p);
          setStage(s);
          if (s.includes("Mengunduh")) {
            setModels({ whisper: "downloading", whisperProgress: p });
          }
        },
      });
      patchSubtitle({ cues: res.cues, mode: sub.mode === "off" ? "burnin" : sub.mode });
      setModels({ whisper: "ready", whisperProgress: 1, whisperReady: WHISPER_MODELS[model].repo });
      setToast(`Transkripsi selesai — ${res.cues.length} baris. Unduh sekali, offline permanen.`);
    } catch (e) {
      setModels({ whisper: "error" });
      setToast(`Transkripsi gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
      setProgress(0);
      setStage("");
    }
  };

  const doTranslate = async (target: "en" | "id") => {
    if (!sub.cues.length) return;
    try {
      setTranslating(true);
      setBusy("Menerjemahkan subtitle (mode online)…");
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: sub.cues.map((c) => c.text), target }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const cues = sub.cues.map((c, i) => ({ ...c, translated: data.translations[i] }));
      patchSubtitle({ cues, showTranslated: true });
      setToast(`Diterjemahkan ke ${target === "en" ? "Inggris" : "Indonesia"}`);
    } catch (e) {
      setToast(`Terjemahan gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTranslating(false);
      setBusy(null);
    }
  };

  const dlSRT = () => {
    if (!media || !sub.cues.length) return;
    const srt = cuesToSRT(sub.cues, sub.showTranslated);
    downloadBlob(new Blob([srt], { type: "text/plain" }), `${media.name.replace(/\.[^.]+$/, "")}.srt`);
  };

  return (
    <Panel title="Subtitle AI" icon={<Captions size={12} className="text-primary" />}>
      <Row label="MODEL">
        {(Object.keys(WHISPER_MODELS) as WhisperModel[]).map((k) => (
          <Chip key={k} active={model === k} onClick={() => setModel(k)}
            title={`${WHISPER_MODELS[k].repo} — ${WHISPER_MODELS[k].size}`}>
            {k.toUpperCase()}
          </Chip>
        ))}
      </Row>
      <Row label="BAHASA">
        <Chip active={lang === "id"} onClick={() => setLang("id")}>INDONESIA</Chip>
        <Chip active={lang === "en"} onClick={() => setLang("en")}>INGGRIS</Chip>
        <Chip active={lang === "auto"} onClick={() => setLang("auto")}>AUTO</Chip>
      </Row>

      <ActionBtn variant="primary" onClick={runTranscribe} disabled={!media || media.type === "audio"} className="w-full">
        <Sparkles size={12} className="inline mr-1" /> MULAI TRANSKRIPSI LOKAL
      </ActionBtn>
      {(progress > 0 || stage) && (
        <div className="space-y-1">
          <Progress p={progress} />
          <div className="text-[10px] text-muted-foreground">{stage}</div>
        </div>
      )}
      {models.whisper === "ready" && (
        <Note>Model {models.whisperReady} tersimpan di cache browser — selanjutnya 100% offline permanen.</Note>
      )}

      {sub.cues.length > 0 && (
        <>
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {sub.cues.slice(0, 60).map((c, i) => (
              <div key={i} className="text-[10.5px] text-foreground/75 bg-secondary/40 rounded px-2 py-1">
                <span className="text-primary tabular-nums">{fmtTime(c.start)}</span>{" "}
                {sub.showTranslated && c.translated ? c.translated : c.text}
              </div>
            ))}
          </div>
          <Row label="MODE">
            <Chip active={sub.mode === "burnin"} onClick={() => patchSubtitle({ mode: "burnin" })}>BAKAR KE VIDEO</Chip>
            <Chip active={sub.mode === "srt"} onClick={() => patchSubtitle({ mode: "srt" })}>FILE SRT</Chip>
            <Chip active={sub.mode === "off"} onClick={() => patchSubtitle({ mode: "off" })}>MATI</Chip>
          </Row>
          <Row label="GAYA">
            {(["karaoke", "box", "outline", "minimal"] as const).map((s) => (
              <Chip key={s} active={sub.style === s} onClick={() => patchSubtitle({ style: s })}>{s.toUpperCase()}</Chip>
            ))}
          </Row>
          <Row label="POSISI">
            {(["bottom", "center", "top"] as const).map((p) => (
              <Chip key={p} active={sub.position === p} onClick={() => patchSubtitle({ position: p })}>{p.toUpperCase()}</Chip>
            ))}
          </Row>
          <Range label="UKURAN (% TINGGI)" min={2.5} max={10} step={0.5}
            value={sub.fontSize} onChange={(v) => patchSubtitle({ fontSize: v })} />
          <div className="flex gap-2">
            <ActionBtn onClick={dlSRT} disabled={!sub.cues.length}>
              <Download size={12} className="inline mr-1" /> UNDUH SRT
            </ActionBtn>
            <ActionBtn onClick={() => doTranslate("en")} disabled={translating}>→ INGGRIS</ActionBtn>
            <ActionBtn onClick={() => doTranslate("id")} disabled={translating}>→ INDONESIA</ActionBtn>
          </div>
          {sub.cues.some((c) => c.translated) && (
            <Chip active={sub.showTranslated} onClick={() => patchSubtitle({ showTranslated: !sub.showTranslated })}>
              PAKAI HASIL TERJEMAHAN
            </Chip>
          )}
        </>
      )}
    </Panel>
  );
}

/* ================= ZOOM PEMBICARA ================= */

export function SpeakerPanel() {
  const media = useSelected();
  const sp = useClipper((s) => s.settings.speaker);
  const patchSpeaker = useClipper((s) => s.patchSpeaker);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const models = useClipper((s) => s.models);
  const setModels = useClipper((s) => s.setModels);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<string>("");

  const run = async () => {
    if (!media || media.type === "audio") return;
    try {
      setBusy("Analisis pembicara…");
      setProgress(0.01);
      const a = await getCachedSpeaker(media as MediaItem, sp, (p, s) => {
        setProgress(p);
        setStage(s);
        if (s.includes("AI mendeteksi")) setModels({ detector: "downloading", detectorProgress: p });
      });
      setModels({ detector: "ready", detectorProgress: 1 });
      setResult(
        a.fallback
          ? `Mode cadangan 2-bagian aktif (kiri/kanan) — AI sulit mengenali orang pada video ini (kartun/rekaman layar).`
          : `Orang terdeteksi: ${a.persons.length} · segmen fokus: ${a.segments.length} · ${a.fps.toFixed(1)} sampel/detik`
      );
      patchSpeaker({ enabled: true });
      setToast("Analisis selesai — pratinjau & ekspor kini mengikuti pembicara");
    } catch (e) {
      setToast(`Analisis gagal: ${e instanceof Error ? e.message : e}`);
      setModels({ detector: "error" });
    } finally {
      setBusy(null);
      setProgress(0);
      setStage("");
    }
  };

  return (
    <Panel title="Zoom Pembicara Otomatis" icon={<Users size={12} className="text-primary" />}>
      <Note>
        Seperti aplikasi AI potong-podcast — tapi 100% offline. Kamera otomatis zoom orang yang bicara dan pindah
        saat berganti pembicara. Tiga sinyal digabung: AI deteksi orang (YOLOS-tiny ±10 MB, unduh sekali) +
        gerakan mulut/wajah + kapan ada suara.
      </Note>

      <Row label="AKTIF">
        <Chip active={sp.enabled} onClick={() => patchSpeaker({ enabled: !sp.enabled })}>
          {sp.enabled ? "MENYALA" : "MATI"}
        </Chip>
      </Row>
      <Row label="TRANSISI">
        <Chip active={sp.transition === "pan"} onClick={() => patchSpeaker({ transition: "pan" })} title="Kamera bergeser halus">GESER HALUS</Chip>
        <Chip active={sp.transition === "fade"} onClick={() => patchSpeaker({ transition: "fade" })} title="Gambar lama melebur ke baru">FADE</Chip>
        <Chip active={sp.transition === "cut"} onClick={() => patchSpeaker({ transition: "cut" })} title="Pindah instan seperti TV">LANGSUNG</Chip>
      </Row>
      <Row label="KECEPATAN">
        <Chip active={sp.speed === "fast"} onClick={() => patchSpeaker({ speed: "fast" })}>CEPAT</Chip>
        <Chip active={sp.speed === "normal"} onClick={() => patchSpeaker({ speed: "normal" })}>NORMAL</Chip>
        <Chip active={sp.speed === "slow"} onClick={() => patchSpeaker({ speed: "slow" })}>LAMBAT</Chip>
      </Row>
      <Row label="SAAT SENYAP">
        <Chip active={sp.silent === "hold"} onClick={() => patchSpeaker({ silent: "hold" })}>TETAP DI PEMBICARA</Chip>
        <Chip active={sp.silent === "all"} onClick={() => patchSpeaker({ silent: "all" })}>TAMPILKAN SEMUA</Chip>
      </Row>
      <Row label="SINYAL">
        <Chip active={sp.useFace} onClick={() => patchSpeaker({ useFace: !sp.useFace })} title="YOLOS-tiny + gerakan kepala">AI ORANG</Chip>
        <Chip active={sp.useAudio} onClick={() => patchSpeaker({ useAudio: !sp.useAudio })} title="Analisis gelombang suara stereo">SUARA</Chip>
      </Row>

      <ActionBtn variant="primary" onClick={run} disabled={!media || media.type === "audio"} className="w-full">
        <Play size={12} className="inline mr-1" /> ANALISIS PEMBICARA SEKARANG
      </ActionBtn>
      {(progress > 0 || stage) && (
        <div className="space-y-1">
          <Progress p={progress} />
          <div className="text-[10px] text-muted-foreground">{stage}</div>
        </div>
      )}
      {result && <Note>{result}</Note>}
      <Note>📱 Rasio 9:16 → hasil vertikal siap Reels / TikTok / Shorts. Berlaku global — Batch Ekspor & Gabung Video otomatis menganalisis tiap film.</Note>
    </Panel>
  );
}
