# World-map sea sprites

Branch `codex/sea-art` contains 12 alpha WebPs and five animation sidecars. Together they weigh 390,012 bytes. The contact sheet shows all 30 animation frames against the chart water. [Contact sheet](sea-art-sheet.jpg)

## Loading the art

Read `paintedUi.sea` from the [art manifest](../public/art2d/manifest.json). All paths are relative to `/art2d/`. Each strip has a `file` path plus `frameW`, `frameH`, `count`, and `fps`. The matching JSON beside each WebP contains the same four numeric fields. For zero-based frame `i`, the source rectangle starts at `(i * frameW, 0)` and occupies one full frame. [Sprite directory](../public/art2d/ui/sea/)

| Manifest key | Frame size | Frames | FPS | Placement and motion |
| --- | ---: | ---: | ---: | --- |
| `gull` | 96 × 96 | 6 | 9 | Faces up. The body stays centered through the flap. |
| `whale` | 220 × 220 | 8 | 6 | Play once for a surfacing event. The waterline sits near 80% of frame height. |
| `sparkle` | 48 × 48 | 6 | 10 | Center on a water highlight for one pulse. |
| `ripple` | 256 × 256 | 6 | 6 | Center behind the medallion. The broken ring expands and fades. |
| `shipSail` | 160 × 160 | 4 | 5 | Same orientation and canvas as `ship.webp`. The sail flutters and the hull bobs. |

`foam` and `cloud` are three-element arrays in filename order. The whitecaps are 202, 210, and 192 px wide. The clouds are 800, 680, and 860 px wide. `cloudShadow` is a single path to an 872 × 417 px soft shadow derived from the first cloud.

The original chart texture now resolves through `paintedUi.sea.background`. The half-size texture is still available at `paintedUi["sea@0.5x"]`.

## Art and animation review

The built-in image generator used the shipped chart as the gouache and palette reference, with flat `#FF00FF` backgrounds. The gull and whale came from complete pose sheets. Each whitecap and cloud has its own painting. The glint and ripple each use one keyed painting with animated scale and opacity. The ship uses the original sprite pixels with a local deformation on the sail and pennant, guided by a generated motion reference. The keying pass used `design/art-2d/key.py` and retained soft alpha on foam, spray and cloud edges.

Each exported strip was rendered into a looping GIF on chart water. Reviewing the decoded frames caught an anchor shift in the gull and whale, which was corrected before the final pass. The asset checks verified every manifest path, sidecar value, frame count, strip dimension, and alpha channel. All 30 cells contain distinct artwork within their respective strips. The GIFs, exact generation prompts and gate logs are available in this checkout's machine-local `/tmp/skyhold-sea-art/` directory.

## Project gate

Ran the project gate with Node 22.21.1. TypeScript and ESLint both passed with zero diagnostics. Vitest passed 1,296 tests across 98 files and skipped 11 tests in one file. The balance simulator met both target profiles across 41 levels (82 greedy and weak runs). The production build transformed 1,124 modules and finished with warnings about chunk size and dynamic imports. The built manifest and all 17 sea asset files match the source bytes.
