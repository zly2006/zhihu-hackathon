import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const lab = join(root, "docs", "ui-prototypes", "protagonist-creation-lab");
const htmlPath = join(lab, "index.html");

test("protagonist creation lab exposes the approved four-edge dossier", () => {
  assert.equal(existsSync(htmlPath), true, "protagonist creation index.html should exist");
  const html = readFileSync(htmlPath, "utf8");

  for (const required of [
    'data-device="desktop"',
    'data-device="mobile"',
    "creation-shell",
    "top-command-bar",
    "progress-panel",
    "dossier-form",
    "preview-panel",
    "creation-action-bar",
    'data-panel-toggle="progress"',
    'data-panel-toggle="preview"',
    "序章 · 建立人生档案",
    "18 岁是起点，不是判决",
    "基本身份",
    "出身起点",
    "人格内核",
    "初始天赋",
    "最终确认",
    "生成三位核心关系",
    "restart-life-protagonist-draft-v1",
    "prefers-reduced-motion",
  ]) {
    assert.match(html, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("protagonist creation lab covers the complete draft and visual identity", () => {
  assert.equal(existsSync(htmlPath), true, "protagonist creation index.html should exist");
  const html = readFileSync(htmlPath, "utf8");

  for (const field of [
    "name",
    "birthYear",
    "gender",
    "hometown",
    "familyBackground",
    "initialCity",
    "initialDirection",
    "personalityTraits",
    "values",
    "longTermGoal",
    "initialDilemma",
  ]) {
    assert.match(html, new RegExp(`(?:name|data-field)=["']${field}["']`));
  }

  for (const talent of ["insight", "affinity", "grit", "learning", "luck"]) {
    assert.match(html, new RegExp(`data-talent=["']${talent}["']`));
  }

  assert.match(html, /role="radiogroup"[\s\S]*?data-avatar=/);
  assert.match(html, /总预算[\s\S]*?250/);
  assert.match(html, /data-action="save-draft"/);
  assert.match(html, /data-action="clear-draft"/);
  assert.match(html, /data-action="submit-profile"/);
  assert.match(html, /aria-live="polite"/);
});

test("protagonist creation lab uses only local visual assets", () => {
  assert.equal(existsSync(htmlPath), true, "protagonist creation index.html should exist");
  const html = readFileSync(htmlPath, "utf8");

  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /data:image/);
  assert.match(html, /\.\.\/galgame-style-lab\/assets\/urban-zhou-avatar-v1\.png/);
  assert.match(html, /\.\.\/galgame-style-lab\/assets\/urban-wanghao-avatar-v1\.png/);
  assert.match(html, /\.\.\/galgame-style-lab\/assets\/urban-linyu\.png/);
});
