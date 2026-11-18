# P2a handoff · campaign islands 1–8

Open `2d.html?level=i01` through `2d.html?level=i08`. The 2D registry lists them in campaign order after l1c. All eight source levels have a single ground entrance. Each conversion also has a separately traced flyer route. The wrappers import the original waves, preserving enemy groups, splitters and their hatchlings, bosses, rewards, names, subtitles and difficulty.

## Balance results

| Island | Road | Plots | Greedy lives / stars | Weak result |
| --- | --- | ---: | --- | --- |
| i01 · Sunlit Meadow | West entrance, meadow dogleg and eastern uphill bend | 16 | 18 / 3 | Won with 13 lives |
| i02 · Twin-Bridge Cay | North landing, outbound bridge and long lower return | 19 | 15 / 2 | Lost on wave 14/14 |
| i03 · Highland Citadel | Outer mountain road spiralling into the courtyard | 22 | 9 / 2 | Lost on wave 17/18 |
| i04 · Emerald Stepping Stones | Southern ascent across staggered terraces | 20 | 15 / 2 | Lost on wave 12/14 |
| i05 · Windmill Switchback | Two field hairpins flanking the mill | 19 | 15 / 2 | Lost on wave 15/15 |
| i06 · Crescent Lagoon | Southern shore around the atoll to its inner cove | 24 | 8 / 2 | Lost on wave 17/17 |
| i07 · Skybridge Gauntlet | North gate, cliff crossings and a return to the western fort | 26 | 10 / 2 | Lost on wave 17/18 |
| i08 · Sunken Bastion | Outer bailey winding through a moat to the inner keep | 28 | 6 / 2 | Lost on wave 20/20 |

## Files and rebakes

- `src/data/levels2d/i01…i08.{json,ts}` contain the geometry and tuning. Each wrapper's `sites` table maps a campaign build coordinate to a fixed plot index, so both build orders upgrade the tower they originally purchased. `campaignIsland.ts` applies that mapping and builds the sim layout. `index.ts` registers the levels for both the renderer and balance CLI.
- `public/art2d/` contains 40 new WebPs and their manifest entries. Each island has a 3692×1704 master, two smaller variants and two gate fronts. `src/render2d/main2d.ts` already selects the background from `layout2d.image`; it now passes that layout's gate-front keys to `assets2d.ts` as well.
- `tools/map-compose/compose.py` derives route sections from shared path suffixes, checks both ends of a single road, reserves space for the clamped horn, and saves generated plot indices. `tools/map-compose/campaign.json` records each island's seed, plot count, prop and decal density, and mill placement.
- All eight production layouts went through a generating bake and a second bake with saved plots. To reproduce a shipped map, substitute its ID below. Use the generating pass again only when retuning the plot indices.

```sh
id=i01
/usr/bin/python3 tools/map-compose/compose.py "src/data/levels2d/$id.json" design/art-2d/v2/assets \
  "public/art2d/map-$id-layered.webp" --bake --w 3692 --variants 1,1.5 --write-layout --keep-plots
```

## Verification

- Node 22.21.1. TypeScript, ESLint and the production build passed. Vitest passed **905 tests** and skipped **11** in the existing DOM-only suite. The 32 new cases in `tests/sim/campaignIslands2d.test.ts` cover ID resolution, original wave identity, plot-index purchases, ground and flyer endpoints, image selection, gate files and the production compositor rules. They invoke Python 3 with Pillow and NumPy. Set `PYTHON` to select the interpreter.
- `npm run sim:balance` passed **25/25** entries, including l1c and all eight new islands. The existing level filter accepts every new ID, e.g. `npm run sim:balance -- --levels=i08`.
- Headless Chromium opened all eight normal play URLs at 1600×900 DPR 1 and 915×412 DPR 2.6. All 16 runs showed the expected plot count, loaded the island's 1.5× texture and both gate fronts, opened a build ring by click and spawned enemies when the horn was clicked. The network trace contained only the selected island's map assets.
- The documented l1c command reproduced the committed master, both variants and layout byte-for-byte. The three gate fronts have identical decoded RGBA pixels. Their lossless WebP alpha streams encode differently on this machine (Pillow 10.2.0, libwebp 1.3.2). Baking with the unmodified compositor from `50e9019` produced byte-identical files to the updated compositor here, including all three fronts. The original gate files are preserved in the delivery.

## Delivery and owner follow-up

The changes are committed locally on `codex/p2-islands-1-8`, based on `50e9019`. The supplied checkout mounted its Git metadata read-only. Its working files contain the changes, and a temporary local checkout holds the commits. The incremental `p2-islands-1-8.bundle` beside this checkout's `package.json` carries the branch. In a clean writable checkout of the same branch at the base, the following imports and fast-forwards it.

```sh
git fetch /path/to/p2-islands-1-8.bundle refs/heads/codex/p2-islands-1-8
git merge --ff-only FETCH_HEAD
```

The maps use the existing meadow art. The owner can schedule the themed paint passes using the palette, prop and landmark notes for each island. [P2 art brief](p2-art-needs.md)
