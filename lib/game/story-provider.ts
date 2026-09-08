import type { GameSave } from "../domain/chapter";
import type { StorySource, StoryUnit } from "../domain/story";
import type { SceneChoiceRequest, SceneChoiceResponse, SceneRuntimeState } from "../domain/scene";
import type { ZhaoLengBeatId, ZhaoLengCommand, ZhaoLengPreparedArtifact } from "../domain/zhao-leng-runtime";
import { applySceneChoice } from "./scene-choice-service";
import { runChapterSimulation, type ChapterSimulationInput, type ChapterSimulationResult } from "./chapter-simulation-service";
import {
  prepareLifeStoryUnit,
  type LifeStoryPreparationInput,
} from "./story-generation";
import {
  applyZhaoLengCommand,
  type ZhaoLengCommandDependencies,
} from "./zhao-leng-progress";
import { prepareZhaoLengBeat } from "./zhao-leng-prepare";
import { resolveZhaoLengBoundary, type ZhaoLengBoundaryResult } from "./zhao-leng-flow";
import type { ExecutionBudget } from "./execution-budget";

export type StoryProviderPrepareInput = {
  save?: GameSave;
  nextBeatId?: ZhaoLengBeatId;
  life?: LifeStoryPreparationInput;
  model?: Parameters<typeof prepareZhaoLengBeat>[0]["model"];
  signal?: AbortSignal;
  budget?: ExecutionBudget;
  executionId?: string;
};

export type StoryProviderPrepared = ZhaoLengPreparedArtifact | StoryUnit;

export type StoryProviderCommitInput =
  | { kind: "zhao_command"; save: GameSave; command: ZhaoLengCommand; dependencies?: ZhaoLengCommandDependencies }
  | { kind: "scene_choice"; request: SceneChoiceRequest };

export type StoryProviderCommitResult = GameSave | SceneChoiceResponse;

export type StoryProviderBoundary = ZhaoLengBoundaryResult | { kind: "next_chapter" } | { kind: "none" };

export type StoryProvider = {
  source: StorySource;
  prepare(input: StoryProviderPrepareInput): Promise<StoryProviderPrepared>;
  commit(input: StoryProviderCommitInput): StoryProviderCommitResult;
  resolveBoundary(input: { save: GameSave; completedRuntime?: SceneRuntimeState }): StoryProviderBoundary;
};

function requireSave(input: StoryProviderPrepareInput): GameSave {
  if (!input.save) throw new Error("故事 provider 缺少存档");
  return input.save;
}

function zhaoProvider(source: "zhao_scripted" | "zhao_ai"): StoryProvider {
  return {
    source,
    prepare: async (input) => {
      const save = requireSave(input);
      if (save.zhaoLeng?.generationMode !== (source === "zhao_ai" ? "llm" : "scripted")) {
        throw new Error("赵冷 provider 与当前生成模式不匹配");
      }
      return prepareZhaoLengBeat({
        save,
        nextBeatId: input.nextBeatId,
        model: input.model,
        signal: input.signal,
        executionId: input.executionId,
      });
    },
    commit: (input) => {
      if (input.kind !== "zhao_command") throw new Error("赵冷 provider 只能提交赵冷命令");
      return applyZhaoLengCommand(input.save, input.command, input.dependencies).saveAfter;
    },
    resolveBoundary: ({ save, completedRuntime }) => {
      if (!completedRuntime) return { kind: "none" };
      return resolveZhaoLengBoundary({ save, completedRuntime });
    },
  };
}

export function createZhaoLengScriptedProvider(): StoryProvider {
  return zhaoProvider("zhao_scripted");
}

export function createZhaoLengAiProvider(): StoryProvider {
  return zhaoProvider("zhao_ai");
}

export function createLifeAiProvider(): StoryProvider {
  return {
    source: "life_ai",
    prepare: async (input) => {
      if (!input.life) throw new Error("主游戏 provider 缺少互动单元上下文");
      return prepareLifeStoryUnit(input.life);
    },
    commit: (input) => {
      if (input.kind === "scene_choice") return applySceneChoice(input.request);
      throw new Error("主游戏 provider 的年度结算使用 chapter simulation service");
    },
    resolveBoundary: () => ({ kind: "next_chapter" }),
  };
}

export async function runLifeAiChapterDecision(input: ChapterSimulationInput): Promise<ChapterSimulationResult> {
  return runChapterSimulation(input);
}
