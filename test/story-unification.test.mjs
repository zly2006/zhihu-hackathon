import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("统一故事 action 入口提供带序号的 SSE 生命周期", () => {
  const route = readFileSync(join(root, "app", "api", "story", "action", "route.ts"), "utf8");
  for (const event of ["accepted", "canonical_committed", "complete", "error", "heartbeat"]) {
    assert.match(route, new RegExp(`send\\(\\"${event}\\"`), `缺少 ${event}`);
  }
  assert.match(route, /applySceneChoice/);
  assert.match(route, /runChapterSimulation/);
  assert.match(route, /seq/);
});
test("年度模拟已提取为可复用服务，旧 route 只负责流式边界", () => {
  const route = readFileSync(join(root, "app/api/chapter/simulate/route.ts"), "utf8");
  const service = readFileSync(join(root, "lib/game/chapter-simulation-service.ts"), "utf8");
  assert.match(route, /runChapterSimulation/);
  assert.doesNotMatch(route, /runWorldSimulator|reduceWorldState|retrieveEvidence/);
  assert.match(service, /cacheHit/);
  assert.match(service, /validationAttempts/);
});

test("三个 provider 只编排内容和边界，不把规则写进共享播放器", () => {
  const provider = readFileSync(join(root, "lib/game/story-provider.ts"), "utf8");
  const player = readFileSync(join(root, "components/life-vn/StoryPlayer.tsx"), "utf8");
  assert.match(provider, /createZhaoLengScriptedProvider/);
  assert.match(provider, /createZhaoLengAiProvider/);
  assert.match(provider, /createLifeAiProvider/);
  assert.match(player, /SceneRuntimePlayer/);
  assert.doesNotMatch(player, /zhaoLeng|worldSimulator|resolveDecision/);
});

test("新主游戏默认互动分支不再显示小说流式预览", () => {
  const app = readFileSync(join(root, "components/life/LifeApp.tsx"), "utf8");
  const directBranch = app.slice(app.indexOf('if (mode === "galgame")'), app.indexOf("// 生成小说"));
  assert.match(directBranch, /fetchInteractiveStoryUnit/);
  assert.match(directBranch, /presentation: \{ mode: "galgame"/);
  assert.doesNotMatch(directBranch, /fetchNovel|StreamingNovelPreview/);
  assert.match(app, /storySession/);
});
