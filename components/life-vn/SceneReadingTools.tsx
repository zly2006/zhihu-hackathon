"use client";

import { useEffect, type ReactNode } from "react";
import type { SceneReadingEntry } from "@/lib/domain/scene";
import type { SceneReadingPreferences } from "@/lib/game/scene-reading";

export function SceneReadingLog({
  open,
  entries,
  onClose,
}: {
  open: boolean;
  entries: SceneReadingEntry[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="life-vn-reading-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="life-vn-reading-modal" role="dialog" aria-modal="true" aria-labelledby="life-vn-reading-title">
        <header className="life-vn-reading-modal-head">
          <div>
            <span className="life-vn-tool-kicker">READING RECORD</span>
            <h2 id="life-vn-reading-title">阅读记录</h2>
          </div>
          <button type="button" className="life-vn-icon-btn" onClick={onClose} aria-label="关闭阅读记录">×</button>
        </header>
        <div className="life-vn-reading-list">
          {entries.length === 0 ? (
            <p className="life-vn-reading-empty">读过的对白和旁白会在这里留下只读记录。</p>
          ) : entries.map((entry) => (
            <article className="life-vn-reading-entry" key={entry.key}>
              <div className="life-vn-reading-entry-meta">
                <span>{entry.speaker ?? (entry.blockType === "choice" ? "行动选择" : "旁白")}</span>
                <small>{entry.sceneId} · {entry.blockId}</small>
              </div>
              <p>{entry.text}</p>
              {entry.selectedChoiceLabel && <small className="life-vn-reading-choice">已选择：{entry.selectedChoiceLabel}</small>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingButton({ children, selected, onClick }: { children: ReactNode; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`life-vn-setting-option${selected ? " active" : ""}`} onClick={onClick} aria-pressed={selected}>{children}</button>;
}

export function SceneReadingTools({
  entries,
  preferences,
  onOpenRecords,
  onChangePreferences,
}: {
  entries: SceneReadingEntry[];
  preferences: SceneReadingPreferences;
  onOpenRecords: () => void;
  onChangePreferences: (next: SceneReadingPreferences) => void;
}) {
  return (
    <div className="life-vn-reading-tools">
      <div className="life-vn-reading-tool-row">
        <button type="button" className="life-vn-btn ghost" onClick={onOpenRecords}>阅读记录 <small>{entries.length}</small></button>
      </div>
      <section className="life-vn-reading-settings" aria-label="阅读设置">
        <b>阅读设置</b>
        <div className="life-vn-setting-group">
          <span>自动速度</span>
          <div className="life-vn-setting-options">
            <SettingButton selected={preferences.autoSpeed === "slow"} onClick={() => onChangePreferences({ ...preferences, autoSpeed: "slow" })}>慢</SettingButton>
            <SettingButton selected={preferences.autoSpeed === "standard"} onClick={() => onChangePreferences({ ...preferences, autoSpeed: "standard" })}>标准</SettingButton>
            <SettingButton selected={preferences.autoSpeed === "fast"} onClick={() => onChangePreferences({ ...preferences, autoSpeed: "fast" })}>快</SettingButton>
          </div>
        </div>
        <div className="life-vn-setting-group">
          <span>字幕字号</span>
          <div className="life-vn-setting-options">
            <SettingButton selected={preferences.fontScale === "small"} onClick={() => onChangePreferences({ ...preferences, fontScale: "small" })}>小</SettingButton>
            <SettingButton selected={preferences.fontScale === "standard"} onClick={() => onChangePreferences({ ...preferences, fontScale: "standard" })}>标准</SettingButton>
            <SettingButton selected={preferences.fontScale === "large"} onClick={() => onChangePreferences({ ...preferences, fontScale: "large" })}>大</SettingButton>
          </div>
        </div>
        <div className="life-vn-setting-group">
          <span>字幕底色</span>
          <div className="life-vn-setting-options">
            <SettingButton selected={preferences.subtitleBackground === "soft"} onClick={() => onChangePreferences({ ...preferences, subtitleBackground: "soft" })}>柔和</SettingButton>
            <SettingButton selected={preferences.subtitleBackground === "standard"} onClick={() => onChangePreferences({ ...preferences, subtitleBackground: "standard" })}>标准</SettingButton>
            <SettingButton selected={preferences.subtitleBackground === "strong"} onClick={() => onChangePreferences({ ...preferences, subtitleBackground: "strong" })}>清晰</SettingButton>
          </div>
        </div>
      </section>
    </div>
  );
}
