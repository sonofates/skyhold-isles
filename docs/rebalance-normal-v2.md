# Normal campaign rebalance v2

A fresh Bran campaign loses lives on all 25 islands and earns 2★ on 19. Chapter one now costs 112 lives across 17 islands, up from 75. Chapter two costs 81 across eight islands, down from 127. This moves pressure into the opening and middle of the campaign and gives the final chapter room for alternate heroes to finish. The largest drop between adjacent islands is three lives.

## Item-free first clears

Each cell shows **lives lost / stars awarded**, before → after. Losses include Bastion. A defeat consumes the starting life total and awards 0★. The baseline is `ca8e414b` on `art-2d`.

The greedy Normal run earns its own Workshop stars and hero XP from the tutorial onward. Weak uses the same entry inventory with the weaker build order. Towers alone uses that weak order with no hero, spells or Workshop. Easy progresses with its one-star reward cap. Hard attempts each ribbon with the corresponding Normal entry inventory. Each before/after campaign starts from a fresh save.

| Island | Normal greedy | Normal weak | Normal weak, towers alone | Easy greedy | Easy weak | Hard greedy | Hard weak |
|---|---|---|---|---|---|---|---|
| l1c | 0/3★ → 2/3★ | 0/3★ → 2/3★ | 9/2★ → 13/1★ | 0/1★ → 0/1★ | 0/1★ → 0/1★ | 3/2★ → 3/2★ | 10/2★ → 3/2★ |
| i01 | 0/3★ → 2/3★ | 0/3★ → 2/3★ | 7/2★ → 13/1★ | 0/1★ → 0/1★ | 0/1★ → 0/1★ | 6/2★ → 12/1★ | 6/2★ → 12/1★ |
| i02 | 0/3★ → 5/2★ | 6/2★ → 10/2★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 0/1★ → 5/1★ | 6/2★ → 13/1★ | 18/1★ → 21/0★ |
| i03 | 5/3★ → 5/3★ | 21/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 9/1★ → 12/1★ | 21/0★ → 21/0★ | 21/0★ → 21/0★ |
| i04 | 0/3★ → 5/2★ | 21/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 10/1★ → 16/1★ | 21/0★ → 21/0★ | 21/0★ → 21/0★ |
| i05 | 3/3★ → 5/2★ | 21/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 0/1★ → 0/1★ | 21/0★ → 21/0★ | 21/0★ → 21/0★ |
| i06 | 10/2★ → 6/2★ | 21/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 0/1★ → 0/1★ | 21/0★ → 21/0★ | 21/0★ → 21/0★ |
| i07 | 0/3★ → 5/3★ | 21/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 16/1★ → 16/1★ | 17/1★ → 12/2★ | 21/0★ → 21/0★ |
| i08 | 6/3★ → 6/3★ | 22/0★ → 21/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 0/1★ → 0/1★ | 22/0★ → 21/0★ | 22/0★ → 21/0★ |
| i09 | 2/3★ → 6/3★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 8/1★ → 0/1★ | 0/3★ → 8/2★ | 22/0★ → 22/0★ |
| i10 | 3/3★ → 8/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 7/3★ → 12/2★ | 22/0★ → 22/0★ |
| i11 | 5/3★ → 11/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 2/1★ → 4/1★ | 20/1★ → 10/1★ | 22/0★ → 22/0★ | 22/0★ → 22/0★ |
| i12 | 2/3★ → 9/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 14/2★ → 13/2★ | 22/0★ → 22/0★ |
| i13 | 11/2★ → 11/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 1/1★ → 1/1★ | 9/2★ → 8/2★ | 22/0★ → 22/0★ |
| i14 | 10/2★ → 8/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 7/1★ → 5/1★ | 22/0★ → 22/0★ | 22/0★ → 22/0★ |
| i15 | 9/2★ → 9/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 6/1★ → 6/1★ | 19/1★ → 19/1★ | 22/0★ → 22/0★ |
| i16 | 9/2★ → 9/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 19/1★ → 19/1★ | 22/0★ → 22/0★ |
| i17 | 14/1★ → 12/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 16/1★ → 9/2★ | 22/0★ → 22/0★ |
| i18 | 14/2★ → 10/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 18/1★ → 18/1★ | 22/0★ → 22/0★ |
| i19 | 15/1★ → 10/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 23/1★ → 23/1★ | 18/1★ → 20/1★ | 22/0★ → 22/0★ |
| i20 | 16/1★ → 10/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 26/0★ → 26/0★ | 22/0★ → 22/0★ | 22/0★ → 22/0★ |
| i21 | 17/1★ → 10/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 27/0★ → 27/0★ | 22/0★ → 22/0★ | 22/0★ → 22/0★ |
| i22 | 14/2★ → 11/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 27/0★ → 27/0★ | 22/0★ → 22/0★ | 22/0★ → 22/0★ |
| i23 | 18/1★ → 9/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 27/0★ → 27/0★ | 14/2★ → 22/0★ | 22/0★ → 22/0★ |
| i24 | 19/1★ → 9/2★ | 22/0★ → 22/0★ | 20/0★ → 20/0★ | 0/1★ → 0/1★ | 27/0★ → 27/0★ | 20/1★ → 19/1★ | 22/0★ → 22/0★ |

Easy clears 25/25 in both runs. Its weakest campaign finish is **22** lives after tuning. Weak Easy clears 14/17 chapter-one islands. The towers-only weak script finishes both Normal tutorials at 7/20. Hard goes from 10/17 and 5/8 to 10/17 and 4/8. Every Hard win costs lives and earns 1–2★, including a 3/22 one-star finish at Lastlight Head. Weak Hard wins 2/25.

## Stocked Market belt

Heartstone, Sky Purse and Ember Pot cover healing, building and burst damage. This was the high-value belt in the original Market report. Each type starts stocked to the live cap. The simulator uses its existing greedy cast policy and build cadence. The paired run uses the item-free entry inventory on each island. The progressing run spends the stars and XP it earned while using items. Net loss is missing lives at the end, after healing. Stars use all leaked lives.

| Island | No items, before → after | Net loss with belt, same entry kit | Net loss / stars with belt, own progression | After, raw leak / heal | After, casts |
|---|---:|---:|---|---:|---:|
| l1c | 0 → 2 | 0 → 0 | 0/3★ → 0/3★ | 0 / 0 | 1 |
| i01 | 0 → 2 | 0 → 0 | 0/3★ → 0/3★ | 0 / 0 | 1 |
| i02 | 0 → 5 | 0 → 5 | 0/3★ → 5/2★ | 5 / 0 | 1 |
| i03 | 5 → 5 | 0 → 5 | 0/3★ → 5/3★ | 5 / 0 | 2 |
| i04 | 0 → 5 | 0 → 5 | 0/3★ → 5/2★ | 5 / 0 | 1 |
| i05 | 3 → 5 | 0 → 5 | 0/3★ → 5/2★ | 5 / 0 | 2 |
| i06 | 10 → 6 | 6 → 5 | 6/2★ → 5/3★ | 5 / 0 | 2 |
| i07 | 0 → 5 | 0 → 5 | 0/3★ → 5/3★ | 5 / 0 | 2 |
| i08 | 6 → 6 | 1 → 15 | 1/3★ → 16/1★ | 20 / 4 | 3 |
| i09 | 2 → 6 | 2 → 9 | 2/3★ → 9/2★ | 9 / 0 | 2 |
| i10 | 3 → 8 | 0 → 9 | 0/3★ → 9/2★ | 9 / 0 | 1 |
| i11 | 5 → 11 | 0 → 7 | 0/3★ → 3/3★ | 3 / 0 | 1 |
| i12 | 2 → 9 | 5 → 0 | 5/3★ → 1/3★ | 1 / 0 | 1 |
| i13 | 11 → 11 | 0 → 11 | 0/3★ → 11/2★ | 12 / 1 | 3 |
| i14 | 10 → 8 | 1 → 13 | 1/3★ → 13/1★ | 15 / 2 | 3 |
| i15 | 9 → 9 | 0 → 0 | 0/3★ → 0/3★ | 0 / 0 | 1 |
| i16 | 9 → 9 | 4 → 11 | 4/3★ → 11/2★ | 11 / 0 | 2 |
| i17 | 14 → 12 | 0 → 5 | 0/3★ → 5/3★ | 5 / 0 | 2 |
| i18 | 14 → 10 | 0 → 4 | 0/3★ → 4/3★ | 4 / 0 | 1 |
| i19 | 15 → 10 | 3 → 7 | 3/3★ → 7/3★ | 7 / 0 | 2 |
| i20 | 16 → 10 | 5 → 10 | 5/3★ → 10/2★ | 10 / 0 | 2 |
| i21 | 17 → 10 | 0 → 8 | 0/3★ → 8/2★ | 8 / 0 | 2 |
| i22 | 14 → 11 | 1 → 9 | 1/3★ → 9/2★ | 9 / 0 | 1 |
| i23 | 18 → 9 | 0 → 0 | 0/3★ → 0/3★ | 0 / 0 | 1 |
| i24 | 19 → 9 | 4 → 2 | 4/2★ → 2/3★ | 2 / 0 | 1 |

Before tuning, the belt left 32 net lives missing out of 202 item-free losses (16%). With the new curve it leaves 150/193 (78%) on identical entry kits and 148/193 (77%) when its own stars and XP carry forward. The independent run loses 103/112 in chapter one and 45/81 in chapter two. Individual outcomes vary with the timing of hero abilities and purchases. A purse on i23 can buy a flawless clear, while a different purchase sequence on i08 can cost more lives than playing without items.

Normal now stocks one charge per equipped type, down from three. Normal and Hard allow the first use from the horn, the second after five lives have leaked and the third after ten. Any equipped item can fill the available use. This preserves an opening tactical choice and prevents a full keep from stacking three combat items on the same threat. Heartstone repairs up to five lives and can bring the keep back to half its starting total, rounded up, on these two modes. It preserves both the star penalty and access to earned uses. Easy retains three charges per type, full repairs and all three slots from the horn.

The fixed belt with five-life heals up to full left only 85/193 missing lives in the independent progression even with staggered uses. Limiting repairs preserves the five-life rescue for a struggling player. First-clear rewards buy 3.08 catalog-priced items per island, or 3.72 with the simulator’s usual replays and Dailies. The existing prices and Sky Purse payout still support regular use.

The three items with the highest measured value per crystal were Gale Bell, Sky Purse and Ember Pot. This second belt leaves 143/193 net losses (74%) at matched entry kits. It converts three weak Normal defeats into wins (3/25 → 6/25). On Hard it raises campaign wins from 14/25 to 18/25. All five item-assisted chapter-two Hard wins earn 1–2★.

## Authored changes

Every island uses its existing wave count, enemy types, tower and hero stats, and star rules. Difficulty combat multipliers and kill income also retain their previous values. Across 404 waves, six end their spawn schedule earlier and one ends 0.33 seconds later (Harvest Dreadnought). Group counts below refer to the painted route, after its existing air adjustments. An HP factor applies only to the named formation unless the row specifies island HP.

| Island | Change and reason |
|---|---|
| l1c | Rush Hour brutes get ×1.75 HP. A ground breach teaches the cost of a leak after both entrances and flyers have been introduced. |
| i01 | Iron Knock brutes become elite with ×2.4 HP. The wave costs the campaign two lives and leaves the towers-only tutorial winnable. |
| i02 | Spring Tide flyers 14 → 13. Dreadnought Fleet bosses get ×1.5 HP. The first five-life breach belongs to the fleet, and the weak build still clears. |
| i03 | Island HP 1.6232 → 1.66. The small island-specific change preserves a five-life first clear with the new incoming Workshop inventory. |
| i04 | Emerald Dreadnoughts bosses get ×1.6 HP. A boss can reach the keep even after the area-damage upgrades come online. |
| i05 | Gale Force flyers get ×0.85 HP. Harvest Dreadnought bosses get ×1.3 HP and their flyers go 25 → 28. This places the campaign breach on the boss and gives the weak build a final wave that a well-timed belt can rescue. |
| i06 | The Leviathan boss gets ×0.6 HP, Maelstrom flyers go 14 → 12, and starting gold goes 280 → 285. One boss and one flyer break through. Five extra gold lets the weaker build convert item use into a clear. |
| i07 | Fortress Breaker bosses get ×1.4 HP and island air HP goes ×0.65 → ×0.58. The ground push carries the five-life first clear after Crescent Lagoon. |
| i08 | The six-life result lands between its neighbours with the new incoming inventory. The island uses its previous formations. |
| i09 | Twin Warlords bosses get ×1.35 HP and arrive 4 → 4.5 seconds apart. The two threats put pressure on separate targeting decisions and remove the flawless Hard clear. |
| i10 | Earthshaker flyers 16 → 12 and The Confluence bosses get ×2.5 HP. Ground damage accounts for most of the campaign loss and weak players have time to answer the air wave. |
| i11 | Golden Freight golems get ×1.45 HP and starting gold goes 255 → 265. The freight wave taxes the ground line while alternate heroes can fund the upgrades they need. |
| i12 | Hexfire Legion brutes get ×1.4 HP. The late push and the boss both contribute to the nine-life result. |
| i13, i15, i16 | Existing formations yield 11, 9 and 9 lost. The chapter finale still leaks on two separate waves. |
| i14 | Aegis Dune wardens 5 → 4, healers 6 → 2, flyers 20 → 14. Starting gold goes 295 → 360. Thinning the protected convoy and funding the opening removes alternate-hero defeats on the three-lane map. |
| i17 | Starting gold 350 → 320. The Cloister Rings keeps both golem lanes, with the east elite group 12 → 8 at ×0.8 HP. The opener costs 12 lives with Bran and the final east escort is survivable with Sela. |
| i18 | Air Shaft carriers 2 → 1 and Ringing Clay elite kilnbacks 8 → 7. The scripted Aftershock build clears Hard, and the air lanes account for two of the ten lives lost on Normal. |
| i19 | High Bough draftwings 10 → 7 and starting gold 365 → 360. This preserves the Live Wire build’s Hard clear and splits Normal pressure between air and ground. |
| i20 | The Last Pennant elite splitters 7 → 5. The finale still threatens the keep across its three roads. |
| i21 | The Winch Sticks elite kilnbacks 15 → 7, with the four golems at ×1.5 HP. Fewer bodies keep the wave short while the golems give single-target fire a job. |
| i22 | The Last Crossing east elite golems 8 → 3 at ×1.8 HP. Starting gold 350 → 380. Fewer, tougher targets preserve the late crossing and open a viable line for the alternate heroes. |
| i23 | Windfalls east elite golems 10 → 9, interval 0.90 → 0.95 seconds. Starting gold 400 → 395. The convoy finishes earlier and the opening purchase still matters on Hard. |
| i24 | The Quay Breaks elite burrowers 5 → 3. First Light’s Tempest gets ×2 HP, with elite kilnbacks 8 → 6, draftwings 6 → 3 and east elite golems 4 → 1. The final six-life breach comes from the Colossus. All three roads remain active and alternate builds can finish. |

## Regression coverage and playtest notes

`npm run sim:balance` checks each Normal loss window, adjacent drops, tutorial survival, weak-build results, spending, flyer share and boss-wave pressure. It also requires a clear at ±1.5% and ±3% island HP, two additional seeds, every available alternate campaign hero at its attainable level, and the original tower line wherever the reference specializes. All 262 reference and variant runs cleared. A human playtest should try Sela on Cloudbell Cloister and Tobb on Lastlight Head. Each finishes with one life on the scripted build. On the finale, try the belt both before and during the Tempest push to check whether the second and third use feel available when expected.

`npm run sim:difficulty` checks the star distribution, both Easy clearance targets and Hard’s chapter and reward limits. `npm run sim:items` adds the fixed-belt comparison to the existing single-item ranking, weak-build rescues, Hard ribbons and affordability checks. `npm run sim:items -- --normal-belt` runs just the fixed comparison. The three commands load the installed tsx runtime through Node, and each item worker registers the same loader for TypeScript and JSON island data.

The formation tests pin the painted-route overrides and the runtime ground HP checks distinguish named finale formations from the island’s base curve. The Market tests cover the live caps, healing, gold, HUD and replay behavior. TypeScript, ESLint, the production build and all three simulation commands pass. Vitest passed 1,806 tests with 15 skipped. Vite reports its existing chunk-size and mixed static/dynamic import warnings.
