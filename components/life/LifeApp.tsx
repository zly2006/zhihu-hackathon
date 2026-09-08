"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Character } from "@/lib/domain/character";
import type {
  Chapter,
  ChapterNovel,
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
import type { RuntimeBlock, SceneChoiceResponse, ScenePackage, SceneRuntimeState } from "@/lib/domain/scene";
import type { StoryUnit } from "@/lib/domain/story";
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
import {
  beginChapterSubmission,
  canRechooseChapterSubmission,
  failChapterSubmission,
  idleChapterSubmission,
  commitChapterSubmission,
  retryChapterSubmission,
  toChapterSubmissionDiagnostic,
  type ChapterSelectionInput,
  type ChapterSubmissionState,
} from "@/lib/game/chapter-submission";
import { compileSceneActionContext } from "@/lib/game/scene-action-context";
import { createSceneRuntime, transitionSceneRuntime } from "@/lib/game/scene-runtime";
import { createRevealCursor, revealStoryUnit } from "@/lib/game/story-reveal";
import { validatePublishedStoryUnit } from "@/lib/game/story-generation-validator";
import {
  beginStoryAction,
  commitCanonical,
  createStorySession,
  failStorySession,
  markStoryDisplayed,
  markStoryPresentationReady,
  publishStoryUnit,
  reachStoryBoundary,
} from "@/lib/game/story-session";
import { createStoryInputFingerprint } from "@/lib/game/story-input";
import {
  DEFAULT_SCENE_READING_PREFERENCES,
  normalizeSceneReadingPreferences,
  recordSceneBlockRead,
  type SceneReadingBlockInput,
  type SceneReadingPreferences,
} from "@/lib/game/scene-reading";
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
import { StoryPlayer } from "@/components/life-vn/StoryPlayer";
import { SceneReadingLog, SceneReadingTools } from "@/components/life-vn/SceneReadingTools";
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
  scenes: ChapterNovel["scenes"];
};

type NovelStreamCallbacks = {
  onProgress?: (message: string) => void;
  onSceneStart?: (sceneIndex: number, scenePlan: ScenePlan) => void;
  onDelta?: (sceneIndex: number, delta: string) => void;
  onScene?: (sceneIndex: number, scene: ChapterNovel["scenes"][number]) => void;
};

type SimulateResult = {
  chapterId: string;
  evidenceBundle: EvidenceBundle;
  resolution: DecisionResolution;
  simulation: WorldSimulationOutput;
  worldStateAfter: WorldState;
  stateBeforeHash: string;
  stateAfterHash: string;
  executionId?: string;
  requestCount?: number;
  elapsedMs?: number;
  deadlineAt?: number;
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
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string | { message?: string } } | null;
    const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
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
      if (event === "progress" || event === "heartbeat") {
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

function fallbackDialogueScenes(novel: ChapterNovel): DialogueScene[] {
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
  novel: ChapterNovel,
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

async function fetchInteractiveStoryUnit(
  world: WorldState,
  events: WorldSimulationOutput["events"],
  chapter: Chapter,
  onProgress: (message: string) => void,
  branchId = "main",
  options: {
    unitId?: string;
    requiredEventIds?: string[];
    revealedEventIds?: string[];
    isFinalUnit?: boolean;
    nextUnitId?: string;
    requestId?: string;
  } = {},
): Promise<StoryUnit> {
  let unit: StoryUnit | undefined;
  const response = await fetch("/api/story/prepare", {
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
      },
      unitId: options.unitId ?? `chapter-${chapter.id}-unit-1`,
      ...(options.requiredEventIds ? { requiredEventIds: options.requiredEventIds } : {}),
      ...(options.revealedEventIds ? { revealedEventIds: options.revealedEventIds } : {}),
      ...(options.isFinalUnit !== undefined ? { isFinalUnit: options.isFinalUnit } : {}),
      ...(options.nextUnitId ? { nextUnitId: options.nextUnitId } : {}),
      saveId: world.gameId,
      runId: world.gameId,
      branchId,
      requestId: options.requestId ?? `story-${chapter.id}-${crypto.randomUUID()}`,
    }),
  });
  await readSseComplete<{ unitId: string }>(response, onProgress, (event, payload) => {
    if (event === "unit_ready" && payload && typeof payload === "object" && "unit" in payload) {
      unit = validatePublishedStoryUnit((payload as { unit: unknown }).unit);
    }
  });
  if (!unit) throw new Error("互动单元服务未发布完整内容");
  return unit;
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
  const [readingPreferences, setReadingPreferences] = useState<SceneReadingPreferences>(DEFAULT_SCENE_READING_PREFERENCES);
  const [readingLogOpen, setReadingLogOpen] = useState(false);
  const [readingSheetOpen, setReadingSheetOpen] = useState(false);
  const [pauseAfterReadingLog, setPauseAfterReadingLog] = useState(false);

  const [span, setSpan] = useState<ChapterSpan>(1);
  const [choice, setChoice] = useState<ChapterChoice | null>(null);
  const [choiceProgress, setChoiceProgress] = useState("");
  const [selection, setSelection] = useState<ChapterSelectionInput | null>(null);
  const [submission, setSubmission] = useState<ChapterSubmissionState>(idleChapterSubmission);
  const submissionInFlight = useRef(false);
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
  const [hasPendingFormalSceneCommit, setHasPendingFormalSceneCommit] = useState(false);
  const [continuationLoading, setContinuationLoading] = useState(false);
  const [continuationError, setContinuationError] = useState("");
  const continuationInFlight = useRef<string | null>(null);
  const pendingFormalSceneCommit = useRef<{
    key: string;
    save: GameSave;
    response: SceneChoiceResponse;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("restart-life-reading-preferences-v1");
      if (raw) setReadingPreferences(normalizeSceneReadingPreferences(JSON.parse(raw)));
    } catch {
      setReadingPreferences(DEFAULT_SCENE_READING_PREFERENCES);
    }
  }, []);

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
        chapterSubmission: toChapterSubmissionDiagnostic(submission),
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
        activeScene: chapter ? { index: chapter.index, title: chapter.novel?.title ?? "互动人生" } : null,
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
  }, [screen, save, choice, selection, loading, error, chapter, selectedSnapshotId, demoPackage, syntheticDemo, submission]);

  useEffect(() => {
    if (submission.phase !== "idle") {
      console.info("[chapter-submission]", toChapterSubmissionDiagnostic(submission));
    }
  }, [submission]);

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
    const revealCursor = save.storyReveal?.chapterId === pending.chapterId
      ? save.storyReveal
      : createRevealCursor({
          chapterId: pending.chapterId,
          worldBefore: pending.worldStateBefore,
          worldAfter: pending.worldStateAfter,
          eventIds: pending.eventIds,
        });
    let workingSave: GameSave = { ...save, storyReveal: revealCursor };
    let recoveredUnit: StoryUnit | undefined;
    setLoading(true);
    setNovelLoading(true);
    setError("");
    try {
      let novel = pending.novel;
      if (mode !== "galgame" && !novel) {
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
      if (novel) setNovelPreview({ title: novel.title, scenes: novel.scenes });

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
        if (!novel) {
          const unit = await fetchInteractiveStoryUnit(
            workingSave.worldState,
            result.simulation.events,
            recoveredChapter,
            setPlanProgress,
            workingSave.activeBranchId ?? "main",
          );
          if (unit.payload.kind !== "scene") throw new Error("恢复的互动单元不是可播放场景");
          recoveredUnit = unit;
          scenePackage = unit.payload.package;
        } else {
          scenePackage = await fetchLiveScenePackage(workingSave.worldState, result.simulation.events, recoveredChapter);
        }
      }
      if (!scenePackage) {
        if (!novel) throw new Error("待恢复章节缺少可播放互动内容");
        scenePackage = adaptDialogueScenes(dialogue ?? fallbackDialogueScenes(novel), {
          chapterId: recoveredChapter.id,
          year: recoveredChapter.endYear,
          version: 1,
        });
      }
      const liveScenePackage = hasLiveScene(scenePackage) ? scenePackage : undefined;
      if (liveScenePackage && !recoveredUnit) {
        const storyIdentity = workingSave.storySession?.identity ?? {
          saveId: workingSave.worldState.gameId,
          runId: workingSave.worldState.gameId,
          branchId: workingSave.activeBranchId ?? "main",
          source: "life_ai" as const,
          contentVersion: "life-ai-v1",
          pipelineVersion: 2,
        };
        recoveredUnit = {
          id: recoveredChapter.presentation?.unitIds.at(-1) ?? liveScenePackage.id,
          identity: storyIdentity,
          inputFingerprint: workingSave.storySession?.journal?.inputFingerprint ?? createStoryInputFingerprint({
            ...storyIdentity,
            unitId: recoveredChapter.presentation?.unitIds.at(-1) ?? liveScenePackage.id,
            facts: { chapterId: recoveredChapter.id, packageId: liveScenePackage.id },
          }),
          phase: "live",
          sourceEventIds: liveScenePackage.scenes.flatMap((scene) => scene.sourceEventIds),
          payload: { kind: "scene", package: liveScenePackage },
        };
      }
      const recoveredChapterWithPresentation = mode === "galgame"
        ? { ...recoveredChapter, presentation: { mode: "galgame" as const, unitIds: [recoveredUnit?.id ?? scenePackage.id], status: "ready" as const } }
        : recoveredChapter;
      const recoveredRuntime =
        workingSave.sceneRuntime?.chapterId === recoveredChapter.id &&
        workingSave.sceneRuntime.packageId === scenePackage.id &&
        workingSave.sceneRuntime.packageVersion === scenePackage.version
          ? workingSave.sceneRuntime
          : hasLiveScene(scenePackage)
            ? createSceneRuntime(scenePackage, { branchId: workingSave.activeBranchId ?? "main" })
            : undefined;
      const now = new Date().toISOString();
      let recoveredStorySession = workingSave.storySession;
      if (recoveredStorySession?.journal?.phase === "failed" && recoveredStorySession.journal.canonicalReceiptId) {
        const { error: _journalError, ...journal } = recoveredStorySession.journal;
        recoveredStorySession = {
          ...recoveredStorySession,
          status: "canonical_committed",
          journal: { ...journal, phase: "canonical_committed" },
          lastError: undefined,
        };
      }
      if (liveScenePackage && recoveredUnit && recoveredStorySession) {
        recoveredStorySession = publishStoryUnit(recoveredStorySession, recoveredUnit, now);
      }
      workingSave = {
        ...workingSave,
        ...(recoveredStorySession ? { storySession: recoveredStorySession } : {}),
        chapters: { ...workingSave.chapters, [recoveredChapter.id]: recoveredChapterWithPresentation },
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
              ...(recoveredChapter.novel ? { novel: recoveredChapter.novel } : {}),
              dialogue,
              novelCompleted: mode !== "galgame" && Boolean(recoveredChapter.novel),
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
        ? completePendingChapter(workingSave, pending.executionId, recoveredChapterWithPresentation, scenePackage)
        : workingSave;
      const finalSave = appendSnapshot(completedSave, { chapterId: recoveredChapter.id, now });
      persist(finalSave);
      setSave(finalSave);
      setChoice(recoveredChoice);
      setSelection(recoveredSelection);
      setPreWorld(pending.worldStateBefore);
      setSimResult(result);
      setChapter(recoveredChapterWithPresentation);
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
      const response = await fetch("/api/story/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionKind: "scene_choice", projection, package: demoPackage, ...input }),
      });
      const actionPayload = await readSseComplete<{ response: SceneChoiceResponse }>(response, () => {});
      const data = actionPayload.response;
      if (!data) throw new Error("故事行动未返回有效场景结果");
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
      const now = new Date().toISOString();
      let nextSave = saveLiveScenePosition(previous, runtime, packageItem, now);
      const storySessionBeforeBoundary = nextSave.storySession;
      const ownsStoryPackage = storySessionBeforeBoundary
        && (storySessionBeforeBoundary.activeUnitId === packageItem.id
          || nextSave.chapters[runtime.chapterId]?.presentation?.unitIds.includes(storySessionBeforeBoundary.activeUnitId ?? ""));
      if (runtime.status === "awaiting_choice" && storySessionBeforeBoundary && ownsStoryPackage) {
        nextSave = { ...nextSave, storySession: reachStoryBoundary(storySessionBeforeBoundary, now) };
      }
      if (runtime.status === "completed") {
        const currentChapter = nextSave.chapters[runtime.chapterId];
        if (runtime.completion?.kind !== "unit_end" && currentChapter?.presentation && currentChapter.presentation.status !== "complete") {
          nextSave = {
            ...nextSave,
            chapters: {
              ...nextSave.chapters,
              [runtime.chapterId]: {
                ...currentChapter,
                presentation: { ...currentChapter.presentation, status: "complete" },
              },
            },
          };
          setChapter(nextSave.chapters[runtime.chapterId]);
        }
        const storySessionAfterBoundary = nextSave.storySession;
        const ownsStoryPackage = storySessionAfterBoundary
          && (storySessionAfterBoundary.activeUnitId === packageItem.id
            || nextSave.chapters[runtime.chapterId]?.presentation?.unitIds.includes(storySessionAfterBoundary.activeUnitId ?? ""));
        if (storySessionAfterBoundary && ownsStoryPackage) {
          nextSave = { ...nextSave, storySession: reachStoryBoundary(storySessionAfterBoundary, now) };
        }
      }
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
      const commitKey = [
        session.runtime.branchId,
        scenePackage.chapterId,
        scenePackage.id,
        scenePackage.version,
        session.runtime.sceneId,
        session.runtime.blockId,
        input.choiceId,
      ].join(":");
      const pendingCommit = pendingFormalSceneCommit.current;
      if (pendingCommit?.key === commitKey) {
        try {
          window.localStorage.setItem(SAVE_KEY, serializeSceneSave(pendingCommit.save));
        } catch {
          throw new Error("正式场景结果仍未保存，请重试保存；不会重新结算这次选择。");
        }
        pendingFormalSceneCommit.current = null;
        setHasPendingFormalSceneCommit(false);
        setSave(pendingCommit.save);
        return pendingCommit.response;
      }
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
      const storyIdentity = save.storySession?.identity ?? {
        saveId: save.worldState.gameId,
        runId: save.worldState.gameId,
        branchId: save.activeBranchId ?? session.runtime.branchId,
        source: "life_ai" as const,
        contentVersion: "life-ai-v1",
        pipelineVersion: 2,
      };
      const storyInputFingerprint = createStoryInputFingerprint({
        ...storyIdentity,
        unitId: `${scenePackage.id}:${session.runtime.sceneId}:${session.runtime.blockId}`,
        facts: { actionKind: "scene_choice", choiceId: input.choiceId, runtime: session.runtime },
      });
      let storyState = checkpointedSave.storySession ?? createStorySession({ identity: storyIdentity, now: input.issuedAt });
      const ownsStoryPackage = storyState.activeUnitId === scenePackage.id
        || checkpointedSave.chapters[scenePackage.chapterId]?.presentation?.unitIds.includes(storyState.activeUnitId ?? "");
      if (storyState.status === "presenting" && ownsStoryPackage) {
        storyState = reachStoryBoundary(storyState, input.issuedAt);
      }
      const startedStoryState = beginStoryAction(storyState, {
        requestId: input.requestId,
        actionKind: "scene_choice",
        inputFingerprint: storyInputFingerprint,
        expectedRevision: storyState.canonicalRevision,
        now: input.issuedAt,
      });
      const journaledSave: GameSave = { ...checkpointedSave, storySession: startedStoryState, savedAt: input.issuedAt };
      persist(journaledSave);
      const projection = projectGameSave(
        journaledSave,
        journaledSave.sceneRuntime ?? session.runtime,
        journaledSave.sceneActions,
        journaledSave.sceneFlags,
      );
      const response = await fetch("/api/story/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionKind: "scene_choice", projection, package: scenePackage, ...input }),
      });
      const actionPayload = await readSseComplete<{ response: SceneChoiceResponse }>(response, () => {});
      const data = actionPayload.response;
      if (!data) throw new Error("故事行动未返回有效场景结果");
      const nextProjection = commitSceneChoice(projection, data);
      // The server response is deliberately flow-policy agnostic. Persist the
      // same seamless runtime that the formal player presents so a refresh at
      // this boundary cannot resurrect a one-click feedback confirmation.
      const startedRuntime = transitionSceneRuntime(scenePackage, projection.runtime, {
        type: "SELECT_STARTED",
        requestId: input.requestId,
        choiceId: input.choiceId,
        issuedAt: input.issuedAt,
        expectedRevision: input.expectedRevision,
      });
      const seamlessRuntime = transitionSceneRuntime(scenePackage, startedRuntime, {
        type: "SELECT_SUCCEEDED",
        flowPolicy: "seamless",
        record: data.record,
      });
      const persistedProjection = { ...nextProjection, runtime: seamlessRuntime };
      const canonicalStoryState = commitCanonical(startedStoryState, {
        requestId: input.requestId,
        receiptId: data.record.id,
        canonicalRevision: startedStoryState.canonicalRevision + 1,
        now: new Date().toISOString(),
      });
      const activeUnitId = journaledSave.chapters[scenePackage.chapterId]?.presentation?.unitIds.at(-1) ?? scenePackage.id;
      const presentedStoryState = markStoryPresentationReady(canonicalStoryState, activeUnitId, new Date().toISOString());
      const nextSave = { ...mergeSceneProjection(journaledSave, persistedProjection), storySession: presentedStoryState };
      const activeBranch = nextSave.branches?.[nextSave.activeBranchId ?? "main"];
      const checkpointHead = activeBranch?.headSnapshotId ? nextSave.snapshots?.[activeBranch.headSnapshotId] : undefined;
      const persistedSave = appendSceneChoiceCheckpoint(nextSave, {
        chapterId: scenePackage.chapterId,
        packageId: scenePackage.id,
        packageVersion: scenePackage.version,
        sceneId: seamlessRuntime.sceneId,
        blockId: seamlessRuntime.blockId,
        sequence: (checkpointHead?.sequence ?? 0) + 1,
        runtime: seamlessRuntime,
        actions: nextSave.sceneActions,
        flags: nextSave.sceneFlags,
        now: new Date().toISOString(),
      });
      try {
        window.localStorage.setItem(SAVE_KEY, serializeSceneSave(persistedSave));
      } catch {
        pendingFormalSceneCommit.current = { key: commitKey, save: persistedSave, response: data };
        setHasPendingFormalSceneCommit(true);
        throw new Error("正式场景结果保存失败，请重试保存；不会重新结算这次选择。");
      }
      pendingFormalSceneCommit.current = null;
      setHasPendingFormalSceneCommit(false);
      setSave(persistedSave);
      return data;
    },
    [save],
  );

  const updateReadingPreferences = useCallback((next: SceneReadingPreferences) => {
    const normalized = normalizeSceneReadingPreferences(next);
    setReadingPreferences(normalized);
    try {
      window.localStorage.setItem("restart-life-reading-preferences-v1", JSON.stringify(normalized));
    } catch {
      // 阅读偏好不可写时继续使用当前页面的内存值。
    }
  }, []);

  const handleReadingLogOpen = useCallback(() => {
    setPauseAfterReadingLog(true);
    setReadingLogOpen(true);
  }, []);

  const handleReadingLogClose = useCallback(() => setReadingLogOpen(false), []);

  const handleFormalPlaybackModeChange = useCallback((nextMode: SceneRuntimeState["playbackMode"]) => {
    if (nextMode === "auto") setPauseAfterReadingLog(false);
  }, []);

  const handleFormalSceneBlockRead = useCallback((input: {
    block: RuntimeBlock;
    state: SceneRuntimeState;
    source: "button" | "click" | "keyboard" | "auto";
    choiceId?: "A" | "B" | "C";
    selectedChoiceLabel?: string;
  }) => {
    setSave((previous) => {
      if (!previous?.sceneRuntime) return previous;
      if (
        previous.sceneRuntime.branchId !== input.state.branchId ||
        previous.sceneRuntime.packageId !== input.state.packageId ||
        previous.sceneRuntime.packageVersion !== input.state.packageVersion
      ) return previous;
      const blockType: SceneReadingBlockInput["blockType"] = input.block.content.type === "choice"
        ? "choice"
        : input.block.content.type;
      const readingInput: SceneReadingBlockInput = {
        mode: previous.chapters[input.state.chapterId]?.presentation?.mode ?? "life_ai",
        branchId: input.state.branchId,
        chapterId: input.state.chapterId,
        packageId: input.state.packageId,
        packageVersion: input.state.packageVersion,
        sceneId: input.state.sceneId,
        blockId: input.state.blockId,
        blockType,
        text: input.block.content.text,
        ...(input.block.content.type === "dialogue" && input.block.content.speaker ? { speaker: input.block.content.speaker } : {}),
        ...(input.choiceId ? { selectedChoiceId: input.choiceId } : {}),
        ...(input.selectedChoiceLabel ? { selectedChoiceLabel: input.selectedChoiceLabel } : {}),
      };
      const now = new Date().toISOString();
      const nextReading = recordSceneBlockRead(previous.sceneReading, readingInput, now);
      const activeChapter = previous.chapters[input.state.chapterId];
      const activeUnitId = activeChapter?.presentation?.unitIds.at(-1);
      const shouldMarkDisplayed = Boolean(
        previous.storySession
        && activeUnitId
        && previous.storySession.publishedUnitIds.includes(activeUnitId)
        && !previous.storySession.trace.displayed,
      );
      if (JSON.stringify(nextReading) === JSON.stringify(previous.sceneReading) && !shouldMarkDisplayed) return previous;
      const next = {
        ...previous,
        sceneReading: nextReading,
        ...(shouldMarkDisplayed && previous.storySession && activeUnitId
          ? { storySession: markStoryDisplayed(previous.storySession, activeUnitId, now) }
          : {}),
        savedAt: now,
      };
      persist(next);
      return next;
    });
  }, []);

  const handleFormalSceneBoundary = useCallback(async (input: {
    completedRuntime: SceneRuntimeState;
    source: "button" | "click" | "keyboard" | "auto";
  }) => {
    const current = save;
    const runtime = input.completedRuntime;
    const completion = runtime.completion;
    const activeChapter = current?.chapters[runtime.chapterId] ?? chapter;
    if (!current || !completion || !activeChapter) return;
    const packageItem = current.scenePackages?.[runtime.chapterId];
    if (!packageItem || packageItem.id !== runtime.packageId || packageItem.version !== runtime.packageVersion) return;
    const now = new Date().toISOString();
    if (completion.kind !== "unit_end") {
      let nextSave = { ...current, sceneRuntime: runtime, savedAt: now };
      if (nextSave.storyReveal) {
        nextSave = {
          ...nextSave,
          storyReveal: revealStoryUnit(nextSave.storyReveal, {
            unitId: nextSave.storyReveal.activeUnitId ?? packageItem.id,
            coveredEventIds: packageItem.scenes.flatMap((scene) => scene.sourceEventIds),
            boundary: completion,
            worldAfter: nextSave.worldState,
          }),
        };
      }
      const chapterForSave = nextSave.chapters[runtime.chapterId];
      if (chapterForSave?.presentation && (completion.kind === "chapter_end" || completion.kind === "ending")) {
        const completedChapter = {
          ...chapterForSave,
          presentation: { ...chapterForSave.presentation, status: "complete" as const },
        };
        nextSave = { ...nextSave, chapters: { ...nextSave.chapters, [runtime.chapterId]: completedChapter } };
        setChapter(completedChapter);
      }
      persist(nextSave);
      setSave(nextSave);
      return;
    }

    const boundaryKey = `${runtime.branchId}:${runtime.chapterId}:${runtime.packageId}:v${runtime.packageVersion}:${completion.unitId}:${current.saveRevision ?? 0}`;
    if (continuationInFlight.current === boundaryKey) return;
    continuationInFlight.current = boundaryKey;
    setContinuationLoading(true);
    setContinuationError("");
    let boundarySave = { ...current, sceneRuntime: runtime, savedAt: now };
    if (boundarySave.storyReveal) {
      boundarySave = {
        ...boundarySave,
        storyReveal: revealStoryUnit(boundarySave.storyReveal, {
          unitId: boundarySave.storyReveal.activeUnitId ?? packageItem.id,
          coveredEventIds: packageItem.scenes.flatMap((scene) => scene.sourceEventIds),
          boundary: completion,
        }),
      };
    }
    persist(boundarySave);
    setSave(boundarySave);
    try {
      const chapterEvents = Object.values(boundarySave.events).filter((event) => event.chapterId === runtime.chapterId);
      const nextUnitNumber = (activeChapter.presentation?.unitIds.length ?? 1) + 1;
      const requiredEventIds = boundarySave.storyReveal?.requiredEventIds ?? activeChapter.simulationEventIds;
      const revealedEventIds = boundarySave.storyReveal?.revealedEventIds ?? [];
      const isFinalUnit = requiredEventIds.every((eventId) => revealedEventIds.includes(eventId));
      const nextUnitId = `chapter-${runtime.chapterId}-unit-${nextUnitNumber}`;
      const unit = await fetchInteractiveStoryUnit(
        boundarySave.worldState,
        chapterEvents,
        activeChapter,
        (message) => setPlanProgress(message),
        boundarySave.activeBranchId ?? runtime.branchId,
        {
          unitId: nextUnitId,
          requiredEventIds,
          revealedEventIds,
          isFinalUnit,
          nextUnitId: `chapter-${runtime.chapterId}-unit-${nextUnitNumber + 1}`,
          requestId: `${runtime.chapterId}:prepare:${nextUnitId}`,
        },
      );
      if (unit.payload.kind !== "scene") throw new Error("后续互动单元不是可播放场景");
      const nextPackage = unit.payload.package;
      const nextRuntime = createSceneRuntime(nextPackage, { branchId: boundarySave.activeBranchId ?? runtime.branchId });
      const presentation = activeChapter.presentation ?? { mode: "galgame" as const, unitIds: [], status: "ready" as const };
      const nextChapter = {
        ...activeChapter,
        presentation: { ...presentation, mode: "galgame" as const, unitIds: [...presentation.unitIds, unit.id], status: "ready" as const },
      };
      const publishedSession = boundarySave.storySession
        ? publishStoryUnit(boundarySave.storySession, unit, new Date().toISOString())
        : boundarySave.storySession;
      const nextSave: GameSave = {
        ...boundarySave,
        chapters: { ...boundarySave.chapters, [runtime.chapterId]: nextChapter },
        scenePackages: { ...(boundarySave.scenePackages ?? {}), [runtime.chapterId]: nextPackage },
        sceneRuntime: nextRuntime,
        ...(boundarySave.storyReveal ? { storyReveal: { ...boundarySave.storyReveal, activeUnitId: unit.id } } : {}),
        ...(publishedSession ? { storySession: publishedSession } : {}),
        savedAt: new Date().toISOString(),
      };
      persist(nextSave);
      setSave(nextSave);
      setChapter(nextChapter);
      setContinuationLoading(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "后续互动单元准备失败";
      setContinuationError(message);
      setContinuationLoading(false);
    } finally {
      continuationInFlight.current = null;
    }
  }, [chapter, save]);

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
      setSubmission(idleChapterSubmission);
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
    async (next: ChapterSelectionInput) => {
      if (!save || !choice) return;
      if (
        submissionInFlight.current ||
        submission.phase === "submitting" ||
        submission.phase === "committed" ||
        submission.phase === "presentation_failed"
      ) return;
      const retryingSameDecision =
        submission.decisionId === choice.id &&
        submission.selection?.optionId === next.optionId &&
        submission.selection?.customAction === next.customAction;
      const attempt = retryingSameDecision
        ? retryChapterSubmission(submission, new Date().toISOString())
        : beginChapterSubmission({
            requestId: crypto.randomUUID(),
            decisionId: choice.id,
            selection: next,
            startedAt: new Date().toISOString(),
      });
      if (attempt.phase !== "submitting") return;
      const requestId = attempt.requestId;
      if (!requestId) throw new Error("故事行动缺少 requestId");
      submissionInFlight.current = true;
      setSubmission(attempt);
      setSelection(next);
      setSimulating(true);
      setSimProgress("故事正在展开…");
      setNovelPreview({ title: "", scenes: [] });
      const worldBefore = save.worldState;
      setPreWorld(worldBefore);
      let latestStorySave: GameSave = save;
      try {
        const storyIdentity = {
          saveId: save.worldState.gameId,
          runId: save.worldState.gameId,
          branchId: save.activeBranchId ?? "main",
          source: "life_ai" as const,
          contentVersion: "life-ai-v1",
          pipelineVersion: 2,
        };
        const storyInputFingerprint = createStoryInputFingerprint({
          ...storyIdentity,
          unitId: choice.id,
          facts: { choice, selection: next, span, sceneActionContext: compileSceneActionContext(save) },
        });
        const journalNow = new Date().toISOString();
        const storySession = beginStoryAction(
          save.storySession ?? createStorySession({ identity: storyIdentity, now: journalNow }),
          {
            requestId,
            actionKind: "chapter_decision",
            inputFingerprint: storyInputFingerprint,
            expectedRevision: save.storySession?.canonicalRevision ?? 0,
            now: journalNow,
          },
        );
        const journaledSave: GameSave = { ...save, storySession, savedAt: journalNow };
        latestStorySave = journaledSave;
        persist(journaledSave);
        setSave(journaledSave);
        let canonicalResult: SimulateResult | undefined;
        let canonicalSave: GameSave | undefined;
        let streamedUnit: StoryUnit | undefined;
        const commitCanonicalResult = (nextResult: SimulateResult): GameSave => {
          if (canonicalSave) return canonicalSave;
          const pending = createPendingChapter({
            executionId: nextResult.executionId ?? nextResult.chapterId,
            chapterId: nextResult.chapterId,
            startYear: worldBefore.currentYear,
            endYear: worldBefore.currentYear + span,
            stateBeforeHash: nextResult.stateBeforeHash,
            stateAfterHash: nextResult.stateAfterHash,
            worldStateBefore: worldBefore,
            worldStateAfter: nextResult.worldStateAfter,
            selection: buildChapterDecision(choice, next),
            resolution: nextResult.resolution,
            simulationOutput: nextResult.simulation,
            eventIds: nextResult.simulation.events.map((event) => event.id),
            evidenceIds: allEvidence(nextResult.evidenceBundle).map((experience) => experience.id),
            featuredExperienceIds: [
              ...nextResult.evidenceBundle.decisionSimilar,
              ...nextResult.evidenceBundle.outcomeContrasts,
              ...nextResult.evidenceBundle.backgroundSimilar,
            ].slice(0, 5).map((experience) => experience.id),
            createdAt: new Date().toISOString(),
          });
          const committedSession = commitCanonical(storySession, {
            requestId,
            receiptId: nextResult.chapterId,
            canonicalRevision: storySession.canonicalRevision + 1,
            now: new Date().toISOString(),
          });
          canonicalResult = nextResult;
          canonicalSave = {
            ...journaledSave,
            storySession: committedSession,
            worldState: nextResult.worldStateAfter,
            storyReveal: createRevealCursor({
              chapterId: nextResult.chapterId,
              worldBefore,
              worldAfter: nextResult.worldStateAfter,
              eventIds: nextResult.simulation.events.map((event) => event.id),
            }),
            pendingChapter: pending,
            saveRevision: (save.saveRevision ?? 0) + 1,
            savedAt: new Date().toISOString(),
          };
          latestStorySave = canonicalSave;
          setSimResult(nextResult);
          setSimulating(false);
          setSubmission((current) =>
            current.requestId === attempt.requestId
              ? commitChapterSubmission(current, { chapterId: nextResult.chapterId, finishedAt: new Date().toISOString() })
              : current,
          );
          persist(canonicalSave);
          setSave(canonicalSave);
          return canonicalSave;
        };
        const response = await fetch("/api/story/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionKind: "chapter_decision",
            requestId,
            executionId: requestId,
            worldState: worldBefore,
            choice,
            selection: next,
            span,
            usedExperienceIds: [],
            sceneActionContext: compileSceneActionContext(save),
            branchId: save.activeBranchId ?? "main",
            prepareUnit: mode === "galgame",
            ...(mode === "galgame" ? { nextUnitId: `chapter-${requestId}-unit-2` } : {}),
          }),
        });
        const actionPayload = await readSseComplete<{ result: SimulateResult; unit?: StoryUnit }>(response, setSimProgress, (event, payload) => {
          if (!payload || typeof payload !== "object") return;
          const data = payload as { result?: SimulateResult; response?: SimulateResult; unit?: unknown };
          if (event === "canonical_committed" && data.result) commitCanonicalResult(data.result);
          if (event === "unit_ready" && data.unit) streamedUnit = validatePublishedStoryUnit(data.unit);
        });
        const result = canonicalResult ?? actionPayload.result;
        if (!result) throw new Error("故事行动未返回有效年度结果");
        const resultExecutionId = result.executionId ?? result.chapterId;
        let saveBase = canonicalSave ?? commitCanonicalResult(result);
        const canonicalSession = saveBase.storySession ?? storySession;

        if (mode === "galgame") {
          setNovelLoading(true);
          try {
            setPlanProgress("正在准备当前互动单元…");
            const directChapter = assembleChapter({
              choice,
              selection: next,
              span,
              worldBefore,
              result,
              worldStateAfter: saveBase.worldState,
            });
            const unit = streamedUnit ?? await fetchInteractiveStoryUnit(
              saveBase.worldState,
              result.simulation.events,
              directChapter,
              setPlanProgress,
              saveBase.activeBranchId ?? "main",
              {
                unitId: `chapter-${result.chapterId}-unit-1`,
                requiredEventIds: result.simulation.events.map((event) => event.id),
                isFinalUnit: false,
                nextUnitId: `chapter-${result.chapterId}-unit-2`,
                requestId: `${requestId}:unit-1`,
              },
            );
            if (unit.payload.kind !== "scene") throw new Error("互动单元不是可播放场景");
            const scenePackage = unit.payload.package;
            const liveRuntime = createSceneRuntime(scenePackage, {
              branchId: saveBase.activeBranchId ?? "main",
            });
            const interactiveChapter: Chapter = {
              ...directChapter,
              presentation: { mode: "galgame", unitIds: [unit.id], status: "ready" },
            };
            const now = new Date().toISOString();
            const publishedSession = publishStoryUnit(canonicalSession, unit, now);
            const readySave: GameSave = {
              ...saveBase,
              storySession: publishedSession,
              chapters: { ...saveBase.chapters, [interactiveChapter.id]: interactiveChapter },
              events: {
                ...saveBase.events,
                ...Object.fromEntries(result.simulation.events.map((event) => [event.id, event])),
              },
              experienceCache: {
                ...saveBase.experienceCache,
                ...Object.fromEntries(allEvidence(result.evidenceBundle).map((experience) => [experience.id, experience])),
              },
              scenePackages: { ...(saveBase.scenePackages ?? {}), [interactiveChapter.id]: scenePackage },
              sceneRuntime: liveRuntime,
              pendingChapter: saveBase.pendingChapter
                ? updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, "live_scene", {
                    liveScenePackage: scenePackage,
                    liveSceneCompleted: true,
                    updatedAt: now,
                  })
                : undefined,
              savedAt: now,
            };
            const completedSave = readySave.pendingChapter
              ? completePendingChapter(readySave, resultExecutionId, interactiveChapter, scenePackage)
              : readySave;
            const finalSave = appendSnapshot(completedSave, { chapterId: interactiveChapter.id, now });
            latestStorySave = finalSave;
            persist(finalSave);
            setSave(finalSave);
            setChapter(interactiveChapter);
            setSubmission(idleChapterSubmission);
            setScreen("formal_scene");
          } catch (err) {
            const message = err instanceof Error ? err.message : "互动单元生成失败";
            setError(message);
            if (saveBase.pendingChapter) {
              const failedSave = {
                ...saveBase,
                // The canonical result is already committed; only the
                // unfinished presentation stage is recoverable here.
                ...(saveBase.storySession ? { storySession: saveBase.storySession } : {}),
                pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, "error", {
                  error: { code: "INTERACTIVE_UNIT_FAILED", message },
                  updatedAt: new Date().toISOString(),
                }),
                savedAt: new Date().toISOString(),
              };
              latestStorySave = failedSave;
              persist(failedSave);
              setSave(failedSave);
            }
            setSubmission((current) =>
              current.requestId === attempt.requestId
                ? failChapterSubmission(current, { message, finishedAt: new Date().toISOString() })
                : current,
            );
            setScreen("pending_recovery");
          } finally {
            setNovelLoading(false);
          }
          return;
        }

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
              const stagedPending = updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, stage, {
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
              latestStorySave = saveBase;
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
              pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, "novel", {
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
            latestStorySave = saveBase;
            persist(saveBase);
            setSave(saveBase);
          }
          // Galgame 章节不再把小说改写成只读对白；正式玩法直接使用下面的 LLM live 场景包。
          let dialogue: DialogueScene[] | undefined;
          if (saveBase.pendingChapter) {
            saveBase = {
              ...saveBase,
              pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, "dialogue", {
                novel,
                dialogue,
                novelCompleted: true,
                dialogueCompleted: Boolean(dialogue),
                updatedAt: new Date().toISOString(),
              }),
              savedAt: new Date().toISOString(),
            };
            latestStorySave = saveBase;
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
          const scenePackage = adaptDialogueScenes(dialogue ?? fallbackDialogueScenes(novel), {
            chapterId: chapter.id,
            year: chapter.endYear,
            version: 1,
          });
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
                pendingChapter: updatePendingChapterStage(completedSave.pendingChapter, resultExecutionId, "ready", {
                  ...(chapter.novel ? { novel: chapter.novel } : {}),
                  dialogue,
                  novelCompleted: true,
                  dialogueCompleted: Boolean(dialogue),
                  updatedAt: completedSave.savedAt,
                }),
              }
            : completedSave;
          const completedWithPending = readySave.pendingChapter
            ? completePendingChapter(readySave, resultExecutionId, chapter, readySave.scenePackages?.[chapter.id] ?? scenePackage)
            : readySave;
          const finalSave = appendSnapshot(completedWithPending, { chapterId: chapter.id, now: completedWithPending.savedAt });
          latestStorySave = finalSave;
          persist(finalSave);
          setSave(finalSave);
          setSubmission(idleChapterSubmission);
          // Keep the legacy source-level routing contract visible while the default path uses formal_scene.
          // setScreen(liveRuntime ? "formal_scene" : "chapter_summary")
          setScreen("chapter_summary");
        } catch (err) {
          const message = err instanceof Error ? err.message : "小说生成失败";
          setError(message);
          if (saveBase.pendingChapter) {
            try {
              const failedSave = {
                ...saveBase,
                ...(saveBase.storySession ? { storySession: saveBase.storySession } : {}),
                pendingChapter: updatePendingChapterStage(saveBase.pendingChapter, resultExecutionId, "error", {
                  error: { code: "PRESENTATION_STAGE_FAILED", message },
                  updatedAt: new Date().toISOString(),
                }),
                savedAt: new Date().toISOString(),
              };
              latestStorySave = failedSave;
              persist(failedSave);
              setSave(failedSave);
            } catch (persistError) {
              console.error("pending chapter error save failed", persistError);
            }
          }
          setSubmission((current) =>
            current.requestId === attempt.requestId
              ? failChapterSubmission(current, { message, finishedAt: new Date().toISOString() })
              : current,
          );
          setScreen("pending_recovery");
        } finally {
          setNovelLoading(false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "世界推演失败";
        setError(message);
        if (latestStorySave.pendingChapter) {
          try {
            const failedSave = {
              ...latestStorySave,
              pendingChapter: updatePendingChapterStage(
                latestStorySave.pendingChapter,
                latestStorySave.pendingChapter.executionId,
                "error",
                { error: { code: "PRESENTATION_STAGE_FAILED", message }, updatedAt: new Date().toISOString() },
              ),
              savedAt: new Date().toISOString(),
            };
            latestStorySave = failedSave;
            persist(failedSave);
            setSave(failedSave);
          } catch (persistError) {
            console.error("pending chapter error save failed", persistError);
          }
          setScreen("pending_recovery");
        } else if (latestStorySave.storySession) {
          const failedSave = {
            ...latestStorySave,
            storySession: failStorySession(latestStorySave.storySession, { code: "STORY_ACTION_FAILED", message }),
            savedAt: new Date().toISOString(),
          };
          latestStorySave = failedSave;
          try {
            persist(failedSave);
            setSave(failedSave);
          } catch {
            // Do not open a new action when the failure journal itself cannot be persisted.
          }
        }
        setSubmission((current) =>
          current.requestId === attempt.requestId
            ? failChapterSubmission(current, { message, finishedAt: new Date().toISOString() })
            : current,
        );
      } finally {
        setSimulating(false);
        submissionInFlight.current = false;
      }
    },
    [mode, save, choice, span, submission],
  );

  const handleRetrySubmission = useCallback(() => {
    if (!selection || !canRechooseChapterSubmission(submission)) return;
    void handleSelect(selection);
  }, [handleSelect, selection, submission]);

  const handleRechooseSubmission = useCallback(() => {
    if (!canRechooseChapterSubmission(submission)) return;
    setSelection(null);
    setSubmission(idleChapterSubmission);
    setError("");
    setSimProgress("");
  }, [submission]);

  const handleRegenerateNovel = useCallback(async () => {
    if (!chapter || !chapter.novel || !simResult || !preWorld) return;
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
    setSubmission(idleChapterSubmission);
    setSimResult(null);
    setChapter(null);
    setPreWorld(null);
    setNovelPreview({ title: "", scenes: [] });
    setPlanResult(null);
    setPlanProgress("");
    setCustomOpen(false);
    setCustomText("");
    setSelectedSnapshotId(null);
    void handleStartChapter();
  }, [handleStartChapter]);

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
            <a href="/life/zhao-leng" className="life-vn-btn ghost" style={{ textAlign: "center", textDecoration: "none" }}>
              进入赵冷剧情 Demo
            </a>
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
            <StoryPlayer
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
    const formalWorld = save.storyReveal?.chapterId === chapter.id
      ? save.storyReveal.visibleWorld
      : save.worldState;
    const formalHero = formalWorld.characters[formalWorld.protagonistId];
    const formalEvents = chapter.simulationEventIds
      .map((id) => save.events[id])
      .filter((event): event is NonNullable<typeof event> => Boolean(event))
      .filter((event) => !save.storyReveal || save.storyReveal.chapterId !== chapter.id || save.storyReveal.revealedEventIds.includes(event.id));
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
    const formalAutoPaused = readingLogOpen || readingSheetOpen || pauseAfterReadingLog;
    const revealComplete = !save.storyReveal || save.storyReveal.chapterId !== chapter.id || save.storyReveal.phase === "complete";
    const formalTimeline = getTimelineNodes(save).map((node) => {
      const item = timelineItemFromSnapshot(node);
      if (node.id !== chapter.id || revealComplete) return item;
      return { ...item, title: chapter.decision.promptTitle, summary: undefined };
    });
    const completion = activeFormalSceneSession.runtime.completion;
    return (
      <LifeShell
        chapterLabel={`Chapter ${String(chapter.index + 1).padStart(2, "0")}`}
        title={chapter.novel?.title ?? chapter.decision.promptTitle}
        yearRange={`${chapter.startYear} → ${chapter.endYear}`}
        brandLabel="知乎 · 正式互动人生"
        onBrandClick={() => setScreen("landing")}
        left={
          <div>
            <div className="life-vn-pill" style={{ marginBottom: 10 }}>
              正式 live 场景 · {revealComplete ? "本章已揭示" : "当前互动单元"}
            </div>
            <Timeline
              chapters={formalTimeline}
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
            <StoryPlayer
              key={`${activeFormalSceneSession.package.id}:v${activeFormalSceneSession.package.version}`}
              scenePackage={activeFormalSceneSession.package}
              initialState={activeFormalSceneSession.runtime}
              projection={formalProjection}
              flowPolicy="seamless"
              readingPreferences={readingPreferences}
              autoPaused={formalAutoPaused}
              hasPendingSave={hasPendingFormalSceneCommit}
              onSelect={handleFormalSceneSelect}
              onRetrySave={handleFormalSceneSelect}
              onPersistPosition={handleFormalScenePersistPosition}
              onBlockRead={handleFormalSceneBlockRead}
              onBoundary={handleFormalSceneBoundary}
              onPlaybackModeChange={handleFormalPlaybackModeChange}
            />
            {continuationLoading && (
              <div className="life-vn-feedback" style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5 }}>
                正在衔接后续互动单元…
              </div>
            )}
            {continuationError && (
              <div className="life-vn-error" role="alert" style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5, maxWidth: 360 }}>
                <div>{continuationError}</div>
                <button type="button" className="life-vn-btn ghost" onClick={() => void handleFormalSceneBoundary({ completedRuntime: activeFormalSceneSession.runtime, source: "button" })}>
                  重试衔接
                </button>
              </div>
            )}
            {activeFormalSceneSession.runtime.status === "completed" && completion && completion.kind !== "unit_end" && !continuationLoading && (
              <button
                type="button"
                className="life-vn-btn"
                style={{ position: "absolute", right: 22, bottom: 22, zIndex: 5 }}
                onClick={handleNextChapter}
              >
                进入下一章
              </button>
            )}
            <SceneReadingLog
              open={readingLogOpen}
              entries={save.sceneReading?.entries ?? []}
              onClose={handleReadingLogClose}
            />
          </div>
        }
        sheet={
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <b>当前运行时</b>
              <p style={{ margin: "6px 0 0", color: "var(--lv-muted)", fontSize: 12 }}>
                当前互动单元 · {activeFormalSceneSession.runtime.status}
              </p>
            </div>
            <BranchPanel
              branches={formalBranchState.branches}
              checkpoints={formalBranchState.checkpoints}
              onSwitchBranch={handleFormalSwitchBranch}
              onCreateBranch={handleFormalCreateBranch}
              disabled={loading || activeFormalSceneSession.runtime.status === "submitting"}
            />
            <SceneReadingTools
              entries={save.sceneReading?.entries ?? []}
              preferences={readingPreferences}
              onOpenRecords={handleReadingLogOpen}
              onChangePreferences={updateReadingPreferences}
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
            本章的年度结果已经保存，不会重复结算；恢复流程只补齐尚未发布的互动内容。
          </p>
          <div className="life-vn-card" style={{ background: "rgba(255,252,244,.72)" }}>
            <div className="life-vn-change">本章跨度：{pending.startYear} → {pending.endYear}</div>
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
              {novelLoading ? "正在恢复…" : "继续恢复故事"}
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
    const options = choice.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: `${option.description} · ${option.strategyTag}`,
    }));
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
          // StoryPlayer renders the same DialogueBox variant="macro" used by
          // the formal scene, so the decision-to-chapter flow shares one
          // dialogue operation rather than relying on a wrapper claim.
          <StoryPlayer
            decision={{
              scene: sceneDef,
              meta: `${world.currentYear} 年 · ${hero?.state.city || "未知"} · 夜`,
              characters: [decisionCharacter],
              activeCharacterId: decisionCharacter.id,
              copy: choice.context,
              options,
              selectedOptionId: selection?.optionId ?? null,
            }}
            disabled={Boolean(selection)}
            feedback={feedback}
            onSelect={(id: "A" | "B" | "C") => { void handleSelect({ optionId: id }); }}
          >
            {selection ? (
              <>
                {simulating ? (
                  <div className="life-vn-feedback">{simProgress}</div>
                ) : novelLoading ? (
                  <div className="life-vn-feedback">故事正在展开…</div>
                ) : error ? (
                  <div className="life-vn-error" role="alert">
                    <div>{error}</div>
                    {canRechooseChapterSubmission(submission) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <button type="button" className="life-vn-btn" onClick={handleRetrySubmission}>
                          重试本次推演
                        </button>
                        <button type="button" className="life-vn-btn ghost" onClick={handleRechooseSubmission}>
                          重新选择
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
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
                      void handleSelect({ optionId: "CUSTOM", customAction: customText.trim() });
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
            )}
          </StoryPlayer>
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
        onSceneRetrySave={handleFormalSceneSelect}
        hasPendingSceneSave={hasPendingFormalSceneCommit}
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
                variant="subtitle"
                copy={`${hero?.identity.name ?? "你"}，${hero?.state.age ?? 18} 岁，在${hero?.state.city || "一座城市"}开始了新的人生。选择本章跨度，然后开始这一章。`}
                children={
                  <div style={{ display: "grid", gap: 10 }}>
                    {error ? <div className="life-vn-error" role="alert">{error}</div> : null}
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
): Promise<ChapterNovel> {
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
    const streamed = await readSseComplete<{ novel: ChapterNovel }>(
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
            data.scene as ChapterNovel["scenes"][number],
          );
        }
      },
    );
    return streamed.novel;
  }
  const data = await readJsonResponse<{ novel: ChapterNovel }>(response);
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
  novel?: ChapterNovel;
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
    ...(novel ? { novel } : {}),
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
