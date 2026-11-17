# PROGRESS — skyhold-day-content (CONTENT agent, day pass 2)

Branch `hermes/skyhold-day-content`. Deadline 21:00 TR. Rounds = fresh sessions; this file + git log are the only memory.

## Architecture (what exists)
- `src/platform/contentStorage.ts` — `ContentStore`: own versioned localStorage keys `skyhold_isles_codex_v1`
  (`{v:1, seen:[ids]}`; ids `enemy:<type>`, `tower:<type>`, `elite`) and `skyhold_isles_onboarding_v1`
  (`{v:1, status: pending|done|skipped}`). `migrate()` runs once: veterans (unlocked>0 or any stars) get the tour
  marked done and every foe on islands they played marked seen; legacy `enemy_intros_seen` toast key is honoured.
  Never reads/writes progress or settings keys.
- `src/ui/content/onboardingMachine.ts` — pure state machine (build → startWave → upgrade → ability → done),
  driven by observations of the game; `coachMessage()` picks touch/desktop text + highlight target.
- `src/ui/content/codexData.ts` — pure text/stat data for codex + cards (`ENEMY_LORE`, `TOWER_LORE`, entries).
- `src/ui/content/firstSighting.ts` — `SightingQueue` (dedupe + order), `waveHasElite`.

## Done
1. Pure logic + tests: storage/migration, onboarding machine, codex data, sighting queue.

## Next
- DOM layer: coach mark, sighting card, codex screen (+ CSS in `src/ui/styles/`), director glue, entry points.
- Hook into GameSession/main (minimal), settings "Replay tutorial".
- L14–L16 islands + theme table + balanceSim entries.
- Description text pass.

## Decisions
- Veterans never see the tour; cards only for foes they have not fought (inferred from progress).
- Tour runs on island 1 only; level restart resets it to step 1; give-up after 5 waves without upgrading.

## Known issues
(none yet)

## Cross-area changes
(none yet)
