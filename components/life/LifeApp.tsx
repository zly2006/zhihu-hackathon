"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Character } from "@/lib/domain/character";
import type {
  Chapter,
  ChapterChoice,
  ChapterDecision,
  DecisionResolution,
  GameSave,
} from "@/lib/domain/chapter";
import type { DialogueCharacter, DialogueScene } from "@/lib/domain/dialogue";
import type { ChapterSpan, GameMode } from "@/lib/domain/shared";
import type { WorldState } from "@/lib/domain/world";
import type { WorldSnapshot } from "@/lib/domain/snapshot";
import type { WorldSimulationOutput } from "@/lib/domain/simulation";
import type { EvidenceBundle, LifeExperience } from "@/lib/domain/experience";
import type { SceneChoiceResponse, ScenePackage, SceneRuntimeState } from "@/lib/domain/scene";
import type { NpcDraft, ProtagonistDraft } from "@/lib/game/character-factory";
import type { NarrativeEvidenceBundle, NarrativePlan, NarrativeReference, ScenePlan } from "@/lib/domain/narrative";
import { parseGameSave } from "@/lib/game/save";
import {
  appendSnapshot,
  appendSceneChoiceCheckpoint,
  createBranchFromSceneCheckpoint,
  createBranchFromSnapshot,
  getSnapshot,
  getTimelineNodes,
  initializeSnapshotState,
  refreshActiveSnapshot,
  switchBranch,
  type SnapshotTimelineNode,
} from "@/lib/game/snapshot-manager";
import { buildLifePresentation } from "@/lib/game/presentation";
import {
  commitSceneChoice,
  mergeSceneProjection,
  normalizeSceneSave,
  projectGameSave,
  serializeSceneSave,
} from "@/lib/game/scene-save";
import { completePendingChapter, createPendingChapter, updatePendingChapterStage } from "@/lib/game/scene-save";
import { adaptDialogueScenes } from "@/lib/game/scene-adapter";
import { getLiveSceneSession, hasLiveScene } from "@/lib/game/formal-scene-runtime";
import { pendingSpan, recoverChapterChoice, recoverEvidenceBundle, recoverSelection } from "@/lib/game/pending-chapter";
import { compileSceneActionContext } from "@/lib/game/scene-action-context";
import { createSceneRuntime } from "@/lib/game/scene-runtime";
import { findScene, DEFAULT_SCENE_ID, pickSceneForNovelScene } from "@/lib/game/scene-catalog";
import { ProtagonistSetup } from "./ProtagonistSetup";
import { NpcSetup } from "./NpcSetup";
import { ChapterSummary } from "./ChapterSummary";
import { DecisionPanel } from "./DecisionPanel";
import { ModeSelect } from "./ModeSelect";
import { LifeShell } from "@/components/life-vn/LifeShell";
import { SceneStage } from "@/components/life-vn/SceneStage";
import { DialogueBox } from "@/components/life-vn/DialogueBox";
import { StatusHUD } from "@/components/life-vn/StatusHUD";
import { Timeline, type TimelineChapter } from "@/components/life-vn/Timeline";
import { SnapshotViewer } from "@/components/life-vn/SnapshotViewer";
import { StreamingNovelPreview } from "@/components/life-vn/StreamingNovelPreview";
import { SceneRuntimePlayer } from "@/components/life-vn/SceneRuntimePlayer";
import { BranchPanel } from "@/components/life-vn/BranchPanel";

const SAVE_KEY = "restart-life-save-v1";
const DEMO_SAVE_KEY = "restart-life-neutral-scene-demo-v1";

type Screen =
  | "landing"
  | "mode_select"
  | "setup"
  | "npc_setup"
  | "chapter_start"
  | "decision"
  | "chapter_summary"
  | "formal_scene"
  | "demo_scene"
  | "pending_recovery"
  | "snapshot_view";
type SnapshotReturnScreen = Exclude<Screen, "snapshot_view">;

type ProgressEvent = { stage?: string; message?: string };

type NovelPreview = {
  title: string;
  scenes: Chapter["novel"]["scenes"];
};

type NovelStreamCallbacks = {
  onProgress?: (message: string) => void;
  onSceneStart?: (sceneIndex: number, scenePlan: ScenePlan) => void;
  onDelta?: (sceneIndex: number, delta: string) => void;
  onScene?: (sceneIndex: number, scene: Chapter["novel"]["scenes"][number]) => void;
};

type SimulateResult = {
  chapterId: string;
  evidenceBundle: EvidenceBundle;
  resolution: DecisionResolution;
  simulation: WorldSimulationOutput;
  worldStateAfter: WorldState;
  stateBeforeHash: string;
  stateAfterHash: string;
};

type NeutralDemoResponse = {
  synthetic: true;
  saveKey: string;
  gameSave: GameSave;
  scenePackage: ScenePackage;
  packageIds: string[];
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string | { message?: string } };
  const errorMessage = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
  if (!response.ok) throw new Error(errorMessage || `请求失败（HTTP ${response.status}）`);
  return payload;
}

async function readSseComplete<T>(
  response: Response,
  onProgress: (message: string) => void,
  onEvent?: (event: string, data: unknown) => void,
): Promise<T> {
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
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error("服务返回了无法解析的流式数据");
      }
      onEvent?.(event, payload);
      if (event === "progress") {
        onProgress((payload as ProgressEvent).message || "");
      } else if (event === "complete") {
        return payload as T;
      } else if (event === "error") {
        throw new Error((payload as { message?: string }).message || "请求失败");
      }
    }
  }
  throw new Error("响应未完成");
}

function persist(save: GameSave) {
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

function fallbackDialogueScenes(novel: Chapter["novel"]): DialogueScene[] {
  return novel.scenes.map((scene) => ({
    id: scene.id,
    background: pickSceneForNovelScene(scene).id,
    timeLabel: scene.timeLabel,
    characters: [],
    blocks: [{ type: "narration" as const, text: scene.text }],
    choices: [],
  }));
}

function createNovelStreamCallbacks(
  setPreview: Dispatch<SetStateAction<NovelPreview>>,
  onProgress: (message: string) => void,
): NovelStreamCallbacks {
  return {
    onProgress,
    onSceneStart: (sceneIndex, scenePlan) => {
      setPreview((previous) => {
        const scenes = [...previous.scenes];
        scenes[sceneIndex] = {
          id: `scene-${sceneIndex + 1}`,
          heading: scenePlan.location,
          timeLabel: scenePlan.timeLabel,
          text: "",
        };
        return { ...previous, scenes };
      });
    },
    onDelta: (sceneIndex, delta) => {
      setPreview((previous) => {
        const scenes = [...previous.scenes];
        const current = scenes[sceneIndex] ?? { id: `scene-${sceneIndex + 1}`, text: "" };
        scenes[sceneIndex] = { ...current, text: `${current.text}${delta}` };
        return { ...previous, scenes };
      });
    },
    onScene: (sceneIndex, scene) => {
      setPreview((previous) => {
        const scenes = [...previous.scenes];
        scenes[sceneIndex] = scene;
        return { ...previous, scenes };
      });
    },
  };
}

function timelineItemFromSnapshot(node: SnapshotTimelineNode): TimelineChapter {
  return {
    id: node.id,
    ...(node.snapshotId ? { snapshotId: node.snapshotId } : {}),
    label: node.label,
    title: node.title,
    ...(node.summary ? { summary: node.summary } : {}),
    ...(node.active ? { active: true } : {}),
    // legacy-current 也允许查看章节文本，但没有“从这里重新开始人生”能力。
    canSelect: Boolean(node.snapshotId),
    canReplay: node.canReplay,
  };
}

function protagonistDialogueCharacter(character: Character, avatarUrl: string | null): DialogueCharacter {
  return {
    id: character.id,
    name: character.identity.name,
    ...(avatarUrl ? { avatarUrl } : {}),
    position: "center",
    emotion: character.emotionState || "平静",
  };
}

function orderedDemoPackages(save: GameSave): ScenePackage[] {
  return Object.values(save.scenePackages ?? {}).sort((left, right) => left.chapterId.localeCompare(right.chapterId));
}

function branchPanelData(save: GameSave): {
  branches: Array<{ id: string; name: string; active: boolean; snapshotCount: number }>;
  checkpoints: Array<{ id: string; label: string; sceneId: string; blockId: string }>;
} {
  const activeBranchId = save.activeBranchId ?? "main";
  const branches = Object.values(save.branches ?? {}).map((branch) => ({
    id: branch.id,
    name: branch.name,
    active: branch.id === activeBranchId,
    snapshotCount: branch.snapshotIds.length,
  }));
  const activeBranch = save.branches?.[activeBranchId];
  const checkpoints = (activeBranch?.snapshotIds ?? [])
    .map((snapshotId) => save.snapshots?.[snapshotId])
    .filter((snapshot): snapshot is WorldSnapshot => Boolean(snapshot))
    .filter(
      (snapshot) =>
        snapshot.kind === "scene-choice" &&
        snapshot.replayable &&
        snapshot.sceneRuntime?.status === "awaiting_choice" &&
        !snapshot.sceneRuntime?.pendingAction,
    )
    .map((snapshot) => ({
      id: snapshot.id,
      label: `${snapshot.chapterId ?? "当前章节"} · ${snapshot.sceneId ?? "未知场景"}`,
      sceneId: snapshot.sceneId ?? "未知场景",
      blockId: snapshot.blockId ?? "未知选择",
    }))
    .reverse();
  return { branches, checkpoints };
}

function isChoiceCheckpointForRuntime(snapshot: WorldSnapshot | undefined, runtime: SceneRuntimeState): boolean {
  return Boolean(
    snapshot &&
      snapshot.kind === "scene-choice" &&
      snapshot.replayable &&
      snapshot.chapterId === runtime.chapterId &&
      snapshot.packageId === runtime.packageId &&
      snapshot.packageVersion === runtime.packageVersion &&
      snapshot.sceneId === runtime.sceneId &&
      snapshot.blockId === runtime.blockId &&
      snapshot.sceneRuntime?.status === "awaiting_choice" &&
      !snapshot.sceneRuntime.pendingAction,
  );
}

function hasChoiceCheckpointForRuntime(save: GameSave, runtime: SceneRuntimeState): boolean {
  const branchId = save.activeBranchId ?? "main";
  return (save.branches?.[branchId]?.snapshotIds ?? []).some((snapshotId) =>
    isChoiceCheckpointForRuntime(save.snapshots?.[snapshotId], runtime),
  );
}

function saveLiveScenePosition(
  save: GameSave,
  runtime: SceneRuntimeState,
  packageItem: ScenePackage,
  now: string,
): GameSave {
  const base = { ...save, sceneRuntime: runtime, savedAt: now };
  if (
    runtime.readOnly ||
    runtime.status !== "awaiting_choice" ||
    runtime.branchId !== (save.activeBranchId ?? "main") ||
    packageItem.chapterId !== runtime.chapterId ||
    packageItem.id !== runtime.packageId ||
    packageItem.version !== runtime.packageVersion ||
    hasChoiceCheckpointForRuntime(save, runtime)
  ) {
    return base;
  }
  return appendSceneChoiceCheckpoint(base, {
    chapterId: runtime.chapterId,
    packageId: packageItem.id,
    packageVersion: packageItem.version,
    sceneId: runtime.sceneId,
    blockId: runtime.blockId,
    runtime,
    actions: save.sceneActions,
    flags: save.sceneFlags,
    now,
  });
}

function prepareBranchSwitchSave(save: GameSave, now: string): GameSave {
  const runtime = save.sceneRuntime;
  const packageItem = runtime ? save.scenePackages?.[runtime.chapterId] : undefined;
  if (!runtime || !packageItem) return save;
  return saveLiveScenePosition(save, runtime, packageItem, now);
}

async function fetchDialogue(
  worldBefore: WorldState,
  events: WorldSimulationOutput["events"],
  novel: Chapter["novel"],
  narrativePlan?: NarrativePlan,
  narrativeEvidence?: NarrativeEvidenceBundle,
): Promise<DialogueScene[]> {
  const response = await fetch("/api/chapter/dialogue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stateBefore: worldBefore,
      events,
      novelScenes: novel.scenes,
      narrativePlan,
      narrativeEvidence,
    }),
  });
  const data = await readJsonResponse<{ dialogue: DialogueScene[]; degraded?: boolean }>(response);
  if (!Array.isArray(data.dialogue) || data.dialogue.length === 0) {
    throw new Error("对白服务未返回有效场景");
  }
  return data.dialogue;
}

async function fetchLiveScenePackage(
  world: WorldState,
  events: WorldSimulationOutput["events"],
  chapter: Chapter,
): Promise<ScenePackage> {
  const response = await fetch("/api/chapter/live-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worldState: world,
      events,
      chapter: {
        id: chapter.id,
        index: chapter.index,
        startYear: chapter.startYear,
        endYear: chapter.endYear,
        span: chapter.span,
        decision: chapter.decision,
        summary: chapter.summary,
        narrativePlan: chapter.narrative?.plan,
      },
      version: 1,
    }),
  });
  const data = await readJsonResponse<{ scenePackage: ScenePackage; generated?: string }>(response);
  if (!data.scenePackage || !Array.isArray(data.scenePackage.scenes) || !data.scenePackage.scenes.some((scene) => scene.mode === "live")) {
    throw new Error("AI 互动场景服务未返回有效 live 场景包");
  }
  return data.scenePackage;
}

export function LifeApp() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [hasSave, setHasSave] = useState(false);
  const [save, setSave] = useState<GameSave | null>(null);
  const [mode, setMode] = useState<GameMode>("galgame");
  const [entryIntent, setEntryIntent] = useState<"new" | "continue">("new");
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
  const [novelPreview, setNovelPreview] = useState<NovelPreview>({ title: "", scenes: [] });
  const [planResult, setPlanResult] = useState<{ narrativePlan: NarrativePlan; narrativeEvidence: NarrativeEvidenceBundle } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshotReturnScreen, setSnapshotReturnScreen] = useState<SnapshotReturnScreen>("chapter_start");
  const [demoPackage, setDemoPackage] = useState<ScenePackage | null>(null);
  const [syntheticDemo, setSyntheticDemo] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "neutral") {
      let cancelled = false;
      void fetch("/api/life/demo")
        .then((response) => readJsonResponse<NeutralDemoResponse>(response))
        .then((data) => {
          if (cancelled) return;
          let gameSave = normalizeSceneSave(data.gameSave);
          const stored = window.localStorage.getItem(DEMO_SAVE_KEY);
          if (stored) {
            try {
              const storedSave = normalizeSceneSave(JSON.parse(stored) as GameSave);
              const storedRuntime = storedSave.sceneRuntime;
              const storedPackage = storedRuntime
                ? storedSave.scenePackages?.[storedRuntime.chapterId]
                : undefined;
              if (
                storedRuntime &&
                data.packageIds.includes(storedRuntime.packageId) &&
                storedPackage?.id === storedRuntime.packageId &&
                storedPackage.version === storedRuntime.packageVersion
              ) {
                gameSave = storedSave;
              }
            } catch {
              // 合成 Demo 的损坏存档只回退到新夹具，不影响正式人生存档。
            }
          }
          setSave(gameSave);
          const activePackage = gameSave.sceneRuntime
            ? gameSave.scenePackages?.[gameSave.sceneRuntime.chapterId]
            : undefined;
          setDemoPackage(activePackage ?? data.scenePackage);
          setSyntheticDemo(true);
          setMode("galgame");
          setScreen("demo_scene");
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "中性 Demo 加载失败");
        });
      return () => {
        cancelled = true;
      };
    }
    setHasSave(Boolean(window.localStorage.getItem(SAVE_KEY)));
    return undefined;
  }, []);

  // 测试可观测接口：只暴露玩家可见信息，绝不输出 NPC privateState。
  useEffect(() => {
    const world = save?.worldState;
    const hero = world ? world.characters[world.protagonistId] : null;
    const runtime = save?.sceneRuntime;
    const runtimePackage = demoPackage ?? (runtime ? save?.scenePackages?.[runtime.chapterId] : undefined);
    const runtimeScene = runtime && runtimePackage?.scenes.find((scene) => scene.id === runtime.sceneId);
    const runtimeBlock = runtime ? runtimeScene?.blocks.find((block) => block.id === runtime.blockId) : undefined;
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
              directorBrief: chapter.narrative.plan.directorBrief
                ? {
                    trigger: chapter.narrative.plan.directorBrief.trigger,
                    focusCharacterId: chapter.narrative.plan.directorBrief.focusCharacterId,
                    focusEventIds: chapter.narrative.plan.directorBrief.focusEventIds,
                    focusThreadIds: chapter.narrative.plan.directorBrief.focusThreadIds,
                    dramaticQuestion: chapter.narrative.plan.directorBrief.dramaticQuestion,
                    tensionLevel: chapter.narrative.plan.directorBrief.tensionLevel,
                  }
                : null,
            }
          : null,
        reflectionCount: save?.worldState.reflections
          ? Object.keys(save.worldState.reflections).length
          : 0,
        activeBranchId: save?.activeBranchId ?? "main",
        snapshotView: selectedSnapshotId,
        activeScene: chapter ? { index: chapter.index, title: chapter.novel.title } : null,
        synthetic: syntheticDemo,
        pendingChapter: save?.pendingChapter
          ? {
              chapterId: save.pendingChapter.chapterId,
              stage: save.pendingChapter.stage,
              novelCompleted: Boolean(save.pendingChapter.novelCompleted),
              dialogueCompleted: Boolean(save.pendingChapter.dialogueCompleted),
            }
          : null,
        sceneRuntime: runtime
          ? {
              branchId: runtime.branchId,
              packageId: runtime.packageId,
              packageVersion: runtime.packageVersion,
              sceneId: runtime.sceneId,
              blockId: runtime.blockId,
              status: runtime.status,
              availableChoices:
                runtimeBlock?.content.type === "choice"
                  ? runtimeBlock.content.choices.map((item) => item.label)
                  : [],
              recentPublicActions: (save?.sceneActions ?? []).slice(-3).map((action) => ({
                actionId: action.id,
                label: action.label,
                ruleId: action.ruleId,
              })),
            }
          : null,
        loading,
        error,
      });
  }, [screen, save, choice, selection, loading, error, chapter, selectedSnapshotId, demoPackage, syntheticDemo]);

  // 测试可观测接口（迭代方案 §10.2）：window.__lifeTest 跳过 VN 动效直达终态。
  // 供自动化截图/长流程回归使用；等价于全局 prefers-reduced-motion，幂等可恢复。
  useEffect(() => {
    const NO_MOTION_STYLE_ID = "life-vn-no-motion";
    const win = window as unknown as Record<string, unknown>;
    win.__lifeTest = {
      finishTransitions: () => {
        if (document.getElementById(NO_MOTION_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = NO_MOTION_STYLE_ID;
        style.textContent = [
          ".life-vn *, .life-vn *:before, .life-vn *:after {",
          "  animation-duration: 0.01ms !important;",
          "  animation-iteration-count: 1 !important;",
          "  transition-duration: 0ms !important;",
          "  scroll-behavior: auto !important;",
          "}",
        ].join("\n");
        document.head.appendChild(style);
      },
      restoreMotion: () => {
        document.getElementById(NO_MOTION_STYLE_ID)?.remove();
      },
      isMotionFinished: () => Boolean(document.getElementById(NO_MOTION_STYLE_ID)),
    };
    return () => {
      delete win.__lifeTest;
      document.getElementById(NO_MOTION_STYLE_ID)?.remove();
    };
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
          body: JSON.stringify({ protagonist, npcs: finalNpcs, presentationMode: mode }),
        });
        const data = await readJsonResponse<{ gameSave: GameSave }>(response);
        const gameSave = initializeSnapshotState(data.gameSave);
        setMode(gameSave.presentationMode ?? mode);
        persist(gameSave);
        setHasSave(true);
        setSave(gameSave);
        setScreen("chapter_start");
      } catch (err) {
        setError(err instanceof Error ? err.message : "人生创建失败");
      } finally {
        setLoading(false);
      }
    },
    [mode, protagonist],
  );

  const handleStartNew = useCallback(() => {
    setError("");
    setEntryIntent("new");
    setMode("galgame");
    setScreen("mode_select");
  }, []);

  const handleContinue = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const loadedSave = initializeSnapshotState(normalizeSceneSave(parseGameSave(JSON.parse(raw))));
      setSave(loadedSave);
      setMode(loadedSave.presentationMode ?? "galgame");
      setEntryIntent("continue");
      const pending = loadedSave.pendingChapter;
      if (pending) {
        const recoveredChoice = recoverChapterChoice(pending);
        const recoveredSelection = recoverSelection(pending);
        if (!recoveredChoice || !recoveredSelection || !pending.simulationOutput || !pending.resolution) {
          setError("发现未完成章节，但存档缺少可恢复的结算材料；请导出存档后再修复。");
          setScreen("pending_recovery");
          return;
        }
        const recoveredResult: SimulateResult = {
          chapterId: pending.chapterId,
          evidenceBundle: recoverEvidenceBundle(loadedSave, pending),
          resolution: pending.resolution,
          simulation: pending.simulationOutput,
          worldStateAfter: loadedSave.worldState,
          stateBeforeHash: pending.stateBeforeHash,
          stateAfterHash: pending.stateAfterHash,
        };
        setChoice(recoveredChoice);
        setSelection(recoveredSelection);
        setSpan(pendingSpan(pending));
        setPreWorld(pending.worldStateBefore);
        setSimResult(recoveredResult);
        setNovelPreview(pending.novel ? { title: pending.novel.title, scenes: pending.novel.scenes } : { title: "", scenes: [] });
        if (pending.novel) {
          setChapter(
            assembleChapter({
              choice: recoveredChoice,
              selection: recoveredSelection,
              span: pendingSpan(pending),
              worldBefore: pending.worldStateBefore,
              result: recoveredResult,
              novel: pending.novel,
              narrativePlan: pending.narrative?.plan,
              dialogue: pending.dialogue,
              worldStateAfter: loadedSave.worldState,
            }),
          );
        } else {
          setChapter(null);
        }
        setError("");
        setScreen("pending_recovery");
        return;
      }
      const liveSession = loadedSave.sceneRuntime
        ? getLiveSceneSession(loadedSave, loadedSave.sceneRuntime.chapterId)
        : null;
      const liveChapter = liveSession ? loadedSave.chapters[liveSession.runtime.chapterId] : undefined;
      if (liveSession && liveChapter) {
        setChapter(liveChapter);
        setChoice(null);
        setSelection({
          optionId: liveChapter.decision.selectedOptionId,
          ...(liveChapter.decision.customAction ? { customAction: liveChapter.decision.customAction } : {}),
        });
        setSpan(liveChapter.span);
        setPreWorld(null);
        setSimResult(null);
        setError("");
        setScreen("formal_scene");
        return;
      }
      setScreen("mode_select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "存档读取失败");
    }
  }, []);

  const handleResumePending = useCallback(async () => {
    if (!save?.pendingChapter) return;
    const pending = save.pendingChapter;
    const recoveredChoice = recoverChapterChoice(pending);
    const recoveredSelection = recoverSelection(pending);
    if (!recoveredChoice || !recoveredSelection || !pending.simulationOutput || !pending.resolution) {
      setError("当前待恢复章节材料不完整，无法安全重放表现阶段。");
      return;
    }
    const result: SimulateResult = {
      chapterId: pending.chapterId,
      evidenceBundle: recoverEvidenceBundle(save, pending),
      resolution: pending.resolution,
      simulation: pending.simulationOutput,
      worldStateAfter: save.worldState,
      stateBeforeHash: pending.stateBeforeHash,
      stateAfterHash: pending.stateAfterHash,
    };
    const recoveredSpan = pendingSpan(pending);
    let workingSave = save;
    setLoading(true);
    setNovelLoading(true);
    setError("");
    try {
      let novel = pending.novel;
      if (!novel) {
        setNovelPreview({ title: "", scenes: [] });
        novel = await fetchNovel(
          result,
          pending.worldStateBefore,
          recoveredSpan,
          1,
          pending.narrative?.plan,
          [],
          createNovelStreamCallbacks(setNovelPreview, setPlanProgress),
        );
      }
      setNovelPreview({ title: novel.title, scenes: novel.scenes });

      const dialogue = pending.dialogue;

      const recoveredChapter = assembleChapter({
        choice: recoveredChoice,
        selection: recoveredSelection,
        span: recoveredSpan,
        worldBefore: pending.worldStateBefore,
        result,
        novel,
        narrativePlan: pending.narrative?.plan,
        dialogue,
        worldStateAfter: workingSave.worldState,
      });
      let scenePackage = workingSave.scenePackages?.[recoveredChapter.id] ?? pending.liveScenePackage;
      if (mode === "galgame" && (!scenePackage || !hasLiveScene(scenePackage))) {
        setPlanProgress("正在恢复 AI 互动场景…");
        scenePackage = await fetchLiveScenePackage(workingSave.worldState, result.simulation.events, recoveredChapter);
      }
      if (!scenePackage) {
        scenePackage = adaptDialogueScenes(dialogue ?? fallbackDialogueScenes(novel), {
          chapterId: recoveredChapter.id,
          year: recoveredChapter.endYear,
          version: 1,
        });
      }
      const liveScenePackage = hasLiveScene(scenePackage) ? scenePackage : undefined;
      const recoveredRuntime =
        workingSave.sceneRuntime?.chapterId === recoveredChapter.id &&
        workingSave.sceneRuntime.packageId === scenePackage.id &&
        workingSave.sceneRuntime.packageVersion === scenePackage.version
          ? workingSave.sceneRuntime
          : hasLiveScene(scenePackage)
            ? createSceneRuntime(scenePackage, { branchId: workingSave.activeBranchId ?? "main" })
            : undefined;
      const now = new Date().toISOString();
      workingSave = {
        ...workingSave,
        chapters: { ...workingSave.chapters, [recoveredChapter.id]: recoveredChapter },
        events: {
          ...workingSave.events,
          ...Object.fromEntries(result.simulation.events.map((event) => [event.id, event])),
        },
        experienceCache: {
          ...workingSave.experienceCache,
          ...Object.fromEntries(allEvidence(result.evidenceBundle).map((experience) => [experience.id, experience])),
        },
        scenePackages: { ...(workingSave.scenePackages ?? {}), [recoveredChapter.id]: scenePackage },
        ...(recoveredRuntime ? { sceneRuntime: recoveredRuntime } : {}),
        pendingChapter: workingSave.pendingChapter
          ? updatePendingChapterStage(workingSave.pendingChapter, pending.executionId, "ready", {
              novel: recoveredChapter.novel,
              dialogue,
              novelCompleted: true,
              dialogueCompleted: mode !== "galgame" || Boolean(dialogue),
              ...(liveScenePackage ? { liveScenePackage, liveSceneCompleted: true } : {}),
              updatedAt: now,
            })
          : undefined,
        savedAt: now,
      };
      persist(workingSave);
      setSave(workingSave);
      const completedSave = workingSave.pendingChapter
        ? completePendingChapter(workingSave, pending.executionId, recoveredChapter, scenePackage)
        : workingSave;
      const finalSave = appendSnapshot(completedSave, { chapterId: recoveredChapter.id, now });
      persist(finalSave);
      setSave(finalSave);
      setChoice(recoveredChoice);
      setSelection(recoveredSelection);
      setPreWorld(pending.worldStateBefore);
      setSimResult(result);
      setChapter(recoveredChapter);
      setScreen(liveScenePackage ? "formal_scene" : "chapter_summary");
    } catch (err) {
      const message = err instanceof Error ? err.message : "章节表现恢复失败";
      setError(message);
      try {
        if (workingSave.pendingChapter) {
          const failedSave = {
            ...workingSave,
            pendingChapter: updatePendingChapterStage(workingSave.pendingChapter, pending.executionId, "error", {
              error: { code: "PENDING_RECOVERY_FAILED", message },
              updatedAt: new Date().toISOString(),
            }),
            savedAt: new Date().toISOString(),
          };
          persist(failedSave);
          setSave(failedSave);
        }
      } catch (persistError) {
        console.error("pending recovery save failed", persistError);
      }
    } finally {
      setLoading(false);
      setNovelLoading(false);
    }
  }, [mode, save]);

  const handleDemoPersistPosition = useCallback((runtime: SceneRuntimeState) => {
    setSave((previous) => {
      if (!previous) return previous;
      const packageItem = previous.scenePackages?.[runtime.chapterId];
      const sameRuntime = JSON.stringify(previous.sceneRuntime) === JSON.stringify(runtime);
      const needsCheckpoint = runtime.status === "awaiting_choice" && !hasChoiceCheckpointForRuntime(previous, runtime);
      if (
        !packageItem ||
        packageItem.id !== runtime.packageId ||
        packageItem.version !== runtime.packageVersion ||
        runtime.branchId !== (previous.activeBranchId ?? "main") ||
        (sameRuntime && !needsCheckpoint)
      ) {
        return previous;
      }
      const nextSave = saveLiveScenePosition(previous, runtime, packageItem, new Date().toISOString());
      try {
        window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(nextSave));
        return nextSave;
      } catch {
        setError("中性 Demo 场景位置保存失败；当前页面仍可继续，但刷新后会回到上次成功保存的位置。");
        return previous;
      }
    });
  }, []);

  const handleDemoSelect = useCallback(
    async (input: {
      requestId: string;
      issuedAt: string;
      expectedRevision: number;
      choiceId: "A" | "B" | "C";
    }): Promise<SceneChoiceResponse> => {
      if (!save?.sceneRuntime || !demoPackage) throw new Error("中性 Demo 场景尚未就绪");
      const checkpointedSave = appendSceneChoiceCheckpoint(save, {
        chapterId: demoPackage.chapterId,
        packageId: demoPackage.id,
        packageVersion: demoPackage.version,
        sceneId: save.sceneRuntime.sceneId,
        blockId: save.sceneRuntime.blockId,
        runtime: save.sceneRuntime,
        actions: save.sceneActions,
        flags: save.sceneFlags,
      });
      const projection = projectGameSave(checkpointedSave, checkpointedSave.sceneRuntime ?? save.sceneRuntime, checkpointedSave.sceneActions, checkpointedSave.sceneFlags);
      const response = await fetch("/api/chapter/scene-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projection, package: demoPackage, ...input }),
      });
      const data = await readJsonResponse<SceneChoiceResponse>(response);
      const nextProjection = commitSceneChoice(projection, data);
      const nextSave = mergeSceneProjection(checkpointedSave, nextProjection);
      const activeBranch = nextSave.branches?.[nextSave.activeBranchId ?? "main"];
      const checkpointHead = activeBranch?.headSnapshotId ? nextSave.snapshots?.[activeBranch.headSnapshotId] : undefined;
      const persistedSave = appendSceneChoiceCheckpoint(nextSave, {
        chapterId: demoPackage.chapterId,
        packageId: demoPackage.id,
        packageVersion: demoPackage.version,
        sceneId: data.runtimeAfter.sceneId,
        blockId: data.runtimeAfter.blockId,
        sequence: (checkpointHead?.sequence ?? 0) + 1,
        runtime: data.runtimeAfter,
        actions: nextSave.sceneActions,
        flags: nextSave.sceneFlags,
        now: new Date().toISOString(),
      });
      try {
        window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(persistedSave));
      } catch {
        throw new Error("中性 Demo 场景结果保存失败，请重试；当前状态尚未发布。");
      }
      setSave(persistedSave);
      return data;
    },
    [demoPackage, save],
  );

  const handleFormalScenePersistPosition = useCallback((runtime: SceneRuntimeState) => {
    setSave((previous) => {
      if (!previous) return previous;
      const packageItem = previous.scenePackages?.[runtime.chapterId];
      const sameRuntime = JSON.stringify(previous.sceneRuntime) === JSON.stringify(runtime);
      const needsCheckpoint = runtime.status === "awaiting_choice" && !hasChoiceCheckpointForRuntime(previous, runtime);
      if (
        !packageItem ||
        packageItem.id !== runtime.packageId ||
        packageItem.version !== runtime.packageVersion ||
        runtime.branchId !== (previous.activeBranchId ?? "main") ||
        (sameRuntime && !needsCheckpoint)
      ) {
        return previous;
      }
      const nextSave = saveLiveScenePosition(previous, runtime, packageItem, new Date().toISOString());
      try {
        window.localStorage.setItem(SAVE_KEY, serializeSceneSave(nextSave));
        return nextSave;
      } catch {
        setError("正式场景位置保存失败；当前页面仍可继续，但刷新后会回到上次成功保存的位置。");
        return previous;
      }
    });
  }, []);

  const handleFormalSceneSelect = useCallback(
    async (input: {
      requestId: string;
      issuedAt: string;
      expectedRevision: number;
      choiceId: "A" | "B" | "C";
    }): Promise<SceneChoiceResponse> => {
      const session = save?.sceneRuntime ? getLiveSceneSession(save, save.sceneRuntime.chapterId) : null;
      if (!save || !session) throw new Error("正式场景尚未就绪");
      const scenePackage = session.package;
      const checkpointedSave = appendSceneChoiceCheckpoint(save, {
        chapterId: scenePackage.chapterId,
        packageId: scenePackage.id,
        packageVersion: scenePackage.version,
        sceneId: session.runtime.sceneId,
        blockId: session.runtime.blockId,
        runtime: session.runtime,
        actions: save.sceneActions,
        flags: save.sceneFlags,
      });
      const projection = projectGameSave(
        checkpointedSave,
        checkpointedSave.sceneRuntime ?? session.runtime,
        checkpointedSave.sceneActions,
        checkpointedSave.sceneFlags,
      );
      const response = await fetch("/api/chapter/scene-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projection, package: scenePackage, ...input }),
      });
      const data = await readJsonResponse<SceneChoiceResponse>(response);
      const nextProjection = commitSceneChoice(projection, data);
      const nextSave = mergeSceneProjection(checkpointedSave, nextProjection);
      const activeBranch = nextSave.branches?.[nextSave.activeBranchId ?? "main"];
      const checkpointHead = activeBranch?.headSnapshotId ? nextSave.snapshots?.[activeBranch.headSnapshotId] : undefined;
      const persistedSave = appendSceneChoiceCheckpoint(nextSave, {
        chapterId: scenePackage.chapterId,
        packageId: scenePackage.id,
        packageVersion: scenePackage.version,
        sceneId: data.runtimeAfter.sceneId,
        blockId: data.runtimeAfter.blockId,
        sequence: (checkpointHead?.sequence ?? 0) + 1,
        runtime: data.runtimeAfter,
        actions: nextSave.sceneActions,
        flags: nextSave.sceneFlags,
        now: new Date().toISOString(),
      });
      try {
        window.localStorage.setItem(SAVE_KEY, serializeSceneSave(persistedSave));
      } catch {
        throw new Error("正式场景结果保存失败，请重试；当前状态尚未发布。");
      }
      setSave(persistedSave);
      return data;
    },
    [save],
  );

  const handleDemoNextPackage = useCallback(async () => {
    if (!save?.sceneRuntime || !demoPackage || save.sceneRuntime.status !== "completed") return;
    const packages = orderedDemoPackages(save);
    const currentIndex = packages.findIndex((item) => item.id === demoPackage.id && item.version === demoPackage.version);
    const nextPackage = currentIndex >= 0 ? packages[currentIndex + 1] : undefined;
    if (!nextPackage) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/life/demo/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameSave: save, packageId: nextPackage.id }),
      });
      const data = await readJsonResponse<{ synthetic: true; gameSave: GameSave; scenePackage: ScenePackage }>(response);
      const nextSave = normalizeSceneSave(data.gameSave);
      window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(nextSave));
      setDemoPackage(data.scenePackage);
      setSave(nextSave);
    } catch {
      setError("下一测试章节切换失败，当前 Demo 存档未改变。");
    } finally {
      setLoading(false);
    }
  }, [demoPackage, save]);

  const handleDemoCreateBranch = useCallback(
    (snapshotId: string) => {
      if (!save || save.sceneRuntime?.status === "submitting") return;
      try {
        const nextSave = createBranchFromSceneCheckpoint(save, snapshotId, {
          name: `中性测试分支 ${Object.keys(save.branches ?? {}).length}`,
          now: new Date().toISOString(),
        });
        window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(nextSave));
        setSave(nextSave);
        const packageItem = nextSave.sceneRuntime
          ? nextSave.scenePackages?.[nextSave.sceneRuntime.chapterId]
          : undefined;
        if (!packageItem) throw new Error("分支缺少可恢复的中性场景包");
        setDemoPackage(packageItem);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "中性测试分支创建失败");
      }
    },
    [save],
  );

  const handleDemoSwitchBranch = useCallback(
    (branchId: string) => {
      if (!save || save.sceneRuntime?.status === "submitting" || branchId === (save.activeBranchId ?? "main")) return;
      try {
        const now = new Date().toISOString();
        const persistedCurrent = prepareBranchSwitchSave(save, now);
        window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(persistedCurrent));
        const nextSave = switchBranch(persistedCurrent, branchId, now);
        const packageItem = nextSave.sceneRuntime
          ? nextSave.scenePackages?.[nextSave.sceneRuntime.chapterId]
          : undefined;
        if (!nextSave.sceneRuntime || !packageItem) throw new Error("该中性分支缺少可恢复场景位置");
        window.localStorage.setItem(DEMO_SAVE_KEY, serializeSceneSave(nextSave));
        setSave(nextSave);
        setDemoPackage(packageItem);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "中性测试分支切换失败");
      }
    },
    [save],
  );

  const handleFormalCreateBranch = useCallback(
    (snapshotId: string) => {
      if (!save || save.sceneRuntime?.status === "submitting") return;
      try {
        const nextSave = createBranchFromSceneCheckpoint(save, snapshotId, {
          now: new Date().toISOString(),
        });
        persist(nextSave);
        setSave(nextSave);
        setError("");
        const runtime = nextSave.sceneRuntime;
        const liveSession = runtime ? getLiveSceneSession(nextSave, runtime.chapterId) : null;
        const liveChapter = liveSession ? nextSave.chapters[liveSession.runtime.chapterId] : undefined;
        if (liveSession && liveChapter) {
          setChapter(liveChapter);
          setChoice(null);
          setSelection({
            optionId: liveChapter.decision.selectedOptionId,
            ...(liveChapter.decision.customAction ? { customAction: liveChapter.decision.customAction } : {}),
          });
          setSpan(liveChapter.span);
          setPreWorld(null);
          setSimResult(null);
          setScreen("formal_scene");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "正式人生分支创建失败");
      }
    },
    [save],
  );

  const handleFormalSwitchBranch = useCallback(
    (branchId: string) => {
      if (!save || save.sceneRuntime?.status === "submitting" || branchId === (save.activeBranchId ?? "main")) return;
      try {
        const now = new Date().toISOString();
        const persistedCurrent = prepareBranchSwitchSave(save, now);
        persist(persistedCurrent);
        const nextSave = switchBranch(persistedCurrent, branchId, now);
        persist(nextSave);
        setSave(nextSave);
        setError("");
        const runtime = nextSave.sceneRuntime;
        const liveSession = runtime ? getLiveSceneSession(nextSave, runtime.chapterId) : null;
        const liveChapter = liveSession ? nextSave.chapters[liveSession.runtime.chapterId] : undefined;
        if (liveSession && liveChapter) {
          setChapter(liveChapter);
          setChoice(null);
          setSelection({
            optionId: liveChapter.decision.selectedOptionId,
            ...(liveChapter.decision.customAction ? { customAction: liveChapter.decision.customAction } : {}),
          });
          setSpan(liveChapter.span);
          setPreWorld(null);
          setSimResult(null);
          setScreen("formal_scene");
        } else {
          setScreen("chapter_start");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "正式人生分支切换失败");
      }
    },
    [save],
  );

  const handleExitDemo = useCallback(() => {
    setDemoPackage(null);
    setSyntheticDemo(false);
    setSave(null);
    setScreen("landing");
  }, []);

  const handleModeSelect = useCallback(
    (nextMode: GameMode) => {
      setMode(nextMode);
      setError("");
      if (entryIntent === "continue" && save) {
        const nextSave: GameSave = {
          ...save,
          presentationMode: nextMode,
          savedAt: new Date().toISOString(),
        };
        setSave(nextSave);
        persist(nextSave);
        setScreen("chapter_start");
        return;
      }
      setScreen("setup");
    },
    [entryIntent, save],
  );

  const handleStartChapter = useCallback(async () => {
    if (!save) return;
    setLoading(true);
    setError("");
    setChoiceProgress("正在生成本章困境…");
    try {
      const response = await fetch("/api/chapter/choices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           worldState: save.worldState,
           span,
           sceneActionContext: compileSceneActionContext(save),
         }),
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
      setNovelPreview({ title: "", scenes: [] });
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
      setSimProgress("正在推演你的未来…");
      setNovelPreview({ title: "", scenes: [] });
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
            sceneActionContext: compileSceneActionContext(save),
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error((payload as { error?: string } | null)?.error || "世界推演失败");
        }
        const result = await readSseComplete<SimulateResult>(response, setSimProgress);
        setSimResult(result);

        // 自动存档节点 4：先保存完整 pendingChapter，后续叙事阶段只更新同一执行 ID。
        const pending = createPendingChapter({
          executionId: result.chapterId,
          chapterId: result.chapterId,
          startYear: worldBefore.currentYear,
          endYear: worldBefore.currentYear + span,
          stateBeforeHash: result.stateBeforeHash,
          stateAfterHash: result.stateAfterHash,
          worldStateBefore: worldBefore,
          worldStateAfter: result.worldStateAfter,
          selection: buildChapterDecision(choice, next),
          resolution: result.resolution,
          simulationOutput: result.simulation,
          eventIds: result.simulation.events.map((event) => event.id),
          evidenceIds: allEvidence(result.evidenceBundle).map((experience) => experience.id),
          featuredExperienceIds: [
            ...result.evidenceBundle.decisionSimilar,
            ...result.evidenceBundle.outcomeContrasts,
            ...result.evidenceBundle.backgroundSimilar,
          ].slice(0, 5).map((experience) => experience.id),
          createdAt: new Date().toISOString(),
        });
        let saveBase: GameSave = {
          ...save,
          worldState: result.worldStateAfter,
          pendingChapter: pending,
          saveRevision: (save.saveRevision ?? 0) + 1,
          savedAt: new Date().toISOString(),
        };
        persist(saveBase);
        setSave(saveBase);

        // 生成小说（自动存档节点 5）
        setNovelLoading(true);
        try {
          // V1.1 叙事规划 ∥ V1.2 角色反思 并行（两者互不依赖，省一段串行等待；
          // 任一失败均自动降级，不阻断、不修改 canonical）
          let narrativePlan: NarrativePlan | undefined;
          let narrativeReferences: NarrativeReference[] = [];
          let narrativeEvidence: NarrativeEvidenceBundle | undefined;
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
              narrativeEvidence = planOutcome.evidence;
              setPlanResult({ narrativePlan: planOutcome.narrativePlan, narrativeEvidence: planOutcome.evidence });
            }
            const reflectedWorld = reflectionOutcome?.worldStateAfter ?? saveBase.worldState;
            if (saveBase.pendingChapter) {
              const stage = reflectionOutcome ? "reflection" : planOutcome ? "plan" : "simulated";
              const stagedPending = updatePendingChapterStage(saveBase.pendingChapter, result.chapterId, stage, {
                worldStateAfter: reflectedWorld,
                ...(planOutcome?.narrativePlan
                  ? {
                      narrative: {
                        plan: planOutcome.narrativePlan,
                        referenceFragmentIds: planOutcome.narrativePlan.referenceFragmentIds,
                        directorVersion: 1,
                      },
                    }
                  : {}),
                planCompleted: Boolean(planOutcome),
                reflectionCompleted: Boolean(reflectionOutcome),
                updatedAt: new Date().toISOString(),
              });
              saveBase = {
                ...saveBase,
                worldState: reflectedWorld,
                pendingChapter: stagedPending,
                savedAt: new Date().toISOString(),
              };
              persist(saveBase);
              setSave(saveBase);
            }
          } catch (parallelError) {
            console.warn("narrative/reflection parallel stage failed:", parallelError);
          }
          if (narrativePlan) {
            setNovelPreview({ title: narrativePlan.titleDirection, scenes: [] });
          }
          const novel = await fetchNovel(
            result,
            worldBefore,
            span,
            1,
            narrativePlan,
            narrativeReferences,
            createNovelStreamCallbacks(setNovelPreview, setPlanProgress),
          );
          setNovelPreview({ title: novel.title, scenes: novel.scenes });
          if (saveBase.pendingChapter) {
            saveBase = {
              ...saveBase,
              pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, result.chapterId, "novel", {
                novel,
                novelCompleted: true,
                ...(narrativePlan
                  ? {
                      narrative: {
                        plan: narrativePlan,
                        referenceFragmentIds: narrativePlan.referenceFragmentIds,
                        directorVersion: 1,
                      },
                    }
                  : {}),
                updatedAt: new Date().toISOString(),
              }),
              savedAt: new Date().toISOString(),
            };
            persist(saveBase);
            setSave(saveBase);
          }
          // Galgame 章节不再把小说改写成只读对白；正式玩法直接使用下面的 LLM live 场景包。
          let dialogue: DialogueScene[] | undefined;
          if (saveBase.pendingChapter) {
            saveBase = {
              ...saveBase,
              pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, result.chapterId, "dialogue", {
                novel,
                dialogue,
                novelCompleted: true,
                dialogueCompleted: mode !== "galgame" || Boolean(dialogue),
                updatedAt: new Date().toISOString(),
              }),
              savedAt: new Date().toISOString(),
            };
            persist(saveBase);
            setSave(saveBase);
          }
          const chapter = assembleChapter({
            choice,
            selection: next,
            span,
            worldBefore,
            result,
            novel,
            narrativePlan,
            dialogue,
            worldStateAfter: saveBase.worldState,
          });
          setChapter(chapter);
          let scenePackage: ScenePackage;
          let liveScenePackage: ScenePackage | undefined;
          if (mode === "galgame") {
            setPlanProgress("正在生成 AI 互动场景…");
            liveScenePackage = await fetchLiveScenePackage(saveBase.worldState, result.simulation.events, chapter);
            scenePackage = liveScenePackage;
            if (saveBase.pendingChapter) {
              saveBase = {
                ...saveBase,
                pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, result.chapterId, "live_scene", {
                  liveScenePackage,
                  liveSceneCompleted: true,
                  updatedAt: new Date().toISOString(),
                }),
                savedAt: new Date().toISOString(),
              };
              persist(saveBase);
              setSave(saveBase);
            }
          } else {
            try {
              scenePackage = adaptDialogueScenes(dialogue ?? fallbackDialogueScenes(novel), {
                chapterId: chapter.id,
                year: chapter.endYear,
                version: 1,
              });
            } catch {
              scenePackage = adaptDialogueScenes(fallbackDialogueScenes(novel), {
                chapterId: chapter.id,
                year: chapter.endYear,
                version: 1,
              });
            }
          }
          const persistedScenePackage = saveBase.scenePackages?.[chapter.id] ?? scenePackage;
          const liveRuntime = hasLiveScene(persistedScenePackage)
            ? createSceneRuntime(persistedScenePackage, {
                branchId: saveBase.activeBranchId ?? "main",
              })
            : undefined;
          const completedSave: GameSave = {
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
            scenePackages: {
              ...(saveBase.scenePackages ?? {}),
              [chapter.id]: persistedScenePackage,
            },
            ...(liveRuntime ? { sceneRuntime: liveRuntime } : {}),
            savedAt: new Date().toISOString(),
          };
          const readySave: GameSave = completedSave.pendingChapter
            ? {
                ...completedSave,
                pendingChapter: updatePendingChapterStage(completedSave.pendingChapter, result.chapterId, "ready", {
                  novel: chapter.novel,
                  dialogue,
                  novelCompleted: true,
                  dialogueCompleted: mode !== "galgame" || Boolean(dialogue),
                  ...(liveScenePackage ? { liveScenePackage, liveSceneCompleted: true } : {}),
                  updatedAt: completedSave.savedAt,
                }),
              }
            : completedSave;
          const completedWithPending = readySave.pendingChapter
            ? completePendingChapter(readySave, result.chapterId, chapter, readySave.scenePackages?.[chapter.id] ?? scenePackage)
            : readySave;
          const finalSave = appendSnapshot(completedWithPending, { chapterId: chapter.id, now: completedWithPending.savedAt });
          persist(finalSave);
          setSave(finalSave);
          setScreen(liveRuntime ? "formal_scene" : "chapter_summary");
        } catch (err) {
          const message = err instanceof Error ? err.message : "小说生成失败";
          setError(message);
          if (saveBase.pendingChapter) {
            try {
              const failedSave = {
                ...saveBase,
                pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, result.chapterId, "error", {
                  error: { code: "PRESENTATION_STAGE_FAILED", message },
                  updatedAt: new Date().toISOString(),
                }),
                savedAt: new Date().toISOString(),
              };
              persist(failedSave);
              setSave(failedSave);
            } catch (persistError) {
              console.error("pending chapter error save failed", persistError);
            }
          }
        } finally {
          setNovelLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "世界推演失败");
      } finally {
        setSimulating(false);
      }
    },
    [mode, save, choice, span],
  );

  const handleRegenerateNovel = useCallback(async () => {
    if (!chapter || !simResult || !preWorld) return;
    setNovelLoading(true);
    setError("");
    setNovelPreview({ title: chapter.novel.title, scenes: [] });
    try {
      // 重写不触发 World Simulator，也不重新规划：沿用已保存的 Director 规划（如有）
      const novel = await fetchNovel(
        simResult,
        preWorld,
        span,
        chapter.novel.version + 1,
        chapter.narrative?.plan,
        [],
        createNovelStreamCallbacks(setNovelPreview, setPlanProgress),
      );
      setNovelPreview({ title: novel.title, scenes: novel.scenes });
      let dialogue = chapter.dialogue;
      if (mode === "galgame") {
        try {
          dialogue = await fetchDialogue(preWorld, simResult.simulation.events, novel, chapter.narrative?.plan);
        } catch (dialogueError) {
          console.warn(
            "dialogue regeneration fallback:",
            dialogueError instanceof Error ? dialogueError.message : dialogueError,
          );
          dialogue = fallbackDialogueScenes(novel);
        }
      }
      const updatedChapter: Chapter = { ...chapter, novel, ...(dialogue ? { dialogue } : {}) };
      setChapter(updatedChapter);
      setSave((prev) => {
        if (!prev) return prev;
        const next: GameSave = {
          ...prev,
          chapters: { ...prev.chapters, [updatedChapter.id]: updatedChapter },
          savedAt: new Date().toISOString(),
        };
        const refreshed = refreshActiveSnapshot(next, next.savedAt);
        persist(refreshed);
        return refreshed;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "小说重写失败");
    } finally {
      setNovelLoading(false);
    }
  }, [chapter, mode, simResult, preWorld, span]);

  const handleNextChapter = useCallback(() => {
    setChoice(null);
    setSelection(null);
    setSimResult(null);
    setChapter(null);
    setPreWorld(null);
    setNovelPreview({ title: "", scenes: [] });
    setPlanResult(null);
    setPlanProgress("");
    setCustomOpen(false);
    setCustomText("");
    setSelectedSnapshotId(null);
    setScreen("chapter_start");
  }, []);

  const handleTimelineSelect = useCallback(
    (nodeId: string) => {
      if (!save) return;
      const node = getTimelineNodes(save).find((item) => item.id === nodeId || item.snapshotId === nodeId);
      if (!node?.snapshotId) {
        setError("这个旧存档节点没有可用的历史快照。");
        return;
      }
      if (!getSnapshot(save, node.snapshotId)) {
        setError("历史快照不存在，请重新读取存档。");
        return;
      }
      if (screen !== "snapshot_view") setSnapshotReturnScreen(screen);
      setSelectedSnapshotId(node.snapshotId);
      setError("");
      setScreen("snapshot_view");
    },
    [save, screen],
  );

  const handleRestartFromSnapshot = useCallback(() => {
    if (!save || !selectedSnapshotId) return;
    try {
      const nextSave = createBranchFromSnapshot(save, selectedSnapshotId, {
        now: new Date().toISOString(),
      });
      persist(nextSave);
      setHasSave(true);
      setSave(nextSave);
      setError("");
      handleNextChapter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建人生分支失败");
    }
  }, [handleNextChapter, save, selectedSnapshotId]);

  const activeFormalSceneSession = chapter && save ? getLiveSceneSession(save, chapter.id) : null;

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
            <button type="button" className="life-vn-btn" onClick={handleStartNew}>
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

  if (screen === "mode_select") {
    return (
      <ModeSelect
        initialMode={mode}
        continueMode={entryIntent === "continue"}
        onSelect={handleModeSelect}
        onCancel={() => setScreen("landing")}
      />
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

  if (screen === "demo_scene" && save && demoPackage && save.sceneRuntime) {
    const demoWorld = save.worldState;
    const demoHero = demoWorld.characters[demoWorld.protagonistId];
    const demoPresentation = buildLifePresentation({ world: demoWorld, chapterEvents: [] });
    const demoProjection = projectGameSave(save, save.sceneRuntime, save.sceneActions, save.sceneFlags);
    const demoPackages = orderedDemoPackages(save);
    const demoPackageIndex = demoPackages.findIndex((item) => item.id === demoPackage.id && item.version === demoPackage.version);
    const nextDemoPackage = demoPackageIndex >= 0 ? demoPackages[demoPackageIndex + 1] : undefined;
    const demoBranchState = branchPanelData(save);
    return (
      <LifeShell
        chapterLabel="B · 中性玩法 Demo"
        title="Scene Runtime 可玩验证"
        yearRange={`${demoWorld.currentYear} 年 · synthetic`}
        brandLabel="中性玩法 Demo · synthetic"
        onBrandClick={handleExitDemo}
        left={
          <div>
            <div className="life-vn-pill" style={{ marginBottom: 10 }}>合成夹具，不写入正式存档</div>
            <Timeline
              chapters={Object.values(save.scenePackages ?? {}).map((item, index) => ({
                id: item.id,
                label: `测试章节 ${index + 1}`,
                title: item.id,
                summary: `${item.scenes.length} 个场景 · v${item.version}`,
                canSelect: false,
              }))}
            />
          </div>
        }
        right={
          <StatusHUD
            presentation={demoPresentation.protagonist}
            goals={demoHero?.state.currentGoals ?? []}
            dilemmas={demoHero?.state.currentDilemmas ?? []}
            relationships={demoPresentation.relationships}
          />
        }
        center={
          <div style={{ position: "absolute", inset: 0 }}>
            <SceneRuntimePlayer
              key={`${demoPackage.id}:v${demoPackage.version}`}
              scenePackage={demoPackage}
              initialState={save.sceneRuntime}
              projection={demoProjection}
              onSelect={handleDemoSelect}
              onPersistPosition={handleDemoPersistPosition}
            />
            {save.sceneRuntime.status === "completed" && nextDemoPackage && (
              <button
                type="button"
                className="life-vn-btn"
                style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5 }}
                onClick={handleDemoNextPackage}
                disabled={loading}
              >
                {loading ? "正在进入下一测试章节…" : "进入下一测试章节"}
              </button>
            )}
            {save.sceneRuntime.status === "completed" && !nextDemoPackage && (
              <div className="life-vn-pill" style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5 }}>
                三章中性玩法已完成
              </div>
            )}
          </div>
        }
        sheet={
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <b>当前运行时</b>
              <p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>
                {save.sceneRuntime.sceneId} / {save.sceneRuntime.blockId} · {save.sceneRuntime.status}
              </p>
            </div>
            <BranchPanel
              branches={demoBranchState.branches}
              checkpoints={demoBranchState.checkpoints}
              onSwitchBranch={handleDemoSwitchBranch}
              onCreateBranch={handleDemoCreateBranch}
              disabled={loading || save.sceneRuntime.status === "submitting"}
            />
          </div>
        }
      />
    );
  }

  if (screen === "formal_scene" && save && chapter && activeFormalSceneSession) {
    const formalWorld = save.worldState;
    const formalHero = formalWorld.characters[formalWorld.protagonistId];
    const formalEvents = chapter.simulationEventIds
      .map((id) => save.events[id])
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const formalPresentation = buildLifePresentation({
      world: formalWorld,
      chapter,
      chapterEvents: formalEvents,
    });
    const formalProjection = projectGameSave(
      save,
      activeFormalSceneSession.runtime,
      save.sceneActions,
      save.sceneFlags,
    );
    const formalBranchState = branchPanelData(save);
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(chapter.index + 1).padStart(2, "0")}`}
        title={chapter.novel.title}
        yearRange={`${chapter.startYear} → ${chapter.endYear}`}
        brandLabel="知乎 · 正式互动人生"
        onBrandClick={() => setScreen("landing")}
        left={
          <div>
            <div className="life-vn-pill" style={{ marginBottom: 10 }}>正式 live 场景 · 已从存档恢复</div>
            <Timeline
              chapters={getTimelineNodes(save).map(timelineItemFromSnapshot)}
              onSelect={handleTimelineSelect}
            />
          </div>
        }
        right={
          <StatusHUD
            presentation={formalPresentation.protagonist}
            goals={formalHero?.state.currentGoals ?? []}
            dilemmas={formalHero?.state.currentDilemmas ?? []}
            relationships={formalPresentation.relationships}
          />
        }
        center={
          <div style={{ position: "absolute", inset: 0 }}>
            <SceneRuntimePlayer
              key={`${activeFormalSceneSession.package.id}:v${activeFormalSceneSession.package.version}`}
              scenePackage={activeFormalSceneSession.package}
              initialState={activeFormalSceneSession.runtime}
              projection={formalProjection}
              onSelect={handleFormalSceneSelect}
              onPersistPosition={handleFormalScenePersistPosition}
            />
            {activeFormalSceneSession.runtime.status === "completed" && (
              <button
                type="button"
                className="life-vn-btn"
                style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5 }}
                onClick={handleNextChapter}
              >
                进入下一章
              </button>
            )}
          </div>
        }
        sheet={
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <b>当前运行时</b>
              <p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>
                {activeFormalSceneSession.runtime.sceneId} / {activeFormalSceneSession.runtime.blockId} · {activeFormalSceneSession.runtime.status}
              </p>
            </div>
            <BranchPanel
              branches={formalBranchState.branches}
              checkpoints={formalBranchState.checkpoints}
              onSwitchBranch={handleFormalSwitchBranch}
              onCreateBranch={handleFormalCreateBranch}
              disabled={loading || activeFormalSceneSession.runtime.status === "submitting"}
            />
          </div>
        }
      />
    );
  }

  if (screen === "pending_recovery" && save?.pendingChapter) {
    const pending = save.pendingChapter;
    const hasSimulation = Boolean(pending.simulationOutput && pending.resolution && pending.selection);
    return (
      <div className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div className="life-vn-card" style={{ maxWidth: 620, width: "100%" }}>
          <span className="life-vn-pill">检测到未完成章节</span>
          <h1 className="life-vn-title" style={{ fontSize: 24, marginTop: 14 }}>恢复本章表现</h1>
          <p className="life-vn-sub">
            世界推演已经保存，不会重复结算；恢复流程只补齐缺失的规划、小说或对白阶段。
          </p>
          <div className="life-vn-card" style={{ background: "rgba(255,252,244,.72)" }}>
            <div className="life-vn-change">章节：{pending.chapterId}</div>
            <div className="life-vn-change">已保存阶段：{pending.stage}</div>
            <div className="life-vn-change">宏观事件：{pending.eventIds.length} 条 · 现实经历引用：{pending.evidenceIds.length} 条</div>
            {pending.novelCompleted && <div className="life-vn-change">小说：已保存</div>}
            {pending.dialogueCompleted && <div className="life-vn-change">对白：已保存</div>}
            {pending.liveSceneCompleted && <div className="life-vn-change">AI互动场景：已保存</div>}
          </div>
          {error && <div className="life-vn-error" style={{ marginTop: 14 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <button
              type="button"
              className="life-vn-btn"
              onClick={handleResumePending}
              disabled={!hasSimulation || loading || novelLoading}
            >
              {novelLoading ? "正在恢复…" : pending.novel || pending.dialogue ? "完成章节恢复" : "继续生成本章"}
            </button>
            {!hasSimulation && <small style={{ color: "var(--lv-muted)", alignSelf: "center" }}>存档缺少安全恢复所需的结算材料。</small>}
          </div>
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
  const timelineItems = save ? getTimelineNodes(save).map(timelineItemFromSnapshot) : [];
  const formalSceneSession = chapter && save ? getLiveSceneSession(save, chapter.id) : null;
  const formalSceneProjection = save && formalSceneSession
    ? projectGameSave(save, formalSceneSession.runtime, save.sceneActions, save.sceneFlags)
    : undefined;
  const selectedSnapshot = save && selectedSnapshotId ? getSnapshot(save, selectedSnapshotId) : null;

  if (screen === "snapshot_view") {
    if (!selectedSnapshot || !save) {
      return (
        <div className="life-vn" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
          <div className="life-vn-card" style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
            <p>历史快照不存在或已经失效。</p>
            <button type="button" className="life-vn-btn ghost" onClick={() => setScreen(snapshotReturnScreen)}>
              返回当前人生
            </button>
          </div>
        </div>
      );
    }
    return (
      <SnapshotViewer
        snapshot={selectedSnapshot}
        presentationMode={mode}
        timeline={
          <Timeline
            chapters={timelineItems}
            onSelect={handleTimelineSelect}
            selectedId={selectedSnapshotId ?? undefined}
          />
        }
        onBack={() => {
          setSelectedSnapshotId(null);
          setError("");
          setScreen(snapshotReturnScreen);
        }}
        onRestart={handleRestartFromSnapshot}
      />
    );
  }

  if (screen === "decision" && choice && presentation && world) {
    if (mode === "novel") {
      return (
        <div className="life-vn" style={{ minHeight: "100vh", padding: "32px 20px 48px" }}>
          <div className="life-vn-card" style={{ maxWidth: 760, margin: "0 auto" }}>
            <div style={{ marginBottom: 18, color: "#6b7280", fontSize: 13 }}>
              Chapter {String(presentation.chapter.index + 1).padStart(2, "0")} · {presentation.chapter.yearRange}
            </div>
            <DecisionPanel choice={choice} onSelect={handleSelect} disabled={Boolean(selection)} />
            <div style={{ marginTop: 24, borderTop: "1px solid var(--lv-gold-line)", paddingTop: 16 }}>
              <div className="life-vn-hud-title">历史节点</div>
              <Timeline
                chapters={timelineItems}
                onSelect={handleTimelineSelect}
                selectedId={selectedSnapshotId ?? undefined}
              />
            </div>
            {selection && (
              <div className="life-vn-feedback" style={{ marginTop: 16 }}>
                {simulating
                  ? simProgress
                  : novelLoading
                    ? planProgress || "正在把本章写成小说…"
                    : error || "正在准备本章结果…"}
              </div>
            )}
            {selection && (
              <StreamingNovelPreview
                title={novelPreview.title}
                scenes={novelPreview.scenes}
                loading={simulating || novelLoading}
              />
            )}
          </div>
        </div>
      );
    }
    const sceneDef = findScene(DEFAULT_SCENE_ID) as NonNullable<ReturnType<typeof findScene>>;
    const options = choice.options.map((option) => ({ id: option.id, label: option.label }));
    const feedback = selection
      ? ""
      : "选择将影响这一年的走向——你决定行动，系统决定后果。";
    const decisionCharacter = hero
      ? protagonistDialogueCharacter(hero, presentation.protagonist.avatarUrl)
      : {
          id: world.protagonistId,
          name: presentation.protagonist.name,
          ...(presentation.protagonist.avatarUrl ? { avatarUrl: presentation.protagonist.avatarUrl } : {}),
          position: "center" as const,
        };
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(presentation.chapter.index + 1).padStart(2, "0")}`}
        title={choice.promptTitle}
        yearRange={presentation.chapter.yearRange}
        left={
          <Timeline
            chapters={[
              ...timelineItems,
              { id: "pending-decision", label: "本章 · 抉择", title: choice.promptTitle, active: true },
            ]}
            onSelect={handleTimelineSelect}
            selectedId={selectedSnapshotId ?? undefined}
          />
        }
        right={
          <StatusHUD
            presentation={presentation.protagonist}
            goals={hero?.state.currentGoals ?? []}
            dilemmas={hero?.state.currentDilemmas ?? []}
            relationships={presentation.relationships}
          />
        }
        center={
          <SceneStage
            scene={sceneDef}
            meta={`${world.currentYear} 年 · ${hero?.state.city || "未知"} · 夜`}
            characters={[decisionCharacter]}
            activeCharacterId={decisionCharacter.id}
            children={
              <DialogueBox
                copy={choice.context}
                options={selection ? undefined : options}
                selectedOptionId={selection?.optionId ?? null}
                feedback={feedback}
                onSelect={(id) => handleSelect({ optionId: id })}
                children={
                  selection ? (
                    <>
                      {simulating ? (
                        <div className="life-vn-feedback">{simProgress}</div>
                      ) : novelLoading ? (
                        <div className="life-vn-feedback">{planProgress || "正在把本章写成小说…"}</div>
                      ) : error ? (
                        <div className="life-vn-error">{error}</div>
                      ) : null}
                      <StreamingNovelPreview
                        title={novelPreview.title}
                        scenes={novelPreview.scenes}
                        loading={simulating || novelLoading}
                      />
                    </>
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
        timelineItems={timelineItems}
        onTimelineSelect={handleTimelineSelect}
        presentationMode={mode}
        scenePackage={formalSceneSession?.package}
        sceneRuntime={formalSceneSession?.runtime}
        sceneProjection={formalSceneProjection}
        onSceneSelect={handleFormalSceneSelect}
        onScenePersist={handleFormalScenePersistPosition}
        onBrandClick={() => setScreen("landing")}
      />
    );
  }

  // chapter_start
  if (presentation && world) {
    const sceneDef = findScene("urban-home-apartment-day-v1") as NonNullable<ReturnType<typeof findScene>>;
    const chapterNumber = world.chapterIds.length > 0 ? world.chapterIds.length + 1 : 1;
    const startCharacter = hero
      ? protagonistDialogueCharacter(hero, presentation.protagonist.avatarUrl)
      : {
          id: world.protagonistId,
          name: presentation.protagonist.name,
          ...(presentation.protagonist.avatarUrl ? { avatarUrl: presentation.protagonist.avatarUrl } : {}),
          position: "center" as const,
        };
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(chapterNumber).padStart(2, "0")}`}
        title={world.chapterIds.length > 0 ? `第 ${chapterNumber} 章 · 开始` : "第一章 · 开始"}
        yearRange={`${world.currentYear} 年起`}
        left={
          <Timeline
            chapters={[
              ...timelineItems,
              { id: "pending-start", label: "本章 · 起点", title: `${world.currentYear} 年`, active: true },
            ]}
            onSelect={handleTimelineSelect}
            selectedId={selectedSnapshotId ?? undefined}
          />
        }
        right={
          <StatusHUD
            presentation={presentation.protagonist}
            goals={hero?.state.currentGoals ?? []}
            dilemmas={hero?.state.currentDilemmas ?? []}
            relationships={presentation.relationships}
          />
        }
        center={
          <SceneStage
            scene={sceneDef}
            meta={`${world.currentYear} 年 · ${hero?.state.city || "未知"} · 日`}
            characters={[startCharacter]}
            activeCharacterId={startCharacter.id}
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
  callbacks: NovelStreamCallbacks = {},
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
      stream: Boolean(narrativePlan?.scenes?.length),
    }),
  });
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const streamed = await readSseComplete<{ novel: Chapter["novel"] }>(
      response,
      callbacks.onProgress ?? (() => undefined),
      (event, payload) => {
        if (!payload || typeof payload !== "object") return;
        const data = payload as Record<string, unknown>;
        const sceneIndex = typeof data.sceneIndex === "number" ? data.sceneIndex : -1;
        if (sceneIndex < 0) return;
        if (event === "scene_start" && data.scenePlan && typeof data.scenePlan === "object") {
          callbacks.onSceneStart?.(sceneIndex, data.scenePlan as ScenePlan);
        } else if (event === "delta" && typeof data.delta === "string") {
          callbacks.onDelta?.(sceneIndex, data.delta);
        } else if (event === "scene" && data.scene && typeof data.scene === "object") {
          callbacks.onScene?.(
            sceneIndex,
            data.scene as Chapter["novel"]["scenes"][number],
          );
        }
      },
    );
    return streamed.novel;
  }
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
  dialogue?: DialogueScene[];
  worldStateAfter?: WorldState;
}): Chapter {
  const { choice, selection, span, worldBefore, result, novel, narrativePlan, dialogue, worldStateAfter } = args;
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
    ...(dialogue?.length ? { dialogue } : {}),
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
