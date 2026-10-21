"use client";

/* ============================================================
   CLIPPER EDITOR — Panel: AI MOMEN VIRAL
   Cari DI BAGIAN MANA video punya HOOK · PACING · KONTEKS
   100% offline: transkrip Whisper + energi audio + adegan
   ============================================================ */

import { useRef, useState } from "react";
import { Flame, Play, Scissors, Download, Merge, Sparkles } from "lucide-react";
import { useClipper } from "@/lib/clipper/store";
import { analyzeMoments } from "@/lib/clipper/momentfinder";
import { detectScenes } from "@/lib/clipper/scenedetect";
import { decodeAudioFile, rmsEnvelope } from "@/lib/clipper/audio";
import { processJob, newJobId } from "@/lib/clipper/exporter";
import { fmtTime, uid, safeName } from "@/lib/clipper/format";
import { Panel, Chip, ActionBtn, Progress, Note } from "../bits";
import type { MediaItem, Part } from "@/lib/clipper/types";
import type { MomentSuggestion } from "@/lib/clipper/momentfinder";

const LENS: { key: number | "auto"; label: string }[] = [
  { key: "auto", label: "⚡ AUTO AI" },
  { key: 15, label: "15s" },
  { key: 30, label: "30s" },
  { key: 60, label: "60s" },
];

function useSelected(): MediaItem | undefined {
  return useClipper((s) => s.media.find((m) => m.id === s.selectedId));
}

function ScoreBar({ label, v }: { label: string; v: number }) {
  const color = v >= 70 ? "bg-emerald-500" : v >= 45 ? "bg-amber-400" : "bg-primary";
  return (
    <div className="flex items-center gap-1.5">
      <span className="clip-label w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-foreground/70 w-6 text-right">{v}</span>
    </div>
  );
}

export function MomentsPanel() {
  const media = useSelected();
  const setMoments = useClipper((s) => s.setMoments);
  const setParts = useClipper((s) => s.setParts);
  const setTime = useClipper((s) => s.setTime);
  const setPlaying = useClipper((s) => s.setPlaying);
  const setBusy = useClipper((s) => s.setBusy);
  const setToast = useClipper((s) => s.setToast);
  const addJob = useClipper((s) => s.addJob);
  const updateJob = useClipper((s) => s.updateJob);
  const cues = useClipper((s) => s.settings.subtitle.cues);
  const moments = useClipper((s) => (s.selectedId ? s.moments[s.selectedId] : undefined)) ?? [];
  const [lensSel, setLensSel] = useState<number | "auto">("auto");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const ranRef = useRef(false);

  const hasTranscript = cues.length > 0;

  const queueExport = (
    name: string,
    target: "current" | "split" | "merge",
    ranges: { mediaId: string; start: number; end: number }[]
  ) => {
    const st = useClipper.getState();
    const job = {
      id: newJobId(),
      name,
      target,
      ranges,
      settings: { ...st.settings.export },
      status: "queued" as const,
      progress: 0,
      stage: "Menunggu antrean…",
    };
    addJob(job);
    void processJob(job, (id) => st.media.find((m) => m.id === id), st.settings, (p) =>
      updateJob(job.id, p)
    );
  };

  const run = async () => {
    if (!media) return;
    try {
      ranRef.current = true;
      setProgress(0.02);
      setStage("Membaca gelombang audio…");
      setBusy("AI MOMEN VIRAL — analisis 100% offline…");
      const buf = await decodeAudioFile(media.url);
      const env = rmsEnvelope(buf, 0.25);
      setProgress(0.4);
      setStage("Memetakan potongan adegan…");
      let cuts: number[] = [];
      if (media.type === "video") {
        const sc = await detectScenes(media.url, media.duration, 0.55, 1.5, 4, (p) =>
          setProgress(0.4 + p * 0.55)
        );
        cuts = sc.cuts;
      }
      setStage("Menyusun skor HOOK · PACING · KONTEKS…");
      /* AUTO: kandidat 10 dtk s/d 3 menit — AI pilih sendiri durasi
         terbaik per momen (yang konteksnya selesai & skornya tertinggi) */
      const lensList =
        lensSel === "auto"
          ? [10, 15, 20, 30, 45, 60, 90, 120, 180].filter((L) => L <= media.duration)
          : [lensSel];
      if (!lensList.length) lensList.push(Math.max(8, Math.floor(media.duration)));
      const res = analyzeMoments({
        duration: media.duration,
        cuts,
        cues,
        envelope: env,
        lens: lensList,
      });
      setMoments(media.id, res);
      setToast(
        res.length
          ? lensSel === "auto"
            ? `${res.length} momen ditemukan — durasi tiap momen dipilih sendiri oleh AI`
            : `${res.length} momen terbaik ditemukan${hasTranscript ? " (pakai transkrip)" : ""} — urut dari skor tertinggi`
          : "Video terlalu pendek / belum ada momen menonjol — coba durasi lain"
      );
    } catch (e) {
      setToast(`Analisis gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
      setProgress(0);
      setStage("");
    }
  };

  const cutToTimeline = (m: MomentSuggestion, i: number) => {
    if (!media) return;
    const part: Part = {
      id: uid("part"),
      start: m.start,
      end: m.end,
      label: `MOMEN ${String(i + 1).padStart(2, "0")}`,
      origin: "manual",
    };
    setParts(media.id, [part]);
    setTime(m.start);
    setToast("Momen dimuat ke timeline — lanjut EKSPOR PARTS di panel EKSPOR");
  };

  const sorted = [...moments].sort((a, b) => b.total - a.total);
  const rangesAll = sorted.map((m) => ({ mediaId: media?.id ?? "", start: m.start, end: m.end }));

  /* ringkasan durasi pilihan AI — jawaban langsung "berapa menit klipnya?" */
  const distCounts = new Map<number, number>();
  for (const m of sorted) {
    const d = Math.round(m.end - m.start);
    distCounts.set(d, (distCounts.get(d) ?? 0) + 1);
  }
  const dist =
    sorted.length && sorted[0].auto
      ? [...distCounts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([d, n]) => {
            const label = d >= 60 ? `${(d / 60).toFixed(1).replace(".0", "")} mnt` : `${d}s`;
            return `${n}× ${label}`;
          })
          .join(" · ")
      : "";

  return (
    <Panel title="AI Momen Viral" icon={<Flame size={12} className="text-primary" />}>
      <Note>
        Mencari <b className="text-foreground">di bagian mana</b> video lo punya <b className="text-primary">HOOK</b>{" "}
        (pembuka nendang), <b className="text-primary">PACING</b> (ritme), dan{" "}
        <b className="text-primary">KONTEKS</b> (makna utuh) — lalu memberi skor 0–100 per segmen.
        Pilih <b className="text-foreground">⚡ AUTO AI</b> biar <b className="text-primary">AI yang menentukan sendiri</b> berapa
        detik/menit tiap klip (10 dtk – 3 menit) — nggak perlu mikir.
        Sinyal: transkrip Whisper {hasTranscript ? "✓ tersedia" : "(belum ada)"} + energi audio + potongan adegan.
        100% offline.
      </Note>

      <div className="flex items-center justify-between gap-2">
        <span className="clip-label shrink-0">DURASI KLIP</span>
        <div className="flex gap-1 flex-wrap justify-end">
          {LENS.map((l) => (
            <Chip key={String(l.key)} active={lensSel === l.key} onClick={() => setLensSel(l.key)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </div>

      <ActionBtn variant="primary" onClick={run} disabled={!media} className="w-full">
        <Sparkles size={12} className="inline mr-1" /> ANALISIS MOMEN VIRAL
      </ActionBtn>
      {(progress > 0 || stage) && (
        <div className="space-y-1">
          <Progress p={progress} />
          <div className="text-[10px] text-muted-foreground">{stage}</div>
        </div>
      )}
      {!hasTranscript && media && (
        <Note>
          Tips: jalankan dulu <b className="text-foreground">SUBTITLE AI</b> — hook &amp; konteks bisa dinilai dari
          isi kalimat, bukan cuma audio &amp; visual.
        </Note>
      )}

      {sorted.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <ActionBtn
              disabled={!media}
              onClick={() => queueExport(`momen_${safeName(media!.name)}`, "split", rangesAll)}
              title="Setiap momen jadi file MP4 terpisah"
            >
              <Download size={11} className="inline mr-1" /> EKSPOR SEMUA ({sorted.length})
            </ActionBtn>
            <ActionBtn
              disabled={!media || sorted.length < 2}
              onClick={() => queueExport(`gabung_momen_${safeName(media!.name)}`, "merge", rangesAll)}
              title="Semua momen digabung jadi satu MP4"
            >
              <Merge size={11} className="inline mr-1" /> GABUNG JADI 1
            </ActionBtn>
          </div>

          {dist && (
            <div className="text-[10px] text-muted-foreground">
              <span className="text-primary font-bold">⚡ AI pilih durasi:</span> {dist}
            </div>
          )}

          <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
            {sorted.map((m, i) => (
              <div key={m.id} className="border border-border rounded p-2 space-y-1.5 bg-secondary/30">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-primary tabular-nums">#{i + 1}</span>
                  <button
                    className="text-[11px] font-semibold tabular-nums hover:text-primary"
                    onClick={() => { setTime(m.start); setPlaying(true); }}
                    title="Putar dari awal momen"
                  >
                    {fmtTime(m.start)} → {fmtTime(m.end)}
                  </button>
                  {m.auto ? (
                    <span
                      className="text-[9px] font-bold text-primary border border-primary/40 bg-primary/10 rounded px-1 py-px tabular-nums"
                      title="Durasi ini dipilih sendiri oleh AI"
                    >
                      AI {Math.round(m.end - m.start)}s
                    </span>
                  ) : (
                    <span className="text-[9.5px] text-muted-foreground">
                      {(m.end - m.start).toFixed(0)}s
                    </span>
                  )}
                  <span className="ml-auto text-[13px] font-bold text-foreground tabular-nums">
                    {m.total}
                    <span className="text-[9px] text-muted-foreground">/100</span>
                  </span>
                </div>

                <div className="space-y-1">
                  <ScoreBar label="HOOK" v={m.hook} />
                  <ScoreBar label="PACING" v={m.pacing} />
                  <ScoreBar label="KONTEKS" v={m.context} />
                </div>

                {m.hookLine && (
                  <div className="text-[10.5px] text-foreground/80 italic border-l-2 border-primary/50 pl-2 line-clamp-2">
                    “{m.hookLine}”
                  </div>
                )}

                <ul className="space-y-0.5">
                  {m.reasons.slice(0, 3).map((r, k) => (
                    <li key={k} className="text-[10px] text-muted-foreground leading-snug">
                      · {r}
                    </li>
                  ))}
                </ul>

                <div className="flex gap-1.5">
                  <Chip onClick={() => { setTime(m.start); setPlaying(true); }}>
                    <Play size={10} className="inline mr-1" /> PUTAR
                  </Chip>
                  <Chip onClick={() => cutToTimeline(m, i)}>
                    <Scissors size={10} className="inline mr-1" /> POTONG
                  </Chip>
                  <Chip onClick={() => queueExport(`momen${i + 1}_${safeName(media!.name)}`, "current", [{ mediaId: media!.id, start: m.start, end: m.end }])}>
                    <Download size={10} className="inline mr-1" /> EKSPOR
                  </Chip>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
