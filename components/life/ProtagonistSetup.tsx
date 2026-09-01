"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProtagonistDraft } from "@/lib/game/character-factory";
import type { Talents } from "@/lib/domain/shared";
import { AVATAR_PRESETS, findAvatarPreset } from "@/lib/game/avatar-registry";

const DRAFT_KEY = "restart-life-draft-v1";
export const TALENT_BUDGET = 250;
export const TALENT_MIN = 20;
export const TALENT_MAX = 80;
export const TALENT_STEP = 5;

const talentLabels: Array<{ key: keyof Talents; label: string }> = [
  { key: "insight", label: "洞察" },
  { key: "charm", label: "亲和" },
  { key: "grit", label: "韧性" },
  { key: "learning", label: "学习" },
  { key: "luck", label: "运气" },
];

const sections = [
  { id: "identity", label: "基本身份" },
  { id: "origin", label: "出身起点" },
  { id: "personality", label: "人格内核" },
  { id: "talents", label: "初始天赋" },
  { id: "confirm", label: "最终确认" },
] as const;

type SectionId = (typeof sections)[number]["id"];

const defaultTalents: Talents = { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 };

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
  const [talents, setTalents] = useState<Talents>(defaultTalents);
  const [avatarId, setAvatarId] = useState(AVATAR_PRESETS[0].id);
  const [activeSection, setActiveSection] = useState<SectionId>("identity");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<ProtagonistDraft> & { personalityTraits?: string[]; values?: string[]; avatarId?: string };
        if (draft.name) setName(draft.name);
        if (typeof draft.birthYear === "number") setBirthYear(draft.birthYear);
        if (draft.gender) setGender(draft.gender);
        if (draft.hometown) setHometown(draft.hometown);
        if (draft.familyBackground) setFamilyBackground(draft.familyBackground);
        if (draft.initialCity) setInitialCity(draft.initialCity);
        if (draft.initialDirection) setInitialDirection(draft.initialDirection);
        if (Array.isArray(draft.personalityTraits)) setPersonalityTraits(draft.personalityTraits.join("、"));
        if (Array.isArray(draft.values)) setValues(draft.values.join("、"));
        if (draft.longTermGoal) setLongTermGoal(draft.longTermGoal);
        if (draft.initialDilemma) setInitialDilemma(draft.initialDilemma);
        if (draft.talents) setTalents({ ...defaultTalents, ...draft.talents });
        if (draft.avatarId) setAvatarId(draft.avatarId);
      }
    } catch {
      /* 草稿损坏则忽略 */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft: ProtagonistDraft = {
        name,
        birthYear,
        gender,
        hometown,
        familyBackground,
        initialCity,
        initialDirection,
        personalityTraits: splitTags(personalityTraits),
        values: splitTags(values),
        longTermGoal,
        initialDilemma,
        talents,
        visualIdentity: { avatarSource: "preset", avatarId },
      };
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* 存储失败忽略 */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [name, birthYear, gender, hometown, familyBackground, initialCity, initialDirection, personalityTraits, values, longTermGoal, initialDilemma, talents, avatarId]);

  const budget = useMemo(() => Object.values(talents).reduce((sum, value) => sum + value, 0), [talents]);
  const traitCount = splitTags(personalityTraits).length;
  const valueCount = splitTags(values).length;

  const issues = useMemo(() => {
    const list: string[] = [];
    if (!name.trim()) list.push("姓名");
    if (!Number.isFinite(birthYear) || birthYear < 1950 || birthYear > 2026) list.push("出生年份（1950–2026）");
    if (traitCount < 3 || traitCount > 5) list.push(`性格标签 ${traitCount}/3-5`);
    if (valueCount < 2 || valueCount > 4) list.push(`价值观 ${valueCount}/2-4`);
    if (budget !== TALENT_BUDGET) list.push(`天赋预算 ${budget}/${TALENT_BUDGET}`);
    return list;
  }, [name, birthYear, traitCount, valueCount, budget]);

  const canSubmit = issues.length === 0 && !loading;

  function submit() {
    if (!canSubmit) return;
    const avatar = findAvatarPreset(avatarId);
    const draft: ProtagonistDraft = {
      name: name.trim(),
      birthYear,
      gender,
      hometown: hometown.trim(),
      familyBackground: familyBackground.trim(),
      initialCity: initialCity.trim(),
      initialDirection: initialDirection.trim(),
      personalityTraits: splitTags(personalityTraits),
      values: splitTags(values),
      longTermGoal: longTermGoal.trim(),
      initialDilemma: initialDilemma.trim(),
      talents,
      visualIdentity: {
        avatarSource: "preset",
        avatarId,
        avatarLabel: avatar?.label,
        fullPortrait: avatar?.fullPortrait,
      },
    };
    onSubmit(draft);
  }

  function clearDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
    setName("");
    setBirthYear(2008);
    setGender("男");
    setHometown("");
    setFamilyBackground("");
    setInitialCity("");
    setInitialDirection("");
    setPersonalityTraits("");
    setValues("");
    setLongTermGoal("");
    setInitialDilemma("");
    setTalents(defaultTalents);
    setAvatarId(AVATAR_PRESETS[0].id);
  }

  function changeTalent(key: keyof Talents, value: number) {
    setTalents((prev) => ({ ...prev, [key]: value }));
  }

  const avatar = findAvatarPreset(avatarId);

  return (
    <div className="life-vn" style={{ padding: "28px 20px 48px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <div>
            <h1 className="life-vn-title">序章 · 建立人生档案</h1>
            <p className="life-vn-sub" style={{ marginBottom: 0 }}>
              18 岁是起点，不是判决。完成后将生成三位与你有真实连接的核心关系。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="life-vn-btn ghost" onClick={clearDraft}>
              清空草稿
            </button>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr) 280px", gap: 18, alignItems: "start" }}>
          {/* 左侧进度栏 */}
          <nav className="life-vn-card" aria-label="创建进度" style={{ padding: 10 }}>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  setActiveSection(section.id);
                  document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "none",
                  textAlign: "left",
                  background: activeSection === section.id ? "rgba(216,155,88,.2)" : "transparent",
                  color: activeSection === section.id ? "var(--lv-gold-strong)" : "var(--lv-muted)",
                  fontSize: 13,
                }}
              >
                {section.label}
              </button>
            ))}
          </nav>

          {/* 中央表单 */}
          <div className="life-vn-grid">
            <section id="section-identity" className="life-vn-card">
              <h3 className="life-vn-hud-title">基本身份</h3>
              <div className="life-vn-form">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="life-vn-field">
                    <label>姓名 *</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="张明" />
                  </div>
                  <div className="life-vn-field">
                    <label>出生年份 *（18 岁 = 出生年 + 18）</label>
                    <input
                      type="number"
                      value={birthYear}
                      min={1950}
                      max={2026}
                      onChange={(e) => setBirthYear(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="life-vn-field">
                    <label>性别</label>
                    <select value={gender} onChange={(e) => setGender(e.target.value)}>
                      <option>男</option>
                      <option>女</option>
                      <option>其他</option>
                    </select>
                  </div>
                  <div className="life-vn-field">
                    <label>家乡</label>
                    <input value={hometown} onChange={(e) => setHometown(e.target.value)} placeholder="武汉" />
                  </div>
                </div>
                <div className="life-vn-field">
                  <label>选择人物头像 <em>*</em></label>
                  <span className="hint">只代表视觉身份，不推断人格。</span>
                  <div className="life-vn-avatar-grid" style={{ marginTop: 8 }} role="radiogroup" aria-label="预设人物头像">
                    {AVATAR_PRESETS.map((preset) => (
                      <label key={preset.id} className={`life-vn-avatar-option${preset.fullPortrait ? " full" : ""}${avatarId === preset.id ? " selected" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preset.src}
                          alt={`${preset.label}头像`}
                          onClick={() => setAvatarId(preset.id)}
                        />
                        <small>{preset.label}</small>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section id="section-origin" className="life-vn-card">
              <h3 className="life-vn-hud-title">出身起点</h3>
              <div className="life-vn-form">
                <div className="life-vn-field">
                  <label>家庭背景</label>
                  <input value={familyBackground} onChange={(e) => setFamilyBackground(e.target.value)} placeholder="普通工薪家庭" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="life-vn-field">
                    <label>初始城市</label>
                    <input value={initialCity} onChange={(e) => setInitialCity(e.target.value)} placeholder="深圳" />
                  </div>
                  <div className="life-vn-field">
                    <label>起点方向</label>
                    <input value={initialDirection} onChange={(e) => setInitialDirection(e.target.value)} placeholder="程序员 / 学生 / 待业" />
                  </div>
                </div>
              </div>
            </section>

            <section id="section-personality" className="life-vn-card">
              <h3 className="life-vn-hud-title">人格内核</h3>
              <div className="life-vn-form">
                <div className="life-vn-field">
                  <label>性格标签（3–5 个，逗号分隔）*</label>
                  <input value={personalityTraits} onChange={(e) => setPersonalityTraits(e.target.value)} placeholder="谨慎、务实、念旧" />
                  <span className="hint">当前 {traitCount} 个</span>
                </div>
                <div className="life-vn-field">
                  <label>价值观（2–4 个，逗号分隔）*</label>
                  <input value={values} onChange={(e) => setValues(e.target.value)} placeholder="稳定、家庭" />
                  <span className="hint">当前 {valueCount} 个</span>
                </div>
                <div className="life-vn-field">
                  <label>长期目标</label>
                  <input value={longTermGoal} onChange={(e) => setLongTermGoal(e.target.value)} placeholder="在大城市立足" />
                </div>
                <div className="life-vn-field">
                  <label>初始困境</label>
                  <input value={initialDilemma} onChange={(e) => setInitialDilemma(e.target.value)} placeholder="毕业即面临就业压力" />
                </div>
              </div>
            </section>

            <section id="section-talents" className="life-vn-card">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <h3 className="life-vn-hud-title">初始天赋</h3>
                <span className="life-vn-pill" style={{ color: budget === TALENT_BUDGET ? "var(--lv-green)" : "var(--lv-rose)" }}>
                  预算 {budget}/{TALENT_BUDGET}
                </span>
              </div>
              <p style={{ color: "var(--lv-muted)", fontSize: 11, margin: "0 0 12px" }}>
                每项 {TALENT_MIN}–{TALENT_MAX}，步长 {TALENT_STEP}，总计须为 {TALENT_BUDGET}。
              </p>
              <div className="life-vn-form">
                {talentLabels.map(({ key, label }) => (
                  <div className="life-vn-talent-row" key={key}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min={TALENT_MIN}
                      max={TALENT_MAX}
                      step={TALENT_STEP}
                      value={talents[key]}
                      onChange={(e) => changeTalent(key, Number(e.target.value))}
                    />
                    <b style={{ textAlign: "right" }}>{talents[key]}</b>
                  </div>
                ))}
              </div>
            </section>

            <section id="section-confirm" className="life-vn-card">
              <h3 className="life-vn-hud-title">最终确认</h3>
              {issues.length > 0 && (
                <div className="life-vn-error" style={{ marginBottom: 12 }}>
                  还需要确认：{issues.join("、")}
                </div>
              )}
              {error && <div className="life-vn-error" style={{ marginBottom: 12 }}>{error}</div>}
              <button type="button" className="life-vn-btn" onClick={submit} disabled={!canSubmit} style={{ width: "100%" }}>
                {loading ? "正在生成三位核心关系…" : "生成三位核心关系"}
              </button>
            </section>
          </div>

          {/* 右侧实时预览 */}
          <aside className="life-vn-card" aria-label="主角档案预览" style={{ position: "sticky", top: 20 }}>
            <h3 className="life-vn-hud-title">人生档案</h3>
            {avatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar.src}
                alt={`${avatar.label}头像`}
                style={{
                  width: "100%",
                  aspectRatio: "4/5",
                  objectFit: "cover",
                  borderRadius: 12,
                  border: "1px solid var(--lv-gold-line)",
                  background: "#eadfc8",
                  marginBottom: 12,
                }}
              />
            )}
            <div className="life-vn-grid">
              <div>
                <b style={{ fontSize: 17 }}>{name.trim() || "未命名主角"}</b>
                <div style={{ color: "var(--lv-muted)", fontSize: 12, marginTop: 2 }}>
                  {birthYear + 18} 岁 · 起始 {birthYear + 18} 年
                </div>
              </div>
              <div style={{ color: "var(--lv-muted)", fontSize: 12, lineHeight: 1.8 }}>
                <div>城市：{initialCity || "—"}</div>
                <div>方向：{initialDirection || "—"}</div>
                <div>人格：{splitTags(personalityTraits).join("、") || "—"}</div>
                <div>目标：{longTermGoal || "—"}</div>
                <div>困境：{initialDilemma || "—"}</div>
                <div>
                  天赋：
                  {talentLabels.map(({ key, label }) => `${label} ${talents[key]}`).join(" · ")}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function splitTags(input: string): string[] {
  return input
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
