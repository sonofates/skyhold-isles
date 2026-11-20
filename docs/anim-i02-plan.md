# Twin-Bridge Cay · living map pilot

The two channels carry the eye from the trestle to the estuary. At the berths, each hull and its closest ripples share a loop so the wake follows the boat. The trestle cloth and lamp have separate masks so a gust can bend the cream wave emblem while the brass frame stays rigid. The net loft has a chimney with clear air above it in the bake. Its first wisp rises behind the back rim and disperses before the seam. Six pink sea-thrift heads provide the bank motion.

[Contact sheet](anim-i02-prep.jpg) · [Prep assets](../design/art-2d/anim/i02/) · [Tidal kit and painting notes](../design/art-2d/v2/biomes/tidal/twin-bridge-cay.md)

## Clips for Omni

Use each folder's `start.png` as the first frame, `mask.png` as its motion mask, and `prompt.txt` for direction. Every pair is 1280 × 720. White permits movement, black holds the bake, and the feather runs inward for 12 frame pixels (8 on the lamp panes). The review sheet shows the half-white contour. Use the clean PNGs for generation.

The layout crop column gives the source area in map units. The trim column gives the proposed shipping dimensions of **one frame**, excluding atlas gutters. The fps, frame counts and encoded sizes are phase 2 targets for one eight-second cycle. Each element name links to its handoff folder.

| Element | Layout crop (px) | Trim (texels) | Texels per layout px | FPS | Frames | WebP budget (kB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [Current between the bridges](../design/art-2d/anim/i02/trestle-current/) | 288 × 162 | 200 × 217 | 1.5 | 8 | 64 | 720 |
| [Water below the lifting span](../design/art-2d/anim/i02/lifting-span-outflow/) | 240 × 135 | 276 × 163 | 1.5 | 8 | 64 | 640 |
| [Foam at the estuary shore](../design/art-2d/anim/i02/estuary-wash/) | 256 × 144 | 289 × 139 | 1.5 | 8 | 64 | 680 |
| [Blue pilot boat](../design/art-2d/anim/i02/pilot-boat/) | 144 × 81 | 77 × 114 | 2 | 6 | 48 | 300 |
| [Moored fishing smack](../design/art-2d/anim/i02/fishing-smack/) | 288 × 162 | 129 × 242 | 2 | 6 | 48 | 480 |
| [Trestle wave banner](../design/art-2d/anim/i02/trestle-banner/) | 96 × 54 | 53 × 76 | 3 | 8 | 64 | 95 |
| [Brass pilot light](../design/art-2d/anim/i02/pilot-light/) | 48 × 27 | 12 × 23 | 3 | 6 | 48 | 35 |
| [Net loft chimney](../design/art-2d/anim/i02/net-loft-smoke/) | 128 × 72 | 35 × 62 | 1.5 | 8 | 64 | 160 |
| [Estuary bank sea thrift](../design/art-2d/anim/i02/bank-sea-thrift/) | 112 × 63 | 94 × 47 | 1.5 | 6 | 48 | 110 |

## Registration

All crops come from the 5538 × 2556 master, exactly three source pixels per pixel of the 1846 × 852 layout. Each start image is a single Lanczos resize of the recorded source rectangle. In `place.json`, rectangles use a top-left origin, x increases rightward and y downward. `sourceCropPxLTRB` and `maskBBoxStartPxLTRB` use exclusive right and bottom edges. The mask box includes every nonzero feather pixel. The two scale fields distinguish enlargement from the master from enlargement relative to layout. [3× master](../public/art2d/map-i02-layered@3x.webp) · [Layout](../src/data/levels2d/i02.json)

For crop origin `(x, y)`, start-frame box `[l, t, r, b)` and `s = startPxPerLayoutPx`, place the trimmed sprite at `(x + l/s, y + t/s)` and draw it at `((r-l)/s, (b-t)/s)` layout pixels. Keep these fractional values even when rounding shipping texel dimensions up. Atlas gutters lie outside the sampled cell. Bake resolution, device pixel ratio and viewport fit do not enter this transform.

## Phase 2 implementation

1. **Extract the full loop.** Add a fixed-crop, external-mask mode to the existing converter. Its character path keys magenta, halves the frame, searches for a short cycle and aligns feet. Map clips need full-size RGB, fixed coordinates and sampling at times `k/fps` for `0 ≤ k < 8 × fps`. Omit the duplicate endpoint. Check fixed edges against the start image for camera drift and inspect the last-to-first change alongside ordinary adjacent frames. Regenerate takes with moving masonry, distorted rigging or a visible reset. [Frame converter](../tools/sprites/veo_to_sheet.py)
2. **Composite against the bake.** Register each take to the start frame using stationary detail outside the mask. Correct any whole-take colour shift there and use the start image for frame zero. Preserve the moving RGB inside the mask, including the water revealed when a hull rocks. The same grayscale mask supplies alpha for every frame. With ordinary alpha blending, the result is `map × (1 − alpha) + frame × alpha`. Apply alpha once. The black surround always samples the static map and the feather tapers the moving image into it.
3. **Pack one grid sheet per element.** Trim every frame of a loop to the exact same mask box. Resize in premultiplied alpha to preserve fine edges, export alpha WebP with clean edge colours, and extrude a two-texel gutter around each cell for linear filtering. Choose rows and columns to fit within 2048 × 2048 per page, splitting only if required. Independent sheets let the client fetch just the active loops. The nine image allowances sum to **3.22 MB**, leaving **780 kB** for indices and encoding variance within a 4,000,000-byte total incremental download. Measure the encoded sheets plus metadata after generation. If over budget, reduce the broad water trims from 1.5× toward 1× first, then sample those clips at 6 fps and recheck the seam.
4. **Place and play.** Put a non-interactive container immediately above the painted map sprite inside Pixi's `MapView.world`, under the plot, ground-effect and actor layers. Use a top-left anchor and the layout transform above. One elapsed-time clock selects each frame from its grid. Pause it with the map. Keep the static bake visible during texture loads, crossfade overlays on tier changes, and release textures on island exit. [Map view](../src/render2d/mapView.ts) · [Battle layer setup](../src/render2d/game2d.ts)
5. **Scale by quality.** High loads all nine sheets. Medium (`med`) loads the current between the bridges, estuary wash and both boats. Low uses the static bake with zero animation downloads or ticking. Check three continuous loops on desktop and phone, including a map-resolution swap. At each supported bake size, toggle the overlay at frame zero and inspect the hull edges, mooring posts and shore for double contours. Inspect a composite difference outside the mask and compare the wrap on the moving water and light. If a lower-resolution bake has a different silhouette, keep that element static on that variant until registered.

## Phase 2 delivery

Twin-Bridge Cay ships all seven generated loops on High and Medium. The pilot light and bank sea thrift stay in the painting. Water draws first, the boats next, then the banner and chimney wisp. Their supports are part of the bake. The mesh sits directly above that bake in map-pixel space, with the gameplay layers above it. [Renderer](../src/render2d/mapAnimLayer.ts) · [Island rectangles and video cells](../src/data/mapAnim/i02.json)

**Format choice.** The seven crops share an eight-second H.264 track and a lossless grayscale WebP mask. One decoder supplies one texture upload per displayed movie frame, and Pixi draws all 28 vertices in one mesh. At 12 fps, storing eight seconds of these same crops as RGBA sprite frames would require 103.2 MiB of decoded texels before gutters. The full video texture and mask together use about 3.15 MiB of RGBA texture space, plus browser decoder surfaces. Both tracks are silent, muted and inline. Playback follows the game pause and the page visibility state.

| Map bake | Video | Frames | Video bytes | Mask bytes | Download per selection |
| --- | --- | ---: | ---: | ---: | ---: |
| 1× | 416 × 248 at 12 fps | 96 | 718,202 | 9,352 | 727,554 bytes |
| 1.5×, 2×, 3× | 832 × 496 at 24 fps | 192 | 2,197,349 | 22,298 | 2,219,647 bytes |
| Low or Reduced motion | Static painting | 0 | 0 | 0 | 0 bytes |

Both selections plus the 1,840-byte source descriptor total **2,949,041 bytes**. The 1× selection has one eighth of the full track’s decoded texels per second. On the full track, the five larger regions use 2× texels and the small banner and chimney use 3×. Each cell has a four-texel color gutter. The two tracks use the same normalized texture coordinates and fractional layout rectangles.

**Registration and blending.** The packer tracks stationary corners outside each motion mask, fits a translation/rotation/scale transform with outlier rejection, and corrects median per-channel color drift outside the mask. It removes the opening frame’s residual color error against `start.png`, crops the registered movie to the exact mask bounds, and area-resamples the movie and feather. The feather extends farther inward on the generated surf and smoke so bright tips can dissipate before the edge. The full hull and cloth use ordinary alpha compositing. At the loop boundary the mesh eases into the current map bake over the final half-second, then eases back into motion over a quarter-second. Both endpoints show the same painting at every resolution. [Packing script](../tools/map-anim/pack_loops.py) · [Per-element settings](../design/art-2d/anim/i02/pack.json)

**Adding another island.** Give its source folders the same `start.png`, `mask.png`, `place.json` and 192-frame `loop.mp4` layout. The optional island `pack.json` controls draw order, export scale, opacity and the extra inward feather in layout pixels. Run `python3 tools/map-anim/pack_loops.py <island>` with NumPy, OpenCV and ffmpeg. The renderer discovers the generated island descriptor at build time. [QA and handoff](handoff-codex-anim-i02.md)
