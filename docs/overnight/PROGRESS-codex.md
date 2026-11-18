# Content overnight · round 1

Round 1 ran 22:52–23:19 UTC on `codex/night` from `0f854bb`. The changes are in the working tree for the overnight runner.

## Done

- Reviewed all 17 original maps at 1846 and 3692 px wide. Playwright captured all 17 with towers and live enemies at 1920 × 1080 DPR 1 and 2, and 844 × 390 DPR 3. The before sheets are in this directory.
- Replaced the evenly spaced roadside dots with short seeded groups on the verge. Both freestanding props and decals now check their complete bounds against roads, build rings, landmarks, bridge decks and map borders. Props vary in size and check their ground contact against the island's land mask. L1c grass and dirt, i01 orchard soil and i05 loam use staggered swatches of their original paint.
- Seated the i04 ramp across the actual terrace ledge and moved the lantern posts beside its lower bank. Linked the i06 lighthouse shelf to the castle and beach with a short gangway and a longer pier. Used cool granite on i07 and i11, including a new bridge over the i11 ravine.
- On i10 the river now passes through three shallow fords with individual stepping stones, one timber crossing and the existing lower stone span. Corrected the land mask at the stream fork and moved the sluice from the field into the lower channel.
- TypeScript, ESLint and Vitest passed. Vitest reported 1,161 passed and 11 skipped. Three additional compositor regressions passed. Both balance runs have identical 645-line stdout and SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`.

## Verification and evidence

- All 17 layout JSON files match the starting revision byte for byte. The bake used `--keep-plots` and the generated gate records and all 405 plot coordinates match the layouts. Decoded 68 maps and 84 foreground textures and checked their dimensions against the manifest and saved rectangles. The 68 maps total 25.3 MiB, down from 27.3 MiB.
- The full Node 22 gate passed on the final tree, including the production build. Vite emitted its chunk-size advisory. Three Pillow regressions cover opaque texture joins, decal bounds, and submerged road paint. Run them with `/usr/bin/python3 -B tools/map-compose/test_ground.py`.
- Whole islands and native master crops use identical framing before and after. [Before overview](maps-before-1x.jpg) · [After overview](maps-after-1x.jpg) · [Before at 2×](maps-before-2x.jpg) · [After at 2×](maps-after-2x.jpg).
- Bridge and ford details include the banks as well as the decks. [Before](maps-before-crossings.jpg) · [After](maps-after-crossings.jpg) · [Native phone comparison with towers](maps-play-crossings.jpg).
- Reproduce the live review after building with `NODE_PATH=/tmp/skyui-qa-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/skyui-browsers node tools/map-compose/play_maps.mjs /tmp/map-review`. Append island IDs for a subset. The session uses Chromium with SwiftShader and real tower, soldier and enemy rendering.

- Captured 51 original and 51 final gameplay frames. The QA scene showed at least three enemies and six towers on every island. The desktop selected the 1.5× texture at DPR 1 and the 3× texture at DPR 2. The phone selected 1.5×. Full-size JPEGs are in `/tmp/skyhold-codex-r1-qa/{before,after}` on this machine. [Desktop DPR 1](maps-after-play-1920-dpr1.jpg) · [Desktop DPR 2](maps-after-play-1920-dpr2.jpg) · [Phone DPR 3](maps-after-play-844-dpr3.jpg).

## In progress and problems

No pending bakes, servers or checks. An interrupted bulk bake and a timed-out capture were rerun. All final files decoded, and all 51 final frames are present.

## Next

Start the next round with shoreline build-pad support. On i06 plot 12 and i10 plot 12 the tower base extends into water even though its centre is on land. The current plot foundation test samples only the centre. Inspect the entire ellipse and place a bank extension where needed, without moving any plots. Also review the i08 outer moat approach and the repeating marble paving on i09. Then continue with enemy art and behaviours. The original roster already includes a healer, warden, burrower, carrier, blinker and phased boss. Give new enemies different counterplay.

## Requests for other agents

New enemy registration crosses ownership. The current `EnemyType` is a closed union in `src/core/types.ts`. Coordinate the union extension and exhaustive consumers in `src/data/soldiers.ts`, `src/ui/icons.ts`, `src/audio/soundManager.ts` and `src/render/effectsRenderer.ts` with the integrator when new IDs are chosen. The 2D enemy and codex work stays on this branch.

No new player-facing names or translation keys in round 1.
