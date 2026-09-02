"use client";

import { useState, type ReactNode } from "react";

// V1.3 视觉小说层外壳：浅色 Galgame 四边面板（顶栏 / 左时间线 / 中央舞台 / 右 HUD / 底栏）
// 桌面三栏可独立收起；窄屏隐藏侧栏，改用底栏 + 底部抽屉。
export function LifeShell({
  chapterLabel,
  title,
  yearRange,
  brandLabel = "知乎 · 互动人生小说",
  left,
  right,
  center,
  dockItems,
  sheet,
  onBrandClick,
}: {
  chapterLabel: string;
  title: string;
  yearRange?: string;
  brandLabel?: string;
  left?: ReactNode;
  right?: ReactNode;
  center: ReactNode;
  dockItems?: Array<{ id: string; label: string; sub?: string }>;
  sheet?: ReactNode;
  onBrandClick?: () => void;
}) {
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState(dockItems?.[0]?.id ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);

  const tabs = dockItems ?? [
    { id: "people", label: "人物", sub: "C" },
    { id: "relations", label: "关系", sub: "R" },
    { id: "timeline", label: "时间线", sub: "T" },
    { id: "evidence", label: "现实参照", sub: "D" },
    { id: "inventory", label: "背包", sub: "B" },
    { id: "notes", label: "记事本", sub: "N" },
  ];

  function toggleDock(id: string) {
    if (id === activeTab) {
      setSheetOpen((open) => !open);
    } else {
      setActiveTab(id);
      setSheetOpen(true);
    }
  }

  return (
    <div className="life-vn life-vn-app">
      <div
        className={`life-vn-shell${timelineCollapsed ? " life-vn-timeline-collapsed" : ""}${
          statusCollapsed ? " life-vn-status-collapsed" : ""
        }`}
        style={{ position: "relative" }}
      >
        <header className="life-vn-top">
          <div className="life-vn-brand">
            <button type="button" className="life-vn-brand-mark" aria-label="返回首页" onClick={onBrandClick}>
              R
            </button>
            <div>
              <b>{brandLabel}</b>
              <small>Restart Life</small>
            </div>
          </div>
          <div className="life-vn-chapter">
            <small>{chapterLabel}</small>
            <h1>{title}</h1>
            {yearRange && <time>{yearRange}</time>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="life-vn-btn ghost"
              onClick={() => {
                setTimelineCollapsed(true);
                setStatusCollapsed(true);
              }}
            >
              沉浸
            </button>
            <button
              type="button"
              className="life-vn-btn ghost"
              onClick={() => {
                setTimelineCollapsed(false);
                setStatusCollapsed(false);
              }}
            >
              展开
            </button>
          </div>
        </header>

        <div className="life-vn-layout">
          {left && (
            <aside className="life-vn-panel life-vn-panel-left" aria-label="时间线面板">
              <header className="life-vn-panel-head">
                <h2>时间线</h2>
                <button
                  type="button"
                  className="life-vn-panel-toggle"
                  aria-expanded={!timelineCollapsed}
                  onClick={() => setTimelineCollapsed((value) => !value)}
                >
                  ‹
                </button>
              </header>
              <span className="life-vn-vertical-label">时间线</span>
              <div className="life-vn-panel-content">{left}</div>
            </aside>
          )}

          <div style={{ position: "relative", minWidth: 0, minHeight: 0 }}>{center}</div>

          {right && (
            <aside className="life-vn-panel life-vn-panel-right" aria-label="角色状态面板">
              <header className="life-vn-panel-head">
                <h2>角色状态</h2>
                <button
                  type="button"
                  className="life-vn-panel-toggle"
                  aria-expanded={!statusCollapsed}
                  onClick={() => setStatusCollapsed((value) => !value)}
                >
                  ›
                </button>
              </header>
              <span className="life-vn-vertical-label">角色状态</span>
              <div className="life-vn-panel-content">{right}</div>
            </aside>
          )}
        </div>

        <nav className="life-vn-dock" role="tablist" aria-label="功能面板">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => toggleDock(tab.id)}
            >
              <span>
                <b>{tab.label}</b>
                {tab.sub && <small>{tab.sub}</small>}
              </span>
            </button>
          ))}
        </nav>

        {sheetOpen && sheet && (
          <div
            style={{
              position: "absolute",
              zIndex: 30,
              left: 8,
              right: 8,
              bottom: 76,
              maxHeight: "48%",
              overflow: "auto",
              borderRadius: 12,
              padding: 12,
              border: "1px solid var(--lv-gold-line)",
              background: "var(--lv-surface)",
              boxShadow: "var(--lv-shadow)",
            }}
          >
            {sheet}
          </div>
        )}
      </div>
    </div>
  );
}
