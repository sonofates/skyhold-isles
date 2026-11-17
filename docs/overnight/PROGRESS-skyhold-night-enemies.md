# PROGRESS — ENEMIES night agent (branch `hermes/skyhold-night-enemies`)

Started 2026-11-16 23:00 UTC (02:00 TR). Deadline 06:00 UTC (09:00 TR).

## TL;DR for the lead (morning)
- **What's in:** 7 new enemy archetypes (warden, burrower, carrier, blinker, golem, mite, hexer) + Empowered elites + a 2nd boss (Tempest Colossus); 4 new islands L10–L13 (multi-lane Confluence Terraces, sky-lane Galewatch Spires, hexer switchbacks Lanternfall Hollow, spiral finale Stormcrown Citadel); endless spotlight rotation; FX, enemy sound cues, badges, counter-hint toasts; progress-unlock fix so L9 finishers get L10.
- **Branch state:** all green (`tsc`, lint, 147 tests, build, `sim:balance` 13/13 islands).
- **UI follow-ups** (not done, UI branch's area): see "UI needs" — Legendary difficulty label, elite flag + `carrier` in the HUD wave preview/flyer warning, counter hints in tooltips, a theme for `lanternfall-hollow`.

### Merge recipe (all checked in scratch merges, repo untouched)
1. **ISLANDS + TOWERS + this branch:** the only textual conflict is `scripts/balanceSim.ts` (ISLANDS × TOWERS, not this branch). Take TOWERS' `evaluateBalance()` refactor and re-home ISLANDS' `robustLines` (return it from `evaluateBalance` or move the `--robust` sweep into `main()`), otherwise `--robust` throws a ReferenceError at the end. Result: tsc clean, 317/317 tests, every island in its window **except L6** (ISLANDS × TOWERS; sweep in the Round 9 log).
2. **+ agy-meta:** one conflict, `src/sim/world.ts` `waveSystem.update` spawn callback — keep agy-meta's `spawnConfiguredEnemy` and thread `elite`/`lane` through it and the extra-flyer queue (exact code in Round 10). `storage.ts` now merges cleanly.
3. **+ agy-qa:** apply `docs/overnight/agy-qa-fuzzPlay-new-enemies.patch` to its `scripts/fuzzPlay.ts` (teaches the fuzz invariants about cracked golem armor, lanes, burrowing, dropped raiders, elites, tempest-as-boss). The remaining agy test failures pin 9 islands / one spawn / "offset 9 = 2 Dreadnoughts" — table with suggested fixes in Round 10. None is a bug in the new content (agy-qa's own fuzzer, patched, ran 312 campaign + 104 endless runs clean).
4. **Then always** `npm run sim:balance` (L10 is 5 lives here / 7 merged, window 5–10) and `npm test`.
5. Optional, semantic: agy-meta's `boss_slayer_10` only counts `boss` kills, not `tempest`.

## Status / task list
- [x] 1. New enemy archetypes (sim + data + mesh + badge + tests) — warden, burrower, carrier, blinker, golem, mite + elite flag (`tests/sim/newEnemies.test.ts`)
  - [x] (round 2) 7th archetype **Gloam Hexer** (`hexer`, `tests/sim/hexer.test.ts`) + endless spotlight pairs `[hexer, mite]`, `[golem, hexer]`
- [x] 2. Endless-mode variety — `ENDLESS_SPOTLIGHTS` rotation in `waveSystem.ts`, elites from 4th endless wave. Probe: `npx tsx scripts/endlessProbe.ts --level=9` (full L9 build: endless lasts to wave 25 vs 26 before — slightly harder, accepted).
- [x] Sim extension: extra ground spawn lanes (`LevelDef.extraGroundPaths`, `WaveGroupDef.lane`) + render support (`tests/sim/lanes.test.ts`, incl. layout validation for every island)
- [x] 4. New boss `tempest` (Tempest Colossus) — sim/mesh/FX/tests (built before L12 so the island can use it)
- [x] 3. New islands
  - [x] L10 **Confluence Terraces** (`level10.ts`): two spawn lanes (west causeway = lane 0, northern switchback = lane 1) merge at a crossroads; introduces mites (w2), wardens (w3), burrowers (w4); Dreadnought at w10 and w20 with elite wardens/brutes. enemyHpScale 1.01 (late clearBonus trimmed, heavier w19/w20 elites after the targeting fix) → greedy W 5 lives here / 9 in the 3-branch dry-run merge (merged plateau 1.005–1.03, here 0.96–1.015); weak loses ~w8.
  - [x] L11 **Galewatch Spires** (`level11.ts`, helper agent): road loops a central plateau and a void "gale chasm"; the sky lane is 87% of the road length and slaloms over buildable land. Haulers w3, blinkers w4, golems w6, elites from w16, Dreadnought w10 and w20 (bosses arrive last so haulers don't slip by under boss focus). Greedy W 7 lives 1★ here (passes 1.19–1.24 except a 13-life spike at 1.205) / 8 lives merged (passes 1.20–1.22), weak loses w16–17. Leaks are mostly haulers + their dropped raiders (by design: ground defence isn't the limiter here).
  - [x] (round 2) L12 **Lanternfall Hollow** (`level12.ts`): Gloam Hexer showcase. 17x13 switchback: the road doubles back four times, so the 1-tile hedgerows between switchbacks (rows 2, 8, 10) see two road stretches but are inside hex reach; the middle band (row 5, cols 4-15) and the south-west pocket (2,9..11) are 2 tiles off the road → out of every hex. Hexers from w3, Dreadnought + hex choir w10, elites w16+, w20 = 1 Dreadnought + elite brutes/hexers + mites. enemyHpScale 1.44 (plateau 1.42–1.46 here, 1.41/1.43–1.47 merged, spike at 1.42 merged) → greedy W 8 lives on this branch AND in the 3-branch dry-run merge; weak (hugs the road) loses ~w12. Hex probe (`.wt/hexprobe.ts 12`): weak gets 13 of 16 towers hexed, greedy 7 of 23 — the counterplay is real.
  - [x] L13 **Stormcrown Citadel** (`level13.ts`, was level12.ts until round 2 — moved so the finale stays last; id unchanged, `index: 12`, helper agent): 18x14 spiral fortress; main road coils inward through 3 rings to a central storm altar, northern war-road (lane 1) joins the inner ring at (13,7); every new archetype, lane-1 pressure in 16/22 waves, 6 elite groups (w18–22), Dreadnought w11, Tempest Colossus walks the whole spiral in w22 (Stormwall on the outer ring, enrages ~inner court; greedy kills it with 2–9% HP to spare). enemyHpScale 1.65 → greedy W 7 here / 9 merged; weak loses ~w15.
- [x] 5. Polish: hit/death FX, readability, more tests
  - [x] FX for every new mechanic (`enemyFx.ts`), blinker flicker + burrower mound bulge telegraphs, elite ring, shield bubble, blue glint when a barrier soaks a hit (`shieldAbsorb`)
  - [x] mesh polish after a rasterised preview (rounder burrower, striped balloon)
  - [x] tests: geometry sanity, EnemyRenderer update path (stub materials), FX bindings, determinism replay, seeded fuzz/stress over all archetypes (`enemyStress.test.ts`)
  - [x] wave preview `eliteCount`, endless Tempest every 10th wave, endless groups spread over lanes
  - [x] first-encounter counterplay toasts

## Round 2 (this session, 2026-11-17 ~00:00–) log
- Re-ran the merge dry-run with the other branches' latest heads: same single balanceSim conflict, same L6 failure (ISLANDS×TOWERS), L10–L13 pass. `.wt/stitch.py .wt/m3` resolves the conflict in the scratch tree.
- Endless probe on L10–L13 (full greedy build, auto-wave stacking): dies 3 waves after the campaign, same as L9 → consistent.
- Second independent review (sub-agent, read-only) → fixed: (1) "Strongest" tie-break compared raw `dist` across lanes → now `dist + laneProgressOffset` (bit-identical on single-lane islands); (2) a downed hauler dropped no raiders when the enemy pool was full (it spawned them before freeing its own slot) → slot freed first, wreck copied to a scratch object; (3) "New foe" toasts were gated on SIM time (6 s) while the toast lives 7 REAL seconds → at 2x/3x a second hint wiped the first; now gated on wall-clock time (`getRealClock` handler, defaults to `performance.now()`), and the old flyer hint waits too. Tests: `tests/sim/lanes.test.ts` (strongest), `tests/sim/newEnemies.test.ts` (full pool), `tests/platform/sessionBridge.test.ts` (toasts).
- Not fixed (TOWERS area, harmless today): `projectileSystem.ts` flags `isBossHit` only for `type === 'boss'`, not the Tempest Colossus; nothing reads it yet.

## Next (if another round runs) — all backlog items are done; only low-risk work left
- Re-run the merge dry-run if the other branches move (`trymerge.py` + `stitch.py`, then `robust.py 10,11,12,13`).
- Don't re-tune L10–L13 blind: the balance is chaotic (see Round 9 log). Only touch if a merged run fails a window.
- Possible extras: more edge-case tests; nothing structural pending.

## Round 9 (2026-11-17 02:36 UTC) log
- Rounds 3–8 left no commits (sessions apparently cut short). Found one uncommitted tweak in `level10.ts` (w15 elite brutes 7@1.0 s → 6@1.2 s). Swept both versions over enemyHpScale 0.98–1.04: identical greedy lives at every value (5 lives on 1.00–1.025, fails at 1.03) → no gain, discarded; L10 stays as committed.
- Merge dry-run re-run with the latest local heads (islands `54b721d`, towers `f5f71fc`): same single balanceSim conflict (stitch script resolves it), tsc clean, **291/291 tests**, balance: everything passes except the known **L6**; new islands merged L10 7 / L11 8 / L12 8 / L13 9 greedy lives.
- **L6 (merged) diagnosis for the lead** — scratch sweep of `level6.ts` enemyHpScale in the merged tree: 1.14→20L/weak W6, 1.16→19/weak W4, 1.17→11/weak W1, 1.18→12/weak W3, **1.19→10 PASS (weak loses)**, 1.20 (current)→6/weak W3, 1.21→5, 1.22→3, 1.24→7/weak L. Only 1.19 passes and the weak script survives at most values, so an HP-scale nudge alone is a knife-edge fix; L6 needs a wave-side change (ISLANDS) or a T3 retune (TOWERS `scripts/tuneSweep.ts`). Leaks are runners + healers.
- Tried to move L10 off the window edge on this branch (5 lives; all of it lost in w19–20, mostly flyers): w20 flyers 16 → 13 made it *harder* (branch loses at ≥1.01, merged swings 12→2→lost over 1.00–1.03) — the final wave is chaotic, so reverted (`.wt/tryl10.py` tries a line change in both trees at once). Kept the committed values, which pass on both.
- Merged-tree `--robust` table for the new islands (greedy lives at enemy HP ×0.97/0.985/1.0/1.015/1.03, window 5–10): L10 11!/10/7/8/LOST!, L11 12!/6/8/10/LOST!, L12 14!/8/8/8/7, L13 13!/16!/9/6/3!. Same kind of spread as ISLANDS' table for L1–L9 (e.g. L6 18!/18!/13/10/6!); L12 is the most robust, L13 the narrowest.
- Camera auto-fit per island (`npx tsx .wt/camfit.ts`, uses the real `CameraController.configureForMap`): portrait phone 390×844 — L5 and L7–L13 all sit on the 0.34 mobile zoom floor (pre-existing for L5/L7–L9; player pans). Landscape/desktop — L10/L11 0.937, L12 0.867 (= L9), **L13 0.730** (smallest of all; L4/L7 are 0.836): the spiral fills the 18×14 grid corner to corner with tall spawn tiles in two corners. Units read ~13% smaller there than on L7. Left as is (layout change would need a rebalance + ISLANDS decor re-check); flag for the in-browser check.
- Progress migration fix (see Cross-area changes): finishing the old 9-island campaign now unlocks L10.
- Enemy sound cues (was an open "UI/TOWERS need"): `soundManager.ts` + `tests/audio/enemySounds.test.ts`; merges cleanly with TOWERS (scratch merge: tsc clean, 308/308 tests). Branch gate green (138 tests, 13 islands).

## Round 10 (2026-11-17 ~02:45 UTC) — merge check against the `agy-*` branches
Three more branches appeared since round 9, all forked from the same `cfb9330`: `hermes/skyhold-agy-meta` (meta progression, Daily Watch, mutators, achievements), `-agy-perf` (render perf), `-agy-qa` (fuzz harness + contract tests). Scratch merges (`.wt/m4` = this branch + the three agy; `.wt/m6` = + islands + towers; baseline `.wt/b0` = the three agy on `cfb9330` without this branch).

Done on this branch to make that merge easier:
- `tests/platform/sessionBridge.test.ts` → renamed `tests/platform/newFoeHints.test.ts` (agy-qa adds its own `sessionBridge.test.ts`; was an add/add conflict).
- `storage.ts` progress fix rewritten as "walk forward from the stored unlock across cleared islands" → now merges **cleanly** with agy-meta's `safeCount` change, and agy-meta's corrupted-save sanitize test passes (the old "furthest island with stars" rule unlocked island 4 for a save that said 0).
- Endless spotlight spawn-interval floor 0.16 → 0.18 (agy-qa contract: every endless group ≥ 0.18). New test: worst-case endless pool use incl. hauler raiders / tempest mites stays ≤ 360 on every island (worst today: 340, Sunlit Meadow +99).

Still a textual conflict (unavoidable, both sides rewrote the same callback): **`src/sim/world.ts`, the `waveSystem.update` spawn callback vs agy-meta**. Resolution (tsc-clean in the scratch merge): give agy-meta's helper the two new params and carry them through the extra-flyer queue:
```ts
private spawnConfiguredEnemy(enemyType: EnemyEntity['type'], hpScale: number, elite = false, lane = 0): void {
  const spawned = this.enemySystem.spawnEnemy(enemyType, hpScale, elite, lane);
  ...                                   // rest = agy-meta's version
// pendingExtraFlyers item type gets `elite: boolean; lane: number;`
// the queue drain calls spawnConfiguredEnemy(item.enemyType, item.hpScale, item.elite, item.lane)
// callback: (enemyType, hpScale, elite, lane) => { this.spawnConfiguredEnemy(enemyType, hpScale, elite, lane); ...agy's extra-flyer block, pushing { enemyType, delay, hpScale, elite, lane } }
```
(`.wt/resolve_agy.py <tree>` applies exactly this.)

Tests after that merge (mine + 3 agy): **352 pass / 31 fail; 13 of those 31 already fail with the three agy branches alone** (baseline, unrelated to enemies: debug panel, post-processing, scene manager, CLI smoke…). The 18 that only fail with this branch are all agy tests pinning 9-island / 6-enemy / single-spawn assumptions — none is a bug in the new content (checked each):
| agy test | why it fails with this branch | suggested fix (agy side) |
|---|---|---|
| `scripts/fuzzPlay.ts` invariants (3 fuzzPlay tests) | "def mismatch golem armor=3" (chill cracks golem armor 12→3 by design), "totalDist ≠ path.totalLength" (lane-1 enemies use their own lane path), "stale scaleOverride=0.86" (hauler-dropped raiders are drawn at 0.86, `isDropped`), "burrower moved > speed·dt" (×1.6 underground) | compare armor with `e.baseArmor` / allow `armorBreakTimer > 0`; use `enemySystem.getPath(e.flying, e.lane).totalLength`; accept `isDropped && scaleOverride === 0.86`; max step `speed·dt·(burrowed ? burrowSpeedMul : 1)` (blink teleports reset `prev*`, so they shouldn't trip the step check) |
| `fuzzPlay` (more, found with the harness itself) | burrowed enemies are out of the spatial hash / not hoverable (design: that's how "untargetable" works), elite rewards ×1.6, `enemyHit.isBoss` is true for the Tempest Colossus too, the coverage assert wants every type *killed* but the tempest rarely dies in the small test fuzz | all invariant fixes are in **`docs/overnight/agy-qa-fuzzPlay-new-enemies.patch`** (applies to agy-qa's `scripts/fuzzPlay.ts`; tsc + eslint clean); for the coverage assert drop `tempest` from the *killed* list or give it a scripted kill |
| `contentContracts` spawn tiles | L10/L13 have a 2nd spawn (`extraGroundPaths`) | collect expected spawns from `pathWaypoints[0]` + each `extraGroundPaths[i][0]` |
| `endlessAndPool` "offset 9 → 2 bosses" | every 10th endless wave is now 1 Dreadnought + 1 Tempest Colossus (design) | expect `boss` 1 + `tempest` 1 at offset 9 |
| ~~`renderPipeline` EnemyRenderer (`children[ENEMY_TYPES.length]` = HP bar)~~ | **fixed on this branch** (`90cc5af`): the mound/bubble/elite-ring layers are now added after the HP bar + shadow, so the old child indices hold | — |
| `metaSaveAndStats` totals 27 / 151 / career points, `metaMutatorsAndDaily` "Islands 10+" (`seenExpanded` 2), daily fixtures on 2026-07-13 / 11-17 (banned tower, 'won' within 40 s) | `LEVELS.length` is 13 (3 stars × 13 = 39, Daily picks different islands, L10+ are Master) | derive totals from `LEVELS.length`; append fake islands to `LEVELS.slice(0, 9)` or count `levelIndex >= LEVELS.length`; pin fixtures with an explicit level |
| `metaSaveAndStats` endless "≥ 5 endless waves in 180 s" | endless spotlight groups add units → slower clears | raise the tick budget or use a stronger build |
- **Extra QA with agy-qa's fuzz harness** (scratch merge + that patch): 24 seeds × 13 islands × 5 profiles = 312 campaign runs + 104 endless-only checks (12 endless waves each), every one of the 14 enemy types spawned — **0 invariant violations** besides the design exemptions above (HP/def/lane/pool/event/economy/hash consistency, determinism replays). Peak 234 live enemies in endless (pool 360).
- Re-run after those fixes with the agy heads of ~03:30 UTC (mine + 3 agy + fuzz patch): **362 pass / 27 fail**; the ones not in the agy-only baseline: the table rows above (contentContracts spawns, endless offset-9 boss, meta/daily fixtures, fuzz *killed* coverage) + a new agy daily test (`wins Challenging, Heroic, and Master Daily Watch runs`, pinned dates) that times out because with 13 islands those dates draw different islands (incl. the long L10–L13). The `qaScriptsSmoke` CLI failures are an artifact of running the scratch tree via `vitest --root` (they spawn `scripts/*.ts` from the cwd) — ignore.
- Semantic (no test catches it): agy-meta's `boss_slayer_10` achievement reads `enemiesDefeatedByType.boss` only → Tempest Colossus kills don't count. Suggest `boss + tempest` (or `ENEMY_DEFS[t].isBoss`). Flying-kill stats use the event's `flying` flag, so Cloud Haulers already count as flyers.
- agy-qa's `simBench --strict` on the merged tree picks Lanternfall Hollow (L12) as its bench island: 360 enemies + 40 towers = 0.15 ms/tick (6.7k ticks/s vs 1.5k budget) → PASS.
- With islands + towers also merged (`.wt/m6`): same picture plus the known balanceSim stitch; 39 failures total, nothing new from this branch.
- agy branches are still moving (agy-qa committed again at ~02:55 UTC) → re-check in the morning.

- Islands + towers dry-run re-run after all round-10 commits (islands `c4864a4`, towers `fef1e60`): same single balanceSim stitch, tsc clean, **313/313 tests**, balance unchanged — all pass except the known L6 (6 lives); new islands L10 7 / L11 8 / L12 8 / L13 9.

- Wave names: ISLANDS gave every wave of L1–L9 a flavour `name` (new optional `WaveDef.name`, data only — no UI shows it yet). Added the same field (byte-identical lines, so `types.ts` merges cleanly) and names for all 82 waves of L10–L13 (e.g. L10 "The Confluence", L12 "Witching Hour" / "Lanternfall", L13 "Crown of Storms"); test `tests/sim/waveNamesNewIslands.test.ts` (same rules as ISLANDS' 1–9 test). 3-way dry-run after that: tsc clean, **317/317**.

## Round 10 — readability vs roads
- New test (`tests/render/enemyGeometry.test.ts`): every new archetype's camera-facing surface is >85 % colour-distinct (CIELAB ΔE > 25, area-weighted) from grass and dark foliage. All pass with margin (golem 93 % — its moss tufts are the intended accent).
- Enemies walk on the **road**, not the grass, so I measured that too (`.wt/contrast.ts`; road colours are the Kenney colormap cells the path tiles use: dirt `#e08961` default, ISLANDS' themed `stone` `#797e95` and `sand` `#e7af88`). After the merge, L10/L11/L13 (and L3, L7–L9) get **stone** roads from the ISLANDS themes.
  - Fixed: the **Loam Burrower** (ochre) was only 49 % distinct on the default dirt road → now dark umber with ochre back spines (100 % on dirt, still 100 % on grass); checked in the software rasteriser on dirt and stone roads.
  - Golem (dark basalt) 40 % and Tempest (slate blue) 57 % by the metric on stone roads, but the rasterised lineup shows both read clearly (much darker / bluer + coral cracks / gold core, and both are huge) — the ΔE>25 bar is strict for dark-on-mid-grey. Left as is.
  - Fixed too: the base **Iron Brute** (steel grey) really vanished on stone roads (21 % distinct, grey-on-grey in the rasteriser) → polished-silver plates + crimson pauldrons with cream spikes (74 % on stone; grass/dirt/sand unchanged), which also matches its old description ("bold crimson belt/pauldrons"). Cross-area-ish: it's a base enemy seen on L1–L9 — easy to revert (`45d658e`, 8 colour constants) if the lead prefers the old look.

## Enemy design table

| type key | Name | Role / mechanic | Counterplay | Silhouette / color |
|---|---|---|---|---|
| `warden` | Aegis Warden | Every 4 s tops up a barrier (26 × its HP scale) on allies within 3.4 (not itself / other wardens): absorbs post-armor damage before HP. | Kill the warden first (Strongest/First), splash/chain strips many shields at once; shields don't block slow. | Tall cream/gold priest with a big round tower-shield + glowing halo disc. Shielded allies get a translucent blue bubble. |
| `burrower` | Loam Burrower | Cycles surfaced → burrowed. While burrowed it is out of the spatial hash (untargetable, no splash/chain/meteor), moves faster, then resurfaces. | Long coverage + splash zones where it pops up; frost before it dives (slow still ticks). | Squat ochre/brown mole-beast with big digging claws and a drill-snout; dirt mound when underground. |
| `carrier` | Cloud Hauler | Flyer (flight lane). On death drops 2 Raider paratroopers onto the nearest ground-path point (never past goal-3). | Kill it EARLY on its lane (anti-air up front) — late kills drop raiders near the sanctuary. | Fat balloon-gondola: cream balloon envelope, brown basket, coral flags. Readable as "cargo". |
| `blinker` | Rift Blinker | Charges a rift and teleports ~4.5 world units forward along the path every ~3.4 s (never within 2 of the goal). Chill slows the charge. | Frost (slows the charge as well as movement), high-burst towers; dense coverage after blink points. | Slim violet/teal crystal-imp with floating shard crown; burst FX at both ends of the blink. |
| `golem` | Basalt Golem | Very high armor (12). Every frost/chill hit (slow application, incl. meteor) cracks its armor down to 3 for a few seconds. | Pair Frost with Archer/Tesla volume; meteor; mortars do OK. Without frost, low-damage hits do ~1. | Massive dark basalt block body with glowing coral cracks; cracks turn icy when brittle. |
| `mite` | Scuttle Mite | Tiny, fast, cheap, comes in dense swarms. 1 life each. | Splash (cannon/mortar), Tesla chains. Single-target towers get overwhelmed. | Tiny bright-orange beetle with cream back stripe, low to the ground. |
| (elite) | Empowered variant | Wave-group flag `elite`: ×1.75 HP, +1 armor, ×1.6 reward, gold aura ring. Used in late waves of new islands + endless. | Same as base, focus fire. | Gold tint + aura. |
| `hexer` | Gloam Hexer | Every 5.5 s, if an un-hexed tower stands within 3.6 (≈ adjacent/diagonal to the road), it stops and channels 0.7 s (telegraph: magenta throb + sparks on the target tower), then stuns that tower for 2.4 s (falls back to the nearest other tower if the target was sold/left reach; killing it mid-channel cancels). 120 HP, armor 1, 2 lives. | Kill it before it reaches your towers / during the channel; towers 2 tiles off the road are out of reach; Overcharge clears hexes. | Hunched burgundy robe, drooping pointed hood, shadowed face with magenta eyes, gold rune patches, crooked staff with a hanging magenta lantern. |
| `tempest` (boss) | Tempest Colossus (L12, endless every 10th wave) | 1500 HP, armor 8, 6 lives. ≤66%: stops 1.3 s and raises a Stormwall (self shield 20% maxHP, allies within 5 get 60% of their maxHP). ≤33%: enrages ×1.35 speed, summons 6 mites, jams the 2 nearest towers every 6 s. | Burst it in phase windows, splash the shielded escort, Overcharge to cleanse jams. | Huge slate-blue stone colossus, gold storm core, cloud pauldrons, gold bolt crown. |

## How to verify (all green at every commit on this branch)
`npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance` — 13 islands pass; `LEVELS=10,11,12,13 npm run sim:balance` for just the new ones.
New tests: `tests/sim/newEnemies.test.ts`, `tests/sim/lanes.test.ts`, `tests/sim/enemyStress.test.ts`, `tests/render/enemyGeometry.test.ts`, `tests/render/enemyRenderer.test.ts`, `tests/render/enemyFx.test.ts`.

## Scratch tools (git-ignored `.wt/`, hermes only — for the next round of this agent)
`.wt/gate.py [--no-build]` full green gate · `.wt/sweep.py <root> <levelFile> <N> enemyHpScale v1 v2…` balance robustness sweep · `.wt/trymerge.py <dest> cfb9330 <branches…>` scratch 3-way merge · `.wt/mkpreview.py` + `npx tsx .wt/m3/scripts/previewEnemies.ts .wt/preview 1400 <types>` rasterised enemy lineup (needs a trymerge'd `.wt/m3` with the ISLANDS rasteriser) · `npx tsx .wt/buildmap.ts <N>` layout with build tiles marked.

## Morning merge dry-run (done on this branch, repo untouched)
`python3 .wt/trymerge.py .wt/m3 cfb9330 hermes/skyhold-night-islands hermes/skyhold-night-towers` (scratch copy via `git merge-file`; `.wt/` is git-ignored and only exists on hermes):
- Only textual conflict: `scripts/balanceSim.ts` between ISLANDS (`--levels` flag) and TOWERS (`evaluateBalance` refactor) — not involving this branch. I removed my own `--levels` flag and moved the tempest camera-shake out of `renderWorld`'s boss branch to avoid conflicts.
- Merged tree (re-run after the review fixes with both branches' latest commits): tsc clean, **256/256 tests pass**. Balance: L1–L5 and L7–L12 inside their windows (L10/L11/L12 greedy 9/8/9 lives); **L6 fails** (greedy 6 lives vs Heroic 8–13, weak wins with 3) — an ISLANDS×TOWERS interaction, not enemies.
- Heads-up for resolving that balanceSim conflict: ISLANDS added a `--robust` HP-sweep table (`robustLines`, declared inside the per-level loop, printed in `main()`), while TOWERS moved the loop into `evaluateBalance()`. Taking TOWERS' side leaves `robustLines` undeclared in `main()` → ReferenceError at the end of the run. Needs manual stitching (return `robustLines` from `evaluateBalance` or move the sweep into `main`).
- L10–L12 numbers were picked so they pass both on this branch alone and in the merged tree.
- **Round 2 re-run (latest heads of all three branches, after the hexer / L12 Lanternfall / L13 move / review fixes):** same single conflict (`python3 .wt/stitch.py .wt/m3` resolves it as described above), tsc clean, lint clean, **291/291 tests pass**. Balance: everything inside its window except the known **L6** (ISLANDS×TOWERS). New islands merged: L10 7 / L11 8 / L12 8 / L13 9 greedy lives (on this branch alone: 5 / 7 / 8 / 7).

## Performance notes
- Sim cost: full greedy runs (Node, whole level incl. build script) — L9 683 ms, L10 257 ms, L11 332 ms, Stormcrown (now L13) 557 ms → the new archetypes/levels are not heavier than L9. Hexer adds one O(towers) scan per hexer every 0.4–5.5 s.
- Render: +3 instanced layers (burrow mound, shield bubble 80 tris, elite ring) + one layer per new type (hidden when count 0); no per-frame allocations in `EnemyRenderer.update`; FX reuse the pooled particle/ring/shard buckets.
- A wider local fuzz (192 seeded runs over all 12 islands, not committed) found no invariant violations.

## Independent review (sub-agent, read-only) — fixed
1. Burrower could reach the goal while underground (dive started 4.0–4.9 from the goal; 8.5% of arrivals). Now a dive only starts if it ends ≥3 before the goal, and a burrower still underground inside that stretch pops up at once. Test sweeps 24 phases × 12 islands incl. slowed dives.
2. First/Last targeting compared `dist/totalDist` across lanes of different length (L12: 118 vs 57) → wrong order on the shared stretch. Now uses `(dist + laneProgressOffset) / (totalDist + laneProgressOffset)`; offset is 0 on the main road and for flyers, so L1–L9 results are bit-identical (verified). Cross-area: 2 lines in `src/sim/targeting.ts` (merges cleanly with TOWERS' `auraRange` line).
3. Two new types spawning <7 s apart (endless) overwrote the first 'New foe' toast yet marked it seen. Now 6 s min gap; a type is marked seen only when its hint is shown.

## Decisions
- New enemies only appear in L10+ and endless → L1-L9 balance untouched.
- Untargetable (burrowed) is implemented by **not inserting the entity into the spatial hash** — every query (targeting, splash, chain, meteor, heal, hover) goes through it, so no edits in tower/targeting files are needed. Projectiles already in flight still land (fair).
- Difficulty label for L10-12 stays `Master` (a `Legendary` label would need a new CSS class `diff-legendary` in style.css which we must not touch) → UI need noted below.

## Cross-area changes
- `src/render/renderWorld.ts`: import + one spread entry binding `bindEnemyArchetypeFx(events, fx, shakeCallback)` (new file `src/render/enemyFx.ts`; tempest phase/kill camera shake goes through the callback).
- `src/render/effectsRenderer.ts`: `_enemyShardColors` entries for the new types (required by the `Record<EnemyType>` type).
- `src/render/mapBuilder.ts`: road connectivity mask loops over all ground lanes (main + `extraGroundPaths`). Pure re-indent of the existing loop + outer lane loop.
- `src/render/overlayIndicators.ts`: pinned ground-route ribbons/arrows drawn for every lane (same materials, loop).
- `src/sim/projectileSystem.ts`: shell leading uses `getPath(target.flying, target.lane)` (1 line).
- `src/platform/gameSession.ts`: flight-lane highlight checks `ENEMY_DEFS[type].flying` instead of `=== 'flyer'` (so Cloud Hauler waves highlight the sky lane).
- `tests/sim/waves.test.ts`: layout validation generalized for extra lanes and >9 islands.
- `scripts/balanceSim.ts`: flyer-share checks now count *lives* lost to every flying type (haulers included) via a new per-wave `livesByType` (that hunk merges cleanly with both other branches).
- `src/platform/sessionBridge.ts` + `storage.ts`: one-time "New foe — <name>: <counterHint>" toast on first spawn of each type that has a `counterHint` (only the new archetypes have one). Round 2: hints are spaced on wall-clock time (new optional `getRealClock` handler, default `performance.now()`), and the old flyer toast now waits while a hint is on screen instead of replacing it.
- `src/sim/targeting.ts` (round 2): the Strongest tie-break is lane-aware too (`dist + laneProgressOffset`; identical on single-lane islands).
- `src/audio/soundManager.ts` (round 9, TOWERS' file): 9 quiet, throttled synth cues for the enemy events (`playWardPulse`, `playShieldBroken`, `playBurrow(in/out)`, `playBlink`, `playCarrierDrop`, `playArmorCracked` — lower/stonier than TOWERS' icy `brittleCrack`, `playBossPhase(1|2)`, `playHexCharge` telegraph, `playTowerHexed`) + 9 `bindEvents` lines after `bossSummon`. Placed in regions TOWERS didn't touch: the scratch 3-way merge with the towers branch is clean and its tsc/308 tests pass. Test: `tests/audio/enemySounds.test.ts` (bindings, fake Web Audio voice count, throttle, mute).
- `src/platform/storage.ts` (round 9): `loadProgress` now unlocks the island after the furthest one with stars. Bug it fixes: the 9-island build's `recordWinProgress` never raised `unlockedLevelIndex` past 8 (no next island), so every existing player who had finished L9 would have found L10 locked. Test: `tests/platform/progressMigration.test.ts`. (Neither other branch touches storage.ts.)
- `src/ui/icons.ts`: `ENEMY_BADGE_META` entries. `src/ui/tooltip.ts`: text only — "Empowered" name prefix, `Shield N`, `(cracked)` armor.

## UI needs (for the UI branch / lead)
- `lanternfall-hollow` (new L12) has no authored island theme → it uses the ISLANDS branch's deterministic fallback biome. Suggestion for ISLANDS/lead: dusk palette, hanging lanterns on the hedgerows (rows 2/8/10), a lantern on the (15,5) point.
- Difficulty label: a `Legendary` tier for L11/L12 would need a `diff-legendary` class in style.css (not touched). Levels currently say `Master`.
- HUD wave preview (`hud.ts`): elite groups are not flagged (data is there: `WaveGroupDef.elite`); the "N Flyers incoming" warning chip only triggers for `flyer`, not `carrier` (use `ENEMY_DEFS[type].flying`).
- Enemy tooltip could show `counterHint` (new field on every new def) — a second line would need styling, so not added.
- Audio: done in round 9 (see Cross-area changes). `shieldAbsorb` deliberately has no sound (fires on every soaked hit; the blue glint is enough).

## Known issues
- New meshes were not checked in a real browser (no browser on hermes). They WERE checked with a software-rasterised lineup (a copy of the ISLANDS branch's `scripts/previewMap.ts` rasteriser, run in the git-ignored `.wt/` scratch area) — silhouettes/colours read well against grass. Also `tests/render/enemyGeometry.test.ts` (size vs sim height/radius, footprint, ≤900 tris, size classes). Not checkable that way (transparent/animated): shield bubble, elite ring, burrow mound bulge, blinker flicker — please eyeball in-game.
- The ISLANDS branch already ships themes for `confluence-terraces`, `galewatch-spires`, `stormcrown-citadel`; their placement/sight-line tests pass against my final level files in the dry-run merge (incl. 7 decor tiles I added to L12's terraces).
- Balance response is noisy (deterministic sim + binary events like a hauler dying 1 tile earlier): L11 shows a 13-life spike at enemyHpScale 1.205 between passing neighbours. Chosen values sit in passing plateaus on both this branch and the dry-run merge.
- Balance of L10+ assumes current tower stats; if the TOWERS branch changes tower numbers, re-run `npm run sim:balance` after merge (L10 window is ±2% HP wide).
- Endless with full L9 build now ends ~1 wave earlier (spotlight groups add units).

## README text for the lead (not edited on this branch to avoid 3-way README conflicts)
Replace the enemy bullet with something like:
> - **15 Enemy Archetypes**: Raider Grunt, Zephyr Runner, Iron Brute, Sky Skimmer, Grove Mender, Cinder Splitling, **Aegis Warden** (barrier pulses that soak damage for nearby allies), **Loam Burrower** (dives underground — untargetable — then resurfaces), **Cloud Hauler** (aerial barge that drops two raiders onto the road when shot down), **Rift Blinker** (charges and teleports forward; chill slows the charge), **Basalt Golem** (armor 12, cracked to 3 by chill), **Scuttle Mite** (tiny swarm unit), **Gloam Hexer** (stops and hexes a tower next to the road silent for a moment), plus two bosses: the Skyhold Dreadnought and the **Tempest Colossus** (Stormwall barrier at 2/3 HP, enrage + mite swarm + tower jams at 1/3). Late waves can field **Empowered** elites (gold aura, +75% HP, +1 armor).
And add the islands: *Confluence Terraces* (two spawn lanes merging), *Galewatch Spires* (sky-lane gauntlet), *Lanternfall Hollow* (hexer switchbacks — hug the road or stay out of reach), *Stormcrown Citadel* (spiral fortress finale). Endless now rotates spotlight pairs of the new archetypes, spreads groups across spawn lanes, and every 10th endless wave is led by a Tempest Colossus.
