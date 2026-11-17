# P1 roster art + barracks: working list

Owner decision (2026-11-17): **go**, using the **Omni-sheet route** for enemy animation. Credits are not a constraint (10k available); quality is.
Branch: `art-2d`. The Three.js `main` stays live and untouched.

## Art (lead: Codex image_gen + Flow Omni 1.2 Flash)
- [ ] Enemy front designs: runner, healer, splitter, warden, burrower (+ underground mound), carrier, blinker, golem, mite, hexer, tempest (boss), boss (Dreadnought). Existing: grunt = raider, brute, flyer = kite.
- [ ] Enemy back views (walking away), all 15
- [ ] Omni walk/fly clips: front + back for all 15 enemies + the soldier → sheets via `tools/sprites/veo_to_sheet.py`
- [ ] Optional per enemy, if clean: hit and death clips
- [ ] Towers: cannon T2/T3, crystal T2/T3, frost T1–T3, mortar T1–T3, ballista T1–T3, beacon T1–T3, barracks T1–T3
- [ ] Soldier unit: front/back walk, attack pose
- [ ] Tower attack frames (archer draw, cannon recoil, crystal pulse, mortar puff, ballista release, frost burst); procedural where frames don't add enough

## Sim: barracks/soldier tower (agent, a real feature)
- [ ] Soldiers block ground enemies on the path (melee engagement, blocking capacity), fight, die, respawn after a timer
- [ ] Rally point the player can move (within range); tiers raise soldier count/HP/damage
- [ ] Flyers and burrowers ignore soldiers; bosses interact by sensible rules
- [ ] Deterministic, tested; balance sim keeps all windows; L1c scripts may use barracks
- [ ] 2D renderer: soldier layer + rally flag UI; 3D build bar hides barracks (main game unaffected)

## Renderer (agent)
- [ ] Manifest entries for the full roster (fallbacks until art lands)
- [ ] Per-enemy visuals: healer aura, warden shield bubble, burrower mound/underground, blinker blink FX, golem crack, hexer jam, splitter split, carrier drop, elite tint/overlay, boss phases
- [ ] Tower attack animation (procedural recoil/flash + frames where provided), all 7 tower types + barracks in the build ring
- [ ] Codex screen uses the 2D art

## Gate (end of P1)
- [ ] tsc, lint, full tests, sim:balance, build on hermes
- [ ] Recordings: all enemies walking on L1c, every tower at T1–T3 firing, barracks blocking a wave
- [ ] Report + next decision (P2 maps)
