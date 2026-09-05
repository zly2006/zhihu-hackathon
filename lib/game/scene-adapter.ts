import type { DialogueBlock, DialogueScene } from "../domain/dialogue";
import type { RuntimeBlock, ScenePackage } from "../domain/scene";

export class SceneAdapterError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SceneAdapterError";
    this.path = path;
  }
}

export type SceneAdapterOptions = {
  chapterId?: string;
  packageId?: string;
  version?: number;
  year?: number;
  sourceEventIdsByScene?: Record<string, string[]>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseYear(timeLabel: string | undefined, fallback: number): number {
  const match = timeLabel?.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : fallback;
}

function adaptBlock(block: DialogueBlock, sceneId: string, index: number): RuntimeBlock {
  const id = `${sceneId}:block:${index}`;
  if (block.type === "narration") return { id, content: clone(block) };
  if (block.type === "dialogue") {
    return {
      id,
      content: clone(block),
      cues: [{ characterId: block.speakerId, emotion: block.emotion, animation: "speaking" }],
    };
  }
  return {
    id,
    content: {
      type: "choice",
      text: block.text,
      readOnly: true,
      choices: clone(block.choices),
    },
  };
}

export function adaptDialogueScenes(
  input: DialogueScene[],
  options: SceneAdapterOptions = {},
): ScenePackage {
  if (!Array.isArray(input) || input.length === 0) throw new SceneAdapterError("scenes", "至少需要一个旧对白场景");
  const version = Number.isInteger(options.version) && (options.version as number) > 0 ? (options.version as number) : 1;
  const chapterId = options.chapterId?.trim() || "retrospective-chapter";
  const packageId = options.packageId?.trim() || `${chapterId}:retrospective:v${version}`;
  const sceneIds = new Set<string>();
  const scenes = input.map((scene, sceneIndex) => {
    if (!scene || typeof scene !== "object") throw new SceneAdapterError(`scenes[${sceneIndex}]`, "场景不是对象");
    if (!scene.id?.trim()) throw new SceneAdapterError(`scenes[${sceneIndex}].id`, "缺少场景 ID");
    if (sceneIds.has(scene.id)) throw new SceneAdapterError(`scenes[${sceneIndex}].id`, `场景 ID 重复 ${scene.id}`);
    sceneIds.add(scene.id);
    const blockChoices = scene.blocks.filter((block) => block.type === "choice");
    if (scene.choices.length > 0 && blockChoices.length > 0) {
      throw new SceneAdapterError(`scenes[${sceneIndex}].choices`, "顶层 choices 与块内 choice 不能同时存在");
    }
    const blocks = scene.blocks.map((block, blockIndex) => adaptBlock(block, scene.id, blockIndex));
    if (scene.choices.length > 0) {
      blocks.push({
        id: `${scene.id}:block:${scene.blocks.length}`,
        content: {
          type: "choice",
          text: "旧对白选项（仅供回顾）",
          readOnly: true,
          choices: clone(scene.choices),
        },
      });
    }
    if (blocks.length === 0) throw new SceneAdapterError(`scenes[${sceneIndex}].blocks`, "场景没有可播放内容");
    const year = parseYear(scene.timeLabel, options.year ?? 0);
    return {
      id: scene.id,
      mode: "retrospective" as const,
      background: scene.background,
      timeLabel: scene.timeLabel?.trim() || `${year} 年 · 历史回放`,
      year,
      sourceEventIds: clone(options.sourceEventIdsByScene?.[scene.id] ?? []),
      characters: clone(scene.characters),
      blocks,
      defaultNext: input[sceneIndex + 1]
        ? { kind: "scene" as const, sceneId: input[sceneIndex + 1].id }
        : { kind: "chapter_end" as const },
    };
  });
  return {
    schemaVersion: 1,
    id: packageId,
    version,
    chapterId,
    entrySceneId: scenes[0].id,
    scenes,
    endings: [],
  };
}
