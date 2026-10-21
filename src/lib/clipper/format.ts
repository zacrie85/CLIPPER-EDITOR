/* ============================================================
   CLIPPER EDITOR — Utilitas format & kecil-kecilan
   ============================================================ */

export function fmtTime(t: number, withMs = false): string {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  const base = `${h > 0 ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mad(arr: number[], med?: number): number {
  if (!arr.length) return 0;
  const m = med ?? median(arr);
  return median(arr.map((v) => Math.abs(v - m)));
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

export function safeName(s: string): string {
  return s.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim().slice(0, 48) || "clip";
}

export function bytesToMBStr(b: number): string {
  return `${(b / 1048576).toFixed(1)} MB`;
}
