import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const lab = join(root, "docs", "ui-prototypes", "galgame-style-lab");
const htmlPath = join(lab, "index.html");

test("style lab exposes the selected urban Galgame shell", () => {
  assert.equal(existsSync(htmlPath), true, "index.html should exist");
  const html = readFileSync(htmlPath, "utf8");

  for (const required of [
    'data-theme="urban"',
    'data-panel-theme="light"',
    'data-chrome-theme="light"',
    'data-device="desktop"',
    'data-device="mobile"',
    'role="tablist"',
    "prefers-reduced-motion",
    "top-command-bar",
    "timeline-panel",
    "status-panel",
    "bottom-dock",
    'data-panel-toggle="timeline"',
    'data-panel-toggle="status"',
    'data-action="immersive"',
    'aria-expanded="true"',
    "Chapter 04",
    "选择的代价",
    "你真的想清楚了吗？",
    "决定下一座城市",
  ]) {
    assert.match(html, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(
    html,
    /<div class="dialogue-box">[\s\S]*?<div class="choice-list"/,
    "dialogue choices should be attached inside the dialogue box",
  );
  assert.match(
    html,
    /<div class="dialogue-box">[\s\S]*?<button class="dialogue-continue" data-action="continue-story"/,
    "continue story should be the primary action in the lower-right of the dialogue box",
  );
  assert.doesNotMatch(
    html,
    /<nav class="bottom-dock"[\s\S]*?继续剧情/,
    "bottom dock should only contain secondary navigation",
  );
  assert.doesNotMatch(html, /class="identity-avatar">你</);
  assert.doesNotMatch(html, /class="relation-avatar">[林王]</);
  assert.match(html, /\[data-chrome-theme="light"\] \.top-command-bar/);
  assert.match(html, /\[data-chrome-theme="light"\] \.bottom-dock/);
});

test("style lab references the selected character asset", () => {
  assert.equal(existsSync(htmlPath), true, "index.html should exist");
  const html = readFileSync(htmlPath, "utf8");
  const assets = [
    "urban-linyu.png",
    "urban-zhou-avatar-v1.png",
    "urban-wanghao-avatar-v1.png",
  ];

  for (const asset of assets) {
    assert.match(html, new RegExp(`assets/${asset.replace(".", "\\.")}`));
    assert.equal(existsSync(join(lab, "assets", asset)), true, `${asset} should exist`);
  }
});
