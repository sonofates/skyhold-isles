# P0 go/no-go gate: Skyhold Isles 2D

Date: 2026-11-17. Branch: `art-2d`. The Three.js game on `main` and the live site are unchanged.
Cost details per step: `docs/p0-costlog.md`. Plan: `docs/2d-transition-plan.md`.

**Work stops here until the owner decides. P1 has not been started.**

## 1. What was built

- **Map:** L1c, painted once at 1846×852 (2.17:1). All gameplay (2 entrances, 16 plots, the road, the town gate) sits inside the centred 16:9 safe area [166, 0, 1515, 852].
  - Desktop crops the edges; a phone shows the full width.
  - Traced in the new map editor (`tools/map-editor/`): safe-area overlay, export/import, walk test.
- **Sim:**
  - `LevelDef` accepts plot maps: plots, path polylines per entrance, goal; 50 image px = 1 world unit. Placement is plots only.
  - The two paths merge, and targeting orders enemies by distance to the goal across both paths.
  - L1c is a side level loaded by id; the 16-island campaign is untouched.
- **Renderer:** Pixi v8 in a separate entry, `2d.html`, on the real `SimWorld`.
  - Depth-sorted towers and enemies with ground shadows, projectiles and FX.
  - Painted in-canvas HUD: lives/gold plaque bottom-left, wave banner bottom-right (the bottom band is scenery only), pause/speed buttons, the horn.
  - Build ring, upgrade and sell. Mouse and touch.
- **Assets:** 3 towers (archer T1–T3, cannon T1, crystal T1), 3 enemies, UI kit. All Codex image_gen, keyed from magenta.
- **Gate:** tsc + lint + **739 tests** + **sim:balance PASS on 17 levels** (16 islands unchanged + L1c Breezy: greedy 20 lives/3★, weak wins with 16) + build, all on hermes.

## 2. Screenshots and recordings (real Chrome, Apple M3, real in-game size)

All files are in `design/art-2d/gate/`:

| File | What |
|---|---|
| `l1c-desktop.mp4`, `l1c-desktop.png` | Desktop 2560×1322 canvas (Chrome window), greedy autoplay, 15 s |
| `l1c-phone-915x412.mp4`, `l1c-phone-915x412.png` | Mid-range phone landscape viewport 915×412 (an iframe in Chrome, so DPR is the desktop's 1.1, not a phone's 2.6), 12 s |
| `enemy-ab-desktop.mp4`, `enemy-ab-desktop.png` | Enemy animation A/B at in-game scale, 12 s |

Hermes (SwiftShader) screenshots at 1600×900 and 915×412 @ DPR 2.6 are in `/private/tmp/claude-501/skyhold-p0-qa/` (session scratch, not committed).

## 3. Enemy animation A/B (open `enemy-ab-desktop.mp4`)

Four lanes on L1c, labelled under each walker. Reproduce with `2d.html?ab=1`.

| Lane | Method | Source |
|---|---|---|
| raider | **sheet · omni12**: Omni 1.2 Flash walk cycle, front 16 frames + back 18 frames @ 12 fps | 2 clips × 12 credits |
| brute | **cheap**: painted sprite + bob/squash/lean + 2 leg-swap frames | Codex only |
| kite | **cheap** (flying): sprite + bob/rock + 2 wing/leg frames | Codex only |
| raider | **sheet · veo31q**: Veo 3.1 Quality, 14 + 14 frames | 2 clips × 100 credits |

Model comparison on the same start frames (first-hand, from the extracted frames):
- **Omni 1.2 Flash (12 credits per clip):** clean walking in place, front and back. The character, blade and glider stay consistent across the loop. Loop scores 4.3 (front) and 11.0 (back) on the tool's difference metric.
- **Veo 3.1 Quality (100 credits per clip):**
  - Front clip: the character turns to face the camera halfway and the blade changes hands, so only the first ~1.2 s is usable as a loop.
  - Back clip: a second blade appears in later frames.
- **Flow marks Veo 3.1 Fast and Quality as "Leaving Dec 5".** Omni 1.2 Flash (12 credits) and Veo 3.1 Lite (5 credits, untested) remain.

**At in-game scale** an enemy is about 60–90 screen px tall on desktop and about 30–40 px on a phone, so the difference between the methods is smaller in play than in the sprite sheets. This is the judgement the owner asked to make from the recording.

## 4. Measured pipeline cost per asset family

Times are wall-clock from logged timestamps. Codex runs on the ChatGPT plan, so it is counted in runs and tokens, not money. Flow credits are on the Ultra account.

| Family | Measured | Credits / tokens | Notes |
|---|---|---|---|
| **Map** (generate + trace) | **about 5 min** with the agent tracing (3.5 min generation + 1.4 min trace and fix) | 1 Codex run, ~38k tokens | A person clicking in the editor: about 10–15 min to trace. **Not included:** the per-map balance retune in the sim (L1c needed a sweep; estimate 30–60 min of agent time per map) |
| **Tower, 3 tiers** | **about 9 min** (T1 ~2 min as a share of the first batch + T2/T3 ~5 min as a share of a 6-image run + keying ~1 min) | ~35k tokens | Attack frames (draw/recoil/pulse) are not done; estimate +5–10 min per tower |
| **Veo-animated enemy** (front + back walk) | **about 15 min** (front design ~2 min share + back view 4 min + 2 clips ~4–6 min generation + Flow driving + sheet extraction <1 min) | 2 × 12 = **24 credits** (Omni 1.2 Flash) | Uploading start frames needed the owner to drag files onto Flow once per session (the built-in browser can't upload). Hit and death clips would add about 2 more clips (+24 credits, +6 min) |
| **Cheap-animated enemy** | **about 7 min** (sprite ~2 min share + 2 leg-swap frames ~5 min share + keying) | ~15k tokens, 0 credits | Leg frames stayed consistent on the first try |

One-time tooling built in P0 (not repeated per asset): map editor, video→sprite-sheet tool (`tools/sprites/veo_to_sheet.py`), magenta keyer, Pixi renderer and manifest.

## 5. Extrapolated cost for the full roster in the plan

Roster in the plan:
- 16 maps
- 7 towers × 3 tiers + attack frames
- 15 enemy types + elites (tint/overlay) + 2 bosses = **17 animated characters**
- about 20 FX strips
- about 40 UI pieces

| Item | Omni-sheet route | Cheap route |
|---|---|---|
| Maps (16 × ~20 min incl. review + ~45 min balance retune) | ~17 h | ~17 h |
| Towers (7 × ~9 min + attack frames ~8 min) | ~2 h | ~2 h |
| Enemies, walk only (17 × 15 min / 7 min) | ~4.3 h, **408 credits** | ~2 h, 0 credits |
| Enemies, walk + hit + death (4 clips each) | ~6 h, **816 credits** | (hit/death via flash/tint, procedural) |
| FX (20 × ~5 min) | ~1.7 h | ~1.7 h |
| UI kit (40 × ~2 min) | ~1.5 h | ~1.5 h |
| **Total** | **~28 h, ~816 Flow credits** | **~24 h, 0 credits** |

Notes:
- With Veo 3.1 Quality instead of Omni the enemy line would be about 6,800 credits, and that model leaves on Dec 5.
- The dominant cost is not art generation but **map balancing** and review passes.
- These hours are agent-assisted wall-clock with this session supervising. They do not include owner review time.

## 6. FPS with 150 enemies (`2d.html?bench=150`)

| Profile | fps | frame p50 / p95 (ms) | update (ms) p50 / p95 | render CPU (ms) p50 / p95 | draw calls |
|---|---|---|---|---|---|
| **Desktop, real Chrome**, M3, 2327×1203 css @ DPR 1.1, 120 Hz monitor | **108.8** | 8.3 / 9.3 | 0.8 / 2.5 | 1.5 / 4.3 | 22 |
| **Phone viewport 915×412, real Chrome** (iframe, DPR 1.1, no CPU throttle) | **117.3** | 8.3 / 9.3 | 1.1 / 2.5 | 1.9 / 3.4 | 27 |
| Hermes, phone 915×412 @ DPR 2.6, **CPU throttled ×4** (SwiftShader software GPU) | 14.5 | 66.7 / 83.4 | 2.5 / 5.0 | 3.6 / 13.5 | 15 |

**Reading:**
- On real hardware the 2D renderer holds the display rate with 150 enemies (about 22 draw calls; JS ≈ 2–3 ms per frame).
- The throttled run's 14.5 fps is the software GPU drawing pixels. Its CPU side is what the throttle measures: about 6 ms p50 / 18 ms p95 per frame at ×4. That implies 60 fps is reachable on a mid-range phone, with occasional p95 spikes.
- **Not measured:** a real mid-range phone. A real-device run (iPhone Safari via devicectl, or an Android device) is the remaining check before mobile, not before Steam.

## 7. Known issues and loose ends

- L1c balance is tuned to the current trace. If the trace changes, re-run the sweep (`qa/l1cSweep.ts`).
- Not covered by browser tests in P0: phone pan/zoom, window resize mid-game, the win/lose restart flow.
- Cannon and crystal towers have T1 art only; T2/T3 fall back to T1.
- The `?ab=1` lanes walk the real road; flyers use an arc from entrance A.

## 8. Decision needed

**Go or no-go for P1.** If go:
- Choose the enemy animation route: **Omni-sheet** (≈ 24–48 credits per enemy), **cheap**, or a mix (for example Omni for bosses and common foes, cheap for the rest).
- P1 scope reminder: the barracks/soldier tower is a real sim feature (blocking, melee, rally, respawn, tests, retune).
