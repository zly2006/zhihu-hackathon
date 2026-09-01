"use client";

import type { CSSProperties, ReactNode } from "react";
import type { SceneDef } from "@/lib/game/scene-catalog";

// 场景舞台：背景图 + 场景元信息 + 角色立绘 + 对白层
// 移动端定位通过 --lv-mobile-pos 自定义属性由 CSS 媒体查询接管（目录字段 backgroundPositionMobile）。
export function SceneStage({
  scene,
  meta,
  portraitUrl,
  children,
}: {
  scene: SceneDef;
  meta?: string;
  portraitUrl?: string | null;
  children?: ReactNode;
}) {
  const style: CSSProperties & Record<string, string> = {
    position: "absolute",
    inset: "0",
    backgroundImage: `url("${scene.assetUrl}")`,
    backgroundPosition: scene.backgroundPositionDesktop,
    "--lv-mobile-pos": scene.backgroundPositionMobile,
  };
  return (
    <div className="life-vn-scene" style={style} aria-label={meta ?? scene.label}>
      <div className="life-vn-scene-meta">
        <i />
        <span>{meta ?? scene.label}</span>
      </div>
      {portraitUrl && (
        <div
          className="life-vn-portrait"
          style={{ backgroundImage: `url("${portraitUrl}")` }}
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  );
}
