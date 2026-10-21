/* ============================================================
   CLIPPER EDITOR — helper build statik untuk Electron
   - Mengecualikan sementara src/app/api (butuh server, tidak
     dipakai di mode desktop offline)
   - Menjalankan `next build` dengan BUILD_FOR_ELECTRON=1
   - Mengembalikan src/app/api apa pun hasilnya
   Jalur lintas-platform (Windows/macOS/Linux): node electron/build-app.mjs
   ============================================================ */
import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src", "app", "api");
const stashDir = path.join(root, ".api-stash-electron");

let stashed = false;
if (existsSync(apiDir)) {
  rmSync(stashDir, { recursive: true, force: true });
  renameSync(apiDir, stashDir);
  stashed = true;
  console.log("[build-app] src/app/api dipindah sementara (mode Electron)");
}

try {
  const res = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    shell: true,
    cwd: root,
    env: { ...process.env, BUILD_FOR_ELECTRON: "1" },
  });
  process.exitCode = res.status ?? 1;
} finally {
  if (stashed) {
    rmSync(apiDir, { recursive: true, force: true });
    renameSync(stashDir, apiDir);
    console.log("[build-app] src/app/api dikembalikan");
  }
}
