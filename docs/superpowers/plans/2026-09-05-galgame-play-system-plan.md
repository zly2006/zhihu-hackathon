# Galgame 玩法系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `/life` 上交付 B 负责的 Scene Runtime、可结算场景选择、关系反馈、可靠恢复、精确检查点/分支和三章中性玩法夹具；正式赵冷内容与 A/C 资产继续作为联调依赖。

**Architecture:** 保留章级 World Simulator 和结果页，将旧 `DialogueScene` 适配为只读 retrospective；新增版本化 `ScenePackage`、纯播放状态机、服务端注册规则和 canonical scene event。浏览器保存完整运行时投影，选择成功先完成幂等校验和 reducer 计算，再一次性写入 localStorage；React 组件只负责表现和生命周期。

**Tech Stack:** Next.js 16.3.2 App Router、React 19.2.8、TypeScript 5.9.3、Node `node:test`、现有 localStorage 与场景目录。即时场景选择不调用 LLM、不写数据库、不引入状态机库。

---

## Task 1: 修正方案范围并建立测试入口

**Files:**
- Modify: `docs/02_Galgame玩法系统_完整开发方案_2026-09-05.md`
- Modify: `docs/02_Galgame玩法系统_执行计划_2026-09-05.md`
- Modify: `scripts/test-all.mjs`
- Create: `test/v3-scene-contract.test.mjs`
- Create: `test/v3-scene-runtime.test.mjs`
- Create: `test/v3-scene-choice.test.mjs`
- Create: `test/v3-scene-save.test.mjs`
- Create: `test/v3-relationship.test.mjs`
- Create: `test/v3-neutral-fixture.test.mjs`

- [ ] **Step 1: 将两份新方案中的正式内容改为 B 范围。** 把“正式赵冷 Demo 必须由 B 交付”、ZL-01—ZL-10B 的正式要求、具体赵冷关系初值和 C 的 Prompt 任务改为中性夹具和 C 待交付清单；保留现有四份原分工文档不改。

- [ ] **Step 2: 建立每个 V3 套件的最小入口。** 每个新测试文件使用以下加载约定，先只断言目标导出不存在，确保 RED 原因是缺少功能而不是加载错误：

```js
import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.V3_TEST_DIR || ".tmp/test-all";
async function load(file) {
  return import(new URL(`../${buildDir}/game/${file}.js`, import.meta.url).href);
}

test("V3 test module is loaded from the current build", async () => {
  const module = await load("scene-runtime");
  assert.equal(typeof module.createSceneRuntime, "function");
});
```

- [ ] **Step 3: 注册 V3 套件。** 在 `scripts/test-all.mjs` 的 `suites` 末尾加入六个 `V3_TEST_DIR` 条目；编译源列表继续递归列出 `lib/domain`、扁平 `lib/game`，不读取全库数据。

- [ ] **Step 4: 用最新编译产物执行 RED。** 运行 `node scripts/test-all.mjs`，预期原套件通过，新增套件因缺少 `scene-runtime` 导出失败；记录基线失败原因，不修改 `.env` 或 `.zcode/`。

- [ ] **Step 5: 提交范围与测试入口。** 只暂存两份方案、`scripts/test-all.mjs` 和六个新测试文件，提交 `docs: align gameplay scope with B ownership`。

## Task 2: ScenePackage 契约和中性场景工厂

**Files:**
- Create: `lib/domain/scene.ts`
- Create: `lib/game/neutral-scene-package.ts`
- Create: `test/fixtures/scene-runtime-fixture.mjs`
- Test: `test/v3-scene-contract.test.mjs`

- [ ] **Step 1: 先写契约 RED 测试。** 覆盖 `schemaVersion=1`、package/version/chapter/scene/block 稳定 ID、`retrospective/live`、`chapter_end/ending` target、choice block、四轴 delta、runtime/action/request/response 类型所需的运行时字段；断言中性工厂可返回 3 个包和 11 个 scene 节点。

- [ ] **Step 2: 定义最小类型。** 在 `lib/domain/scene.ts` 导出下列接口族，并仅使用已有 domain 类型：

```ts
export type SceneMode = "retrospective" | "live";
export type SceneTarget =
  | { kind: "scene"; sceneId: string }
  | { kind: "chapter_end" }
  | { kind: "ending"; endingId: string };
export type SceneRequirement =
  | { kind: "relationship"; targetCharacterId: string; minLevel?: string; minTrust?: number; maxConflict?: number; minCommitment?: number }
  | { kind: "flag"; key: string; equals: boolean };
export type RuntimeChoice = {
  id: "A" | "B" | "C";
  label: string;
  ruleId: string;
  targetCharacterId?: string;
  requirements: SceneRequirement[];
  next: SceneTarget;
};
export type RuntimeBlock =
  | { id: string; content: Exclude<DialogueBlock, { type: "choice" }>; cues?: SceneCue[] }
  | { id: string; content: { type: "choice"; text: string; choices: RuntimeChoice[] } };
export type RuntimeScene = { id: string; mode: SceneMode; background: string; timeLabel: string; year: number; sourceEventIds: string[]; characters: DialogueCharacter[]; blocks: RuntimeBlock[]; defaultNext: SceneTarget };
export type ScenePackage = { schemaVersion: 1; id: string; version: number; chapterId: string; entrySceneId: string; scenes: RuntimeScene[]; endings: Array<{ id: string; title: string; summary: string }> };
export type SceneRuntimeState = { schemaVersion: 1; branchId: string; chapterId: string; packageId: string; packageVersion: number; sceneId: string; blockId: string; status: "reading" | "awaiting_choice" | "submitting" | "feedback" | "completed" | "error"; playbackMode: "manual" | "auto"; readBlockIds: string[]; selectedActionId?: string; pendingAction?: { requestId: string; choiceId: "A" | "B" | "C"; issuedAt: string; expectedRevision: number }; errorCode?: string };
export type SceneActionRecord = { id: string; branchId: string; chapterId: string; packageId: string; packageVersion: number; sceneId: string; blockId: string; choiceId: "A" | "B" | "C"; label: string; ruleId: string; targetCharacterId?: string; eventIds: string[]; actualRelationshipDelta: Partial<RelationshipScores>; flagsAfter: Record<string, boolean>; next: SceneTarget; beforeHash: string; afterHash: string; committedAt: string };
```

The same file also exports `SceneCue`, `SceneSaveProjection`, `SceneChoiceRequest`, and `SceneChoiceResponse`; their fields must carry branch/package/version/block/revision identity and never carry a client-authoritative delta.

- [ ] **Step 3: Add the neutral three-chapter package factory.** `createNeutralScenePackages()` returns packages for `test-chapter-1`, `test-chapter-2`, and `test-chapter-3`; use existing scene-catalog backgrounds, stable `test-*` IDs, one protagonist plus three NPCs, two visible endings, and choices that cover one branch, one merge, and relationship/flag requirements. Every package contains only public text and cues.

- [ ] **Step 4: Add the plain-object fixture loader.** `test/fixtures/scene-runtime-fixture.mjs` exports `makeScenePackage`, `makeWorld`, `makeProjection`, `makeChoiceResponse`, and `walkNeutralPackages`; fixture data uses “测试主角”“测试角色甲”等名称 and does not import `.env`, database, or model code.

- [ ] **Step 5: Compile and run the contract RED/GREEN boundary.** Run `node scripts/test-all.mjs --` after each domain edit; expected Task 2 tests initially fail on absent factory fields, then pass once all fields are present. Commit `feat: add versioned scene package contracts`.

## Task 3: Legacy adapter and independent package validator

**Files:**
- Create: `lib/game/scene-adapter.ts`
- Create: `lib/game/scene-package-validator.ts`
- Test: `test/v3-scene-contract.test.mjs`

- [ ] **Step 1: Write validator RED cases.** Add tests for unknown character, invalid background, duplicate scene/block/choice IDs, missing entry/target/ending, unknown rule, invalid 1/4-choice count, cycle, unreachable node, all choices locked, live year not equal to `world.currentYear`, and old `DialogueScene` choice with no rule metadata remaining read-only.

- [ ] **Step 2: Define a path-carrying validation error.** Export `ScenePackageValidationError` with `path` and `code`; error messages identify e.g. `scenes[1].blocks[2].content.choices[0].next.sceneId`, never silently discard invalid content.

- [ ] **Step 3: Implement `adaptDialogueScenes`.** Convert each legacy scene to `retrospective`, generate deterministic block IDs from `sceneId:block:index`, preserve speaker/emotion/avatar/cues, add sequential `defaultNext`, and mark all legacy choices as display-only unless complete execution metadata is explicitly supplied. A top-level/block choice conflict throws a path error.

- [ ] **Step 4: Implement `validateScenePackage`.** Validate schema, IDs, references against world and `findScene`, target/ending reachability, DAG traversal, mode/year/chapter binding, rule registry membership, requirement shape, and at least one currently selectable choice. Return a normalized deep clone; do not mutate world or call a model.

- [ ] **Step 5: Run only the contract suite.** `node scripts/test-all.mjs` must show the new contract suite passing and all existing suites unchanged. Commit `feat: validate scene graphs and adapt legacy dialogue`.

## Task 4: Pure playback state machine and visual adapter contract

**Files:**
- Create: `lib/game/scene-runtime.ts`
- Create: `lib/game/visual-resolver.ts`
- Create: `test/v3-scene-runtime.test.mjs`
- Test: `test/v3-scene-contract.test.mjs`

- [ ] **Step 1: Write state-machine RED tests.** Cover initial state, manual `NEXT`, `AUTO_TICK`, `SKIP`, stop at an unselected choice, no automatic choice, `SELECT_STARTED`, `SELECT_SUCCEEDED` routing from `record.next`, `SELECT_FAILED`, retry/`RESUME`, feedback acknowledgement, ending/chapter completion, invalid action ignored, and `REPLAY` for read-only history.

- [ ] **Step 2: Implement deterministic transitions.** Export `createSceneRuntime`, `transitionSceneRuntime`, `getActiveBlock`, `getActiveScene`, and `findNextChoice`. Store only serializable IDs/read blocks; never store WorldState or calculate relationship effects in the runtime. When a choice block is current, `NEXT`, `AUTO_TICK`, and `SKIP` return `awaiting_choice` unchanged.

- [ ] **Step 3: Add visual resolver fallback order.** `resolveCharacterVisual` accepts character ID, emotion, pose, animation, a profile map, and avatar fallback; it returns exact profile output, neutral/default, avatar, or name placeholder in that order. It does not create asset filenames or modify character state.

- [ ] **Step 4: Run runtime RED → GREEN.** Compile lib to `.tmp/test-all` and execute `node test/v3-scene-runtime.test.mjs` with `V3_TEST_DIR=.tmp/test-all`; no React or browser is involved. Commit `feat: add deterministic scene playback state machine`.

## Task 5: Relationship levels, registered rules, event validation, and idempotent service

**Files:**
- Create: `lib/game/relationship-levels.ts`
- Create: `lib/game/scene-choice-rules.ts`
- Create: `lib/game/scene-choice-resolver.ts`
- Create: `lib/game/scene-event-validator.ts`
- Create: `lib/game/scene-choice-service.ts`
- Modify: `lib/domain/simulation.ts`
- Test: `test/v3-scene-choice.test.mjs`
- Test: `test/v3-relationship.test.mjs`

- [ ] **Step 1: Write relationship and resolver RED tests.** Assert affinity levels at 20/40/60/80, high closeness/high conflict coexistence, missing relation rejection, exact rule IDs, public requirement reasons, after-before clamp at 0/100, flags, current-year event, unchanged life stats/time/chapter count, and action context never exposing private state.

- [ ] **Step 2: Implement shared predicates.** Export `deriveRelationshipLevel`, `levelLabel`, `nextRelationshipThreshold`, `findProtagonistRelationship`, and `evaluateSceneRequirements`. Use `closeness * 0.6 + trust * 0.4 - conflict * 0.3`, keep commitment separate, and return public lock reasons without revealing hidden conditions.

- [ ] **Step 3: Register concrete neutral rules.** Include `listen_without_promise`, `clarify_boundary`, `avoid_conversation`, `make_joint_plan`, `respect_distance`, `honest_talk`, `move_forward`, and `separate_paths`; each rule declares its semantic delta, possible flags, feedback, target requirement, and no default reward for unknown IDs. The values are test mechanics, not formal赵冷 values.

- [ ] **Step 4: Resolve from server registry.** `resolveSceneChoice` takes a validated package/runtime/world/flags/choice and returns an event draft, actual relationship delta after clamp, flags, public feedback, and record metadata. Ignore any `delta` field supplied by a caller. Add optional `SimulationEvent.source` with `kind: "scene_choice"`, action ID, rule ID, package/version and scene/block.

- [ ] **Step 5: Validate an immediate event.** `validateSceneEvent` permits exactly one current-year scene event, only registered participant/relationship IDs, bounded finite relationship changes, no stat changes, no memories/evidence/thread updates, matching source/record, and no macro event-count requirements.

- [ ] **Step 6: Implement service idempotency before reducer.** `applySceneChoice` checks projection revision and six-part logical slot, then existing action/event IDs, and only then calls `reduceWorldState` with one event, empty memories/goals/hooks/threads, and `endYear=world.currentYear`. Same slot/same choice replays without reducer; same slot/different choice returns conflict; event-without-action returns incomplete-save error.

- [ ] **Step 7: Execute choice and relationship suites.** Run both suites against fresh `.tmp/test-all`; tests must prove original WorldState is immutable and reducer is not called twice for replay. Commit `feat: settle scene choices through canonical events`.

## Task 6: Save projection, pending chapter recovery, and branch checkpoints

**Files:**
- Modify: `lib/domain/chapter.ts`
- Modify: `lib/domain/snapshot.ts`
- Modify: `lib/game/save.ts`
- Modify: `lib/game/snapshot-manager.ts`
- Create: `lib/game/scene-save.ts`
- Create: `lib/game/chapter-recovery.ts`
- Test: `test/v3-scene-save.test.mjs`

- [ ] **Step 1: Write save RED tests.** Cover old save normalization, unknown scene module version read-only behavior, scene position validation, exact before-hash/revision checks, duplicate committed action, storage write failure, pending stages, macro event preservation after refresh, two same-chapter checkpoints with distinct IDs, branch copy before choice, branch switch isolation, and immutable source snapshot.

- [ ] **Step 2: Extend additive save types.** Keep `GameSave.schemaVersion=1`; add optional `sceneRuntime`, `sceneActions`, `sceneFlags`, `scenePackages`, `pendingChapter`, and `saveRevision`. Add `scene-choice` snapshot kind, sequence and optional runtime/action/flags/package maps. Define `PendingChapter` with execution ID, selection, stateBefore/After hashes, simulation/event/evidence references, generation stage, completed novel/dialogue/plan fields, and error state.

- [ ] **Step 3: Implement normalization and atomic commit helpers.** Export `normalizeSceneSave`, `commitSceneChoice`, `serializeSceneSave`, and `recoverSceneRuntime`. Validate cross-references; reject unknown future module versions without overwriting; create a new immutable object; compare revision and beforeHash; never publish a partially written state.

- [ ] **Step 4: Fix pending chapter lifecycle.** Export `createPendingChapter`, `updatePendingChapterStage`, `completePendingChapter`, and `resumePendingChapter`; stage updates require the same execution ID, preserve world/events/evidence, and do not re-run simulation. Completed chapter clears pending only after chapter and package are present.

- [ ] **Step 5: Upgrade snapshots and branches.** Add `appendSceneChoiceCheckpoint`, `createBranchFromSceneCheckpoint`, and `switchBranch`; checkpoint ID includes branch/chapter/package/version/scene/block/sequence. Copy exact ancestor projection, reset only the selected choice position, preserve ancestor actions read-only, and leave source branch/snapshot unchanged. Replace chapter-index-only ordering with sequence-aware stable sorting while retaining legacy nodes.

- [ ] **Step 6: Run save suite and existing snapshot suite.** Use `node test/v3-scene-save.test.mjs` and `node test/v23-snapshot-replay.test.mjs` after compiling current code; commit `feat: persist scene sessions and isolated checkpoints`.

## Task 7: Scene choice API and React lifecycle/player

**Files:**
- Create: `app/api/chapter/scene-choice/route.ts`
- Create: `components/life/use-scene-runtime.ts`
- Create: `components/life-vn/SceneRuntimePlayer.tsx`
- Create: `components/life-vn/ScenePlaybackControls.tsx`
- Modify: `components/life-vn/ChoicePanel.tsx`
- Modify: `components/life-vn/DialogueBox.tsx`
- Modify: `components/life-vn/SceneStage.tsx`
- Test: `test/v3-scene-runtime.test.mjs`
- Test: `test/v3-scene-choice.test.mjs`

- [ ] **Step 1: Write API contract RED assertions.** Add a source contract test that the route is Node runtime, imports only scene service/domain modules, exposes `POST`, and maps malformed input to 400, locked choice to 422, revision/slot conflict to 409, and service failure to 500 with `{ error: { code, message, retryable } }`.

- [ ] **Step 2: Implement route parsing and error mapping.** Accept package/projection/request ID/issuedAt/expectedRevision/choice ID; do not accept or use client delta. Call `applySceneChoice`; return JSON response with replay flag, record, event, world/runtime after, and public feedback. Do not import `llm`, `database`, `world-simulator`, or Prompt code.

- [ ] **Step 3: Implement hook lifecycle.** `useSceneRuntime` owns runtime state, one in-flight request, `setTimeout`, `visibilitychange`, reduced-motion, and scene-change cleanup. `SELECT` disables all choices until response; stale branch/package/revision/request responses are ignored. Error state retains current choice for same-action retry.

- [ ] **Step 4: Implement controlled player.** `SceneRuntimePlayer` uses the existing stage/dialogue/choice components, projects speaker and cues per block, shows lock reasons and `aria-live` feedback, and exposes `readOnly` so history playback never calls POST. `ScenePlaybackControls` implements manual/auto/skip/speed without auto-selecting.

- [ ] **Step 5: Fix keyboard/touch duplication.** `ChoicePanel` uses native button activation for Enter and one Space path; `DialogueBox` forwards a single controlled callback; text shortcuts ignore input/textarea/dialog/focused buttons. Run TypeScript build after each UI change.

- [ ] **Step 6: Commit the single-scene UI/API.** Run `npm run lint` and `npm run build` serially; when both exit 0, commit `feat: connect scene choice API and playback controls`, preserving the known KB tracing warning.

## Task 8: LifeApp integration, relationship HUD, and action context

**Files:**
- Modify: `components/life/LifeApp.tsx`
- Modify: `components/life/ChapterSummary.tsx`
- Modify: `components/life-vn/RelationshipHud.tsx`
- Modify: `lib/game/presentation.ts`
- Create: `lib/game/scene-action-context.ts`
- Modify: `components/life-vn/ChapterResult.tsx`
- Test: `test/v3-relationship.test.mjs`
- Test: `test/v3-scene-save.test.mjs`

- [ ] **Step 1: Write integration RED tests.** Assert presentation filters only protagonist relationships, exposes all four axes/level/threshold/conflict, action context includes only last completed chapter’s three public actions in order, novel/galgame consume identical action/response semantics, and `onNextChapter` stays unavailable before live completion.

- [ ] **Step 2: Compile public scene packages into Chapter/GameSave.** On completed macro simulation, persist a complete `pendingChapter` before plan/novel/dialogue; attach validated package ID/version without replacing an already executed package. On refresh/continue, load pending or runtime projection first and reconstruct result data from save rather than `simResult` memory.

- [ ] **Step 3: Wire the runtime into summary without enabling legacy rewards.** If a chapter has an executable package, render `SceneRuntimePlayer`; otherwise adapt its dialogue as retrospective read-only. Keep old DialogueScene choices display-only. Persist after every stable block position, and block next chapter until live package is completed.

- [ ] **Step 4: Make novel and galgame share one runtime path.** Novel mode changes only the container/layout; both modes call the same controlled selection callback, `commitSceneChoice`, pending update, branch rules, and feedback. Switching mode cannot re-submit a committed slot.

- [ ] **Step 5: Add four-axis relationship presentation and context compiler.** `buildLifePresentation` returns type, target ID/name, four scores, derived level, next threshold, and actual action delta; `compileSceneActionContext` returns a bounded public array with applied-effect markers and no private fields. Commit `feat: expose relationship feedback and scene action context`.

## Task 9: Neutral three-chapter fixture route and end-to-end offline proof

**Files:**
- Modify: `lib/game/neutral-scene-package.ts`
- Create: `app/api/life/demo/route.ts`
- Modify: `components/life/LifeApp.tsx`
- Test: `test/v3-neutral-fixture.test.mjs`
- Create: `docs/phase-reports/18-v3-scene-runtime-report.md`

- [ ] **Step 1: Write fixture RED tests.** Enumerate all scene targets and assert two complete paths through three packages, at least ten scenes per path, one merged branch, two ending IDs, a locked choice with a public fallback, one multi-character scene, and no formal赵冷 names/dialogue/ending text.

- [ ] **Step 2: Implement isolated demo creation.** The demo route returns a freshly constructed synthetic save/package bundle with a dedicated save key and explicit `synthetic: true` marker; it never reads or overwrites the player save and never fabricates evidence IDs. The route performs package validation before returning.

- [ ] **Step 3: Add optional demo entry and status rendering.** `LifeApp` exposes the neutral fixture only as a test/demo path, shows `synthetic` in public status, and keeps normal `/life` behavior and existing saves unchanged. `render_game_to_text` reports branch/package/version/scene/block/status/available choices/recent public actions without private state.

- [ ] **Step 4: Execute the fixture end-to-end.** Walk both paths through `applySceneChoice`, serialize/parse after every action, create a branch at the second choice, switch back, and assert exactly one event per committed action. Record counts, bytes, and recovery positions in the phase report. Commit `test: verify neutral scene graph and branching fixture`.

## Task 10: A/C handoff documentation and complete verification

**Files:**
- Modify: `docs/02_Galgame玩法系统_完整开发方案_2026-09-05.md`
- Modify: `docs/02_Galgame玩法系统_执行计划_2026-09-05.md`
- Modify: `docs/phase-reports/18-v3-scene-runtime-report.md`
- Modify: `README.md`
- Modify: `scripts/test-all.mjs`

- [ ] **Step 1: Document A contract.** Include the exact `resolveCharacterVisual` input/output, cue semantics, fallback order, missing-resource behavior, and the fact that B does not own image assets.

- [ ] **Step 2: Document C contract.** Include validated `ScenePackage` input, stable action/trigger IDs, `compileSceneActionContext` shape and three-item bound, private-field exclusion, cache-key requirement, formal content handoff list, and the fact that B does not edit C Prompt/NPC/Director code.

- [ ] **Step 3: Run the required verification serially.** Execute and retain exit codes/output summaries for:

```powershell
npm run lint
node scripts/test-all.mjs
npm run build
```

The `lint` command must be rerun after the build-generated `.next` tree exists; a remaining `.next/types/validator.ts` error is reported as an environment/baseline issue, not hidden. `test-all` must use fresh `.tmp/test-all` output and include every V3 suite. The build’s existing `lib/narrative/query-adapter.ts` tracing warning is recorded separately.

- [ ] **Step 4: Validate real SSE boundaries.** From a real running instance, call `/api/event` and verify HTTP 200 plus final `complete`, exactly 18 experiences and 3 options; any SSE `error` fails this check. Also run `/life` chapter choices/simulate and, when a real package is available, one immediate scene choice. Do not claim database or real-model acceptance from fixtures.

- [ ] **Step 5: Write the final report.** Separate offline fixture, API route, browser, real model, and database evidence; list formal赵冷 content, A assets, C action-context consumer, and any real-browser/DB limitations as outstanding dependencies; give rollback behavior for old saves and unknown runtime versions.

- [ ] **Step 6: Request review and finish without publishing.** Inspect `git diff --check`, `git status --short`, and the exact staged file list. Do not stage `.env`, `.zcode/`, unrelated user documents, or generated build output. Use the finishing workflow only after fresh verification; do not push, merge, create an Issue, or publish.
