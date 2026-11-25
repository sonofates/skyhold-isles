# Handoff: chapter four foes (Task A, branch `hermes/sky-ch4-foes`, 2026-11-25)

The Frostveil roster from `docs/chapter4-plan.md` ("Yeni düşmanlar") is in the sim, the data, the 2D
and 3D renderers, the UI, the Turkish texts and the QA bot. **No island uses them yet.** That is
Phase 2 (wave/balance work on i28–i36). I did not touch `src/data/chapters.ts`,
`src/data/levels2d/index.ts` or any island file.

## The three foes

| id | EN / TR | HP | armor | speed | reward | lives | melee (hold / dmg / rate) |
|---|---|---|---|---|---|---|---|
| `rimebeetle` | Rime Beetle / Kırağı Böceği | 150 | 3 | 1.9 | 7 | 1 | 1 / 9 / 1.0 |
| `sledguard` | Sledge Warden / Kalkanlı Kızakçı | 270 + 108 shield | 4 | 1.4 | 11 | 2 | 2 / 20 / 0.75 |
| `glacier_warden` | Glacier Warden / Buzul Muhafızı (boss) | 1800 | 8 | 0.95 | 60 | 6 | 3 / 42 / 0.75, sweep |

How they compare with chapter three and the older bosses:
- Rime Beetle is a mid-weight walker like the Reed Piper (138 HP / armor 1 / 1.95), a bit tougher
  (+12 HP, armor 3). It costs only 1 life because the frost patch is its real threat.
- Sledge Warden's effective pool is 378 (270 HP + 108 shield), between the Kilnback (285, armor 11)
  and the Basalt Golem (340, armor 12). Its armor stays low (4). The shield is what you have to
  beat, and Tesla and Mortar crack it at 2×.
- Glacier Warden sits one step above the Tempest Colossus (1500 / armor 8 / 1.0 / 50 gold). Each
  phase also adds 3 beetles (`currentHpScale`-scaled, 3 gold each, not 7).

These are starting values. The Phase 2 wave/balance agent should tune them with the islands.

## Mechanics (sim)

**Rime Beetle, frost patch** (`src/sim/enemySystem.ts`, `src/sim/combatSystem.ts`)
- When a beetle dies (`hp <= 0`, not a leak) it leaves a `FrostPatch`: `patchRadius` 3.2 world
  units (1.6 tiles), `patchSec` 3, `rateMul` 0.7. Patches live in 24 fixed slots,
  `EnemySystem.frostPatches`. When all slots are full, the patch closest to melting is replaced.
  Each new patch emits `frostPatch`.
- Every tick, `CombatSystem.applyFrostPatches` sets `tower.frostSlow = 1 - rateMul` (0.3) on each
  firing tower within a live patch's radius. It is a flag, not a sum, so overlapping patches never
  stack. Barracks and Beacons are never slowed. The cooldown drain is multiplied by
  `(1 - frostSlow)`, so the tower fires at 0.7× its rate. Range, sell and upgrade are unchanged.
- Patches and the tower slow are cleared on win, loss, skip and dispose (`SimWorld.clearFrost`).

**Sledge Warden, shield pool**
- At spawn it gets `shield = shieldMax = round(maxHp × 0.4)`. `maxHp` is already wave- and
  elite-scaled. The existing `shield` field is reused, so the absorb order, the `shieldAbsorb` /
  `shieldBroken` events, the shield bar and the bubble all work as before.
- `abilityTimer` counts the seconds since the last hit. Every `applyDamage` call resets it, even a
  hit the shield fully absorbs, and so do burn ticks. After 4 s with no hit, the shield refreezes
  to full in one step (`guardShieldRestored` event).
- `applyDamage(e, dmg, ignoreArmor, breaker)` has a new 4th argument. Tesla chains
  (`CombatSystem.fireChainLightning`) and mortar splash (`ProjectileSystem.applySplash` with
  `towerType === 'mortar'`, not hero shots) pass `breaker = true`. Against a guard shield a
  breaker hit uses up `2 ×` the post-armor damage. Overflow goes to HP at the 1:1 rate (for
  example, 10 shield left and 20 breaker damage leaves 15 damage for HP). Ward and Stormwall
  shields still take breaker hits at 1×. This keeps every existing island byte-identical.

**Glacier Warden, boss** (`updateGlacierWarden`)
- It uses the shared `bossPhase` counter and the `bossPhase` / `bossSummon` events, like the
  Tempest. At ≤ 66 % and ≤ 33 % HP, one phase per tick, so a single huge hit still plays both:
  - It freezes the nearest tower not already stunned, at any distance: `stunTimer =
    max(stunTimer, 4)` plus `frostLockTimer = 4`. The `towerFrozen` event drives the beam and
    the ice block. A frozen tower does not fire. Sell and upgrade still work.
    `frostLockTimer` is clamped to `stunTimer` every tick, so Overcharge and Overhaul cleanses
    thaw it too.
  - It summons 3 Rime Beetles 0.9 / 1.35 / 1.8 units behind itself on its lane.
- It is boss-class everywhere: `isBoss` (codex crown, wave banner, music, boss shake, half-length
  stuns), `ENDLESS_UNSCALED_TYPES`, `NEVER_CHAMPION`, endless pool weight +6.
- The ice trail it leaves while walking is visual only (`enemySpecials.ts`).

**Endless** (`src/sim/waveSystem.ts`)
- `hasChapterFourEnemies(level)` decides it. Islands whose story waves contain a chapter-four foe
  use `ENDLESS_CHAPTER4_SPOTLIGHTS`: 8 pairs that cover both new foes. On those islands the 10th,
  20th, … endless wave is led by the Glacier Warden instead of the Tempest. All other islands are
  unchanged. Spotlight tuning: beetle base 3 / +0.6 / max 14; sledge base 2 / +0.4 / max 10.

**Determinism / hashes**
- `computeSimStateHash` and the QA bot hash add the frost state only while it exists (a live
  patch, or a tower with `frostSlow` / `frostLockTimer` > 0). Hashes of every existing run and
  replay are unchanged.

## Records (end to end, as in `docs/handoff-opus-ch2.md`)
- `EnemyType` (`src/core/types.ts`). `CHAPTER4_ENEMY_DEFS` / `CHAPTER4_ENEMY_TYPES` /
  `CHAPTER4_ENEMY_MELEE` (`src/data/enemies.ts`) are spread at the end of `ENEMY_DEFS` so the key
  order of the older roster does not change. `ENEMY_TYPES` order is
  `…chapter two, rimebeetle, sledguard, tempest, glacier_warden, boss`: bosses last, `boss` stays
  last. `ENEMY_MELEE` comes from `src/data/soldiers.ts`.
- Death notes (`DEATH_PITCH`): beetle 600 Hz, sledge 140, warden 76. Sounds reuse existing cues:
  frost patch = brittle crack, refreeze = ward pulse, tower freeze = hex.
- 3D: shard colours (`effectsRenderer.ts`) and three small figurines (`enemyMeshes.ts`). They pass
  `enemyGeometry.test`. Boss checks there now use `isBoss`.
- HUD badges and SVG glyphs (`src/ui/icons.ts`); 3D wave hints (`waveHints.ts`); codex lore
  (`codexData.ts`, blurbs ≤ 90 chars); Turkish name / desc / counter plus the new tags `Frost` →
  Ayaz and `Shielded` → Kalkanlı (`src/i18n/dataTr.ts`).
- The "New" tag in the wave card is automatic (`newFoes2d.ts` tracks seen types).
- Boss literals switched to `isBoss`: `game2d.ts` (death shake), `specialFx.ts` (boss death
  burst), `wavePreview2d.ts`, `waveBanner2d.ts`, `enemyCard2d.ts`. `meleeLook.ts` counts the
  Sledge and Glacier Warden as heavy.

## 2D visuals
- **Frost patch decal:** `src/render2d/frostPatchLayer.ts`. It is drawn from the sim's patch slots
  each frame, so it can never go stale. It uses a new `procTextures.frost` texture (pale rime with
  crystal flecks) plus a pulsing rim at the slowing radius and fades over the last 40 % of the
  patch's life. Ice shards burst out on `frostPatch`.
- **Tower ice icon** (`towerLayer.ts`, new `procTextures.ice` snowflake):
  - a small snowflake beside a tower slowed by a patch;
  - a large one above a tower the Glacier Warden froze. That tower is also tinted pale ice, and
    the icon replaces the jam marker.
  - `markers().frosted` counts them for QA.
- **Sledge shield:** the existing bubble and bar, recoloured: ice-white bubble tint and a pale fill.
  Refreeze has its own burst.
- **Glacier Warden:** an icy ground ring that gets stronger with each phase, a frost nova at both
  phases, an ice beam to the frozen tower, and the ice-flake trail.
- `debugState()`: `fx.frostPatches` (decals drawn), `fx.events.frostPatch`,
  `.guardShieldRestored`, `.towerFrozen`, and per tower `frostSlow` / `frozen`.

## Placeholder art (until Task B lands)
- `public/art2d/manifest.json` now has `enemies.rimebeetle | sledguard | glacier_warden` and their
  `enemyMap` entries. They follow the file naming the pipeline delivers:
  - `enemy-<id>.webp` and `enemy-<id>-back.webp`;
  - `anim/<id>-walk-{down,up,side}.json`, `anim/<id>-attack.json`, `anim/<id>-death.json`.
- Each entry also has a manifest **`fallback`**, the existing mechanism for pending art:
  - beetle → tinted `kilnback` × 0.8;
  - sledge → tinted `warden` × 0.95;
  - Glacier Warden → tinted `tempest` × 1.05.
- `?artcheck=1`, the loader notes ("art pending → tinted …") and the zoo labels (`rimebeetle →
  kilnback`) mark the placeholders clearly.
- **The real art takes over with no code change** as soon as the files exist: `resolveEnemyArt`
  only follows a fallback when the type's own files are missing (tested).
- **For Task B:** keep the same keys and file names. If your heights, anchors or strides differ,
  edit my three entries; the `fallback` field can stay or go. Expect a trivial merge on
  `manifest.json`.
- Side effect until then: on a page that shows these foes, the browser logs 404s for the missing
  files. The loader handles them and falls back. Only the zoo and tests show these foes today.

## Tests and QA tooling
- **New `tests/sim/chapterFourEnemies.test.ts` (25 tests).**
  - Roster wiring: defs, melee, bestiary slot, boss-class lists.
  - Lore, badge, glyph and Turkish text per foe.
  - Manifest art plus its fallback, and the real art winning once files exist.
  - Frost patch: the patch event; slow inside the radius, none outside; no stacking; lifts on
    expiry; barracks and beacon exempt; no patch on a leak. Over a 30 s window a tower inside a
    patch fires 0.70 ± 0.05 × as often as one outside.
  - Sledge: 40 % pool including elite scaling; absorb-first; 2× breaker; overflow and armor;
    wards at 1×; refreeze after 4 s, with any hit restarting the count; steady damage keeps it
    down. Tesla and mortar towers hit as breakers, cannon and archer do not.
  - Glacier Warden:
    - a freeze plus 3 beetles at each threshold, nearest-unfrozen tower first;
    - no repeat inside a phase;
    - a big hit through both thresholds plays both phases;
    - a frozen tower does not fire, can still be upgraded and sold, and Overcharge thaws it.
  - A **test-only level** built on I16's map with four waves of the new foes (never registered).
    The full SimWorld run finishes with more than 10 patches, slowed towers, shield absorbs, both
    freezes and both phases, and the same state hash on a second run. Endless on that level
    spotlights both new foes and the Glacier Warden leads the 10th wave; legacy islands keep the
    Tempest.
- `tests/sim/chapterTwoActivation.test.ts`: the "only chapter enemies carry death sheets" roster
  now also lists the three chapter-four keys, which are declared ahead of their art.
- QA bot:
  - Invariants: `frostSlow` in [0, 1), `frostLockTimer ≤ stunTimer`, patch finiteness and
    lifetime, and no patch or slow left after a run.
  - The runner flags chapter-four endless waves that never spawn a chapter-four foe (like the
    chapter-two check).
- `?zoo=1&types=a,b` shows only the listed types (`main2d.ts`, `debugScenes.ts`), with forced
  specials:
  - the beetle dies at 8 s (patch);
  - the sledge loses half its shield at 3 s;
  - the Glacier Warden is forced to its phases at 22 s and 30 s.
- `qa/ch4zoo.mjs`: one Chromium at 1280×800 through `qa/withPreview.py --port=4467`. It saves
  `docs/ch4-shots/zoo-1280x800.jpg` (all three foes, a frost patch, a sledge shield, tesla chains)
  and `zoo-1280x800-freeze.jpg` (the frozen tower under the big snowflake, beetles summoned by
  the boss). No page or console errors apart from the expected 404s for the pending art.

## Gate (Node 22, final tree, hermes)
- `npx tsc --noEmit` ✔ · `npm run lint` ✔
- `npx vitest run`: **146 files passed (2 skipped), 1,895 tests passed, 15 skipped**. That includes
  `tests/sim/qaBot.test.ts` (QA bot suite with the new invariants).
- `npm run sim:balance`: **PASSED (44 levels)**. Stdout is 1,172 lines, SHA-256
  `b972847f29a5b6007dd83bfaf7db5044a7813f58631b1457e5517b88ec44de57`, **byte-identical to the
  base revision 355d289b** (both run on hermes, same node_modules).
- `npm run sim:items -- --workers=2`: exit 0, 7 PASS / 0 FAIL.
- `npm run sim:difficulty`: exit 0, 9 PASS / 0 FAIL.
- `npm run build` ✔ (the usual Vite ineffective-dynamic-import advisories).
- Browser QA: `qa/ch4zoo.mjs` (one Chromium, own preview port 4467, stopped afterwards) produced
  the two shots in `docs/ch4-shots/`.

## Open / doubtful
1. **Balance:** all numbers are first guesses against chapter three. No island uses the foes yet,
   so the campaign sims cannot test them. Specific things to watch in Phase 2:
   - The Glacier Warden's freeze has unlimited reach. The spec says "nearest tower"; the reach of
     the Tempest's thunderclap (7.6) was another option.
   - The beetle patch covers 1.6 tiles of radius, so towers right on the road get slowed.
2. **"30 % slower"** is implemented as fire rate × 0.7 (cooldown drain × 0.7), not cooldown × 1.3
   (≈ rate × 0.77).
3. **Breaker scope:** only tower tesla chains and tower mortar splash. Hero Thunder Call, cannon
   splash and meteor are not breakers. The 2× applies only to the Sledge shield. Wards and
   Stormwall are unchanged, which keeps the old balance byte-identical.
4. **Placeholder look:** a tinted kilnback, warden and tempest, so the beetle still reads as a
   tortoise. The zoo frames show the Glacier Warden on L1c's top road, partly under the top HUD
   (that map's road runs along the top edge). Task B's real sprites, and an island QA in Phase 2,
   should be checked at real scale.
5. **Not done (out of scope):** chapter-four islands and waves, `chapters.ts` slots, story
   panels, codex portraits for the new foes (the bestiary uses the placeholder art's frame).
