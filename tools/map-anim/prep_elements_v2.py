#!/usr/bin/env python3
"""Prepare v2 animated map element folders for 12 plant elements on i10, i14, i15.

Creates two variants (-v2a gentle sway, -v2b ultra-minimal flutter) for each element:
  - design/art-2d/anim/<island>/<element>-v2{a,b}/{start.png, mask.png, place.json, prompt.txt}
  - design/art-2d/anim/index-v2.json
  - docs/anim-shots/v2-prep/<island>-<element>.jpg

Reuses geometry, crop, forbidden-zone, and EDT helpers from the ch3 prep scripts.
Pure Pillow + NumPy (no cv2/scipy dependency).
"""

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/map-anim"))
sys.path.insert(0, str(ROOT / "tools/map-compose"))

from prep_elements_ch3_a import euclidean_distance_to_zero_bounded  # noqa: E402
from prep_elements_ch3_b import (  # noqa: E402
    LAYOUT_SIZE,
    PROMPT_FOOTER,
    SOURCE_SCALE,
    START_SIZE,
    build_forbidden_zones,
    crop_start_frame,
    load_font,
)

START_W, START_H = START_SIZE
LAYOUT_W, LAYOUT_H = LAYOUT_SIZE

NEGATIVE_CLAUSE = (
    "Do not add any new plants, leaves, ferns, flecks, ribbons, streaks, sparkles, "
    "shadows or light; bare ground, rock, sand and water stay exactly as painted; "
    "no colour change."
)

ISLAND_PALETTE = {
    "i10": "soft valley daylight palette",
    "i14": "hot desert palette",
    "i15": "moonlit night palette",
}

VARIANTS = {
    "v2a": {"dilate_start_px": 6, "feather_start_px": 8},
    "v2b": {"dilate_start_px": 4, "feather_start_px": 6},
}

# Explicit specifications for all 12 plant elements on i10, i14, i15.
# Coordinates are in layout px (1846 x 852).
# Exclusion shapes ("rect": [x0, y0, x1, y1], "ellipse": [x0, y0, x1, y1], "poly": [[x,y], ...])
# strictly keep trunks' lower bases, crystals, lanterns, carved rune stones, lily pools,
# tree stumps, mushrooms, and sandstone pillars outside the mask.
ELEMENTS_V2 = [
    # ---------------- i10 (soft valley daylight) ----------------
    {
        "island": "i10",
        "element": "northwest-willow-grove",
        "crop": {"x": 0, "y": 102, "width": 288, "height": 162},
        "seg": "i10_willow",
        "roi_polys": [
            # Restrict strictly around the two willow canopies (exclude dim border bushes & ground daisy)
            [[66, 114], [122, 114], [122, 170], [42, 170], [42, 128]],
            [[52, 190], [134, 190], [134, 254], [52, 254]],
        ],
        "exclude": [
            # Lower trunk bases & cast ground shadows (organic ellipses below canopy arch)
            {"ellipse": [64, 152, 98, 180]},
            {"ellipse": [76, 232, 110, 262]},
        ],
        "v2a_motion": (
            "Only the existing hanging yellow-green willow leaves on the two weeping willows "
            "sway gently by a few pixels in a soft valley daylight breeze and return smoothly to rest. "
            "Keep both knotted brown trunks, cast ground shadows, stone steps, mossy rocks and grass "
            "completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the soft valley daylight palette: only the outer hanging leaf tips of "
            "the two existing weeping willows flutter subtly by one or two pixels and return to rest. "
            "Keep both brown trunks, ground shadows, mossy stones and meadow grass completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i10",
        "element": "north-terrace-willow",
        "crop": {"x": 1248, "y": 0, "width": 208, "height": 117},
        "seg": "i10_willow",
        "roi_polys": [
            [[1306, 18], [1388, 18], [1388, 90], [1310, 90], [1306, 74]],
        ],
        "exclude": [
            # Lower brown willow trunk base & shadow (organic ellipse below canopy arch)
            {"ellipse": [1326, 62, 1364, 98]},
        ],
        "v2a_motion": (
            "Only the existing drooping yellow-green willow leaves on the single weeping willow "
            "sway gently by a few pixels in a soft valley daylight breeze and return smoothly to rest. "
            "Keep the brown trunk, cast shadow, carved stone terrace wall and bare grass completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the soft valley daylight palette: only the drooping outer leaf tips of "
            "the existing weeping willow flutter subtly by one or two pixels and return to rest. "
            "Keep the brown trunk, stone terrace wall and open grass completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i10",
        "element": "southeast-willows-and-crystal",
        # Frames the prominent upper-right weeping willow cleanly with zero plot overlap
        # and keeps the flashing mint crystal completely outside the crop and mask.
        "crop": {"x": 1440, "y": 602, "width": 208, "height": 117},
        "seg": "i10_willow",
        "roi_polys": [
            [[1500, 626], [1598, 626], [1598, 706], [1500, 706]],
        ],
        "exclude": [
            # Lower brown willow trunk base & shadow (organic ellipse below canopy arch)
            {"ellipse": [1526, 672, 1564, 714]},
            # Mossy stone wall on right
            {"rect": [1626, 628, 1650, 668]},
        ],
        "v2a_motion": (
            "Only the existing hanging yellow-green leaves of the weeping willow sway gently by a few "
            "pixels in a soft valley daylight breeze and return smoothly to rest. "
            "Keep the brown trunk, ground shadow, mossy stone wall and meadow grass completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the soft valley daylight palette: only the drooping outer leaf tips of "
            "the existing weeping willow flutter subtly by one or two pixels and return to rest. "
            "Keep the brown trunk, stone wall and open meadow completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i10",
        "element": "southwest-meadow-ferns",
        "crop": {"x": 76, "y": 678, "width": 256, "height": 144},
        "seg": "i10_ferns",
        "roi_polys": [
            # Upper cattail/reed clump (include full brown cattail seed heads)
            [[196, 679], [238, 679], [238, 728], [196, 728]],
            # Center-right bright green fern clump
            [[180, 744], [250, 744], [250, 792], [180, 792]],
            # Lower-left bright green fern clump
            [[108, 776], [166, 776], [166, 816], [108, 816]],
        ],
        "exclude": [
            # Keep terrace stone ledges and pebbles strictly outside
            {"rect": [214, 794, 232, 808]},
        ],
        "v2a_motion": (
            "Only the existing painted green fern fronds and cattail blades sway gently by a few pixels "
            "in a soft valley daylight breeze and return smoothly to rest. "
            "Keep the weathered stone terrace ledges, boulders, pebbles and olive meadow ground "
            "completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the soft valley daylight palette: only the outer tips of the existing "
            "green fern fronds and cattail blades flutter subtly by one or two pixels and return to rest. "
            "Keep the stone terrace walls, boulders and bare meadow ground completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    # ---------------- i14 (hot desert palette) ----------------
    {
        "island": "i14",
        "element": "west-oasis-scrub",
        "crop": {"x": 0, "y": 6, "width": 256, "height": 144},
        "seg": "i14_desert",
        "roi_polys": [
            # Upper-left olive shrub (trim top-right rock-crevice corner)
            [[12, 14], [54, 14], [64, 34], [66, 68], [12, 68]],
            # Mid-left olive shrub
            [[46, 64], [106, 64], [106, 110], [46, 110]],
            # Lower-right blue-green agave
            [[200, 100], [236, 100], [236, 134], [200, 134]],
            # Small agave + full dry grass tuft beside it
            [[166, 122], [202, 122], [202, 148], [166, 148]],
        ],
        "exclude": [
            # Sandstone outcrop between mid shrub and agave
            {"rect": [148, 86, 198, 122]},
        ],
        "v2a_motion": (
            "Only the existing olive desert shrubs, blue-green agave leaves and tiny dry grass tuft "
            "sway gently by a few pixels in a hot desert breeze and return smoothly to rest. "
            "Keep the red sandstone ledges, rocky outcrops and terracotta sand completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the hot desert palette: only the outer leaf tips of the existing olive "
            "shrubs, blue-green agave and dry grass tuft flutter subtly by one or two pixels and "
            "return to rest. Keep the red sandstone cliffs, rocks and bare sand completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i14",
        "element": "northeast-sandstone-scrub",
        "crop": {"x": 1332, "y": 0, "width": 320, "height": 180},
        "seg": "i14_desert",
        "roi_polys": [
            # Blue-green agave
            [[1344, 58], [1388, 58], [1388, 100], [1344, 100]],
            # Yellow-flowering desert shrub
            [[1390, 118], [1440, 118], [1440, 152], [1390, 152]],
            # Upper-right olive desert shrub on ridge (trim right rock-shadow wisp)
            [[1566, 6], [1632, 6], [1632, 62], [1566, 62]],
        ],
        "exclude": [
            # Wooden signal brazier at bottom-right
            {"rect": [1554, 144, 1640, 180]},
        ],
        "v2a_motion": (
            "Only the existing blue-green agave, yellow-flowering desert bush and olive ridge shrub "
            "sway gently by a few pixels in a hot desert breeze and return smoothly to rest. "
            "Keep the red sandstone ridge, flat terracotta sand and wooden brazier rim completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the hot desert palette: only the outer tips of the existing blue-green "
            "agave, yellow-flowering bush and olive ridge shrub flutter subtly by one or two pixels "
            "and return to rest. Keep the red sandstone cliffs, bare sand and brazier completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i14",
        "element": "southwest-canyon-agaves",
        "crop": {"x": 0, "y": 638, "width": 288, "height": 162},
        "seg": "i14_desert",
        "roi_polys": [
            # Yellow-flowering desert bush
            [[104, 640], [146, 640], [146, 672], [104, 672]],
            # Small agave + flanking straw grass tufts
            [[184, 639], [224, 639], [224, 666], [184, 666]],
            # Mid dry grass tuft
            [[116, 676], [154, 676], [154, 704], [116, 704]],
            # Left-mid olive shrub
            [[38, 656], [76, 656], [76, 694], [38, 694]],
            # Far-left olive shrub (inside old poly x>=16)
            [[14, 686], [34, 686], [34, 718], [14, 718]],
            # Bottom-left large olive shrub (trim rock pebble above & shadow wisp at right)
            [[30, 756], [94, 756], [94, 796], [30, 796]],
        ],
        "exclude": [],
        "v2a_motion": (
            "Only the existing yellow-flowering bush, small blue-green agave, olive desert shrubs "
            "and pale dry grass tufts sway gently by a few pixels in a hot desert breeze and return "
            "smoothly to rest. Keep the red canyon sand, cliff ledges and scattered rocks completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the hot desert palette: only the outer leaf and blade tips of the "
            "existing desert shrubs, small agave and dry grass tufts flutter subtly by one or two pixels "
            "and return to rest. Keep the bare terracotta sand and sandstone ledges completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i14",
        "element": "southeast-wash-scrub",
        "crop": {"x": 1514, "y": 668, "width": 240, "height": 135},
        "seg": "i14_desert",
        "roi_polys": [
            # Hero blue-green agave
            [[1550, 680], [1590, 680], [1590, 718], [1550, 718]],
            # Lower-left dry grass tufts
            [[1522, 764], [1548, 764], [1548, 796], [1522, 796]],
        ],
        "exclude": [
            # Tall upright sandstone pillar
            {"rect": [1620, 670, 1656, 720]},
            # Flat sandstone rock on right
            {"rect": [1704, 700, 1752, 736]},
        ],
        "v2a_motion": (
            "Only the existing blue-green agave leaves and small dry grass tufts sway gently by a few "
            "pixels in a hot desert breeze and return smoothly to rest. "
            "Keep the upright sandstone pillar, flat boulder, cracked clay and bare wash sand "
            "completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the hot desert palette: only the outer tips of the existing blue-green "
            "agave and dry grass tufts flutter subtly by one or two pixels and return to rest. "
            "Keep the sandstone rocks, cracked ground and open terracotta wash completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    # ---------------- i15 (moonlit night palette) ----------------
    {
        "island": "i15",
        "element": "north-lantern-reeds",
        # Frames the northern moonlit reeds & grass tufts tightly with the golden lantern
        # completely outside the crop and zero overlap with the plots below.
        "crop": {"x": 960, "y": 0, "width": 208, "height": 117},
        "seg": "i15_reeds",
        "roi_polys": [
            # Upper pale-blue grass tuft behind mushrooms
            [[1010, 12], [1038, 12], [1038, 28], [1010, 28]],
            # Hero tall moonlit reed clump
            [[1106, 44], [1148, 44], [1148, 78], [1106, 78]],
        ],
        "exclude": [
            # Orange mushrooms below upper tuft
            {"ellipse": [1006, 25, 1038, 46]},
            # Scattered pebbles below reed base
            {"rect": [1082, 76, 1134, 88]},
        ],
        "v2a_motion": (
            "Only the existing silver-blue reed blades and pale moonlit grass tuft sway gently by a "
            "few pixels in a calm night breeze and return smoothly to rest. "
            "Keep the orange mushrooms, pebbles and smooth indigo moonlit ground completely locked. "
            + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the moonlit night palette: only the outer blade tips of the existing "
            "silver-blue reeds and pale grass tuft flutter subtly by one or two pixels and return to rest. "
            "Keep the mushrooms, pebbles and bare indigo ground completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i15",
        "element": "east-moonlit-reeds",
        "crop": {"x": 1558, "y": 324, "width": 288, "height": 162},
        "seg": "i15_reeds",
        "roi_polys": [
            # Bottom-left tall reed clump
            [[1564, 428], [1606, 428], [1606, 468], [1564, 468]],
            # Mid-left tall reed clump
            [[1608, 414], [1646, 414], [1646, 454], [1608, 454]],
            # Lower-center tall reed clump
            [[1640, 442], [1678, 442], [1678, 480], [1640, 480]],
            # Lower-right tall reed clump
            [[1712, 444], [1754, 444], [1754, 482], [1712, 482]],
            # Center pale-blue grass tufts
            [[1642, 404], [1686, 404], [1686, 434], [1642, 434]],
            # Upper-center pale-blue grass tufts left of rune stone
            [[1688, 356], [1718, 356], [1718, 380], [1688, 380]],
            # Right-side pale-blue grass tufts
            [[1778, 378], [1826, 378], [1826, 418], [1778, 418]],
            # Top-right tall reed clump (trim tiny stray speck at x=1806)
            [[1810, 324], [1844, 324], [1844, 362], [1810, 362]],
        ],
        "exclude": [
            # Carved standing rune stone & adjacent mushrooms (organic polygon)
            {"poly": [[1716, 354], [1732, 342], [1756, 342], [1772, 372], [1772, 402], [1724, 402], [1716, 374]]},
            # Small rock left of center
            {"ellipse": [1614, 384, 1644, 406]},
            # Pebbles on far left
            {"rect": [1562, 396, 1584, 414]},
        ],
        "v2a_motion": (
            "Only the existing painted silver-blue reed clumps and pale blue grass tufts sway gently "
            "by a few pixels in a calm night breeze and return smoothly to rest. "
            "Keep the carved standing rune stone, mushrooms, pebbles and smooth indigo moonlit ground "
            "completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the moonlit night palette: only the outer blade tips of the existing "
            "moonlit reeds and pale blue grass tufts flutter subtly by one or two pixels and return "
            "to rest. Keep the carved rune stone, mushrooms and bare indigo ground completely frozen. "
            + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i15",
        "element": "southeast-moonlit-foliage",
        "crop": {"x": 1558, "y": 672, "width": 288, "height": 162},
        "seg": "i15_lush",
        "roi_polys": [
            # Main lush painted foliage mass on lower-center and right side
            [
                [1672, 672], [1834, 672], [1834, 834],
                [1558, 834], [1558, 782], [1640, 774], [1672, 720],
            ],
            # Crisp pale grass tufts above/left of main foliage
            [[1604, 682], [1654, 682], [1654, 718], [1604, 718]],
            [[1666, 756], [1692, 756], [1692, 796], [1666, 796]],
        ],
        "exclude": [
            # Carved standing rune stone on right (organic polygon hugging stone silhouette)
            {"poly": [[1784, 704], [1796, 692], [1812, 696], [1820, 736], [1808, 744], [1780, 742]]},
            # Stone-rimmed lily pools
            {"ellipse": [1624, 734, 1676, 772]},
            {"ellipse": [1732, 768, 1782, 804]},
            {"ellipse": [1788, 754, 1844, 792]},
            # Orange mushrooms near upper tuft (organic ellipse)
            {"ellipse": [1612, 694, 1632, 712]},
            # Floating lily flower & pebbles on far left
            {"ellipse": [1558, 764, 1586, 788]},
        ],
        "v2a_motion": (
            "Only the existing painted silver-blue leaves, dark indigo foliage clusters and pale grass "
            "tufts sway gently by a few pixels in a calm night breeze and return smoothly to rest. "
            "Keep the carved standing stone, stone-rimmed lily pools, mushrooms and smooth indigo "
            "ground completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the moonlit night palette: only the outer leaf edges and grass tips of "
            "the existing silver-blue foliage flutter subtly by one or two pixels and return to rest. "
            "Keep the carved rune stone, stone-rimmed lily pools, mushrooms and bare ground completely "
            "frozen. " + NEGATIVE_CLAUSE
        ),
    },
    {
        "island": "i15",
        "element": "southwest-lantern-ferns",
        "crop": {"x": 0, "y": 672, "width": 288, "height": 162},
        "seg": "i15_lush",
        "roi_polys": [
            # Lush painted moonlit rosettes & broad indigo fern fronds (avoid narrow sliver left of lantern)
            [
                [72, 672], [140, 672], [176, 710], [284, 752],
                [284, 830], [10, 830], [10, 772], [72, 764],
            ],
        ],
        "exclude": [
            # Golden hanging street lantern, lamppost & adjacent mushrooms (organic polygon)
            {"poly": [[0, 672], [70, 672], [74, 766], [42, 772], [0, 768]]},
            # Carved standing rune stone at top-left (organic polygon)
            {"poly": [[84, 672], [132, 672], [134, 702], [86, 704]]},
            # Two stone-rimmed lily pools
            {"ellipse": [72, 704, 122, 742]},
            {"ellipse": [86, 754, 140, 796]},
            # Brown tree stump with mushrooms
            {"ellipse": [196, 700, 256, 750]},
            # Bottom-left floating lily flowers
            {"ellipse": [42, 806, 80, 832]},
        ],
        "v2a_motion": (
            "Only the existing painted silver-blue foliage, indigo fern leaves and pale blue grass "
            "tufts sway gently by a few pixels in a calm night breeze and return smoothly to rest. "
            "Keep the golden lamppost and lantern, carved rune stone, stone-rimmed lily pools, tree "
            "stump, mushrooms and smooth indigo ground completely locked. " + NEGATIVE_CLAUSE
        ),
        "v2b_motion": (
            "Almost still in the moonlit night palette: only the outer leaf edges and grass tips of "
            "the existing silver-blue ferns and foliage flutter subtly by one or two pixels and return "
            "to rest. Keep the golden lantern, carved rune stone, lily pools, tree stump and bare "
            "ground completely frozen. " + NEGATIVE_CLAUSE
        ),
    },
]


def build_v2_prompt(island: str, motion: str) -> str:
    palette = ISLAND_PALETTE[island]
    header = (
        "Create an 8-second seamless loop from the supplied start frame. "
        "Lock the camera to this exact crop and perspective for the entire shot. "
        "No pan, tilt, shake or zoom. Keep the hand-painted storybook game art, "
        f"brushwork and {palette} unchanged. Only the element described "
        "below moves; every other part of the picture stays perfectly still, and "
        "the motion fades out smoothly at its edges. The last frame matches the "
        "first frame exactly."
    )
    clean_motion = " ".join(motion.strip().split())
    return f"{header}\n\n{clean_motion}\n\n{PROMPT_FOOTER}"


def rgb_to_hsv_np(rgb_u8: np.ndarray):
    """Vectorized RGB (0..255 uint8) to H (0..360), S (0..1), V (0..255)."""
    rgb = rgb_u8.astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    diff = mx - mn
    sat = np.where(mx > 1e-3, diff / np.maximum(mx, 1e-3), 0.0)
    hue = np.zeros_like(mx)
    m = diff > 1e-3
    mr = m & (mx == r)
    mg = m & (mx == g) & ~mr
    mb = m & (mx == b) & ~mr & ~mg
    hue[mr] = (60.0 * ((g[mr] - b[mr]) / diff[mr])) % 360.0
    hue[mg] = 60.0 * ((b[mg] - r[mg]) / diff[mg]) + 120.0
    hue[mb] = 60.0 * ((r[mb] - g[mb]) / diff[mb]) + 240.0
    return hue, sat, mx


def local_texture_np(rgb_u8: np.ndarray, blur_radius: float = 5.0):
    """Compute local gradient magnitude and local color deviation from smoothed background."""
    rgb_f = rgb_u8.astype(np.float32)
    gray = 0.299 * rgb_f[..., 0] + 0.587 * rgb_f[..., 1] + 0.114 * rgb_f[..., 2]
    gx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    gy = np.abs(np.diff(gray, axis=0, prepend=gray[:1, :]))
    grad = gx + gy
    grad_smooth = np.asarray(
        Image.fromarray(np.clip(grad * 4.0, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur_radius)),
        dtype=np.float32,
    ) / 4.0

    blurred = np.asarray(
        Image.fromarray(rgb_u8).filter(ImageFilter.GaussianBlur(blur_radius * 2.5)),
        dtype=np.float32,
    )
    color_dev = np.sqrt(((rgb_f - blurred) ** 2).mean(axis=2))
    return grad_smooth, color_dev, gray


def binary_dilate_edt(mask: np.ndarray, radius_px: int) -> np.ndarray:
    if radius_px <= 0:
        return mask.copy()
    dist_out = euclidean_distance_to_zero_bounded(~mask, radius_px + 1)
    return mask | (dist_out <= float(radius_px))


def binary_erode_edt(mask: np.ndarray, radius_px: int) -> np.ndarray:
    if radius_px <= 0:
        return mask.copy()
    dist_in = euclidean_distance_to_zero_bounded(mask, radius_px + 1)
    return dist_in > float(radius_px)


def binary_close_edt(mask: np.ndarray, radius_px: int) -> np.ndarray:
    return binary_erode_edt(binary_dilate_edt(mask, radius_px), radius_px)


def binary_open_edt(mask: np.ndarray, radius_px: int) -> np.ndarray:
    return binary_dilate_edt(binary_erode_edt(mask, radius_px), radius_px)


def remove_small_components(mask: np.ndarray, min_area_start_px: int) -> np.ndarray:
    """Filter out tiny isolated specks using 4x-downsampled 8-connected components."""
    h, w = mask.shape
    sh, sw = h // 4, w // 4
    small = np.asarray(
        Image.fromarray((mask.astype(np.uint8) * 255)).resize((sw, sh), Image.Resampling.NEAREST)
    ) > 0
    min_small = max(1, min_area_start_px // 16)
    visited = np.zeros_like(small, dtype=bool)
    keep_small = np.zeros_like(small, dtype=bool)
    ys, xs = np.nonzero(small)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if visited[y0, x0]:
            continue
        q = deque([(y0, x0)])
        visited[y0, x0] = True
        comp = [(y0, x0)]
        while q:
            cy, cx = q.popleft()
            for ny in range(max(0, cy - 1), min(sh, cy + 2)):
                for nx in range(max(0, cx - 1), min(sw, cx + 2)):
                    if small[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
                        comp.append((ny, nx))
        if len(comp) >= min_small:
            for cy, cx in comp:
                keep_small[cy, cx] = True

    keep_full = np.asarray(
        Image.fromarray((keep_small.astype(np.uint8) * 255)).resize((w, h), Image.Resampling.NEAREST)
    ) > 0
    # Dilate keep_full by 4px to preserve boundary pixels lost to 4x nearest downsampling
    keep_full = binary_dilate_edt(keep_full, 4)
    return mask & keep_full


def rasterize_layout_polys_in_start(polys_layout: list, crop: dict) -> np.ndarray:
    scale = START_W / crop["width"]
    ox, oy = crop["x"], crop["y"]
    canvas = Image.new("L", (START_W, START_H), 0)
    draw = ImageDraw.Draw(canvas)
    for poly in polys_layout:
        pts = [((p[0] - ox) * scale, (p[1] - oy) * scale) for p in poly]
        draw.polygon(pts, fill=255)
    return np.asarray(canvas) > 0


def rasterize_exclusions_in_start(exclusions: list, crop: dict) -> np.ndarray:
    scale = START_W / crop["width"]
    ox, oy = crop["x"], crop["y"]
    canvas = Image.new("L", (START_W, START_H), 0)
    draw = ImageDraw.Draw(canvas)
    for ex in exclusions:
        if "rect" in ex:
            x0, y0, x1, y1 = ex["rect"]
            draw.rectangle(((x0 - ox) * scale, (y0 - oy) * scale, (x1 - ox) * scale, (y1 - oy) * scale), fill=255)
        elif "ellipse" in ex:
            x0, y0, x1, y1 = ex["ellipse"]
            draw.ellipse(((x0 - ox) * scale, (y0 - oy) * scale, (x1 - ox) * scale, (y1 - oy) * scale), fill=255)
        elif "poly" in ex:
            pts = [((p[0] - ox) * scale, (p[1] - oy) * scale) for p in ex["poly"]]
            draw.polygon(pts, fill=255)
    return np.asarray(canvas) > 0


def fill_interior_holes(mask: np.ndarray, max_hole_start_px: int) -> np.ndarray:
    """Fill small enclosed interior holes in a binary mask (pure NumPy/BFS at 2x downsample)."""
    h, w = mask.shape
    sh, sw = h // 2, w // 2
    small = np.asarray(
        Image.fromarray((mask.astype(np.uint8) * 255)).resize((sw, sh), Image.Resampling.NEAREST)
    ) > 0
    inv = ~small
    visited = np.zeros_like(inv, dtype=bool)
    max_small = max(1, max_hole_start_px // 4)
    fill_small = small.copy()

    # First flood-fill exterior background touching image borders
    q = deque()
    for x in range(sw):
        if inv[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if inv[sh - 1, x] and not visited[sh - 1, x]:
            visited[sh - 1, x] = True
            q.append((sh - 1, x))
    for y in range(sh):
        if inv[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if inv[y, sw - 1] and not visited[y, sw - 1]:
            visited[y, sw - 1] = True
            q.append((y, sw - 1))
    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < sh and 0 <= nx < sw and inv[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    # Any remaining unvisited inv pixels are enclosed interior holes
    ys, xs = np.nonzero(inv & ~visited)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if visited[y0, x0]:
            continue
        hq = deque([(y0, x0)])
        visited[y0, x0] = True
        comp = [(y0, x0)]
        while hq:
            cy, cx = hq.popleft()
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < sh and 0 <= nx < sw and inv[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    hq.append((ny, nx))
                    comp.append((ny, nx))
        if len(comp) <= max_small:
            for cy, cx in comp:
                fill_small[cy, cx] = True

    fill_full = np.asarray(
        Image.fromarray((fill_small.astype(np.uint8) * 255)).resize((w, h), Image.Resampling.NEAREST)
    ) > 0
    return mask | fill_full


def segment_foliage_pixels(start_rgb: np.ndarray, seg_mode: str, allowed_mask: np.ndarray) -> np.ndarray:
    """Segment actual painted leaf/frond/reed pixels inside allowed_mask."""
    r = start_rgb[..., 0].astype(np.float32)
    g = start_rgb[..., 1].astype(np.float32)
    b = start_rgb[..., 2].astype(np.float32)
    hue, sat, val = rgb_to_hsv_np(start_rgb)
    grad_s, color_dev, _ = local_texture_np(start_rgb, blur_radius=4.0)

    if seg_mode == "i10_willow":
        # Willow leaves: rich saturated yellow-green (H 47..92, S >= 0.55, B < 68, G - B > 70)
        # Strictly rejects warm brown trunks (H < 46, R - G >= 20), khaki grass (S ~ 0.50, B ~ 76),
        # stone walls (S ~ 0.50, H ~ 48), and mint crystal (H > 95, B > 85).
        core_leaf = (
            (hue >= 47.0)
            & (hue <= 92.0)
            & (sat >= 0.55)
            & (b <= 68.0)
            & ((g - b) >= 70.0)
            & ((r - g) <= 20.0)
            & (val >= 55.0)
        )
        # Dark olive-green leaf outlines & shaded foliage crevices directly adjacent to core_leaf
        dark_leaf = (
            (hue >= 44.0)
            & (hue <= 96.0)
            & (sat >= 0.44)
            & (val <= 118.0)
            & ((r - g) <= 18.0)
            & (b <= 58.0)
        )
        # Brown knotted bark & trunk shadows carved out organically along leaf contours
        brown_bark = ((r - g) >= 20.0) & (hue < 46.0) & (sat >= 0.35)
        brown_bark_pad = binary_dilate_edt(brown_bark, 2)
        raw = allowed_mask & (core_leaf | (dark_leaf & binary_dilate_edt(core_leaf, 7))) & ~brown_bark_pad
        raw = binary_close_edt(raw, 4)
        raw = fill_interior_holes(raw, max_hole_start_px=2500) & ~brown_bark_pad & allowed_mask
        raw = remove_small_components(raw, min_area_start_px=500)
        return raw

    if seg_mode == "i10_ferns":
        # Meadow ferns: saturated yellow-green fronds (same green signature as willow)
        # plus cattail reed blades & brown cattail seed heads inside the localized cattail ROI.
        green_frond = (
            (hue >= 47.0)
            & (hue <= 94.0)
            & (sat >= 0.56)
            & (b <= 68.0)
            & ((g - b) >= 66.0)
            & ((r - g) <= 18.0)
        )
        dark_outline = (
            (hue >= 42.0)
            & (hue <= 98.0)
            & (val <= 116.0)
            & (b <= 60.0)
            & ((r - g) <= 20.0)
        )
        # Cattail seed heads (warm brown ovals sitting directly atop green reed stalks)
        cattail_head = (
            (hue >= 10.0)
            & (hue <= 44.0)
            & (sat >= 0.50)
            & (val <= 190.0)
            & (color_dev >= 9.0)
        )
        raw = allowed_mask & (
            green_frond
            | ((dark_outline | cattail_head) & binary_dilate_edt(green_frond, 14))
        )
        raw = binary_close_edt(raw, 4)
        raw = fill_interior_holes(raw, max_hole_start_px=1500) & allowed_mask
        raw = remove_small_components(raw, min_area_start_px=250)
        return raw

    if seg_mode == "i14_desert":
        # Hot desert background is strongly red-orange terracotta (H ~ 14..24, R - G ~ 90..120).
        # 1) Blue-green agaves: H 62..205 or R - G <= 24
        agave = ((hue >= 62.0) & (hue <= 205.0) & (sat >= 0.14)) | (((r - g) <= 24.0) & (val >= 45.0) & (b >= 45.0))
        # 2) Olive desert shrubs: much less red than sandstone (H 27..78, R - G <= 56, darker V <= 168)
        olive_shrub = (
            (hue >= 27.0)
            & (hue <= 78.0)
            & ((r - g) <= 56.0)
            & (val <= 168.0)
            & (val >= 40.0)
            & (sat >= 0.25)
        )
        # 3) Yellow desert blossoms & stems: H 34..66, bright warm gold/yellow
        yellow_bloom = (
            (hue >= 34.0)
            & (hue <= 66.0)
            & (g >= 135.0)
            & (sat >= 0.52)
            & (val >= 150.0)
        )
        # 4) Pale straw dry grass tufts: fine high-contrast pale strokes over flat red sand
        dry_grass = (
            (hue >= 22.0)
            & (hue <= 58.0)
            & (val >= 148.0)
            & ((r - g) <= 84.0)
            & (color_dev >= 8.0)
            & (grad_s >= 2.2)
        )
        plant_core = allowed_mask & (agave | olive_shrub | yellow_bloom | dry_grass)
        stem_shadow = (
            (hue >= 20.0)
            & (hue <= 90.0)
            & (val <= 115.0)
            & ((r - g) <= 68.0)
            & binary_dilate_edt(plant_core, 7)
        )
        raw = allowed_mask & (plant_core | stem_shadow)
        raw = binary_close_edt(raw, 4)
        raw = fill_interior_holes(raw, max_hole_start_px=2500) & allowed_mask
        raw = remove_small_components(raw, min_area_start_px=180)
        return raw

    if seg_mode == "i15_reeds":
        # Moonlit night reeds & pale-blue grass tufts against smooth slate-indigo ground
        cool = (b >= r + 4.0) & (hue >= 150.0) & (hue <= 245.0)
        # Tall teal-silver reeds: distinctly greener/more teal than indigo ground
        tall_reed = cool & (hue <= 215.0) & ((g - b) >= -22.0) & ((color_dev >= 6.5) | (grad_s >= 2.4))
        # Crisp pale-cyan grass tufts: brighter than ground with sharp blade contrast
        pale_tuft = cool & (hue <= 218.0) & (b >= 134.0) & (g >= 114.0) & ((color_dev >= 6.5) | (grad_s >= 2.4))
        # Pale cream moonlit highlight ridges along reed blades
        cream_highlight = (val >= 142.0) & (np.abs(r - b) <= 24.0) & (g >= 120.0) & (color_dev >= 7.0)
        # Dark teal reed stems directly attached to reed blades
        reed_base = cool & (hue <= 218.0) & (val <= 112.0) & (grad_s >= 1.8)
        core = allowed_mask & (tall_reed | pale_tuft)
        raw = allowed_mask & (core | ((reed_base | cream_highlight) & binary_dilate_edt(core, 8)))
        raw = binary_close_edt(raw, 4)
        raw = fill_interior_holes(raw, max_hole_start_px=1800) & allowed_mask
        raw = remove_small_components(raw, min_area_start_px=220)
        return raw

    if seg_mode == "i15_lush":
        # Lush moonlit foliage (SE corner & SW corner): big silver-blue leaf rosettes,
        # deep indigo fern fronds, and crisp pale grass tufts, over smooth uniform indigo dirt.
        cool = (b >= r + 2.0) & (hue >= 155.0) & (hue <= 255.0)
        tuft = cool & (hue <= 218.0) & (b >= 134.0) & (g >= 112.0) & (color_dev >= 5.0)
        lush_light = cool & (val >= 138.0) & ((color_dev >= 4.5) | (grad_s >= 1.6))
        lush_dark = cool & (val <= 118.0) & ((color_dev >= 3.8) | (grad_s >= 1.4))
        lush_mid = cool & (grad_s >= 2.0) & (color_dev >= 5.0)
        raw = allowed_mask & (tuft | lush_light | lush_dark | lush_mid)
        # Smooth closing + interior hole fill so broad painted moonlit leaves form cohesive masses
        raw = binary_close_edt(raw, 12)
        raw = fill_interior_holes(raw, max_hole_start_px=9000) & allowed_mask
        raw = remove_small_components(raw, min_area_start_px=700)
        return raw

    raise ValueError(f"Unknown seg_mode: {seg_mode}")


def make_feathered_mask(leaf_core: np.ndarray, dilate_px: int, feather_px: int, hard_clip: np.ndarray):
    """Dilate leaf core by dilate_px, clip strictly to hard_clip, then apply smoothstep inward feather."""
    dilated = binary_dilate_edt(leaf_core, dilate_px) & hard_clip
    # Remove any isolated sliver created by clipping
    dilated = remove_small_components(dilated, min_area_start_px=120)
    if not np.any(dilated):
        raise ValueError("Dilated mask is empty after clipping")
    dist_in = euclidean_distance_to_zero_bounded(dilated, feather_px)
    t = np.clip(dist_in / float(feather_px), 0.0, 1.0)
    smooth = t * t * (3.0 - 2.0 * t)
    mask_u8 = np.rint(255.0 * smooth).astype(np.uint8)
    mask_u8[~dilated] = 0
    nz = np.argwhere(mask_u8 > 0)
    bbox = [int(nz[:, 1].min()), int(nz[:, 0].min()), int(nz[:, 1].max()) + 1, int(nz[:, 0].max()) + 1]
    return mask_u8, bbox


def build_shipped_mask(island: str) -> np.ndarray:
    ma = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    ship = np.zeros((LAYOUT_H, LAYOUT_W), dtype=bool)
    for e in ma.get("elements", []):
        rx, ry, rw, rh = e["rect"]
        x0 = max(0, int(np.floor(rx)))
        y0 = max(0, int(np.floor(ry)))
        x1 = min(LAYOUT_W, int(np.ceil(rx + rw)))
        y1 = min(LAYOUT_H, int(np.ceil(ry + rh)))
        ship[y0:y1, x0:x1] = True
    return ship


def validate_v2_folder(
    island: str,
    full_name: str,
    crop: dict,
    mask_u8: np.ndarray,
    zones: dict,
    ship_mask: np.ndarray,
    excl_start: np.ndarray,
) -> list[str]:
    errors = []
    cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
    if cw * 9 != ch * 16:
        errors.append(f"{island}/{full_name}: crop {cw}x{ch} not exact 16:9")
    if cw < 200 or ch < 112:
        errors.append(f"{island}/{full_name}: crop {cw}x{ch} smaller than 200x112")
    if cx < 0 or cy < 0 or cx + cw > LAYOUT_W or cy + ch > LAYOUT_H:
        errors.append(f"{island}/{full_name}: crop outside {LAYOUT_W}x{LAYOUT_H}")

    # Strict zero-overlap check on ENTIRE crop rectangle
    sl = (slice(cy, cy + ch), slice(cx, cx + cw))
    for label, zarr in (
        ("shipped mapAnim rect", ship_mask),
        ("road animation_clearance", zones["road"]),
        ("plot disk", zones["plots"]),
        ("path centerline", zones["paths"]),
        ("gate rect", zones["gates"]),
    ):
        hits = int(zarr[sl].sum())
        if hits > 0:
            errors.append(f"{island}/{full_name}: CROP overlaps {label} ({hits} layout px)")

    # Check mask coverage & static margin
    nz_y, nz_x = np.nonzero(mask_u8)
    if len(nz_x) == 0:
        errors.append(f"{island}/{full_name}: mask is empty")
        return errors
    if int(mask_u8.max()) < 250:
        errors.append(f"{island}/{full_name}: mask peak alpha too low ({int(mask_u8.max())})")
    static_frac = float((mask_u8 == 0).mean())
    if static_frac < 0.15:
        errors.append(f"{island}/{full_name}: static margin {static_frac:.1%} < 15%")

    # Check explicit exclusions have 0 mask pixels
    excl_hits = int(((mask_u8 > 0) & excl_start).sum())
    if excl_hits > 0:
        errors.append(f"{island}/{full_name}: mask touches excluded object ({excl_hits} start px)")

    # Project every non-zero mask pixel to layout space and verify against all forbidden zones
    s = START_W / float(cw)
    lx = np.clip(np.floor(cx + (nz_x + 0.5) / s).astype(int), 0, LAYOUT_W - 1)
    ly = np.clip(np.floor(cy + (nz_y + 0.5) / s).astype(int), 0, LAYOUT_H - 1)
    for label, zarr in (
        ("shipped mapAnim rect", ship_mask),
        ("road animation_clearance", zones["road"]),
        ("plot disk", zones["plots"]),
        ("path centerline", zones["paths"]),
        ("gate rect", zones["gates"]),
    ):
        hits = int(zarr[ly, lx].sum())
        if hits > 0:
            errors.append(f"{island}/{full_name}: MASK touches {label} ({hits} start px)")

    return errors


def render_v2_contact_sheet(
    island: str,
    base_element: str,
    crop: dict,
    start_img: Image.Image,
    variant_data: dict,
    out_path: Path,
):
    """Render docs/anim-shots/v2-prep/<island>-<element>.jpg comparing v2a and v2b.

    Top row: start frame with bright crisp mask outline & subtle tint (v2a | v2b).
    Bottom row: masked-in foliage cutout over dark charcoal background (v2a | v2b).
    """
    pw, ph = 640, 360
    pad = 14
    header_h = 44
    sub_h = 26
    sheet_w = 2 * pw + 3 * pad
    sheet_h = header_h + 2 * (ph + sub_h) + 3 * pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (18, 20, 26))
    draw = ImageDraw.Draw(sheet)
    font_lg = load_font(17)
    font_sm = load_font(13)

    cw, ch = crop["width"], crop["height"]
    draw.text(
        (pad, 12),
        f"{island} / {base_element}  |  crop=({crop['x']},{crop['y']},{cw}x{ch})  |  "
        f"Top: start + mask outline  |  Bottom: masked-in cutout",
        fill=(240, 245, 255),
        font=font_lg,
    )

    st_half = start_img.resize((pw, ph), Image.Resampling.LANCZOS).convert("RGBA")
    st_rgb = np.asarray(st_half.convert("RGB"), dtype=np.float32)

    for col_idx, var in enumerate(("v2a", "v2b")):
        info = variant_data[var]
        mask_u8 = info["mask_u8"]
        mk_half = np.asarray(
            Image.fromarray(mask_u8).resize((pw, ph), Image.Resampling.BILINEAR),
            dtype=np.float32,
        ) / 255.0

        # Top panel: start image + subtle green tint inside mask + crisp bright yellow/lime outer contour
        bin_h = mk_half > 0.02
        # 2px exterior contour around bin_h so the outline never obscures the foliage edges
        dil = np.asarray(Image.fromarray((bin_h.astype(np.uint8) * 255)).filter(ImageFilter.MaxFilter(5))) > 0
        contour = dil & ~bin_h
        # Also mark inner feather edge (0.04 < m < 0.35) very thinly
        ov = np.zeros((ph, pw, 4), dtype=np.uint8)
        # Slightly dim masked-out exterior so masked foliage pops clearly
        ov[~bin_h] = [0, 0, 0, 62]
        # Subtle green tint inside mask
        ov[bin_h, 0] = 60
        ov[bin_h, 1] = 255
        ov[bin_h, 2] = 110
        ov[bin_h, 3] = np.rint(mk_half[bin_h] * 46.0).astype(np.uint8)
        # Bright crisp yellow contour outline
        ov[contour] = [255, 240, 50, 255]
        top_panel = Image.alpha_composite(st_half, Image.fromarray(ov, "RGBA")).convert("RGB")

        # Bottom panel: isolated masked-in pixels composited over dark charcoal (28, 30, 36)
        bg = np.array([28.0, 30.0, 36.0], dtype=np.float32)
        cut = st_rgb * mk_half[..., None] + bg * (1.0 - mk_half[..., None])
        bot_panel = Image.fromarray(np.clip(np.rint(cut), 0, 255).astype(np.uint8), mode="RGB")

        ox = pad + col_idx * (pw + pad)
        oy_top = header_h + pad
        oy_bot = oy_top + sub_h + ph + pad

        cov_pct = float((mask_u8 > 0).mean()) * 100.0
        static_pct = 100.0 - cov_pct
        bbox = info["bbox"]
        vcfg = VARIANTS[var]
        cap_top = (
            f"{var}: dilate={vcfg['dilate_start_px']}px feather={vcfg['feather_start_px']}px | "
            f"mask={cov_pct:.1f}% static={static_pct:.1f}% | bbox={bbox}"
        )
        draw.text((ox + 2, oy_top + 4), cap_top, fill=(235, 245, 220), font=font_sm)
        sheet.paste(top_panel, (ox, oy_top + sub_h))

        cap_bot = f"{var} masked-in foliage cutout (zero bare ground / rocks / crystals / lanterns)"
        draw.text((ox + 2, oy_bot + 4), cap_bot, fill=(195, 215, 235), font=font_sm)
        sheet.paste(bot_panel, (ox, oy_bot + sub_h))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, "JPEG", quality=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing files")
    args = parser.parse_args()

    islands = sorted({e["island"] for e in ELEMENTS_V2})
    zones_by_island = {isl: build_forbidden_zones(isl) for isl in islands}
    ship_by_island = {isl: build_shipped_mask(isl) for isl in islands}
    src_by_island = {
        isl: Image.open(ROOT / f"public/art2d/map-{isl}-layered@3x.webp").convert("RGB")
        for isl in islands
    }
    ch3_by_key = {}
    for isl in islands:
        spec = json.loads((ROOT / f"design/art-2d/anim/{isl}/ch3-elements.json").read_text())
        for row in spec["elements"]:
            ch3_by_key[(isl, row["element"])] = row

    all_errors = []
    index_rows = []
    to_write = []

    for cfg in ELEMENTS_V2:
        isl = cfg["island"]
        base_el = cfg["element"]
        crop = cfg["crop"]
        ch3 = ch3_by_key[(isl, base_el)]

        start_img, ltrb = crop_start_frame(src_by_island[isl], crop)
        start_rgb = np.asarray(start_img, dtype=np.uint8)

        # Build allowed segmentation region: inside old ch3 polygon (with tiny 4px layout tolerance for edge tips),
        # intersected with optional ROI polygons, minus exclusions and forbidden zones.
        old_poly_mask = rasterize_layout_polys_in_start(ch3["mask"], crop)
        old_poly_mask_relaxed = binary_dilate_edt(old_poly_mask, int(round(4.0 * START_W / crop["width"])))
        if cfg.get("roi_polys"):
            roi_mask = rasterize_layout_polys_in_start(cfg["roi_polys"], crop)
            allowed = old_poly_mask_relaxed & roi_mask
        else:
            allowed = old_poly_mask_relaxed

        excl_start = rasterize_exclusions_in_start(cfg.get("exclude", []), crop)
        # Also project forbidden zones into start space so dilation never leaks into road/plots/shipped rects
        zones = zones_by_island[isl]
        ship_mask = ship_by_island[isl]
        cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
        forb_layout = (
            zones["road"] | zones["plots"] | zones["paths"] | zones["gates"] | ship_mask
        )[cy : cy + ch, cx : cx + cw]
        forb_start = np.asarray(
            Image.fromarray((forb_layout.astype(np.uint8) * 255)).resize((START_W, START_H), Image.Resampling.NEAREST)
        ) > 0

        hard_clip = ~excl_start & ~forb_start
        allowed &= hard_clip

        leaf_core = segment_foliage_pixels(start_rgb, cfg["seg"], allowed)
        if not np.any(leaf_core):
            all_errors.append(f"{isl}/{base_el}: foliage segmentation produced 0 pixels")
            continue

        variant_data = {}
        for var, vcfg in VARIANTS.items():
            full_name = f"{base_el}-{var}"
            mask_u8, bbox = make_feathered_mask(
                leaf_core,
                dilate_px=vcfg["dilate_start_px"],
                feather_px=vcfg["feather_start_px"],
                hard_clip=hard_clip,
            )
            errs = validate_v2_folder(isl, full_name, crop, mask_u8, zones, ship_mask, excl_start)
            all_errors.extend(errs)

            s = START_W / float(cw)
            source_rel = f"public/art2d/map-{isl}-layered@3x.webp"
            place = {
                "element": full_name,
                "id": f"{isl}-{full_name}",
                "source": source_rel,
                "layoutSizePx": list(LAYOUT_SIZE),
                "startSizePx": list(START_SIZE),
                "cropLayoutPx": crop,
                "sourcePxPerLayoutPx": SOURCE_SCALE,
                "sourceCropPxLTRB": ltrb,
                "startPxPerLayoutPx": s,
                "startPxPerSourcePx": s / SOURCE_SCALE,
                "resample": "Lanczos",
                "maskBBoxStartPxLTRB": bbox,
                "featherInwardStartPx": vcfg["feather_start_px"],
            }
            prompt_text = build_v2_prompt(isl, cfg[f"{var}_motion"])
            folder_rel = f"design/art-2d/anim/{isl}/{full_name}"
            l, t, r_b, b_b = bbox
            mask_bbox_layout = [
                round(cx + l / s, 3),
                round(cy + t / s, 3),
                round((r_b - l) / s, 3),
                round((b_b - t) / s, 3),
            ]
            variant_data[var] = {
                "full_name": full_name,
                "mask_u8": mask_u8,
                "bbox": bbox,
                "place": place,
                "prompt": prompt_text,
                "folder_rel": folder_rel,
            }
            index_rows.append(
                {
                    "id": f"{isl}-{full_name}",
                    "island": isl,
                    "element": full_name,
                    "baseElement": base_el,
                    "variant": var,
                    "folder": folder_rel,
                    "start": f"{folder_rel}/start.png",
                    "mask": f"{folder_rel}/mask.png",
                    "crop": crop,
                    "maskBBoxStartPxLTRB": bbox,
                    "maskBBoxLayoutPx": mask_bbox_layout,
                    "prompt": prompt_text,
                }
            )

        to_write.append((isl, base_el, crop, start_img, variant_data))

    if all_errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print(f"DRY-RUN OK: {len(index_rows)} v2 folders validated with zero errors.")
        return

    for isl, base_el, crop, start_img, variant_data in to_write:
        for var in ("v2a", "v2b"):
            info = variant_data[var]
            out_dir = ROOT / info["folder_rel"]
            out_dir.mkdir(parents=True, exist_ok=True)
            start_img.save(out_dir / "start.png", "PNG")
            Image.fromarray(info["mask_u8"], mode="L").save(out_dir / "mask.png", "PNG")
            (out_dir / "place.json").write_text(json.dumps(info["place"], indent=2) + "\n")
            (out_dir / "prompt.txt").write_text(info["prompt"] + "\n")

        sheet_path = ROOT / "docs/anim-shots/v2-prep" / f"{isl}-{base_el}.jpg"
        render_v2_contact_sheet(isl, base_el, crop, start_img, variant_data, sheet_path)
        cov_a = float((variant_data["v2a"]["mask_u8"] > 0).mean()) * 100.0
        cov_b = float((variant_data["v2b"]["mask_u8"] > 0).mean()) * 100.0
        print(
            f"OK {isl}/{base_el:30s} crop={crop['width']}x{crop['height']} "
            f"mask(v2a={cov_a:4.1f}%, v2b={cov_b:4.1f}%)"
        )

    idx_path = ROOT / "design/art-2d/anim/index-v2.json"
    idx_path.write_text(json.dumps(index_rows, indent=2) + "\n")
    print(f"Wrote {len(index_rows)} entries to {idx_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
