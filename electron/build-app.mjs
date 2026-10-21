/* ============================================================
   CLIPPER EDITOR — helper build statik untuk Electron
   - Mengecualikan sementara src/app/api (butuh server, tidak
     dipakai di mode desktop offline)
   - Menjalankan `next build` dengan BUILD_FOR_ELECTRON=1
   - Menyalin runtime AI (Transformers.js + WASM ONNX) ke out/
     supaya SUBTITLE AI jalan 100% offline tanpa CDN
   - Mengembalikan src/app/api apa pun hasilnya
   Jalur lintas-platform (Windows/macOS/Linux): node electron/build-app.mjs
   ============================================================ */
import { existsSync, mkdirSync, copyFileSync, cpSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src", "app", "api");
const stashDir = path.join(root, ".api-stash-electron");

/** salin runtime AI + model bundel ke out/ (dipanggil setelah next build sukses) */
function copyAiRuntime() {
  const out = path.join(root, "out");
  const ort = path.join(out, "ort");
  mkdirSync(ort, { recursive: true });

  const pairs = [
    {
      src: path.join(root, "node_modules", "@huggingface", "transformers", "dist", "transformers.min.js"),
      dst: path.join(out, "transformers.min.js"),
    },
    {
      src: path.join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
      dst: path.join(ort, "ort-wasm-simd-threaded.wasm"),
    },
    {
      src: path.join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.mjs"),
      dst: path.join(ort, "ort-wasm-simd-threaded.mjs"),
    },
    {
      // ORT meminta varian JSEP sebagai backend default (CPU + WebGPU)
      src: path.join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.jsep.mjs"),
      dst: path.join(ort, "ort-wasm-simd-threaded.jsep.mjs"),
    },
    {
      src: path.join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.jsep.wasm"),
      dst: path.join(ort, "ort-wasm-simd-threaded.jsep.wasm"),
    },
  ];

  for (const p of pairs) {
    if (!existsSync(p.src)) {
      console.warn("[build-app] PERINGATAN: file runtime AI tidak ada:", p.src);
      continue;
    }
    copyFileSync(p.src, p.dst);
    console.log("[build-app] runtime AI disalin:", path.relative(root, p.dst));
  }

  // model bundel (Whisper TINY) — subtitle AI jalan offline sejak install pertama
  const modelSrc = path.join(root, "models");
  if (existsSync(modelSrc)) {
    cpSync(modelSrc, path.join(out, "models"), { recursive: true });
    console.log("[build-app] model bundel disalin: out/models");
  } else {
    console.warn("[build-app] PERINGATAN: folder models/ tidak ada — TINY tidak ikut dibundel");
  }
}

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
  if ((res.status ?? 1) === 0) copyAiRuntime();
  process.exitCode = res.status ?? 1;
} finally {
  if (stashed) {
    rmSync(apiDir, { recursive: true, force: true });
    renameSync(stashDir, apiDir);
    console.log("[build-app] src/app/api dikembalikan");
  }
}
