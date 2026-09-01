# Protagonist Creation HTML Implementation Plan

> **For agentic workers:** Execute these steps in order. This is an isolated visual prototype; do not modify `/life`, APIs, databases, or the approved scene lab.

**Goal:** Build an interactive standalone HTML prototype for the approved Galgame protagonist-creation page.

**Architecture:** A single self-contained HTML page owns markup, styling, demo state, local draft persistence, validation, responsive switching, and panel collapse behavior. Existing character PNGs are reused as visual placeholders; the page does not call production APIs.

**Tech Stack:** Semantic HTML, CSS, vanilla JavaScript, Node test runner.

---

### Task 1: Lock the prototype contract with a failing test

**Files:**
- Create: `test/protagonist-creation-lab.test.mjs`

- [ ] Assert that the new HTML exists and contains the four-edge shell, five progress sections, every `ProtagonistDraft` field, avatar radio controls, a 250-point talent allocator, local-draft key, panel toggles, responsive device controls, validation summary, and the `生成三位核心关系` action.
- [ ] Run `node --test test/protagonist-creation-lab.test.mjs` and verify it fails because the HTML does not exist.

### Task 2: Build the standalone protagonist-creation lab

**Files:**
- Create: `docs/ui-prototypes/protagonist-creation-lab/index.html`

- [ ] Implement the approved warm-ivory four-edge layout with a collapsible progress rail, dossier form, live portrait preview, and bottom action bar.
- [ ] Implement form interactions: section progress, chip selection limits, birth-year-derived start year, avatar selection, talent presets and plus/minus controls, validation, local draft save/clear, desktop/mobile preview, and non-destructive simulated submission.
- [ ] Use only local assets from `../galgame-style-lab/assets/`; do not modify or duplicate the frozen scene lab.
- [ ] Run `node --test test/protagonist-creation-lab.test.mjs` and verify it passes.

### Task 3: Add reproducible page-generation records

**Files:**
- Create: `specs/restart-life-galgame-style-lab/prompts/pages/protagonist-creation.md`
- Modify: `specs/restart-life-galgame-style-lab/asset-manifest.yaml`

- [ ] Record the page purpose, inherited style constraints, layout, states, HTML construction prompt, negative constraints, and exploratory approval state.
- [ ] Register the HTML prototype in the asset manifest as `approved: false`.

### Task 4: Verify behavior and repository health

- [ ] Run `node --test test/protagonist-creation-lab.test.mjs test/ui-style-lab.test.mjs`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Open the standalone HTML, exercise desktop/mobile switching, collapse both side panels, modify fields and talents, save/clear a draft, and submit an incomplete and complete form.
- [ ] Confirm no existing scene-lab files changed.

