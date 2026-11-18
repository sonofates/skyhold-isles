# Castle v3 handoff

All 17 goal castles now have a large open arch in the main keep. The two towers beside it, the battlements above it, and the inhabited block behind it come from one painting. The stone apron follows the last nonzero road segment to the painted sill. The work is uncommitted on `codex/castle-v3`, based on `29b82d9`.

[Before](castle-v3-before.jpg) · [After](castle-v3-after.jpg) · [Four live entry sequences](castle-v3-shots/entries-phone.jpg)

## Art and placement

The six material sets are orchard limestone and blue slate, terrace sandstone and terracotta, coastal timber and green copper, snowy granite, violet moonstone, and ember basalt. The built-in image generator produced the paintings on magenta. The source-resolution sprites went through the project's chroma keyer. The art includes cardinal and diagonal views, with mirrored east-side views. [Keyed paintings and generation prompts](../design/art-2d/v2/gatehouses/brief.md)

The compositor registers the sill to the road tangent, scales the entire building until the silhouette clears the saved plot rings and their tower envelopes, and bakes the ground shadow. The paving widens toward the entrance and picks up the gate's stone color. The foreground uses masonry sampled from the finished map, with a depth gradient inside the opening. The 3× front uses the same layout rectangle as the master. Some decorative props and decals shift because the seeded scatter uses the new castle outline as its exclusion area.

Three sites use a shallower gatehouse painting. On i06 and i08 a rock shelf supports the threshold where the road crosses water. On i12, a compact elevation keeps the upper story above the desktop ability controls. Its height is capped to clear the switchback that passes just above the castle. The controls still overlap lower windows to the right of the doorway. The opening and its approach are visible. [i06 on phone](castle-v3-shots/i06-phone-844x390-dpr3-threshold.jpg) · [i08 at the bridge](castle-v3-shots/i08-1920x1080-dpr2-threshold.jpg) · [i12 on desktop](castle-v3-shots/i12-1920x1080-dpr2-threshold.jpg)

## Visual review

The before and after sheets use the same 448 × 320 layout-pixel crop around each goal. On L1c, the old sheet has an exposed gap between the low gate and the blue-roofed hall. The new sheet shows the arch rising directly into the far turret and the roof meeting the same facade. On i10, the approach reaches the arch between two piers in the red-roofed keep. The live frames show the leading grunt outside the gate, partly covered by the near masonry, then out of sight inside. [Approach](castle-v3-shots/i10-1920x1080-dpr2-approach.jpg) · [Threshold](castle-v3-shots/i10-1920x1080-dpr2-threshold.jpg) · [Inside](castle-v3-shots/i10-1920x1080-dpr2-inside.jpg)

Playwright captured wave-one ground enemies on every island at 1920 × 1080 DPR 2 and landscape 844 × 390 DPR 3. The 50 native device-pixel crops include three frames each on L1c, i06, i08 and i10 at both sizes. Desktop loaded the 3× texture into a 3840 × 2160 canvas. Phone emulation loaded the 1.5× texture into a 2532 × 1170 canvas. The capture uses the supported `hero=none` option so combat effects at the gate leave the walker visible. Chromium used SwiftShader. [All crops](castle-v3-shots/)

## Changed files

| Files | Purpose |
| --- | --- |
| `design/art-2d/v2/gatehouses/` | 33 keyed source paintings and the generation brief |
| `tools/map-compose/keeps.py`, `compose.py`, `campaign.json` | Directional art, registration, fit, apron, foundations and foreground |
| `tools/map-compose/gate_sheet.py` | Configurable comparison tile width |
| `src/data/levels2d/{l1c,i01…i16}.json` | Goal art IDs and the front rectangle and depth |
| `public/art2d/map-*-layered*.webp` | 68 map bakes and 34 goal fronts |
| `qa/castleV3Shots.mjs`, `docs/castle-v3-*.jpg`, `docs/castle-v3-shots/` | Screenshot capture, fixed-scale sheets and walkthrough evidence |

## Verification

| Check | Result |
| --- | --- |
| Node | 22.21.1 |
| TypeScript and ESLint | Passed |
| Vitest | 1,142 tests passed and 11 skipped. 87 files passed and 1 skipped. |
| Balance simulation | 33 levels passed. The 645 lines of stdout matched the pre-edit run byte for byte. |
| Production build | Passed with Vite's chunk-size advisory |
| Fixed geometry | All 17 plot checks passed. All 405 plot coordinates match the base revision. Only `goalGate` differs in each layout JSON. |
| Texture audit | All four map sizes and both goal-front sizes verified on each island. Decoded foreground alpha covers the goal and is clear 38 layout pixels out on every road. |
| Direction audit | All 48 combinations of six biomes and eight compass bearings passed the same interior and approach opacity checks. |

Both balance runs have SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`. The map widths are 1846, 2769, 3692 and 5538 pixels. The native 3× pass renders from the paintings.

Reproduce from the repository root. The rebake script passes `--keep-plots` on the master and native 3× passes. The capture script owns and closes its temporary local Vite server and browser.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
/usr/bin/python3 -B tools/map-compose/rebake_all.py --jobs 2
/usr/bin/python3 -B tools/map-compose/gate_sheet.py docs/castle-v3-before.jpg --role goal --context --tile 448 --ref 29b82d9
/usr/bin/python3 -B tools/map-compose/gate_sheet.py docs/castle-v3-after.jpg --role goal --context --tile 448
NODE_PATH=/tmp/skyui-qa-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/skyui-browsers node qa/castleV3Shots.mjs
```

The remaining owner judgment is the apparent scale of the two waterside keeps on a physical phone. Their placement passed the tower-clearance checks, and their openings remain visible in the emulated phone crops.
