# Handoff — difficulty selection (Easy / Normal / Hard)

Branch `hermes/skyhold-difficulty` (base `art-2d` 301da3d). Not pushed, not merged, nothing deployed.
Design, numbers and the sim table: **docs/difficulty.md**. Shots: **docs/difficulty-shots/**.

## What it is

A difficulty layer **on top of each island's tuning** — a `RunModifiers` patch applied by `SimWorld`
like a challenge. Normal = no patch (the island as tuned), so it keeps working whatever numbers the
island rebalance (Codex, other branch) lands.

| | Easy | Normal | Hard |
|---|---|---|---|
| Patch | foes HP ×0.75, speed ×0.92, gold ×1.25, +5 lives | — | foes HP ×1.10, gold ×0.90, hero respawn ×1.25 |
| Reward | win unlocks, **max 1★**, no challenges / badges | 1–3★ | 1–3★ + **Hard ribbon** |

Hard is gentler than the brief's suggestion (HP ×1.3, speed ×1.06, gold −15 %, 10 lives): the sim
showed the greedy scripts have no margin on Normal, so that patch lost every island for every kit.
Reasoning + sweeps in docs/difficulty.md.

## Files

- `src/data/difficulty.ts` (new): ids, patches, `withDifficulty`, `starsAwarded`, per-island
  record helpers (`difficultyWinsOf` legacy → Normal, sanitise, merge).
- `src/data/runModifiers.ts`: new `heroRespawnMul` (neutral 1; combine multiplies; `isNeutralRun`).
  `src/sim/heroSystem.ts` (`HeroInitConfig.respawnMul` scales `respawnSec`), `src/sim/world.ts`
  (passes it), `src/sim/replay.ts` (sanitises it; old replays → 1).
- `src/game/runConfig.ts`: optional `RunConfig.difficulty` (absent = Normal; set only for Easy/Hard).
- `src/core/types.ts`: optional `ProgressData.difficultyWins { easy, normal, hard }` (best stars
  awarded per island). `src/platform/storage.ts` (migrate/sanitise), `src/platform/saveCode.ts`
  (code field `dw`, best-of-both merge).
- `src/render2d/ui/modes2d.ts`: `?diff=easy|normal|hard` validated (warns; Daily / Endless forced
  Normal; Easy drops challenges); `composeRunModifiers2D(ws, ch, diff)`; `buildRunHref2D({ difficulty })`.
- `src/render2d/ui/progress2d.ts`: `applyRunResult2D` caps Easy stars, skips Easy badges and the
  lives record, writes `difficultyWins`, returns `result.difficulty`; `remapProgress` re-indexes the
  record by island id; `IslandState.diffStars / hardWon`.
- UI: `ui/difficulty2d.ts` + `.css` (new: remembered choice `skyhold_isles_difficulty2d_v1`, rule
  line generated from the patch, wax-seal emblems, HUD badge), `ui/difficultyEmblems.ts` (SVGs),
  `ui/briefing.ts` (selector, Hard ribbon on the medal), `ui/worldMap.ts` (ribbon on nodes,
  remembered choice → run URL, `?screen=brief&diff=` QA), `ui/metaScreens.ts` (Logbook ribbon
  column + "· 3 on Hard"), `ui/modeBits.ts` (end notes), `ui/inGame.ts` (Next Isle keeps the
  choice), `endPanel.ts` (tag under the ribbon), `game2d.ts` (`hooks.difficulty`, Easy board shows
  the awarded star, no star-rule line on Easy), `main2d.ts` (wiring, badge, QA hooks
  `__p0.diffBadge()` / `__p0.endDiff()`), `hudCheck.ts` (the badge is a HUD piece in the banner slot).
- i18n: `diff.*` keys EN + TR.
- `scripts/difficultySim.ts` (new, `npm run sim:difficulty`, informational — NOT in the gate);
  `scripts/heroBalance.ts`: `runHeroIslandSim` got an optional trailing `modifiers` argument
  (additive; default neutral) so the pass can field the default hero.
- Tests: `tests/render/difficulty2d.test.ts` (20).
- QA: `qa/diffshots.mjs` (48 shots + flow checks), `qa/diffprobe.mjs` (phone briefing height budget).

Not touched (Codex owns them): `src/data/levels2d/*`, `scripts/balanceSim.ts` (only imported),
`src/data/heroes.ts`, `abilities.ts`, `workshop.ts`.

## Decisions (assumptions — revisit if the owner disagrees)

- **Daily and Endless always Normal** (comparable records; the Daily is a shared fixed challenge).
- **Easy has no challenges** (otherwise Easy would farm bonus-star badges) and keeps the island's
  best-lives record untouched (its +5 lives would inflate it).
- Hard keeps the 20 lives: a life cap was the harshest lever in the sim.
- The HUD badge shows on all three difficulties (also "Normal"), not on Endless / bench / debug scenes.
- Emblems (sprout / sword / skull) and the Hard ribbon are SVG + CSS wax seals in the kit's palette —
  painted art could replace `difficultyEmblems.ts` / `.pu-hard-ribbon` later (art need, optional).

## Verification

- Gate (`python3 qa/gate.py`): GATE OK — tsc 0 errors, lint clean, tests 1336 passed / 11 skipped
  (100 files + 1 skipped; base had 1316 incl. one load-flaky `mapFrame` timeout that did not recur),
  sim:balance PASSED 41 levels (untouched by this branch: Normal adds no patch), build OK.
- `npm run sim:difficulty`: Easy bare greedy 25/25 (24 flawless); Hard Bran-10 18/25 (15 bleeding),
  veteran 22/25 (16 bleeding); bare greedy on Hard 5/25.
- `python3 qa/withPreview.py --port=4417 node qa/diffshots.mjs` → problems 0: selector flow (default
  Normal, Easy clears a challenge, a challenge moves Easy → Normal, Endless dims to Normal, arrow
  keys, Play URL `&challenge=bowless&diff=hard`, remembered on the next card), legacy save shows
  Normal results and no ribbons, HUD badge inside the banner slot with hudCheck overlaps 0 at 1920
  and phone, end tag + notes (Easy board 1★ + "Easy win: 1★…", first Hard win "Hard ribbon earned!"),
  3 ribbons on the map, no overflow / off-screen elements, no console errors, EN + TR.

## Open points

- **Retune after the island rebalance lands**: Hard's numbers depend on the islands' margin. Run
  `npm run sim:difficulty` (and `-- --sweep=hard --kit=bran10`) on the merged levels and adjust
  `DIFFICULTIES` — UI text follows the patch automatically.
- **Phone briefing height (pre-existing)**: since the hero chip, the briefing body already scrolls
  on landscape phones (at 844×390 Play was clipped by ~9 px before this branch; at 740×360 /
  667×375 with challenge modes it is 77–117 px below the fold). The selector does not make Play any
  lower (short screens put it beside Play and tighten the card's padding — at 844×390 / 932×430 the
  whole card now fits), but on the smallest phones with modes, and on a few TR cards with a wrapped
  star-goal line, the selector's rule line still needs a short scroll. A compact phone briefing
  (e.g. smaller hero chip) would fix it for all cards.
- Merge note: `scripts/heroBalance.ts` gained one optional parameter; `RunModifiers` gained a field
  (anything constructing a full `RunModifiers` literal by hand must add `heroRespawnMul: 1` —
  everything in-tree goes through `combineRunModifiers`).
