"use client";

import type { Chapter } from "@/lib/domain/chapter";

export function TimelinePanel({ chapters }: { chapters: Chapter[] }) {
  const sorted = [...chapters].sort((a, b) => a.index - b.index);
  if (!sorted.length) {
    return (
      <section>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>人生时间轴</h3>
        <div style={{ color: "#9ca3af", fontSize: 14 }}>尚无已完成的章节。</div>
      </section>
    );
  }
  return (
    <section>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>人生时间轴</h3>
      <div style={{ display: "grid", gap: 12 }}>
        {sorted.map((chapter) => (
          <div key={chapter.id} style={{ borderLeft: "3px solid #2563eb", paddingLeft: 14 }}>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              第 {chapter.index + 1} 章 · {chapter.startYear}—{chapter.endYear} · {chapter.span} 年
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{chapter.novel.title}</div>
            <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>
              {chapter.summary.keyEvents.join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
