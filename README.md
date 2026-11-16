# Skyhold Isles

A low-poly isometric **floating island diorama** tower defense game built with **TypeScript**, **Three.js**, **Vite**, and a plain **HTML/CSS DOM UI overlay** — featuring 100% procedural flat-shaded 3D meshes, GPU vertex-shader water waves, fixed 60 Hz deterministic simulation, and synthesized Web Audio sound effects with zero external assets.

## Highlights

- **Cozy Floating Island Diorama (`src/render/`)**:
  - True isometric `OrthographicCamera` (45° yaw, `arcsin(1/√3)` ≈ 35.26° tilt) with smooth zoom toward cursor, pan (drag / WASD / two-finger touch), and eased 90° camera rotations (`Q`/`E` or HUD buttons).
  - Stepped terrain slabs, dirt rims, cliff strata & upside-down rocky spires, drifting satellite islets and clouds, animated GPU-wave lagoon water (`onBeforeCompile`), and deterministic seeded-RNG flora (`trees`, `rocks`, `bushes`, `flowers`, goal sanctuary crystal).
  - Central 10-color flat-shaded palette (`src/data/palette.ts`) shared consistently across 3D materials, sky gradient, fog, and UI theme.
- **Tactical Gameplay (`src/sim/`, `src/data/`)**:
  - **5 Modular Towers (3 visual + stat tiers each)**:
    1. **Archer Tower (`1`)**: Rapid single-target arrows; hits ground & aerial units.
    2. **Cannon (`2`)**: Parabolic artillery shells with area splash falloff (ground only).
    3. **Frost Tower (`3`)**: Chilling bolts applying stack-capped slow and icy tint; hits ground & aerial units.
    4. **Tesla Tower (`4`)**: Flickering chain lightning jumping across up to `N` nearby targets with damage falloff; hits ground & aerial units.
    5. **Mortar (`5`)**: Long-range siege shells with high splash damage and a minimum range deadzone (ground only).
  - Per-tower **First / Last / Strongest / Closest** targeting modes, upgrade stat diffs, and 70% sell refunds.
  - **7 Enemy Archetypes**: Raider Grunt, Zephyr Runner, Iron Brute (flat armor damage reduction), Sky Skimmer (dedicated `flightPath` aerial lane), Grove Mender (periodic AoE heal pulse), Cinder Splitling (splits into two fast hatchlings on death), and the Skyhold Dreadnought Boss (summons escorts, pulses to jam nearby towers).
  - **9 Islands**, each with its own look (palette, tree mix, landmarks, sky, ambient life): *Sunlit Meadow* (cottage & wildflowers), *Twin-Bridge Cay* (harbour docks), *Highland Citadel* (snow pines, waterfalls, peaks), *Emerald Stepping Stones* (crystal groves), *Windmill Switchback* (golden fields & windmills), *Crescent Lagoon* (atoll with a lighthouse), *Skybridge Gauntlet* (stone sky-bridges & forts), *Sunken Bastion* (half-drowned ruins), and *Grand Skyhold* (marble citadel) — star ratings (1–3★), unlock progression persisted in `localStorage`, named waves, wave composition previews, and early-call gold bonuses.
  - **Abilities**: *Meteor Strike* (`F`, targeted armor-piercing AoE + slow) and *Overcharge* (`G`, cleanses jammed towers and boosts fire rate), on cooldowns that tick during combat.
  - **Auto-wave, Endless & MVP**: optional auto-wave (`X`), *Continue Endless* after a victory with best-wave tracking, and an end-of-run MVP tower summary.
- **Decoupled Architecture & High-Scale Performance**:
  - **Zero-Three/DOM Core**: `src/core/`, `src/sim/`, and `src/data/` never import `three`, `window`, or `document` (enforced by ESLint `no-restricted-imports` / `no-restricted-globals` and verified in Node via Vitest + the headless balance simulator).
  - **Fixed 60 Hz Simulation + Render Interpolation**: Game speed (`1x` / `2x` / `3x`) steps more fixed ticks per frame while renderers interpolate between `prevX/Y/Z/Yaw` and current state.
  - **Pooling & Instancing**: Pooled simulation entities (`ObjectPool`), spatial hash grid (`SpatialHashGrid`) for range/splash/chain queries, `InstancedMesh` rendering for enemies/decor/shards/particles/rings, pooled WebGL geometries/materials with clean level-switch disposal, and a 60-slot floating damage/gold popup DOM pool with 150 ms per-enemy damage merging.

---

## Controls

### Desktop
- **Pan Camera**: Left/Middle mouse drag, or `WASD` / Arrow keys
- **Zoom**: Mouse wheel (zooms toward cursor)
- **Rotate 90°**: `Q` / `E` or HUD rotation arrows
- **Build Tower**: Click bottom bar card or press `1`–`5`, then click a valid grass tile
- **Cancel / Deselect / Pause**: Right-click or `Esc`
- **Pause / Speed**: `Space` (toggle pause) or HUD speed buttons (`1x`, `2x`, `3x`)
- **Selected Tower**: `U` upgrade, `T` cycle targeting, `Delete` / `Backspace` sell (press twice to confirm)
- **Abilities / Waves / Routes**: `F` Meteor, `G` Overcharge, `X` auto-wave, `R` pin enemy routes
- **Inspect Enemy**: Hover over any ground or flying enemy

### Touch / Mobile & Tablet
- **Place / Select**: Tap tower card then tap tile; tap placed tower for upgrade/sell/targeting panel
- **Pan & Zoom**: Two-finger drag to pan, pinch gesture to zoom
- **Rotate**: HUD rotation arrow buttons

### Developer Debug Overlay (`?debug`)
Append `?debug` to the URL (e.g., `http://localhost:5173/?debug`) to open live telemetry (FPS, frame time, draw calls, triangles, geometry count, active pools) and debug controls (add gold, set lives, skip to wave, spawn N enemies of any type, instant win/lose, toggle all tower range rings).

---

## Project Architecture

```text
src/
├── core/         # Pure TS: EventBus, SeededRng, ObjectPool, FixedStepLoop, shared types
├── data/         # Pure TS balance & definitions: palette, balance, towers, enemies, levels/*
├── sim/          # Pure TS 60 Hz simulation: world, grid, path, spatialHash, systems
├── platform/     # Browser integration: GameSession, InputManager, GameLoop, localStorage
├── render/       # Three.js diorama: SceneManager, CameraController, MapBuilder, Meshes, FX
├── ui/           # Plain DOM overlay UI: HUD, BuildBar, TowerPanel, Menus, Modals, DebugPanel
└── audio/        # Web Audio API synthesizer (blips, cannons, frost, zaps, fanfare)
scripts/
└── balanceSim.ts # Headless Node balance runner executing scripted build orders per island
tests/
├── core/         # Fixed-step loop accumulator tests
├── render/       # Tower picking & camera raycast tests (Three.js in Node)
└── sim/          # Vitest suite covering targeting, combat math, waves, abilities, & Node smoke test
```

---

## Scripts

```bash
npm install
npm run dev          # Start Vite dev server
npm run build        # Typecheck (tsc) + production bundle (vite build)
npm run test         # Run Vitest unit & headless Node smoke tests
npm run lint         # Run ESLint (enforces strict Three/DOM isolation in sim/data/core)
npm run sim:balance  # Run headless simulation for all 9 levels and print per-wave balance stats (`-- --levels=3,6` to filter, `-- --robust` for an HP-scale sensitivity table)
npx tsx scripts/previewMap.ts all   # Headless PNG previews of every island (no browser needed; see docs/overnight/)
```

---

## Extending the Game

### Adding a New Level
1. Copy `src/data/levels/level1.ts` into a new file (e.g. `src/data/levels/level4.ts`).
2. Define `cols`, `rows`, ASCII `layout` (`~` empty void, `.` buildable grass, `T` tree/decor blocked, `S` spawn, `P` road, `G` goal), `pathWaypoints`, `flightPath`, `waves`, and optional `scriptedBuildOrder`.
3. Register the level in `src/data/levels/index.ts`.
   Optionally give it a visual identity in `src/render/islandThemeTable.ts` (keyed by level `id`; unknown ids use the default look). Set pieces may only sit on `T` tiles or open water.
4. Run `npm run sim:balance` to verify win/loss tuning and gold curves.

### Adding a New Tower
1. Add the key to `TowerType` in `src/core/types.ts`.
2. Add base + Tier 1–3 stats in `src/data/towers.ts` (`TOWER_DEFS` and `TOWER_TYPES`).
3. Add 3 procedural geometry builders in `src/render/towerGeometries.ts` and register them in `src/render/towerMeshes.ts`.
4. Add an SVG card icon in `src/ui/icons.ts`.

### Adding a New Enemy
1. Add the key to `EnemyType` in `src/core/types.ts`.
2. Add stats in `src/data/enemies.ts` (`ENEMY_DEFS` and `ENEMY_TYPES`).
3. Add procedural geometry/shard color mapping in `src/render/enemyMeshes.ts` and `src/render/effectsRenderer.ts`, plus badge metadata in `src/ui/icons.ts`.
