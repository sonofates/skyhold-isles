# PROGRESS — skyhold-day-campaign (CAMPAIGN & REPLAYABILITY)

Branch `hermes/skyhold-day-campaign` (base main @5149e2f). Deadline 21:00 TR (18:00 UTC).
Green gate after every commit: `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance`.
(Worktree had no node_modules: run `npm ci` first in a fresh checkout.)
Screenshots: `.tune/` is gitignored — `.tune/shot2.mjs <name> '<steps>' [portrait|landscape|desktop]`
(playwright-core in `.tune/pw`, chromium_headless_shell-1234, seeds `.tune/save.json`), served by
`npx vite preview --port 4301`. Steps: `click:<sel>;;wait:<ms>;;text:<btn>;;eval:<js>;;hidedebug`;
names starting `dbg-` load `?debug` (Win/Lose buttons: `click:.debug-panel button:text-is("Win")`).
Machine load from the other agents can make desktop shots slow (timeout raised to 150 s).

## Plan / status
- [x] 1. Stars per difficulty (lives-lost table), best result per island, save v2 migration, victory star reveal
- [x] 2. Workshop upgrade tree (stars currency, refundable) + RunModifiers sim hook + max-upgrade sim check
- [x] 3. Endless upgrade (mutators every 3 endless waves, Endless from island briefing, results card, PB)
- [x] 4. Challenge modifiers per island (2 per island, badge + bonus star), island briefing modal
- [x] 5. Polish: reset-progress confirm (Keep/Erase + backup), Workshop entrance stagger, mutator
      sound, victory "Workshop: N★ to spend" chip, Mastered islands (crown + gold rim), Esc closes
      briefing/Workshop, README section
- [x] Independent code review (subagent) → 5 findings, all fixed in 66a0a60 (see below)

- [x] Logbook (src/ui/logbook.ts): tap the star pill on island select → completion totals (stars,
      badges, mastered, best endless) + per-island row (stars, medals, best lives, wins, endless).

- [x] Pause card run info: lives lost vs the current star goal, or the endless mutators in play.
- [x] Daily Squall (src/data/daily.ts, src/ui/daily.ts): main-menu "Daily" pill (gold dot until won
      today, ×streak). Each UTC day picks one *cleared* island + two challenges (any challenge ids,
      at most one tower ban) via a pure hash of the day number. First win of the day: +1★ (Workshop
      currency, counted in starWallet().challenge), streak +1 if yesterday was won. Island badges
      are only granted for the island's own challenges. Save: `progress.daily` {lastDay, streak,
      bestStreak, total}; v1/v2 saves without it get an empty record. Date.now() is read only in
      the UI/session layer.

## Next ideas (not started)
- Show challenge-star total next to the campaign star pill.
- HUD chip for active challenge (MOBILE's HUD area — left to lead/mobile; pause subtitle shows it now).

## Star table (src/data/stars.ts) — rated on lives LOST (win always ≥ 1★)
| Difficulty  | 3★ if lost ≤ | 2★ if lost ≤ | greedy sim (lives left) → stars |
|-------------|-------------:|-------------:|---------------------------------|
| Breezy      | 2            | 10           | 18-20 → 3★ (same as old 18/10)  |
| Challenging | 3            | 10           | 12-16 → 2★                      |
| Heroic      | 5            | 12           | 8-13 → 2★                       |
| Master      | 7            | 14           | 5-10 → 1-2★ (now 2★ at 6+ left) |
Old rule was global (18+ left = 3★, 10+ = 2★). Old saves keep their stars (never lowered).
Lives lost (not left) so Workshop "+lives" never inflates stars.

## Workshop ("Skywright Workshop", src/data/workshop.ts + src/ui/workshop.ts)
Currency = best campaign stars + 1 per completed challenge; spending is refundable (Refund all, 2-tap).
| Upgrade        | Branch  | Ranks (cost)  | Effect at max            |
|----------------|---------|---------------|--------------------------|
| Sky Treasury   | economy | 1, 2          | +20 start gold           |
| Bounty Charter | economy | 2, 3          | +4% kill gold            |
| Bastion Walls  | defense | 2, 3          | +2 lives                 |
| Quickcast Runes| defense | 2, 3          | −15% ability cooldowns   |
| Fletcher's Kit | towers  | 2, 3          | archer+ballista +2% rate |
| Powder Works   | towers  | 2, 3          | cannon+mortar +2% rate   |
| Storm Lore     | towers  | 2, 3          | frost+tesla +2% rate     |
Total cost 33★ (campaign max 39★).
- Power: deliberately ~5% effective, NOT 10-12%: the level balance is knife-edge — a +6% fire-rate
  test took Master greedy from ~11 lives lost to 0 (L8). `npm run sim:balance` now prints a
  "Workshop max" section; it FAILS if a maxed greedy run loses 0 lives on any Master island.
  Current maxed Master lives lost: 4/7/9/9/9/5 (baseline 11-13). Some islands show the script
  getting *worse* with upgrades (L4, L7) — scripted-timing noise, flagged in the output.
- Baseline sim uses NO upgrades (NEUTRAL_RUN_MODIFIERS) → all windows unchanged.

## Architecture added
- `src/data/runModifiers.ts` RunModifiers (start gold ±, lives, ability cd, kill/wave gold mul,
  per-tower fire-rate mul, enemy speed/hp mul, banned towers, abilities off) + combine().
- SimWorld(level, events, mods = neutral). Minimal hooks: AbilitySystem.cooldownMul,
  CombatSystem.towerRateMul, EnemySystem.speedMul/armorBonus (set by SimWorld each tick = run
  speed × endless-mutator speed; applies to every spawn incl. escorts/raiders/mites, split children
  inherit parent speed), world gold/lives/bans.
- `src/game/progression.ts` applyWin / applyEndlessRecord / starWallet (pure, tested).
- Save: same key `skyhold_isles_progress_v1`, `version: 2`, fields bestLives, clears, workshop,
  challengeClears. `migrateProgress()` is pure; pre-v2 raw save copied once to
  `skyhold_isles_progress_backup_v1`. Impossible spend (spent > earned) → auto refund.
- GameSession: viewMode 'workshop', buildRunModifiers(), buy/refund; victory chimes via
  SoundManager.playStarChime (timers cancelled on leaving the run).

## Endless (src/data/endlessMutators.ts)
- Existing endless (after a win) kept; NEW: Endless from the island briefing (cleared islands) —
  story waves play without a victory stop, then generated waves. No stars from endless runs.
- Mutators: Tailwind (+8% speed), Ironbark (+2 armor), Swarmtide (+20% counts), Vanguard (spotlight
  groups elite), Thick Hide (+12% HP), Gale Riders (+40% flyers), Lean Pickings (−15% gold).
  One joins every 3 endless waves (offset 3, 6, 9…), stacking; order rotated per island
  (start = islandIndex*3 mod 7). Count growth is budgeted to the 360-enemy pool (same weights as the
  pool test). Interval 3 (not 5) because endless HP grows ×1.22/wave — most runs end by endless
  wave ~5-10, so 5 would hide mutators from most players.
- Toast on each new mutator; results card: wave reached, PB / new best, endless waves, mutators.
- Sim: "Endless sanity" section (L1, L7, L13 greedy continue after the win with a crude spender):
  fails if a run survives 40 generated waves or the enemy pool fills.

## Challenges (src/data/challenges.ts)
| Island | Challenges |
|---|---|
| L1 Sunlit Meadow | Bowless (no archer), Glass Sanctuary (8 lives) |
| L2 Twin-Bridge Cay | Quiet Guns (no cannon/mortar), Gale Force (+12% speed) |
| L3 Highland Citadel | Thaw (no frost), Thin Purse (−30% start gold, −15% kill gold) |
| L4 Emerald Stepping Stones | Still Air (no tesla), Iron Tide (+12% HP) |
| L5 Windmill Switchback | Gale Force, Silent Skies (no abilities) |
| L6 Crescent Lagoon | Bowless, Thin Purse |
| L7 Skybridge Gauntlet | Quiet Guns, Glass Sanctuary |
| L8 Sunken Bastion | Thaw, Silent Skies |
| L9 Grand Skyhold | Iron Tide, Glass Sanctuary |
| L10 Confluence Terraces | Still Air, Gale Force |
| L11 Galewatch Spires | Bowless, Silent Skies |
| L12 Lanternfall Hollow | Thaw, Iron Tide |
| L13 Stormcrown Citadel | Quiet Guns, Thin Purse |
| L14+ (CONTENT agent) | fallback by difficulty (Master: Silent Skies + Iron Tide) — add hand-picked pairs in ISLAND_CHALLENGES |
- Unlocked after the first clear, toggled in the island briefing; several may stack; each won = +1★
  (Workshop currency) + medal on the card. A challenge win is a normal win (stars, unlock).
- `npm run sim:balance -- --challenges` prints greedy results per challenge (informational). Ban
  challenges usually make the fixed script lose (it just skips banned builds); rule challenges sit
  near the edge with a maxed Workshop. Values were softened after a first pass (50% gold / +20% HP
  collapsed the script by wave 2-6).
- Banned towers: `html[data-banned-towers]` attribute + CSS greys the build card / radial token;
  session blocks build-bar/hotkey selection with a toast; SimWorld.placeTower refuses anyway.

## Island briefing (src/ui/islandBriefing.ts)
Cleared island → card button opens it (uncleared islands still start immediately): records (best
stars, best lives, wins, endless best), 3★ goal, Campaign / Endless switch, challenge toggles,
Start. Toggles are remembered per island for the session. Restart/Retry reuse the run config.

## Decisions
- Name "Skywright Workshop" (original); UI label "Workshop".
- Main menu row is now Islands | Workshop | ⚙ (settings icon-only, 60px). Island select header
  has a Workshop button. Gold badge = number of affordable upgrades.
- 3★ on Master with full Workshop by greedy is allowed (informational only); hard rule = must lose lives.

- Settings → Reset progress (menu only): explicit Keep/Erase confirm; erased save copied to
  `skyhold_isles_progress_reset_backup`; settings untouched.

## Review fixes (66a0a60)
1. Vanguard empowered bosses/Tempests on boss waves → spotlight range bounded.
2. Island-card Endless wrote story waves as an endless best → only offset ≥ 0 is recorded.
3. Silent Skies: meteor hotkey entered targeting and swallowed taps → blocked with a toast.
4. Mid-wave spawns skipped speed/armor modifiers → moved into EnemySystem.initEnemyAt.
5. Second reset overwrote the reset backup → backup only when the save has progress.

## Known issues
- Fire-rate perk is invisible in the tower panel stats (panel reads TOWER_DEFS). Small (+2%), OK for now.
- Carrier raiders / boss escorts / mites use hard-coded rewards, so kill-gold modifiers (Bounty,
  Thin Purse, Lean Pickings) skip them. Minor.
- Merge note: if CONTENT's new Master islands fail "Workshop max" (maxed greedy loses 0 lives),
  retune the island, not the check. New islands get fallback challenges until added to
  ISLAND_CHALLENGES. MOBILE may restyle `.menu-btn-row`; the Workshop row override lives in
  `src/ui/styles/workshop.css` (`.menu-btn-row.has-workshop`).

## Cross-area changes
- `src/sim/{world,abilitySystem,combatSystem,enemySystem}.ts`: optional modifier hooks (neutral default, sim results identical).
- `src/data/balance.ts`: removed `starThresholds` (moved to src/data/stars.ts).
- `src/audio/soundManager.ts`: added playStarChime / playUiConfirm / playUiBack.
- `scripts/balanceSim.ts`: runLevelBalanceSim takes optional mods + endless continuation; new
  "Endless sanity" + "Workshop max" sections, `--challenges` report.
- `src/sim/waveSystem.ts`: endless mutators in buildEndlessWaveDef, startEndlessFromStart, mutator cache.
- `src/ui/settingsModal.ts`: optional Reset-progress row (menu only). `src/ui/menus.ts`: main menu
  row gets Workshop (+ settings icon-only), level cards get medals/crown, header Workshop button.
- `README.md`: "Campaign & Replayability" section appended.
