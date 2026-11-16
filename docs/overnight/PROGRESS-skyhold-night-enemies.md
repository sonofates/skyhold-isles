# PROGRESS — ENEMIES night agent (branch `hermes/skyhold-night-enemies`)

Started 2026-11-16 23:00 UTC (02:00 TR). Deadline 06:00 UTC (09:00 TR).

## Status / task list
- [x] 1. New enemy archetypes (sim + data + mesh + badge + tests) — warden, burrower, carrier, blinker, golem, mite + elite flag (`tests/sim/newEnemies.test.ts`)
- [x] 2. Endless-mode variety — `ENDLESS_SPOTLIGHTS` rotation in `waveSystem.ts`, elites from 4th endless wave. Probe: `LVL=9 npx tsx scripts/endlessProbe.ts` (full L9 build: endless lasts to wave 25 vs 26 before — slightly harder, accepted).
- [x] Sim extension: extra ground spawn lanes (`LevelDef.extraGroundPaths`, `WaveGroupDef.lane`) + render support (`tests/sim/lanes.test.ts`, incl. layout validation for every island)
- [x] 4. New boss `tempest` (Tempest Colossus) — sim/mesh/FX/tests (built before L12 so the island can use it)
- [ ] 3. New islands L10, L11, L12 (+ balance sim)
- [ ] 5. Polish: hit/death FX, readability, more tests

## Enemy design table

| type key | Name | Role / mechanic | Counterplay | Silhouette / color |
|---|---|---|---|---|
| `warden` | Aegis Warden | Every ~3 s projects a barrier on nearby allies (not itself): absorbs damage before HP, capped, scales with the warden's HP scale. | Kill the warden first (Strongest/First), splash/chain strips many shields at once; shields don't block slow. | Tall cream/gold priest with a big round tower-shield + glowing halo disc. Shielded allies get a translucent blue bubble. |
| `burrower` | Loam Burrower | Cycles surfaced → burrowed. While burrowed it is out of the spatial hash (untargetable, no splash/chain/meteor), moves faster, then resurfaces. | Long coverage + splash zones where it pops up; frost before it dives (slow still ticks). | Squat ochre/brown mole-beast with big digging claws and a drill-snout; dirt mound when underground. |
| `carrier` | Cloud Hauler | Flyer (flight lane). On death drops 2 Raider paratroopers onto the nearest ground-path point (never past goal-3). | Kill it EARLY on its lane (anti-air up front) — late kills drop raiders near the sanctuary. | Fat balloon-gondola: cream balloon envelope, brown basket, coral flags. Readable as "cargo". |
| `blinker` | Rift Blinker | Charges a rift and teleports ~4.5 world units forward along the path every ~3.4 s (never within 2 of the goal). Chill slows the charge. | Frost (slows the charge as well as movement), high-burst towers; dense coverage after blink points. | Slim violet/teal crystal-imp with floating shard crown; burst FX at both ends of the blink. |
| `golem` | Basalt Golem | Very high armor (12). Every frost/chill hit (slow application, incl. meteor) cracks its armor down to 3 for a few seconds. | Pair Frost with Archer/Tesla volume; meteor; mortars do OK. Without frost, low-damage hits do ~1. | Massive dark basalt block body with glowing coral cracks; cracks turn icy when brittle. |
| `mite` | Scuttle Mite | Tiny, fast, cheap, comes in dense swarms. 1 life each. | Splash (cannon/mortar), Tesla chains. Single-target towers get overwhelmed. | Tiny bright-orange beetle with cream back stripe, low to the ground. |
| (elite) | Empowered variant | Wave-group flag `elite`: ×1.75 HP, +1 armor, ×1.6 reward, gold aura ring. Used in late waves of new islands + endless. | Same as base, focus fire. | Gold tint + aura. |
| `tempest` (boss) | Tempest Colossus (L12) | Phase boss: at 66% HP raises a storm ward (shield on self + nearby), at 33% enrages (speed up) and pulses to jam towers. | Burst it in phase windows, Overcharge to cleanse jams. | Huge storm-blue stone colossus with gold core. |

## Decisions
- New enemies only appear in L10+ and endless → L1-L9 balance untouched.
- Untargetable (burrowed) is implemented by **not inserting the entity into the spatial hash** — every query (targeting, splash, chain, meteor, heal, hover) goes through it, so no edits in tower/targeting files are needed. Projectiles already in flight still land (fair).
- Difficulty label for L10-12 stays `Master` (a `Legendary` label would need a new CSS class `diff-legendary` in style.css which we must not touch) → UI need noted below.

## Cross-area changes
- `src/render/renderWorld.ts`: import + one spread line binding `bindEnemyArchetypeFx` (new file `src/render/enemyFx.ts`); boss kill shake also for `tempest`.
- `src/render/effectsRenderer.ts`: `_enemyShardColors` entries for the new types (required by the `Record<EnemyType>` type).
- `src/render/mapBuilder.ts`: road connectivity mask loops over all ground lanes (main + `extraGroundPaths`). Pure re-indent of the existing loop + outer lane loop.
- `src/render/overlayIndicators.ts`: pinned ground-route ribbons/arrows drawn for every lane (same materials, loop).
- `src/sim/projectileSystem.ts`: shell leading uses `getPath(target.flying, target.lane)` (1 line).
- `src/ui/icons.ts`: `ENEMY_BADGE_META` entries. `src/ui/tooltip.ts`: text only — "Empowered" name prefix, `Shield N`, `(cracked)` armor.

## UI needs (for the UI branch / lead)
- (none yet)

## Known issues
- (none yet)
