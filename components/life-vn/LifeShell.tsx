"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  defaultShellPanelState,
  isShellPanelState,
  shellGlobalActionLabel,
  toggleAllShellPanels,
  toggleShellPanel,
  type ShellPanelId,
  type ShellPanelState,
} from "@/lib/game/shell-panel-state";

const SHELL_PREFERENCES_KEY = "restart-life-shell-panels-v1";

// 四个纯展示面板独立开关；偏好不接触 GameSave 或场景运行时。
export function LifeShell({ chapterLabel, title, yearRange, brandLabel = "知乎 · 互动人生小说", left, right, center, dockItems, sheet, onBrandClick }: {
  chapterLabel: string; title: string; yearRange?: string; brandLabel?: string; left?: ReactNode; right?: ReactNode;
  center: ReactNode; dockItems?: Array<{ id: string; label: string; sub?: string }>; sheet?: ReactNode; onBrandClick?: () => void;
}) {
  const [panels, setPanels] = useState<ShellPanelState>(defaultShellPanelState);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [activeTab, setActiveTab] = useState(dockItems?.[0]?.id ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SHELL_PREFERENCES_KEY);
      if (raw) { const parsed: unknown = JSON.parse(raw); if (isShellPanelState(parsed)) setPanels(parsed); }
    } catch { /* 损坏的展示偏好只回退默认布局，不影响游戏存档。 */ }
    finally { setPreferencesReady(true); }
  }, []);
  useEffect(() => {
    if (preferencesReady) window.localStorage.setItem(SHELL_PREFERENCES_KEY, JSON.stringify(panels));
  }, [panels, preferencesReady]);

  const tabs = dockItems ?? [
    { id: "people", label: "人物", sub: "C" }, { id: "relations", label: "关系", sub: "R" },
    { id: "timeline", label: "时间线", sub: "T" }, { id: "evidence", label: "现实参照", sub: "D" },
    { id: "inventory", label: "背包", sub: "B" }, { id: "notes", label: "记事本", sub: "N" },
  ];
  const togglePanel = (panel: ShellPanelId) => setPanels((current) => toggleShellPanel(current, panel));
  const toggleDock = (id: string) => {
    if (id === activeTab) setSheetOpen((open) => !open);
    else { setActiveTab(id); setSheetOpen(true); }
  };

  return <div className="life-vn life-vn-app"><div
    className={`life-vn-shell${panels.left ? "" : " life-vn-timeline-collapsed"}${panels.right ? "" : " life-vn-status-collapsed"}${panels.top ? "" : " life-vn-top-collapsed"}${panels.bottom ? "" : " life-vn-bottom-collapsed"}`}
    style={{ position: "relative" }}
  >
    <button type="button" className="life-vn-shell-global-toggle" aria-label={shellGlobalActionLabel(panels)} onClick={() => setPanels((current) => toggleAllShellPanels(current))}>{shellGlobalActionLabel(panels)}</button>
    {panels.top ? <header id="life-vn-top-panel" className="life-vn-top">
      <div className="life-vn-brand"><button type="button" className="life-vn-brand-mark" aria-label="返回首页" onClick={onBrandClick}>R</button><div><b>{brandLabel}</b><small>Restart Life</small></div></div>
      <div className="life-vn-chapter"><small>{chapterLabel}</small><h1>{title}</h1>{yearRange && <time>{yearRange}</time>}</div>
      <button type="button" className="life-vn-panel-toggle" aria-controls="life-vn-top-panel" aria-expanded="true" aria-label="收起顶栏" onClick={() => togglePanel("top")}>︿</button>
    </header> : <button type="button" className="life-vn-shell-edge life-vn-shell-edge-top" aria-controls="life-vn-top-panel" aria-expanded="false" onClick={() => togglePanel("top")}>展开顶栏</button>}

    <div className="life-vn-layout">
      {left && <aside id="life-vn-timeline-panel" className={`life-vn-panel life-vn-panel-left${panels.left ? "" : " collapsed"}`} aria-label="时间线面板">
        {panels.left ? <><header className="life-vn-panel-head"><h2>时间线</h2><button type="button" className="life-vn-panel-toggle" aria-controls="life-vn-timeline-panel" aria-expanded="true" aria-label="收起时间线" onClick={() => togglePanel("left")}>‹</button></header><div className="life-vn-panel-content">{left}</div></> :
          <button type="button" className="life-vn-shell-edge life-vn-shell-edge-left" aria-controls="life-vn-timeline-panel" aria-expanded="false" onClick={() => togglePanel("left")}><span aria-hidden="true">›</span><span>时间线</span></button>}
      </aside>}
      <div className="life-vn-center">{center}</div>
      {right && <aside id="life-vn-status-panel" className={`life-vn-panel life-vn-panel-right${panels.right ? "" : " collapsed"}`} aria-label="角色状态面板">
        {panels.right ? <><header className="life-vn-panel-head"><h2>角色状态</h2><button type="button" className="life-vn-panel-toggle" aria-controls="life-vn-status-panel" aria-expanded="true" aria-label="收起角色状态" onClick={() => togglePanel("right")}>›</button></header><div className="life-vn-panel-content">{right}</div></> :
          <button type="button" className="life-vn-shell-edge life-vn-shell-edge-right" aria-controls="life-vn-status-panel" aria-expanded="false" onClick={() => togglePanel("right")}><span aria-hidden="true">‹</span><span>角色状态</span></button>}
      </aside>}
    </div>

    {panels.bottom ? <nav id="life-vn-bottom-panel" className="life-vn-dock" role="tablist" aria-label="功能面板">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="life-vn-dock-sheet" className={activeTab === tab.id ? "active" : ""} onClick={() => toggleDock(tab.id)}><span><b>{tab.label}</b>{tab.sub && <small>{tab.sub}</small>}</span></button>)}
      <button type="button" className="life-vn-panel-toggle life-vn-dock-collapse" aria-controls="life-vn-bottom-panel" aria-expanded="true" aria-label="收起底部功能栏" onClick={() => togglePanel("bottom")}>﹀</button>
    </nav> : <button type="button" className="life-vn-shell-edge life-vn-shell-edge-bottom" aria-controls="life-vn-bottom-panel" aria-expanded="false" onClick={() => togglePanel("bottom")}>展开功能栏</button>}
    {sheetOpen && sheet && <div id="life-vn-dock-sheet" className="life-vn-dock-sheet" role="tabpanel">{sheet}</div>}
  </div></div>;
}
