# PROGRESS — skyhold-n2-opus (Opus overnight UI/UX, branch hermes/skyhold-n2-opus, base art-2d)

(A pointer copy lives at docs/overnight/PROGRESS-skyhold-n2-opus.md — this file is the real one.)

## Backlog status
1. Skill tree fits / scrolls obviously — DONE (round 1)
2. Title screen + loading — NEXT
3. Credits screen + pause menu consistency — todo
4. Keyboard / gamepad navigation — todo
5. Accessibility (colour-blind cues, UI scale, text size) — todo
6. Juice + feel pass — todo
7. uiaudit + hudCheck after each change; shots into docs/overnight2/opus-shots/ — ongoing

## Done
- **Skill tree fit** (round 1). Was cut by 133 px at 2000x991, 183 px on 844x390.
  `heroScreens.ts` `fitTree` / `pickTreeFit` / `TREE_FIT_STEPS`: tries the vertical tree at node
  zoom `--tz` 1 → 0.83, then an **across** layout (one row per branch, tiers left→right, capstone at
  the right end on a bracket, JS places the bracket at the medal centres) at 1.15 → 0.74. Scale-
  corrected measurements (the board pops in with a scale animation). Refits on window resize.
  Node text keeps ≥ 90 % size (`--nt`). Branch head = icon beside the name, blurb reserved 2 lines
  (the three columns' tier 1 line up). Picked-node outline no longer touches the name.
  Result (`qa/treeprobe.mjs`, 9 sizes × EN/TR, bran + mira): everything fits, no scroll — desktop
  16:9 uses `down` at 0.88–1, 1024x768 `down` 1, phones `across` 0.93–1.15.
  uiaudit heroes + heroes-node (6 sizes × 2 langs): 0 problems. Shots: docs/overnight2/opus-shots/tree-*.
  Tests: tests/render/n2Ui.test.ts.

## Decisions
- Round 1: PROGRESS file lives in docs/overnight2/ (backlog says so); the runner header names
  docs/overnight/ — a pointer file there points here.

## Problems / notes
- Env: `npm ci` needed in a fresh worktree. Gate: `python3 qa/gate.py`. QA via
  `python3 qa/withPreview.py --port=N node qa/x.mjs` (pick a free port, e.g. 4391+).

## Requests for other agents
(none yet)
