import type { GameSave } from "../domain/chapter";
import type { SceneActionRecord, SceneTarget } from "../domain/scene";
import type { RelationshipScores } from "../domain/relationship";

export type PublicSceneActionContext = {
  actionId: string;
  chapterId: string;
  sceneId: string;
  blockId: string;
  choiceId: SceneActionRecord["choiceId"];
  label: string;
  ruleId: string;
  targetCharacterId?: string;
  appliedEffects: {
    relationshipDelta: Partial<RelationshipScores>;
    hasFlagEffect: boolean;
  };
  next: SceneTarget;
};

export type SceneActionContextInput = {
  actions: SceneActionRecord[];
  activeBranchId?: string;
  lastCompletedChapterId?: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sourceInput(input: SceneActionContextInput | GameSave): SceneActionContextInput {
  if ("sceneActions" in input || "worldState" in input && "chapters" in input) {
    const save = input as GameSave;
    return {
      actions: save.sceneActions ?? [],
      activeBranchId: save.activeBranchId,
      lastCompletedChapterId: save.worldState.chapterIds.at(-1),
    };
  }
  return input as SceneActionContextInput;
}

export function compileSceneActionContext(
  input: SceneActionContextInput | GameSave,
): PublicSceneActionContext[] {
  const source = sourceInput(input);
  const lastChapterId = source.lastCompletedChapterId;
  const actions = source.actions
    .filter((action) => !source.activeBranchId || action.branchId === source.activeBranchId)
    .filter((action) => !lastChapterId || action.chapterId === lastChapterId)
    .slice(-3);
  return actions.map((action) => ({
    actionId: action.id,
    chapterId: action.chapterId,
    sceneId: action.sceneId,
    blockId: action.blockId,
    choiceId: action.choiceId,
    label: action.label,
    ruleId: action.ruleId,
    ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
    appliedEffects: {
      relationshipDelta: clone(action.actualRelationshipDelta),
      hasFlagEffect: Object.keys(action.flagsAfter).length > 0,
    },
    next: clone(action.next),
  }));
}
