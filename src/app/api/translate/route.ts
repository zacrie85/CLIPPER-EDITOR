import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const texts: string[] = Array.isArray(body.texts) ? body.texts.slice(0, 400) : [];
    const target: string = body.target === "en" ? "en" : "id";
    if (!texts.length) {
      return NextResponse.json({ error: "texts kosong" }, { status: 400 });
    }

    const zai = await ZAI.create();
    const joined = texts.map((t, i) => `[${i}] ${t}`).join("\n");
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            `Kamu penerjemah subtitle profesional. Terjemahkan SETIAP baris ke bahasa ${target === "en" ? "Inggris" : "Indonesia"}. ` +
            `Pertahankan format: setiap baris diawali [nomor]. Jangan menambahkan penjelasan apa pun.`,
        },
        { role: "user", content: joined },
      ],
      temperature: 0.15,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const out: string[] = new Array(texts.length).fill("");
    for (const line of raw.split("\n")) {
      const m = line.match(/\[(\d+)\]\s*(.+)/);
      if (m) {
        const idx = Number(m[1]);
        if (idx >= 0 && idx < texts.length) out[idx] = m[2].trim();
      }
    }
    // fallback: isi baris kosong dengan teks asli
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = texts[i];

    return NextResponse.json({ translations: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal menerjemahkan" },
      { status: 500 }
    );
  }
}
