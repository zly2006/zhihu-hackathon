import assert from "node:assert/strict";
import test from "node:test";

const buildDir = process.env.SHELL_PANEL_TEST_DIR || ".tmp/test-all";
async function load() {
  return import(new URL(`../${buildDir}/game/shell-panel-state.js`, import.meta.url).href);
}

const panels = ["top", "bottom", "left", "right"];

function stateFor(mask) {
  return Object.fromEntries(panels.map((panel, index) => [panel, Boolean(mask & (1 << index))]));
}

test("all sixteen panel combinations keep each panel independently toggleable", async () => {
  const shell = await load();
  for (let mask = 0; mask < 16; mask += 1) {
    const state = stateFor(mask);
    for (const panel of panels) {
      const next = shell.toggleShellPanel(state, panel);
      assert.equal(next[panel], !state[panel], `mask ${mask} must toggle ${panel}`);
      for (const other of panels.filter((item) => item !== panel)) {
        assert.equal(next[other], state[other], `mask ${mask} must retain ${other}`);
      }
    }
  }
});
test("global panel action collapses any open combination and expands an all-collapsed shell", async () => {
  const shell = await load();
  assert.deepEqual(shell.toggleAllShellPanels({ top: false, bottom: false, left: false, right: false }), {
    top: true,
    bottom: true,
    left: true,
    right: true,
  });
  assert.deepEqual(shell.toggleAllShellPanels({ top: true, bottom: false, left: false, right: false }), {
    top: false,
    bottom: false,
    left: false,
    right: false,
  });
  assert.equal(shell.shellGlobalActionLabel({ top: false, bottom: false, left: false, right: false }), "全部展开");
  assert.equal(shell.shellGlobalActionLabel({ top: true, bottom: false, left: false, right: false }), "全部收起");
});
