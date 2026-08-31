"use client";

import { useState } from "react";
import type { ChapterChoice } from "@/lib/domain/chapter";

export type ChapterSelection = {
  optionId: "A" | "B" | "C" | "CUSTOM";
  customAction?: string;
};

const stateFitColor: Record<string, string> = {
  顺势: "#059669",
  可行: "#2563eb",
  吃力: "#d97706",
};

export function DecisionPanel({
  choice,
  onSelect,
}: {
  choice: ChapterChoice;
  onSelect: (selection: ChapterSelection) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  function pick(optionId: "A" | "B" | "C") {
    const option = choice.options.find((item) => item.id === optionId);
    if (!option) return;
    onSelect({ optionId });
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>{choice.promptTitle}</h2>
      <p style={{ color: "#374151", fontSize: 15, lineHeight: 1.7, margin: "0 0 20px" }}>{choice.context}</p>

      <div style={{ display: "grid", gap: 12 }}>
        {choice.options.map((option) => (
          <div
            key={option.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 16,
              cursor: "pointer",
              transition: "border-color .15s, box-shadow .15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#2563eb";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(37,99,235,.12)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#e5e7eb";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            }}
            onClick={() => pick(option.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: 16 }}>
                {option.id}. {option.label}
              </strong>
              <span style={{ color: stateFitColor[option.stateFit] ?? "#6b7280", fontSize: 13 }}>
                {option.stateFit}
              </span>
            </div>
            <div style={{ color: "#4b5563", fontSize: 14, marginTop: 4 }}>{option.description}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280", display: "flex", gap: 12 }}>
              <span>机制：{option.strategyTag}</span>
              <span>风险：{option.estimatedRisk}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {!customOpen ? (
          <button
            onClick={() => setCustomOpen(true)}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              background: "#fff",
              border: "1px dashed #9ca3af",
              color: "#4b5563",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            自定义行动
          </button>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="描述你自己的想法，例如：先不辞职，利用半年看看武汉有没有更好的机会，再决定。"
              rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #d1d5db", fontSize: 14 }}
            />
            <button
              onClick={() => onSelect({ optionId: "CUSTOM", customAction: customText })}
              disabled={!customText.trim()}
              style={{
                padding: "12px",
                borderRadius: 10,
                background: "#4f46e5",
                color: "#fff",
                border: "none",
                fontSize: 15,
                cursor: customText.trim() ? "pointer" : "not-allowed",
              }}
            >
              按这个想法行动
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
