import { NextResponse } from "next/server";
import type { Character } from "@/lib/domain/character";
import type { GameSave } from "@/lib/domain/chapter";
import type { Relationship } from "@/lib/domain/relationship";
import type { WorldState } from "@/lib/domain/world";
import { createNeutralScenePackages, NEUTRAL_CHARACTER_IDS } from "@/lib/game/neutral-scene-package";
import { createSceneRuntime } from "@/lib/game/scene-runtime";
import { initializeSnapshotState } from "@/lib/game/snapshot-manager";
import { validateScenePackage } from "@/lib/game/scene-package-validator";
import { validateWorldState } from "@/lib/domain/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOW = "2026-01-01T00:00:00.000Z";

function character(id: string, name: string, role: Character["role"], year: number): Character {
  return {
    id,
    role,
    identity: { name, birthYear: year - (role === "protagonist" ? 18 : 20), gender: "未设定", hometown: "测试城市", familyBackground: "中性测试夹具" },
    core: { personalityTraits: ["谨慎"], values: ["诚实"], talents: { insight: 50, charm: 50, grit: 50, learning: 50, luck: 50 }, hooks: [] },
    state: {
      age: role === "protagonist" ? 18 : 20,
      year,
      city: "测试城市",
      occupation: "测试工作",
      socialIdentity: "测试身份",
      stats: { cash: 35, health: 80, happiness: 60, knowledge: 50, connections: 25, career: 15, assets: 5 },
      currentGoals: [],
      currentDilemmas: [],
      attitudes: {},
    },
    speechStyle: "表达清楚具体",
    emotionState: "平静",
    relationshipHistory: [],
    memoryIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createDemoWorld(): WorldState {
  const characters = {
    [NEUTRAL_CHARACTER_IDS.protagonist]: character(NEUTRAL_CHARACTER_IDS.protagonist, "测试主角", "protagonist", 2026),
    [NEUTRAL_CHARACTER_IDS.first]: character(NEUTRAL_CHARACTER_IDS.first, "测试角色甲", "npc", 2026),
    [NEUTRAL_CHARACTER_IDS.second]: character(NEUTRAL_CHARACTER_IDS.second, "测试角色乙", "npc", 2026),
    [NEUTRAL_CHARACTER_IDS.third]: character(NEUTRAL_CHARACTER_IDS.third, "测试角色丙", "npc", 2026),
  };
  const relationship = (id: string, target: string, score = 50): Relationship => ({
    id,
    characterAId: NEUTRAL_CHARACTER_IDS.protagonist,
    characterBId: target,
    type: "friend",
    scores: { closeness: score, trust: score, conflict: 10, commitment: 35 },
    publicSummary: "中性测试关系",
    unresolvedIssues: [],
    milestoneEventIds: [],
    status: "active",
    updatedAt: NOW,
  });
  const world: WorldState = {
    schemaVersion: 1,
    gameId: "synthetic-neutral-scene-demo",
    currentYear: 2026,
    protagonistId: NEUTRAL_CHARACTER_IDS.protagonist,
    characters,
    relationships: {
      "test-relationship-a": relationship("test-relationship-a", NEUTRAL_CHARACTER_IDS.first),
      "test-relationship-b": relationship("test-relationship-b", NEUTRAL_CHARACTER_IDS.second, 42),
      "test-relationship-c": relationship("test-relationship-c", NEUTRAL_CHARACTER_IDS.third, 35),
    },
    memories: {},
    chapterIds: [],
    eraContext: null,
    openThreads: [],
    canonicalEventIds: [],
    updatedAt: NOW,
  };
  validateWorldState(world);
  return world;
}

export async function GET() {
  const world = createDemoWorld();
  const packages = createNeutralScenePackages(world.currentYear);
  packages.forEach((packageItem, index) => {
    validateScenePackage(packageItem, {
      world: { ...world, currentYear: world.currentYear + index },
      currentYear: world.currentYear + index,
      flags: {},
    });
  });
  const baseSave: GameSave = {
    schemaVersion: 1,
    savedAt: NOW,
    worldState: world,
    chapters: {},
    events: {},
    experienceCache: {},
    presentationMode: "galgame",
    activeBranchId: "main",
    scenePackages: Object.fromEntries(packages.map((packageItem) => [packageItem.chapterId, packageItem])),
    sceneActions: [],
    sceneFlags: {},
    saveRevision: 0,
  };
  const save = initializeSnapshotState(baseSave, NOW);
  const runtime = createSceneRuntime(packages[0], { branchId: "main" });
  return NextResponse.json({
    synthetic: true,
    saveKey: "restart-life-neutral-scene-demo-v1",
    gameSave: { ...save, sceneRuntime: runtime },
    scenePackage: packages[0],
    packageIds: packages.map((packageItem) => packageItem.id),
  });
}
