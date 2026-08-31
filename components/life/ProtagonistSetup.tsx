"use client";

import { useState } from "react";
import type { ProtagonistDraft } from "@/lib/game/character-factory";
import type { Talents } from "@/lib/domain/shared";

const talentLabels: Array<{ key: keyof Talents; label: string }> = [
  { key: "insight", label: "洞察" },
  { key: "charm", label: "亲和" },
  { key: "grit", label: "韧性" },
  { key: "learning", label: "学习" },
  { key: "luck", label: "运气" },
];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = { fontSize: 13, color: "#4b5563", display: "block", marginBottom: 4 };

export function ProtagonistSetup({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (draft: ProtagonistDraft) => void;
  loading: boolean;
  error: string;
}) {
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState(2008);
  const [gender, setGender] = useState("男");
  const [hometown, setHometown] = useState("");
  const [familyBackground, setFamilyBackground] = useState("");
  const [initialCity, setInitialCity] = useState("");
  const [initialDirection, setInitialDirection] = useState("");
  const [personalityTraits, setPersonalityTraits] = useState("");
  const [values, setValues] = useState("");
  const [longTermGoal, setLongTermGoal] = useState("");
  const [initialDilemma, setInitialDilemma] = useState("");
  const [talents, setTalents] = useState<Talents>({
    insight: 50,
    charm: 50,
    grit: 50,
    learning: 50,
    luck: 50,
  });

  function submit() {
    const draft: ProtagonistDraft = {
      name,
      birthYear,
      gender,
      hometown,
      familyBackground,
      initialCity,
      initialDirection,
      personalityTraits: personalityTraits
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
      values: values
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
      longTermGoal,
      initialDilemma,
      talents,
    };
    onSubmit(draft);
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>创建你的主角</h2>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>
        主角将从 18 岁开始，系统会据此生成 3 个与你人生有关联的 NPC。
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>姓名</label>
            <input style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="张明" />
          </div>
          <div>
            <label style={labelStyle}>出生年份（18 岁 = 出生年 + 18）</label>
            <input
              style={fieldStyle}
              type="number"
              value={birthYear}
              onChange={(e) => setBirthYear(Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>性别</label>
            <select style={fieldStyle} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option>男</option>
              <option>女</option>
              <option>其他</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>家乡</label>
            <input style={fieldStyle} value={hometown} onChange={(e) => setHometown(e.target.value)} placeholder="武汉" />
          </div>
        </div>
        <div>
          <label style={labelStyle}>家庭背景</label>
          <input
            style={fieldStyle}
            value={familyBackground}
            onChange={(e) => setFamilyBackground(e.target.value)}
            placeholder="普通工薪家庭"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>初始城市</label>
            <input style={fieldStyle} value={initialCity} onChange={(e) => setInitialCity(e.target.value)} placeholder="深圳" />
          </div>
          <div>
            <label style={labelStyle}>起点方向</label>
            <input
              style={fieldStyle}
              value={initialDirection}
              onChange={(e) => setInitialDirection(e.target.value)}
              placeholder="程序员 / 学生 / 待业"
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>性格标签（3–5 个，逗号分隔）</label>
          <input
            style={fieldStyle}
            value={personalityTraits}
            onChange={(e) => setPersonalityTraits(e.target.value)}
            placeholder="谨慎、务实、念旧"
          />
        </div>
        <div>
          <label style={labelStyle}>价值观（2–4 个，逗号分隔）</label>
          <input
            style={fieldStyle}
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder="稳定、家庭"
          />
        </div>
        <div>
          <label style={labelStyle}>长期目标</label>
          <input
            style={fieldStyle}
            value={longTermGoal}
            onChange={(e) => setLongTermGoal(e.target.value)}
            placeholder="在大城市立足"
          />
        </div>
        <div>
          <label style={labelStyle}>初始困境</label>
          <input
            style={fieldStyle}
            value={initialDilemma}
            onChange={(e) => setInitialDilemma(e.target.value)}
            placeholder="毕业即面临就业压力"
          />
        </div>
        <div>
          <label style={{ ...labelStyle, marginBottom: 8 }}>天赋点数（0–100）</label>
          <div style={{ display: "grid", gap: 8 }}>
            {talentLabels.map(({ key, label }) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 40, fontSize: 13, color: "#4b5563" }}>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={talents[key]}
                  onChange={(e) => setTalents((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <span style={{ width: 28, fontSize: 13, textAlign: "right" }}>{talents[key]}</span>
              </div>
            ))}
          </div>
        </div>
        {error && <div style={{ color: "#dc2626", fontSize: 14 }}>{error}</div>}
        <button
          onClick={submit}
          disabled={loading}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            background: "#2563eb",
            color: "#fff",
            border: "none",
            fontSize: 16,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "正在生成 NPC…" : "生成 3 个核心 NPC"}
        </button>
      </div>
    </div>
  );
}
