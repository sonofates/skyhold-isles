# PROGRESS — skyhold-day-content (CONTENT agent, day pass 2)

Branch `hermes/skyhold-day-content`. Deadline 21:00 TR. Rounds = fresh sessions; this file + git log are the only memory.
## Visual QA how-to (works on hermes)
`npm i --no-save playwright-core happy-dom` (no-save: installing one prunes the other, reinstall both), `npm run build &&
npx vite preview --port 4303 --host 127.0.0.1` (background), then a small node script with
`chromium.launch({executablePath:'/home/claude/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']})`
(Bash may not `ls ~/.cache`, node can read it). Seed saves with `page.addInitScript(localStorage.setItem(...))`
(e.g. `skyhold_isles_progress_v1` with `unlockedLevelIndex:13` then Play = L14). `?touch=1` = low quality/no postprocessing.
**Known software-GL artefact:** with `?touch=0` (n8ao postprocessing under SwiftShader) a white rectangle sometimes covers
part of the map in certain camera yaws — not a game bug (gone with `?touch=1` / after rotating the camera).
Round-1 screenshots reviewed: codex (portrait/landscape/desktop), sighting card, coach (touch portrait/landscape, desktop),
menu/pause/island-select Codex buttons, settings Replay row, L14–L16 (+ lane overlay). Scratch helpers live untracked in `scripts/_*`.

## Architecture (what exists)
- `src/platform/contentStorage.ts` — `ContentStore`: own versioned localStorage keys `skyhold_isles_codex_v1`
  (`{v:1, seen:[ids]}`; ids `enemy:<type>`, `tower:<type>`, `elite`) and `skyhold_isles_onboarding_v1`
  (`{v:1, status: pending|done|skipped}`). `migrate()` runs once: veterans (unlocked>0 or any stars) get the tour
  marked done and every foe on islands they played marked seen; legacy `enemy_intros_seen` toast key is honoured.
  Never reads/writes progress or settings keys.
- `src/ui/content/onboardingMachine.ts` — pure state machine (build → startWave → upgrade → ability → done),
  driven by observations of the game; `coachMessage()` picks touch/desktop text + highlight target.
- `src/ui/content/codexData.ts` — pure text/stat data for codex + cards (`ENEMY_LORE`, `TOWER_LORE`, entries).
  **This is where counters/blurbs live** (enemies.ts / towers.ts were not touched except the boss description).
- `src/ui/content/firstSighting.ts` — `SightingQueue` (dedupe + order), `waveHasElite`. `cardContent.ts` maps a ref to card text/icon.
- DOM: `coachMark.ts`, `sightingCard.ts`, `codexScreen.ts`, `entryPoints.ts` (decorates the existing menus' DOM with
  Codex buttons so menus.ts/gameModals.ts stay untouched), `contentDirector.ts` (glue; owns everything above).
- CSS: `src/ui/styles/{onboarding,sighting,codex}.css` (imported from their TS modules).
- Session hooks (small): `GameSession.deps.content` (`ContentDirector`): `observe()` from `syncUi`, `bindLevel()` from
  `startLevel`, `onLeavePlay()` from `showMenuView`, `onLevelWon()`, `isBlocking()` folded into `syncLoopAndInput` +
  `fixedTick`; `buildOnboardingObs()` in GameSession. `sessionBridge` got `suppressIntroToasts` (cards replace the old
  "New foe" / flyer toasts when the director exists).
- API for the CAMPAIGN agent: `ContentDirector.towerUnlocked(type)` shows the first-sighting card for a tower once
  (nothing calls it yet — all 7 towers are available from the start in this branch; if CAMPAIGN adds tower unlocks it
  should call this on unlock and decide whether `inferSeenFromProgress` should pre-seed `tower:*` ids for veterans).
  `openCodex(tab?, id?)`. Foes queued behind a card that was cut short are un-marked again (`unmarkSeen`).
- Authoring tools (see `docs/island-authoring.md`): `scripts/levelTool.ts` (layout renderer, road-coverage site ranker,
  `--seed-from`), `scripts/tuneBuildOrder.ts` (hill-climb the greedy build order for robustness, derive the weak order),
  `scripts/hpSweep.ts` (HP scale / growth sweeps).

## Done
1. Pure logic + tests: storage/migration, onboarding machine, codex data, sighting queue.
2. Onboarding tour (island 1 only, skippable, replayable from Settings → "Replay tutorial"), first-sighting cards
   (enemy / flyer / boss / elite / tower, pauses the game, Enter/Space/Esc dismiss), Codex screen (Foes + Towers tabs,
   silhouettes for unmet foes, tier table + T3 signature, reachable from main menu, island select, pause menu, and from
   a card's "Codex" link). DOM smoke tests via happy-dom (skipped automatically when it is not installed).
3. L14 Amberstone Mesa (3 gates), L15 Moonwell Crossing (self-crossing road + late gate), L16 Emberglass Sanctum (ring,
   counter-rotating lanes + north gate): layouts, waves (22/22/24, named), themes in `islandThemeTable.ts`, optimised
   greedy + derived weak build orders, all inside the Master window. `tests/sim/dayIslands.test.ts`.
4. Onboarding polish: bobbing "build here" marker (screen-space, follows the camera) over island 1's best first tile.
5. Text: README feature blurbs, boss description, HUD air-tower list no longer names the Beacon (it never shoots),
   flyer toast names the Ballista.

## Round 2 (verification)
Re-verified tsc/lint/428 tests/build/sim:balance (all 16 islands in window) and happy-dom DOM tests. Re-checked codex in
portrait + landscape screenshots (fine; landscape grid scrolls). Added lore-vs-data consistency tests (no ground-only tower
recommended against flyers; every tower/ability name in lore is real).

## Round 3 (verification)
Clean tree at start. Re-ran tsc / lint / 430 tests / build / sim:balance: all green, all 16 islands inside their windows (L14 7L, L15 8L, L16 9L greedy; weak loses). Lore text reviewed again, no changes needed. No new code this round.

## Next
- Round 2+: visual QA if a browser becomes available; description/tooltips polish; more tests; tower-unlock card wiring if
  CAMPAIGN adds unlocks; maybe a "NEW" dot on codex entries.

## Decisions
- Veterans never see the tour; cards only for foes they have not fought (inferred from progress).
- Tour runs on island 1 only; level restart resets it to step 1; gives up waiting for an upgrade after 5 waves.
- Difficulty label for L14–L16 stays `Master` (no "Legendary": the union type, menu CSS and sim windows are CAMPAIGN's).
- Balance of new islands: lowering `waveHpGrowth` (0.06–0.08) + raising `enemyHpScale` removed the final-wave cliff
  (greedy used to go 13 → 2 lives for +2% HP). All three are now stable across ±1.5% HP in `sim:balance --robust`.
- Elite card is queued at `waveStarted` of a wave with an elite group (the spawn event carries no elite flag); not in endless.

## Known issues
- Landscape-phone codex: tabs + tile grid leave little room (scrolls); fine but cramped.
- `HudBar` air-tower text and `sessionBridge` toast edited minimally (cross-area, below).

## Cross-area changes
- `src/ui/settingsModal.ts` + `gameOverlays.ts`: optional `onReplayTutorial` callback + one button row.
- `src/platform/gameSession.ts`: content hooks listed above (+ `buildOnboardingObs`). `src/main.ts`: creates the
  `ContentStore`/`ContentDirector`, wires replay, mounts Codex entry points.
- `src/platform/sessionBridge.ts`: `suppressIntroToasts` option; flyer toast text. `src/ui/hud.ts`: air-tower name list filter.
- `src/data/enemies.ts`: boss description text only.

## Round 4 (verification)
Clean tree at start, `main` already merged into the branch. tsc / lint / tests green; no code changes (backlog 1–5 complete; the
remaining ideas — tower-unlock card wiring, landscape codex density — depend on CAMPAIGN/MOBILE merges and are listed under Next).

## Round 5 (verification)
Clean tree, `main` still merged. tsc / lint / 430 tests green. No code changes: backlog 1–5 are complete; remaining ideas
(tower-unlock card wiring, landscape codex density) depend on the CAMPAIGN/MOBILE merges. Note for the lead: the campaign branch
has a save v2 migration — after merging, check that `ContentStore.migrate()` veteran inference (`unlockedLevelIndex`/stars) still
reads the right fields from the v2 progress shape.

## Round 6 (verification)
Clean tree, `main` still merged. Checked the campaign branch's v2 `ProgressData` (read-only, `git show`): `unlockedLevelIndex` and
`bestStars` still exist with the same meaning, so `ContentStore.migrate()` veteran inference works unchanged after that merge
(resolves the round-5 note). No code changes.

## Round 7 (verification)
Clean tree, `main` merged. tsc / lint / 430 tests / sim:balance (16 islands, all in window) green. No code changes; backlog 1–5 complete.

## Round 8 (verification)
Clean tree, `main` merged (no new main commits). tsc / lint / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 9 (verification)
Clean tree, `main` merged (no new main commits). tsc / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 10 (verification)
Clean tree, `main` merged (no new main commits). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 11 (verification)
Clean tree, `main` merged (no new main commits). tsc / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 12 (verification)
Clean tree, `main` merged (no new main commits). tsc / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 13 (verification)
Clean tree, `main` merged (no new main commits). tsc / lint / tests / sim:balance (16 islands in window) green. No code changes; backlog 1–5 complete, nothing pending.

## Round 14 (verification)
Clean tree, `main` unchanged. tsc / lint / 430 tests / build / sim:balance (16 islands in window) green. Campaign branch has new commits (hand-picked challenge pairs for L14-16 by id) — compatible by design. Merge dry-runs (`git merge-tree`, temp worktree) are not permitted in this sandbox, so merge conflicts between day branches remain unchecked here. No code changes; backlog 1-5 complete.

## Round 15 (verification)
Clean tree, `main` merged (unchanged). tsc / 37 test files / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 16 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 17 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 18 (verification)
Clean tree, `main` merged (unchanged). tsc / 37 files / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 19 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 20 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 21 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 22 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 23 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 24 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 25 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 26 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 27 (verification)
Clean tree, `main` merged (unchanged). tsc / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 28 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 29 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / tests green. No code changes; backlog 1–5 complete, nothing pending.

## Round 30 (verification)
Clean tree, `main` merged (unchanged). tsc / lint / 430 tests green. No code changes; backlog 1–5 complete, nothing pending.
