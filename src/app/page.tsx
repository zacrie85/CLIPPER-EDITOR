"use client";

import dynamic from "next/dynamic";

const EditorShell = dynamic(
  () => import("@/components/clipper/editor-shell").then((m) => m.EditorShell),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-screen flex items-center justify-center bg-[#08080a]">
        <div className="text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded bg-[#e21d1d] shadow-[0_0_30px_rgba(226,29,29,0.6)] animate-pulse" />
          <div className="text-[#f4f4f5] text-sm tracking-[0.3em] font-semibold">
            CLIPPER<span className="text-[#e21d1d]">·</span>EDITOR
          </div>
          <div className="text-[10px] text-[#8e8e98] tracking-[0.2em]">MEMUAT ENGINE…</div>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  return <EditorShell />;
}
