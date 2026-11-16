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

## Next
- Balance check of new towers (script comparing builds with/without), juice pass, T3 signatures

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
