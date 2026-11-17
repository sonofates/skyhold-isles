# P0 vertical slice: working list

Branch: `art-2d`. Spec: `docs/2d-transition-plan.md` (P0 row + gate). Costs are logged in `docs/p0-costlog.md` as the work happens.

- [x] Map: L1c repainted at ~19.5:9 (2048x945), all gameplay inside the centred 16:9 safe area
- [x] Map editor page (`tools/map-editor/`): place path points, plots and entrances on the image; 16:9 safe-area overlay; export JSON; overlay check
- [x] L1c traced with the editor → `src/data/levels2d/l1c.json`
- [x] Sim: `LevelDef` gains plots, polyline paths (world units) and entrances; plot-based `canPlaceTower`; polyline path following; tests
- [x] L1c level (waves, difficulty) + balance sim entry (greedy/weak windows)
- [x] Pixi v8 renderer (separate entry, `2d.html`) on the real `SimWorld`: map (cover/contain with safe area), depth-sorted sprites, projectiles/FX, painted HUD, build ring, tower panel
- [x] Assets: archer T1/T2/T3 (cost measured), mage + cannon T1 (exist)
- [x] Enemy A/B: raider with the Veo walk-cycle pipeline; brute + kite with the cheap method (sprite + bob/squash/lean + 2–3 frame leg swap)
- [x] A/B scene: all three side by side at in-game scale (screenshot + recording)
- [x] FPS: desktop (real Chrome) and throttled mobile profile, 150 enemies
- [x] Screenshots + recording: desktop 1600x900 and mid-range phone (e.g. 915x412 at DPR 2.6, CPU 4x)
- [x] `docs/p0-gate.md` written → STOP and wait for the owner

## Notes as of 19:05
- Raider sheets: Omni 1.2 Flash (default) and Veo 3.1 Quality, front and back, in design/art-2d/out/anim/. Brute and kite have 2 leg-swap frames each.
- Engine (sim plots + Pixi renderer + bench) is being built by a subagent in a worktree; it merges into art-2d.
