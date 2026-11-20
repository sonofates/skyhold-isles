# Twin-Bridge Cay living map

Seven Omni loops play in the battle view on High and Medium. Low and Reduced motion keep the static island and make zero ambient asset requests on entry. The pilot light and bank sea thrift remain painted into the map. Total island animation payload is **2,949,041 bytes**, including both resolutions, their masks and the source descriptor. A client downloads the selected resolution. [Eight-second game capture](anim-i02-demo.mp4) · [Processing, format and placement](anim-i02-plan.md#phase-2-delivery)

## Registration and seam

Each input was 1280 × 720, 24 fps and 192 frames. The table shows the largest absolute registration correction in either axis at the mask origin, in start-frame pixels. The last two columns compare the raw registered last-to-first change with ordinary frame-to-frame motion, using feather-weighted mean absolute RGB difference on the 0–255 scale. These measurements precede the final fade into the map.

| Element | Full-track crop | Max correction | Raw wrap | Adjacent p95 |
| --- | ---: | ---: | ---: | ---: |
| [Trestle current](anim-i02-shots/closeups/trestle-current.webp) | 267 × 289 | 0.15 px | 1.70 | 4.08 |
| [Lifting-span outflow](anim-i02-shots/closeups/lifting-span-outflow.webp) | 368 × 218 | 0.13 px | 1.47 | 2.89 |
| [Estuary wash](anim-i02-shots/closeups/estuary-wash.webp) | 385 × 186 | 0.32 px | 2.06 | 11.85 |
| [Pilot boat](anim-i02-shots/closeups/pilot-boat.webp) | 77 × 114 | 0.11 px | 2.39 | 8.23 |
| [Fishing smack](anim-i02-shots/closeups/fishing-smack.webp) | 129 × 242 | 0.16 px | 3.56 | 5.34 |
| [Trestle banner](anim-i02-shots/closeups/trestle-banner.webp) | 53 × 76 | 0.59 px | 2.04 | 10.25 |
| [Net-loft smoke](anim-i02-shots/closeups/net-loft-smoke.webp) | 70 × 124 | 0.34 px | 0.94 | 4.61 |

The largest median color correction was seven channel values, in the smoke crop’s blue channel. During review, per-pixel motion weighting stippled the pilot boat’s oars and the banner emblem. Using the full registered RGB beneath the authored feather keeps those painted details together. The renderer uses one depth-ordered mesh, one video and one static mask. Loading, seeking, quality changes and navigation own their resources. The normal update path compares scalar state and updates the existing texture when the movie frame changes. [Renderer](../src/render2d/mapAnimLayer.ts) · [Island data](../src/data/mapAnim/i02.json)

## Browser evidence

The six frames in each sequence are at 0, 0.5, 1, 1.5, 2 and 2.5 seconds. Playwright sought the actual video and rendered the game at each timestamp. Full frames include the play HUD. The close-up sheets hide the DOM ability bar to expose the fishing berth. They include the live 2× to 3× bake upgrade at a fixed animation time. The MP4 shows one complete eight-second cycle at 12 fps. [Desktop sequence](anim-i02-shots/desktop-0.jpg) · [Phone sequence](anim-i02-shots/phone-0.jpg) · [All captures](anim-i02-shots/)

Across all fourteen desktop and phone close-ups, the maximum channel difference between the rendered final frame and frame zero was **0/255**. At four seconds every element had moving pixels. The surrounding pixels beyond the projected feather and its two-device-pixel filtering allowance had a maximum change of **0/255**. The hulls, dock attachments, chimney and banner remained registered through the 2× to 3× swap. The compact phone track keeps the oars at the detail level of the 1× painting.

Both viewports completed three uninterrupted wraps. The game pause held the media clock still and resumed from the same position. In a headed Chromium session, switching to another tab held the clock at 1.520147 s through a 900 ms observation. Returning and resuming advanced it to 2.277549 s. A plot opened its build ring, an archer was built, and a wave spawned enemies while the movie continued.

### Frame times

Chrome 153.0.8010.12 used ANGLE SwiftShader. High quality was locked during the paired measurements. Static measurements ran for five seconds before and after the animated sample on the same idle island. The animated sample covered three wraps. All entries below are milliseconds. [Timing samples, map fits and request lists](anim-i02-shots/measurements.json)

| Viewport and framebuffer | Static before, mean / p50 / p95 | Animated, mean / p50 / p95 | Static after, mean / p50 / p95 |
| --- | --- | --- | --- |
| Desktop 2000 × 991, DPR 1 | 38.72 / 33.4 / 66.6 | 48.42 / 50.0 / 66.6 | 37.01 / 33.3 / 50.1 |
| Touch 844 × 390, DPR 2, 1688 × 780 buffer | 49.03 / 50.0 / 83.4 | 52.29 / 50.0 / 100.0 | 48.23 / 50.0 / 66.7 |

A separate 844 × 390 Medium run used `?level=i02&quality=med&bench=40` with a 1266 × 585 framebuffer. With 40 active enemies, the scene used **5 draws animated and 4 static**. Frame-time p50 / p95 was 33.4 / 83.4 ms animated and 33.3 / 66.6 ms static. These are software-rendered browser measurements. Physical mid-range phone frame pacing and iOS playback remain unverified. [Combat timing samples](anim-i02-shots/combat-timing.json)

### Reproduce

From the checkout, use Node 22 and build the production preview. With Playwright available, run the following against the running preview. The capture script writes the sequences, seven comparison sheets and demo. The Python image checks use Pillow and NumPy. `CHROME` can select an installed Chromium executable.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
BASE=http://127.0.0.1:4173 DEMO=1 node qa/mapAnimShots.mjs
```

## Gate

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | 1,539 passed and 11 skipped across 120 passed files and one skipped file |
| `npm run sim:balance` | Greedy and Weak targets passed across 41 levels. On i02, Greedy finished with 21/21 lives and three stars, Weak with 11/21 and two stars |
| `npm run build` | Passed, 1,159 modules transformed. Vite reported large chunks and ineffective dynamic imports for the level index and Codex |

The phase-1 files, source loops and phase-2 changes are in the original `codex/anim-i02` checkout, uncommitted for the orchestrator.
