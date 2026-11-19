# Difficulty — Easy / Normal / Hard

Difficulty is a **layer on top of each island's own tuning**: a deterministic `RunModifiers` patch
(`src/data/difficulty.ts`) stacked after Workshop upgrades and challenges, applied by `SimWorld`
like a challenge. **Normal is the island exactly as tuned (no patch)**, so the layer keeps working
whatever numbers the islands carry (the island rebalance runs on its own branch).

## Numbers

| | Easy (Kolay) | Normal | Hard (Zor) |
|---|---|---|---|
| Foe health | ×0.75 | — | ×1.10 |
| Foe speed | ×0.92 | — | — |
| Starting gold | ×1.25 | — | ×0.90 |
| Lives | +5 (25) | 20 | 20 |
| Hero respawn | — | — | ×1.25 (slower) |
| Stars a win awards | **at most 1** | 1–3 | 1–3 |
| Challenges | off | yes | yes |
| Extra | — | — | **Hard ribbon** on the island medallion + Logbook |

Stacking (`combineRunModifiers`): multipliers multiply, flat values add, the lowest life cap wins.
E.g. Hard + Iron Tide = foes ×1.232 health; Easy's +5 lives add to Workshop lives (and are
ignored under Glass Sanctuary's 8-life cap, like Workshop lives).

New modifier: `RunModifiers.heroRespawnMul` (neutral 1; replays carry it; `HeroSystem` scales the
hero's `respawnSec`).

## Rules

- **Stars / unlocks.** Normal and Hard award the stars the run earned. An Easy win **unlocks the
  next island** and counts as a clear, but awards at most 1 star (the board shows 1 star and says
  "Easy win: 1★ (play Normal or Hard for more)"). The briefing's Easy line ends in "max 1★".
- **Easy carries no challenges** (no bonus-star badges from Easy). Picking Easy clears the
  challenge switches; picking a challenge while on Easy moves the choice to Normal. A hand-made
  `?challenge=…&diff=easy` URL drops the challenges with a warning.
- **Easy keeps the island's "best lives" record untouched** (its +5 lives would inflate it).
- **Daily Squall and Endless always run on Normal** (records stay comparable between players /
  runs). The briefing dims the selector while Endless is on; `&diff=` on a Daily / Endless URL is
  ignored with a warning; the run's board and HUD show no tag on Endless.
- **Best result per difficulty**: the save records the best stars awarded per island per
  difficulty (`ProgressData.difficultyWins = { easy, normal, hard }`, 0 = not won there). The
  briefing shows it on each selector plank (stars; a check for an Easy win).
- **Hard ribbon**: a won-on-Hard island gets a red wax seal with a skull and swallow-tail ribbons
  on its medallion (world map + briefing), a lit seal in its Logbook row, and the Logbook's
  victories total reads "31 victories · 3 on Hard". The first Hard win's board says
  "Hard ribbon earned!" as a reward line.
- **Remembered choice**: the briefing starts on the player's last pick (`localStorage`
  `skyhold_isles_difficulty2d_v1`, default Normal); End-panel *Next Isle* uses it too. Endless runs
  do not change it.

## URL

`?level=<id>&diff=easy|normal|hard` (validated by `resolveQueryRun2D`; unknown values warn and play
Normal). `buildRunHref2D` writes `diff=` only for Easy / Hard. World-map QA:
`?screen=brief&island=3&diff=hard` pre-selects.

## Save migration

`difficultyWins` is optional on `ProgressData`. Saves from before difficulty have none: every win
they hold was played on the island's tuning, so `difficultyWinsOf()` reads them as **Normal** wins
(`normal = bestStars`). The record is written on the first recorded win (derived first, so the old
wins stay Normal), migrated/sanitised by `migrateProgress`, re-indexed by island id in
`remapProgress`, carried in save codes (`dw`), and merged best-of-both by `mergeProgress` (a legacy
side counts as Normal; two legacy saves stay legacy).

## Sim pass (`npm run sim:difficulty`)

Informational only — **not** part of the `sim:balance` gate. Every 2D island (25) on each
difficulty with a few player kits, all on the island's own greedy build script (`weak` = its weak
script):

- `bare` — no hero, no Workshop (the sim:balance gate's reference run)
- `bran1` / `bran10` — the default hero (Bran) at level 1 / 10, scripted to hold the lanes' merge point
- `vet` — Bran 10 + every Workshop upgrade at max (a veteran who picks Hard)

`npm run sim:difficulty -- --md` (2026-11-19, islands as on `art-2d` 301da3d):

| Island | Tier | bare easy | bare normal | bare hard | bran1 normal | bran1 hard | bran10 normal | bran10 hard | vet normal | vet hard | weak easy | weak normal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| l1c | Breezy | W 25/25 3* | W 20/20 3* | W  9/20 1* | W 20/20 3* | W 19/20 3* | W 20/20 3* | W 19/20 3* | W 22/22 3* | W 22/22 3* | W 25/25 3* | W 11/20 2* |
| i01 | Breezy | W 25/25 3* | W 18/20 3* | W 11/20 2* | W 20/20 3* | W 20/20 3* | W 20/20 3* | W 20/20 3* | W 22/22 3* | W 22/22 3* | W 25/25 3* | W 13/20 2* |
| i02 | Challenging | W 25/25 3* | W 15/20 2* | W 11/20 2* | W 20/20 3* | W  8/20 1* | W 15/20 2* | W 10/20 2* | W 22/22 3* | W 12/22 2* | W 15/25 2* | L @14 |
| i03 | Heroic | W 25/25 3* | W  9/20 2* | L @10 | W 14/20 2* | L @15 | W 15/20 3* | L @15 | W 17/22 3* | W  4/22 1* | W 20/25 3* | L @17 |
| i04 | Challenging | W 25/25 3* | W 12/20 2* | L @6 | W 12/20 2* | L @14 | W 18/20 3* | W  5/20 1* | W 22/22 3* | W 16/22 2* | W  6/25 1* | L @14 |
| i05 | Challenging | W 25/25 3* | W 15/20 2* | W  2/20 1* | W 15/20 2* | W 13/20 2* | W 20/20 3* | W 20/20 3* | W 22/22 3* | W 22/22 3* | W 25/25 3* | L @15 |
| i06 | Heroic | W 25/25 3* | W  8/20 2* | L @10 | W 20/20 3* | L @17 | W 20/20 3* | W 10/20 2* | W 22/22 3* | W  6/22 1* | W 25/25 3* | L @17 |
| i07 | Heroic | W 25/25 3* | W 10/20 2* | L @17 | W 15/20 3* | L @18 | W 15/20 3* | W 15/20 3* | W 17/22 3* | W 17/22 3* | L @18 | L @17 |
| i08 | Master | W 25/25 3* | W  6/20 2* | L @6 | W 20/20 3* | L @15 | W 20/20 3* | W  5/20 1* | W 17/22 3* | W  2/22 1* | W 20/25 3* | L @20 |
| i09 | Master | W 25/25 3* | W  5/20 1* | L @22 | W  8/20 2* | L @22 | W 10/20 2* | L @22 | W 12/22 2* | W  5/22 1* | W 12/25 2* | L @22 |
| i10 | Master | W 25/25 3* | W  5/20 1* | L @16 | W  6/20 2* | L @20 | W 13/20 3* | L @20 | W 16/22 3* | L @20 | L @18 | L @11 |
| i11 | Master | W 25/25 3* | W  7/20 2* | L @19 | W 10/20 2* | L @19 | W  9/20 2* | L @19 | W 14/22 2* | L @20 | L @19 | L @17 |
| i12 | Master | W 25/25 3* | W  8/20 2* | L @20 | W 14/20 3* | W  1/20 1* | W 19/20 3* | W 10/20 2* | W 17/22 3* | W 16/22 3* | L @18 | L @15 |
| i13 | Master | W 25/25 3* | W  6/20 2* | L @18 | W  8/20 2* | L @21 | W 13/20 3* | W  3/20 1* | W 16/22 3* | W  5/22 1* | L @22 | L @18 |
| i14 | Master | W 25/25 3* | W  9/20 2* | L @3 | W 19/20 3* | W 15/20 3* | W 20/20 3* | W 17/20 3* | W 22/22 3* | W 22/22 3* | W 25/25 3* | L @22 |
| i15 | Master | W 25/25 3* | W  7/20 2* | L @22 | W 14/20 3* | W 13/20 3* | W 14/20 3* | W 12/20 2* | W 22/22 3* | W 15/22 3* | L @19 | L @9 |
| i16 | Master | W 25/25 3* | W  5/20 1* | L @22 | W 13/20 3* | L @12 | W 13/20 3* | L @24 | W 16/22 3* | W  6/22 1* | L @23 | L @19 |
| i17 | Heroic | W 25/25 3* | W  9/20 2* | L @5 | W 20/20 3* | W 11/20 2* | W 20/20 3* | W 19/20 3* | W 22/22 3* | W 22/22 3* | L @9 | L @6 |
| i18 | Master | W 25/25 3* | W  7/20 2* | L @10 | W 20/20 3* | L @11 | W 20/20 3* | L @11 | W 22/22 3* | L @11 | L @10 | L @5 |
| i19 | Master | W 25/25 3* | W  9/20 2* | L @8 | W 17/20 3* | W  1/20 1* | W 16/20 3* | W 12/20 2* | W 19/22 3* | W 18/22 3* | L @11 | L @8 |
| i20 | Master | W 25/25 3* | W  6/20 2* | L @9 | W 19/20 3* | W  2/20 1* | W 20/20 3* | W 18/20 3* | W 22/22 3* | W 21/22 3* | L @9 | L @7 |
| i21 | Master | W 24/25 3* | W  8/20 2* | L @7 | W 12/20 2* | W  1/20 1* | W 14/20 3* | W 14/20 3* | W 18/22 3* | W 16/22 3* | L @8 | L @6 |
| i22 | Master | W 25/25 3* | W  7/20 2* | W  1/20 1* | W 20/20 3* | W 17/20 3* | W 20/20 3* | W 20/20 3* | W 22/22 3* | W 22/22 3* | L @11 | L @8 |
| i23 | Master | W 25/25 3* | W  9/20 2* | L @5 | W 11/20 2* | L @13 | W 14/20 3* | L @13 | W 19/22 3* | W  6/22 1* | L @9 | L @8 |
| i24 | Master | W 25/25 3* | W  8/20 2* | L @6 | W 19/20 3* | W  4/20 1* | W 18/20 3* | W 15/20 3* | W 18/22 3* | W 16/22 3* | L @11 | L @9 |

`W 19/20 3*` = won with 19 of 20 lives, 3 stars; `L @15` = lost on wave 15.

| Kit / difficulty | Wins | Bleeding wins | Flawless | Avg lives lost |
|---|---|---|---|---|
| bare easy | **25/25** | 1 | 24 | 0.0 |
| bare normal | 25/25 | 24 | 1 | 10.9 |
| bare hard | 5/25 | 5 | 0 | 18.6 |
| bran1 normal | 25/25 | 17 | 8 | 4.6 |
| bran1 hard | 13/25 | 12 | 1 | 15.0 |
| bran10 normal | 25/25 | 15 | 10 | 3.4 |
| **bran10 hard** | **18/25** | **15** | 3 | 10.2 |
| vet normal | 25/25 | 13 | 12 | 2.8 |
| **vet hard** | **22/25** | **16** | 6 | 9.5 |
| weak easy | 10/25 | 5 | 5 | 17.1 |
| weak normal | 2/25 | 2 | 0 | 19.0 |

Verdict against the targets:

- **Easy is comfortably winnable**: the bare greedy script (no hero, no Workshop) wins every
  island, 24 of 25 without losing a life (i21: 24/25). Even the weak script — which on later
  islands stops building and folds by wave 8–11 on Normal — wins 10/25 instead of 2/25.
- **Hard is beatable but bleeds**: a hero-fielding greedy player (Bran 10) wins 18/25 and loses
  lives on 15 of those 18 wins (avg 10 lives lost); a Workshop-maxed veteran wins 22/25 (16
  bleeding). Without a hero the fixed script mostly loses — the 2D game always fields one (Bran is
  selected by default), so the bare run is not the reference for Hard.

### Why not the suggested numbers

The brief suggested Hard = HP ×1.3, speed ×1.06, gold −15%, 10 lives, respawn +25%. The sim says
the greedy scripts are tuned with **no margin** on Normal (bare greedy already loses ~11 lives on
average, and Master isles sit at 5–9 lives left): with that patch bare greedy lost all 25
islands, and on a 3-island probe (l1c, i05, i12) Bran 1 and Bran 10 won 0/3, the veteran 1/3.
Sweeps (`--sweep=hard --kit=…`, grid HP
1.05–1.3 × speed 1/1.04 × gold 0.9/1 × lives 20/15/12/10):

- **Any life cap hurts most**: 10 lives drops Bran-10 wins from 18–21 to 8–13 of 25.
- **Speed is the next-strongest lever**: ×1.04 costs 3–6 wins at the same HP.
- HP ×1.1 + gold ×0.9 + respawn ×1.25 → 18/25 (15 bleeding); HP ×1.1 alone → 21/25 (17 bleeding);
  HP ×1.15 → 14–15/25; HP ×1.2 → 10–12/25; HP ×1.3 → ≤ 8/25.
- Easy sweep (HP 0.65–0.75 × gold 1.25/1.4 × +5/+10 lives): bare greedy wins 25/25 in every
  cell; the weak script moves only 10 → 12 wins (it stalls structurally), so the suggested Easy
  numbers stay.

Results are chaotic per island (a fixed build order hits or misses a timing) — read the totals,
not single cells.

### Re-tuning after the island rebalance

The difficulty numbers depend on how much margin the islands leave. After the rebalance lands:

```
npm run sim:difficulty                    # table + verdict
npm run sim:difficulty -- --sweep=hard --kit=bran10
npm run sim:difficulty -- --sweep=easy
```

and adjust `DIFFICULTIES` in `src/data/difficulty.ts` (the briefing's rule line is generated from
the patch, so no UI text changes are needed).
