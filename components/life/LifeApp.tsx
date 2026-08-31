"use client";

import { useCallback, useEffect, useState } from "react";
import type { Character } from "@/lib/domain/character";
import type { GameSave } from "@/lib/domain/chapter";
import type { NpcDraft, ProtagonistDraft } from "@/lib/game/character-factory";
import { parseGameSave } from "@/lib/game/save";
import { ProtagonistSetup } from "./ProtagonistSetup";
import { NpcSetup } from "./NpcSetup";
import { CharacterPanel, RelationshipPanel } from "./CharacterPanel";

const SAVE_KEY = "restart-life-save-v1";

type Screen = "landing" | "setup" | "npc_setup" | "chapter_start";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  return payload;
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

export function LifeApp() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [hasSave, setHasSave] = useState(false);
  const [save, setSave] = useState<GameSave | null>(null);
  const [protagonistDraft, setProtagonistDraft] = useState<ProtagonistDraft | null>(null);
  const [protagonist, setProtagonist] = useState<Character | null>(null);
  const [npcs, setNpcs] = useState<NpcDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      setProtagonistDraft(draft);
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

  if (screen === "landing") {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>知乎 · 互动人生小说</h1>
          <p style={{ color: "#6b7280", margin: "0 0 24px", fontSize: 15 }}>
            以知乎真实人生经历为现实底座，由大模型推演你的长期人生与关系。
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 320, margin: "0 auto" }}>
            <button
              onClick={() => setScreen("setup")}
              style={primaryButton}
            >
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

  // chapter_start
  const world = save?.worldState;
  const characters = world ? Object.values(world.characters) : [];
  const relationships = world ? Object.values(world.relationships) : [];
  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 1000 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>第一章 · 开始</h2>
          <span style={{ color: "#6b7280", fontSize: 14 }}>
            {world?.currentYear} 年 · 主角 {protagonist?.identity.name ?? ""} 18 岁
          </span>
        </div>
        {world && (
          <div style={{ display: "grid", gap: 24 }}>
            <CharacterPanel characters={characters} />
            <RelationshipPanel relationships={relationships} characters={world.characters} />
            <div style={{ textAlign: "center", padding: 16, border: "1px dashed #d1d5db", borderRadius: 12, color: "#6b7280", fontSize: 14 }}>
              章节推进（困境 + 三选一 + 世界推演）将在 Phase 2 实现
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
