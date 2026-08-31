"use client";

import type { LifeExperience } from "@/lib/domain/experience";

export function EvidencePanel({
  experiences,
  total,
}: {
  experiences: LifeExperience[];
  total?: number;
}) {
  if (!experiences.length) return null;
  return (
    <section>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
        本章推演参考了 {total ?? experiences.length} 条知乎真实经历，以下是部分来源：
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {experiences.map((experience) => (
          <a
            key={experience.id}
            href={experience.source.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "10px 12px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{experience.source.title}</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
              {experience.source.author ? `答主 ${experience.source.author}` : "匿名答主"}
            </div>
            <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4, lineHeight: 1.6 }}>
              {experience.source.evidenceExcerpt ||
                experience.situation.trigger ||
                experience.outcomes.shortTerm[0]?.description}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
