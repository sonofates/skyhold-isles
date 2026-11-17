# PROGRESS — skyhold-day-campaign (CAMPAIGN & REPLAYABILITY)

Branch `hermes/skyhold-day-campaign` (base main @5149e2f). Deadline 21:00 TR (18:00 UTC).
Green gate after every commit: `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance`.
(Worktree had no node_modules: run `npm ci` first in a fresh checkout.)

## Plan / status
- [ ] 1. Stars per difficulty (lives-lost table), best result per island, save v2 migration, victory star reveal, card stars
- [ ] 2. Workshop upgrade tree (stars currency, refundable) + RunModifiers sim hook + max-upgrade sim check
- [ ] 3. Endless upgrade (mutators every N waves, start endless from island card, results screen, PB)
- [ ] 4. Challenge modifiers per island (bonus star / badge)
- [ ] 5. Polish (transitions, sounds, reset-progress confirm in settings, empty states)

## Decisions
(see below as they are made)

## Known issues

## Cross-area changes
