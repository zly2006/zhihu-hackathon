"use client";

import { useState } from "react";
import type { NpcDraft } from "@/lib/game/character-factory";
import type { RelationshipType } from "@/lib/domain/relationship";

const relationshipTypeOptions: Array<{ value: RelationshipType; label: string }> = [
  { value: "family", label: "家人" },
  { value: "friend", label: "朋友" },
  { value: "close_friend", label: "密友" },
  { value: "classmate", label: "同学" },
  { value: "coworker", label: "同事" },
  { value: "partner", label: "伴侣" },
  { value: "rival", label: "对手" },
  { value: "other", label: "其他" },
];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

export function NpcSetup({
  npcs,
  protagonistName,
  onSubmit,
  loading,
  error,
}: {
  npcs: NpcDraft[];
  protagonistName: string;
  onSubmit: (npcs: NpcDraft[]) => void;
  loading: boolean;
  error: string;
}) {
  const [drafts, setDrafts] = useState<NpcDraft[]>(npcs);

  function update(index: number, patch: Partial<NpcDraft>) {
    setDrafts((prev) => prev.map((npc, i) => (i === index ? { ...npc, ...patch } : npc)));
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>确认你的 3 个核心 NPC</h2>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>
        围绕 {protagonistName} 的人生生成。你可以修改名字、关系类型和一句公开设定；NPC 的隐藏想法不可见也不可修改。
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {drafts.map((npc, index) => (
          <div key={index} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, color: "#4b5563", display: "block", marginBottom: 4 }}>名字</label>
                <input style={fieldStyle} value={npc.name} onChange={(e) => update(index, { name: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#4b5563", display: "block", marginBottom: 4 }}>关系类型</label>
                <select
                  style={fieldStyle}
                  value={npc.relationshipType}
                  onChange={(e) => update(index, { relationshipType: e.target.value as RelationshipType })}
                >
                  {relationshipTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 13, color: "#4b5563", display: "block", marginBottom: 4 }}>一句公开设定</label>
              <input
                style={fieldStyle}
                value={npc.basicSetting}
                onChange={(e) => update(index, { basicSetting: e.target.value })}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#9ca3af" }}>
              {npc.gender} · {npc.age} 岁
              {npc.personalityTraits.length > 0 && ` · ${npc.personalityTraits.join("、")}`}
            </div>
          </div>
        ))}
      </div>
      {error && <div style={{ color: "#dc2626", fontSize: 14, marginTop: 12 }}>{error}</div>}
      <button
        onClick={() => onSubmit(drafts)}
        disabled={loading}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "12px 16px",
          borderRadius: 10,
          background: "#059669",
          color: "#fff",
          border: "none",
          fontSize: 16,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "正在创建人生…" : "开始这段人生"}
      </button>
    </div>
  );
}
