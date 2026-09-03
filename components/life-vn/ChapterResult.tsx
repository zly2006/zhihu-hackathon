"use client";

import { useState } from "react";
import type { SimulationEvent } from "@/lib/domain/simulation";
import type { LifeExperience } from "@/lib/domain/experience";
import { RealityEvidenceDrawer } from "./RealityEvidenceDrawer";

const anchorLabel: Record<string, string> = {
  favorable: "顺遂",
  mixed: "有得有失",
  setback: "受挫",
};

// 章节结算：结果锚点 + 本章主题（叙事导演）+ 关键事件时间轴 + 本章变化 + 现实参照抽屉 + 操作
export function ChapterResult({
  events,
  outcomeAnchor,
  effectiveRisk,
  summary,
  evidence,
  evidenceTotal,
  onRegenerate,
  onNextChapter,
  regenerating,
  theme,
  mainConflict,
  showRegenerate = true,
  children,
}: {
  events: SimulationEvent[];
  outcomeAnchor: string;
  effectiveRisk: number;
  summary: {
    keyEvents: string[];
    characterChanges: string[];
    relationshipChanges: string[];
    openThreads: string[];
  };
  evidence: LifeExperience[];
  evidenceTotal: number;
  onRegenerate: () => void;
  onNextChapter: () => void;
  regenerating: boolean;
  theme?: string;
  mainConflict?: string;
  showRegenerate?: boolean;
  children?: React.ReactNode;
}) {
  const [showChanges, setShowChanges] = useState(true);
  return (
    <div className="life-vn-grid">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="life-vn-pill">本章结果：{anchorLabel[outcomeAnchor] ?? outcomeAnchor}</span>
        <span className="life-vn-pill">有效风险 {effectiveRisk}</span>
        <span className="life-vn-pill">参考 {evidenceTotal} 条知乎真实经历</span>
      </div>

      {(theme || mainConflict) && (
        <div className="life-vn-card">
          <div className="life-vn-hud-title">
            <span>本章主题（叙事导演）</span>
          </div>
          {theme && <div className="life-vn-change">{theme}</div>}
          {mainConflict && <div className="life-vn-change">主冲突：{mainConflict}</div>}
        </div>
      )}

      {children}

      <section className="life-vn-card">
        <div className="life-vn-hud-title">
          <span>关键事件时间轴</span>
        </div>
        {events.map((event) => (
          <div className="life-vn-timeline-row" key={event.id}>
            <time>
              {event.year}
              {event.month ? `.${String(event.month).padStart(2, "0")}` : ""}
            </time>
            <p>
              <strong>{event.title}</strong>
              {event.summary ? ` — ${event.summary}` : ""}
            </p>
          </div>
        ))}
      </section>

      {(summary.characterChanges.length > 0 ||
        summary.relationshipChanges.length > 0 ||
        summary.openThreads.length > 0) && (
        <section className="life-vn-card">
          <div className="life-vn-hud-title">
            <span>本章真正改变了什么</span>
            <button type="button" className="life-vn-btn ghost" onClick={() => setShowChanges((value) => !value)}>
              {showChanges ? "收起" : "展开"}
            </button>
          </div>
          {showChanges && (
            <>
              {summary.characterChanges.map((change, index) => (
                <div className="life-vn-change" key={`c-${index}`}>
                  人物：{change}
                </div>
              ))}
              {summary.relationshipChanges.map((change, index) => (
                <div className="life-vn-change" key={`r-${index}`}>
                  关系：{change}
                </div>
              ))}
              {summary.openThreads.length > 0 && (
                <div className="life-vn-change" style={{ borderLeftColor: "var(--lv-blue)" }}>
                  留到下一章：{summary.openThreads.join("；")}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="life-vn-card">
        <RealityEvidenceDrawer experiences={evidence} total={evidenceTotal} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {showRegenerate && (
            <button type="button" className="life-vn-btn ghost" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? "正在重写…" : "重写本章小说（不改事实）"}
            </button>
          )}
          <button type="button" className="life-vn-btn" onClick={onNextChapter}>
            进入下一章
          </button>
        </div>
      </div>
    </div>
  );
}
