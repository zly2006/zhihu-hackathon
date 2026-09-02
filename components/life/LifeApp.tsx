"use client";

import { useCallback, useEffect, useState } from "react";
import type { Character } from "@/lib/domain/character";
import type {
  Chapter,
  ChapterChoice,
  ChapterDecision,
  DecisionResolution,
  GameSave,
} from "@/lib/domain/chapter";
import type { ChapterSpan } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import type { WorldSimulationOutput } from "@/lib/domain/simulation";
import type { EvidenceBundle, LifeExperience } from "@/lib/domain/experience";
import type { NpcDraft, ProtagonistDraft } from "@/lib/game/character-factory";
import type { NarrativeEvidenceBundle, NarrativePlan, NarrativeReference } from "@/lib/domain/narrative";
import { parseGameSave } from "@/lib/game/save";
import { buildLifePresentation } from "@/lib/game/presentation";
import { findScene, DEFAULT_SCENE_ID } from "@/lib/game/scene-catalog";
import { ProtagonistSetup } from "./ProtagonistSetup";
import { NpcSetup } from "./NpcSetup";
import { ChapterSummary } from "./ChapterSummary";
import { LifeShell } from "@/components/life-vn/LifeShell";
import { SceneStage } from "@/components/life-vn/SceneStage";
import { DialogueBox } from "@/components/life-vn/DialogueBox";
import { PlayerHud } from "@/components/life-vn/PlayerHud";
import { RelationshipHud } from "@/components/life-vn/RelationshipHud";

const SAVE_KEY = "restart-life-save-v1";

type Screen = "landing" | "setup" | "npc_setup" | "chapter_start" | "decision" | "chapter_summary";

type ProgressEvent = { stage?: string; message?: string };

type SimulateResult = {
  chapterId: string;
  evidenceBundle: EvidenceBundle;
  resolution: DecisionResolution;
  simulation: WorldSimulationOutput;
  worldStateAfter: WorldState;
  stateBeforeHash: string;
  stateAfterHash: string;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

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

function persist(save: GameSave) {
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

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
  const [selection, setSelection] = useState<{ optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState("");
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [preWorld, setPreWorld] = useState<WorldState | null>(null);
  const [novelLoading, setNovelLoading] = useState(false);
  const [planProgress, setPlanProgress] = useState("");
  const [planResult, setPlanResult] = useState<{ narrativePlan: NarrativePlan; narrativeEvidence: NarrativeEvidenceBundle } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  useEffect(() => {
    setHasSave(Boolean(window.localStorage.getItem(SAVE_KEY)));
  }, []);

  // 测试可观测接口：只暴露玩家可见信息，绝不输出 NPC privateState。
  useEffect(() => {
    const world = save?.worldState;
    const hero = world ? world.characters[world.protagonistId] : null;
    (window as unknown as Record<string, unknown>).render_game_to_text = () =>
      JSON.stringify({
        screen,
        year: world?.currentYear,
        chapterIndex: world?.chapterIds.length ?? 0,
        protagonist: hero
          ? {
              name: hero.identity.name,
              age: hero.state.age,
              occupation: hero.state.occupation,
              stats: hero.state.stats,
              goals: hero.state.currentGoals,
            }
          : null,
        visibleNpcs: world
          ? Object.values(world.characters)
              .filter((item) => item.role === "npc")
              .map((item) => ({ name: item.identity.name, occupation: item.state.occupation }))
          : [],
        visibleRelationships: world
          ? Object.values(world.relationships).map((rel) => ({
              type: rel.type,
              closeness: rel.scores.closeness,
              conflict: rel.scores.conflict,
            }))
          : [],
        activeDecision: choice
          ? {
              promptTitle: choice.promptTitle,
              options: choice.options.map((option) => option.label),
              selectedOptionId: selection?.optionId ?? null,
            }
          : null,
        activePlan: chapter?.narrative
          ? {
              theme: chapter.narrative.plan.theme,
              mainConflict: chapter.narrative.plan.mainConflict,
              sceneCount: chapter.narrative.plan.scenes.length,
              referenceFragmentIds: chapter.narrative.referenceFragmentIds,
            }
          : null,
        reflectionCount: save?.worldState.reflections
          ? Object.keys(save.worldState.reflections).length
          : 0,
        activeScene: chapter ? { index: chapter.index, title: chapter.novel.title } : null,
        loading,
        error,
      });
  }, [screen, save, choice, selection, loading, error, chapter]);

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
        persist(data.gameSave);
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
      setChapter(null);
      setPlanResult(null);
      setPlanProgress("");
      setCustomOpen(false);
      setCustomText("");
      setScreen("decision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择生成失败");
    } finally {
      setLoading(false);
    }
  }, [save, span]);

  const handleSelect = useCallback(
    async (next: { optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string }) => {
      if (!save || !choice) return;
      setSelection(next);
      setSimulating(true);
      setSimProgress("正在推演本章世界…");
      const worldBefore = save.worldState;
      setPreWorld(worldBefore);
      try {
        const response = await fetch("/api/chapter/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            worldState: worldBefore,
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
        setSimResult(result);

        // 自动存档节点 4：canonical simulation 完成（反思结果随后覆盖，见下）
        let saveBase: GameSave = {
          ...save,
          worldState: result.worldStateAfter,
          savedAt: new Date().toISOString(),
        };
        setSave(saveBase);
        persist(saveBase);

        // 生成小说（自动存档节点 5）
        setNovelLoading(true);
        try {
          // V1.1 叙事规划 ∥ V1.2 角色反思 并行（两者互不依赖，省一段串行等待；
          // 任一失败均自动降级，不阻断、不修改 canonical）
          let narrativePlan: NarrativePlan | undefined;
          let narrativeReferences: NarrativeReference[] = [];
          try {
            const decision = buildChapterDecision(choice, next);
            setPlanProgress("正在规划本章叙事…");
            const planFetch = (async () => {
              const planResponse = await fetch("/api/chapter/narrative-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chapterId: result.chapterId,
                  stateBefore: worldBefore,
                  events: result.simulation.events,
                  decision,
                  span,
                }),
              });
              if (!planResponse.ok) throw new Error(`HTTP ${planResponse.status}`);
              const planData = await readSseComplete<{
                narrativePlan: NarrativePlan;
                narrativeEvidence: NarrativeEvidenceBundle;
              }>(planResponse, setPlanProgress);
              return {
                narrativePlan: planData.narrativePlan,
                narrativeReferences: [
                  ...planData.narrativeEvidence.arcPatterns,
                  ...planData.narrativeEvidence.scenePatterns,
                  ...planData.narrativeEvidence.dialoguePatterns,
                  ...planData.narrativeEvidence.pacingPatterns,
                  ...planData.narrativeEvidence.endingPatterns,
                ],
                evidence: planData.narrativeEvidence,
              };
            })();
            const reflectionFetch = (async () => {
              const reflectionResponse = await fetch("/api/chapter/reflections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chapterId: result.chapterId,
                  worldBefore,
                  worldAfter: result.worldStateAfter,
                  events: result.simulation.events,
                }),
              });
              if (!reflectionResponse.ok) throw new Error(`HTTP ${reflectionResponse.status}`);
              return await readJsonResponse<{ worldStateAfter: WorldState; reflectionCount: number }>(
                reflectionResponse,
              );
            })();
            const [planOutcome, reflectionOutcome] = await Promise.all([
              planFetch.catch((planError) => {
                console.warn("narrative plan fallback:", planError instanceof Error ? planError.message : planError);
                return null;
              }),
              reflectionFetch.catch((reflectionError) => {
                console.warn("reflection fallback:", reflectionError instanceof Error ? reflectionError.message : reflectionError);
                return null;
              }),
            ]);
            if (planOutcome) {
              narrativePlan = planOutcome.narrativePlan;
              narrativeReferences = planOutcome.narrativeReferences;
              setPlanResult({ narrativePlan: planOutcome.narrativePlan, narrativeEvidence: planOutcome.evidence });
            }
            if (reflectionOutcome?.worldStateAfter) {
              saveBase = { ...saveBase, worldState: reflectionOutcome.worldStateAfter, savedAt: new Date().toISOString() };
              setSave(saveBase);
              persist(saveBase);
            }
          } catch (parallelError) {
            console.warn("narrative/reflection parallel stage failed:", parallelError);
          }
          const novel = await fetchNovel(result, worldBefore, span, 1, narrativePlan, narrativeReferences);
          const chapter = assembleChapter({
            choice,
            selection: next,
            span,
            worldBefore,
            result,
            novel,
            narrativePlan,
            worldStateAfter: saveBase.worldState,
          });
          setChapter(chapter);
          const finalSave: GameSave = {
            ...saveBase,
            chapters: { ...saveBase.chapters, [chapter.id]: chapter },
            events: {
              ...saveBase.events,
              ...Object.fromEntries(result.simulation.events.map((event) => [event.id, event])),
            },
            experienceCache: {
              ...saveBase.experienceCache,
              ...Object.fromEntries(allEvidence(result.evidenceBundle).map((e) => [e.id, e])),
            },
            savedAt: new Date().toISOString(),
          };
          setSave(finalSave);
          persist(finalSave);
          setScreen("chapter_summary");
        } catch (err) {
          setError(err instanceof Error ? err.message : "小说生成失败");
        } finally {
          setNovelLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "世界推演失败");
      } finally {
        setSimulating(false);
      }
    },
    [save, choice, span],
  );

  const handleRegenerateNovel = useCallback(async () => {
    if (!chapter || !simResult || !preWorld) return;
    setNovelLoading(true);
    setError("");
    try {
      // 重写不触发 World Simulator，也不重新规划：沿用已保存的 Director 规划（如有）
      const novel = await fetchNovel(
        simResult,
        preWorld,
        span,
        chapter.novel.version + 1,
        chapter.narrative?.plan,
        [],
      );
      const updatedChapter: Chapter = { ...chapter, novel };
      setChapter(updatedChapter);
      setSave((prev) => {
        if (!prev) return prev;
        const next: GameSave = {
          ...prev,
          chapters: { ...prev.chapters, [updatedChapter.id]: updatedChapter },
          savedAt: new Date().toISOString(),
        };
        persist(next);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "小说重写失败");
    } finally {
      setNovelLoading(false);
    }
  }, [chapter, simResult, preWorld, span]);

  const handleNextChapter = useCallback(() => {
    setChoice(null);
    setSelection(null);
    setSimResult(null);
    setChapter(null);
    setPreWorld(null);
    setPlanResult(null);
    setPlanProgress("");
    setCustomOpen(false);
    setCustomText("");
    setScreen("chapter_start");
  }, []);

  // ---------- 各屏幕 ----------
  if (screen === "landing") {
    return (
      <div className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div className="life-vn-card" style={{ maxWidth: 520, width: "100%", textAlign: "center", padding: 40 }}>
          <h1 className="life-vn-title" style={{ fontSize: 30 }}>
            知乎 · 互动人生小说
          </h1>
          <p className="life-vn-sub">
            以知乎真实人生经历为现实底座，由大模型推演你的长期人生与关系。
          </p>
          <div style={{ display: "grid", gap: 12, maxWidth: 320, margin: "0 auto" }}>
            <button type="button" className="life-vn-btn" onClick={() => setScreen("setup")}>
              开始新人生
            </button>
            {hasSave && (
              <button type="button" className="life-vn-btn ghost" onClick={handleContinue}>
                继续上一次人生
              </button>
            )}
          </div>
          {error && <div className="life-vn-error" style={{ marginTop: 16 }}>{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return <ProtagonistSetup onSubmit={handleGenerateNpcs} loading={loading} error={error} />;
  }

  if (screen === "npc_setup") {
    return (
      <div className="life-vn" style={{ padding: "32px 20px 48px" }}>
        <div className="life-vn-card" style={{ maxWidth: 860, margin: "0 auto" }}>
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

  const world = save?.worldState;
  const presentation = world
    ? buildLifePresentation({ world, chapter, chapterEvents: simResult?.simulation.events })
    : null;
  const hero = world ? world.characters[world.protagonistId] : null;
  const pastChapters = save ? Object.values(save.chapters).sort((a, b) => a.index - b.index) : [];

  if (screen === "decision" && choice && presentation && world) {
    const sceneDef = findScene(DEFAULT_SCENE_ID) as NonNullable<ReturnType<typeof findScene>>;
    const options = choice.options.map((option) => ({ id: option.id, label: option.label }));
    const feedback = selection
      ? ""
      : "选择将影响这一年的走向——你决定行动，系统决定后果。";
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(presentation.chapter.index + 1).padStart(2, "0")}`}
        title={choice.promptTitle}
        yearRange={presentation.chapter.yearRange}
        left={
          <div className="life-vn-timeline">
            {pastChapters.map((past) => (
              <div className="life-vn-tl-entry" key={past.id}>
                <small>
                  第 {String(past.index + 1).padStart(2, "0")} 章 · {past.startYear}—{past.endYear}
                </small>
                <h3>{past.novel.title}</h3>
              </div>
            ))}
            <div className="life-vn-tl-entry active">
              <small>本章 · 抉择</small>
              <h3>{choice.promptTitle}</h3>
            </div>
          </div>
        }
        right={
          <>
            <PlayerHud
              presentation={presentation.protagonist}
              goals={hero?.state.currentGoals ?? []}
              dilemmas={hero?.state.currentDilemmas ?? []}
            />
            <RelationshipHud relationships={presentation.relationships} />
          </>
        }
        center={
          <SceneStage
            scene={sceneDef}
            meta={`${world.currentYear} 年 · ${hero?.state.city || "未知"} · 夜`}
            portraitUrl={presentation.protagonist.avatarUrl}
            children={
              <DialogueBox
                copy={choice.context}
                options={selection ? undefined : options}
                selectedOptionId={selection?.optionId ?? null}
                feedback={feedback}
                onSelect={(id) => handleSelect({ optionId: id })}
                children={
                  selection ? (
                    simulating ? (
                      <div className="life-vn-feedback">{simProgress}</div>
                    ) : novelLoading ? (
                      <div className="life-vn-feedback">{planProgress || "正在把本章写成小说…"}</div>
                    ) : error ? (
                      <div className="life-vn-error">{error}</div>
                    ) : null
                  ) : customOpen ? (
                    <div style={{ display: "grid", gap: 8, paddingTop: 10 }}>
                      <textarea
                        value={customText}
                        onChange={(e) => setCustomText(e.target.value)}
                        placeholder="描述你自定义的行动…"
                        rows={2}
                        style={{
                          width: "100%",
                          padding: 9,
                          borderRadius: 8,
                          border: "1px solid var(--lv-gold-line)",
                          fontSize: 13,
                          background: "rgba(255,252,244,.9)",
                        }}
                      />
                      <button
                        type="button"
                        className="life-vn-btn"
                        onClick={() => {
                          if (customText.trim()) {
                            handleSelect({ optionId: "CUSTOM", customAction: customText.trim() });
                          }
                        }}
                      >
                        确认自定义行动
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button type="button" className="life-vn-btn ghost" onClick={() => setCustomOpen(true)}>
                        ✎ 自定义行动
                      </button>
                    </div>
                  )
                }
              />
            }
          />
        }
      />
    );
  }

  if (screen === "chapter_summary" && chapter && simResult && presentation && world) {
    const events = chapter.simulationEventIds
      .map((id) => save?.events[id])
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const evidence = chapter.evidence.featuredExperienceIds
      .map((id) => save?.experienceCache[id])
      .filter((e): e is LifeExperience => Boolean(e));
    return (
      <ChapterSummary
        chapter={chapter}
        events={events}
        resolution={simResult.resolution}
        evidence={evidence}
        evidenceTotal={simResult.evidenceBundle.total}
        onRegenerate={handleRegenerateNovel}
        onNextChapter={handleNextChapter}
        regenerating={novelLoading}
        world={world}
        pastChapters={pastChapters}
      />
    );
  }

  // chapter_start
  if (presentation && world) {
    const sceneDef = findScene("urban-home-apartment-day-v1") as NonNullable<ReturnType<typeof findScene>>;
    const chapterNumber = world.chapterIds.length > 0 ? world.chapterIds.length + 1 : 1;
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(chapterNumber).padStart(2, "0")}`}
        title={world.chapterIds.length > 0 ? `第 ${chapterNumber} 章 · 开始` : "第一章 · 开始"}
        yearRange={`${world.currentYear} 年起`}
        left={
          <div className="life-vn-timeline">
            {pastChapters.map((past) => (
              <div className="life-vn-tl-entry" key={past.id}>
                <small>
                  第 {String(past.index + 1).padStart(2, "0")} 章 · {past.startYear}—{past.endYear}
                </small>
                <h3>{past.novel.title}</h3>
                <p>{past.summary.keyEvents.slice(0, 2).join("；")}</p>
              </div>
            ))}
            <div className="life-vn-tl-entry active">
              <small>本章 · 起点</small>
              <h3>{world.currentYear} 年</h3>
            </div>
          </div>
        }
        right={
          <>
            <PlayerHud
              presentation={presentation.protagonist}
              goals={hero?.state.currentGoals ?? []}
              dilemmas={hero?.state.currentDilemmas ?? []}
            />
            <RelationshipHud relationships={presentation.relationships} />
          </>
        }
        center={
          <SceneStage
            scene={sceneDef}
            meta={`${world.currentYear} 年 · ${hero?.state.city || "未知"} · 日`}
            portraitUrl={presentation.protagonist.avatarUrl}
            children={
              <DialogueBox
                copy={`${hero?.identity.name ?? "你"}，${hero?.state.age ?? 18} 岁，在${hero?.state.city || "一座城市"}开始了新的人生。选择本章跨度，然后开始这一章。`}
                children={
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {([1, 3] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="life-vn-btn ghost"
                        style={span === value ? { borderColor: "var(--lv-gold-strong)", color: "var(--lv-gold-strong)" } : undefined}
                        onClick={() => setSpan(value)}
                      >
                        {value} 年 / 章
                      </button>
                    ))}
                    <button
                      type="button"
                      className="life-vn-btn"
                      onClick={handleStartChapter}
                      disabled={loading}
                      style={{ marginLeft: "auto" }}
                    >
                      {loading ? choiceProgress || "生成中…" : "开始本章"}
                    </button>
                  </div>
                }
              />
            }
          />
        }
      />
    );
  }

  // 兜底：存档未就绪
  return (
    <div className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div className="life-vn-card" style={{ textAlign: "center" }}>
        <p>存档尚未就绪。</p>
        <button type="button" className="life-vn-btn ghost" onClick={() => setScreen("landing")}>
          返回首页
        </button>
      </div>
    </div>
  );
}

async function fetchNovel(
  result: SimulateResult,
  worldBefore: WorldState,
  span: ChapterSpan,
  version: number,
  narrativePlan?: NarrativePlan,
  narrativeReferences: NarrativeReference[] = [],
): Promise<Chapter["novel"]> {
  const featuredEvidence = [
    ...result.evidenceBundle.decisionSimilar,
    ...result.evidenceBundle.outcomeContrasts,
    ...result.evidenceBundle.backgroundSimilar,
  ].slice(0, 5);
  const relevantMemories = Object.values(worldBefore.memories).slice(-3);
  const response = await fetch("/api/chapter/novel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stateBefore: worldBefore,
      events: result.simulation.events,
      relevantMemories,
      featuredEvidence,
      span,
      version,
      narrativePlan,
      narrativeReferences,
    }),
  });
  const data = await readJsonResponse<{ novel: Chapter["novel"] }>(response);
  return data.novel;
}

function allEvidence(bundle: EvidenceBundle): LifeExperience[] {
  return [
    ...bundle.backgroundSimilar,
    ...bundle.decisionSimilar,
    ...bundle.relationshipRelevant,
    ...bundle.outcomeContrasts,
  ];
}

function buildChapterDecision(
  choice: ChapterChoice,
  selection: { optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string },
): ChapterDecision {
  const selectedOption = choice.options.find((option) => option.id === selection.optionId);
  return {
    id: choice.id,
    promptTitle: choice.promptTitle,
    context: choice.context,
    options: choice.options,
    selectedOptionId: selection.optionId,
    customAction: selection.customAction,
    normalizedAction:
      selection.optionId === "CUSTOM"
        ? (selection.customAction ?? "").trim()
        : (selectedOption?.label ?? "").trim(),
  };
}

function assembleChapter(args: {
  choice: ChapterChoice;
  selection: { optionId: "A" | "B" | "C" | "CUSTOM"; customAction?: string };
  span: ChapterSpan;
  worldBefore: WorldState;
  result: SimulateResult;
  novel: Chapter["novel"];
  narrativePlan?: NarrativePlan;
  worldStateAfter?: WorldState;
}): Chapter {
  const { choice, selection, span, worldBefore, result, novel, narrativePlan, worldStateAfter } = args;
  const finalWorld = worldStateAfter ?? result.worldStateAfter;
  const decision = buildChapterDecision(choice, selection);
  const evidence = allEvidence(result.evidenceBundle);
  const featured = [
    ...result.evidenceBundle.decisionSimilar,
    ...result.evidenceBundle.outcomeContrasts,
    ...result.evidenceBundle.backgroundSimilar,
  ].slice(0, 5);
  return {
    id: result.chapterId,
    index: worldBefore.chapterIds.length,
    startYear: worldBefore.currentYear,
    endYear: worldBefore.currentYear + span,
    span,
    stateBeforeHash: result.stateBeforeHash,
    decision,
    resolution: result.resolution,
    evidence: {
      experienceIds: evidence.map((e) => e.id),
      featuredExperienceIds: featured.map((e) => e.id),
    },
    simulationEventIds: result.simulation.events.map((event) => event.id),
    stateAfterHash: result.stateAfterHash,
    novel,
    summary: {
      keyEvents: result.simulation.chapterSummary.keyEvents,
      characterChanges: result.simulation.chapterSummary.characterChanges,
      relationshipChanges: result.simulation.chapterSummary.relationshipChanges,
      openThreads: finalWorld.openThreads
        .filter((thread) => thread.status === "open")
        .map((thread) => thread.label),
    },
    narrative: narrativePlan
      ? {
          plan: narrativePlan,
          referenceFragmentIds: narrativePlan.referenceFragmentIds,
          directorVersion: 1,
        }
      : undefined,
    memoryIds: result.simulation.newMemories.map((memory) => memory.id),
    createdAt: new Date().toISOString(),
  };
}
