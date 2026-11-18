# Campaign island art handoff

The 16 campaign islands have individual painted terrain and six reusable biome kits. Each panel in the review sheet uses the shipped 1x background at 1846 by 852 pixels, with the game’s plot sprite drawn at the saved coordinates. Meadow Crossing (L1c) is the reference panel. [Open the full-resolution contact sheet](art-themes-sheet.jpg).

| Kit | Islands | Landmarks and route details |
| --- | --- | --- |
| Orchard | i01, i05, i09 | A cottage garden sits inside the meadow bend. The windmill stands between amber fields and orchard rows. The crown hall serves as Grand Skyhold’s goal, approached on ivory paving. |
| Tidal coast | i02, i06 | Two timber decks cross one channel beside the harbour shed. A lighthouse and sandbar foundations sit inside the crescent lagoon. |
| Highlands | i03, i07, i11, i13 | Snowbanks and an eastern waterfall frame the courtyard keep. Later maps use twin cliff forts, signal spires and a storm altar with bare slate gates. |
| Terraces and marsh | i04, i08, i10 | A rope deck climbs the jade terrace. The drowned bailey has a torchlit gate and a short causeway. Irrigation channels divide the fern terraces. |
| Moonlit hollow | i12, i15 | Amber lanterns mark the hollow’s plum switchbacks. Moonwell Crossing uses continuous silver-blue paving through the self-crossing. |
| Ember badlands | i14, i16 | The mesa has a sandstone waystone and a paler eastern wash. The sanctum ends at a copper-domed furnace gate between dark glass ridges. |

## Assets and composition

- `design/art-2d/v2/biomes/` holds the production WebPs and six `kit.json` files. Each kit defines seven scatter roles and their heights in road widths. It supplies five painted decals, ground and brush tiles, road material and directional gates. Island-specific terrain, props, bridges and landmark overrides sit with their kit.
- The built-in image generator painted the source sheets and terrain. The sprite prompts specified original three-quarter-view miniatures, upper-left lighting, matte gouache, fine warm contours and isolated pieces on flat magenta. The terrain prompts followed colour-block plans for each island’s cliffs, water, fields and courts. Each swatch and sprite was extracted with chroma removal and edge de-spill. The final WebPs had zero visible pixels matching the strong-magenta removal threshold in `design/art-2d/key.py`.
- `tools/map-compose/campaign.json` selects the kit and per-island art. `compose.py` reads the kit, paints the terrain and crossings, and places small foundations beneath plots or buildings over water and chasms. `ground.py` uses the biome decals. `gates.py` seats the fixed endpoint inside a themed opening when the diagonal approach would otherwise miss the painted sill.
- `public/art2d/map-i01-layered*.webp` through `map-i16-layered*.webp` contain 16 masters at 3692 by 1704, 32 smaller variants, and 39 gate fronts. Each of the 87 existing manifest keys resolves to its replacement. The 16 layout JSONs record the new front bounds and depth. The palette brief links to the review sheet. [Campaign art brief](p2-art-needs.md)

Rebuild any campaign island from the repository root using its existing recipe. An explicit `--biome <kit>` selects another kit for art previews.

```sh
id=i02
/usr/bin/python3 tools/map-compose/compose.py "src/data/levels2d/$id.json" design/art-2d/v2/assets \
  "public/art2d/map-$id-layered.webp" --bake --keep-plots --w 3692 --variants 1,1.5 --write-layout
```

## Verification

- All 16 saved layouts passed the compositor’s geometry checks. Comparing each layout to the branch baseline confirmed equality for all gameplay fields, including all 381 ordered plot centres, every road vertex and every flight path. All 39 spawn and goal endpoints fell inside the measured dark gate mouths. Each front texture matched its layout rectangle at master resolution.
- The documented L1c command reproduced the shipped master, two variants, three gate fronts and layout byte-for-byte by SHA-256. Different libwebp versions can encode identical alpha pixels differently. The compositor keeps an existing front when its decoded pixels already match the new render.
- The revised roads were reviewed against the full sheet and native-size crops. The highlands use softer pale gravel, Moonwell has silver paving across the junction, and the mesa’s eastern approach has a separate light wash. Twin-Bridge Cay’s decks were fitted to the painted banks.
- The 87 shipping WebPs total 10,054,030 bytes. The authoring kits total 3,521,572 bytes and the review JPEG is 4,038,902 bytes. Combined weight is **17,614,504 bytes**, including the review sheet. The previous campaign WebPs alone occupied 16,197,756 bytes.

The full gate passed on Node 22.21.1 after installing the lockfile dependencies in this checkout.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | **1,066 passed, 11 skipped** across 82 passing files and one skipped file |
| `npm run sim:balance` | **33 of 33 levels passed**. The pre-art and post-art stdout files matched byte-for-byte. SHA-256 was `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`. |
| `npm run build` | Passed. Vite emitted its chunk-size advisory. |

## Owner notes

The tower clearances determine landmark size and placement in the tightest courts. The moonwell sits just west of the self-crossing. Sunken Bastion uses a shallow gate inset and a narrow jamb to clear the tower immediately southeast of its goal. The crown hall and furnace sanctuary each incorporate their final gate. The visual review used the shipped map and plot textures at native scale. Browser animation and device frame timing were outside this art pass.
