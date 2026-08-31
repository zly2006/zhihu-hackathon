"use client";

import { useCallback, useEffect, useState } from "react";
import type { Character } from "@/lib/domain/character";
import type { ChapterChoice, GameSave } from "@/lib/domain/chapter";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import type { WorldSimulationOutput } from "@/lib/domain/simulation";
import type { DecisionResolution } from "@/lib/domain/chapter";
import type { EvidenceBundle } from "@/lib/domain/experience";
import type { NpcDraft, ProtagonistDraft } from "@/lib/game/character-factory";
import { parseGameSave } from "@/lib/game/save";
import { ProtagonistSetup } from "./ProtagonistSetup";
import { NpcSetup } from "./NpcSetup";
import { CharacterPanel, RelationshipPanel } from "./CharacterPanel";
import { DecisionPanel, type ChapterSelection } from "./DecisionPanel";

const SAVE_KEY = "restart-life-save-v1";

type Screen = "landing" | "setup" | "npc_setup" | "chapter_start" | "decision";

type ProgressEvent = { stage?: string; message?: string };

type SimulateResult = {
  evidenceBundle: EvidenceBundle;
  resolution: DecisionResolution;
  simulation: WorldSimulationOutput;
  worldStateAfter: WorldState;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

// 通用 SSE 读取器：progress 走 onProgress，complete 返回 data，error 抛异常
async function readSseComplete<T>(response: Response, onProgress: (message: string) => void): Promise<T> {
  if (!response.body) throw new Error("服务未返回流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim()) continue;
      let event = "";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (event === "progress") {
        try {
          onProgress((JSON.parse(data) as ProgressEvent).message || "");
        } catch {
          /* ignore */
        }
      } else if (event === "complete") {
        return JSON.parse(data) as T;
      } else if (event === "error") {
        throw new Error((JSON.parse(data) as { message?: string }).message || "请求失败");
      }
    }
  }
  throw new Error("响应未完成");
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f9fafb",
  padding: "40px 20px",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  color: "#111827",
};

const cardStyle: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 28,
};

const anchorLabel: Record<string, string> = {
  favorable: "顺遂",
  mixed: "有得有失",
  setback: "受挫",
};

export function LifeApp() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [hasSave, setHasSave] = useState(false);
  const [save, setSave] = useState<GameSave | null>(null);
  const [protagonist, setProtagonist] = useState<Character | null>(null);
  const [npcs, setNpcs] = useState<NpcDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [span, setSpan] = useState<ChapterSpan>(1);
  const [choice, setChoice] = useState<ChapterChoice | null>(null);
  const [choiceProgress, setChoiceProgress] = useState("");
  const [selection, setSelection] = useState<ChapterSelection | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState("");
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);

  useEffect(() => {
    setHasSave(Boolean(window.localStorage.getItem(SAVE_KEY)));
  }, []);

  const handleGenerateNpcs = useCallback(async (draft: ProtagonistDraft) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/life/npc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protagonistDraft: draft }),
      });
      const data = await readJsonResponse<{ protagonist: Character; npcs: NpcDraft[] }>(response);
      setProtagonist(data.protagonist);
      setNpcs(data.npcs);
      setScreen("npc_setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "NPC 生成失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateLife = useCallback(
    async (finalNpcs: NpcDraft[]) => {
      if (!protagonist) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/life/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ protagonist, npcs: finalNpcs }),
        });
        const data = await readJsonResponse<{ gameSave: GameSave }>(response);
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(data.gameSave));
        setSave(data.gameSave);
        setScreen("chapter_start");
      } catch (err) {
        setError(err instanceof Error ? err.message : "人生创建失败");
      } finally {
        setLoading(false);
      }
    },
    [protagonist],
  );

  const handleContinue = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      setSave(parseGameSave(JSON.parse(raw)));
      setScreen("chapter_start");
    } catch (err) {
      setError(err instanceof Error ? err.message : "存档读取失败");
    }
  }, []);

  const handleStartChapter = useCallback(async () => {
    if (!save) return;
    setLoading(true);
    setError("");
    setChoiceProgress("正在生成本章困境…");
    try {
      const response = await fetch("/api/chapter/choices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldState: save.worldState, span }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error((payload as { error?: string } | null)?.error || "选择生成失败");
      }
      const generated = await readSseComplete<{ choice: ChapterChoice }>(response, setChoiceProgress);
      setChoice(generated.choice);
      setSelection(null);
      setSimResult(null);
      setScreen("decision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择生成失败");
    } finally {
      setLoading(false);
    }
  }, [save, span]);

  const handleSelect = useCallback(
    async (next: ChapterSelection) => {
      if (!save || !choice) return;
      setSelection(next);
      setSimulating(true);
      setSimProgress("正在推演本章世界…");
      try {
        const response = await fetch("/api/chapter/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            worldState: save.worldState,
            choice,
            selection: next,
            span,
            usedExperienceIds: [],
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error((payload as { error?: string } | null)?.error || "世界推演失败");
        }
        const result = await readSseComplete<SimulateResult>(response, setSimProgress);
        const updatedSave: GameSave = {
          ...save,
          worldState: result.worldStateAfter,
          savedAt: new Date().toISOString(),
        };
        setSave(updatedSave);
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(updatedSave));
        setSimResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "世界推演失败");
      } finally {
        setSimulating(false);
      }
    },
    [save, choice, span],
  );

  const handleNextChapter = useCallback(() => {
    setChoice(null);
    setSelection(null);
    setSimResult(null);
    setScreen("chapter_start");
  }, []);

  if (screen === "landing") {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>知乎 · 互动人生小说</h1>
          <p style={{ color: "#6b7280", margin: "0 0 24px", fontSize: 15 }}>
            以知乎真实人生经历为现实底座，由大模型推演你的长期人生与关系。
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 320, margin: "0 auto" }}>
            <button onClick={() => setScreen("setup")} style={primaryButton}>
              开始新人生
            </button>
            {hasSave && (
              <button onClick={handleContinue} style={secondaryButton}>
                继续上一次人生
              </button>
            )}
          </div>
          {error && <div style={{ color: "#dc2626", marginTop: 16, fontSize: 14 }}>{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <ProtagonistSetup onSubmit={handleGenerateNpcs} loading={loading} error={error} />
        </div>
      </div>
    );
  }

  if (screen === "npc_setup") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <NpcSetup
            npcs={npcs}
            protagonistName={protagonist?.identity.name ?? "主角"}
            onSubmit={handleCreateLife}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    );
  }

  if (screen === "decision" && choice) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          {!selection && <DecisionPanel choice={choice} onSelect={handleSelect} />}

          {selection && simulating && (
            <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>{simProgress}</div>
          )}

          {selection && simResult && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  本章结果：{anchorLabel[simResult.resolution.outcomeAnchor]}
                </h2>
                <span style={{ color: "#6b7280", fontSize: 13 }}>
                  有效风险 {simResult.resolution.effectiveRisk}
                </span>
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {simResult.simulation.events.map((event) => (
                  <div key={event.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>
                      {event.year}
                      {event.month ? `.${String(event.month).padStart(2, "0")}` : ""}
                    </div>
                    <strong>{event.title}</strong>
                    <div style={{ fontSize: 14, color: "#374151", marginTop: 4 }}>{event.summary}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
                本章推演参考了 {simResult.evidenceBundle.total} 条知乎真实经历
              </div>
              {error && <div style={{ color: "#dc2626", marginTop: 12, fontSize: 14 }}>{error}</div>}
              <button onClick={handleNextChapter} style={{ ...primaryButton, marginTop: 20, width: "100%" }}>
                进入下一章
              </button>
            </div>
          )}

          {selection && !simulating && !simResult && error && (
            <div style={{ color: "#dc2626", fontSize: 14, marginTop: 12 }}>{error}</div>
          )}
        </div>
      </div>
    );
  }

  // chapter_start
  const world = save?.worldState;
  const characters = world ? Object.values(world.characters) : [];
  const relationships = world ? Object.values(world.relationships) : [];
  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 1000 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>
            {world && world.chapterIds.length > 0 ? `第 ${world.chapterIds.length + 1} 章` : "第一章"} · 开始
          </h2>
          <span style={{ color: "#6b7280", fontSize: 14 }}>
            {world?.currentYear} 年 · 主角 {protagonist?.identity.name ?? ""} {world?.characters[world.protagonistId]?.state.age ?? 18} 岁
          </span>
        </div>
        {world && (
          <div style={{ display: "grid", gap: 24 }}>
            <CharacterPanel characters={characters} />
            <RelationshipPanel relationships={relationships} characters={world.characters} />
            <div style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, color: "#374151" }}>本章跨度：</span>
                  {([1, 3] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setSpan(value)}
                      style={{
                        padding: "6px 16px",
                        borderRadius: 8,
                        border: span === value ? "1px solid #2563eb" : "1px solid #d1d5db",
                        background: span === value ? "#2563eb" : "#fff",
                        color: span === value ? "#fff" : "#374151",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      {value} 年
                    </button>
                  ))}
                </div>
                <button onClick={handleStartChapter} disabled={loading} style={primaryButton}>
                  {loading ? choiceProgress || "生成中…" : "开始本章"}
                </button>
              </div>
              {error && <div style={{ color: "#dc2626", marginTop: 12, fontSize: 14 }}>{error}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  background: "#2563eb",
  color: "#fff",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  background: "#fff",
  color: "#2563eb",
  border: "1px solid #2563eb",
  fontSize: 16,
  cursor: "pointer",
};
