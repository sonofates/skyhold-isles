# Handoff: chapter five foes (Task A, branch `hermes/sky-ch5-foes`, 2026-11-25)

The Eclipse Skies roster from `docs/chapter5-plan.md` ("Yeni düşmanlar") is in the sim, the data, the
2D and 3D renderers, the UI, the Turkish texts and the QA bot. **No island uses them yet.** That is
Phase 2/3 (waves and balance on i37–i45). I did not touch `src/data/chapters.ts`,
`src/data/levels2d/index.ts` or any island file. Built the same way as `docs/handoff-ch4-foes.md`.

## The foes

| id | EN / TR | HP | armor | speed | reward | lives | melee (hold / dmg / rate) |
|---|---|---|---|---|---|---|---|
| `duskhound` | Dusk Hound / Alacakaranlık Tazısı | 95 | 1 | 2.6 | 4 | 1 | 1 / 7 / 1.15 |
| `veilcaster` | Veilcaster / Örtü Büyücüsü | 165 | 2 | 1.75 | 9 | 2 | 1 / 6 / 0.8 |
| `eclipse_sovereign` | Eclipse Sovereign / Tutulma Hükümdarı (final boss) | 2400 | 9 | 0.9 | 80 (paid by the halves) | 8 | 3 / 46 / 0.75, sweep |
| `eclipse_shade` | Shadow Half / Gölge Yarısı (boss form, only from the split) | 55 % of the HP left (nominal 528) | 7 | 1.05 | 40 | 4 | 3 / 30 / 0.8, sweep |

How they compare with chapter four and the older foes:
- **Dusk Hound** is a pack walker between the Belfry Hare (84 HP / armor 0 / 2.35) and the Rime
  Beetle (150 / 3 / 1.9). With both enrage stacks it runs 2.6 × 1.6 = 4.16, about a Zephyr Runner
  (4.0). One life each: the pack size is the threat.
- **Veilcaster** is a sturdier, slower Gloam Hexer (120 / 1 / 1.9 / 7 gold / 2 lives). Its reach
  (4.4) is longer than the hex (3.6), but a veil never silences a tower, it only shortens its reach.
- **Eclipse Sovereign** sits one step above the Glacier Warden (1800 / armor 8 / 0.95 / 60 gold /
  6 lives). Effective pool: 2400 × 0.6 = 1440 before the split, then two halves of 55 % of what is
  left (≤ 2 × 528 = 1056, each with armor 7, so every hit pays armor twice), plus 4 summoned hounds
  (95 × wave HP scale). That is ≈ 2.9 k against the Glacier Warden's 1800 + 6 beetles (≈ 2.7 k).
  Both halves leaking cost 8 lives, as much as the Sovereign itself; both halves dying pay its 80.

These are starting values. The Phase 2/3 wave/balance agents should tune them with the islands.

## Mechanics (sim)

**Dusk Hound, pack enrage** (`src/sim/enemySystem.ts`)
- Ability `{ kind: 'pack', radius: 10, speedBonus: 0.3, enrageSec: 4, maxStacks: 2 }`. 5 tiles =
  10 world units (one tile is 2 units; the frost patch's 3.2 units = 1.6 tiles in ch4).
- When a hound dies (`hp <= 0`, not a leak), its position is noted during the movement pass. After
  the pass, every other living hound within the radius (straight-line distance, new spatial hash)
  gets `enrageStacks = min(2, stacks + 1)` and `enrageTimer = 4` (refreshed on every death). Two
  deaths in one tick give two stacks at once. One `packEnrage` event per death with mates around.
- Movement: speed × (1 + 0.3 × stacks) on top of slows / holds (like the Hare's momentum). The timer
  runs down in the hound's movement step; at 0 the stacks drop to 0.
- New entity fields `enrageStacks` / `enrageTimer` (reset at every spawn).

**Veilcaster, tower veil**
- Ability `{ kind: 'veil', reach: 4.4, interval: 6, firstSec: 2, veilSec: 4, rangeCut: 0.3 }`.
- 2 s after spawning, then every 6 s, it veils the **nearest firing tower within reach that is not
  veiled already** (`tower.veilTimer = 4`, `towerVeiled` event). Veils never stack: an already-veiled
  tower is skipped (a second caster picks the next-nearest), and nothing deepens or extends a veil.
  With nothing in reach it retries every 0.4 s; a stunned caster holds its cast. No channel: it
  keeps walking.
- Barracks and Beacons are never veiled (they do not attack).

**Range cut (shared by the veil and the eclipse)** (`src/sim/combatSystem.ts`, `src/sim/targeting.ts`)
- `CombatSystem.applyRangeCuts` runs every tick after the Beacon aura and the frost patches: it ticks
  `veilTimer` down and sets `tower.rangeCut = 1 − (1 − veil) × (1 − eclipse)` on every firing tower
  (veil 0.3, eclipse 0.2, both = 0.44). Barracks and Beacons always get 0.
- `attackReach(tower, baseRange) = range × (1 + aura + hero) × (1 − rangeCut)`, used by tower
  targeting and the archer volley. **Only the attack range shrinks:** the Beacon aura radius, the
  barracks rally range, selling, upgrading and shells already in flight are unchanged; heroes are not
  towers and are never cut. Towers that were never cut keep no `rangeCut` field at all.
- The 2D range circle (`towerReach` in `game2d.ts`, ring preview and desktop hover) uses the same
  `attackReach`, so it is drawn shrunk while a veil / the eclipse lasts and grows back after.

**Eclipse Sovereign, final boss** (`updateSovereign`, checked at the start of its movement step)
- Ability `{ kind: 'sovereign', eclipseAt: 0.66, eclipseSec: 8, eclipseCut: 0.2, splitAt: 0.4,
  splitHpFrac: 0.55, summonCount: 4 }`, shared `bossPhase` counter (1 = eclipse, 2 = split).
- **≤ 66 %:** eclipse. `EnemySystem.eclipseTimer = 8` (`eclipseDuration`, `eclipseCut`), `bossPhase`
  (phase 1) and `eclipse` events. Every firing tower loses 20 % attack range while it lasts.
- **≤ 40 %:** split, modelled on the splitter / Cloud Hauler: the Sovereign's state is copied, its pool
  slot is freed **first** (a full pool still fits the halves), then two `eclipse_shade` spawn on its
  lane at its distance and 1.2 units behind, each with `maxHp = hp = max(1, round(hpLeft × 0.55))`,
  the Sovereign's speed × (1.05 / 0.9) (keeps run speed modifiers), half its reward each, `bossPhase
  = 2`, and its elite flag / armor bonus if it had one. Then 4 Dusk Hounds (wave-HP-scaled, 2 gold
  each) land 0.9 / 1.35 / 1.8 / 2.25 units behind. Events: `bossPhase` (phase 2), `sovereignSplit`,
  `bossSummon`. A split is not a kill: no `enemyKilled`, no bounty, no hero XP for the Sovereign.
- One huge hit through both thresholds plays the eclipse and the split in the same tick. Even a
  killing blow cannot skip the split: an unsplit Sovereign at 0 HP still splits (halves of 1 HP).
  The wave (and the island) ends only when both halves are dead — the halves are ordinary pool
  enemies, so the existing wave-completion check needs no change.
- Boss-class everywhere: `isBoss` (codex crown, wave banner, boss music on spawn, boss shake, half-
  length stuns, damage numbers) for the Sovereign **and** the halves, `ENDLESS_UNSCALED_TYPES`,
  `NEVER_CHAMPION`, heavy melee look, endless pool weight +6 (2 halves + 4 hounds).

**Endless** (`src/sim/waveSystem.ts`)
- `hasChapterFiveEnemies(level)`: islands whose story waves contain `duskhound`, `veilcaster` or the
  Sovereign use `ENDLESS_CHAPTER5_SPOTLIGHTS` (8 pairs covering both new foes) and their 10th, 20th, …
  endless wave is led by the **Eclipse Sovereign**. Chapter five wins over chapter four (an i40+ island
  that also sends Rime Beetles still gets the chapter-five rotation). Every other island is unchanged.
  Spotlight tuning: hound base 5 / +0.8 / max 20 / interval 0.45 (tight packs); caster base 2 /
  +0.35 / max 8 / interval 1.4.

**Run end / determinism**
- `SimWorld.clearFrost` (win, loss, skip, dispose) also ends the eclipse and clears every veil and
  range cut.
- `computeSimStateHash` and the QA bot hash add the new state only while it exists: a tower's
  `veilTimer` / `rangeCut` when > 0, the eclipse timer + cut while it runs, a hound's enrage while
  stacked. Hashes of every existing run and replay are unchanged (tested: present-but-zero fields
  do not move the hash).

## Records (end to end)
- `EnemyType` (`src/core/types.ts`): `duskhound | veilcaster | eclipse_sovereign | eclipse_shade`.
  `CHAPTER5_ENEMY_DEFS` / `CHAPTER5_ENEMY_TYPES` / `CHAPTER5_ENEMY_MELEE` (`src/data/enemies.ts`)
  are spread at the end of `ENEMY_DEFS` and `ENEMY_MELEE`, so older key order does not change.
  `ENEMY_TYPES` order: `…sledguard, duskhound, veilcaster, tempest, glacier_warden,
  eclipse_sovereign, eclipse_shade, boss` (bosses last, `boss` stays last).
- New `EnemyDef.partOf`: the Shadow Half is `partOf: 'eclipse_sovereign'` → no codex tile of its own
  (`allEnemyEntries` filters it; the Sovereign's entry describes the split) and no first-sighting
  card (`SightingQueue.offerEnemy`). It still has its own lore / badge / glyph / TR / 3D figure /
  death note, so every per-type table stays complete.
- Death notes (`DEATH_PITCH`): hound 380 Hz, caster 300, Sovereign 62, half 88. Sounds reuse cues:
  pack howl = blink whoosh, veil = hex charge, split = splitter burst, eclipse = boss-phase cue.
- 3D: shard colours (`effectsRenderer.ts`), four small figurines (`enemyMeshes.ts`, pass
  `enemyGeometry.test`), shadows + wide HP bars for the two boss forms.
- HUD badges and SVG glyphs (`src/ui/icons.ts`), 3D wave hints (`waveHints.ts`), codex lore
  (`codexData.ts`, blurbs ≤ 90 chars), Turkish name / desc / counter plus the new tags `Pack` → Av
  sürüsü and `Range cut` → Menzil kısaltır (`src/i18n/dataTr.ts`).
- The "New" tag in the 2D wave card is automatic (`newFoes2d.ts` tracks the wave groups' types).

## 2D visuals
- **Dusk Hound enrage:** a hot violet cast that deepens with the second stack, a pulsing glow, and a
  smoke trail (embers too at two stacks). A howl ring + sparks where a hound fell (`packEnrage`).
- **Veilcaster:** a soft violet ground ring under the caster; on a cast, a dark shroud beam from the
  caster to the tower with a puff. The **veiled tower** gets a dark, flickering ground ring and a
  dusky tint while the veil lasts (fades over the last 0.4 s); `markers().veiled` counts them.
- **Range circle:** drawn shrunk (see above) for the open build ring and the desktop hover.
- **Eclipse:** `src/render2d/eclipseLayer.ts`, a screen-wide dusk shade (0x0e0820, alpha 0.42) below
  the HUD, drawn from the sim's eclipse timer every frame (a seek / skip / run end can never leave it
  on), fading in over 0.6 s and out over the last 1 s. In the QA shot the mean luminance of the frame
  drops from ≈ 144 to 90; the DOM HUD stays bright. Plus a gold corona burst on the Sovereign.
- **Sovereign / halves:** a dusk ground aura that turns gold after the eclipse, dusk phase rings, and a
  split burst (shards, sparks, flash, smoke). The boss death burst plays when each half dies.
- `debugState()`: `fx.eclipse { timer, cut, shade, drawn }`, `fx.events.packEnrage / .towerVeiled /
  .eclipse / .sovereignSplit`, `fx.markers.veiled`, per tower `veil` / `rangeCut`.

## Placeholder art (until Task B lands)
- `public/art2d/manifest.json` has `enemies.duskhound | veilcaster | eclipse_sovereign |
  eclipse_shade` and their `enemyMap` entries, with the pipeline's file naming
  (`enemy-<id>.webp`, `enemy-<id>-back.webp`, `anim/<id>-walk-{down,up,side}.json`,
  `anim/<id>-attack.json`, `anim/<id>-death.json`). **The halves use the art id `eclipse_shade`.**
- Each entry has a manifest **`fallback`** (the existing mechanism for pending art), clearly marked by
  `?artcheck=1`, the loader notes and the zoo labels (`duskhound → bellrunner`):
  - hound → tinted `bellrunner` × 1.05; caster → tinted `hexer` × 1.05;
  - Sovereign → tinted `boss` (Dreadnought) × 1.2;
  - Shadow Half → tinted **`eclipse_sovereign`** × 0.82, so once the Sovereign atlas lands the halves
    draw a darker, smaller Sovereign until their own atlas lands (chain tested).
- **The real art takes over with no code change** as soon as the files exist (`resolveEnemyArt` only
  follows a fallback when the type's own files are missing; tested). **For Task B:** keep the keys and
  file names; edit heights / anchors / strides in my four entries if yours differ; the `fallback`
  field can stay or go. Expect a trivial merge on `manifest.json`.
- Until then a page showing these foes logs 404s for the missing files (handled, falls back). Only the
  zoo and the tests show them today.

## Tests and QA tooling
- **New `tests/sim/chapterFiveEnemies.test.ts` (32 tests).**
  - Roster wiring: defs, melee, bestiary order, boss-class lists; lore, badge, glyph, TR text + tag
    translations; manifest art + fallback (and the halves' fallback chain to the Sovereign); the
    half has no codex tile and no first-sighting card; the balance relations above.
  - Pack enrage: 3 mates within 5 tiles get a stack, a hound > 5 tiles away does not; second death →
    2 stacks; third death refreshes the timer but stays at 2; everything lapses after 4 s; an enraged
    hound runs exactly 1 + 0.3 × stacks as fast; a leaking hound enrages nobody.
  - Veil: nearest tower in reach after 2 s, `rangeCut` 0.3 and `attackReach` × 0.7, others untouched,
    lifts after 4 s, next cast 6 s after the first; two casters veil two different towers (no
    stacking); a foe at 80–90 % of the range is targeted unveiled and missed veiled; upgrade and sell
    still work; barracks / beacons never veiled or cut, the Beacon aura still reaches.
  - Eclipse: at 66 % the eclipse event, timer 8, every tower cut 20 %; no second eclipse; ends after
    8 s.
  - Split: halves with `round(hpLeft × 0.55)` each, phase 2, boss lives / half the bounty, on its lane
    behind its position; 4 hounds behind; events; no kill event. A big hit plays both phases in one
    tick; a killing blow still splits (1-HP halves). In a one-wave SimWorld level the island is only
    won once **both** halves die and both together pay the Sovereign's 80 gold; a leaking half costs 4
    lives.
  - Hashing: present-but-zero fields keep the hash; a veil, an eclipse or an enrage change it.
  - A **test-only level** on I16's map with four waves of the new foes (never registered): the full
    run ends with pack howls, veils, range-cut ticks, exactly one eclipse and one split, everything
    cleared at run end, and the same state hash and counters on a second run. Endless on that level
    spotlights both new foes and the Sovereign leads the 10th and 20th waves; a mixed ch4+ch5 island
    gets the ch5 rotation; ch4 islands keep the Glacier Warden, older ones the Tempest.
- Adjusted existing tests: `tests/ui/codexData.test.ts` (codex count excludes `partOf` forms) and
  `tests/sim/chapterTwoActivation.test.ts` (death-sheet roster now lists the chapter-five keys too).
- QA bot: invariants for `veilTimer` ∈ [0, 4], `rangeCut` ∈ [0, 1), the eclipse timer, hound enrage
  (stacks ≤ 2, stacks ⇔ timer) and no eclipse / veil / range cut left after a run; the runner flags
  chapter-five endless waves that never spawn a chapter-five foe (the ch4 check skips ch5 islands).
- `sim:balance`: on islands with chapter-five foes only, the summary line gets `| dusk: greedy N
  veils, M pack howls, eclipse E, split S, X% of tower reach lost` (informational, no pass/fail yet).
  Nothing prints on today's islands, so the output is unchanged.
- `?zoo=1&types=duskhound,veilcaster,eclipse_sovereign`: the hound is forced to one then two enrage
  stacks (2 s / 5 s), the caster veils on its own, the Sovereign is forced to eclipse at 27 s and to
  split at 31 s (inside the eclipse, after it leaves L1c's top-edge road).
- `qa/ch5zoo.mjs`: one Chromium at 1280×800 through `qa/withPreview.py --port=4471`; saves
  `docs/ch5-shots/zoo-1280x800.jpg` once the screen is eclipsed, both halves and the hounds are on
  the road and a tower is veiled.

## Gate (Node 22, final tree, hermes)
- `npx tsc --noEmit` ✔ · `npm run lint` ✔
- `npx vitest run`: **148 files passed (2 skipped), 2,008 tests passed, 15 skipped**, including
  `tests/sim/qaBot.test.ts` (QA bot suite with the new invariants) and the new 32 chapter-five tests.
- `npm run sim:balance`: **PASSED (53 levels)**. Stdout is 1,365 lines, SHA-256
  `a875a8d57b8ad4e0476d05eb1417976aa775a359030466dd06606b2708f89ebd`, **byte-identical to the base
  revision af731ac5** (both run on hermes, same node_modules; driver: `git archive` of the base's
  `src`, `scripts`, `package.json`, `tsconfig.json` into /tmp, deleted afterwards).
- `npm run sim:items -- --workers=2`: exit 0, 6 PASS / 0 FAIL in the summary block.
- `npm run sim:difficulty`: 11 PASS / 0 FAIL.
- `npm run build` ✔ (the usual Vite ineffective-dynamic-import and chunk-size advisories).
- Browser QA: `qa/ch5zoo.mjs` (one Chromium, own preview port 4471, stopped afterwards) produced
  `docs/ch5-shots/zoo-1280x800.jpg`: eclipse shade on (alpha 0.42, timer 3.8 s), both Shadow Halves
  and 5 Dusk Hounds on the road, the Veilcaster beside a veiled tower (dark ring; 6 towers range-cut
  by the eclipse). No page or console errors apart from the expected 404s for the pending art.

## Open / doubtful
1. **Balance:** all numbers are first guesses against chapter four; no island uses the foes yet.
   Things to watch in Phase 2/3:
   - 5 tiles of pack radius covers most of a pack on a winding road; a whole pack can be at 2 stacks
     after two kills. If hound waves leak too fast, shrink the radius before the bonus.
   - The veil reach (4.4) is longer than the hexer's (3.6); towers two tiles off the road are in reach.
   - The eclipse hits **every** tower on the map (spec: "bütün kuleler"), with no reach limit.
   - The halves leave together and walk at the same speed 1.2 units apart; splash hits both.
2. **"−30 % range" stacking:** veil and eclipse combine multiplicatively (0.7 × 0.8 = −44 %), not
   additively (−50 %).
3. **Veil targeting:** the caster skips veiled towers (spreads veils) instead of refreshing the same
   tower; the spec only says "not stacking". Stunned casters hold their cast.
4. **Kill credit:** the split is not a kill (no `enemyKilled` for the Sovereign); stats that count
   boss kills by type (achievements, if any are added for the finale) should count the halves.
5. **Placeholder look:** tinted Dreadnought for the Sovereign / halves, tinted hare and hexer for the
   hound and caster. The zoo labels overlap where summoned hounds bunch up. Task B's sprites and an
   island QA on i45 should be checked at real scale.
6. **Not done (out of scope):** chapter-five islands and waves, `chapters.ts` slots, story panels,
   the ending after i45, codex portraits for the new foes (the bestiary uses the placeholder art).
