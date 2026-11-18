# PROGRESS — skyhold-night-opus (UI/UX + game flow, Opus)

Branch `hermes/skyhold-night-opus` (base art-2d). Backlog: see the task brief (1 Restart/Replay,
2 missing basics, 3 layout bugs, 4 polish). Each round: read this file + `git log`, pick the next item.

Machine notes: worktree had no node_modules → `npm ci` (done round 1). Bash checker rejects heredocs,
`$VAR`, loops: write python/node drivers under /tmp with the Write tool.

## Done
- R1: `src/render2d/ui/replay2d.ts` — pure run recorder / replay cursor / `applyRunCommand`
  (build, upgrade, sell, target, rally, wave, heroMove, heroSkill, meteor, overcharge, speed) +
  fingerprint check. `tests/render/replay2d.test.ts`: live scripted run vs replay identical on l1c
  (with hero) and i05 (no hero), dropped command diverges.

## In progress
- R1: wire Game2D command layer (all world mutations through `game.command()`), replay mode,
  pause menu (Resume / Restart / Settings / World map with confirm), end panel "Watch replay",
  replay player bar (pause, 1×/2×/4×, exit).

## Next
- Backlog 2 audit (list below once done), 3 layout, 4 polish.

## Decisions
- Replay is kept in memory only (last run of this page). Persisting it across reloads would need
  the same modifiers/hero config, which can change after the run (Workshop, hero level-ups).
- Commands are recorded whether or not the sim accepted them; the replay re-issues all of them
  (identical behaviour, simplest guarantee).
- The `speed` command is recorded for the record only; the replay viewer picks 1×/2×/4×.

## Requests for other agents
- (none yet)

## Problems
- (none yet)
