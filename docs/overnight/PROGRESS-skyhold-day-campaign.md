# PROGRESS — skyhold-day-campaign (CAMPAIGN & REPLAYABILITY)

Branch `hermes/skyhold-day-campaign` (base main @5149e2f). Deadline 21:00 TR (18:00 UTC).
Green gate after every commit: `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance`.
(Worktree had no node_modules: run `npm ci` first in a fresh checkout.)
Screenshots: `.tune/` is gitignored — `.tune/shot.mjs` (playwright-core installed in `.tune/pw`) +
`npx vite preview --port 4301`. Scenes: menu, levels, workshop, workshop-buy, win, lose (?debug Win/Lose).

## Plan / status
- [x] 1. Stars per difficulty (lives-lost table), best result per island, save v2 migration, victory star reveal
- [x] 2. Workshop upgrade tree (stars currency, refundable) + RunModifiers sim hook + max-upgrade sim check
- [ ] 3. Endless upgrade (mutators every N waves, start endless from island card, results screen, PB)
- [ ] 4. Challenge modifiers per island (bonus star / badge)
- [ ] 5. Polish (level card best-result line, transitions, reset-progress confirm in settings, empty states)

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
  CombatSystem.towerRateMul, EnemySystem.speedMul (wave spawns only), world gold/lives/bans.
- `src/game/progression.ts` applyWin / applyEndlessRecord / starWallet (pure, tested).
- Save: same key `skyhold_isles_progress_v1`, `version: 2`, fields bestLives, clears, workshop,
  challengeClears. `migrateProgress()` is pure; pre-v2 raw save copied once to
  `skyhold_isles_progress_backup_v1`. Impossible spend (spent > earned) → auto refund.
- GameSession: viewMode 'workshop', buildRunModifiers(), buy/refund; victory chimes via
  SoundManager.playStarChime (timers cancelled on leaving the run).

## Decisions
- Name "Skywright Workshop" (original); UI label "Workshop".
- Main menu row is now Islands | Workshop | ⚙ (settings icon-only, 60px). Island select header
  has a Workshop button. Gold badge = number of affordable upgrades.
- 3★ on Master with full Workshop by greedy is allowed (informational only); hard rule = must lose lives.

## Known issues
- Fire-rate perk is invisible in the tower panel stats (panel reads TOWER_DEFS). Small (+2%), OK for now.

## Cross-area changes
- `src/sim/{world,abilitySystem,combatSystem,enemySystem}.ts`: optional modifier hooks (neutral default, sim results identical).
- `src/data/balance.ts`: removed `starThresholds` (moved to src/data/stars.ts).
- `src/audio/soundManager.ts`: added playStarChime / playUiConfirm / playUiBack.
- `scripts/balanceSim.ts`: runLevelBalanceSim takes optional mods; new "Workshop max" check.
