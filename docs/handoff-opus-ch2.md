# Handoff — chapter two activation (opus, branch `hermes/skyhold-ch2`, 2026-11-19)

Chapter two (i17–i24) and its four enemies are now in the shipping 2D campaign. Clearing i16
opens i17 on the world map. The new enemies spawn, walk (down/up/**side**), attack, play their
painted **death** clips, show in the bestiary and in the wave card with the "New" tag, and have
death notes. Heroes, abilities, challenges, daily, endless and replay all pass the QA bot on all 25 islands.

## What changed

### Roster (the overnight "Requests for other agents", round 3 item 1)
- `src/core/types.ts`: `EnemyType` += `bellrunner | kilnback | reedpiper | draftwing`.
- `src/data/enemies.ts`: `...CHAPTER_ENEMY_DEFS` spread at the **end** of `ENEMY_DEFS` (same key
  order the balance CLI produced with its old `Object.assign`, so the outputs did not change);
  `...CHAPTER_ENEMY_TYPES` in `ENEMY_TYPES` after `hexer`, before `tempest`/`boss` (bestiary order).
- `src/data/soldiers.ts`: `...CHAPTER_ENEMY_MELEE` into `ENEMY_MELEE` (hare/piper single block,
  tortoise two-block, moth ignored).
- Exhaustive records: `DEATH_PITCH` (`src/audio/soundManager.ts`, shared by the 2D audio), 3D shard
  colours (`src/render/effectsRenderer.ts`), HUD badges + SVG glyphs (`src/ui/icons.ts`), 3D wave
  hints (`src/ui/content/waveHints.ts`), and small 3D figurines (`src/render/enemyMeshes.ts`) —
  without them the 3D build drew a Dreadnought for a hare and `enemyGeometry.test` failed on size.
- `scripts/balanceSim.ts`: removed the CLI-only roster staging. `tests/sim/chapterEnemies.test.ts`:
  removed the two `vi.mock` roster mocks and the widened spawn cast.

### 2D loader (round 3 item 2)
- `src/render2d/manifest.ts`: `SheetSpec.side?` and `EnemyArt.death?` parsed.
- `src/render2d/assets2d.ts`: side sheet → `SheetRuntime.seqs[2]`; new `DeathSheetRuntime`,
  `EnemyArtRuntime.death` (frames/fps/anchor), both prewarmed (listed by `collectArtTextureSources`), notes when pending.
- `src/render2d/enemyLayer.ts`: drops the ad-hoc death cast; QA counters `deathsPlayed`, `sideFrames`.
- `src/render2d/game2d.ts`: `enemyKilled` → `this.enemies.playDeath(e.enemyId)`. `debugState()`
  gains `fx.deathClips`, `fx.sideFrames`, `foes` (live count per type) and `bosses` (hp/phase/elite).

### Stories, Turkish, horn
- `src/render2d/ui/storyBeats.ts`: `GENERIC_STORY_ISLANDS` = i01–i24 (all 16 chapter panels exist).
- `src/i18n/dataTr.ts`: the eight islands and four enemies, verbatim from PROGRESS-codex rounds 3–6
  (the round-3 enemy texts, which supersede round 2's).
- **i21 horn: no change needed.** The horn is now placed by `hornSpot()` (searches the clearest
  spot, not the old fixed entrance offset). In play it sits on open grass left of the road, clear of
  the storage doorway, on desktop and phone (`docs/ch2-shots/i21-*-battle.jpg`).
- Shoreline build pads i06/i10 plot 12: already done by Codex in round 2 (55 pads), nothing to do.

### Small fixes from PROGRESS-skyhold-night-agy (render only, no sim change)
- `towerHasTarget` skips burrowed foes and uses the sim's reach (aura + hero range bonus), so
  towers no longer pre-roll attack sheets at underground burrowers.
- Range discs (tower panel, hover, upgrade preview of a built tower) show the buffed reach.
- Thunder Call bolts (no firing tower) start at the hero's height, not a tesla muzzle.

### Tooling
- `qa/ch2shots.mjs` — `--part=battle|boss|map` Playwright check for chapter two (see header).
- `qa/ch2probe.mjs` — open one URL, print boot state, save a screenshot.
- `tools/map-compose/preview_chapter.mjs` — retired to a 3-line notice (`git rm` needed approval).
- `src/render2d/main2d.ts`: `?zoo=1` doc says 19 types.

### Tests
- New `tests/sim/chapterTwoActivation.test.ts` (11 tests): `LEVELS_2D` = 25 islands in order with
  i17–i24 after i16; clearing i16 unlocks i17; every wave group of every island has defs + melee;
  each chapter island has TR name/subtitle, story panels on disk and its chart landmark; each chapter
  enemy has defs/melee/roster slot before the bosses/codex lore/HUD icon/TR text, and its own art
  with down/up/side/attack/death sheets on disk.

## Gate (Node 22, final tree)
- `npx tsc --noEmit` ✔ · `npm run lint` ✔
- `npm test`: **96 files passed (1 skipped), 1,291 tests passed, 11 skipped**
- `npm run sim:balance`: **PASSED, 41/41 targets**; stdout 844 lines, SHA-256
  `86c7879ffec6642a5c21c95ee8caefb06b70f861057e8516473f408d8198e6f5` — **byte-identical** to the
  starting revision (taken before any change, re-checked after each step).
- `npm run build` ✔ (Vite chunk-size / ineffective-dynamic-import advisories, as before).
- `npm run qa:bot`: **557/557 scenarios passed, 0 invariant violations** across all 25 islands
  (greedy 25, weak 25, abilities 25, hero 380, challenge 50, daily 25, endless 27; 21.8 M sim ticks,
  11 determinism replays).

## Play-check (Playwright, SwiftShader, production build) — `docs/ch2-shots/`
- **Battle**, every island i17–i24 at 1920×1080 (DPR 1) and 844×390 (DPR 2, touch), autoplay at 3×,
  shot at wave 3–4 with 8–12 live foes. Every run: painted death clips played (8–17 per run), side-walk
  frames drawn (177–1,121), no art fallbacks, no page/console errors. `i17-*-open.jpg` show the
  "New" Belfry Hare card. Scale, gate entry and road following looked right in every frame;
  Reed Piper notes/cleanse ring and moth trails visible.
- **Boss i24** (autoplay 3×, both sizes): elite Tempest Colossus spawn (crown clears the top),
  Stormwall at 65 % HP with 7 Kilnbacks + 9 hares + 2 pipers on screen, enrage at 25–27 %, then
  **Victory 3★, 19/20 lives**; 157 death clips over the run.
- **Map/briefing/story/codex**, EN + TR: map right after i16 (i17 open with the ship, i18+ locked)
  and with all open (25 nodes, chart landmarks); briefing of each island i17–i24 (desktop EN/TR,
  phone TR); story intro of i17; bestiary 20/20 with the four new foes, all in Turkish. The script
  checks the TR briefings for leftover English names: none.

## Open / doubtful
1. **i24 desktop:** the hero/ability bar is placed at top centre, above the north fort road. The
   Colossus is tall enough that its head passes under the Q/W buttons on that road
   (`i24-desk-boss-stormwall.jpg`). The bar placement is the shared `abilityBarSpot` heuristic; I did
   not retune it (it would move the bar on other islands). Owner call: add tall-boss clearance above
   road points, or accept.
2. **Phone map, all-open save:** in one shot the last node (Lastlight Head) looks faded — most likely
   captured mid scroll/entrance animation (the after-i16 phone shot and desktop are normal). Not
   reproduced further.
3. **Wave titles** (TR lists in PROGRESS-codex) are not added: 2D never shows `WaveDef.name`, and no
   TR lookup exists for it. Add them with the surface that shows them.
4. `ChapterEnemyType` / `EnemyType | ChapterEnemyType` types in `codexData.ts`,
   `chapterIsland.ts`, `enemies.ts` are now redundant (subset of `EnemyType`); left as is.
5. Not done from agy's list (design decisions, not quick fixes): Steam Cloud pull on boot,
   `staticFree` challenge in 2D campaign. Codex's `updateHealerAura` defensive guard skipped (sim
   change, no current bug).
6. **Machine note:** port 4381 (used by `qa/withPreview.py`) is held by an orphaned
   `vite preview` from `~/work/tasks/skyhold-night-opus` — not mine, left alone; `withPreview.py`
   silently talks to it (stale build). I ran QA through my own port with a free-port check. I also
   left one orphan of my own: `vite preview --port 4497` (pid 3571095, started via `npx`, whose
   child survived terminate); `kill` needed approval in this session, please stop it. Later runs
   start vite directly and exit cleanly.
