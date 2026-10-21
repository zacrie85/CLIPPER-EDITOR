/* ============================================================
   CLIPPER EDITOR — AI MOMEN VIRAL (100% offline)
   Mencari DI BAGIAN MANA sebuah video punya:
   • HOOK    — pembuka yang menarik perhatian (kalimat nendang,
               lonjakan energi audio, perubahan visual mendadak)
   • PACING  — ritme yang pas (tempo bicara, dinamika audio,
               ritme potongan adegan)
   • KONTEKS — makna yang utuh (mulai & selesai di batas kalimat,
               topik konsisten dari awal sampai akhir)

   Sinyal digabung (semua lokal, tanpa internet):
   1. Transkrip Whisper (bila sudah ada) → kata & kalimat + waktu
   2. Envelope RMS audio → energi, senyap, dinamika
   3. Potongan adegan (scene detect) → ritme visual
   ============================================================ */

export interface MomentSuggestion {
  id: string;
  start: number;
  end: number;
  /** skor 0..100 */
  hook: number;
  pacing: number;
  context: number;
  total: number;
  /** kalimat pembuka (bila ada transkrip) */
  hookLine: string;
  /** alasan bahasa Indonesia, siap tampil */
  reasons: string[];
  hasTranscript: boolean;
  /** durasi kandidat yang dipakai utk momen ini (detik) */
  chosenLen: number;
  /** true bila AI memilih sendiri durasi dari banyak kandidat */
  auto: boolean;
}

export interface AnalyzeMomentsInput {
  duration: number;
  /** waktu potong adegan (detik) — boleh kosong utk audio */
  cuts: number[];
  /** transkrip Whisper — boleh kosong */
  cues: { start: number; end: number; text: string }[];
  /** envelope RMS audio (mis. per 0,25 s) */
  envelope: { t: number; rms: number }[];
  /** durasi kandidat (detik). 1 angka = durasi fix; banyak angka = AI pilih sendiri */
  lens: number[];
  maxResults?: number;
}

/* ---------- kata kunci & stopwords ---------- */

const HOOK_WORDS = [
  // Indonesia
  "tahukah", "pernah", "coba", "rahasia", "ternyata", "kenapa", "kok",
  "gimana", "bagaimana", "siapa", "hati", "hati2", "jangan", "wajib",
  "harus", "gila", "gokil", "wow", "mantap", "hebat", "mengerikan",
  "seram", "sedih", "baper", "paling", "terbesar", "terbaik", "terburuk",
  "pertama", "terakhir", "gratis", "bonus", "hadiah", "salah", "buktinya",
  "alasannya", "caranya", "hanya", "cuma", "langsung", "bikin", "nih",
  "tapi", "ehh", "astaga", "yaudah", "sebentar", "penting", "bahaya",
  // Inggris
  "secret", "never", "ever", "why", "how", "who", "imagine", "warning",
  "stop", "best", "worst", "biggest", "first", "last", "free", "amazing",
  "insane", "crazy", "incredible", "shocking", "believe", "nobody",
  "everyone", "listen", "watch", "important", "dangerous", "truth",
];

const STOPWORDS = new Set([
  "yang", "dan", "di", "ke", "dari", "ini", "itu", "dengan", "untuk",
  "pada", "adalah", "the", "a", "an", "and", "or", "of", "to", "in",
  "is", "are", "was", "were", "it", "that", "this", "for", "on", "as",
  "with", "at", "by", "be", "ya", "gak", "nggak", "ga", "aja", "saya",
  "aku", "kamu", "kita", "mereka", "dia", "ada", "bukan", "juga",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ---------- util statistik ---------- */

interface RmsStats { mean: number; std: number; silenceRatio: number }

function rmsStats(env: { t: number; rms: number }[], t0: number, t1: number, globalAvg: number): RmsStats {
  let sum = 0, sum2 = 0, n = 0, silent = 0;
  const thr = globalAvg * 0.12;
  for (const p of env) {
    if (p.t < t0 || p.t >= t1) continue;
    sum += p.rms; sum2 += p.rms * p.rms; n++;
    if (p.rms < thr) silent++;
  }
  if (!n) return { mean: 0, std: 0, silenceRatio: 1 };
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std, silenceRatio: silent / n };
}

function meanRms(env: { t: number; rms: number }[], t0: number, t1: number): number {
  let sum = 0, n = 0;
  for (const p of env) {
    if (p.t < t0 || p.t >= t1) continue;
    sum += p.rms; n++;
  }
  return n ? sum / n : 0;
}

/* ---------- analisis utama ---------- */

export function analyzeMoments(input: AnalyzeMomentsInput): MomentSuggestion[] {
  const { duration, cuts, cues, envelope, lens } = input;
  const maxResults = input.maxResults ?? 12;
  if (duration < 8) return [];

  const hasTranscript = cues.length > 0;

  /* mode AUTO: banyak durasi kandidat → AI pilih yang terbaik per momen.
     Bias ringan ke klip lebih pendek: dalam skor setara, klip padat
     selalu lebih enak ditonton daripada klip bertele-tele. */
  const lensUse = [...new Set(lens)].filter((L) => L >= 8 && L <= duration).sort((a, b) => a - b);
  if (!lensUse.length) return [];
  const auto = lensUse.length > 1;
  const maxL = lensUse[lensUse.length - 1];
  const rankOf = (c: MomentSuggestion) =>
    c.total - (auto ? (c.chosenLen / maxL) * 2.5 : 0);

  // rata-rata energi global
  const globalAvg = envelope.length
    ? envelope.reduce((a, p) => a + p.rms, 0) / envelope.length
    : 0;

  // indeks kalimat pertama yang mulai pada/atas t (binary-ish, linear cukup)
  const cueAt = (t: number): number => {
    for (let i = 0; i < cues.length; i++) if (cues[i].end > t) return i;
    return -1;
  };

  /* kandidat awal: awal kalimat + potongan adegan + grid 5 dtk */
  const anchors = new Set<number>();
  for (const c of cues) anchors.add(Math.max(0, Math.round(c.start * 4) / 4));
  for (const c of cuts) anchors.add(Math.round(c * 4) / 4);
  for (let t = 0; t < duration - 8; t += 5) anchors.add(Math.round(t * 4) / 4);

  const candidates: MomentSuggestion[] = [];

  for (const a0 of anchors) {
    for (const L of lens) {
      // snap awal ke awal kalimat terdekat (≤1,2 s) bila ada transkrip
      let a = a0;
      if (hasTranscript) {
        const idx = cueAt(a0 - 0.2);
        if (idx >= 0 && cues[idx].start >= a0 - 1.2 && cues[idx].start <= a0 + 1.2) {
          a = Math.max(0, cues[idx].start - 0.05);
        }
      }
      const end = Math.min(a + L, duration);
      const len = end - a;
      if (len < 8 || len < L * 0.55) continue;

      /* ----- HOOK ----- */
      let hook = 0;
      const reasons: string[] = [];
      const hookParts: string[] = [];
      const winStats = rmsStats(envelope, a, end, globalAvg);
      const burst = winStats.mean > 0 ? meanRms(envelope, a, a + 2) / winStats.mean : 1;
      if (burst > 1.25) {
        hook += clamp01((burst - 1) / 1.2) * 0.35;
        hookParts.push(`Energi suara melonjak ${burst.toFixed(1)}× di detik pertama`);
      }

      let hookLine = "";
      if (hasTranscript) {
        const i0 = cueAt(a);
        const firstTexts: string[] = [];
        for (let i = i0; i < cues.length && cues[i].start < end; i++) {
          firstTexts.push(cues[i].text);
          if (firstTexts.length >= 2) break;
        }
        const openText = firstTexts.join(" ");
        hookLine = firstTexts[0] ?? "";

        const openWords = words(openText);
        const hits = HOOK_WORDS.filter((k) => openWords.includes(k));
        if (hits.length) {
          hook += Math.min(0.24, hits.length * 0.12);
          hookParts.push(`Kata kunci hook: «${hits.slice(0, 3).join(" · ")}»`);
        }
        if (openText.includes("?")) {
          hook += 0.1;
          hookParts.push("Kalimat tanya pembuka — memancing penasaran");
        }
        if (/\d/.test(openText)) hook += 0.08;
        if (openText.includes("!")) hook += 0.05;

        // bicara langsung mulai di awal
        if (i0 >= 0 && cues[i0].start <= a + 1.5) {
          hook += 0.1;
          hookParts.push("Bicara langsung mulai di awal — tanpa basa-basi");
        }
      }

      // perubahan visual mendadak dekat awal
      if (cuts.some((c) => c >= a - 0.3 && c <= a + 1.5)) {
        hook += 0.12;
        hookParts.push("Perubahan visual mendadak di pembuka — mata langsung tertarik");
      }
      if (globalAvg > 0 && meanRms(envelope, a, a + 2) > globalAvg * 1.25) hook += 0.08;

      // tanpa transkrip: normalisasi agar tidak dihukum terlalu berat
      if (!hasTranscript) hook = Math.min(1, hook / 0.62);

      /* ----- PACING ----- */
      let pacing = 0;
      const cv = winStats.mean > 0 ? winStats.std / winStats.mean : 0;
      pacing += clamp01((cv - 0.15) / 0.55) * 0.4;

      const winCues = cues.filter((c) => c.end > a && c.start < end);
      const wordCount = winCues.reduce((s, c) => s + words(c.text).length, 0);
      const wpm = len > 0 ? wordCount / (len / 60) : 0;
      if (winCues.length) {
        const ideal = 1 - Math.min(1, Math.abs(wpm - 140) / 90);
        pacing += ideal * 0.35;
      } else {
        pacing += 0.175;
      }

      const cutCount = cuts.filter((c) => c > a && c < end).length;
      const cutRate = len > 0 ? cutCount / (len / 60) : 0;
      pacing += clamp01(cutRate / 8) * 0.25;
      if (cv > 0.3) reasons.push("Dinamika audio naik-turun — nggak monoton");
      if (cutRate >= 4) reasons.push(`Ritme visual rame: ${cutRate.toFixed(0)} potongan adegan/menit`);
      if (winCues.length && wpm > 0) {
        const vibe = wpm > 170 ? "sangat cepat" : wpm > 110 ? "ideal" : "santai";
        reasons.push(`Tempo bicara ±${Math.round(wpm)} kata/menit (${vibe})`);
      }

      /* ----- KONTEKS ----- */
      let context = 0;
      if (!hasTranscript) {
        context = 0.55;
      } else {
        const firstCue = winCues.find((c) => c.start >= a - 0.5 && c.start <= a + 0.9);
        context += firstCue ? 0.3 : 0.05;
        const lastCue = [...winCues].reverse().find((c) => c.end >= end - 0.9 && c.end <= end + 0.5);
        context += lastCue ? 0.3 : 0.05;

        const complete = winCues.filter((c) => c.start >= a - 0.1 && c.end <= end + 0.1).length;
        if (complete >= 2) context += 0.15;

        const mid = a + len / 2;
        const w1 = new Set(
          winCues.filter((c) => c.start < mid).flatMap((c) => contentWords(c.text))
        );
        const w2 = new Set(
          winCues.filter((c) => c.start >= mid).flatMap((c) => contentWords(c.text))
        );
        const coh = jaccard(w1, w2);
        context += clamp01((coh - 0.04) / 0.35) * 0.25;

        if (firstCue && lastCue) reasons.push("Konteks utuh: mulai & selesai pas di batas kalimat");
        if (coh >= 0.18) reasons.push("Topik konsisten dari awal sampai akhir");
      }

      if (winStats.silenceRatio > 0.4) {
        pacing = Math.max(0, pacing - Math.min(0.25, (winStats.silenceRatio - 0.35) * 0.8));
        reasons.push("Banyak jeda senyap — pacing dirapikan lewat potong senyap");
      }

      /* susun alasan final (maks 4) */
      const finalReasons: string[] = [];
      for (const h of hookParts) finalReasons.push(h);
      for (const r of reasons) if (!finalReasons.includes(r)) finalReasons.push(r);
      if (!hasTranscript) {
        finalReasons.push("Jalankan SUBTITLE AI dulu — analisis hook & konteks makin akurat");
      }

      if (auto) {
        const durWhy =
          context >= 65
            ? `Durasi AI: ${Math.round(len)} dtk — topik selesai pas di sini, nggak kepotong`
            : hook >= pacing
              ? `Durasi AI: ${Math.round(len)} dtk — hook & ritme paling kencang di rentang ini`
              : `Durasi AI: ${Math.round(len)} dtk — keseimbangan hook/ritme/konteks terbaik`;
        finalReasons.unshift(durWhy);
      }

      candidates.push({
        id: `momen_${Math.round(a * 100)}_${Math.round(len)}`,
        start: Math.max(0, a),
        end,
        hook: Math.round(clamp01(hook) * 100),
        pacing: Math.round(clamp01(pacing) * 100),
        context: Math.round(clamp01(context) * 100),
        total: 0,
        hookLine,
        reasons: finalReasons.slice(0, 4),
        hasTranscript,
        chosenLen: Math.round(len),
        auto,
      });
    }
  }

  // skor total: hook 40% · pacing 30% · konteks 30%
  for (const c of candidates) {
    c.total = Math.round(c.hook * 0.4 + c.pacing * 0.3 + c.context * 0.3);
  }

  /* ----- NMS: buang yang tumpang tindih, ambil terbaik -----
     mode auto: urutan pakai rank (skor − bias durasi) supaya di
     antara kandidat setara, versi lebih pendek yang menang ----- */
  candidates.sort((x, y) => rankOf(y) - rankOf(x));
  const picked: MomentSuggestion[] = [];
  for (const c of candidates) {
    const ok = picked.every((p) => {
      const inter = Math.min(p.end, c.end) - Math.max(p.start, c.start);
      if (inter <= 0) return true;
      const minLen = Math.min(p.end - p.start, c.end - c.start);
      const iou = inter / minLen;
      const nearStart = Math.abs(p.start - c.start) < 3;
      return iou < 0.25 && !nearStart;
    });
    if (ok) picked.push(c);
    if (picked.length >= maxResults) break;
  }

  picked.sort((x, y) => x.start - y.start);
  return picked;
}
