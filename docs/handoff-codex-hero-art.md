# Hero and global ability art

Five heroes and both global abilities are registered in the raw 2D art manifest. The pack contains 48 standalone WebPs and 32 animated WebP sheets with adjacent grid descriptors. The [contact sheet](hero-art-sheet.jpg) shows every portrait, select figure, skill and branch icon, plus all 130 animation frames.

## Looking up assets

Read `heroes` and `abilities` from `public/art2d/manifest.json`. Paths there are relative to `/art2d/`. Each sheet descriptor's `image` is relative to the descriptor’s own directory. The existing `parseSheetJson` reader accepts all 32 descriptors. The current `parseManifest` projection drops the two new sections. The renderer and UI owners can expose them there or read the raw sections when wiring heroes.

### Hero selection and HUD

For each ID below, `heroes.<id>.portrait` is a 512 × 512 brass-rimmed portrait and `heroes.<id>.select` is a full-body cutout. Each `heroes.<id>.skills.<skillId>` is a 256 × 256 cutout. The table gives the exact skill IDs in HUD order.

| Hero ID | Select size | Passive | Active 1 | Active 2 |
| --- | --- | --- | --- | --- |
| `bran` | 659 × 900 | `bulwark` | `shieldBash` | `rallyBanner` |
| `wren` | 611 × 900 | `keenEye` | `volley` | `huntersMark` |
| `mira` | 611 × 900 | `kindling` | `fireRing` | `wispBurst` |
| `tobb` | 621 × 900 | `tinker` | `deployGizmo` | `overhaul` |
| `sela` | 616 × 900 | `calmWaters` | `undertow` | `thunderCall` |

Each hero also has three distinct 256 × 256 icons at `heroes.<id>.branches.passive`, `heroes.<id>.branches.active1` and `heroes.<id>.branches.active2`. Reuse each for its four tiers. I assigned the three branch slots to the passive and two actives because the shared spec leaves branch names open. The UI can map its final node IDs to these slots.

### Hero animation

Each hero has `mode` set to `sheet` and a static `file` containing the first idle pose on the animation canvas. The table gives the six paths under `heroes.<id>`. Each descriptor has `count: 4`, `cols: 4`, `frameW`, `frameH`, `fps`, a pixel `anchor` and a sibling WebP filename in `image`. Read left to right, with zero-based frame indices.

| Key | FPS | Playback |
| --- | ---: | --- |
| `idle` | 4 | Loop 0–3 |
| `sheet.down` | 8 | Loop 0–3, walking towards the viewer |
| `sheet.up` | 8 | Loop 0–3, walking away |
| `sheet.side` | 8 | Loop 0–3, walking to screen right. Mirror for left. |
| `attack` | 7 | Ready, wind-up, contact or release, recovery. Every descriptor sets `impact: 2`. Play once. |
| `death` | 7 | Recoil, stagger, kneel, prone. Play once and hold frame 3 if needed. |

The root `facing` is `right`. The directional metadata is `sheet.facing = right`, `sheet.facingUp = left` and `sheet.facingSide = right`. Front and rear views are close to axial. Use `sheet.side` for horizontal travel. Every frame for a given hero shares the same size and anchor, including the fallen pose. The hero's root `anchor` is normalized to `[0.5, 0.9765625]`.

| Hero | Frame size | Anchor in frame pixels | Manifest `height` in world units |
| --- | --- | --- | ---: |
| Bran | 266 × 256 | [133, 250] | 1.52 |
| Wren | 320 × 256 | [160, 250] | 1.43 |
| Mira | 314 × 256 | [157, 250] | 1.27 |
| Tobb | 304 × 256 | [152, 250] | 1.35 |
| Sela | 418 × 256 | [209, 250] | 1.59 |

I chose these display heights relative to the 1.15-unit soldier, with Mira smallest and Sela tallest. Use the same frame-height scale through attack and death so the extended staff and prone pose retain their proportions.

### Global abilities

| Exact key | Asset and registration |
| --- | --- |
| `abilities.meteor.icon` | 256 × 256 HUD cutout |
| `abilities.meteor.falling` | 384 × 273 projectile, trail upper left, incandescent rock lower right |
| `abilities.meteor.fallingAnchor` | Normalized [0.81, 0.77] locates the rock near the head of the trail |
| `abilities.meteor.impact` | 6 columns, 6 frames, 288 × 256 each, 9 fps. Pixel anchor [144, 158] is the ground target. |
| `abilities.overcharge.icon` | 256 × 256 HUD cutout |
| `abilities.overcharge.aura` | 4 columns, 4 frames, 384 × 256 each, 6 fps. Pixel anchor [192, 186] is the center of the tower footprint. |

Place Meteor’s rock at the target on the simulation’s impact event. Play its impact strip once. Frames 0–2 are the flash, burst and shock ring. Frames 3–5 are the glowing, cooling and cold crater. Frame 5 can be held or faded. Overcharge’s aura has an open center and can loop over each affected tower base for the active duration. The simulation owns the ability timing.

## Production and checks

The built-in image generator produced the model, motion, icon and effect plates against solid magenta. The final walk pass emphasized alternating contacts. I corrected the staff side on Mira and Sela’s rear views before packing. The [generation brief](../design/art-2d/briefs/hero-art.md) records the prompt set.

| Files | Purpose |
| --- | --- |
| `public/art2d/heroes/{bran,wren,mira,tobb,sela}/` | Hero cutouts, icons, standing sprites, sheets and descriptors |
| `public/art2d/abilities/{meteor,overcharge}/` | Global HUD and effect art |
| `public/art2d/manifest.json` | Hero and ability art keys |
| `design/art-2d/key.py` | Exposes the existing chroma key as an import for full-resolution cuts |
| `tools/sprites/hero_pack.py` | Finds clear gutters around weapon extensions, applies the chroma key and packs the assets and metadata |
| `tools/sprites/hero_contact.py` | Rebuilds `docs/hero-art-sheet.jpg` from the shipped manifest and textures |
| `design/art-2d/briefs/hero-art.md`, `docs/handoff-codex-hero-art.md` | Generation inputs and integration reference |

To repack the original cuts in this checkout, run `/usr/bin/python3 tools/sprites/hero_pack.py`. The source PNGs are local in the ignored `design/art-2d/raw/hero-art/` directory. To regenerate the contact sheet from any checkout carrying the shipped art, run `/usr/bin/python3 tools/sprites/hero_contact.py`.

I inspected the final strips on ground guides, checked the HUD art at 48 px and composited Overcharge on the tier-one crystal tower. All 120 hero frames meet the same y=250 baseline at alpha greater than 16. Pillow verified the canvas sizes, transparent margins, distinct frames, circular HUD bounds and all 112 registered files. Live playback in the game awaits renderer integration.

## Gate

Run on `codex/hero-art` with Node 22.21.1. Changes are uncommitted.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | 1,102 passed, 11 skipped, 0 failed. 84 test files passed and 1 skipped. |
| `npm run sim:balance` | 33/33 levels passed the Greedy and Weak targets |
| `npm run build` | Passed with Vite’s chunk-size advisory |

The art is ready for wiring. The branch-slot mapping and hero display heights above are the discretionary art choices for owner review.
