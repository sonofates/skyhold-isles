# Handoff: the game's ending (campaign complete)

Task K, branch `hermes/sky-ending` (base `integ/ch5`). Date 2026-11-25.

When the player wins the **last chapter's finale** for the first time (`campaignFinaleId()` in
`src/data/chapters.ts` — the last chapter with a `finale`, which is Chapter 5's `i45` today; nothing
hard-codes a flat index), the campaign is complete:

1. after i45's outro story (if it has one), the **ending**: 3 story beats in the storybook card,
2. the **credits roll** (skippable),
3. back on the **world map**, a one-time **"Campaign complete"** card.

Island/level data, enemies and balance are untouched. i43–i45 are not registered yet
(`playableThrough: 'i42'`), so in today's build the in-run trigger cannot fire; it starts working
the moment `i45` is in `LEVELS_2D`, with no change here.

## The `campaignComplete` hook (for the i43–i45 builder)

That name is the only coordination point:

- **Save flag** `ProgressData.campaignComplete?: true` (`src/core/types.ts`). Only ever `true` or
  absent. Set when the finale's win is recorded (`applyRunResult2D` / `recordWin2D` in
  `src/render2d/ui/progress2d.ts`).
- **Run record** `RunResultRecord2D.campaignComplete?: true`: set only on the run that completed
  the campaign (first recorded win of the finale, any difficulty). `main2d.ts` reads it in
  `onEndPanel` and calls `routing.playEndingAfterWin(...)` once i45's outro story has closed
  (`playStoryOnce` resolves).
- **Query** `isCampaignComplete(progress, levels)` (progress2d.ts): flag, or (save from before the
  flag) a recorded win of the finale.

The finale builder only needs to give i45 its outro story (`PLACEHOLDER_STORY.i45.outro` or level
data) as for any island; the ending follows it automatically.

## What changed

| File | Change |
|---|---|
| `src/data/chapters.ts` | `campaignFinaleId()` (derived from the chapter list). |
| `src/core/types.ts` | `ProgressData.campaignComplete?: true`. |
| `src/platform/storage.ts` | `migrateProgress` keeps the flag (`campaignComplete === true`, or `cc` from a save code). |
| `src/platform/saveCode.ts` | Save code carries it as `cc: 1`; `mergeProgress` ORs it (either device finished). |
| `src/render2d/ui/progress2d.ts` | `isCampaignComplete`; flag kept by `remapProgress`; `loadProgress2D` sets it on old saves that already won the finale (written on the next save); `applyRunResult2D`/`recordWin2D` set it and report `campaignComplete` on the completing run only. |
| `src/render2d/ui/ending2d.ts` (new) | Art slots, beats, `playEnding` (beats → roll → `onDone`), `campaignSummary` / `campaignNudges`, `showCampaignCard`. |
| `src/render2d/ui/creditsRoll2d.ts` (new) | The credits roll: `rollBlocks`, `ROLL_ROLES`, `rollOffset`, `openCreditsRoll`. |
| `src/render2d/ui/ending2d.css` (new) | Roll and card styles (desktop + `html.pu-phone`). |
| `src/render2d/ui/storyPanels.ts` | `showStory(level \| null, …, opts)`: optional title / kicker / last-button label / testid (islands unchanged). |
| `src/render2d/ui/chapterState.ts` | `CardsSeen.campaign?`; `cardsDue(chapters, seen, campaignComplete)` returns `campaign` (once) and drops the last chapter's "Chapter complete" card in its favour. |
| `src/render2d/ui/chapterCards.ts` | The last chapter's "Chapter complete" card shows "The last chapter of the voyage…" (`chapter.doneFinal`) and only the map button: no next chapter, no "coming soon". `spread` exported. |
| `src/render2d/ui/worldMap.ts` | Shows the campaign card when due; QA screens `ending`, `endcredits[&at=]`, `campaign`. |
| `src/render2d/ui/inGame.ts` | `playEndingAfterWin` (ending, then the world map). |
| `src/render2d/main2d.ts` | Trigger after the outro; QA `?end=won&story=ending`. |
| `src/render2d/ui/metaScreens.ts` | Settings → General → "The ending" / **Watch** (`set2d-ending`), shown only after the campaign. |
| `src/i18n/en.ts`, `tr.ts` | `chapter.doneFinal`, `ending.*` (EN + TR). |
| `tests/ui/ending.test.ts` (new) | 19 tests (below). |
| `qa/endingshots.mjs`, `qa/endingflow.mjs` (new) | Browser QA. |
| `docs/ending-shots/` | 6 shots. |

### 1. Ending sequence

`playEnding(manifest, onDone)` opens the existing storybook card with three beats told by Warden Pell
(title "Epilogue", kicker "The end of the voyage"; TR "Son Söz" / "Yolculuğun sonu"):

1. the eclipse breaks (`ending.beat1`), 2. the first light reaches Skyhold (`ending.beat2`),
3. the isles are rebuilt (`ending.beat3`). The last button ("Onward") or Skip goes to the credits.

**Art slots:** `ENDING_ART_SLOTS = story-ending-1..3`, read from `manifest.paintedUi['story-ending-N']`
(e.g. `"story-ending-1": "ui/story-ending-1.webp"`). A registered slot is used automatically; until
then the placeholders (`ENDING_PLACEHOLDER_ART`): `story-i41-outro-1` (light through the sundial),
`story-l1c-intro-1` (Skyhold on its hill), `story-i09-outro-1` (a beacon lit again). The painter
only has to add the webp files and the three manifest lines. The campaign card uses beat 3's painting.
The slots are not in `manifest.json` yet: a manifest entry pointing to a missing file would 404.

### 2. Credits roll

`openCreditsRoll(onDone)`: painted board (credits board style, ribbon = game title) whose column
scrolls up on its own (one window height per 9 s) and stops with **"Thank you for playing!"**
centred, holds 3.2 s, closes. Skip: tap/click anywhere, Esc, Enter, Space, or the Skip plank (input
in the first 450 ms is ignored so the tap that closed the story does not also skip the roll).
Reduced motion: nothing moves, the column scrolls by hand, same skip inputs.

Contents: game title + tagline, **"The crew"** with 8 roles (design, programming, art direction,
music and sound, story and writing, localization, playtesting, production), then the existing
credits sections (`creditSections()`: Made by, Painted art, Built with, Lettering, Other assets).
**Every role's `who` is `null` with a `// TODO(owner)` comment** in `ROLL_ROLES` and shows "Names to
come" / "İsimler yakında". No studio, brand or person name was invented (brand is owner-gated).

### 3. Post-game

After the roll, `main2d` navigates to the world map. `cardsDue` sees `isCampaignComplete` and an
unseen `campaign` in `skyhold2d_chapter_cards_v1`: the **"Campaign complete!"** card shows once
(instead of Chapter 5's "Chapter complete"): total stars x/max over every registered island
(Prologue included), "Isles mastered: n/N", and "Still out there": Hard ribbons n/N and three-star
isles n/N (only while some are missing), Endless (best wave when there is one), Daily Squall.
Next visit: nothing. The full sequence never plays again by itself; Settings → General → "The
ending" → Watch replays beats + roll over the map.

Backward compatibility: a save with no flag that already won i45 reads as complete (no ending
replay, the card shows once since it was never seen); saves without i45 in the roster are never
complete by inference. A "cards seen" record without `campaign` parses as before.

## Verification

- `npx tsc --noEmit` ✓, `npm run lint` ✓.
- `tests/ui/ending.test.ts` (19, with `happy-dom` installed `--no-save`; DOM part skips without it):
  finale id derived from chapters.ts; trigger on the first i45 win only (not on replays, Hard
  replays, losses, Endless, nor on l1c/i09/i16/i24/i36/i37/i44); Hard first win triggers; pre-flag
  save that won i45 does not trigger; saved via `recordRunResult2D` and loads back; old-save
  migration; flag through `migrateProgress`, `remapProgress` reorder, save code, `mergeProgress`;
  `cardsDue` campaign once + replaces ch5's card; old seen records; summary + nudges; art slots
  picked up when registered, placeholders exist on disk; EN/TR keys; roll blocks (title first,
  thanks last, all roles unnamed); **skip works** (click after guard, Esc, Skip, Enter; done fires
  once); Chapter 5's "Chapter complete" card has no next-chapter button and no "Chapter 6"/"coming
  soon" text.
- Full gate, all green (2026-11-25): `tsc` ✓, `lint` ✓, `vitest run` 2099/2099 ✓,
  `sim:balance` PASSED (59 levels), `sim:items -- --workers=2` all PASS, `sim:difficulty` all PASS,
  `build` ✓ (only the pre-existing INEFFECTIVE_DYNAMIC_IMPORT warnings). Sims are unchanged by
  design: nothing in the sim, data or balance was touched.
- Browser QA, ONE Chromium, vite dev server on its own port, stopped after each run:
  `qa/endingshots.mjs` (EN with shots, TR checks-only) at 1280x800 and 932x430: no page errors,
  boards and buttons inside the viewport, nothing cut, roll moves by itself and a tap / Esc skips
  it, campaign card shows once and not on reload, "Watch ending" only after the campaign and it
  opens the ending. `qa/endingflow.mjs`: `?level=l1c&end=won&story=ending` → beats → roll → lands
  on the world map.
- Shots (`docs/ending-shots/`): `ending-beat1-*`, `credits-mid-*` (`?screen=endcredits&at=0.42`),
  `campaign-card-*`, each at 1280x800 and 932x430.

QA jump params (world map): `2d.html?screen=ending`, `?screen=endcredits&at=0.42` (paused there),
`?screen=campaign`; in a run `?level=<id>&end=won&story=ending`. `window.__ending` /
`window.__roll` expose phase / progress / seek / pause.

## Steam (proposal, owner-gated: not added to `desktop/achievements.json`)

No achievement covers finishing the campaign. Proposed:

| id | name | description | unlock |
|---|---|---|---|
| `CAMPAIGN_COMPLETE` | The Eclipse Breaks | Win the Eclipse Throne and finish the campaign | `progress.campaignComplete === true` |

The flag makes the rule trivial in `src/platform/achievements.ts` without importing `levels2d`
(that file must not). Optional follow-up, same shape as `HARD_BOSS_I24`: `HARD_BOSS_I45`.

## Open issues

- **Names** in the credits roll: `ROLL_ROLES` in `creditsRoll2d.ts` (8 `TODO(owner)`), and the
  existing "Made by" line (`credits.teamBody`). Owner decision (brand).
- **Art**: `story-ending-1..3` to be painted and registered in `public/art2d/manifest.json → paintedUi`.
- **Copy**: the three beats are placeholder copy in Pell's voice; the i45 outro (finale builder)
  should lead into beat 1 (the Sovereign falling) without repeating it.
- No music cue for the ending/roll yet (the map music keeps playing).
- The in-run trigger cannot be exercised end-to-end with a real i45 until it is registered; it is
  covered by unit tests on a roster with i43–i45 stand-ins and by the `?story=ending` flow probe.
