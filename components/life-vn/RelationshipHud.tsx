"use client";

import type { LifePresentationState } from "@/lib/game/presentation";

// 关系 HUD：所有与主角可见的关系
export function RelationshipHud({
  relationships,
}: {
  relationships: LifePresentationState["relationships"];
}) {
  return (
    <section className="life-vn-hud-section">
      <div className="life-vn-hud-title">
        <span>人际关系</span>
      </div>
      {relationships.length === 0 && <p style={{ color: "var(--lv-muted)", fontSize: 11 }}>暂无关系</p>}
      {relationships.map((relation) => (
        <div className="life-vn-relation" key={relation.characterId}>
          {relation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="life-vn-avatar round"
              src={relation.avatarUrl}
              alt={`${relation.name}头像`}
            />
          ) : (
            <span className="life-vn-avatar round" aria-hidden="true" />
          )}
          <span>
            <b>{relation.name}</b>
            <small>{relation.type} · {relation.levelLabel}</small>
          </span>
          <span className="score" title={`信任 ${relation.scores.trust} · 冲突 ${relation.scores.conflict} · 承诺 ${relation.scores.commitment}`}>
            ♥ {relation.score}
            {relation.actualDelta && <small style={{ display: "block" }}>本次 {formatDelta(relation.actualDelta)}</small>}
          </span>
        </div>
      ))}
    </section>
  );
}

function formatDelta(delta: NonNullable<LifePresentationState["relationships"][number]["actualDelta"]>): string {
  return Object.entries(delta)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
    .join(" · ");
}
