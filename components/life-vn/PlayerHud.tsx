"use client";

import type { LifePresentationState } from "@/lib/game/presentation";
import { StatBar } from "./StatBar";

// 主角 HUD：身份卡片 + 属性条 + 当前目标 + 当前困境
export function PlayerHud({
  presentation,
  goals,
  dilemmas,
}: {
  presentation: LifePresentationState["protagonist"];
  goals?: Array<{ label: string; horizon?: string }>;
  dilemmas?: string[];
}) {
  return (
    <>
      <section className="life-vn-hud-section">
        <div className="life-vn-hud-title">
          <span>角色信息</span>
        </div>
        <div className="life-vn-identity">
          {presentation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="life-vn-avatar" src={presentation.avatarUrl} alt={`${presentation.name}头像`} />
          ) : (
            <span className="life-vn-avatar" aria-hidden="true" />
          )}
          <div>
            <b>{presentation.name}</b>
            <small>
              {presentation.occupation} · {presentation.age} 岁
            </small>
            <div className="life-vn-level">
              <span>{presentation.levelLabel}</span>
              <span className="life-vn-bar">
                <i style={{ width: `${Math.min(100, presentation.age)}%` }} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="life-vn-hud-section">
        <div className="life-vn-hud-title">
          <span>属性</span>
        </div>
        {presentation.stats.map((stat) => (
          <StatBar key={stat.key} stat={stat} />
        ))}
      </section>

      {(goals && goals.length > 0) || (dilemmas && dilemmas.length > 0) ? (
        <section className="life-vn-hud-section">
          {goals && goals.length > 0 && (
            <>
              <div className="life-vn-hud-title">
                <span>当前目标</span>
              </div>
              {goals.map((goal, index) => (
                <div className="life-vn-goal" key={`${goal.label}-${index}`} style={{ marginBottom: 8 }}>
                  <b>{goal.label}</b>
                  {goal.horizon && <p>视野：{goal.horizon}</p>}
                </div>
              ))}
            </>
          )}
          {dilemmas && dilemmas.length > 0 && (
            <>
              <div className="life-vn-hud-title">
                <span>当前困境</span>
              </div>
              {dilemmas.map((dilemma, index) => (
                <div className="life-vn-goal" key={`${dilemma}-${index}`}>
                  <p>{dilemma}</p>
                </div>
              ))}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
