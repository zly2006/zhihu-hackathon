"use client";

import { useState } from "react";
import type { GameMode } from "@/lib/domain/shared";

const MODE_OPTIONS: Array<{
  id: GameMode;
  label: string;
  description: string;
  detail: string;
}> = [
  {
    id: "novel",
    label: "人生小说模式",
    description: "连续阅读完整章节，适合沉浸在长期人生叙事里。",
    detail: "结算仍由同一套世界模拟完成，章节以连续小说和结果摘要呈现。",
  },
  {
    id: "galgame",
    label: "Galgame 互动模式",
    description: "逐句推进对白与旁白，观察角色关系和情绪变化。",
    detail: "每章由大模型生成当前 live 场景；你选择的是行动，关系后果由程序规则结算。",
  },
];

export function ModeSelect({
  initialMode = "galgame",
  continueMode = false,
  onSelect,
  onCancel,
}: {
  initialMode?: GameMode;
  continueMode?: boolean;
  onSelect: (mode: GameMode) => void;
  onCancel: () => void;
}) {
  const [selectedMode, setSelectedMode] = useState<GameMode>(initialMode);
  const selected = MODE_OPTIONS.find((option) => option.id === selectedMode) ?? MODE_OPTIONS[1];

  return (
    <main className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <section className="life-vn-card" style={{ maxWidth: 720, width: "100%", padding: 32 }} aria-labelledby="mode-select-title">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <span className="life-vn-eyebrow">{continueMode ? "继续这段人生" : "新的叙事入口"}</span>
          <h1 id="mode-select-title" className="life-vn-title" style={{ fontSize: 28, margin: "8px 0" }}>
            选择表现方式
          </h1>
          <p className="life-vn-sub" style={{ margin: 0 }}>
            表现方式只改变阅读和互动节奏，不会改变人生模拟的结算规则。
          </p>
        </div>

        <div role="radiogroup" aria-label="表现方式" style={{ display: "grid", gap: 12 }}>
          {MODE_OPTIONS.map((option) => {
            const active = selectedMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedMode(option.id)}
                className="life-vn-card"
                style={{
                  textAlign: "left",
                  padding: 18,
                  cursor: "pointer",
                  border: active ? "2px solid var(--lv-gold-strong)" : "1px solid var(--lv-gold-line)",
                  background: active ? "rgba(255, 249, 229, .9)" : "rgba(255,255,255,.72)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 17 }}>{option.label}</strong>
                  <span className="life-vn-pill">{active ? "已选择" : "选择"}</span>
                </div>
                <div style={{ marginTop: 6, color: "#374151", lineHeight: 1.7 }}>{option.description}</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>{option.detail}</div>
              </button>
            );
          })}
        </div>

        <div className="life-vn-card" style={{ marginTop: 16, background: "rgba(248,250,252,.72)" }}>
          <strong>当前选择：{selected.label}</strong>
          <p style={{ margin: "6px 0 0", color: "#4b5563", lineHeight: 1.7 }}>{selected.description}</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 24 }}>
          <button type="button" className="life-vn-btn ghost" onClick={onCancel}>
            返回
          </button>
          <button type="button" className="life-vn-btn" onClick={() => onSelect(selectedMode)}>
            {continueMode ? "继续这段人生" : "确认并开始"}
          </button>
        </div>
      </section>
    </main>
  );
}
