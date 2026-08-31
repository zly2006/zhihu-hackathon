"use client";

import type { Character, CharacterGoal } from "@/lib/domain/character";
import type { Relationship } from "@/lib/domain/relationship";
import type { LifeStats } from "@/lib/domain/shared";

const statLabels: Array<{ key: keyof LifeStats; label: string }> = [
  { key: "cash", label: "现金" },
  { key: "health", label: "健康" },
  { key: "happiness", label: "幸福" },
  { key: "knowledge", label: "知识" },
  { key: "connections", label: "人脉" },
  { key: "career", label: "事业" },
  { key: "assets", label: "资产" },
];

function goalLine(goals: CharacterGoal[]): string {
  if (!goals.length) return "暂无目标";
  return goals.map((goal) => goal.label).join("、");
}

export function CharacterCard({ character }: { character: Character }) {
  const isProtagonist = character.role === "protagonist";
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        background: isProtagonist ? "#eef6ff" : "#ffffff",
        minWidth: 240,
        flex: 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 18 }}>{character.identity.name}</strong>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          {isProtagonist ? "主角" : "NPC"} · {character.state.age} 岁
        </span>
      </div>
      <div style={{ color: "#374151", fontSize: 14, marginTop: 4 }}>
        {character.state.city || "未知城市"} · {character.state.occupation || "未定身份"}
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
        {statLabels.map(({ key, label }) => {
          const value = character.state.stats[key];
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 40, fontSize: 13, color: "#6b7280" }}>{label}</span>
              <div style={{ flex: 1, height: 8, background: "#e5e7eb", borderRadius: 4 }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, value))}%`,
                    height: 8,
                    borderRadius: 4,
                    background: value >= 70 ? "#059669" : value >= 40 ? "#2563eb" : "#dc2626",
                  }}
                />
              </div>
              <span style={{ width: 28, fontSize: 13, textAlign: "right" }}>{value}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: "#4b5563" }}>
        目标：{goalLine(character.state.currentGoals)}
      </div>
      {character.state.currentDilemmas.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 13, color: "#b45309" }}>
          困境：{character.state.currentDilemmas.join("、")}
        </div>
      )}
    </div>
  );
}

export function CharacterPanel({ characters }: { characters: Character[] }) {
  return (
    <section>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>人物</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {characters.map((character) => (
          <CharacterCard key={character.id} character={character} />
        ))}
      </div>
    </section>
  );
}

const relationshipTypeLabels: Record<Relationship["type"], string> = {
  family: "家人",
  friend: "朋友",
  close_friend: "密友",
  classmate: "同学",
  coworker: "同事",
  partner: "伴侣",
  spouse: "配偶",
  ex_partner: "前任",
  rival: "对手",
  estranged: "疏远",
  other: "其他",
};

export function RelationshipCard({
  relationship,
  characters,
}: {
  relationship: Relationship;
  characters: Record<string, Character>;
}) {
  const a = characters[relationship.characterAId];
  const b = characters[relationship.characterBId];
  const name = (character?: Character) => character?.identity.name ?? "?";
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, minWidth: 240, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 15 }}>
          <strong>{name(a)}</strong> ↔ <strong>{name(b)}</strong>
        </span>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          {relationshipTypeLabels[relationship.type] || relationship.type}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563" }}>{relationship.publicSummary}</div>
      <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(
          [
            ["closeness", "亲密"],
            ["trust", "信任"],
            ["conflict", "冲突"],
            ["commitment", "承诺"],
          ] as const
        ).map(([key, label]) => (
          <span key={key} style={{ fontSize: 13, color: "#374151" }}>
            {label} <strong>{relationship.scores[key]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function RelationshipPanel({
  relationships,
  characters,
}: {
  relationships: Relationship[];
  characters: Record<string, Character>;
}) {
  return (
    <section>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>关系</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {relationships.map((relationship) => (
          <RelationshipCard
            key={relationship.id}
            relationship={relationship}
            characters={characters}
          />
        ))}
      </div>
    </section>
  );
}
