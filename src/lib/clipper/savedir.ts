"use client";

/* ============================================================
   CLIPPER EDITOR — SIMPAN KE FOLDER (v1.2.7)
   ============================================================
   MASALAH (ditemukan regresi E2E v1.2.7, ada sejak v1.2.6):
   ekspor video besar menghasilkan BLOB besar di memori. Di mesin
   RAM kecil / setelah encoding berat, Chromium bisa GAGAL menyimpan
   data blob (paging ke disk gagal di bawah tekanan memori) — blob
   terlihat "ada" (size benar) tetapi DATA-NYA TAK TERBACA
   ("Failed to fetch") → unduhan "interrupted" 0 MB → file ekspor
   0 byte PADAHAL encoding sukses. EKSPOR PARTS lolos karena blob
   kecil dan segera diunduh.

   SOLUSI: mode "FOLDER PILIHAN" — MP4 DITULIS LANGSUNG KE DISK
   selagi di-encode (File System Access API + mp4-muxer
   FileSystemWritableFileStreamTarget, fastStart false). Tidak ada
   blob raksasa di memori → tahan file beratus-ratus MB & RAM stabil.
   Fallback penuh ke jalur unduhan browser (blob) bila API tidak
   tersedia / user membatalkan / mode UNDUHAN dipilih.
   ============================================================ */

export type SaveMode = "folder" | "download";

const MODE_KEY = "clipper-save-mode";

let dirHandle: FileSystemDirectoryHandle | null = null;

export function getSaveMode(): SaveMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "download" ? "download" : "folder";
  } catch {
    return "folder";
  }
}

export function setSaveMode(m: SaveMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* abaikan */
  }
}

/** nama folder tersimpan (bila sudah dipilih sesi ini) */
export function saveDirLabel(): string | null {
  return dirHandle?.name ?? null;
}

/** cek izin baca-tulis handle — tanpa dialog */
async function permissionGranted(h: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const q = await h.queryPermission({ mode: "readwrite" });
    return q === "granted";
  } catch {
    return false;
  }
}

/** minta izin handle tersimpan — butuh gesture; gagal = null */
async function requestPerm(h: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const r = await h.requestPermission({ mode: "readwrite" });
    return r === "granted";
  } catch {
    return false;
  }
}

/**
 * Pastikan ada folder simpanan (mode FOLDER). Urutan:
 *   1. handle sesi ini + izin granted → pakai
 *   2. handle sesi ini + izin belum → requestPermission (gesture klik)
 *   3. belum ada → showDirectoryPicker (gesture klik wajib)
 * Gagal apa pun (API tak ada / user batal / tanpa gesture) → null →
 * pemanggil jatuh ke jalur unduhan browser (blob).
 */
export async function obtainSaveDir(forcePick = false): Promise<FileSystemDirectoryHandle | null> {
  if (getSaveMode() !== "folder") return null;
  try {
    const w = window as unknown as {
      showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    };
    if (!w.showDirectoryPicker) return null;

    if (!forcePick && dirHandle && (await permissionGranted(dirHandle))) return dirHandle;
    if (!forcePick && dirHandle && (await requestPerm(dirHandle))) return dirHandle;

    // tanpa gesture user, dialog tidak boleh dipanggil (bisa menggantung)
    const act = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!forcePick && act && !act.hasBeenActive) return null;

    const picked = await w.showDirectoryPicker({ mode: "readwrite" });
    if (picked) {
      dirHandle = picked;
      return dirHandle;
    }
    return null;
  } catch {
    return null; // user batal / API error → fallback blob
  }
}

/** lupakan folder sesi ini (dipakai tombol GANTI) */
export function forgetSaveDir() {
  dirHandle = null;
}

/** buat file handle di folder simpanan — null bila folder tak siap */
export async function resolveSaveFile(name: string): Promise<FileSystemFileHandle | null> {
  try {
    const dir = await obtainSaveDir(false);
    if (!dir) return null;
    return await dir.getFileHandle(name, { create: true });
  } catch {
    return null;
  }
}
