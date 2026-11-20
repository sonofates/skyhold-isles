# Living maps for i17–i24

All 34 prepared elements have a unique source in the 108-video inbox. Nineteen loops ship across eight islands. Fifteen matched takes stay static after visual review. The largest runtime payload is **3,514,908 bytes on i20**, including both video resolutions, both masks and the descriptor. [Source matches, scores and processing settings](../design/art-2d/anim/match-ch2.json)

## Island inventory

Full and compact sizes below include the mask for that track. Runtime adds both tracks and the island JSON. The last column also counts all files in that island’s QA directory. The game fetches one track on entry with motion enabled.

| Island | Animated elements and close-ups | Full bytes | Compact bytes | Runtime bytes | With QA bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| [i17 Cloudbell Cloister](../src/data/mapAnim/i17.json) | [east cliff vapour](anim-shots/i17/closeups/east-cliff-vapour.webp) | 148,860 | 60,315 | 209,692 | 571,519 |
| [i18 Lantern Glassworks](../src/data/mapAnim/i18.json) | [north vault crystals](anim-shots/i18/closeups/north-vault-crystals.webp), [amethyst geode](anim-shots/i18/closeups/amethyst-geode.webp), [kiln side crystals](anim-shots/i18/closeups/kiln-side-crystals.webp), [lower gallery fan](anim-shots/i18/closeups/lower-gallery-fan.webp) | 1,556,354 | 558,330 | 2,115,872 | 2,643,495 |
| [i19 Lanternseed Fig](../src/data/mapAnim/i19.json) | [ancient fig crown](anim-shots/i19/closeups/ancient-fig-crown.webp), [western fig bough](anim-shots/i19/closeups/western-fig-bough.webp), [foreground fig leaves](anim-shots/i19/closeups/foreground-fig-leaves.webp) | 2,535,478 | 851,301 | 3,387,737 | 3,946,604 |
| [i20 Three Pennants Head](../src/data/mapAnim/i20.json) | [western reef breaker](anim-shots/i20/closeups/western-reef-breaker.webp), [north inlet swell](anim-shots/i20/closeups/north-inlet-swell.webp), [masthead streamers](anim-shots/i20/closeups/masthead-streamers.webp), [southeast reef wash](anim-shots/i20/closeups/southeast-reef-wash.webp), [northeast offshore swell](anim-shots/i20/closeups/northeast-offshore-swell.webp) | 2,598,627 | 914,849 | 3,514,908 | 3,945,353 |
| [i21 Kitewright Down](../src/data/mapAnim/i21.json) | [north rim pines](anim-shots/i21/closeups/north-rim-pines.webp) | 333,712 | 115,846 | 450,070 | 838,808 |
| [i22 Brineglass Ferry](../src/data/mapAnim/i22.json) | [mooring rings](anim-shots/i22/closeups/mooring-rings.webp) | 408,908 | 161,525 | 570,936 | 893,936 |
| [i23 Waxlight Orchard](../src/data/mapAnim/i23.json) | [eastern fruit spray](anim-shots/i23/closeups/eastern-fruit-spray.webp), [western berry bough](anim-shots/i23/closeups/western-berry-bough.webp) | 968,739 | 353,228 | 1,322,704 | 1,824,555 |
| [i24 Lastlight Head](../src/data/mapAnim/i24.json) | [west cleft surge](anim-shots/i24/closeups/west-cleft-surge.webp), [east cove breaker](anim-shots/i24/closeups/east-cove-breaker.webp) | 784,929 | 271,121 | 1,056,791 | 1,451,099 |

## Takes kept static

| Island | Element and review frames | Reason |
| --- | --- | --- |
| i17 | [western cloud shelf](anim-shots/i17/static/western-cloud-shelf.webp) | New bright, hard-edged cloud curls cross in front of the distant island and break at its silhouette. |
| i17 | [fallen bell reflection](anim-shots/i17/static/fallen-bell-reflection.webp) | Opaque cream cloud silhouettes travel over the bronze and obscure the engraved bands. |
| i17 | [southern cloudbank](anim-shots/i17/static/southern-cloudbank.webp) | The soft painted haze changes into sharply outlined ornamental spirals. |
| i18 | [east wall vein](anim-shots/i18/static/east-wall-vein.webp) | New freestanding crystals grow across the cavern floor and into the seam. |
| i19 | [eastern ravine mist](anim-shots/i19/static/eastern-ravine-mist.webp) | The opening lacks the painted central puff. Opening-frame correction leaves a stationary bright puff and a warm pink double edge as the generated mist passes. |
| i21 | [weather kite silk](anim-shots/i21/static/weather-kite-silk.webp) | As the tails lift, the rigid cross spars and the kite corners also rise away from their painted positions. |
| i21 | [southwest cliff pine](anim-shots/i21/static/southwest-cliff-pine.webp) | The soft crown changes into sharply stippled needles, and a moving pad exposes a pale hole in its painted silhouette. |
| i21 | [southeast cliff pine](anim-shots/i21/static/southeast-cliff-pine.webp) | The soft distant tree switches to sharply resolved individual needles between the opening and closing poses. |
| i22 | [ferry pool undercurrent](anim-shots/i22/static/ferry-pool-undercurrent.webp) | A flat mint ribbon sweeps over the mineral bank and replaces the pool reflection. |
| i22 | [mineral light pool](anim-shots/i22/static/mineral-light-pool.webp) | A sharply bounded turquoise puddle expands across the salt floor and changes the painted light into water. |
| i22 | [salt crystal terrace](anim-shots/i22/static/salt-crystal-terrace.webp) | A round pearl rolls down the ridge, adding a solid object in place of reflected light. |
| i23 | [upper orchard bough](anim-shots/i23/static/upper-orchard-bough.webp) | The upper pear lifts away and a second pair of smaller pears appears beneath the branch. |
| i23 | [southern harvest bough](anim-shots/i23/static/southern-harvest-bough.webp) | The green and red leaves peel away as newly outlined shapes with different brush detail. |
| i24 | [lower headland swell](anim-shots/i24/static/lower-headland-swell.webp) | Thin parallel white arcs form a wire-like grid across the breaking wave. |
| i24 | [black rock backwash](anim-shots/i24/static/black-rock-backwash.webp) | The opening loses the painted foam between the boulders. After opening-frame correction, stationary pale streaks show through the moving foam and the crest washes out. |

## Matching and processing

Opening-frame SSIM was computed across all 108 candidates after area downsampling to 160 × 90. Thirty-two full-frame winners scored at least 0.964. On i19 ravine mist and i24 black-rock backwash the generated moving area already differed at frame zero. Restricting the same comparison to whole SSIM windows outside the authored mask confirmed both identities. The fixed-region winner / runner-up scores were 0.9480 / 0.2378 and 0.9695 / 0.3884 respectively. Both takes failed the subsequent composite review.

The pilot packer registered all 192 frames of each shipping take to stationary landmarks, corrected per-channel shift, matched the painted opening, and cropped the movie and inward feather to the working mask. The original crop origin and start-to-layout scale determine the fractional layout rectangle. The runtime format is an eight-second silent BT.709 H.264 atlas with four-texel gutters and a lossless WebP mask. The full track has 192 frames at 24 fps. The half-size compact track has 96 frames at 12 fps and shares the UV coordinates. [Pilot packer](../tools/map-anim/pack_loops.py) · [Pilot handoff](handoff-codex-anim-i02.md)

Five moving silhouettes needed more room than their rest-pose masks. In start-frame pixels, the western fig bough gained a 52 px envelope, foreground fig leaves 142 px, masthead streamers 82 px, eastern fruit spray 105 px and western berry bough 178 px. Each working mask takes the maximum of the authored feather and the expanded envelope. The envelope uses Euclidean distance from the authored mask core (values ≥150), with a 22 px outer feather. For the streamers, core X is restricted to (232, 1020) and the added alpha tapers in from x=230 to 252 at the mast. The match file records each final box and its scale, opacity, inward feather and depth. There are no rotating sail or wheel elements in this chapter.

Across retained takes, the largest registration correction at the crop origin was 3.69 start-frame pixels, on the eastern fruit spray. The largest raw wrap error was 3.22/255, on the southeast reef wash, against an adjacent-step p95 of 9.46/255. Every retained raw wrap fell below its own adjacent-step p95. The two rejected opening-phase mismatches had raw wraps of 33.96 and 43.65/255. None of the shipping masks intersected an authored plot disk or a path centerline in layout space.

## Browser QA

Playwright captured six frames of the production battle at 0, 1.5, 3, 4.5, 6 seconds and the last frame. The desktop sequences are 2000 × 991 at DPR 1. The emulated landscape phones are 844 × 390 at DPR 2, captured at CSS size. For complete close-ups of edge elements, the frozen inspection view fits the entire painting and displays the map and live ambient mesh with the HUD and actors hidden. The full sequences use the normal game camera and HUD.

Static and animated columns show **mean / p95 frame interval in milliseconds**. Each High-quality idle battle ran for four seconds with Reduced motion, then for 8.3 seconds with motion enabled. Every animated sample crossed the loop boundary. The JSON includes sample counts, p50, selected tracks, map fits, requests and lossless pixel checks. Chromium 153.0.8010.12 ran with ANGLE SwiftShader on a shared host. These samples measure software rendering. Physical phone and Safari performance remain unmeasured.

| Island and measurements | Desktop static | Desktop animated | Phone static | Phone animated | Six-frame sequences |
| --- | ---: | ---: | ---: | ---: | --- |
| [i17](anim-shots/i17/measurements.json) | 86.5 / 166.6 | 87.5 / 116.7 | 87.3 / 199.9 | 89.2 / 149.9 | [Desktop](anim-shots/i17/desktop.webp) · [Phone](anim-shots/i17/phone.webp) |
| [i18](anim-shots/i18/measurements.json) | 79.7 / 116.7 | 89.8 / 116.7 | 71.3 / 133.3 | 97.3 / 133.3 | [Desktop](anim-shots/i18/desktop.webp) · [Phone](anim-shots/i18/phone.webp) |
| [i19](anim-shots/i19/measurements.json) | 71.7 / 100.0 | 93.8 / 133.4 | 85.8 / 166.7 | 87.7 / 133.3 | [Desktop](anim-shots/i19/desktop.webp) · [Phone](anim-shots/i19/phone.webp) |
| [i20](anim-shots/i20/measurements.json) | 155.8 / 300.0 | 136.9 / 166.7 | 73.6 / 99.9 | 88.7 / 150.0 | [Desktop](anim-shots/i20/desktop.webp) · [Phone](anim-shots/i20/phone.webp) |
| [i21](anim-shots/i21/measurements.json) | 62.3 / 100.0 | 78.9 / 133.3 | 175.4 / 316.6 | 134.4 / 183.3 | [Desktop](anim-shots/i21/desktop.webp) · [Phone](anim-shots/i21/phone.webp) |
| [i22](anim-shots/i22/measurements.json) | 119.1 / 166.8 | 175.0 / 266.6 | 73.0 / 116.7 | 108.2 / 133.4 | [Desktop](anim-shots/i22/desktop.webp) · [Phone](anim-shots/i22/phone.webp) |
| [i23](anim-shots/i23/measurements.json) | 125.5 / 200.1 | 152.7 / 199.9 | 89.1 / 183.3 | 82.5 / 133.4 | [Desktop](anim-shots/i23/desktop.webp) · [Phone](anim-shots/i23/phone.webp) |
| [i24](anim-shots/i24/measurements.json) | 75.3 / 116.6 | 83.3 / 116.7 | 79.7 / 150.1 | 75.8 / 133.4 | [Desktop](anim-shots/i24/desktop.webp) · [Phone](anim-shots/i24/phone.webp) |

All eight Low-quality entries and all sixteen High-quality Reduced-motion entries made zero ambient asset requests. In each animated case the game requested its own island’s movie and mask. The lossless inspection frames showed motion in every included element on both viewports. The rendered final and opening frames agreed pixel-for-pixel, and the region outside the union of the feathers plus a two-device-pixel filtering margin stayed static.

Medium played the compact track on all eight phones and released the video when Reduced motion was enabled during play. Desktop i22 had the slowest animated p95 at 266.6 ms, against 166.8 ms static. The decoder reported four dropped frames on desktop i22 and three on desktop i23. The other fourteen High-quality samples reported zero.

The i18 and i21 phone sequences were captured during wave one. **At 844 × 390, i21’s only retained element falls outside the battle camera.** Its right edge projects to approximately −3 CSS pixels in both the idle and wave-one views. The compact track plays, and the entire element is visible in the full-map inspection. A second normal battle capture at 667 × 375 shows 178 changing pixels inside the visible pine mask. [844 × 390 before wave one](anim-shots/i21/phone-prewave.webp) · [667 × 375 during wave one](anim-shots/i21/phone-667.webp) · [Pine close-up](anim-shots/i21/closeups/north-rim-pines.webp)

## Gate

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | 1,539 passed and 11 skipped. 120 test files passed and one skipped. |
| `npm run sim:balance` | Greedy and Weak targets passed across all 41 levels. Greedy won each of i17–i24. |
| `npm run build` | Passed, 1,167 modules transformed. Vite reported a large-chunk advisory and ineffective dynamic imports for the level index and Codex. |

Node 22.21.1. Changes are uncommitted on `codex/animprep-ch2`.
