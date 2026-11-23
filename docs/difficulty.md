# Difficulty — Easy / Normal / Hard

The Easy and Hard patches in `src/data/difficulty.ts` stack on the painted island’s own tuning
after Workshop upgrades and challenges. Normal applies the island’s authored values directly.

## Numbers

| Rule | Easy (Kolay) | Normal | Hard (Zor) |
|---|---:|---:|---:|
| Foe health | ×0.65 | ×1 | ×1.09 |
| Foe speed | ×0.92 | ×1 | ×1 |
| Starting gold from island | ×1.25 | ×1 | ×0.87, then −250 gold |
| Kill gold | ×1 | ×1 | ×1.30 |
| Starting lives before Bastion | 25 | 20 | 20 |
| Global ability cooldowns | ×1 | ×1 | ×1.25 |
| Hero respawn time | ×1 | ×1 | ×1.25 |
| Stars awarded per win | 1 | 1–3 | 1–3 |
| Challenges available | No | Yes | Yes |
| Hard ribbon | | | On victory |

The world rounds the island’s scaled starting gold, adds the difficulty and Workshop flat
adjustments, then floors the result at zero. Hard opens Meadow Crossing with Bran and the two
spells. The first kills fund the first tower. Later islands with larger treasuries can open with
towers, and the higher kill bounty helps fund upgrades. Easy’s five extra lives stack with
Bastion. A challenge life cap takes precedence over bonus lives.

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

## Campaign simulation

Current per-island results are in [Normal campaign rebalance v2](rebalance-normal-v2.md). The table below records the earlier difficulty pass.

The primary columns use the greedy tower order, Bran and his level-appropriate skills, Workshop
purchases, Meteor and Overcharge. The simulator uses the same combat driver and first-clear kit
as `sim:balance`. Chapter one includes Meadow Crossing through i16. Chapter two spans i17–i24.

- **Easy** starts with a fresh save. Each greedy win advances the next island’s entry XP and adds
  its one awarded star to the Workshop budget. This measures whether a newcomer can finish using
  the upgrades available on Easy.
- **Normal** builds its entry kits from the preceding greedy Normal clears and their actual XP
  and stars, as in the rebalance.
- **Hard** attempts each island with the corresponding Normal entry kit. This models a player
  trying for Hard ribbons as islands unlock and gives later attempts a reachable inventory even
  when the script loses an earlier Hard island.
- **Weak** uses the island’s weak tower order with the same entry kit as greedy on that difficulty.
  **Bare** uses the greedy tower order with towers alone.

In the table, `W 3/22 1★` means the keep survived with three of its 22 lives and the player
received one star. `L @14` means defeat on wave 14. Win stars include the Easy reward cap.
Generate the current table with `npm run sim:difficulty -- --md`. A filtered run such as
`npm run sim:difficulty -- --levels=i24` reconstructs the same entry inventories.

| Island | campaign easy | campaign normal | campaign hard | weak easy | weak normal | weak hard | bare easy | bare normal | bare hard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| l1c | W 25/25 1★ | W 20/20 3★ | W 17/20 2★ | W 25/25 1★ | W 20/20 3★ | W 10/20 2★ | W 25/25 1★ | W 20/20 3★ | L @2 |
| i01 | W 25/25 1★ | W 20/20 3★ | W 14/20 2★ | W 25/25 1★ | W 20/20 3★ | W 14/20 2★ | W 25/25 1★ | W 18/20 3★ | L @2 |
| i02 | W 25/25 1★ | W 21/21 3★ | W 16/21 2★ | W 25/25 1★ | W 16/21 2★ | W 6/21 1★ | W 25/25 1★ | W 15/20 2★ | L @2 |
| i03 | W 25/25 1★ | W 21/21 3★ | W 2/21 1★ | W 25/25 1★ | L @18 | L @15 | W 25/25 1★ | L @6 | L @2 |
| i04 | W 25/25 1★ | W 21/21 3★ | W 6/21 1★ | W 15/25 1★ | W 3/21 1★ | L @14 | W 25/25 1★ | L @14 | L @2 |
| i05 | W 26/26 1★ | W 21/21 3★ | W 3/21 1★ | W 26/26 1★ | W 7/21 1★ | L @15 | W 25/25 1★ | L @7 | L @2 |
| i06 | W 26/26 1★ | W 11/21 2★ | L @12 | W 21/26 1★ | L @17 | L @16 | W 25/25 1★ | L @6 | L @2 |
| i07 | W 26/26 1★ | W 16/21 3★ | W 1/21 1★ | W 4/26 1★ | L @18 | L @17 | W 25/25 1★ | L @10 | L @2 |
| i08 | W 26/26 1★ | W 17/22 3★ | L @6 | W 26/26 1★ | L @20 | L @6 | W 25/25 1★ | L @2 | L @1 |
| i09 | W 26/26 1★ | W 17/22 3★ | W 12/22 2★ | W 26/26 1★ | L @22 | L @22 | W 25/25 1★ | L @18 | L @1 |
| i10 | W 26/26 1★ | W 20/22 3★ | W 6/22 1★ | L @20 | L @19 | L @11 | W 25/25 1★ | L @17 | L @2 |
| i11 | W 26/26 1★ | W 18/22 3★ | W 3/22 1★ | W 3/26 1★ | L @17 | L @17 | W 25/25 1★ | L @17 | L @1 |
| i12 | W 26/26 1★ | W 16/22 3★ | W 11/22 2★ | L @19 | L @17 | L @17 | W 25/25 1★ | L @16 | L @1 |
| i13 | W 26/26 1★ | W 12/22 2★ | W 3/22 1★ | W 4/26 1★ | L @20 | L @14 | W 25/25 1★ | L @8 | L @1 |
| i14 | W 26/26 1★ | W 13/22 2★ | L @2 | W 21/26 1★ | L @21 | L @2 | W 24/25 1★ | L @2 | L @1 |
| i15 | W 26/26 1★ | W 11/22 2★ | L @5 | W 20/26 1★ | L @19 | L @5 | W 22/25 1★ | L @5 | L @1 |
| i16 | W 23/26 1★ | W 11/22 2★ | L @4 | W 21/26 1★ | L @23 | L @4 | L @2 | L @2 | L @1 |
| i17 | W 26/26 1★ | W 8/22 1★ | W 6/22 1★ | L @10 | L @9 | L @7 | W 25/25 1★ | L @4 | L @2 |
| i18 | W 26/26 1★ | W 9/22 2★ | L @4 | L @11 | L @9 | L @5 | L @11 | L @3 | L @2 |
| i19 | W 26/26 1★ | W 10/22 2★ | L @9 | W 15/26 1★ | L @11 | L @8 | W 20/25 1★ | L @5 | L @2 |
| i20 | W 26/26 1★ | W 7/22 1★ | L @9 | L @11 | L @9 | L @8 | W 21/25 1★ | L @4 | L @2 |
| i21 | W 27/27 1★ | W 5/22 1★ | L @5 | L @10 | L @5 | L @5 | L @5 | L @5 | L @2 |
| i22 | W 27/27 1★ | W 4/22 1★ | W 8/22 2★ | L @13 | L @10 | L @9 | W 8/25 1★ | L @5 | L @2 |
| i23 | W 26/27 1★ | W 9/22 2★ | W 10/22 2★ | L @12 | L @6 | L @6 | W 22/25 1★ | L @5 | L @2 |
| i24 | W 27/27 1★ | W 3/22 1★ | W 5/22 1★ | L @13 | L @10 | L @9 | W 17/25 1★ | L @6 | L @2 |

| Profile | Easy wins | Normal wins | Hard wins |
|---|---:|---:|---:|
| Campaign greedy | 25/25 | 25/25 | 16/25 |
| Weak | 16/25 | 5/25 | 3/25 |
| Bare greedy | 22/25 | 3/25 | 0/25 |

Easy’s lowest greedy finish is 23 lives. Weak wins 15/17 in chapter one. Hard greedy wins 12/17 in chapter one and 4/8 in chapter two. All 16 wins cost lives (9 one-star and 7 two-star). Lastlight Head ends at 5/22 lives. Weak loses 22/25 on Hard.
