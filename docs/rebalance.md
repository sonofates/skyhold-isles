# 2D campaign rebalance

This report records the first campaign tuning pass. See [Normal campaign rebalance v2](rebalance-normal-v2.md) for the current curve.

On the live island tuning (`301da3d`), greedy Bran earned 3★ on all 25 islands and lost four lives in total. With the retune, the same player wins all 25 and earns 3★ on 12. Average lives lost rise from 4.6 in chapter one (including Meadow Crossing) to 15.1 in chapter two. Weak wins all three onboarding islands and loses all 20 Heroic and Master islands.

## First-clear profile

Both scripts use the same save on entry. The reference player starts fresh, selects Bran, and clears each story island once with the greedy tower order. Every subsequent island uses the preceding runs’ actual hero XP and awarded stars. Weak gets a copy of that inventory to measure how much tower placement matters at the same level. The profile assumes no replays, challenge stars, daily rewards or early wave calls.

- **Hero.** The world awards one XP per team kill, 12 per cleared wave, and 30 plus 15 per star for victory. The tool reads the resulting run XP, applies the live cumulative level curve, and spends the available skill points with the existing default specialization. Meadow Crossing earns 396 XP and Bran enters i01 at L3. He reaches L10 at i05 and L20 at i15. The high enemy counts in chapter one account for the earlier cap than the rough 38-clear estimate in the hero data.
- **Workshop.** The player buys the first rank of each upgrade in menu order, then the second rank, banking spare stars for the next purchase. Treasury and Bounty take the first three stars. The retuned run can afford all 14 ranks for 33 stars on entry to i12. Bastion adds up to two starting lives. The live star rule measures lives lost from that starting total.
- **Combat.** Both scripts keep their existing tower purchases, targeting and eight-second combat build cadence. The hero walks to the shared road before the first wave, returns after respawn, and checks both skills every half-second for the existing hero-specific combat trigger. On a single road the post is 55% along the path. Meteor targets the largest available cluster of at least three exposed enemies within its blast radius. Overcharge needs four active enemies and a tower firing or stunned. Casts use the world’s cooldowns, including Quickcast. Combat runs at 60 Hz with the world’s deterministic island/hero/level seed.

## Before and after

Each cell gives **lives lost / stars earned**. Zero stars means defeat. A no-kit defeat costs 20 lives. A kit defeat costs 20–22, depending on Bastion. The first table uses the live wrappers, the second the retuned wrappers. Each campaign earns its own progression.

### Live tuning

| Island | Bran level | Prior stars | Greedy, no kit | Greedy, full kit | Weak, no kit | Weak, full kit |
|---|---:|---:|---:|---:|---:|---:|
| l1c | 1 | 0 | 0 / 3 | 0 / 3 | 9 / 2 | 0 / 3 |
| i01 | 3 | 3 | 2 / 3 | 0 / 3 | 7 / 2 | 0 / 3 |
| i02 | 5 | 6 | 5 / 2 | 0 / 3 | 20 / 0 | 5 / 2 |
| i03 | 6 | 9 | 11 / 2 | 0 / 3 | 20 / 0 | 5 / 3 |
| i04 | 8 | 12 | 8 / 2 | 0 / 3 | 20 / 0 | 15 / 1 |
| i05 | 10 | 15 | 5 / 2 | 0 / 3 | 20 / 0 | 0 / 3 |
| i06 | 11 | 18 | 12 / 2 | 0 / 3 | 20 / 0 | 5 / 3 |
| i07 | 12 | 21 | 10 / 2 | 0 / 3 | 20 / 0 | 15 / 1 |
| i08 | 13 | 24 | 14 / 2 | 0 / 3 | 20 / 0 | 5 / 3 |
| i09 | 15 | 27 | 15 / 1 | 0 / 3 | 20 / 0 | 6 / 3 |
| i10 | 16 | 30 | 15 / 1 | 1 / 3 | 20 / 0 | 22 / 0 |
| i11 | 17 | 33 | 13 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i12 | 18 | 36 | 12 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i13 | 19 | 39 | 14 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i14 | 19 | 42 | 11 / 2 | 0 / 3 | 20 / 0 | 0 / 3 |
| i15 | 20 | 45 | 13 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i16 | 20 | 48 | 15 / 1 | 0 / 3 | 20 / 0 | 22 / 0 |
| i17 | 20 | 51 | 11 / 2 | 0 / 3 | 20 / 0 | 16 / 1 |
| i18 | 20 | 54 | 13 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i19 | 20 | 57 | 11 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i20 | 20 | 60 | 14 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i21 | 20 | 63 | 12 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i22 | 20 | 66 | 13 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |
| i23 | 20 | 69 | 11 / 2 | 3 / 3 | 20 / 0 | 22 / 0 |
| i24 | 20 | 72 | 12 / 2 | 0 / 3 | 20 / 0 | 22 / 0 |

### Retuned islands

| Island | Bran level | Prior stars | Greedy, no kit | Greedy, full kit | Weak, no kit | Weak, full kit |
|---|---:|---:|---:|---:|---:|---:|
| l1c | 1 | 0 | 0 / 3 | 0 / 3 | 9 / 2 | 0 / 3 |
| i01 | 3 | 3 | 2 / 3 | 0 / 3 | 7 / 2 | 0 / 3 |
| i02 | 5 | 6 | 5 / 2 | 0 / 3 | 20 / 0 | 5 / 2 |
| i03 | 6 | 9 | 20 / 0 | 0 / 3 | 20 / 0 | 21 / 0 |
| i04 | 8 | 12 | 20 / 0 | 0 / 3 | 20 / 0 | 18 / 1 |
| i05 | 10 | 15 | 20 / 0 | 0 / 3 | 20 / 0 | 14 / 1 |
| i06 | 11 | 18 | 20 / 0 | 10 / 2 | 20 / 0 | 21 / 0 |
| i07 | 12 | 20 | 20 / 0 | 5 / 3 | 20 / 0 | 21 / 0 |
| i08 | 13 | 23 | 20 / 0 | 5 / 3 | 20 / 0 | 22 / 0 |
| i09 | 15 | 26 | 20 / 0 | 5 / 3 | 20 / 0 | 22 / 0 |
| i10 | 16 | 29 | 20 / 0 | 2 / 3 | 20 / 0 | 22 / 0 |
| i11 | 17 | 32 | 20 / 0 | 4 / 3 | 20 / 0 | 22 / 0 |
| i12 | 18 | 35 | 20 / 0 | 6 / 3 | 20 / 0 | 22 / 0 |
| i13 | 18 | 38 | 20 / 0 | 10 / 2 | 20 / 0 | 22 / 0 |
| i14 | 19 | 40 | 20 / 0 | 9 / 2 | 20 / 0 | 22 / 0 |
| i15 | 20 | 42 | 20 / 0 | 11 / 2 | 20 / 0 | 22 / 0 |
| i16 | 20 | 44 | 20 / 0 | 11 / 2 | 20 / 0 | 22 / 0 |
| i17 | 20 | 46 | 20 / 0 | 14 / 1 | 20 / 0 | 22 / 0 |
| i18 | 20 | 47 | 20 / 0 | 13 / 2 | 20 / 0 | 22 / 0 |
| i19 | 20 | 49 | 20 / 0 | 12 / 2 | 20 / 0 | 22 / 0 |
| i20 | 20 | 51 | 20 / 0 | 15 / 1 | 20 / 0 | 22 / 0 |
| i21 | 20 | 52 | 20 / 0 | 17 / 1 | 20 / 0 | 22 / 0 |
| i22 | 20 | 53 | 20 / 0 | 18 / 1 | 20 / 0 | 22 / 0 |
| i23 | 20 | 54 | 20 / 0 | 13 / 2 | 20 / 0 | 22 / 0 |
| i24 | 20 | 56 | 20 / 0 | 19 / 1 | 20 / 0 | 22 / 0 |

## Where the extra power came from

These greedy runs use the live islands. Each middle column turns on just one component at the same campaign point. Values are lives lost.

| Island | No kit | Bran and skills | Meteor | Overcharge | Workshop | Full kit |
|---|---:|---:|---:|---:|---:|---:|
| i05 | 5 | 0 | 0 | 0 | 5 | 0 |
| i10 | 15 | 8 | 2 | 0 | 9 | 1 |
| i16 | 15 | 7 | 0 | 2 | 6 | 0 |
| i20 | 14 | 1 | 3 | 0 | 8 | 0 |
| i24 | 12 | 0 | 8 | 9 | 10 | 0 |

The biggest gain changes with the enemy mix. Meteor alone covers all 15 previously lost lives on i16, Overcharge covers all 14 on i20, and Bran covers all 12 on i24. Workshop alone saves two lives on i24. The single-component results overlap because changing a kill also changes income, tower purchase timing and later targets. These measurements supported local island tuning and preserving the live hero, spell and Workshop values.

## What changed in play

- **Onboarding.** Meadow Crossing, i01 and i02 retain their live waves, HP and starting gold. Weak clears them with 3★, 3★ and 2★. The first Heroic island, i03, now requires a stronger tower plan for a clear.
- **Chapter one.** Adjustments use only the painted islands’ HP scale, HP growth and starting gold. The shared L1–L16 waves and tower scripts keep their authored orders. Crescent Lagoon (i06) is the early exception to the 3★ run. Its three bosses, with five lives at stake apiece, make late-wave damage matter. At the chapter finale (i16), 100 starting gold plus Treasury buys an opening tower. The lower wave HP growth keeps the late siege affordable for a player who recovers from early leaks.
- **Chapter two.** Larger late ground groups challenge Bran’s hold cap while other lanes still demand fire. On i17 and i22, elite golems arrive during the final push. On i19 and i20, burrowers take another lane. i21 puts kilnbacks alongside the support enemies on wave five. i23 sends golems alongside the existing elite kilnbacks on wave six. Chapter two’s greedy losses range from 12 to 19 lives.
- **Lastlight Head.** Four elite golems enter from the boat road 12 seconds into the Tempest wave, alongside the bellrunners from the other landing. Greedy Bran loses nine lives on wave 11 and ten on wave 14, including the leaking Tempest. The keep survives with 3/22 lives and 1★. Weak falls on wave 10 of 14.

### Other heroes

Each alternative starts at its unlock milestone (Wren after two clears, Mira four, Tobb seven, Sela ten). Its personal XP estimate uses the reference run XP earned since that unlock. The shared Workshop uses all preceding campaign stars. Before tuning, all four greedy heroes lost zero lives on all three sample islands. Each weak sample lost all 22 lives both before and after.

Greedy results after tuning are shown as **hero level · lives lost / stars**.

| Island | Wren | Mira | Tobb | Sela |
|---|---:|---:|---:|---:|
| i10 | L15 · 0 / 3 | L14 · 0 / 3 | L11 · 0 / 3 | L1 · 5 / 3 |
| i16 | L20 · 0 / 3 | L20 · 0 / 3 | L18 · 1 / 3 | L15 · 6 / 3 |
| i24 | L20 · 18 / 1 | L20 · 11 / 2 | L20 · 20 / 1 | L18 · 9 / 2 |

The ranged heroes can still earn 3★ on i16. All five heroes clear i24 on greedy and earn 1–2★. Tempering i24 HP by 3% leaves Bran with 10 lives. Adding 1.5% still leaves three, and adding 3% defeats him. The default gate tracks Bran at the shipping values. These spot checks measure three specific encounters and tower orders.

## Reproducing the checks

`npm run sim:balance` gates the realistic kit on the 25 painted islands. Each summary includes the no-kit greedy and weak results for comparison. On the retuned campaign the no-kit greedy script loses every island from i03 forward. The 2D gate checks life-loss bands by campaign position, stars, weak defeats on Heroic and Master, and pressure during the i24 boss wave. It also checks flyer share, spending and tower-script integrity. The 16 original 3D islands retain their previous targets.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
npm run sim:balance
npm run sim:balance -- --levels=i05,i10,i16,i20,i24 --kit-detail
npm run qa:bot
```

A filtered 2D run plays the earlier greedy clears to reconstruct its entry inventory. The optional detail report runs the four isolated components and the other unlocked heroes on the selected islands.
