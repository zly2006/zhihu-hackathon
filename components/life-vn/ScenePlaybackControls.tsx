"use client";

import type { SceneRuntimeState } from "@/lib/domain/scene";

export function ScenePlaybackControls({
  playbackMode,
  status,
  readOnly = false,
  autoPaused = false,
  onSkip,
  onToggleAuto,
}: {
  playbackMode: SceneRuntimeState["playbackMode"];
  status: SceneRuntimeState["status"];
  readOnly?: boolean;
  autoPaused?: boolean;
  onSkip?: () => void;
  onToggleAuto?: () => void;
}) {
  const blocked = readOnly || status !== "reading";
  return (
    <div className="life-vn-playback-controls" role="group" aria-label="场景播放控制">
      <button type="button" className="life-vn-btn ghost" onClick={onSkip} disabled={blocked}>
        跳至下个选择
      </button>
      <button type="button" className="life-vn-btn ghost" onClick={onToggleAuto} disabled={blocked} aria-pressed={playbackMode === "auto"}>
        {playbackMode === "auto" ? (autoPaused ? "自动播放已暂停" : "自动播放中") : "自动播放"}
      </button>
    </div>
  );
}
