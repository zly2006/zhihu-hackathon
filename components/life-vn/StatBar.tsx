"use client";

import type { StatPresentation } from "@/lib/game/presentation";

export function StatBar({ stat }: { stat: StatPresentation }) {
  return (
    <div className={`life-vn-stat${stat.warning ? " danger" : ""}`}>
      <span>{stat.label}</span>
      <span className="life-vn-bar">
        <i style={{ width: `${Math.max(0, Math.min(100, stat.value))}%` }} />
      </span>
      <b>
        {stat.value}
        {typeof stat.delta === "number" && stat.delta !== 0 && (
          <span className={`delta${stat.delta < 0 ? " neg" : ""}`}>
            {" "}
            {stat.delta > 0 ? "+" : ""}
            {stat.delta}
          </span>
        )}
      </b>
    </div>
  );
}
