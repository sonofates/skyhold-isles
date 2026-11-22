# Skyhold Isles v2 plant loops

All 24 takes matched the 12 plants on i10, i14 and i15. Three plants gained a loop, one per island. Nine plants stay static. Of the 21 unused takes, three are alternatives to a shipped take and 18 belong to the nine static plants. [Take decisions and mask trials](../design/art-2d/anim/match-v2.json)

## Delivery

Coverage uses the chapter 3 measure, the union of positive full-resolution mask samples at pixel centres on the 1846 × 852 layout. The baseline is `a8dae53c`. Full and compact bytes each include the corresponding movie and mask. Runtime bytes include both pairs and the descriptor.

| Island | Tiles before → after | Covered pixels before → after | Coverage before → after | Full bytes | Compact bytes | Runtime bytes before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| i10 | 2 → 3 | 9,151 → 15,147 | 0.58% → 0.96% | 973,750 | 307,117 | 884,896 → **1,281,847** |
| i14 | 4 → 5 | 30,754 → 34,506 | 1.96% → 2.19% | 2,142,364 | 646,501 | 2,187,928 → **2,790,297** |
| i15 | 2 → 3 | 14,567 → 15,350 | 0.93% → 0.98% | 625,246 | 217,075 | 687,259 → **843,307** |

## Decisions

The eight-character IDs are Flow filename suffixes. Each linked sheet shows both takes through both masks.

| Island | Plant | Decision | Finding |
| --- | --- | --- | --- |
| i10 | Northwest willow grove | **Ship** `af2cf611`, v2a | The hanging clusters sway together while both trunks and their shadows hold. The wider mask follows the yellow-green tips at 2 s. The alternative lifts the right tassels clear of their outlines. [Sheet](anim-shots/v2/i10/northwest-willow-grove.webp) |
| i10 | North terrace willow | Static | At about 3 s one take smears the left tips toward the grass. The other leaves an empty loop beneath the raised right tassel. [Sheet](anim-shots/v2/i10/north-terrace-willow.webp) |
| i10 | Southeast willows and crystal | Static | At about 2 s both takes lift the leaves away from their dark scalloped contours. Both masks preserve those contours. [Sheet](anim-shots/v2/i10/southeast-willows-and-crystal.webp) |
| i10 | Southwest meadow ferns | Static | Both takes leave a dark hook beyond the yellow fern tip next to the terrace. It is visible at 3.00 s in one take and 1.42 s in the other. [Sheet](anim-shots/v2/i10/southwest-meadow-ferns.webp) |
| i14 | West oasis scrub | Static | One take sheds pale leaves in front of the scrub. The other redraws the soft shrub as sharp pale tips and leaves outlines above the agave. [Sheet](anim-shots/v2/i14/west-oasis-scrub.webp) |
| i14 | Northeast sandstone scrub | Static | One take shows red sand inside hollow agave tips at 1.83 s. The quieter take doubles petal edges on the yellow shrub near 6 s. [Sheet](anim-shots/v2/i14/northeast-sandstone-scrub.webp) |
| i14 | Southwest canyon agaves | **Ship** `49904133`, v2b | The tan grass flexes and the yellow sprigs stir on their stems. The tighter mask keeps the soft sandstone edge steady. The alternative leaves petal outlines beside the moving shrub. [Sheet](anim-shots/v2/i14/southwest-canyon-agaves.webp) |
| i14 | Southeast wash scrub | Static | The blue fan contracts and leaves empty triangular tips against the red sand in both takes, most clearly at 1.79 s and 1.25 s. [Sheet](anim-shots/v2/i14/southeast-wash-scrub.webp) |
| i15 | North lantern reeds | **Ship** `b048b1fe`, v2a | The tall blades flex slightly at 1.7 s. The wider mask carries their pale tips through the turn. The stones and mushrooms hold. The alternate take drains the colour from the upper fan. [Sheet](anim-shots/v2/i15/north-lantern-reeds.webp) |
| i15 | East moonlit reeds | Static | In one take the back blades fade into the ground at 3 s. The other splits a blue moving blade from its pale painted tip near 1.67 s. [Sheet](anim-shots/v2/i15/east-moonlit-reeds.webp) |
| i15 | Southeast moonlit foliage | Static | One take flashes new silver leaves along the lower edge of the crop. The other draws pale seed heads between the pools. [Sheet](anim-shots/v2/i15/southeast-moonlit-foliage.webp) |
| i15 | Southwest lantern ferns | Static | One take adds a dark fern to the open patch beside the upper pool. The other spreads bright silver fronds below the lamp and beside the stump. [Sheet](anim-shots/v2/i15/southwest-lantern-ferns.webp) |

## Matching, motion and the seam

The 288 opening-frame comparisons used the chapter 3 RGB SSIM method, with area resampling to 96 × 54, a 7 × 7 Gaussian window, sigma 1.5 and range 255. All 24 winners exceeded 0.98 SSIM. The smallest lead over another distinct plant was 0.358626. The two prep starts for each plant are identical. Each take therefore has trials through both masks, and the suffix on a shipping row identifies the chosen mask. The generating prompt remains unknown. [Prep index](../design/art-2d/anim/index-v2.json) · [Match table](../design/art-2d/anim/match-v2.json)

Chapter 3 left every candidate on these three islands static. The v2 pair gave each plant a second chance at a small, correct movement. The foliage masks kept the painted surroundings steady in the three chosen loops. A narrower mask helped at the canyon ledge. The wider mask gave the willow and reeds room to turn. Neither width could remove a second outline inside a leaf, or distinguish an invented frond from the blue foreground foliage. [Chapter 3 review](handoff-codex-animint-ch3.md)

All 48 take/mask trials used the packer's registration, colour correction, opening residual and two-layout-pixel inward feather at 2× scale. The source rows show 0, 2, 4 and 6 s, the greatest mask-weighted departure across all 192 frames, the last two frames (7.917 and 7.958 s), and the return to frame zero. The detail pairs show the opening and the strongest local change in a 13 × 13 texel patch. The source rows show the seam before any optional end blend. The three retained takes closed without triggering that blend.

The last two rows on each shipped sheet reconstruct the decoded 2× and 1× atlases on the corresponding game maps, including the renderer's endpoint fade. Both tiers return to the painted map at the join. These comparisons were made by offline decoding and compositing.

## Runtime verification

- All six silent BT.709 H.264 tracks decoded completely, 192 frames per full track and 96 per compact track. All three new tiles show masked motion on both tiers.
- The combined table preserves every earlier row and adds the three selected sources. All eight earlier tiles retain their source, pack settings, world rectangle, depth and tile dimensions. Their full and compact mask texels are byte-identical in their repacked cells. Re-encoding the shared H.264 tracks introduces small compression differences in earlier tile RGB, with per-tile mask-weighted mean absolute differences of 1.10–2.48 on a 0–255 scale. [Combined packing table](../design/art-2d/anim/match-combined.json)
- Each new mask adds disjoint coverage at both resolutions. All shipped masks passed the road and bridge clearance, plot disk, and raw and smoothed path centre-line checks.
- The Group B generator excludes every mapAnim rectangle with an eight-layout-pixel margin. The rebuilt i10 and i15 sway WebPs measured zero over every texel touching those rectangles. The gzip fixtures match the decoded pixels and the JSON SHA-256 values match the delivered WebPs. [Sway generator](../tools/map-life/gen_sway_mask_b.py)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npx vitest run` | 1,779 passed, 15 skipped |
| `npm run build` | Passed with Vite advisories about chunk size and ineffective dynamic imports in progress2d and market2d |
| `/usr/bin/python3 -B tools/map-anim/test_road_mask.py` | All three tests passed, covering both mask resolutions on all 25 islands |

## Changed files and reproduction

The changes comprise the two match tables, 12 review sheets, this handoff, and the following runtime files and fixtures.

- `public/art2d/ambient/{i10,i14,i15}/` contains each island's `loops.mp4`, `loops-1x.mp4`, `mask.webp` and `mask-1x.webp`.
- `src/data/mapAnim/{i10,i14,i15}.json` locates the tiles in the repacked atlases.
- `public/art2d/life/{i10,i15}-sway.webp` and `tests/fixtures/{i10,i15}-sway-mask.{gray.gz,json}` contain the sway masks and fixtures.

To reproduce on hermes, run the following from the checkout root with the three input inboxes available.

```bash
set -eu
inbox="$PWD/qa-out/v2-work/inbox"
export TMPDIR="$PWD/qa-out/v2-work/temp" OPENBLAS_NUM_THREADS=1
mkdir -p "$inbox" "$TMPDIR"
for take in /root/work/{anim-inbox,anim-inbox-ch3,anim-inbox-v2}/*.mp4; do
  link="$inbox/${take##*/}"
  if [ -L "$link" ]; then
    test "$(readlink "$link")" = "$take"
  else
    ln -s "$take" "$link"
  fi
done
for island in i10 i14 i15; do
  /root/ci/cv-venv/bin/python -B tools/map-anim/pack_loops.py "$island" \
    --matches design/art-2d/anim/match-combined.json --inbox "$inbox"
done
for island in i10 i15; do
  /root/ci/cv-venv/bin/python -B tools/map-life/gen_sway_mask_b.py "$island" --fixtures
done
```
