"use client";

import type { LifePresentationState } from "@/lib/game/presentation";
import { PlayerHud } from "./PlayerHud";
import { RelationshipHud } from "./RelationshipHud";

// 状态 HUD 只组合公开展示模型，避免页面直接读取 WorldState 的私密字段。
export function StatusHUD({
  presentation,
  goals,
  dilemmas,
  relationships,
}: {
  presentation: LifePresentationState["protagonist"];
  goals?: Array<{ label: string; horizon?: string }>;
  dilemmas?: string[];
  relationships: LifePresentationState["relationships"];
}) {
  return (
    <>
      <PlayerHud presentation={presentation} goals={goals} dilemmas={dilemmas} />
      <RelationshipHud relationships={relationships} />
    </>
  );
}
