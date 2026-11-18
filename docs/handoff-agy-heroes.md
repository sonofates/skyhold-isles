# Handoff — 2D Heroes: Sim, Data, Skill Trees, Global Abilities & Progression (`agy-heroes`)

- **Branch:** `hermes/skyhold-heroes-sim` (base: `art-2d` @ `9598254`)
- **Date:** 2026-11-18
- **Scope:** Backend / simulation / data / persistence / pure helpers only (`docs/hero-spec.md`). No visual UI, CSS, HUD/buildRing edits, render layers, art, manifest, i18n, or `tools/**` changes.

---

## 1. What Was Built

1. **Five Heroes & 13-Node Skill Trees (`src/data/heroes.ts`, `src/core/types.ts`):**
   - Authored all 5 original-IP heroes from `docs/hero-spec.md`:
     - **`bran` — Bran Ironoak** (*Shield Knight*, melee blocker, `holdCap: 2`, starter unlocked): **Bulwark** (blocked foes deal less melee damage), **Shield Bash** (cone damage + stun), **Rally Banner** (nearby barracks soldiers gain armor + melee damage).
     - **`wren` — Wren Skyfletch** (*Sky Ranger*, long-range archer, unlocks after 2 cleared islands): **Keen Eye** (seeded-RNG critical arrows vs flyers), **Volley** (AoE rain of arrows hitting ground & flyers), **Hunter's Mark** (marked target takes amplified damage from all towers & hero).
     - **`mira` — Mira Emberwisp** (*Ember Mage*, splash fire caster, unlocks after 4 cleared islands): **Kindling** (hits ignite enemies with armor-ignoring burn), **Fire Ring** (burst + persistent burning ground zone), **Wisp Burst** (line dash scorching ground & flying foes).
     - **`tobb` — Tobb Gearwright** (*Master Tinkerer*, builder/support, unlocks after 7 cleared islands): **Tinker** (nearby towers attack faster while Tobb lives), **Deploy Gizmo** (places temporary brass auto-turret), **Overhaul** (cleanses tower stun, instantly reloads, and boosts fire rate).
     - **`sela` — Sela Tidecaller** (*Storm Priestess*, control/healer, unlocks after 10 cleared islands): **Calm Waters** (heals nearby barracks soldiers every second), **Undertow** (AoE tide damage + heavy slow), **Thunder Call** (chain lightning across multiple foes).
   - Each hero has **3 branches × 4 linear tiers (12 nodes) + 1 tier-5 Capstone** requiring **any 2 of the 3 branches at Tier 3** (`minPrerequisites: 2`). Total tree cost is `21` points vs `19` skill points earned at Level 20 (`level - 1`), making max-level builds a real specialization choice and world-map `respec` meaningful.
   - Pure stat resolver `resolveHeroStats(heroId, level, unlockedSkills)` combines base stats, Level 1–20 growth, and strongly-typed `HeroEffectPatch` modifiers. Tuned empirically via `npm run sim:heroes` so a Level-1 hero matches roughly `1× Tier-2 Barracks` (`~500–730` marginal benchmark damage vs `648`) and a Level-20 hero matches roughly `2× Tier-3 Towers` (`~5,600–7,780` marginal benchmark damage + control/support vs `7,642`).

2. **Deterministic Hero Simulation & Ground Road Graph (`src/sim/groundGraph.ts`, `src/sim/heroSystem.ts`, `src/sim/world.ts`):**
   - **`GroundGraph`**: builds an undirected road graph from `groundPath` + `extraGroundPaths` with cross-lane junction edges so `world.commandHeroMove(x, z)` routes heroes along roads and across merge junctions instead of cutting over chasms or plots; clamps far off-road taps within `HERO_RULES.maxOffRoadDist` (`1.2u`) of the nearest road.
   - **`HeroSystem`**: spawns at the castle gate threshold (`groundGraph.castleSpawnPoint()`), handles deterministic movement, melee holding (`e.heroBlockers` cooperating additively with `SoldierSystem` `e.blockers` without Lease collisions), ranged projectile shots via `ProjectileSystem.spawnHeroProjectile`, enemy melee counter-strikes, death & castle respawn countdown, out-of-combat HP regeneration, all 5 passives, all 10 active skills + capstone extras, and in-run XP tracking. Uses `SeededRng` exclusively (zero `Math.random`).
   - Emits all 7 render/UI events on `EventBus` (`src/core/eventBus.ts`): `heroMoved`, `heroAttack`, `heroHit`, `heroSkillCast`, `heroDied`, `heroRespawn`, `heroXpGained`.

3. **2D Global Active Abilities (`src/sim/world.ts`):**
   - Enabled **Meteor Strike** and **Overcharge** on 2D plot maps once Wave 1 starts (still honoring `mods.abilitiesDisabled` and `mods.abilityCooldownMul`).
   - Exposed `world.castAbility(id, x, z)`, `world.getAbilityState(id)`, and `world.getAbilitiesState()` (plus screen/world wrappers on `Game2D`).

4. **Persistent Hero Progression, Migration & 2D Plumbing (`src/render2d/heroes2d.ts`, `src/render2d/ui/progress2d.ts`, `src/render2d/game2d.ts`, `src/render2d/main2d.ts`):**
   - Added optional `heroes?: HeroSaveData` to `ProgressData`, migrated & sanitized automatically in `loadProgress2D`, `saveProgress2D`, and `remapProgress` (legacy v1/v2 saves initialize cleanly; corrupted skill lists refund to `[]` without losing XP).
   - Extended `applyRunResult2D` / `recordRunResult2D` (`RunOutcome2D`) to record persistent hero XP at run end across wins, losses, Daily Squalls, and Endless runs, returning `result.hero: HeroRunXpRecord`.
   - Wired `main2d.ts` & `Game2D` plumbing: passes selected hero (`lastHero(progress)` by default, or `?hero=<id>|none` and `?herolevel=<1..20>` for QA) into `SimWorld`, records run XP on end, and exposes command/cooldown methods on `Game2D`.

5. **Hero Balance Report (`scripts/heroBalance.ts`, `package.json`):**
   - `npm run sim:balance` stays **byte-identical** across all 641 output lines (33/33 levels).
   - Added `npm run sim:heroes` printing the unit-equivalence benchmark plus all 5 heroes at Level 1 and Level 20 on `l1c`, `i05`, `i10`, and `i16` (stationed at the merge point, casting skills on cooldown).

---

## 2. Files Touched

| Area | Files |
|---|---|
| Core Types & Events | `src/core/types.ts`, `src/core/eventBus.ts` |
| Hero Data | `src/data/heroes.ts` *(new)* |
| Simulation | `src/sim/groundGraph.ts` *(new)*, `src/sim/heroSystem.ts` *(new)*, `src/sim/world.ts`, `src/sim/entities.ts`, `src/sim/enemySystem.ts`, `src/sim/soldierSystem.ts`, `src/sim/combatSystem.ts`, `src/sim/projectileSystem.ts`, `src/sim/targeting.ts` |
| 2D Progression & Plumbing | `src/render2d/heroes2d.ts` *(new)*, `src/render2d/ui/progress2d.ts`, `src/render2d/game2d.ts`, `src/render2d/main2d.ts` |
| Balance Script | `scripts/heroBalance.ts` *(new)*, `package.json` |
| Tests | `tests/sim/heroes.test.ts` *(new, 19 tests)*, `tests/render/heroes2d.test.ts` *(new, 6 tests)*, `tests/render/modifiers2d.test.ts` |
| Docs | `docs/handoff-agy-heroes.md` *(new)* |

*(Strictly untouched: `src/render2d/ui/**` except `progress2d.ts`, `hud.ts`, `buildRing.ts`, CSS, render layers, art, `public/art2d/manifest.json`, `src/i18n/**`, `tools/**`, and non-hero `src/data/**`.)*

---

## 3. Gate Numbers

| Check | Baseline (`9598254`) | Final (`hermes/skyhold-heroes-sim`) |
|---|---|---|
| `npx tsc --noEmit` | PASS (0 errors) | **PASS (0 errors)** |
| `npm run lint` | PASS (0 errors) | **PASS (0 errors)** |
| `npm test` | 84 files passed (1 skipped) · **1,102 passed** (11 skipped) | **86 files passed** (1 skipped) · **1,127 passed** (11 skipped) |
| `npm run sim:balance` | **PASSED — 33/33 levels** | **PASSED — 33/33 levels (`diff -u` 0 bytes changed)** |
| `npm run sim:heroes` | n/a | **PASS** (`l1c`, `i05`, `i10`, `i16` × 5 heroes × L1 & L20) |
| `npm run build` | PASS | **PASS** |

---

## 4. Exact API for the UI & Renderer Agents

### A. World Map, Island Briefing & Skill Tree UI (`src/render2d/heroes2d.ts` + `src/render2d/ui/progress2d.ts`)

```ts
import {
  heroRoster,          // (progress, levels?) => HeroRosterEntry[] (all 5 heroes in order)
  lastHero,            // (progress, levels?) => HeroId ('bran' default)
  selectHero,          // (progress, heroId, levels?) => ProgressData | null (pure)
  heroLevel,           // (xp) => 1..20
  heroLevelProgress,   // (xp) => { level, maxLevel, xp, currentLevelXp, nextLevelXp, xpIntoLevel, xpForNextLevel, fraction, totalSkillPoints }
  xpForHeroLevel,      // (level) => cumulative XP threshold
  nodeUnlockStatus,    // (progress, heroId, nodeId, levels?) => 'unlocked' | 'available' | 'insufficientPoints' | 'lockedPrereq' | 'heroLocked' | 'invalid'
  canUnlockNode,       // (progress, heroId, nodeId, levels?) => boolean
  applyNode,           // (progress, heroId, nodeId, levels?) => ProgressData | null (pure)
  respec,              // (progress, heroId, levels?) => ProgressData (pure, free)
  xpForRun,            // ({ won, stars, enemiesKilled, wavesCleared, waveReached }) => number
} from '../heroes2d.ts';

// Storage-persisting convenience wrappers in src/render2d/ui/progress2d.ts:
import {
  loadProgress2D,
  saveProgress2D,
  selectHero2D,        // (heroId) => ProgressData | null
  unlockHeroNode2D,    // (heroId, nodeId) => ProgressData | null
  respecHero2D,        // (heroId) => ProgressData
} from './progress2d.ts';
```

- **Briefing hero picker:** iterate `heroRoster(progress)`. Each `HeroRosterEntry` provides `{ id, def, unlocked, unlockRule, selected, xp, level, xpProgress, unlockedSkills, skillPointsEarned, skillPointsSpent, skillPointsAvailable, resolvedStats }`. Picking an unlocked hero calls `selectHero2D(id)` (and optionally appends `&hero=<id>` or relies on `main2d.ts` reading `lastHero(loadProgress2D())` automatically).
- **Skill-tree connector lines:** iterate `def.skillTree` (`13` nodes: `branch` in `def.branches[0..2].id` for tiers `1..4`, and `isCapstone === true` at `tier: 5`). Every node's `node.prerequisites` is `readonly string[]` of parent node IDs; when `node.minPrerequisites` is set (`2` on capstones), show `"Requires 2 of 3 Tier-3 skills"`.
- **End-of-run XP callout:** `routing.recordRunOutcome(...)` in `main2d.ts` now returns `result.hero?: HeroRunXpRecord` (`{ heroId, xpGained, previousXp, newXp, previousLevel, newLevel, leveledUp, skillPointsGained }`).

### B. In-Game HUD, Tap Input & QA Params (`src/render2d/game2d.ts`)

`Game2D` exposes world-space `(worldX, worldZ)` and CSS-pixel screen-space `(screenX, screenY)` methods:

```ts
// 1. Live HUD polling (per frame in syncHud):
const hero = game.getHeroState(); // HeroRuntimeState | null
// hero = {
//   heroId, name, level, state ('idle'|'moving'|'engaging'|'fighting'|'dead'),
//   alive, x, z, yaw, hp, maxHp, armor, respawnRemaining, respawnMax,
//   runXp, kills, totalDamageDealt,
//   skills: [skill0, skill1] // each: { slot: 0|1, id, name, targetMode: 'self'|'point', cooldown, maxCooldown, ready, usable, range, radius, durationSec }
// }

const abilities = game.getAbilitiesState(); // readonly [meteorState, overchargeState]
// each AbilityRuntimeState = {
//   id: 'meteor' | 'overcharge', name, cooldown, maxCooldown,
//   ready, usable, requiresTarget, radius, activeRemaining, disabled
// }

// 2. Player commands:
game.commandHeroMoveAtScreen(screenX, screenY);       // or game.commandHeroMove(worldX, worldZ)
game.castHeroSkill(slot);                             // for targetMode === 'self' (e.g. Bran Rally Banner) or auto-aim
game.castHeroSkillAtScreen(slot, screenX, screenY);   // for targetMode === 'point' (slot: 0 | 1)
game.castAbility('overcharge');                       // instant global cast
game.castAbilityAtScreen('meteor', screenX, screenY); // targeted global cast
```

- **Query params already wired in `main2d.ts`:**
  - `2d.html?level=l1c&hero=wren` — force a specific hero (`bran`, `wren`, `mira`, `tobb`, `sela`)
  - `2d.html?level=l1c&hero=sela&herolevel=20` — test any hero at Level 20 with its canonical 19-point skill build
  - `2d.html?level=l1c&hero=none` — run without a hero

### C. Renderer Layer & FX Events (`src/core/eventBus.ts` + `game.world`)

- **Direct per-frame interpolation (`HeroLayer`):**
  - Read `const h = game.world.hero` (`null` when no hero): interpolate `x = h.prevX + (h.x - h.prevX) * alpha`, `z = h.prevZ + (h.z - h.prevZ) * alpha`, `h.yaw`, `h.state`, `h.hitFlashTimer`, `h.rallyBannerTimer`.
  - Temporary entities: `game.world.heroSystem.gizmos` (Tobb's active brass auto-turrets: `{ id, x, z, yaw, remainingSec, boostTimer }`) and `game.world.heroSystem.fireRings` (also already emits `groundZone` `'fire'`).
  - Ranged hero & Gizmo shots already spawn real `ProjectileEntity` items in `world.projectilePool` (`fromHero: true`), so `ProjectileLayer` already draws them at hero chest height!
- **EventBus events (`GameEventMap`):**
  - `heroMoved`: `{ heroId, x, z, targetX, targetZ, waypoints }`
  - `heroAttack`: `{ heroId, mode: 'melee' | 'ranged', x, z, targetX, targetZ, targetEnemyId, yaw, damage, crit, cleave }`
  - `heroHit`: `{ heroId, enemyId, damage, hp, maxHp, x, z }`
  - `heroSkillCast`: `{ heroId, slot, skillId, x, z, targetX, targetZ, radius, duration }`
  - `heroDied`: `{ heroId, x, z, respawnSec }`
  - `heroRespawn`: `{ heroId, x, z, hp, maxHp }`
  - `heroXpGained`: `{ heroId, amount, totalRunXp, source: 'kill' | 'wave' | 'victory', x, z }`

---

## 5. Assumptions & Open Questions for the Owner

1. **Re-enabling `Silent Skies` (`abilitiesDisabled`) & `Quickcast Runes` in 2D modifier filtering (`src/data/runModifiers.ts`):**
   - `SimWorld` now allows casting `Meteor Strike` and `Overcharge` on 2D plot maps and enforces `mods.abilitiesDisabled` and `mods.abilityCooldownMul`.
   - Per our file boundary (`src/data/**` only for hero additions), `hasModifierEffectIn2D` in `src/data/runModifiers.ts` was left untouched (so `Silent Skies` stays filtered out of `CHALLENGE_IDS_2D` until the UI agent wires the 2D Meteor/Overcharge HUD buttons; otherwise players could earn a free `Silent Skies` badge before the buttons are clickable). **Owner / UI follow-up:** once the HUD buttons for Meteor & Overcharge are live, flip `hasModifierEffectIn2D` to return `!isNeutralRun(combineRunModifiers(patch))` (note this adds `silentSkies` as the second challenge on Master islands `i08`–`i16`).
2. **Hero Unlock Milestones & Mobile Monetisation:**
   - Implemented data-driven `HeroUnlockRule` placeholders matching `docs/hero-spec.md`: `bran` free (`starter`), `wren` after 2 cleared islands, `mira` after 4, `tobb` after 7, `sela` after 10, with optional `iapProductId?: string` on `HeroUnlockRule` left unwired pending owner mobile IAP decision.
3. **Localisation (`src/i18n/`):**
   - English names and descriptions live on `HERO_DEFS` (`src/data/heroes.ts`). When the UI agent wires hero cards and skill-tree tooltips, Turkish translations should be added to `src/i18n/dataTr.ts` + `src/i18n/en.ts` / `tr.ts`.
