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
- [x] Soldiers block ground enemies on the path (melee engagement, blocking capacity), fight, die, respawn after a timer
- [x] Rally point the player can move (within range); tiers raise soldier count/HP/damage
- [x] Flyers and burrowers ignore soldiers; bosses interact by sensible rules
- [x] Deterministic, tested; balance sim keeps all windows; L1c scripts may use barracks
- [x] 2D renderer: soldier layer + rally flag UI; 3D build bar hides barracks (main game unaffected)

Rules as built (code: `src/sim/soldierSystem.ts`, data: `src/data/soldiers.ts`, tiers in `src/data/towers.ts`):
- **Tiers:** 60 / 80 / 130 g. Soldiers 2 / 3 / 3, HP 110 / 160 / 230, hit 14 / 19 / 26 at 1.0 / 1.1 / 1.2 per s, armor 1 / 2 / 4, respawn 9 / 8 / 7 s, rally range 3.2 / 3.5 / 3.8. T3 signature **Cleave**: each swing also hits a second foe beside the target for 50 %.
- **Rally:** defaults to the nearest road point in range; a move is clamped onto the road inside the range. A barracks cannot be built where no road is in range. Moving the rally makes the squad drop its fights and walk to the new posts.
- **Holding:** a soldier in contact holds one enemy. An enemy with hold cost N stops when N soldiers are in contact; with fewer it moves at (1 − contact/N) speed. Spare soldiers gang up (max 3 per enemy) and peel off as soon as an unheld enemy comes into reach. Held enemies 2.8 units from the rally point are let go.
- **Per archetype:** flyers (Skimmer, Hauler) ignore soldiers. Burrowers can be held only while surfaced; a dive breaks the hold. Blinkers can be held, but the blink keeps charging and jumps them past the squad. Golem: hold cost 2. Dreadnought and Tempest: hold cost 3, and their blows hit every soldier in contact. The Tempest tramples through once enraged (phase 2). Brutes and Golems hit hard; mites hit weakly, but one soldier holds one mite, so swarms stream past.
- **Enemy melee** scales with √(HP scale): wave growth and elites hit harder, much less steeply than their HP. Chill slows the enemy's swing.
- **Interactions:** the Beacon aura's fire-rate bonus and Overcharge speed up swings (the aura also speeds up respawn). Hexer hexes and boss pulses target the barracks like any tower: a jammed barracks pauses its respawn timers, and soldiers already out keep fighting. Splitter hatchlings and Hauler raiders are ordinary new enemies and get held. Kills credit the barracks and pay gold as usual.
- **Upgrade** refreshes the squad: full HP at the new tier, fallen soldiers step out at once, new slots fill. **Sell** removes the squad, and held enemies walk on immediately.
- **3D game:** `only2d` keeps the barracks out of `TOWER_TYPES` (build bar, radial, hotkeys, codex).

## Renderer (agent)
- [ ] Manifest entries for the full roster (fallbacks until art lands)
- [ ] Per-enemy visuals: healer aura, warden shield bubble, burrower mound/underground, blinker blink FX, golem crack, hexer jam, splitter split, carrier drop, elite tint/overlay, boss phases
- [ ] Tower attack animation (procedural recoil/flash + frames where provided), all 7 tower types + barracks in the build ring
- [ ] Codex screen uses the 2D art

## Gate (end of P1)
- [ ] tsc, lint, full tests, sim:balance, build on hermes
- [ ] Recordings: all enemies walking on L1c, every tower at T1–T3 firing, barracks blocking a wave
- [ ] Report + next decision (P2 maps)
