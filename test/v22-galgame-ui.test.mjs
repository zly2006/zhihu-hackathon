import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("V2.2: VN 组件族具备独立文件和公开导出", () => {
  const components = [
    ["CharacterAvatar", "components/life-vn/CharacterAvatar.tsx"],
    ["ChoicePanel", "components/life-vn/ChoicePanel.tsx"],
    ["Timeline", "components/life-vn/Timeline.tsx"],
    ["StatusHUD", "components/life-vn/StatusHUD.tsx"],
  ];
  for (const [name, file] of components) {
    assert.ok(existsSync(join(root, file)), `${name} 文件必须存在`);
    assert.match(read(file), new RegExp(`export function ${name}`));
  }
});

test("V2.2: CharacterAvatar 使用位置和 active 状态渲染公开角色", () => {
  const source = read("components/life-vn/CharacterAvatar.tsx");
  assert.match(source, /DialogueCharacter/);
  assert.match(source, /activeCharacterId/);
  assert.match(source, /position/);
  assert.match(source, /avatarUrl/);
  assert.match(source, /aria-label/);
});

test("V2.2: ChoicePanel 是受控可访问选择且支持禁用", () => {
  const source = read("components/life-vn/ChoicePanel.tsx");
  assert.match(source, /onSelect/);
  assert.match(source, /disabled/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /onKeyDown/);
  assert.match(source, /event\.key/);
});

test("V2.2: Timeline 和 StatusHUD 复用既有展示层", () => {
  const timeline = read("components/life-vn/Timeline.tsx");
  const status = read("components/life-vn/StatusHUD.tsx");
  assert.match(timeline, /active/);
  assert.match(timeline, /chapters/);
  assert.match(status, /PlayerHud/);
  assert.match(status, /RelationshipHud/);
  assert.ok(!/privateState/.test(status), "StatusHUD 不得读取 privateState");
});

test("V2.2: SceneStage 和 DialogueBox 接入可复用组件", () => {
  const stage = read("components/life-vn/SceneStage.tsx");
  const box = read("components/life-vn/DialogueBox.tsx");
  assert.match(stage, /CharacterAvatar/);
  assert.match(stage, /characters/);
  assert.match(stage, /activeCharacterId/);
  assert.match(box, /ChoicePanel/);
});

test("V2.2: LifeApp 与 ChapterSummary 使用同一组 VN 面板", () => {
  const lifeApp = read("components/life/LifeApp.tsx");
  const summary = read("components/life/ChapterSummary.tsx");
  for (const source of [lifeApp, summary]) {
    for (const name of ["Timeline", "StatusHUD"]) {
      assert.match(source, new RegExp(name), `${name} 必须接入页面`);
    }
  }
  assert.match(lifeApp, /handleSelect/);
  assert.match(summary, /activeCharacterId|characters/);
  assert.match(summary, /disabled: true/);
  assert.match(summary, /不接入新结算入口|仅展示/);
});

test("V2.2: 页面不新增第二条世界结算路径", () => {
  const summary = read("components/life/ChapterSummary.tsx");
  assert.ok(!/fetch\(["']\/api\/chapter\/(simulate|choices)/.test(summary), "章节对白页不得重复请求结算接口");
  assert.match(summary, /onContinue/);
});

test("V3: BranchPanel exposes branch switching and scene checkpoint fork actions", () => {
  const source = read("components/life-vn/BranchPanel.tsx");
  assert.match(source, /export function BranchPanel/);
  assert.match(source, /onSwitchBranch/);
  assert.match(source, /onCreateBranch/);
  assert.match(source, /场景检查点/);
});

test("V3: live position persistence creates a checkpoint on reaching a choice", () => {
  const source = read("components/life/LifeApp.tsx");
  const demoPersistence = source.slice(
    source.indexOf("const handleDemoPersistPosition"),
    source.indexOf("const handleDemoSelect"),
  );
  const formalPersistence = source.slice(
    source.indexOf("const handleFormalScenePersistPosition"),
    source.indexOf("const handleFormalSceneSelect"),
  );
  const positionHelper = source.slice(
    source.indexOf("function saveLiveScenePosition"),
    source.indexOf("async function fetchDialogue"),
  );
  assert.match(demoPersistence, /status === "awaiting_choice"/);
  assert.match(demoPersistence, /saveLiveScenePosition/);
  assert.match(formalPersistence, /status === "awaiting_choice"/);
  assert.match(formalPersistence, /saveLiveScenePosition/);
  assert.match(positionHelper, /appendSceneChoiceCheckpoint/);
});

test("V3: branch controls are blocked while a scene choice is submitting", () => {
  const source = read("components/life/LifeApp.tsx");
  const demoBranchActions = source.slice(
    source.indexOf("const handleDemoCreateBranch"),
    source.indexOf("const handleFormalCreateBranch"),
  );
  const formalBranchActions = source.slice(
    source.indexOf("const handleFormalCreateBranch"),
    source.indexOf("const handleExitDemo"),
  );
  assert.match(demoBranchActions, /sceneRuntime\?\.status === "submitting"/);
  assert.match(formalBranchActions, /sceneRuntime\?\.status === "submitting"/);
  assert.match(source, /disabled=\{loading \|\| save\.sceneRuntime\.status === "submitting"\}/);
});
