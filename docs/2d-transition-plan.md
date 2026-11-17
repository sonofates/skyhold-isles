# Skyhold Isles → 2D painted: transition plan

Status: approved with changes, 2026-11-17. Decisions marked ✅ were made by the owner. The rest are proposals.

**Branching:** ✅ the Three.js build stays on `main` and live until the P0 gate passes. All 2D work stays on `art-2d`.

## Decisions so far

- ✅ **Art direction:** 2D hand-painted "storybook" style (mockup A).
  - Saturated warm colours, thick dark outlines, soft cel shading, chunky proportions.
  - Reference files: `design/art-direction/mockup-A.png` and the generated set in `design/art-2d/out/`.
- ✅ **Map layout:** L1c, a steep near-top-down 3/4 camera.
  - The playfield fills the screen.
  - A long winding road, two entrances that merge, about 16 round stone build plots, almost no dead space.
  - Reference files: `design/art-2d/out/map-L1c.png` and the prototype `design/art-2d/proto/?map=L1c`.
- ✅ **Products:**
  - **Steam:** about $10, a fuller version with a story campaign.
  - **Mobile:** a simpler free version with in-app purchases.
  - One codebase.
- ✅ **Original IP.** We use the genre and the 2D-painted readability, but every character, UI frame, map and name is our own.
  - Never put a specific existing game in a prompt as the look to copy.
- ✅ **Camera:** L1c's near top-down gameplay plane is locked. Depth comes from the painting (3/4-view buildings, towers and props), not from camera tilt.
  - No rotation. Zoom and pan only on phones.
  - This also removes the old "tower hides the tiles behind it" problem.
- ✅ **One map image per level, no phone variants.**
  - Every map is painted once at about 19.5:9.
  - All plots, paths and entrances sit inside a centred 16:9 safe area.
  - Desktop crops the edges; phones show the full width.
  - The map editor shows the safe-area overlay.
- ✅ **Scope:**
  - No hero unit for launch.
  - Barracks/soldier tower is planned for P1 and treated as a real sim feature, not a small extension: blocking, melee, rally point, respawn, new tests, a balance retune.
  - Steam first, mobile after Steam.
  - The name stays Skyhold Isles until the end of P1.
- **Towers on fixed plots.** Plots are part of the painted map, which replaces free tile placement.

## What stays and what changes in the code

| Layer | Fate |
|---|---|
| `src/sim`, `src/data`, `src/core` (deterministic 60 Hz sim, waves, enemies, towers, balance sim, 700+ tests) | **Stays.** Small extensions only. |
| `scripts/balanceSim.ts` | Stays. Numbers are retuned for plot-based maps. |
| Campaign, stars, workshop, daily, codex, onboarding (save v2) | Stays. The screens are reskinned. |
| `src/render/**` (Three.js) | **Replaced** by a 2D renderer. |
| `src/ui/**` (DOM HUD) | Restyled with the painted UI kit. The DOM stays where it is practical (menus, codex); in-play HUD pieces are drawn in-world. |

**Sim changes (P0):**
- Add `plots: {x, z}[]`, path polylines in world units and `entrances` to `LevelDef`, alongside the old grid.
  - `canPlaceTower` checks the plot list when a level has plots.
  - Paths come from the traced polyline, not from tile waypoints.
- Ranges and speeds are in world units, so the balance windows hold after one retune pass.
- Old grid levels keep working until every island is migrated.

**Renderer:** PixiJS v8 (WebGL with a Canvas fallback). It batches sprites and supports sprite-sheet animation, filters (hit flash, tint) and particles.
- Throwaway prototype: Canvas2D (`design/art-2d/proto`). It already shows the look in motion at 120 fps-level cost.

## Art pipeline (per asset family)

1. **Style lock.**
   - Mockup A plus a palette and line-weight sheet. Every generation passes these as reference images.
   - Generate in batches, so each family comes from one session with the same references (consistency).
2. **Maps** (Codex image_gen with the style refs).
   - One image per level at about 19.5:9 (for example 2048×945). Gameplay stays inside the centred 16:9 safe area. No separate phone variant.
   - Then trace the path, plots and entrances in a small **map editor page**: click to place, export JSON, overlay check, the way Kaginawa's editor works.
3. **Towers:**
   - 7 towers × 3 tiers = 21 sprites, plus attack frames: archer draw, cannon recoil, mage crystal pulse.
   - Source: Codex on magenta → key → atlas.
4. **Enemies:**
   - Codex design sheet on magenta → **Veo** walk cycles, 2 directions (toward camera, away from camera), mirrored for the other 2 → frame extraction → key → atlas. This is the Kaginawa ink-sprite pipeline, adapted.
   - Plus hit and death frames.
   - Scope: 15 types + elites (tint/overlay) + 2 bosses.
5. **FX:** projectiles, impacts, splash and frost rings, coin pop. These are painted sprite strips.
6. **UI kit:**
   - Plaque, banner, buttons, horn, icons, build ring, tower panel, dialog frame, level cards, campaign map.
   - Diegetic: no web pills.
7. **Story (Steam):**
   - Painted panels with short Veo motion and dialog boxes.
   - A painted campaign world map.

**Rough counts:** 16 maps, about 17 animated characters × ~4 clips, 21 tower sprites plus attack frames, about 20 FX strips, about 40 UI pieces.

## P0 go/no-go gate ✅

The gate is written to `docs/p0-gate.md`. Work stops there until the owner decides; P1 does not start automatically. It contains:
- Side-by-side screenshots and a short screen recording of L1c in the Pixi renderer at real in-game size, on desktop and on a mid-range phone viewport.
- Measured pipeline cost (hours and credits) for:
  - one map (generation + tracing in the editor),
  - one tower (3 tiers),
  - one Veo-animated enemy,
  - one cheaply animated enemy.
- The extrapolated total cost of the full roster in this plan.
- FPS on desktop and on a throttled mobile profile with 150 enemies.

## Platforms

- **Steam:** Electron wrapper with steamworks.js (achievements, cloud saves). A Windows build first, then macOS.
  - Steam's content survey requires disclosing AI-generated assets. Plan for it.
- **Mobile:** Capacitor (iOS/Android) with an IAP layer (RevenueCat or cordova-plugin-purchase).
  - F2P rule: the core campaign stays winnable without paying.
  - Sell premium unlocks, extra heroes/towers, cosmetics and remove-ads. No pay-to-win gates.

## Phases (each ends green on hermes: tsc, lint, tests, sim, build + screenshots)

| Phase | Done when |
|---|---|
| **P0 vertical slice** ✅ | L1c is playable in the new Pixi renderer on the real sim: 3 towers, the painted HUD and build ring, on desktop and phone. **Enemy animation A/B:** 1 enemy with the Veo walk-cycle pipeline, 2 with the cheap method (one painted sprite + procedural bob, squash/stretch, lean, 2–3 frame leg swap), shown together at in-game scale. Ends with the **go/no-go gate** below. |
| P1 roster art | All 7 towers (T1–T3) and 15 enemies + bosses are animated in game, and the codex uses the new art. |
| P2 maps | All 16 islands are repainted as plot maps and re-balanced in the sim. |
| P3 meta and story | The campaign map, story panels and the meta screens are reskinned (Steam scope). |
| P4 Steam | Electron build, Steamworks, store assets, the AI disclosure. |
| P5 mobile | Capacitor builds, IAP, the free-version scope cut, store listings. |
| P6 polish and launch | Audio pass, performance on low-end phones, localisation (TR/EN first). |

## Open decisions for the owner

- **Scope split:** which islands and features are Steam-only versus mobile-free (decided after Steam).
- The final game name (after P1) and store pricing per region.

## Risks

- **AI asset consistency across ~150 pieces.**
  - Mitigation: a locked style sheet, the same reference images, batch generation, and a review pass per family.
- **Veo cost and time:** about 70 clips for the roster. Use the Flow Ultra credits, Fast mode where quality allows.
- **Map/path alignment:** painted roads are traced, not generated from data. The editor overlay check is mandatory per map.
