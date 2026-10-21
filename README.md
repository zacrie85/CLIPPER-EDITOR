# 🎬 CLIPPER EDITOR

> **Editor video AI 100% OFFLINE untuk clipper** — alternatif gratis & privat dari Opus Clip dkk.
> AI Momen Viral · Auto-split scene · Subtitle AI (Whisper) · Zoom pembicara (YOLOS) · Musik AI · Ekspor H.264 s/d 4K

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Browser-ff2d2d?style=flat-square)
![offline](https://img.shields.io/badge/AI-100%25%20offline-white?style=flat-square)
![codec](https://img.shields.io/badge/export-H.264%20%2B%20AAC%204K-ff2d2d?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-white?style=flat-square)

Dibuat khusus buat **clipper**: potong video panjang (podcast, live, MotoGP, dsb.)
jadi klip pendek TikTok / Reels / Shorts — **tanpa upload ke server siapa pun**.
Semua decoding, analisis AI, dan encoding terjadi di device lo sendiri.

---

## ✨ Fitur

| # | Fitur | Detail |
|---|-------|--------|
| 1 | **Impor media** | MP4 · MKV · TS · WEBM · MP3 — decode via **WebCodecs API** |
| 2 | **Auto split** | Potong per detik atau multi-segmen (Canvas + WebCodecs) |
| 3 | **AI Subtitle** | Whisper (WASM) **ID + EN** → transkrip + SRT + gaya karaoke; **model TINY dibundel di aplikasi → jalan offline sejak install pertama tanpa unduhan**; BASE/SMALL unduh sekali lalu offline permanen |
| 4 | **Object Tracking** | Label grafis gaya MotoGP — tracker **NCC pyramidal** (coarse-to-fine) |
| 5 | **AI Musik** | Komposer prosedural (EPIC · LO-FI · dsb.) via Web Audio API + impor MP3 sendiri |
| 6 | **Tipografi sinematik** | 10 font (Cinzel, Anton, dsb.) · 5 gaya · animasi masuk/keluar |
| 7 | **Ekspor MP4** | H.264 + AAC · **720p / 1080p / 2K / 4K** · rasio terkunci global · KOMPRES PINTAR (target MB) · AUTO ↔ skala 100/75/50% dua arah · H.264 L5.1/5.2 otomatis untuk 2K/4K |
| 8 | **Rasio 9:16 / 16:9** | 9:16 dibalik ala TikTok (4K vertikal = 2160×3840) · pan & zoom manual pakai panah |
| 9 | **Zoom pembicara otomatis** | 3 sinyal: **YOLOS-tiny ONNX** (±10 MB, unduh sekali) + gerakan mulut/kepala + aktivitas audio · transisi GESER HALUS / FADE / LANGSUNG · fallback auto 2-bagian |
| 10 | **Scene detect** | Analisis piksel + histogram, ambang adaptif **median+MAD** — potong pas di pergantian adegan, bukan durasi patokan |
| 11 | **AI Momen Viral + AUTO DURASI** | Mencari **di bagian mana** video punya **HOOK · PACING · KONTEKS** — skor 0–100 per segmen dari transkrip Whisper + energi audio + adegan; mode **⚡ AUTO AI** menentukan sendiri durasi tiap klip (10 dtk–3 mnt) sesuai selesainya topik; langsung PUTAR / POTONG / EKSPOR / GABUNG semua momen |

## 🛠️ Catatan versi & pemecahan masalah

- **v1.2.4 — FIX BLANK/HANG SAAT TOMBOL TRANSCRIPSI DITEKAN**: (1) **fase persiapan audio kini berprogress sejak klik** — dulu seluruh video di-fetch + di-decode 48 kHz di main thread tanpa indikator; (2) **decode langsung 16 kHz + downmix hemat RAM (±5–8× lebih irit)** — video panjang tidak lagi membuat memori meledak (penyebab renderer crash → layar blank); (3) **probe WebGPU diberi batas waktu 10 detik + tombol WEBGPU: AUTO/MATI** — driver GPU bermasalah tidak lagi menggantung/crash aplikasi; MATI (AMAN) memaksa CPU; (4) switch `enable-unsafe-webgpu` dihapus; (5) **renderer yang crash otomatis dimuat ulang** (maks 3×/menit) — layar blank tidak lagi permanen; (6) worker gagal muat / diam >3 menit kini menampilkan pesan jelas + dipulihkan, bukan diam selamanya; (7) tombol BATALKAN bekerja sejak fase membaca audio.
- **v1.2.3 — SUBTITLE AI 10× LEBIH CEPAT + TIDAK HANG**: (1) mesin Whisper pindah ke **Web Worker terpisah** — UI/aplikasi tidak pernah beku lagi saat transkripsi, semua menu tetap bisa ditekan; (2) **WEBGPU** — bila GPU mendukung, inferensi memakai kartu grafis (±8–15× lebih cepat), otomatis fallback ke WASM; (3) **WASM kini multithread** — header COOP/COEP di protokol `app://` mengaktifkan SharedArrayBuffer sehingga semua core CPU dipakai (sebelumnya terkunci 1 thread); (4) **VAD (Voice Activity Detection)** — bagian senyap/musik di-skip sehingga tidak dibuang-buang waktu; (5) **progress real** per bagian + estimasi sisa waktu + tombol **BATALKAN**; (6) **cache model pindah ke IndexedDB** — Cache API browser ternyata menolak protokol `app://` (model tadinya unduh ulang setiap buka aplikasi); model lama di cache lama tetap terbaca (migrasi otomatis).
- **v1.2.2 — FIX SUBTITLE AI**: (1) runtime Transformers.js + WASM ONNX kini **dibundel di dalam aplikasi** — tidak ada lagi unduhan runtime dari CDN; (2) **model Whisper TINY (42 MB) dibundel** — subtitle jalan 100% offline sejak install pertama; BASE/SMALL tetap via unduhan sekali dari HuggingFace dengan retry otomatis 3×; (3) pesan error ramah untuk video .TS/AC3 yang audionya tak bisa didecode browser; (4) progres unduhan tampil persen per model.
- **v1.2.1 — FIX LAYAR HITAM**: aplikasi Windows versi lama bisa tampil layar hitam saat dibuka (path asset absolut `/\_next/…` rusak di protokol `file://`). Sekarang dimuat via protokol kustom `app://` + path asset relatif — sudah diuji headless (JS terhidrasi + CSS termuat). **Wajib update ke 1.2.1.**
- Installer **unsigned** → SmartScreen warning: klik **More info → Run anyway**.
- Kalau unduhan model AI pertama terputus: jalankan app sekali lagi, unduhan lanjut dari cache.

## 🔒 Kenapa offline?

| Kebutuhan | Online? |
|---|---|
| Impor, split, scene detect, zoom/pan, efek, musik AI, ekspor 4K | ❌ Tidak pernah |
| Whisper subtitle — **unduhan pertama** (±45–270 MB) | ✅ sekali saja |
| Whisper subtitle — setelahnya | ❌ offline permanen (cache) |
| YOLOS-tiny zoom pembicara — unduhan pertama (±10 MB) | ✅ sekali saja |
| Terjemahan subtitle (opsional) | ✅ mode online opsional |

Video lo **tidak pernah keluar dari device**. Cocok buat konten sensitif, hemat kuota, dan tanpa langganan.

## 🚀 Mulai Cepat — mode browser

```bash
git clone https://github.com/zacrie85/CLIPPER-EDITOR.git
cd CLIPPER-EDITOR
bun install        # atau: npm install
bun run db:push    # inisialisasi SQLite lokal
bun run dev        # buka http://localhost:3000
```

Semua pemrosesan jalan di browser (Chrome/Edge) — tidak butuh server khusus.

## 📦 Build .exe Windows (Electron)

Panduan lengkap: **[README-CLIPPER.md](./README-CLIPPER.md)**

```powershell
# 1) build statik
set BUILD_FOR_ELECTRON=1
npm run build:electron

# 2) bundling installer
npm run electron:build
# hasil: release/CLIPPER-EDITOR-Setup-1.0.0.exe  (NSIS x64)
```

## 🗂️ Struktur Proyek

```
src/
  lib/clipper/          ← engine inti
    media.ts frames.ts scenedetect.ts    impor · seek presisi · scene detect
    whisper.ts detection.ts speaker.ts   subtitle AI · YOLOS · zoom pembicara
    momentfinder.ts                      AI momen viral (hook · pacing · konteks)
    tracker.ts music.ts typography.ts    NCC tracker · komposer AI · 10 font
    render.ts exporter.ts store.ts       komposit canvas · WebCodecs muxer · state
  components/clipper/   ← UI editor (dark + merah, monospace, futuristic)
  app/api/translate/    ← terjemahan subtitle opsional (online)
electron/               ← main.js · preload.js · builder.yml (NSIS x64)
```

## ⚙️ Resolusi & Bitrate

| Preset | 16:9 | 9:16 (TikTok) |
|---|---|---|
| 720p HD | 1280×720 | 720×1280 |
| 1080p FULL HD | 1920×1080 | 1080×1920 |
| 2K QHD | 2560×1440 | 1440×2560 |
| 4K ULTRA HD | 3840×2160 | **2160×3840** |

Bitrate adaptif otomatis (4K ≈ 4× 1080p). Isi **KOMPRES PINTAR** (target MB) bila
ukuran file lebih penting dari kualitas. Rasio terkunci berlaku global: ekspor,
split, batch, dan merge.

## 🗺️ Roadmap

- [ ] Batch processing multi-video
- [ ] Paket efek visual (glitch, zoom-punch, shake)
- [ ] Terjemahan subtitle offline (NLLB/opus-mt lokal)
- [ ] Auto-reframe wajah multi-speaker

## 📄 Lisensi

MIT — lihat [LICENSE](./LICENSE).
