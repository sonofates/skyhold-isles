# Chapter 1 living maps

44 Omni elements play across 16 islands. All 67 prep images matched distinct videos in the 108-file inbox. 23 matched takes stay static after visual review. The two playback resolutions, masks and descriptors total 24,127,031 bytes across the chapter. i03 has the largest runtime addition at 2,782,481 bytes. Including browser evidence, the largest addition is also i03 at 3,476,331 bytes.

## Delivery by island

Full and compact are alternative downloads, each including its mask. Runtime includes both downloads and the JSON descriptor. QA counts the sequences, close-ups and measurements under the linked island directory. All sizes are bytes.

| Island and captures | Integrated elements | Full | Compact | Runtime | QA |
| --- | --- | ---: | ---: | ---: | ---: |
| [l1c](anim-shots/l1c/) | windmill-sails, orchard-crown | 984,631 | 298,442 | **1,283,812** | 418,336 |
| [i01](anim-shots/i01/) | cottage-hawthorn, south-meadow-hawthorn, southeast-hawthorn, honey-cottage-smoke | 1,736,535 | 452,957 | **2,190,686** | 707,640 |
| [i03](anim-shots/i03/) | plunge-pool, lower-falls-and-spray, eastern-ice-channel | 2,101,189 | 680,324 | **2,782,481** | 693,850 |
| [i04](anim-shots/i04/) | west-ledge-foam, trestle-tailwater, spring-outlet, crystal-tree-crown | 1,755,791 | 583,384 | **2,340,364** | 1,000,530 |
| [i05](anim-shots/i05/) | windmill-sails, scarecrow-wheat, eastern-wheat | 1,861,994 | 598,504 | **2,461,464** | 971,271 |
| [i06](anim-shots/i06/) | western-surf, inner-cove, south-lagoon-wash, eastern-swell | 1,599,335 | 534,431 | **2,134,941** | 532,112 |
| [i07](anim-shots/i07/) | north-gorge-mist, between-arches-current, lower-gorge-spray | 1,320,233 | 476,586 | **1,797,781** | 562,121 |
| [i08](anim-shots/i08/) | bastion-moat, reed-bank-ripples | 968,606 | 337,404 | **1,306,739** | 608,095 |
| [i09](anim-shots/i09/) | northwest-border-crown | 331,581 | 106,112 | **438,213** | 322,942 |
| [i10](anim-shots/i10/) | east-terrace-channel, bridge-tributary | 667,665 | 213,026 | **881,438** | 392,021 |
| [i11](anim-shots/i11/) | west-cloudbank, central-cloud-billows, blue-ravine-wisps | 1,370,124 | 440,229 | **1,811,308** | 601,865 |
| [i12](anim-shots/i12/) | silver-hazel, north-canopy-shadow, south-canopy-shadow | 654,456 | 204,548 | **859,955** | 447,014 |
| [i13](anim-shots/i13/) | dial-shelf-rain-sheen, west-shelf-mist | 332,100 | 115,829 | **448,656** | 436,295 |
| [i14](anim-shots/i14/) | merchant-awning, date-palm-fronds, potter-striped-shade, dry-wash-dust | 1,672,463 | 516,794 | **2,190,453** | 705,242 |
| [i15](anim-shots/i15/) | west-pool-reflection, north-pool-moonlight | 507,792 | 177,715 | **686,258** | 409,820 |
| [i16](anim-shots/i16/) | north-ember-seam, brazier-smoke | 377,703 | 134,047 | **512,482** | 339,667 |

## Takes left static

Every row below has a confident source match. Missing or ambiguous generations numbered zero. The match table records the exact inbox filename, best and runner-up SSIM, review decision and packing settings for each element. [First-frame matches](../design/art-2d/anim/match-ch1.json)

| Island | Element | Review finding |
| --- | --- | --- |
| l1c | west-fir | The crown slides out of its old silhouette and a new dark cast shadow pulses under the trunk beside the gate. |
| l1c | east-oak | The rounded painted crown sprouts pointed, high-contrast leaves and a new right-hand bough. |
| i01 | east-hawthorn | The left spray runs past the authored crown and a pale wind streak crosses the meadow. |
| i03 | upper-cascade | Flat opaque white crescents replace the textured pale ripples. |
| i04 | bridge-head-rapid | Dark outlined strokes turn into flat cream ribbons over the rock lip. |
| i05 | southern-windrows | White wind ribbons cross the ground between rows instead of the wheat bending. |
| i07 | west-overhanging-canopy | The diffuse painted canopy becomes a sharply drawn new foreground branch. |
| i08 | ruined-arch-reflection | Hard concentric gold rings replace the broken painted reflection at the masonry. |
| i08 | east-lake-glints | Thick gold outlines spread across almost the entire pool and drown out the brushwork. |
| i08 | southern-reflection | The scattered reflected highlights become heavy concentric gold bands. |
| i09 | northeast-border-crown | A new, oversized pale branch travels laterally across the flower bed. |
| i09 | southwest-border-crown | Blue and cream shrubs brighten over a wide patch and change volume around the fixed ornament. |
| i09 | southeast-border-crown | The crown flashes a much brighter yellow and near-white across the bed. |
| i10 | north-terrace-inlet | Bright turquoise and almost black strokes replace the muted green painted current. |
| i10 | east-bank-willow | New thin branches grow out of both sides of the broad-leaved crown. |
| i11 | spire-foot-cloud | Opaque ornamental spirals climb in front of the rock spires. |
| i12 | east-canopy-shadow | A sharp black foreground branch covers the stump and its painted shadow. |
| i13 | eastern-slate-sheen | A detached pale streamer with white sparkles crosses the slate. |
| i13 | south-ledge-mist | Opaque blue scrolls pass in front of the ledge and plants. |
| i15 | western-deepwater | The camera moves, bringing the stone gate and lily pool into view as the ripple crosses. |
| i15 | inner-moonwell-pool | An electric blue luminous trail swirls over the bank plants. |
| i16 | south-cooling-seam | The narrow ember line opens into a bright lava band with flames above the crust. |
| i16 | annealing-rack-heat | Thick outlined glass-like tubes emerge from the discs in place of heat shimmer. |

## Registration and playback

First-frame comparisons used RGB area downsampling to 96 × 54 and local SSIM averaged over the three channels. Winning scores ranged from 0.921852 to 0.996935. The smallest lead over another video was 0.420993. Five source poses were compared at 0, 1.5, 3.5, 5.5 and 7 seconds. The masked composites were reviewed against the source painting.

Each shipped tile uses stationary landmarks outside its runtime mask, robust similarity registration, median per-channel correction and opening-frame residual correction. The nonzero feather bounds determine its fractional layout rectangle. Widening the foliage and awning masks preserves the background revealed by the moving silhouette. The packer orders the tiles by depth and extrudes their colour gutters. [Packer](../tools/map-anim/pack_loops.py)

Each island plays one eight-second silent H.264/BT.709 atlas with a lossless WebP mask. Desktop selects the 24 fps, 192-frame track in these captures. The 1× phone bake selects the half-width, half-height 12 fps track with 96 frames. The pilot renderer already discovers island descriptors, draws the depth-sorted mesh below gameplay and eases the first and final frames into the current bake. The i02 data and media are byte-identical to the branch baseline. Rechecking its pilot captures passed all 14 original desktop and phone element comparisons. [Renderer](../src/render2d/mapAnimLayer.ts) · [Descriptors](../src/data/mapAnim/)

The match table includes the maximum XY correction at the mask origin in start-frame pixels, maximum median BGR correction, feather-weighted raw wrap and p95 adjacent-frame difference in channel values out of 255. The largest registration correction was 7.26 px on the l1c orchard crown. The i10 bridge tributary needed the additional half-second seam blend. i05 uses CRF 20 with 1.15× wheat and 1.75× sails. i04 and i06 use CRF 19, with i06 water at 1.7×. The other tracks use the pilot CRF 16.

### Windmill sweep

The motion masks use full circles centred on the axles. The table reports the largest connected region in the maximum channel difference from frame zero over all 192 decoded frames at a threshold of 35/255. The last columns give the minimum bilinearly sampled opacity across that region in each shipped mask. The visual checks also cover the untouched cap, window, doorway and adjoining roof as the sails pass them.

| Island | Axle in start pixels | Radius of detected motion | Radius of runtime mask | Min opacity, full / compact (0–255) |
| --- | --- | ---: | ---: | ---: |
| [l1c](anim-shots/l1c/closeups/windmill-sails.webp) | 639, 371 | 329.99 px | 342 px | 255.00 / 254.73 |
| [i05](anim-shots/i05/closeups/windmill-sails.webp) | 616, 358 | 349.41 px | 358 px | 255.00 / 254.84 |

## Browser QA

The animated WebP in each viewport contains six full Playwright screenshots with the battle HUD and a lower-right media timecode, sought at 0, 1.5, 3, 4.5, 6 and 7.958 seconds on the live media clock. Close-ups compare static, 2 seconds, 4 seconds and the last frame on both devices. The close-up captures hide the DOM controls. Their third row uses the real Medium renderer at one CSS pixel per layout pixel, with the Pixi HUD hidden and the entire island visible. This exposes features beyond the normal viewport or beneath a HUD plate. The phone viewport is 844 × 390 with DPR 2. Desktop is 2000 × 991 with DPR 1.

Across 132 element checks on the two native views and the unobscured map, the largest final-to-first channel difference was 0/255. Four-second captures had moving pixels for every element. The largest change in the checked surround beyond the projected mask and two-device-pixel filter allowance was 0/255. Low entry and High with Reduced motion made zero ambient requests on every island. Both High views passed the game pause and resume check.

### Frame times

Each cell gives mean / p95 inter-frame time in milliseconds. The same idle High-quality scene ran for three seconds with Reduced motion and then for three seconds with animation. Chromium 153.0.8010.12 used ANGLE SwiftShader on a shared host. These short samples measure software rendering. Physical phone GPU timing and iOS playback remain unverified. The linked JSON includes p50, sample counts, render resolution, fit and requested files.

| Island | Desktop static | Desktop animated | Phone static | Phone animated |
| --- | ---: | ---: | ---: | ---: |
| [l1c](anim-shots/l1c/measurements.json) | 121.79 / 233.4 | 171.05 / 233.4 | 79.82 / 150.1 | 89.21 / 116.6 |
| [i01](anim-shots/i01/measurements.json) | 77.35 / 133.3 | 68.18 / 83.4 | 97.84 / 200.0 | 98.38 / 116.7 |
| [i03](anim-shots/i03/measurements.json) | 67.75 / 116.7 | 99.46 / 116.7 | 79.48 / 150.0 | 90.68 / 116.7 |
| [i04](anim-shots/i04/measurements.json) | 72.62 / 116.6 | 86.66 / 100.0 | 82.88 / 150.0 | 118.58 / 183.4 |
| [i05](anim-shots/i05/measurements.json) | 89.52 / 133.3 | 94.27 / 100.1 | 50.55 / 99.9 | 51.13 / 100.0 |
| [i06](anim-shots/i06/measurements.json) | 53.16 / 99.9 | 88.72 / 133.4 | 64.54 / 116.6 | 89.04 / 133.4 |
| [i07](anim-shots/i07/measurements.json) | 57.86 / 100.1 | 125.69 / 183.3 | 77.35 / 150.0 | 96.87 / 150.0 |
| [i08](anim-shots/i08/measurements.json) | 143.64 / 300.0 | 126.38 / 150.0 | 91.17 / 150.0 | 101.11 / 116.8 |
| [i09](anim-shots/i09/measurements.json) | 70.93 / 133.2 | 75.83 / 116.6 | 71.31 / 116.7 | 91.41 / 116.7 |
| [i10](anim-shots/i10/measurements.json) | 72.48 / 166.7 | 95.83 / 116.8 | 33.71 / 66.7 | 43.72 / 83.2 |
| [i11](anim-shots/i11/measurements.json) | 120.66 / 200.1 | 169.44 / 233.4 | 105.17 / 233.3 | 112.34 / 166.7 |
| [i12](anim-shots/i12/measurements.json) | 76.92 / 133.4 | 88.72 / 100.0 | 57.54 / 100.0 | 48.15 / 100.0 |
| [i13](anim-shots/i13/measurements.json) | 83.78 / 150.0 | 102.22 / 133.3 | 51.13 / 66.7 | 56.17 / 100.0 |
| [i14](anim-shots/i14/measurements.json) | 39.18 / 66.7 | 58.01 / 66.7 | 49.45 / 66.7 | 52.87 / 83.4 |
| [i15](anim-shots/i15/measurements.json) | 81.14 / 100.1 | 105.74 / 133.3 | 53.80 / 66.7 | 53.57 / 83.4 |
| [i16](anim-shots/i16/measurements.json) | 39.39 / 50.1 | 53.51 / 66.7 | 50.82 / 83.4 | 52.58 / 100.0 |

## Reproduction

Use Node 22, ffmpeg, Python with OpenCV, Pillow and NumPy, and Playwright with H.264-capable Chromium. Run the capture against the production preview. The packer reads inbox files in place. The pilot command without a match table continues to use its local source folders.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
python3 tools/map-anim/pack_loops.py i05 --matches design/art-2d/anim/match-ch1.json --inbox /root/work/anim-inbox
npm run build
# Run the capture with npm run preview serving the build in another terminal.
ISLAND=i05 BASE=http://127.0.0.1:4173 node qa/mapAnimShots.mjs
```

## Release gate

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | 1,539 passed, 11 skipped across 120 passed files and one skipped file |
| `npm run sim:balance` | Greedy and Weak targets passed for all 41 levels |
| `npm run build` | Passed, 1,175 modules transformed. Vite reported the large-chunk warning and ineffective dynamic imports for the level index and Codex |
