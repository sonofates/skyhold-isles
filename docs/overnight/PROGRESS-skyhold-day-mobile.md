# PROGRESS — skyhold-day-mobile (MOBILE FEEL & PERFORMANCE)

Branch `hermes/skyhold-day-mobile`. Preview port 4302. Deadline 21:00 TR.

## Tooling notes (for later rounds)
- `npm ci` is needed in a fresh worktree (no node_modules).
- Screenshot harness lives in `.shots-tool/` (gitignored; `npm i --prefix .shots-tool playwright-core`).
  `node .shots-tool/shoot.mjs <outDir> 1-13 p390x844,l844x390,p360x640,t820x1180,d1440x900` (needs `vite preview` on 4302).
  Chromium: `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`
  (launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`). Seeds save so all islands are unlocked.
- Compound shell commands (`a && b`, `a; b`) trigger permission prompts in this sandbox — issue one command per Bash call.

## Done
- (round 1) Harness set up; baseline screenshots of 13 islands × 5 sizes taken (/tmp/shots-before, not committed).

## Next
1. Per-island camera framing (backlog #1) — existing `src/render/cameraFit.ts` frames by generic insets; make it HUD-rect aware.
2. Touch controls (#2), 3. adaptive quality (#3), 4. HUD polish (#4), 5. PWA (#5).

## Decisions

## Known issues

## Cross-area changes
