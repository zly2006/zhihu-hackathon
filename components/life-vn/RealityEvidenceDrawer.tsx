"use client";

import { useState } from "react";
import type { LifeExperience } from "@/lib/domain/experience";

// 知乎现实参照抽屉：展开后展示本章引用的来源卡
export function RealityEvidenceDrawer({
  experiences,
  total,
}: {
  experiences: LifeExperience[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="life-vn-hud-section">
      <div className="life-vn-hud-title">
        <span>知乎现实参照</span>
        <button type="button" className="life-vn-btn ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : `展开（${experiences.length}/${total}）`}
        </button>
      </div>
      {open && (
        <div>
          <p style={{ color: "var(--lv-muted)", fontSize: 11, margin: "0 0 8px" }}>
            本章推演参考了 {total} 条知乎真实经历，以下为最相关的来源。
          </p>
          {experiences.map((experience) => (
            <div className="life-vn-evidence-card" key={experience.id}>
              <b>{experience.source.title || "知乎经历"}</b>
              <small>
                {experience.source.author ?? "匿名"} ·{" "}
                {experience.source.url ? experience.source.url.replace(/^https?:\/\//, "") : "来源"}
              </small>
              <p>{experience.situation.dilemma || experience.outcomes.shortTerm[0]?.description || ""}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
