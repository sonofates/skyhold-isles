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

## IN FLIGHT (r1, uncommitted in working tree if you see this)
T3 signatures: archer volley, cannon cluster shells, frost brittle, tesla overload, mortar incendiary burn patches. Code + tests exist (`tests/sim/tierSignatures.test.ts`); the stats are being tuned so that `npm run sim:balance` passes again (the archer/tesla signatures shift L1/L3/L6/L8/L9 results by +-5 lives because the sim is chaotic). Do NOT commit a state where sim:balance fails.

## Next
- Finish T3 signature balance (random search with `scripts/tuneSweep.ts`), commit, then polish

## Decisions
- (none yet)

## Known issues
- (none yet)

## Cross-area changes
- `src/platform/input.ts`: hotkey range `'1'..'5'` -> `'1'..'7'` (1 line) so keys 6/7 pick the new towers.
- `src/ui/buildBar.ts`: added `ballista`/`beacon` entries to the `shortNames` record (data-only; required by tsc).
- `src/core/eventBus.ts`: new `beaconPulse` event.

## UI needs (not implemented — UI is frozen for this branch)
- Build bar now has 7 cards (was 5): check the phone layout fits / scrolls.
- Tower panel for **Beacon**: it has no damage/fire-rate (shows `0` / `0.00/s`); should instead show aura `+N% fire rate` (`stats.auraRate`), `+N% range` (`stats.auraRange`) and radius (`stats.range`). Also hide the targeting buttons for `TOWER_DEFS[type].role === 'support'`.
- Tower panel for **Ballista**: could show `armorPierce` and `pierceCount` chips (optional fields on tier stats).
