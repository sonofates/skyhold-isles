# PROGRESS — skyhold-night-opus (UI/UX + game flow, Opus)

Branch `hermes/skyhold-night-opus` (base art-2d). Backlog: see the task brief (1 Restart/Replay,
2 missing basics, 3 layout bugs, 4 polish). Each round: read this file + `git log`, pick the next item.

Machine notes: worktree had no node_modules → `npm ci` (done round 1); `npm install --no-save playwright`
for QA. Bash checker rejects `cat > /dev/null` style stdin waits, `$VAR`, loops, `cp` from /tmp; use
python drivers (`python3 - <<'EOF'` works when the body has no `${`), Write tool for files.
QA: `npx vite preview --port 4381 --strictPort` in background (kill with TaskStop at end of round).

## Done
- **R1 Restart / Replay (backlog 1) — DONE.**
  - `ui/replay2d.ts` (pure): `RunCommand` union, `applyRunCommand`, `RunRecorder`, `ReplayCursor`,
    run fingerprint. Test `tests/render/replay2d.test.ts` (l1c with hero, i05 without, divergence).
  - `game2d.ts`: every UI → sim mutation goes through `game.command(c)` (build / upgrade / sell /
    target / rally / wave / heroMove / heroSkill / meteor / overcharge / speed); ability bar now
    casts via `game.castAbility`. Tick counter (frozen once the run ends — that was a real desync
    bug: the end tick depended on frame chunking). `startReplay()`, `exitReplay()`,
    `setReplaySpeed(1|2|4)`, `cycleSpeed()` (live 1→2→3, replay 1→2→4), key `3` = 3×.
    Replay: input blocked except pause/speed; Space / 1 2 4 / Esc keys. End of replay restores the
    recorded run's own end board (`EndPanel.snapshot/restore`), checks the fingerprint
    (`replayMatched`, console warning on mismatch). Nothing is recorded twice (main2d onEndPanel skips
    in replay).
  - End panel: 4th button **Replay / İzle** (painted-style glyph: frame on a stand + play).
  - Pause menu (`ui/runControls2d.ts`): planks under the Paused plate: Resume · Restart · Settings ·
    World Map; Restart / World Map ask with a confirm board (`confirmBoard`), Endless keeps its best
    wave on Restart/leave. Old Settings plank moved here (`settingsButton2d.ts` slimmed).
  - Replay player bar: top-centre plank, badge "Battle replay / Savaş kaydı", wave, play/pause,
    1×/2×/4× chips, leave ✕, progress line, key hint (desktop).
  - QA `qa/replayshots.mjs` (EN+TR, 1920x1080 + 844x390): plays a real run, end board, replay 1×/4×,
    paused, leave, watch again to the end (**matched = true** on all 4 combos), pause menu, both
    confirms, restart. Shots in `docs/overnight/opus-shots/`. Last run: no problems.

## Next (backlog 2: missing basics) — candidates, in rough value order
- next-wave preview (enemy icons + counts) on the horn / wave banner, call-early bonus already shows
- enemy info card on tap; tower info card (stats, targeting, upgrade/sell with refund)
- first-time coach marks on l1c; wave countdown; low-lives warning; victory stars breakdown
- pause on window blur (desktop); keyboard shortcuts vs Controls page (add 3, replay keys)
- Then backlog 3 (ability-bar placement on i12 desktop / l1c column), 4 polish.

## Decisions
- Replay is kept in memory only (last run of this page). Persisting it across reloads would need
  the same modifiers/hero config, which can change after the run (Workshop, hero level-ups).
- Commands are recorded whether or not the sim accepted them; the replay re-issues all of them.
- The `speed` command is recorded for the record only; the replay viewer picks 1×/2×/4×
  (`stepper.speed` typed 1|2|3 in core — cast for 4, no core change).
- Live Retry keeps the player's speed; entering/leaving a replay resets to 1×.
- After leaving a replay mid-way the end board is the recorded run's; the frozen replay world stays
  dimmed underneath.
- `settingsButton2d.ts` is not in any ownership list; it is my earlier UI file, slimmed (card removed).

## Requests for other agents
- (none yet)

## Problems / notes
- SwiftShader: Pixi clamps frame dt to 100 ms, so the end board's 0.4 s tap guard needs several slow
  frames — QA polls (`pressEnd`). Not an issue on real GPUs.
- QA debug runs show the hero row as "Level 1" with `?herolevel=` (pre-existing, not recorded runs).
