"use client";

import type { CSSProperties, ReactNode } from "react";
import type { DialogueCharacter } from "@/lib/domain/dialogue";
import type { SceneCue } from "@/lib/domain/scene";
import type { SceneDef } from "@/lib/game/scene-catalog";
import { CharacterAvatar } from "./CharacterAvatar";

// 场景舞台：背景图 + 场景元信息 + 角色立绘 + 对白层
// 移动端定位通过 --lv-mobile-pos 自定义属性由 CSS 媒体查询接管（目录字段 backgroundPositionMobile）。
export function SceneStage({
  scene,
  meta,
  portraitUrl,
  characters,
  activeCharacterId,
  fallbackCharacter,
  cues,
  cueKey,
  children,
}: {
  scene: SceneDef;
  meta?: string;
  portraitUrl?: string | null;
  characters?: DialogueCharacter[];
  activeCharacterId?: string | null;
  fallbackCharacter?: DialogueCharacter;
  cues?: SceneCue[];
  cueKey?: string;
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
    <div className="life-vn-scene life-vn-scene-enter" style={style} aria-label={meta ?? scene.label}>
      <div className="life-vn-scene-meta">
        <i />
        <span>{meta ?? scene.label}</span>
      </div>
      {(characters?.length || fallbackCharacter) && (
        <CharacterAvatar
          characters={characters}
          activeCharacterId={activeCharacterId}
          fallbackCharacter={fallbackCharacter}
          cues={cues}
          cueKey={cueKey}
        />
      )}
      {!characters?.length && !fallbackCharacter && portraitUrl && (
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
