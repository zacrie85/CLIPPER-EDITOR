# CLIPPER EDITOR — Panduan Build .exe Windows (Elektron)

CLIPPER EDITOR berjalan penuh di browser (Chrome/Edge) **dan** bisa dibungkus
menjadi aplikasi Windows `.exe` dengan Elektron. Semua engine AI (Whisper,
YOLOS-tiny) berjalan **di dalam aplikasi** — unduh sekali saat pertama dipakai,
lalu **offline permanen**.

---

## A. Mode Cepat — pakai langsung di browser

```bash
bun install
bun run dev          # buka pratinjau yang tersedia
```

Tidak ada server yang dibutuhkan untuk pemrosesan: semua decoding/encoding
terjadi di browser (WebCodecs + WASM).

## B. Build .exe Windows (di mesin Windows)

### 1. Build statik Next.js

```bash
# Windows (PowerShell / CMD)
set BUILD_FOR_ELECTRON=1
npm run build:electron
```

Perintah `build:electron` (sudah tersedia di package.json) menjalankan
`next build` dengan mode **export statik** ke folder `out/`.

### 2. Bundling dengan Elektron

```bash
npm run electron:build
```

Hasilnya: `release/CLIPPER-EDITOR-Setup-1.0.0.exe`
(NSIS installer 64-bit, shortcut desktop otomatis).

### 3. Uji cepat tanpa installer

```bash
npm run electron:start     # jalankan Electron memuat folder out/
```

---

## C. Struktur Elektron

```
electron/
  main.js        → jendela CLIPPER EDITOR (1560×940, tema #08080a)
  preload.js     → contextBridge aman (window.clipperDesktop)
  builder.yml    → konfigurasi NSIS x64
```

## D. Catatan offline

| Fitur | Perlu internet? |
|---|---|
| Impor, split, scene detect, zoom/pan, efek | ❌ tidak |
| Musik AI prosedural | ❌ tidak |
| Ekspor MP4 H.264/AAC (720p–4K) | ❌ tidak |
| Subtitle Whisper (pertama kali) | ✅ unduh model ±45–270 MB |
| Subtitle Whisper (setelahnya) | ❌ offline permanen (cache) |
| Zoom pembicara YOLOS-tiny (pertama) | ✅ unduh ±10 MB |
| Terjemahan subtitle | ✅ mode online opsional |

Model tersimpan di cache/penyimpanan browser Chromium milik Elektron, jadi
setelah unduhan pertama aplikasi bisa dipakai tanpa internet total.

## E. Resolusi & rasio

- 720p HD (1280×720) · 1080p FULL HD (1920×1080) · 2K QHD (2560×1440) · 4K ULTRA HD (3840×2160)
- Rasio 9:16 otomatis dibalik sesuai konvensi TikTok/Shorts (4K vertikal = 2160×3840)
- Bitrate otomatis: 4K ≈ 4× 1080p; KOMPRES PINTAR target MB menang bila diisi
- Codec H.264 level 5.1/5.2 otomatis untuk 2K/4K (termasuk 4K 60fps)
