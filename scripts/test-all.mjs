// 全量测试运行器（Phase 7 交付物）
// 1. 用 tsc 编译全部 lib 代码到 .tmp/test-all
// 2. 依次运行全部冒烟/回归测试套件
// 用法：node scripts/test-all.mjs

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, ".tmp", "test-all");

function listTs(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.relative(root, path.join(dir, f)));
}

const sources = [
  ...listTs(path.join(root, "lib", "domain")),
  "lib/types.ts",
  "lib/llm.ts",
  "lib/database.ts",
  "lib/era.ts",
  ...listTs(path.join(root, "lib", "game")),
  ...listTs(path.join(root, "lib", "narrative")),
];

console.log("==> 编译 lib 代码 ...");
execSync(
  `npx tsc --outDir "${buildDir}" --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck ${sources.join(" ")}`,
  { cwd: root, stdio: "inherit", shell: true },
);

const suites = [
  { file: "test/phase0-reducer.smoke.mjs", env: "PHASE0_TEST_DIR" },
  { file: "test/phase1-factory.smoke.mjs", env: "PHASE1_TEST_DIR" },
  { file: "test/phase3-evidence.smoke.mjs", env: "PHASE3_TEST_DIR" },
  { file: "test/phase4-simulator.smoke.mjs", env: "PHASE4_TEST_DIR" },
  { file: "test/phase5-novel.smoke.mjs", env: "PHASE5_TEST_DIR" },
  { file: "test/phase7-stability.smoke.mjs", env: "PHASE7_TEST_DIR" },
  { file: "test/reflection-engine.test.mjs", env: "REFLECTION_TEST_DIR" },
  { file: "test/v21-interactive-life.test.mjs", env: "V21_TEST_DIR" },
  { file: "test/v22-galgame-ui.test.mjs", env: "V22_TEST_DIR" },
  { file: "test/v23-snapshot-replay.test.mjs", env: "V23_TEST_DIR" },
  { file: "test/v24-performance.test.mjs", env: "V24_TEST_DIR" },
  { file: "test/v25-narrative-kb.test.mjs", env: "V25_TEST_DIR" },
  { file: "test/v31-v32-agents.test.mjs", env: "V31_V32_TEST_DIR" },
  { file: "test/v3-scene-contract.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-scene-runtime.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-scene-choice.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-scene-save.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-relationship.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-neutral-fixture.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-scene-trigger.test.mjs", env: "V3_TEST_DIR" },
  { file: "test/v3-scene-recovery.test.mjs", env: "V3_TEST_DIR" },
];

let failed = 0;
for (const suite of suites) {
  console.log(`\n===== ${suite.file} =====`);
  try {
    execSync(`node "${path.join(root, suite.file)}"`, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, [suite.env]: path.relative(root, buildDir) },
    });
  } catch {
    failed += 1;
  }
}

if (failed) {
  console.error(`\n${failed} 个测试套件失败`);
  process.exit(1);
}
console.log("\nALL TEST SUITES PASS");
