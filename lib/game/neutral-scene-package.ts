// 中性玩法夹具：只验证 Scene Runtime，不代表正式剧情内容。

import type { DialogueCharacter } from "../domain/dialogue";
import type { RuntimeBlock, RuntimeScene, RuntimeChoice, ScenePackage } from "../domain/scene";

export const NEUTRAL_CHARACTER_IDS = {
  protagonist: "test-protagonist",
  first: "test-character-a",
  second: "test-character-b",
  third: "test-character-c",
} as const;

export const NEUTRAL_ENDING_IDS = {
  together: "test-ending-together",
  apart: "test-ending-apart",
} as const;

const BACKGROUNDS = {
  home: "urban-home-apartment-day-v1",
  night: "urban-home-apartment-night-v1",
  public: "urban-public-cafe-rain-v1",
} as const;

function character(
  id: string,
  name: string,
  position: "left" | "center" | "right",
  emotion = "平静",
): DialogueCharacter {
  return { id, name, position, emotion };
}

function dialogue(
  id: string,
  speakerId: string,
  speaker: string,
  text: string,
  emotion = "平静",
): RuntimeBlock {
  return {
    id,
    content: { type: "dialogue", speakerId, speaker, text, emotion },
    cues: [{ characterId: speakerId, emotion, animation: "speaking" }],
  };
}

function narration(id: string, text: string): RuntimeBlock {
  return { id, content: { type: "narration", text } };
}

function choiceBlock(id: string, text: string, choices: RuntimeChoice[]): RuntimeBlock {
  return { id, content: { type: "choice", text, choices } };
}

function baseCharacters(): DialogueCharacter[] {
  return [
    character(NEUTRAL_CHARACTER_IDS.protagonist, "测试主角", "center"),
    character(NEUTRAL_CHARACTER_IDS.first, "测试角色甲", "left"),
    character(NEUTRAL_CHARACTER_IDS.second, "测试角色乙", "right"),
    character(NEUTRAL_CHARACTER_IDS.third, "测试角色丙", "right"),
  ];
}

function scene(
  id: string,
  year: number,
  background: string,
  blocks: RuntimeBlock[],
  defaultNext: RuntimeScene["defaultNext"],
  characters = baseCharacters(),
): RuntimeScene {
  return {
    id,
    mode: "live",
    background,
    timeLabel: `${year} 年 · 测试场景`,
    year,
    sourceEventIds: [],
    characters,
    blocks,
    defaultNext,
  };
}

function packagesForYear(year: number): ScenePackage[] {
  const protagonist = NEUTRAL_CHARACTER_IDS.protagonist;
  const first = NEUTRAL_CHARACTER_IDS.first;
  const second = NEUTRAL_CHARACTER_IDS.second;

  const packageOne: ScenePackage = {
    schemaVersion: 1,
    id: "test-package-1",
    version: 1,
    chapterId: "test-chapter-1",
    entrySceneId: "test-c1-01",
    scenes: [
      scene(
        "test-c1-01",
        year,
        BACKGROUNDS.home,
        [
          narration("test-c1-01-b1", "这是一个用于验证玩法的中性场景。"),
          dialogue("test-c1-01-b2", first, "测试角色甲", "我们先把眼前的事实说清楚。", "thinking"),
        ],
        { kind: "scene", sceneId: "test-c1-02" },
      ),
      scene(
        "test-c1-02",
        year,
        BACKGROUNDS.public,
        [
          dialogue("test-c1-02-b1", protagonist, "测试主角", "我想知道这次选择会留下什么。"),
          choiceBlock("test-c1-02-choice", "你准备怎样回应？", [
            {
              id: "A",
              label: "先听完，再说自己能做到什么",
              ruleId: "listen_without_promise",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c1-03" },
            },
            {
              id: "B",
              label: "暂时回避这次谈话",
              ruleId: "avoid_conversation",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c1-03" },
            },
            {
              id: "C",
              label: "说明自己的边界",
              ruleId: "clarify_boundary",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c1-03" },
            },
          ]),
        ],
        { kind: "scene", sceneId: "test-c1-03" },
      ),
      scene(
        "test-c1-03",
        year,
        BACKGROUNDS.night,
        [
          dialogue("test-c1-03-b1", second, "测试角色乙", "你们刚才的决定，会影响下一次见面。", "serious"),
          narration("test-c1-03-b2", "第一章测试路线在这里汇合。"),
        ],
        { kind: "chapter_end" },
      ),
    ],
    endings: [],
  };

  const packageTwo: ScenePackage = {
    schemaVersion: 1,
    id: "test-package-2",
    version: 1,
    chapterId: "test-chapter-2",
    entrySceneId: "test-c2-01",
    scenes: [
      scene(
        "test-c2-01",
        year + 1,
        BACKGROUNDS.home,
        [dialogue("test-c2-01-b1", first, "测试角色甲", "新的阶段带来了新的安排。", "thinking")],
        { kind: "scene", sceneId: "test-c2-02" },
      ),
      scene(
        "test-c2-02",
        year + 1,
        BACKGROUNDS.public,
        [
          dialogue("test-c2-02-b1", protagonist, "测试主角", "这一次，我不想只给一个听起来漂亮的回答。"),
          choiceBlock("test-c2-02-choice", "你如何面对分歧？", [
            {
              id: "A",
              label: "坦诚说明目前能承担的部分",
              ruleId: "honest_talk",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c2-03" },
            },
            {
              id: "B",
              label: "先接受对方需要空间",
              ruleId: "respect_distance",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c2-03" },
            },
            {
              id: "C",
              label: "把谈话留到以后",
              ruleId: "avoid_conversation",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "scene", sceneId: "test-c2-03" },
            },
          ]),
        ],
        { kind: "scene", sceneId: "test-c2-03" },
      ),
      scene(
        "test-c2-03",
        year + 1,
        BACKGROUNDS.night,
        [
          dialogue("test-c2-03-b1", second, "测试角色乙", "关系不会因为一句话自动恢复，但会留下方向。", "serious"),
          dialogue("test-c2-03-b2", first, "测试角色甲", "那我们看看能不能把方向说得更具体。", "thinking"),
        ],
        { kind: "scene", sceneId: "test-c2-04" },
      ),
      scene(
        "test-c2-04",
        year + 1,
        BACKGROUNDS.home,
        [
          narration("test-c2-04-b1", "第二章测试路线在另一个分歧点前汇合。"),
          choiceBlock("test-c2-04-choice", "要不要制定一个能执行的共同安排？", [
            {
              id: "A",
              label: "制定一个共同计划",
              ruleId: "make_joint_plan",
              targetCharacterId: first,
              requirements: [
                { kind: "flag", key: "honestTalk", equals: true },
                { kind: "relationship", targetCharacterId: first, minTrust: 52 },
              ],
              next: { kind: "chapter_end" },
            },
            {
              id: "B",
              label: "尊重彼此的距离",
              ruleId: "respect_distance",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "chapter_end" },
            },
            {
              id: "C",
              label: "暂时不作安排",
              ruleId: "avoid_conversation",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "chapter_end" },
            },
          ]),
        ],
        { kind: "chapter_end" },
      ),
    ],
    endings: [],
  };

  const packageThree: ScenePackage = {
    schemaVersion: 1,
    id: "test-package-3",
    version: 1,
    chapterId: "test-chapter-3",
    entrySceneId: "test-c3-01",
    scenes: [
      scene(
        "test-c3-01",
        year + 2,
        BACKGROUNDS.home,
        [dialogue("test-c3-01-b1", first, "测试角色甲", "现在要面对的是选择留下的后果。", "serious")],
        { kind: "scene", sceneId: "test-c3-02" },
      ),
      scene(
        "test-c3-02",
        year + 2,
        BACKGROUNDS.public,
        [
          dialogue("test-c3-02-b1", second, "测试角色乙", "这次由你们自己决定走向哪里。"),
          dialogue("test-c3-02-b2", first, "测试角色甲", "别把没有说出口的部分，当成已经解决。", "thinking"),
        ],
        { kind: "scene", sceneId: "test-c3-04" },
      ),
      scene(
        "test-c3-03",
        year + 2,
        BACKGROUNDS.night,
        [
          choiceBlock("test-c3-03-choice", "最后一次选择由你来承担。", [
            {
              id: "A",
              label: "继续执行已经谈好的计划",
              ruleId: "move_forward",
              targetCharacterId: first,
              requirements: [
                { kind: "flag", key: "honestTalk", equals: true },
                { kind: "flag", key: "jointPlan", equals: true },
                { kind: "relationship", targetCharacterId: first, minCommitment: 20 },
              ],
              next: { kind: "ending", endingId: NEUTRAL_ENDING_IDS.together },
            },
            {
              id: "B",
              label: "接受各自前进的道路",
              ruleId: "separate_paths",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "ending", endingId: NEUTRAL_ENDING_IDS.apart },
            },
            {
              id: "C",
              label: "保持距离，暂不作决定",
              ruleId: "respect_distance",
              targetCharacterId: first,
              requirements: [],
              next: { kind: "ending", endingId: NEUTRAL_ENDING_IDS.apart },
            },
          ]),
        ],
        { kind: "ending", endingId: NEUTRAL_ENDING_IDS.apart },
      ),
      scene(
        "test-c3-04",
        year + 2,
        BACKGROUNDS.home,
        [narration("test-c3-04-b1", "条件已经明确，接下来仍然有两条可达道路。" )],
        { kind: "scene", sceneId: "test-c3-03" },
      ),
    ],
    endings: [
      { id: NEUTRAL_ENDING_IDS.together, title: "共同完成测试计划", summary: "两人选择继续执行公开谈好的安排。" },
      { id: NEUTRAL_ENDING_IDS.apart, title: "各自完成测试路线", summary: "两人承认差异，保留各自前进的空间。" },
    ],
  };

  return [packageOne, packageTwo, packageThree];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createNeutralScenePackages(currentYear = 2026): ScenePackage[] {
  return clone(packagesForYear(currentYear));
}

export function createNeutralScenePackage(chapterId: string, currentYear = 2026): ScenePackage {
  const packageItem = createNeutralScenePackages(currentYear).find((item) => item.chapterId === chapterId);
  if (!packageItem) throw new Error(`找不到中性测试章节：${chapterId}`);
  return packageItem;
}
