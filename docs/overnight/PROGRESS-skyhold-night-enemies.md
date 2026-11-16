# PROGRESS — ENEMIES night agent (branch `hermes/skyhold-night-enemies`)

Started 2026-11-16 23:00 UTC (02:00 TR). Deadline 06:00 UTC (09:00 TR).

## Status / task list
- [x] 1. New enemy archetypes (sim + data + mesh + badge + tests) — warden, burrower, carrier, blinker, golem, mite + elite flag (`tests/sim/newEnemies.test.ts`)
- [x] 2. Endless-mode variety — `ENDLESS_SPOTLIGHTS` rotation in `waveSystem.ts`, elites from 4th endless wave. Probe: `npx tsx scripts/endlessProbe.ts --level=9` (full L9 build: endless lasts to wave 25 vs 26 before — slightly harder, accepted).
- [x] Sim extension: extra ground spawn lanes (`LevelDef.extraGroundPaths`, `WaveGroupDef.lane`) + render support (`tests/sim/lanes.test.ts`, incl. layout validation for every island)
- [x] 4. New boss `tempest` (Tempest Colossus) — sim/mesh/FX/tests (built before L12 so the island can use it)
- [x] 3. New islands
  - [x] L10 **Confluence Terraces** (`level10.ts`): two spawn lanes (west causeway = lane 0, northern switchback = lane 1) merge at a crossroads; introduces mites (w2), wardens (w3), burrowers (w4); Dreadnought at w10 and w20 with elite wardens/brutes. enemyHpScale 0.965 → greedy W 6 lives here / 8 lives in the 3-branch dry-run merge; weak loses ~w10.
  - [x] L11 **Galewatch Spires** (`level11.ts`, helper agent): road loops a central plateau and a void "gale chasm"; the sky lane is 87% of the road length and slaloms over buildable land. Haulers w3, blinkers w4, golems w6, elites from w16, Dreadnought w10 and w20 (bosses arrive last so haulers don't slip by under boss focus). Greedy W 7 lives 1★ here (passes 1.19–1.24 except a 13-life spike at 1.205) / 8 lives merged (passes 1.20–1.22), weak loses w16–17. Leaks are mostly haulers + their dropped raiders (by design: ground defence isn't the limiter here).
  - [x] L12 **Stormcrown Citadel** (`level12.ts`, helper agent): 18x14 spiral fortress; main road coils inward through 3 rings to a central storm altar, northern war-road (lane 1) joins the inner ring at (13,7); every new archetype, lane-1 pressure in 16/22 waves, 6 elite groups (w18–22), Dreadnought w11, Tempest Colossus walks the whole spiral in w22 (Stormwall on the outer ring, enrages ~inner court; greedy kills it with 2–9% HP to spare). enemyHpScale 1.64 → greedy W 7 here / 8 merged; weak loses ~w16.
- [x] 5. Polish: hit/death FX, readability, more tests
  - [x] FX for every new mechanic (`enemyFx.ts`), blinker flicker + burrower mound bulge telegraphs, elite ring, shield bubble, blue glint when a barrier soaks a hit (`shieldAbsorb`)
  - [x] mesh polish after a rasterised preview (rounder burrower, striped balloon)
  - [x] tests: geometry sanity, EnemyRenderer update path (stub materials), FX bindings, determinism replay, seeded fuzz/stress over all archetypes (`enemyStress.test.ts`)
  - [x] wave preview `eliteCount`, endless Tempest every 10th wave, endless groups spread over lanes
  - [x] first-encounter counterplay toasts

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
| `tempest` (boss) | Tempest Colossus (L12, endless every 10th wave) | 1500 HP, armor 8, 6 lives. ≤66%: stops 1.3 s and raises a Stormwall (self shield 20% maxHP, allies within 5 get 60% of their maxHP). ≤33%: enrages ×1.35 speed, summons 6 mites, jams the 2 nearest towers every 6 s. | Burst it in phase windows, splash the shielded escort, Overcharge to cleanse jams. | Huge slate-blue stone colossus, gold storm core, cloud pauldrons, gold bolt crown. |

## How to verify (all green at every commit on this branch)
`npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance` — 12 islands pass; `LEVELS=10,11,12 npm run sim:balance` for just the new ones.
New tests: `tests/sim/newEnemies.test.ts`, `tests/sim/lanes.test.ts`, `tests/sim/enemyStress.test.ts`, `tests/render/enemyGeometry.test.ts`, `tests/render/enemyRenderer.test.ts`, `tests/render/enemyFx.test.ts`.

## Scratch tools (git-ignored `.wt/`, hermes only — for the next round of this agent)
`.wt/gate.py [--no-build]` full green gate · `.wt/sweep.py <root> <levelFile> <N> enemyHpScale v1 v2…` balance robustness sweep · `.wt/trymerge.py <dest> cfb9330 <branches…>` scratch 3-way merge · `.wt/mkpreview.py` + `npx tsx .wt/m3/scripts/previewEnemies.ts .wt/preview 1400 <types>` rasterised enemy lineup (needs a trymerge'd `.wt/m3` with the ISLANDS rasteriser) · `npx tsx .wt/buildmap.ts <N>` layout with build tiles marked.

## Morning merge dry-run (done on this branch, repo untouched)
`python3 .wt/trymerge.py .wt/m3 cfb9330 hermes/skyhold-night-islands hermes/skyhold-night-towers` (scratch copy via `git merge-file`; `.wt/` is git-ignored and only exists on hermes):
- Only textual conflict: `scripts/balanceSim.ts` between ISLANDS (`--levels` flag) and TOWERS (`evaluateBalance` refactor) — not involving this branch. I removed my own `--levels` flag and moved the tempest camera-shake out of `renderWorld`'s boss branch to avoid conflicts.
- Merged tree (re-run at 23:45 UTC with both branches' latest commits): tsc clean, **253/253 tests pass**. Balance: L1–L5 and L7–L12 inside their windows (L10/L11/L12 greedy 8/8/8 lives); **L6 fails** (greedy 6 lives vs Heroic 8–13, weak wins with 3) — an ISLANDS×TOWERS interaction, not enemies.
- Heads-up for resolving that balanceSim conflict: ISLANDS added a `--robust` HP-sweep table (`robustLines`, declared inside the per-level loop, printed in `main()`), while TOWERS moved the loop into `evaluateBalance()`. Taking TOWERS' side leaves `robustLines` undeclared in `main()` → ReferenceError at the end of the run. Needs manual stitching (return `robustLines` from `evaluateBalance` or move the sweep into `main`).
- L10–L12 numbers were picked so they pass both on this branch alone and in the merged tree.

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
- `src/platform/sessionBridge.ts` + `storage.ts`: one-time "New foe — <name>: <counterHint>" toast on first spawn of each type that has a `counterHint` (only the new archetypes have one; the old flyer toast is unchanged).
- `src/ui/icons.ts`: `ENEMY_BADGE_META` entries. `src/ui/tooltip.ts`: text only — "Empowered" name prefix, `Shield N`, `(cracked)` armor.

## UI needs (for the UI branch / lead)
- Difficulty label: a `Legendary` tier for L11/L12 would need a `diff-legendary` class in style.css (not touched). Levels currently say `Master`.
- HUD wave preview (`hud.ts`): elite groups are not flagged (data is there: `WaveGroupDef.elite`); the "N Flyers incoming" warning chip only triggers for `flyer`, not `carrier` (use `ENEMY_DEFS[type].flying`).
- Enemy tooltip could show `counterHint` (new field on every new def) — a second line would need styling, so not added.
- Audio (TOWERS agent area): no sounds yet for `wardPulse`, `shieldBroken`, `enemyBurrow`, `enemyBlink`, `carrierDrop`, `armorCracked`, `bossPhase` events (all on the EventBus).

## Known issues
- New meshes were not checked in a real browser (no browser on hermes). They WERE checked with a software-rasterised lineup (a copy of the ISLANDS branch's `scripts/previewMap.ts` rasteriser, run in the git-ignored `.wt/` scratch area) — silhouettes/colours read well against grass. Also `tests/render/enemyGeometry.test.ts` (size vs sim height/radius, footprint, ≤900 tris, size classes). Not checkable that way (transparent/animated): shield bubble, elite ring, burrow mound bulge, blinker flicker — please eyeball in-game.
- The ISLANDS branch already ships themes for `confluence-terraces`, `galewatch-spires`, `stormcrown-citadel`; their placement/sight-line tests pass against my final level files in the dry-run merge (incl. 7 decor tiles I added to L12's terraces).
- Balance response is noisy (deterministic sim + binary events like a hauler dying 1 tile earlier): L11 shows a 13-life spike at enemyHpScale 1.205 between passing neighbours. Chosen values sit in passing plateaus on both this branch and the dry-run merge.
- Balance of L10+ assumes current tower stats; if the TOWERS branch changes tower numbers, re-run `npm run sim:balance` after merge (L10 window is ±2% HP wide).
- Endless with full L9 build now ends ~1 wave earlier (spotlight groups add units).

## README text for the lead (not edited on this branch to avoid 3-way README conflicts)
Replace the enemy bullet with something like:
> - **14 Enemy Archetypes**: Raider Grunt, Zephyr Runner, Iron Brute, Sky Skimmer, Grove Mender, Cinder Splitling, **Aegis Warden** (barrier pulses that soak damage for nearby allies), **Loam Burrower** (dives underground — untargetable — then resurfaces), **Cloud Hauler** (aerial barge that drops two raiders onto the road when shot down), **Rift Blinker** (charges and teleports forward; chill slows the charge), **Basalt Golem** (armor 12, cracked to 3 by chill), **Scuttle Mite** (tiny swarm unit), plus two bosses: the Skyhold Dreadnought and the **Tempest Colossus** (Stormwall barrier at 2/3 HP, enrage + mite swarm + tower jams at 1/3). Late waves can field **Empowered** elites (gold aura, +75% HP, +1 armor).
And add the islands: *Confluence Terraces* (two spawn lanes merging), *Galewatch Spires* (sky-lane gauntlet), *Stormcrown Citadel* (spiral fortress finale). Endless now rotates spotlight pairs of the new archetypes, spreads groups across spawn lanes, and every 10th endless wave is led by a Tempest Colossus.
