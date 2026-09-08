import type {
  RuntimeBlock,
  RuntimeChoice,
  SceneActionRecord,
  ScenePackage,
  SceneRuntimeState,
  SceneTarget,
} from "../domain/scene";

export type SceneRuntimeOptions = {
  branchId: string;
  playbackMode?: "manual" | "auto";
  skipPolicy?: "legacy" | "read";
  readBlockIds?: string[];
  readOnly?: boolean;
  sceneId?: string;
  blockId?: string;
};

export type SceneFlowPolicy = "confirm" | "seamless";

export type SceneRuntimeAction =
  | { type: "NEXT" }
  | { type: "AUTO_TICK" }
  | { type: "SKIP" }
  | {
      type: "SELECT_STARTED";
      requestId: string;
      choiceId: "A" | "B" | "C";
      issuedAt: string;
      expectedRevision: number;
    }
  | {
      type: "SELECT_SUCCEEDED";
      record: Pick<SceneActionRecord, "id" | "next"> & Partial<SceneActionRecord>;
      flowPolicy?: SceneFlowPolicy;
    }
  | { type: "SELECT_FAILED"; errorCode?: string }
  | { type: "RESUME" }
  | { type: "ACK_FEEDBACK" }
  | { type: "SET_PLAYBACK_MODE"; playbackMode: "manual" | "auto" }
  | { type: "REPLAY"; blockId?: string; sceneId?: string };

export type RuntimeChoiceLocation = {
  sceneId: string;
  block: Extract<RuntimeBlock, { content: { type: "choice" } }>;
  blockIndex: number;
};

function firstBlockId(scene: ScenePackage["scenes"][number]): string {
  return scene.blocks[0]?.id ?? "";
}

function sceneMap(pkg: ScenePackage): Map<string, ScenePackage["scenes"][number]> {
  return new Map(pkg.scenes.map((scene) => [scene.id, scene]));
}

function isChoiceBlock(block: RuntimeBlock | undefined): block is Extract<RuntimeBlock, { content: { type: "choice" } }> {
  return Boolean(block && block.content.type === "choice");
}

function isExecutableChoiceBlock(block: RuntimeBlock | undefined): block is Extract<RuntimeBlock, { content: { type: "choice" } }> {
  return isChoiceBlock(block) && block.content.readOnly !== true;
}

function choiceForId(block: RuntimeBlock | undefined, choiceId: "A" | "B" | "C"): RuntimeChoice | undefined {
  if (!isExecutableChoiceBlock(block)) return undefined;
  const choice = block.content.choices.find((item) => item.id === choiceId);
  return choice && "ruleId" in choice && "next" in choice ? (choice as RuntimeChoice) : undefined;
}

function stateAtBlock(
  base: SceneRuntimeState,
  sceneId: string,
  blockId: string,
  readBlockIds: string[] = base.readBlockIds,
): SceneRuntimeState {
  return {
    ...base,
    sceneId,
    blockId,
    status: "reading",
    readBlockIds: [...new Set(readBlockIds)],
    selectedActionId: undefined,
    pendingAction: undefined,
    feedbackNext: undefined,
    completion: undefined,
    errorCode: undefined,
  };
}

function statusForBlock(pkg: ScenePackage, state: SceneRuntimeState): SceneRuntimeState["status"] {
  const block = getActiveBlock(pkg, state);
  return isExecutableChoiceBlock(block) && !state.readOnly ? "awaiting_choice" : "reading";
}

function routeToTarget(pkg: ScenePackage, state: SceneRuntimeState, target: SceneTarget): SceneRuntimeState {
  if (target.kind !== "scene") {
    return {
      ...state,
      status: "completed",
      completion: target,
      pendingAction: undefined,
      feedbackNext: undefined,
      errorCode: undefined,
    };
  }
  const scene = sceneMap(pkg).get(target.sceneId);
  if (!scene || !scene.blocks[0]) {
    return { ...state, status: "error", errorCode: "UNKNOWN_TARGET" };
  }
  const next = stateAtBlock(state, scene.id, firstBlockId(scene));
  return { ...next, status: statusForBlock(pkg, next) };
}

export function getActiveScene(pkg: ScenePackage, state: SceneRuntimeState): ScenePackage["scenes"][number] | undefined {
  return sceneMap(pkg).get(state.sceneId);
}

export function getActiveBlock(pkg: ScenePackage, state: SceneRuntimeState): RuntimeBlock | undefined {
  return getActiveScene(pkg, state)?.blocks.find((block) => block.id === state.blockId);
}

export function findNextChoice(pkg: ScenePackage, state: SceneRuntimeState): RuntimeChoiceLocation | undefined {
  const scenes = sceneMap(pkg);
  let scene = scenes.get(state.sceneId);
  let startIndex = scene?.blocks.findIndex((block) => block.id === state.blockId) ?? -1;
  const seen = new Set<string>();
  while (scene && !seen.has(scene.id)) {
    seen.add(scene.id);
    for (let index = Math.max(0, startIndex); index < scene.blocks.length; index += 1) {
      const block = scene.blocks[index];
      if (isChoiceBlock(block)) return { sceneId: scene.id, block, blockIndex: index };
    }
    const next = scene.defaultNext;
    if (next.kind !== "scene") return undefined;
    scene = scenes.get(next.sceneId);
    startIndex = 0;
  }
  return undefined;
}

export function createSceneRuntime(pkg: ScenePackage, options: SceneRuntimeOptions): SceneRuntimeState {
  const scene = sceneMap(pkg).get(options.sceneId ?? pkg.entrySceneId);
  if (!scene || scene.blocks.length === 0) throw new Error("场景包缺少有效入口场景");
  const blockId = options.blockId ?? firstBlockId(scene);
  if (!scene.blocks.some((block) => block.id === blockId)) throw new Error(`运行时位置不存在: ${scene.id}/${blockId}`);
  const state: SceneRuntimeState = {
    schemaVersion: 1,
    branchId: options.branchId,
    chapterId: pkg.chapterId,
    packageId: pkg.id,
    packageVersion: pkg.version,
    sceneId: scene.id,
    blockId,
    status: "reading",
    playbackMode: options.playbackMode ?? "manual",
    readBlockIds: [...new Set(options.readBlockIds ?? [])],
    ...(options.skipPolicy ? { skipPolicy: options.skipPolicy } : {}),
    ...(options.readOnly ? { readOnly: true } : {}),
  };
  return { ...state, status: statusForBlock(pkg, state) };
}

function markRead(state: SceneRuntimeState, blockId: string): string[] {
  return state.readBlockIds.includes(blockId) ? [...state.readBlockIds] : [...state.readBlockIds, blockId];
}

function advanceOne(pkg: ScenePackage, state: SceneRuntimeState): SceneRuntimeState {
  const scene = getActiveScene(pkg, state);
  const block = getActiveBlock(pkg, state);
  if (!scene || !block) return { ...state, status: "error", errorCode: "INVALID_POSITION" };
  if (isExecutableChoiceBlock(block) && !state.readOnly) return { ...state, status: "awaiting_choice" };
  const readBlockIds = markRead(state, block.id);
  const blockIndex = scene.blocks.findIndex((item) => item.id === block.id);
  const nextBlock = scene.blocks[blockIndex + 1];
  if (nextBlock) {
    const next = stateAtBlock(state, scene.id, nextBlock.id, readBlockIds);
    return { ...next, status: statusForBlock(pkg, next) };
  }
  const next = routeToTarget(pkg, { ...state, readBlockIds }, scene.defaultNext);
  return { ...next, readBlockIds };
}

function skipToChoice(pkg: ScenePackage, state: SceneRuntimeState): SceneRuntimeState {
  let current = state;
  const seen = new Set<string>();
  for (let count = 0; count < 100; count += 1) {
    const marker = `${current.sceneId}/${current.blockId}`;
    if (seen.has(marker)) return { ...current, status: "error", errorCode: "RUNTIME_LOOP" };
    seen.add(marker);
    const block = getActiveBlock(pkg, current);
    if (!block || (isChoiceBlock(block) && !block.content.readOnly && !current.readOnly)) return current;
    // Skip is a convenience for content the player has already confirmed reading.
    // A first visit must remain visible; otherwise the first click on a new
    // package can swallow an arbitrary run of unseen dialogue.
    if (current.skipPolicy === "read" && !current.readBlockIds.includes(current.blockId)) return current;
    const next = advanceOne(pkg, current);
    if (next === current || next.status === "completed" || next.status === "error") return next;
    current = next;
  }
  return { ...current, status: "error", errorCode: "RUNTIME_LIMIT" };
}

function targetExists(pkg: ScenePackage, target: SceneTarget): boolean {
  if (target.kind === "scene") return pkg.scenes.some((scene) => scene.id === target.sceneId);
  if (target.kind === "ending") return pkg.endings.some((ending) => ending.id === target.endingId);
  if (target.kind === "unit_end") return Boolean(target.unitId?.trim());
  return true;
}

export function transitionSceneRuntime(
  pkg: ScenePackage,
  state: SceneRuntimeState,
  action: SceneRuntimeAction,
): SceneRuntimeState {
  if (state.packageId !== pkg.id || state.packageVersion !== pkg.version || state.chapterId !== pkg.chapterId) return state;
  if (action.type === "SET_PLAYBACK_MODE") {
    if (state.status === "submitting" || state.status === "feedback" || state.status === "completed") return state;
    return { ...state, playbackMode: action.playbackMode };
  }
  if (action.type === "NEXT" || action.type === "AUTO_TICK") {
    if (state.status !== "reading") return state;
    return advanceOne(pkg, state);
  }
  if (action.type === "SKIP") {
    if (state.status !== "reading") return state;
    return skipToChoice(pkg, state);
  }
  if (action.type === "SELECT_STARTED") {
    if (state.readOnly || (state.status !== "awaiting_choice" && state.status !== "error")) return state;
    const choice = choiceForId(getActiveBlock(pkg, state), action.choiceId);
    if (!choice) return state;
    return {
      ...state,
      status: "submitting",
      pendingAction: {
        requestId: action.requestId,
        choiceId: action.choiceId,
        issuedAt: action.issuedAt,
        expectedRevision: action.expectedRevision,
      },
      errorCode: undefined,
    };
  }
  if (action.type === "SELECT_SUCCEEDED") {
    if (state.status !== "submitting" || !targetExists(pkg, action.record.next)) return state;
    const feedback: SceneRuntimeState = {
      ...state,
      status: "feedback",
      selectedActionId: action.record.id,
      pendingAction: undefined,
      feedbackNext: action.record.next,
      readBlockIds: markRead(state, state.blockId),
      errorCode: undefined,
    };
    if (action.flowPolicy !== "seamless") return feedback;
    const routed = routeToTarget(pkg, feedback, action.record.next);
    if (routed.status === "error") return routed;
    return { ...routed, selectedActionId: action.record.id };
  }
  if (action.type === "SELECT_FAILED") {
    if (state.status !== "submitting" && state.status !== "error") return state;
    return { ...state, status: "error", errorCode: action.errorCode ?? "SCENE_CHOICE_FAILED" };
  }
  if (action.type === "RESUME") {
    if (state.status !== "error") return state;
    return { ...state, status: statusForBlock(pkg, state), errorCode: undefined };
  }
  if (action.type === "ACK_FEEDBACK") {
    if (state.status !== "feedback" || !state.feedbackNext) return state;
    return routeToTarget(pkg, state, state.feedbackNext);
  }
  if (action.type === "REPLAY") {
    const scene = sceneMap(pkg).get(action.sceneId ?? state.sceneId);
    const blockId = action.blockId ?? state.blockId;
    if (!scene || !scene.blocks.some((block) => block.id === blockId)) return state;
    const replay = stateAtBlock({ ...state, readOnly: true }, scene.id, blockId, []);
    return { ...replay, readOnly: true, status: statusForBlock(pkg, replay) };
  }
  return state;
}
