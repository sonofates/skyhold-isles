# P6 handoff

The working tree on `codex/p6-audio-perf` contains the 2D audio and performance changes. The baseline revision was `854d34a`.

## Implementation

- `src/render2d/audio2d.ts` and the hooks in `src/render2d/game2d.ts` install one mixer for the world map and gameplay. Each new run binds its own events and selects the original campaign island's score. Build, wave, boss and end scenes follow the sim. Melee anticipations use the soldier's position, and blows and projectile impacts use their target position.
- `src/audio/soundManager.ts` and `src/audio/voiceCap.ts` reuse the procedural voices and music engine. Each enemy kind has a death pitch. Barracks have separate swing and contact sounds. Stereo buses keep ringing notes at their original screen position. Each cue type admits at most six live or scheduled oscillator/noise sources, with slots returned on completion. Signature shot layers share their shot's admission check.
- `src/render2d/renderResolution.ts` and `game2d.ts` select the framebuffer density and apply the quality override or automatic downgrade. `src/render2d/fxLayer.ts` and `slotPool.ts` bound particle admissions, batch additive sprites on reduced tiers and reuse particle slots. `enemyLayer.ts` and `projectileLayer.ts` avoid per-frame position objects and create flash and shadow sprites on demand.
- `tests/audio/audio2d.test.ts` covers event routing, stereo placement, unbinding and simultaneous voice limits. `tests/render/renderResolution.test.ts` covers sustained pressure, background timing, overrides and tier resolution.
- `qa/p6-bench.mjs` drives a timed production-build benchmark. [P6 performance measurements](p6-perf.md) contains the reproduction commands, percentiles and remaining device qualification.

## Verification

| Gate | Result |
| --- | --- |
| TypeScript | Passed |
| ESLint | Passed |
| Vitest | 1,037 passed, 11 skipped, 0 failed. All 11 skips belong to the existing optional happy-dom suite. |
| Simulation balance | 33 of 33 levels passed. The complete 645-line output matched the pre-change run byte for byte. |
| Production build | Passed on Node 22.21.1. Vite reported its chunk-size advisory. |

A Chromium smoke check on the Settings screen verified that a keypress creates the first audio context, the menu schedules notes, keyboard volume steps change master gain, and mute silences the master gain. The check exercised hidden/visible handlers with a synthetic visibility transition and observed the real context suspend and resume. In a separate wave-20 document, a pointer gesture started combat audio and created multiple stereo buses.

## Owner follow-up

- Qualify sustained frame pacing on a physical 4 GB Mali Android phone and unlock/resume on iOS Safari. The software-rendered runs include long frames. The 30 fps floor is still open.
- The Settings screen still describes the painted isles as silent. Its Sound and Volume controls work. The localisation owner can update the two explanatory strings and their quiet styling in `src/render2d/ui/metaScreens.ts`.
- The menu mixer installs when the shared 2D game module loads. The benchmark uses the existing numeric `bench` and `level` routing, with `wave=20` for the stress fixture.
