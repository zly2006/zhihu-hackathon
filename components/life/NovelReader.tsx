"use client";

import type { Chapter } from "@/lib/domain/chapter";

export function NovelReader({
  novel,
  onRegenerate,
  regenerating,
  showRegenerate = true,
}: {
  novel: NonNullable<Chapter["novel"]>;
  onRegenerate: () => void;
  regenerating: boolean;
  showRegenerate?: boolean;
}) {
  const totalChars = novel.scenes.reduce((sum, scene) => sum + scene.text.length, 0);
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, margin: "0 0 4px" }}>{novel.title}</h2>
        {novel.subtitle && <div style={{ color: "#6b7280", fontSize: 14 }}>{novel.subtitle}</div>}
        <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
          共 {novel.scenes.length} 个场景 · 约 {totalChars} 字 · 第 {novel.version} 版
        </div>
      </div>

      <div style={{ display: "grid", gap: 20 }}>
        {novel.scenes.map((scene) => (
          <div key={scene.id}>
            {scene.timeLabel && (
              <div style={{ fontSize: 13, color: "#2563eb", fontWeight: 600, marginBottom: 6 }}>
                {scene.timeLabel}
              </div>
            )}
            {scene.heading && (
              <div style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 8 }}>
                {scene.heading}
              </div>
            )}
            <p style={{ fontSize: 16, lineHeight: 2, color: "#1f2937", whiteSpace: "pre-wrap", margin: 0 }}>
              {scene.text}
            </p>
          </div>
        ))}
      </div>

      {showRegenerate && (
        <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              background: "#fff",
              color: "#4b5563",
              border: "1px solid #d1d5db",
              fontSize: 14,
              cursor: regenerating ? "wait" : "pointer",
            }}
          >
            {regenerating ? "正在重写…" : "重写本章小说（不改变已发生的事实）"}
          </button>
        </div>
      )}
    </div>
  );
}
