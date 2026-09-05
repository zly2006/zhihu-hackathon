const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";

const IDS = {
  protagonist: "test-protagonist",
  first: "test-character-a",
  second: "test-character-b",
  third: "test-character-c",
  relationship: "test-relationship-a",
};

function character(id, name, role, year = 2026) {
  return {
    id,
    role,
    identity: {
      name,
      birthYear: year - (role === "protagonist" ? 18 : 20),
      gender: "未知",
      hometown: "测试城市",
      familyBackground: "测试家庭",
    },
    core: {
      personalityTraits: ["谨慎"],
      values: ["诚实"],
      talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 },
      hooks: [],
    },
    state: {
      age: role === "protagonist" ? 18 : 20,
      year,
      city: "测试城市",
      occupation: "测试工作",
      socialIdentity: "测试身份",
      stats: {
        cash: 35,
        health: 80,
        happiness: 60,
        knowledge: 50,
        connections: 25,
        career: 15,
        assets: 5,
      },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    speechStyle: "表达清楚具体",
    emotionState: "平静",
    relationshipHistory: [],
    memoryIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeWorld(overrides = {}) {
  const year = overrides.currentYear ?? 2026;
  const characters = {
    [IDS.protagonist]: character(IDS.protagonist, "测试主角", "protagonist", year),
    [IDS.first]: character(IDS.first, "测试角色甲", "npc", year),
    [IDS.second]: character(IDS.second, "测试角色乙", "npc", year),
    [IDS.third]: character(IDS.third, "测试角色丙", "npc", year),
  };
  const relationships = {
    [IDS.relationship]: {
      id: IDS.relationship,
      characterAId: IDS.protagonist,
      characterBId: IDS.first,
      type: "friend",
      scores: { closeness: 50, trust: 50, conflict: 10, commitment: 35 },
      publicSummary: "测试主角与测试角色甲的测试关系",
      unresolvedIssues: [],
      milestoneEventIds: [],
      status: "active",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  return {
    schemaVersion: 1,
    gameId: "test-game",
    currentYear: year,
    protagonistId: IDS.protagonist,
    characters,
    relationships,
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    characters: overrides.characters ?? characters,
    relationships: overrides.relationships ?? relationships,
  };
}

export function makeScenePackage(overrides = {}) {
  const pkg = {
    schemaVersion: 1,
    id: "test-package",
    version: 1,
    chapterId: "test-chapter",
    entrySceneId: "test-scene-1",
    scenes: [
      {
        id: "test-scene-1",
        mode: "live",
        background: "urban-home-apartment-day-v1",
        timeLabel: "2026 年 · 测试场景",
        year: 2026,
        sourceEventIds: [],
        characters: [
          { id: IDS.protagonist, name: "测试主角", position: "center" },
          { id: IDS.first, name: "测试角色甲", position: "left" },
        ],
        blocks: [
          {
            id: "test-scene-1-b1",
            content: { type: "dialogue", speakerId: IDS.first, speaker: "测试角色甲", text: "先听我说完。", emotion: "平静" },
          },
          {
            id: "test-scene-1-choice",
            content: {
              type: "choice",
              text: "你怎么回应？",
              choices: [
                {
                  id: "A",
                  label: "认真听完",
                  ruleId: "listen_without_promise",
                  targetCharacterId: IDS.first,
                  requirements: [],
                  next: { kind: "scene", sceneId: "test-scene-2" },
                },
                {
                  id: "B",
                  label: "说明边界",
                  ruleId: "clarify_boundary",
                  targetCharacterId: IDS.first,
                  requirements: [],
                  next: { kind: "scene", sceneId: "test-scene-2" },
                },
              ],
            },
          },
        ],
        defaultNext: { kind: "scene", sceneId: "test-scene-2" },
      },
      {
        id: "test-scene-2",
        mode: "live",
        background: "urban-home-apartment-night-v1",
        timeLabel: "2026 年 · 测试收束",
        year: 2026,
        sourceEventIds: [],
        characters: [{ id: IDS.first, name: "测试角色甲", position: "left" }],
        blocks: [
          { id: "test-scene-2-b1", content: { type: "narration", text: "测试场景结束。" } },
        ],
        defaultNext: { kind: "chapter_end" },
      },
    ],
    endings: [],
    ...overrides,
  };
  return JSON.parse(JSON.stringify(pkg));
}

export function makeProjection(overrides = {}) {
  const worldState = overrides.worldState ?? makeWorld();
  return {
    worldState,
    chapters: {},
    events: {},
    experienceCache: {},
    activeBranchId: "branch-main",
    runtime: {
      schemaVersion: 1,
      branchId: "branch-main",
      chapterId: "test-chapter",
      packageId: "test-package",
      packageVersion: 1,
      sceneId: "test-scene-1",
      blockId: "test-scene-1-choice",
      status: "awaiting_choice",
      playbackMode: "manual",
      readBlockIds: ["test-scene-1-b1"],
    },
    actions: [],
    flags: {},
    revision: 0,
    ...overrides,
    worldState,
  };
}

export function makeChoiceResponse(overrides = {}) {
  return {
    requestId: "request-1",
    beforeRevision: 0,
    afterRevision: 1,
    record: {
      id: "action-1",
      branchId: "branch-main",
      chapterId: "test-chapter",
      packageId: "test-package",
      packageVersion: 1,
      sceneId: "test-scene-1",
      blockId: "test-scene-1-choice",
      choiceId: "A",
      label: "认真听完",
      ruleId: "listen_without_promise",
      targetCharacterId: IDS.first,
      eventIds: ["scene-event-1"],
      actualRelationshipDelta: { trust: 4 },
      flagsAfter: { listened: true },
      next: { kind: "scene", sceneId: "test-scene-2" },
      beforeHash: "before",
      afterHash: "after",
      committedAt: "2026-01-01T00:00:00.000Z",
    },
    events: [],
    worldStateAfter: makeWorld(),
    runtimeAfter: makeProjection().runtime,
    flagsAfter: { listened: true },
    feedback: "你认真听完了这段话。",
    replayed: false,
    ...overrides,
  };
}

export async function walkNeutralPackages() {
  const module = await import(new URL(`../../${buildDir}/game/neutral-scene-package.js`, import.meta.url).href);
  return module.createNeutralScenePackages();
}

export { IDS };
