// Phase 1 冒烟测试：验证角色工厂与初始世界构造（纯逻辑，不涉及 LLM）。
// 编译：npx tsc --outDir .tmp/phase1-test --module commonjs --moduleResolution node --target es2022 lib/domain/*.ts lib/game/character-factory.ts lib/game/save.ts
// 运行：node test/phase1-factory.smoke.mjs
const base = process.env.PHASE1_TEST_DIR || ".tmp/phase1-test";
async function load(rel) {
  return import(new URL(`../${base}/${rel}`, import.meta.url).href);
}

const factory = await load("game/character-factory.js");
const { validateWorldState } = await load("domain/validate.js");
const { parseGameSave } = await load("game/save.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}

const protagonist = factory.createProtagonist({
  name: "张明",
  birthYear: 2008,
  gender: "男",
  hometown: "武汉",
  familyBackground: "普通工薪家庭",
  initialCity: "深圳",
  initialDirection: "程序员",
  personalityTraits: ["谨慎", "务实", "念旧", "内敛", "要强", "第六个应被截断"],
  values: ["稳定", "家庭", "独立", "诚实", "第五个应被截断"],
  longTermGoal: "在大城市立足",
  initialDilemma: "毕业即面临就业压力",
  talents: { insight: 120, charm: 50, grit: 70, learning: -10, luck: 40 },
});

check("主角 role=protagonist", protagonist.role === "protagonist");
check("主角 18 岁开局", protagonist.state.age === 18);
check("主角 year = birthYear+18", protagonist.state.year === 2008 + 18);
check("性格标签最多 5 个", protagonist.core.personalityTraits.length === 5);
check("价值观最多 4 个", protagonist.core.values.length === 4);
check("天赋 clamp 到 0-100", protagonist.core.talents.insight === 100 && protagonist.core.talents.learning === 0);
check("长期目标写入", protagonist.state.currentGoals.length === 1);
check("初始困境写入", protagonist.state.currentDilemmas.includes("毕业即面临就业压力"));

const npcDraft = {
  name: "林雨",
  gender: "女",
  age: 18,
  relationshipType: "partner",
  basicSetting: "主角的高中同学",
  personalityTraits: ["独立", "要强"],
  values: ["家庭"],
  hiddenGoal: "回老家照顾父母",
  hiddenConcern: "在城市站不住脚",
  privateBelief: "稳定比冒险重要",
};
const npc = factory.createNpc(npcDraft, 2026);
check("NPC role=npc", npc.role === "npc");
check("NPC 年龄写入", npc.state.age === 18);
check("NPC birthYear = currentYear - age", npc.identity.birthYear === 2026 - 18);
check("NPC 隐藏状态写入", npc.privateState?.hiddenGoals.includes("回老家照顾父母"));

const rel = factory.createRelationship(protagonist.id, npc.id, "partner", "主角的高中同学");
check("关系 scores 按类型初始化", rel.scores.closeness === 55 && rel.scores.commitment === 45);
check("关系双方 id 正确", rel.characterAId === protagonist.id && rel.characterBId === npc.id);

const npc2 = factory.createNpc({ ...npcDraft, name: "王浩", relationshipType: "friend", age: 19, hiddenGoal: "创业" }, 2026);
const npc3 = factory.createNpc({ ...npcDraft, name: "陈楠", relationshipType: "coworker", age: 25, hiddenGoal: "升职" }, 2026);
const relationships = [
  factory.createRelationship(protagonist.id, npc.id, "partner", "高中同学"),
  factory.createRelationship(protagonist.id, npc2.id, "friend", "发小"),
  factory.createRelationship(protagonist.id, npc3.id, "coworker", "同组同事"),
];
const world = factory.createInitialWorldState(protagonist, [npc, npc2, npc3], relationships);
check("世界含 1 主角 + 3 NPC", Object.keys(world.characters).length === 4);
check("世界含 3 条关系", Object.keys(world.relationships).length === 3);
check("world 通过引用完整性校验", (() => {
  try {
    validateWorldState(world);
    return true;
  } catch {
    return false;
  }
})());

const save = factory.createInitialGameSave(world);
const parsed = parseGameSave(JSON.parse(JSON.stringify(save)));
check("初始存档 schemaVersion=1 且可解析", parsed.schemaVersion === 1 && parsed.worldState.gameId === world.gameId);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
