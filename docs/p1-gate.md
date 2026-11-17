# P1 report: roster art + barracks

Date: 2026-11-17. Branch: `art-2d` (the Three.js `main` and the live site are unchanged).
Owner decision for P1: the Omni-sheet route, credits not a constraint.

## Result

- **All 15 enemy types and the barracks soldier walk with Omni 1.2 Flash animation**, front (toward camera) and back (away). Mirrored, they give 4 directions.
  - Sprite sheets are 12 fps and 8–19 frames.
  - Loops are cut automatically by `tools/sprites/veo_to_sheet.py`.
- **All 8 towers at T1–T3:** archer, cannon, crystal (tesla), frost, mortar, ballista, beacon, and the new barracks.
- **Barracks is a real sim feature.**
  - Soldiers block ground enemies on the road, fight in melee, die and respawn. The rally point can be moved within range. T3 Cleave.
  - Rules per enemy archetype: flyers ignore soldiers, burrowers only while surfaced, blinkers jump past, golem/bosses need several soldiers, mites stream past.
  - Rule list: `docs/p1-tasks.md`.
  - The 16 existing islands' balance is identical line for line. L1c uses barracks and passes its window.
  - The 3D game hides the barracks.
- **Renderer:**
  - Per-enemy specials: healer aura, warden shield bubble, burrower mound, blinker charge/flash, golem crack, hexer jam tether and marker, splitter burst, carrier drop, elite crown/ring, boss phases.
  - A distinct attack animation and projectile per tower, with T3 flourishes.
  - The build ring fits 8 towers (two rows, ≥ 52 px touch targets).
  - The codex shows the painted art.
- **Delivery size:** art shipped as WebP, 61 MB → 14 MB.
- **Gate (hermes):** tsc, lint, **782 tests**, **sim:balance PASS on 17 levels**, build.
  - `?artcheck=1` reports **85 art files present, 0 missing**.

## Recordings (real Chrome, Apple M3, `design/art-2d/gate-p1/`)

| File | What |
|---|---|
| `p1-zoo.mp4` / `.png` | All 15 enemy types walking on L1c with specials triggered (`2d.html?zoo=1`), 18 s |
| `p1-towers-t3.mp4` / `.png` | Every tower at T3 firing (`?towers=1&tier=3`), 14 s |
| `p1-autoplay-barracks.mp4` / `.png` | Greedy autoplay at 3× (waves 6–10) with two barracks blocking: 69 soldier swings and 7 falls during the clip, 40 s |

## Bugs found and fixed while doing P1

- **Service worker (3D build):**
  - It stored every page navigation as the offline `/index.html`, so visiting `2d.html` overwrote the 3D game's offline shell.
  - It also served `/art2d/` cache-first, which pinned a stale art manifest.
  - Fixed: 2D page and art bypass the worker, and only `/` and `/index.html` refresh the shell. Tests added.
  - This matters once the 2D page ships on the same domain.
- **Asset loading:** a burst of about 100 parallel requests at boot could drop files on weak servers or flaky networks. Loads now retry transient failures; a real 404 still falls back at once.
- **Build ring:** it rendered off-screen after the HUD moved to the bottom band (fixed by the barracks agent).

## Cost (P1)

| Item | Amount |
|---|---|
| Codex image_gen | 8 runs: 13 enemy fronts, 19 tower/barracks/soldier sprites, splitter redo, 15 back views. About 45 min wall-clock (runs in parallel), about 640k tokens |
| Flow credits | 30 Omni 1.2 Flash 8 s clips × 24 + 1 redo (kite back had painted wind streaks) × 24 = **744 credits** |
| Flow driving | Fully scripted after the owner's one drag-and-drop of 30 start frames: submit ~10 s per clip, generation in parallel, download via the signed-URL log |
| Sheet extraction | 30 clips in about 13 min, automatic. 5 loops were too short and were redone with a minimum cycle length |

## Not done / open

- **Hit and death clips:** optional in the plan, not made. Hit flash, tint and death puffs are procedural.
- **Tower attack frames:** procedural recoil, flash and muzzle FX only, no painted attack frames.
- **Barracks balance:** provisional. The L1c scripts barely need blocking; retune when the P2 maps exist.
- **Real mid-range phone:** still not measured. Before mobile, not before Steam.
- **Weaker loops:** a few have higher loop scores (golem front, boss back). They read fine at game scale but could be regenerated with a second clip.

## Next decision

**P2: repaint the remaining 15 islands as plot maps (19.5:9, editor trace, sim retune per island).** The engine, art pipeline and roster are ready for it.
