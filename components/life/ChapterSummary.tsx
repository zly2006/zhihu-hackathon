"use client";

import type { Chapter, DecisionResolution } from "@/lib/domain/chapter";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import { NovelReader } from "./NovelReader";
import { EvidencePanel } from "./EvidencePanel";

const anchorLabel: Record<string, string> = {
  favorable: "顺遂",
  mixed: "有得有失",
  setback: "受挫",
};

export function ChapterSummary({
  chapter,
  events,
  resolution,
  evidence,
  evidenceTotal,
  onRegenerate,
  onNextChapter,
  regenerating,
}: {
  chapter: Chapter;
  events: SimulationEvent[];
  resolution: DecisionResolution;
  evidence: LifeExperience[];
  evidenceTotal: number;
  onRegenerate: () => void;
  onNextChapter: () => void;
  regenerating: boolean;
}) {
  const { summary } = chapter;
  return (
    <div style={{ display: "grid", gap: 28 }}>
      {/* 结果锚点 */}
      <div style={{ textAlign: "center", fontSize: 14, color: "#6b7280" }}>
        本章结果：<strong style={{ color: "#111827" }}>{anchorLabel[resolution.outcomeAnchor]}</strong>
        {" · "}有效风险 {resolution.effectiveRisk}
        {" · "}参考 {evidenceTotal} 条知乎真实经历
      </div>

      {/* 小说 */}
      <section>
        <NovelReader novel={chapter.novel} onRegenerate={onRegenerate} regenerating={regenerating} />
      </section>

      {/* 关键事件时间轴 */}
      <section>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>关键事件时间轴</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {events.map((event) => (
            <div key={event.id} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap", minWidth: 72 }}>
                {event.year}
                {event.month ? `.${String(event.month).padStart(2, "0")}` : ""}
              </span>
              <span style={{ fontSize: 14, color: "#111827" }}>
                <strong>{event.title}</strong>
                {event.summary ? ` — ${event.summary}` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 人物与关系变化 */}
      {(summary.characterChanges.length > 0 || summary.relationshipChanges.length > 0) && (
        <section>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>本章变化</h3>
          {summary.characterChanges.length > 0 && (
            <div style={{ fontSize: 14, color: "#374151", marginBottom: 6 }}>
              人物：{summary.characterChanges.join("；")}
            </div>
          )}
          {summary.relationshipChanges.length > 0 && (
            <div style={{ fontSize: 14, color: "#374151" }}>
              关系：{summary.relationshipChanges.join("；")}
            </div>
          )}
        </section>
      )}

      {/* 知乎现实参照 */}
      <section>
        <EvidencePanel experiences={evidence} total={evidenceTotal} />
      </section>

      <button onClick={onNextChapter} style={{ padding: "12px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", border: "none", fontSize: 16, cursor: "pointer" }}>
        进入下一章
      </button>
    </div>
  );
}
