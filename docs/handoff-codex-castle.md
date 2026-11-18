# Castle and gold handoff

All 17 island goals have a painted gatehouse, curtain walls, a paved approach and a residential keep. The gate axis follows the last nonzero path segment. Each island keeps its original plots, paths, entrances and goal coordinates. The work is uncommitted on `codex/castle-gold`, based on `9598254`.

[Before, all 17 castles](castle-sheet-before.jpg) · [After, same scale and framing](castle-sheet-after.jpg) · [In-game crops](castle-shots/)

## Castle art and fit

The built-in image generator supplied the plan paintings, upright halls and compact arch faces on magenta. They went through `design/art-2d/key.py`. The six materials are honey limestone, terrace sandstone, coastal timber and stone, snowy granite, moonlit violet stone and ember basalt. L1c shares the limestone kit with the orchard islands. [Paintings and generation prompts](../design/art-2d/v2/keeps/brief.md)

The compositor rotates the ground plan through the actual approach angle and keeps the hall upright. The pavement widens towards the port, fades into the island road and continues between the walls. The map supplies the contact shadow and the gate front uses the masonry and tunnel mask from the same placement. A ground walker fades into the shadow over the last 24 layout pixels of its route. This prevents tall weapons and heads from popping off above a low roof at the leak point.

Placement checks the painted silhouette against each plot's ring and its 180-pixel tower clearance. The fit shortens the walls and the approach first. The shipped castle widths span 1.58–2.78 plot diameters. Three narrow sites use a separately positioned hall, portal and wall ends. On tidal and rift maps the hall can have its own rocky footing.

| Previously blocked goal | Shipped fit |
| --- | --- |
| i02 | West-facing tidal gate with a shorter outer approach and wall ends. |
| i08 | The gate opens northeast onto the bridge approach. The near wall turns beside the build plot. A single rock terrace supports the gate and the taller hall across the waterline. The compact keep fits at 92% of its design scale. |
| i10 | East-facing sandstone gate with a shorter approach and both curtain ends pulled in. |

## Gold

The new painting shows a stack of coins and a leaning crown-stamped coin. The primary HUD plaque has the painting in its recessed socket. The fallback HUD, build and upgrade tags, tooltip costs, end panel, codex and store share the standalone texture. Workshop rank purchases spend campaign stars and retain the star icon. [Coin master](../design/art-2d/out/icon-gold.png) · [Shipped texture](../public/art2d/icon-crown-coins.webp)

## Files

- `design/art-2d/v2/keeps/` holds the keyed plans, halls, arch faces and prompt brief. `tools/map-compose/keeps.py`, `postern.py`, `compose.py` and `campaign.json` handle fitting, painting, occlusion and validation.
- `public/art2d/map-*-layered*.webp` contains 68 updated maps and 34 updated goal fronts. The 17 files in `src/data/levels2d/` changed only in `goalGate`.
- `design/art-2d/out/icon-gold.png`, `design/art-2d/ui-kit/pack.py`, `public/art2d/icon-crown-coins.webp`, `public/art2d/ui/hud-plaque.webp` and `public/art2d/manifest.json` are the coin source, packing and game assets.
- `src/render2d/enemyLayer.ts` handles the final tunnel fade. `buildRing.ts` displays the shared gold texture next to tooltip prices. `ui/dom.ts` supplies it to DOM screens. The plaque and end-panel comments in `uiLayout.ts` and `endPanel.ts` now describe coins.
- `tools/map-compose/gate_sheet.py` supports fixed-scale comparisons against a git revision. `qa/castleShots.mjs` captures the live maps and UI with Playwright.

## Verification

| Check | Result |
| --- | --- |
| Node | 22.21.1 |
| TypeScript and ESLint | Both passed |
| Vitest | 1,102 passed, 11 skipped. 84 test files passed, 1 skipped. |
| Balance simulator | All 33 levels passed |
| Production build | Passed with the Vite chunk-size advisory |
| Plot checks | All 17 passed with the saved plot coordinates |
| Shipped textures | All 68 map sizes and all 34 front sizes verified. Each decoded front covers the goal and leaves the approach clear 38 layout pixels out. |
| Facings | All six standard plans passed aperture checks at eight compass directions. |

The 645 lines of `npm run sim:balance` stdout match the pre-edit run byte for byte. Both have SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`. A separate comparison against HEAD verified every field outside `goalGate`, including each entrance gate.

The map recipe uses `tools/map-compose/rebake_all.py` with `--keep-plots` on both passes. The 1×, 1.5×, 2× and native 3× images measure 1846×852, 2769×1278, 3692×1704 and 5538×2556. Each high-resolution goal front samples the same rectangle as the master.

Regenerate the comparison sheets from the repository root. The first command reads the old castles directly from the base revision.

```sh
/usr/bin/python3 -B tools/map-compose/gate_sheet.py docs/castle-sheet-before.jpg --role goal --context --ref 9598254
/usr/bin/python3 -B tools/map-compose/gate_sheet.py docs/castle-sheet-after.jpg --role goal --context
```

## In-game review

Playwright captured each island at 1920×1080 DPR 2 and landscape 844×390 DPR 3 with high quality selected. The desktop canvas was 3840×2160 and settled on the 3× map. The phone canvas was 2532×1170 and settled on the 1.5× map. Both contact sheets use the same 448×320 layout-pixel window and show the build rings at their game size.

The i10 sequence follows a live grunt in wave one. Its feet enter the dark passage and its head and weapon disappear under the roof before the sim registers the leak. The i08 build capture puts an archer tower on the eastern plot beside the bridge. [Approach](castle-shots/walker-i10-approach.png) · [At the threshold](castle-shots/walker-i10-threshold.png) · [Inside the keep](castle-shots/walker-i10-inside.png) · [i08 with its neighbouring tower](castle-shots/i08-built-plot-1920x1080-dpr2.jpg)

The crown, coin rims and gold count are visible on both HUD plaques. The build ring and its tooltip use the same silhouette as the store price tag. [Desktop HUD](castle-shots/gold-1920x1080-dpr2.png) · [Phone HUD](castle-shots/gold-phone-844x390-dpr3.png) · [Phone build costs](castle-shots/cost-phone-844x390-dpr3.jpg) · [Store price](castle-shots/store-price-phone.png)

## Owner review

Browser verification used headless Chromium with SwiftShader and phone emulation. The remaining subjective check is the apparent size of i08's keep and terrace on the owner's physical phone. All requested repository deliverables are present.
