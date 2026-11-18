# P2b handoff · campaign islands 9–16

All sixteen campaign islands now have playable plot maps. Open `2d.html?level=i09` through `2d.html?level=i16` for the eight new islands. Emerald Stepping Stones (i04) now has a western entrance. Crescent Lagoon (i06) has an eastern entrance. Both caves open toward the player-visible road.

## Layouts and balance

All ten layouts use the 1846 × 852 canvas with the [166, 0, 1515, 852] safe area. The greedy column gives lives remaining out of 20 and stars earned. The weak column gives the wave on which that script lost.

| Island | Ground lanes and route | Plots | Greedy lives / stars | Weak wave |
| --- | --- | ---: | ---: | ---: |
| i04 · Emerald Stepping Stones | 1 · west cave onto the lower terrace | 20 | 12 / 2 | 14 of 14 |
| i06 · Crescent Lagoon | 1 · east beach around the cove | 24 | 8 / 2 | 17 of 17 |
| i09 · Grand Skyhold | 1 · western dogleg across the causeway into a marble court spiral | 27 | 5 / 1 | 22 of 22 |
| i10 · Confluence Terraces | 2 · west causeway and northern switchback join before the eastern terrace loop | 25 | 5 / 1 | 11 of 20 |
| i11 · Galewatch Spires | 1 · northern spire down the plateau in three traverses to the southern sanctuary | 24 | 7 / 2 | 17 of 20 |
| i12 · Lanternfall Hollow | 1 · four hairpins around exposed hedges and a sheltered central clearing | 27 | 8 / 2 | 15 of 20 |
| i13 · Stormcrown Citadel | 2 · eastern outer spiral and northern war-road join on the inner ring | 28 | 6 / 2 | 18 of 22 |
| i14 · Amberstone Mesa | 3 · western dune steps, northern scarp and short eastern wash meet at one plaza | 24 | 9 / 2 | 22 of 22 |
| i15 · Moonwell Crossing | 2 · the long lane visits the Moonwell crossing twice, then meets the eastern shortcut | 26 | 7 / 2 | 9 of 22 |
| i16 · Emberglass Sanctum | 3 · two western caves take opposite arcs around the ring. A short eastern breach joins both at the inner causeway | 26 | 5 / 1 | 19 of 24 |

Confluence flyers depart from the northern cave. Galewatch haulers cross the chasm and approach the final road before the sanctuary. Islands 13–16 each keep an aerial entry separate from their caves. On Amberstone the fast wash moves to the east, and on Emberglass the ring turns sideways so all three cave mouths remain visible.

Lanternfall has one island-specific tuning value. Hexers reach 2.4 world units (120 layout px) there. The four central plots lie outside that reach, and all 27 plots can field a tier-one barracks with its 3.2-unit rally range. The deterministic test places a hexer on the nearest point of the road to each plot and observes which towers it can jam.

## Files and rebaking

- `src/data/levels2d/i09.json` through `i16.json` contain the roads, aerial routes, plots and gate fronts. Their TypeScript wrappers map the source islands’ purchases and upgrades to plot indices and set the balance parameters. The wrappers import the source wave tables, enemy groups, rewards and story fields through `campaignIsland.ts`. The same directory contains the revised i04 and i06 layouts and scripts and the ordered registry in `index.ts`.
- `src/data/levels/types.ts`, `src/sim/world.ts` and `src/sim/enemySystem.ts` carry the optional map-specific hex radius. Other maps use the enemy definition’s reach.
- `tools/map-compose/campaign.json` records each bake’s seed, plot count, props and decal density. `compose.py` accepts fixed plot centres in a recipe so a designer can reserve a clearing or cover a narrow junction before the remaining plots are generated. The compositor checks these plots against the same rules as all the others.
- `public/art2d/` contains 47 new WebPs (8,291,620 bytes) and ten replacement WebPs for i04 and i06. The manifest lists each master, both resolution variants and each individual gate front. The existing renderer selects them from the layout’s image and gate keys.
- `tests/sim/campaignIslands2d.test.ts` covers all sixteen maps. The art brief gives each island’s future palette, props and landmark placement. [Campaign art brief](p2-art-needs.md)

Each map went through a generating bake and a second bake using its saved plot indices. For a production rebake, run the following from the repository root with the desired ID.

```sh
id=i16
/usr/bin/python3 tools/map-compose/compose.py "src/data/levels2d/$id.json" design/art-2d/v2/assets \
  "public/art2d/map-$id-layered.webp" --bake --w 3692 --variants 1,1.5 --write-layout --keep-plots
```

## Verification

- Node 22.21.1 passed TypeScript, ESLint and the production build. Vitest passed **955 tests** across 74 files. The existing DOM-only suite accounted for all 11 skips. All **82 campaign-map tests** ran, including 16 production compositor checks with `/usr/bin/python3`, Pillow and NumPy.
- The full balance gate passed **33/33** entries, including all 16 grid levels, l1c and all 16 campaign plot maps. Each individual command from `npm run sim:balance -- --levels=i09` through `--levels=i16` selected one entry and passed.
- I checked the master and variant dimensions for all ten changed maps. The documented l1c bake, run against a temporary copy of its layout, reproduced the committed layout, master and both variants byte-for-byte. The three gate-front files differed only in their compressed WebP alpha chunks. Their decoded RGBA pixels and VP8 colour chunks matched. On this machine the original and updated compositors produced identical bytes for all six WebPs (Pillow 10.2.0, libwebp 1.3.2).
- Headless Chromium opened each of the ten changed play URLs at 1600 × 900 (DPR 1) and 915 × 412 (DPR 2.6). All **20/20** runs displayed every plot, loaded the island’s 1.5× map and its own gate fronts, built a tower through the ring and spawned enemies from the horn. All observed map requests belonged to the selected island.

## Owner follow-up

The themed paint pass remains the planned art work. The meadow bakes are ready for play. Browser checks used emulated viewports, and balance results come from the deterministic scripts. The changes are uncommitted in the working tree on `codex/p2-islands-9-16`.
