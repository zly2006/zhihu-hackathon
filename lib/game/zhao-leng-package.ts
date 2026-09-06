import type { GameSave } from "../domain/chapter";
import type {
  RuntimeBlock,
  RuntimeChoice,
  RuntimeScene,
  ScenePackage,
  SceneRequirement,
} from "../domain/scene";
import type {
  ZhaoLengBeatId,
  ZhaoLengWrittenBeat,
  ZhaoLengWrittenLine,
} from "../domain/zhao-leng-runtime";
import {
  ZHAO_LENG_BEAT_SCRIPTS,
  ZHAO_LENG_ENDINGS,
  ZHAO_LENG_RULE_IDS,
  getZhaoLengBeatScript,
} from "../narrative/zhao-leng-script";
import {
  ZHAO_LENG_CHARACTER_IDS,
  ZHAO_LENG_CHAPTER_ID,
  getZhaoLengCharacters,
} from "./zhao-leng-demo";
import { validateScenePackage } from "./scene-package-validator";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function lineBlock(id: string, line: ZhaoLengWrittenLine): RuntimeBlock {
  if (line.type === "narration") return { id, content: { type: "narration", text: line.text } };
  return {
    id,
    content: {
      type: "dialogue",
      speakerId: line.speakerId,
      speaker: line.speakerId === ZHAO_LENG_CHARACTER_IDS.protagonist ? "主角" : "赵冷",
      text: line.text,
      emotion: line.emotion,
    },
    cues: [{ characterId: line.speakerId, emotion: line.emotion, animation: "speaking" }],
  };
}

function lineBlocks(prefix: string, lines: ZhaoLengWrittenLine[]): RuntimeBlock[] {
  return lines.map((line, index) => lineBlock(`${prefix}:line:${index + 1}`, line));
}

function characterList(save: GameSave): RuntimeScene["characters"] {
  const { protagonist, zhaoLeng } = getZhaoLengCharacters(save);
  return [
    {
      id: protagonist.id,
      name: protagonist.identity.name,
      position: "center",
      emotion: protagonist.emotionState ?? "平静",
      avatarId: "placeholder:protagonist",
    },
    {
      id: zhaoLeng.id,
      name: zhaoLeng.identity.name,
      position: "left",
      emotion: zhaoLeng.emotionState ?? "克制",
      avatarId: "placeholder:zhao-leng",
    },
  ];
}

function timeLabelFor(save: GameSave, beatId: ZhaoLengBeatId, base: string): string {
  if (beatId === "zl-02-library" && save.sceneFlags?.zhaoFirstMeetingWeekend) {
    return base.replace("次日下午", "周末");
  }
  if (beatId === "zl-11-future" && save.sceneFlags?.zhaoRemoteFuture) {
    return base.replace("展厅外", "远程通话");
  }
  return base;
}

function requirementsFor(save: GameSave, beatId: ZhaoLengBeatId, choiceId: string): SceneRequirement[] {
  if (beatId === "zl-09-consequence" && choiceId === "A") {
    return [{ kind: "flag", key: "zhaoJointArrangementActive", equals: true }];
  }
  if (beatId === "zl-11-future" && choiceId === "A") {
    return [{ kind: "flag", key: "zhaoCanTogether", equals: true }];
  }
  return [];
}

function compileChoiceScene(
  save: GameSave,
  beatId: ZhaoLengBeatId,
  sceneId: string,
  lines: ZhaoLengWrittenLine[],
  script: ReturnType<typeof getZhaoLengBeatScript>,
  written: ZhaoLengWrittenBeat | undefined,
  choices: RuntimeChoice[],
): RuntimeScene {
  const scene: RuntimeScene = {
    id: sceneId,
    mode: "live",
    background: script.background,
    timeLabel: timeLabelFor(save, beatId, script.timeLabel),
    year: save.worldState.currentYear,
    sourceEventIds: [],
    characters: characterList(save),
    blocks: [
      ...lineBlocks(`${sceneId}:opening`, lines),
      {
        id: `${sceneId}:choice`,
        content: {
          type: "choice",
          text: script.choicePrompt ?? "你准备怎样回应？",
          choices,
        },
      },
    ],
    defaultNext: { kind: "chapter_end" },
  };
  void written;
  return scene;
}

export type CompileZhaoLengBeatInput = {
  save: GameSave;
  beatId: ZhaoLengBeatId;
  written?: ZhaoLengWrittenBeat;
};

export function compileZhaoLengBeat(input: CompileZhaoLengBeatInput): ScenePackage {
  const { save, beatId } = input;
  const script = getZhaoLengBeatScript(beatId);
  const written = input.written;
  const opening = written?.opening ?? script.opening;
  const packageId = `${ZHAO_LENG_CHAPTER_ID}:${beatId}:v1`;
  const sceneId = `${packageId}:scene:1`;

  if (script.choices.length === 0) {
    const readingScene: RuntimeScene = {
      id: sceneId,
      mode: "live",
      background: script.background,
      timeLabel: timeLabelFor(save, beatId, script.timeLabel),
      year: save.worldState.currentYear,
      sourceEventIds: [],
      characters: characterList(save),
      blocks: lineBlocks(`${sceneId}:reading`, opening),
      defaultNext: { kind: "chapter_end" },
    };
    const readingPackage: ScenePackage = {
      schemaVersion: 1,
      id: packageId,
      version: 1,
      chapterId: ZHAO_LENG_CHAPTER_ID,
      entrySceneId: sceneId,
      scenes: [readingScene],
      endings: [],
    };
    return validateScenePackage(readingPackage, {
      world: save.worldState,
      flags: save.sceneFlags,
      currentYear: save.worldState.currentYear,
      chapterId: ZHAO_LENG_CHAPTER_ID,
      knownRuleIds: ZHAO_LENG_RULE_IDS,
      checkAvailability: false,
      scope: "zhao-leng-demo",
    });
  }

  const choices: RuntimeChoice[] = script.choices.map((item) => ({
    id: item.id,
    label: item.label,
    ruleId: item.ruleId,
    targetCharacterId: ZHAO_LENG_CHARACTER_IDS.zhaoLeng,
    requirements: requirementsFor(save, beatId, item.id),
    next: { kind: "scene", sceneId: `${packageId}:feedback:${item.id}` },
  }));
  const scenes: RuntimeScene[] = [compileChoiceScene(save, beatId, sceneId, opening, script, written, choices)];
  for (const item of script.choices) {
    const feedbackSceneId = `${packageId}:feedback:${item.id}`;
    const feedback = written?.feedback[item.id] ?? script.feedback[item.id] ?? [];
    scenes.push({
      id: feedbackSceneId,
      mode: "live",
      background: script.background,
      timeLabel: timeLabelFor(save, beatId, script.timeLabel),
      year: save.worldState.currentYear,
      sourceEventIds: [],
      characters: characterList(save),
      blocks: lineBlocks(`${feedbackSceneId}:feedback`, feedback),
      defaultNext: { kind: "chapter_end" },
    });
  }
  const packageItem: ScenePackage = {
    schemaVersion: 1,
    id: packageId,
    version: 1,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    entrySceneId: sceneId,
    scenes,
    endings: [],
  };
  return validateScenePackage(packageItem, {
    world: save.worldState,
    flags: save.sceneFlags,
    currentYear: save.worldState.currentYear,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    knownRuleIds: ZHAO_LENG_RULE_IDS,
    checkAvailability: false,
    scope: "zhao-leng-demo",
  });
}

export function compileZhaoLengEndingPackage(
  save: GameSave,
  endingId: "mutual-trust" | "kind-distance" | "library-letter",
  lines: ZhaoLengWrittenLine[],
): ScenePackage {
  const packageId = `${ZHAO_LENG_CHAPTER_ID}:${endingId}:v1`;
  const sceneId = `${packageId}:scene:1`;
  const packageItem: ScenePackage = {
    schemaVersion: 1,
    id: packageId,
    version: 1,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    entrySceneId: sceneId,
    scenes: [
      {
        id: sceneId,
        mode: "live",
        background: "urban-home-apartment-night-v1",
        timeLabel: `${save.worldState.currentYear} 年 · 结局收束`,
        year: save.worldState.currentYear,
        sourceEventIds: [],
        characters: characterList(save),
        blocks: lineBlocks(`${sceneId}:ending`, lines),
        defaultNext: { kind: "chapter_end" },
      },
    ],
    endings: ZHAO_LENG_ENDINGS.filter((item) => item.id === endingId),
  };
  return validateScenePackage(packageItem, {
    world: save.worldState,
    flags: save.sceneFlags,
    currentYear: save.worldState.currentYear,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    knownRuleIds: ZHAO_LENG_RULE_IDS,
    checkAvailability: false,
    scope: "zhao-leng-demo",
  });
}

export function compileZhaoLengReadingPackage(
  save: GameSave,
  readingId: string,
  lines: ZhaoLengWrittenLine[],
  endingId?: "mutual-trust" | "kind-distance" | "library-letter",
): ScenePackage {
  const packageId = `${ZHAO_LENG_CHAPTER_ID}:${readingId}:v1`;
  const sceneId = `${packageId}:scene:1`;
  const packageItem: ScenePackage = {
    schemaVersion: 1,
    id: packageId,
    version: 1,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    entrySceneId: sceneId,
    scenes: [
      {
        id: sceneId,
        mode: "live",
        background: readingId === "zhao-leng-library-letter" ? "urban-home-apartment-day-v1" : "urban-home-apartment-night-v1",
        timeLabel: `${save.worldState.currentYear} 年 · ${readingId === "zhao-leng-library-letter" ? "图书馆" : "结局收束"}`,
        year: save.worldState.currentYear,
        sourceEventIds: [],
        characters: characterList(save),
        blocks: lineBlocks(`${sceneId}:reading`, lines),
        defaultNext: { kind: "chapter_end" },
      },
    ],
    endings: endingId ? ZHAO_LENG_ENDINGS.filter((item) => item.id === endingId) : [],
  };
  return validateScenePackage(packageItem, {
    world: save.worldState,
    flags: save.sceneFlags,
    currentYear: save.worldState.currentYear,
    chapterId: ZHAO_LENG_CHAPTER_ID,
    knownRuleIds: ZHAO_LENG_RULE_IDS,
    checkAvailability: false,
    scope: "zhao-leng-demo",
  });
}

export function listZhaoLengBeatIds(): ZhaoLengBeatId[] {
  return ZHAO_LENG_BEAT_SCRIPTS.map((beat) => beat.id);
}

export function cloneScenePackage(packageItem: ScenePackage): ScenePackage {
  return clone(packageItem);
}
