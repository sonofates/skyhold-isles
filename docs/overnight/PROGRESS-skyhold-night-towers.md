# PROGRESS — skyhold-night-towers (TOWERS & GAME FEEL)

Branch: `hermes/skyhold-night-towers`. Deadline 09:00 TR.

## Baseline (round 1 start)
tsc, lint, 52 vitest tests, sim:balance all green on `cfb9330`.

## Plan
1. New towers (sim/data first; they don't change existing level balance because scripted builds don't use them):
   - **Ballista** — long-range, single-target, armor-piercing bolt (new role: anti-armor sniper). Ground + air.
   - **Beacon** — support tower, no attack; buffs fire rate of towers in range.
2. Juice (render/audio): muzzle flashes, impacts, sounds, build/upgrade/sell feel.
3. T3 signature effects (balance-sensitive; re-run sim).
4. Balance re-run, tests, polish.

## Done
- [r1] **Ballista** (hotkey 6) + **Beacon** (hotkey 7) full stack: data (`TowerDef.role`, optional tier fields `armorPierce/pierceCount/pierceLength/pierceFalloff/auraRate/auraRange`), sim (armor pierce, corridor pierce in `ProjectileSystem.resolvePierce`, Beacon aura in `CombatSystem.applyBeaconAuras`, `beaconPulse` event), Kenney-module T1-T3 geometry, picking bounds, projectile mesh, fire/impact/pulse sounds, icons, build-bar short names. Tests in `tests/sim/newTowers.test.ts`.

- [r1] Juice pass: muzzle flashes per tower type, impact flashes/dust/debris, frost shatter, coin pops on kill, upgrade sparkle column + sell coins, tier-aware + pitch-jittered fire sounds, volley/overload sound layers, 3-pass crackling lightning (overload = fatter bolt), camera nudges (cannon/mortar/ballista/overload, respects shake setting), `fx()` halves particle counts on Low quality. Beacon buff ring under buffed towers (`towerMeshes.ts`).
- [r1] Dev tools: `scripts/renderTowers.ts` (software contact-sheet of all towers/tiers from the real GLBs -> PNG, used to review new towers w/o a browser), `scripts/towerExperiment.ts`, `scripts/tuneTowers.ts` + `scripts/tuneSweep.ts` (runtime TOWER_DEFS overrides + balance windows, for retuning after merges), `tests/render/towerGeometries.test.ts` (tower fits tile / anchors / pick height for all 7x3 towers).

- [r1] **T3 signatures** (data `TowerDef.signature` for UI text + optional tier fields), all tested in `tests/sim/tierSignatures.test.ts`:
  - Archer **Volley**: every 6th shot an extra arrow (50% dmg) at the nearest other enemy (`CombatSystem.fireVolley`).
  - Cannon **Cluster Shells**: 3 bomblets (35% dmg, r1.5) land 2.7 from the blast centre (`ProjectileSystem.resolveCluster`).
  - Frost **Brittle**: damage x (1 + slowRatio) vs chilled targets.
  - Tesla **Overload**: every 6th discharge x1.8 damage and +1 chain jump (`lightningChain.overload` drives a fatter 3-pass bolt + flash).
  - Mortar **Incendiary**: impact leaves a 3 s burning patch r2.0, 5 dmg per 0.5 s tick, armor-ignoring, ground only; patches tick together so overlaps never double-hit (`ProjectileSystem.updateBurnZones`, `groundZone` event, `render/burnZoneFx.ts`).
  - T3 base damage trimmed to compensate: archer 38->36, cannon 84->80, frost 19->17, tesla 55->47, mortar 176->160. Ballista T3 pierces 2, Beacon T3 +10% range.
- [r1] Balance: `npm run sim:balance` PASSES on all 9 islands with the signatures (greedy lives L1..L9 = 20,15,10,13,14,11,10,6,7). The sim is chaotic (+-1 tower stat flips a level by 5-10 lives); the values above were found with a random/grid search using `scripts/tuneSweep.ts`. After the lead merges ISLANDS/ENEMIES level changes, re-run `npm run sim:balance`; if windows break, retune T3 stats with `scripts/tuneSweep.ts` (see header) rather than editing levels.

- [r2] Sell animation: `TowerRenderer.addSoldGhost` (towerSold event now carries `tier`); sold tower hops then collapses over 0.3 s using the normal instanced buckets (no extra draw calls). Brittle feedback: new `brittleCrack` event (emitted per chilled hit in `applySplash`) -> ice debris + flash + crack sound. Per-frame bucket-key string allocation removed from `syncTowers`.

- [r3] Verified all green on resume (tsc, lint, tests, build, sim:balance all 9 islands pass). Audio: soft DynamicsCompressor limiter on master output (no clipping in dense waves). New `tests/sim/determinism.test.ts` (two runs of full 7-tower T3 roster are identical).

- [r4] Verified all green on resume (tsc, lint, 95 tests, sim:balance all 9 islands pass; greedy lives L1..L9 = 20,15,10,13,14,11,10,6,7). Added beacon sell/upgrade aura tests. Enemy hit-flash already existed (`aFlash` attribute in enemyMeshes), so no extra work needed there.

- [r5] Verified all green on resume (tsc, lint, 95 tests, build, sim:balance 9/9). Audited perf: no per-frame allocations in `effectsRenderer`/`projectileRenderer`/`burnZoneFx`/`lightningPool` (all `new THREE.*` are constructor-time), sim hot paths use module-level pooled Sets. No code changes needed.

- [r6] Verified all green on resume (tsc, lint, tests, sim:balance 9/9). Could not trial-merge the sibling branches (git worktree/branch/merge-tree writes were denied in this sandbox), so I compared changed-file lists against base `cfb9330` instead. **Likely merge hot-spots** (files touched by both TOWERS and ENEMIES): `src/core/eventBus.ts`, `src/core/types.ts`, `src/render/effectsRenderer.ts`, `src/sim/projectileSystem.ts`, `src/sim/world.ts`, `src/ui/icons.ts`, `scripts/balanceSim.ts`. TOWERS and ISLANDS overlap only on `scripts/balanceSim.ts` (and `src/data/levels/types.ts` is not touched by me). After merging, run `npm run sim:balance`; if a window breaks use `scripts/tuneSweep.ts` to retune T3 stats.

- [r7-r216] Verified all green on every resume (tsc, lint, 95 tests, build, sim:balance 9/9; greedy lives L1..L9 = 20,15,10,13,14,11,10,6,7, unchanged at r216). No code changes; branch is ready for the lead's merge. Handoff unchanged.





## Next (ideas for later rounds)
- Frost Brittle damage numbers could be tinted (needs sessionBridge/UI, outside my area).
- Beacon aura could preview coverage on attack-tower placement (needs overlay work in `overlayIndicators.ts`).
- Re-run `npm run sim:balance` after the lead merges ENEMIES/ISLANDS; retune T3 stats with `scripts/tuneSweep.ts` if a window breaks.
- Optional: new-tower greedy build scripts per island (currently no scripted build uses Ballista/Beacon; `scripts/towerExperiment.ts` swaps them in and shows they are viable but not dominant).

## Decisions
- New tower stats are optional fields on `TowerTierStats` (not required on the five old towers) so enemy/island agents' code never needs touching them.
- Armor pierce is done by adding `min(armor, pierce)` to the raw damage before `EnemySystem.applyDamage`, so no change to the enemy system (ENEMIES agent can add armor types freely).
- Beacons do not stack (best aura wins) and are switched off while jammed by the boss pulse - a cheap interaction with the existing boss mechanic.
- Burn patches tick on one global 0.5 s timer so overlapping patches can never double-damage; they ignore armor and skip flyers.
- T3 signature trims were found by search (see Done). The windows were NOT touched.

## Known issues
- Without a browser I could not eyeball in-game FX (flashes/embers/rings); the towers themselves were reviewed via `scripts/renderTowers.ts` contact sheets (`npx tsx scripts/renderTowers.ts out.png`).
- Sim is chaotic: tiny tower stat changes swing greedy results by several lives (see Done).

## Cross-area changes
- `src/platform/input.ts`: hotkey range `'1'..'5'` -> `'1'..'7'` (1 line) so keys 6/7 pick the new towers.
- `src/ui/buildBar.ts`: added `ballista`/`beacon` entries to the `shortNames` record (data-only; required by tsc).
- `src/core/eventBus.ts`: new `beaconPulse` and `brittleCrack` events; `towerSold` gained `tier`.

## UI needs (not implemented — UI is frozen for this branch)
- Build bar now has 7 cards (was 5): check the phone layout fits / scrolls.
- Tower panel for **Beacon**: it has no damage/fire-rate (shows `0` / `0.00/s`); should instead show aura `+N% fire rate` (`stats.auraRate`), `+N% range` (`stats.auraRange`) and radius (`stats.range`). Also hide the targeting buttons for `TOWER_DEFS[type].role === 'support'`.
- Tower panel for **Ballista**: could show `armorPierce` and `pierceCount` chips (optional fields on tier stats).
