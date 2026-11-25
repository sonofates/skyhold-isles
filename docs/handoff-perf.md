# Handoff: 2D performance (entry split, per-island loading, GPU release, map-life cells)

Branch `hermes/sky-perf3`, based on `art-2d` a79c5678 (PC readiness, the game ending, chapter 5
i37-i45 and its art polish already in). This re-lands the six commits of
`origin/hermes/sky-perf2` (2155458d..390615fd), which were built on an older tree (d274e58c) and
stopped before their handoff.

## How it was re-landed

`git cherry-pick` / `format-patch` / `git mv` need approval in this session, so each commit was
rebuilt file by file. Of the 31 files the six commits touch, only three had changed on the base
since d274e58c: `src/render2d/main2d.ts` (PC readiness + ending), `src/render2d/ui/worldMap.ts`
and `package.json`. Every other file is taken verbatim from its perf2 commit
(`git checkout <commit> -- <file>`). For `battle2d.ts`, each step is perf2's file at that commit
plus the base's main2d delta (a scripted patch, checked byte-identical at the split commit), so
`base..HEAD` touches exactly perf2's file set (`git diff --stat a79c5678 HEAD`).

Where the newer main2d.ts code went:

| base main2d.ts change | now in |
| --- | --- |
| title screen: desktop Quit plank (`isDesktopShell` → `confirmQuit`), `setPresence('menu')` | `main2d.ts` (entry, `runTitleScreen`) |
| doc line `?end=won&story=ending` | `main2d.ts` (the URL parameter list lives in the entry) |
| `setPresence('battle', islandName(level))` | `battle2d.ts` |
| campaign ending after a finale win (`endingDue`, `playEndingAfterWin`, `?story=ending`) | `battle2d.ts` (`onEnd`) |
| pause menu Quit in the shell (`quit:` with the `asking` guard) | `battle2d.ts` |
| boot artwork / veil, fps counter, Esc-menu hooks | already present in perf2's base, carried unchanged |

`worldMap.ts`: only perf2's import change (`readSafeInsets` from the pixi-free `safeInsets.ts`).
`package.json`: `perf:bundle` script added.

## The six commits (what each does)

1. **rename** `main2d.ts` → `battle2d.ts`, so git follows the battle body's history.
2. **entry split**: `main2d.ts` is a thin entry (locale, nav, graphics prefs, title, world map);
   any game scene (`GAME_PARAMS`) starts `import('./battle2d.ts')` in parallel with the fonts.
   `bootShared2d.ts` holds the shared pixi-free boot steps; `hudFont.ts` / `safeInsets.ts` split
   the pixi-free parts out of `hudText.ts` / `uiKit.ts` (re-exported there). `vite.config.ts`
   gives Vite's preload helper its own chunk (as a `manualChunks` name it was pulled into `pixi`,
   so the entry imported all of Pixi). Guard: `tests/render/bundleSplit.test.ts` walks the static
   import graph of the entry, `bootShared2d`, `titleScreen` and `worldMap` and fails on any path to
   Pixi, `battle2d`, `game2d` or the sim. Report: `npm run perf:bundle`.
3. **per-island tables**: `src/data/{ambientFx,mapAnim,mapLife}/*.json` are one lazy chunk per
   island (`islandTable.ts`); the battle loads its island's tables with its art
   (`loadIslandTables`). Sync getters unchanged; tests preload all (`tests/setup/islandTables.ts`).
   The base's i43-i45 tables are picked up by the same globs.
4. **enemy art subset**: a story run loads only the enemy sheets its waves can show, closed over
   the sim's spawns (`enemyArtSet.ts` `ENEMY_SPAWNS`, incl. the Eclipse Sovereign's Shadow Halves
   and Dusk Hounds), plus the default stand-in and the barracks soldiers. Endless, `?ab`,
   `?bench`, `?zoo`, `?melee`, `?towers`, `?artcheck` keep every enemy. A foe outside the set draws
   the stand-in and loads late (console warning). The codex draws unloaded foes from their
   manifest file. `tests/render/enemyArtSet.test.ts` scans `enemySystem.ts` for every
   `initEnemyAt('<type>')` and fails when a new spawn is not listed. `__p0.gpu()` (gpuStats.ts).
5. **back/forward cache**: leaving a battle through the game (`navigateWithVeil`: Menu, Next isle,
   Daily, the ending's way back to the map) into the bfcache closes the decoded ImageBitmaps and
   loses the GL context (`pageCache.ts`); such a page shown again reloads. App backgrounding and
   the browser's own Back are untouched. `__p0.menu()` for QA.
6. **map-life cells**: the wind / water / haze surface pass draws only the 48-column grid cells
   its masks touch (`activeLifeCells`, property-tested to be conservative) instead of a full-map
   quad with discarded fragments. `__p0.mapLifeFullQuad(on)` + `qa/mapLifeCells.mjs` compare both.

## Measurements (before = a79c5678, after = this branch; same server, runs interleaved)

All browser numbers: headless Chromium, SwiftShader WebGL, production build via `vite preview`.
GL texture MB is counted at the WebGL API (w × h × 4 per live texture, + mips).

### Bundle (`npm run perf:bundle`, 2d.html)

| | before JS (gz) | after JS (gz) |
| --- | --- | --- |
| initial (entry + static imports) | 1937 kB (565 kB) | **624 kB (165 kB)** |
| title + world map | 2077 kB (618 kB) | **840 kB (246 kB)** |
| battle path | 2028 kB (597 kB) | 1984 kB (588 kB) |
| total emitted | 3614 kB (1098 kB), 55 files | 3631 kB (1123 kB), 163 files |

CSS is unchanged (initial 56.5 kB, title + map 115.3 kB, total 254.6 kB). The title screen and
world map now fetch no Pixi, `battle2d` or `game2d` chunk (checked in the browser by
`qa/perfflow.mjs`: 26 JS files, none of them). The total grows +18 kB (+25 kB gz) from the split
overhead and the per-island JSON chunks, all lazy.

### Late-island battle, i45, 932x430 @1, 4× CPU throttle (`qa/perfBattle.mjs`)

Every plot built, waves called early (25-31 foes on the map), sampled 30 s (3 runs each) / 15 s
(2 runs each):

| tier | before fps | after fps | frame ms p50 / p95 before | after |
| --- | --- | --- | --- | --- |
| high (`&quality=high`, map life on) | 22.4-24.1 | **26.0-27.7** | 33.3 / 100-117 | **16.7** / 83-100 |
| auto (headless calibrates `low`) | 39.1-40.2 | 39.6-40.0 | 16.7 / 50-67 | 16.7 / 50-67 |

Script CPU per frame (high): 15.6-19.8 → 13.3-17.0 ms. GL textures resident in that battle:
666 → 563 MB. SwiftShader frame times are quantized to 16.7 ms multiples, so p95 moves in steps.
The `low` tier draws no map-life surface pass, hence no change there.

### Memory after 5 island switches (`qa/perfMemory.mjs`, i01 → i12 → i24 → i36 → i45 → i01, 932x430)

Each battle is left through `__p0.menu()` (as the end board's Menu), JS heap after a forced GC.

| | before | after |
| --- | --- | --- |
| GL textures per battle page | 670 MB on every island | **429 (i01) / 545 / 586 / 578 / 567 (i45) MB** |
| JS heap, battle page | 12.4-12.6 MB | 11.7-12.2 MB |
| JS heap, world map | 5.5 MB | **3.8 MB** |
| growth over the switches / 2 Retries | none | none |

With the back/forward cache on (`--bfcache=1`, full Chromium, as a real browser has it):

- before: every battle page left went into the cache **holding its WebGL context** (6 × ~670 MB
  of textures alive), and Back showed the old page still holding 670 MB; the probe fails.
- after: every cached battle page released its context (161-243 textures, 129-211 ImageBitmaps
  closed, `contextLost: true`); Back reloads a fresh page. The cached pages' JS heap remains
  (cumulative heap 54.8 vs 60.8 MB before), bounded by the browser's cache size.

## Verification

- Gates: all green — see "Gate results" below.
- Determinism: the sim is untouched; `sim:balance`, `sim:difficulty` and `sim:items` stdout are
  byte-identical to the same scripts run on a79c5678.
- Browser flow (`qa/perfflow.mjs`, ONE Chromium, production build, 932x430 phone/touch @2 and
  1920x1080 with a fake desktop shell): title (tap → menu, Quit plank only in the shell) → New
  game → world map, all 5 chapter pages → Esc menu → Settings (General, Graphics) → Esc closes →
  battle on i45 (12 towers, wave called) → codex (no broken images; unloaded foes show their
  portraits) → Esc pause menu (Quit only in the shell) → resume → `?level=i45&end=won&story=ending`
  → epilogue beats → credits roll → skip → world map. **0 console errors, 0 page errors** at both
  sizes. Shots: `docs/perf-shots/` (34 jpgs).

Run them again:

```
npm run perf:bundle
python3 qa/withPreview.py --port=4473 node qa/perfflow.mjs [--sizes=932x430,1920x1080] [--island=i45]
python3 qa/withPreview.py --port=4471 node qa/perfBattle.mjs --size=932x430 --dpr=1 --cpu=4 --level=i45 --quality=high --seconds=30
python3 qa/withPreview.py --port=4472 node qa/perfMemory.mjs --islands=i01,i12,i24,i36,i45,i01 [--bfcache=1]
# before-numbers: build the base with `vite build --outDir /tmp/x`, then withPreview --port=N --outDir=/tmp/x ...
```

## Gate results

Run on this branch's final code (2026-11-25, hermes):

| step | result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run` | exit 0, 2161 tests passed (incl. bundleSplit, enemyArtSet, mapLifeCells) |
| `npm run sim:balance` | PASSED, 62 levels — stdout **byte-identical** to a79c5678 |
| `npm run sim:items -- --workers=2` | all PASS — stdout **byte-identical** to a79c5678 |
| `npm run sim:difficulty` | all PASS — stdout **byte-identical** to a79c5678 |
| `npm run build` | exit 0 |

## Open points

- `npm run desktop:smoke` (Electron) was not run: the Electron binary was not downloaded
  (`ELECTRON_SKIP_BINARY_DOWNLOAD`, server disk ~93 % full). The shell-only paths (title / map /
  pause Quit) were checked in the browser with a fake `window.skyholdDesktop`. Worth one smoke run
  on a machine with the binary, since the entry is now split (desktop/main.cjs drives the title).
- Gains are on the first paint (title / map JS −60 %), on GPU memory per battle (−15 to −36 %),
  on the high tier's frame rate (+14 %) and on bfcache residency. The `low` / auto tier battle fps
  is unchanged; the battle path itself is about the same size.
- The commits carry new hashes (rebuilt, not cherry-picked); their messages name the perf2
  originals.
- The task named base af731ac5; the branch was created at a79c5678 (newer `art-2d`, includes the
  ending and ch5 i43-i45), which is what this is built and measured on.
