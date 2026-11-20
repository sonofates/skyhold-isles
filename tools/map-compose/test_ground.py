"""Regression checks for map dressing. Run with python3 -B tools/map-compose/test_ground.py."""
import json
import math
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageColor, ImageDraw

import fords
from banks import shore_foundation, water_reflection
from gates import draw_threshold_road, output_sprite
from keeps import Keep, sample
from masonry import RoadArcade, arch_bridge, brick_spur, cart_tracks, paved_road, timber_approach

from ground import Decals, DressingArea, brushed_surface, dusty_road_coverage, paint_over_road, road_footprint, road_fringe, scatter
from ground import windblown_road_coverage


class GroundTests(unittest.TestCase):
    def load_recipe_and_check_rings(self, island):
        compose = Path(__file__).resolve().parent
        root = compose.parents[1]
        recipe = json.loads((compose / 'campaign.json').read_text())[island]
        layout = json.loads((root / f'src/data/levels2d/{island}.json').read_text())
        kit = root / 'design/art-2d/v2/biomes' / recipe['biome']
        with Image.open(kit / f'land-{island}.webp') as mask:
            land = mask.convert('L').resize(tuple(layout['imageSize']), Image.Resampling.NEAREST)
        rings = Image.new('L', land.size)
        rx = layout['plotRadiusPx']
        with Image.open(root / 'design/art-2d/v2/assets/plot-base.png') as base:
            ry = rx * base.height / base.width
        draw = ImageDraw.Draw(rings)
        for x, y in layout['plots']:
            draw.ellipse((x-rx-4, y-ry-4, x+rx+4, y+ry+4), fill=255)
        self.assertIsNone(ImageChops.subtract(rings, land).getbbox())
        return recipe, kit, layout, land

    def test_bastion_drawbridge_spans_the_moat_and_keeps_both_landings_dry(self):
        recipe, _, layout, land = self.load_recipe_and_check_rings('i08')
        [(_, start, end, above, below, _)] = recipe['archBridges']
        x0, y0 = start
        x1, y1 = end

        def deck(u, v):
            return round(x0 + (x1-x0)*u), round(y0 + (y1-y0)*u - above + (above+below)*v)

        for u in (.04, .96):
            for v in (.25, .73):
                self.assertEqual(land.getpixel(deck(u, v)), 255)
        for v in (.25, .5, .73):
            self.assertEqual(land.getpixel(deck(.5, v)), 0)

        supported = land.copy()
        ImageDraw.Draw(supported).polygon([deck(u, v) for u, v in
            [(0, .20), (1, .20), (1, .78), (0, .78)]], fill=255)
        road = Image.new('L', land.size)
        ImageDraw.Draw(road).line([tuple(p) for p in layout['paths'][0]],
                                  fill=255, width=round(.068 * land.height), joint='curve')
        self.assertIsNone(ImageChops.subtract(road, supported).getbbox())

    def test_ruin_reflection_preserves_the_shore_and_open_arch(self):
        land = Image.new('L', (80, 90))
        ImageDraw.Draw(land).rectangle((36, 0, 79, 89), fill=255)
        for scale in (1, 2, 3):
            ground = Image.new('RGBA', (80*scale, 90*scale), 'teal')
            before = ground.copy()
            stones = Image.new('RGBA', (44*scale, 46*scale), 'tan')
            ImageDraw.Draw(stones).rectangle((13*scale, 12*scale, 34*scale, 46*scale), fill=(0, 0, 0, 0))
            water_reflection(ground, stones, 10*scale, 53*scale, land, scale)
            changed = ImageChops.difference(ground, before).convert('RGB')
            self.assertIsNotNone(changed.crop((15*scale, 55*scale, 21*scale, 66*scale)).getbbox())
            for box in ((0, 0, 80, 49), (27, 54, 32, 66), (37, 0, 80, 90), (0, 82, 80, 90)):
                self.assertIsNone(changed.crop(tuple(v*scale for v in box)).getbbox())

    def test_galewatch_road_only_leaves_its_ledge_on_the_bridge(self):
        recipe, kit, layout, land = self.load_recipe_and_check_rings('i11')
        [(name, x, y, length, width, angle)] = recipe['crossings']
        cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))

        def on_map(u, v):
            dx, dy = (u - .5) * width, (v - .5) * length
            return round(x + dx*cos + dy*sin), round(y - dx*sin + dy*cos)

        with Image.open(kit / f'landmark-{name}.webp') as bridge:
            feet = [(.06, .04), (.79, .04), (.06, .96), (.79, .96)]
            for u, v in [*feet, (.43, .48)]:
                self.assertGreater(bridge.getpixel((round(u*(bridge.width-1)), round(v*(bridge.height-1))))[3], 200)
                self.assertEqual(land.getpixel(on_map(u, v)) >= 128, (u, v) in feet)

        # The right pennant extends beyond the deck. Only count the width between the rails.
        supported = land.copy()
        ImageDraw.Draw(supported).polygon([on_map(u, v) for u, v in (
            (.05, .02), (.81, .02), (.81, .98), (.05, .98),
        )], fill=255)
        road = Image.new('L', land.size)
        ImageDraw.Draw(road).line([tuple(p) for p in layout['paths'][0]], fill=255,
                                  width=round(.068 * land.height), joint='curve')
        self.assertIsNone(ImageChops.subtract(road, supported).getbbox())

    def test_emerald_crossings_have_dry_landings_and_span_open_water(self):
        recipe, kit, _, land = self.load_recipe_and_check_rings('i04')
        crossings = recipe['crossings']
        # Probe the timber feet. A centreline check missed the post beside the waterfall.
        landings = {
            'rope-span': [(0.21, .14), (.75, .16), (.12, .92), (.81, .94)],
            'moss-steps': [(.5, .10), (.5, .90)],
            'clapper-span': [(.5, .10), (.5, .90)],
        }
        self.assertEqual({crossing[0] for crossing in crossings}, landings.keys())
        for name, x, y, length, width, angle in crossings:
            cosine, sine = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            with self.subTest(crossing=name), Image.open(kit / f'landmark-{name}.webp') as paint:
                for u, v in [*landings[name], (.5, .5)]:
                    dx, dy = (u - .5) * width, (v - .5) * length
                    point = (round(x + dx*cosine + dy*sine), round(y - dx*sine + dy*cosine))
                    self.assertGreater(paint.getpixel((round(u*(paint.width-1)), round(v*(paint.height-1))))[3], 128)
                    self.assertEqual(land.getpixel(point) >= 128, (u, v) in landings[name], point)

    def test_cay_boats_float_alongside_land_accessible_jetties(self):
        compose = Path(__file__).resolve().parent
        recipe = json.loads((compose / 'campaign.json').read_text())['i02']
        root = compose.parents[1]
        layout = json.loads((root / 'src/data/levels2d/i02.json').read_text())
        kit = root / 'design/art-2d/v2/biomes' / recipe['biome']
        placements = {name: (x, bottom, height) for name, x, bottom, height in recipe['groundPaint']}
        with Image.open(kit / 'land-i02.webp') as mask:
            land = mask.convert('L').resize(tuple(layout['imageSize']), Image.Resampling.NEAREST)
        # Bow, midships, stern and the shoreward end of the gangway in each source painting.
        for name, probes in (
            ('pilot-jetty', ((.81, .27), (.76, .54), (.66, .74), (.05, .55))),
            ('smack-landing', ((.11, .42), (.17, .62), (.27, .88), (.97, .28))),
        ):
            with self.subTest(berth=name), Image.open(kit / f'landmark-{name}.webp') as paint:
                x, bottom, height = placements[name]
                width = height * paint.width / paint.height
                for (u, v), expected_land in zip(probes, (False, False, False, True)):
                    self.assertGreater(paint.getpixel((int(u * paint.width), int(v * paint.height)))[3], 200)
                    point = (round(x + (u - .5) * width), round(bottom + (v - 1) * height))
                    self.assertEqual(land.getpixel(point) >= 128, expected_land, point)

    def test_bridge_follows_both_landings_and_exposes_its_arch_above_the_gorge(self):
        land = Image.new('L', (100, 80), 255)
        ImageDraw.Draw(land).rectangle((32, 0, 67, 79), fill=0)
        ImageDraw.Draw(land).rectangle((32, 33, 38, 35), fill=255)
        paint = Image.new('RGBA', (80, 36), 'tan')
        ink = ImageDraw.Draw(paint)
        ink.rectangle((0, 0, 79, 11), fill='silver')
        ink.rectangle((29, 20, 39, 35), fill=(0, 0, 0, 0))
        for scale in (1, 2, 3):
            ground = Image.new('RGBA', (200*scale, 160*scale), 'teal')
            arch_bridge(ground, paint, land, (200, 160), (20, 40), (180, 80),
                        12, 24, 6, scale)
            # Both ends have a deck, with their foundations buried in the bank.
            for x in (40, 160):
                y = 40 + (x-20)//4
                self.assertEqual(ground.getpixel((x*scale, (y-6)*scale)), ImageColor.getcolor('silver', 'RGBA'))
                self.assertEqual(ground.getpixel((x*scale, (y+14)*scale)), ImageColor.getcolor('teal', 'RGBA'))
            # A grass spur in front of the left pier hides the masonry all the way down.
            for x, color in ((72, 'teal'), (80, 'teal'), (108, 'tan'), (120, 'tan')):
                y = 40 + (x-20)//4 + 15
                self.assertEqual(ground.getpixel((x*scale, y*scale)), ImageColor.getcolor(color, 'RGBA'))

    def test_paving_strip_runs_once_from_the_entrance_and_turns_with_the_lane(self):
        paint = Image.new('RGB', (94, 21), 'slategray')
        ink = ImageDraw.Draw(paint)
        ink.rectangle((0, 0, 30, 20), fill='wheat')
        ink.rectangle((68, 0, 93, 20), fill='tan')
        ink.rectangle((0, 0, 93, 6), fill='ivory')
        for scale in (1, 2, 3):
            paved = paved_road((90*scale, 80*scale), paint, [(8, 58), (65, 58), (65, 8)], 18, scale)
            for x, y, color in ((11, 58, 'wheat'), (58, 58, 'slategray'), (65, 11, 'tan'),
                                (21, 50, 'ivory'), (57, 21, 'ivory')):
                self.assertEqual(paved.getpixel((x*scale, y*scale)), ImageColor.getrgb(color) + (255,))

    def test_snow_drifts_have_variable_depth_and_follow_the_same_shoulder_at_each_scale(self):
        profiles = []
        for scale in (1, 2, 3):
            mask = Image.new('L', (258*scale, 118*scale))
            ImageDraw.Draw(mask).rectangle((0, 28*scale, mask.width-1, 86*scale-1), fill=255)
            paving = windblown_road_coverage(mask, scale, 18)
            self.assertIsNone(ImageChops.subtract(paving, mask).getbbox())
            self.assertEqual(paving.crop((0, 47*scale, mask.width, 67*scale)).getextrema(), (255, 255))
            # Integrate the snow across the upper verge in layout pixels.
            reduced = np.asarray(paving.resize((258, 118), Image.Resampling.BOX))
            depth = (255 - reduced[28:47]).sum(axis=0) / 255
            self.assertGreater(depth.max() - depth.min(), 3)
            profiles.append(depth)
        for profile in profiles[1:]:
            np.testing.assert_allclose(profile, profiles[0], atol=.5)

    def test_dusty_shoulder_keeps_lane_centre_and_respects_road_boundary(self):
        profiles = []
        for scale in (1, 2, 3):
            mask = Image.new('L', (120*scale, 72*scale))
            ImageDraw.Draw(mask).rectangle((0, 16*scale, mask.width-1, 56*scale-1), fill=255)
            coverage = dusty_road_coverage(mask, scale, 71)
            self.assertIsNone(ImageChops.subtract(coverage, mask).getbbox())
            self.assertEqual(coverage.crop((0, 32*scale, mask.width, 40*scale)).getextrema(), (255, 255))
            small = coverage.resize((120, 72), Image.Resampling.BOX)
            shoulder = np.asarray(small)[17].astype(float)
            self.assertGreater(shoulder.max() - shoulder.min(), 60)
            self.assertLess(shoulder.max(), 255)
            profiles.append(shoulder)
        for profile in profiles[1:]:
            self.assertLess(np.abs(profiles[0] - profile).mean(), 12)

    def test_keep_sampling_interpolates_the_front_into_the_transparent_border(self):
        # The fifth channel is the depth-sorted front, separate from the RGBA painting.
        texel = np.array([40, 80, 120, 200, 160], dtype=np.uint8)
        data = np.tile(texel, (2, 2, 1))
        y, x = np.meshgrid(np.arange(161) / 32 - 2, [-.5, 0, .75, 1.5, 4], indexing='ij')
        warped = sample(data, x, y)
        coverage = np.clip(np.minimum(x+1, 2-x), 0, 1) * np.clip(np.minimum(y+1, 2-y), 0, 1)
        np.testing.assert_array_equal(warped, np.rint(coverage[..., None] * texel).astype(np.uint8))

    def test_arcade_tracks_the_near_road_edge_and_buries_its_ends(self):
        path = [(15, 26), (40, 30), (72, 32), (105, 27), (139, 22)]
        stone = Image.new('RGB', (60, 20), 'slateblue')
        ImageDraw.Draw(stone).rectangle((0, 0, 59, 6), fill='tan')
        # The outer spiral runs east to west. Its visible face is still to the south.
        for points in (path, path[::-1]):
            arcade = RoadArcade(points, path[0], path[-1], 16, 13)
            for scale in (1, 2, 3):
                ground = Image.new('RGB', (160*scale, 76*scale), 'seagreen')
                arcade.paint(ground, stone, scale)
                for x, y, color in ((73, 39, 'tan'), (73, 49, 'slateblue'),
                                    (136, 38, 'seagreen'), (73, 32, 'seagreen'),
                                    (73, 56, 'seagreen'), (8, 38, 'seagreen')):
                    self.assertEqual(ground.getpixel((x*scale, y*scale)), ImageColor.getrgb(color))

    def test_furnace_finish_preserves_opening_and_silhouette(self):
        art = Image.new('RGBA', (48, 32))
        ink = ImageDraw.Draw(art)
        ink.rectangle((3, 3, 44, 29), fill='tan')
        ink.rectangle((28, 14, 40, 29), fill='black')
        aperture = Image.new('L', art.size)
        ImageDraw.Draw(aperture).rectangle((28, 14, 40, 29), fill=255)
        gate = {'im': art, 'left': 30, 'top': 8, 'k': 1, 'mouth': {'mask': aperture}}
        wall = Image.new('RGBA', art.size, 'turquoise')
        for scale in (1, 2, 3):
            original = output_sprite(gate, scale)
            painted = output_sprite(gate, scale, wall)
            self.assertEqual(painted.getchannel('A').tobytes(), original.getchannel('A').tobytes())
            self.assertEqual(painted.getpixel((33*scale, 20*scale)), (0, 0, 0, 255))
            self.assertEqual(painted.getpixel((15*scale, 12*scale)), wall.getpixel((15, 12)))
        with self.assertRaises(ValueError):
            output_sprite(gate, 1, wall.crop((0, 0, 8, 8)))

    def test_spur_pavers_follow_bend_and_stop_before_shared_road(self):
        path = [(20, 80), (72, 80), (92, 60), (92, 20)]
        tile = Image.new('RGB', (60, 60), 'firebrick')
        for scale in (1, 2, 3):
            ground = Image.new('RGB', (140*scale, 110*scale), 'tan')
            blank = ground.copy()
            brick_spur(ground, path, tile, 20, scale)
            for x, y in ((22, 80), (69, 72), (76, 74), (86, 67), (92, 53), (92, 41)):
                self.assertEqual(ground.getpixel((x*scale, y*scale)), tile.getpixel((0, 0)))
            for x, y in ((92, 22), (92, 35), (68, 59), (116, 55)):
                self.assertEqual(ground.getpixel((x*scale, y*scale)), blank.getpixel((x*scale, y*scale)))
            brick_spur(blank, [(20, 20), (32, 20)], tile, 20, scale)
            self.assertEqual(blank.getcolors(), [(blank.width * blank.height, (210, 180, 140))])

    def test_approach_boards_cross_the_lane_and_stop_at_the_shorter_limit(self):
        paint = Image.new('RGB', (100, 100), 'peru')
        ImageDraw.Draw(paint).rectangle((0, 40, 99, 60), fill='ivory')
        path = [(15, 80), (65, 80), (65, 30)]
        for length, end in ((52, 52), (130, 80)):
            for scale in (1, 2, 3):
                dirt = Image.new('RGB', (110*scale, 100*scale), 'sienna')
                timber_approach(dirt, path, paint, 20, length, scale)
                # The central pale board runs across the width of the horizontal leg.
                x = 15 + end // 2
                for y in (74, 80, 86):
                    self.assertEqual(dirt.getpixel((x*scale, y*scale)), ImageColor.getrgb('ivory'))
                # End station around the corner: the approach leaves the rest as dirt.
                end_y = 80 - (end - 50)
                for y, color in ((end_y + 2, 'peru'), (end_y - 2, 'sienna')):
                    self.assertEqual(dirt.getpixel((65*scale, y*scale)), ImageColor.getrgb(color))

    def test_authored_scenery_only_fouls_a_bend_where_its_paint_covers_the_lane(self):
        lane = road_footprint((100, 100), [[(0, 75), (75, 75), (75, 0)]], 12)
        rect = (40, 40, 80, 80)
        for scale in (1, 2, 3):
            art = Image.new('RGBA', (40 * scale, 40 * scale))
            ink = ImageDraw.Draw(art)
            ink.rectangle((0, 0, 18 * scale, 28 * scale), fill='navy')
            self.assertFalse(paint_over_road(lane, art, rect))
            ink.polygon([(10 * scale, 0), (36 * scale, 5 * scale), (10 * scale, 15 * scale)], fill='navy')
            self.assertTrue(paint_over_road(lane, art, rect))

    def test_cart_wheels_leave_broken_parallel_tracks_and_clear_thresholds(self):
        for scale in (1, 2, 3):
            size = (360 * scale, 90 * scale)
            surface = Image.new('RGB', size, (152, 122, 94))
            cart_tracks(surface, [(10, 45), (350, 45)], 40, scale, 17)
            wear = ImageChops.difference(surface, Image.new('RGB', size, (152, 122, 94)))
            for y in (35, 54):
                track = wear.crop((0, y * scale, size[0], y * scale + 1))
                self.assertIsNotNone(track.getbbox())
            # A length of undisturbed lane separates the worn patches.
            self.assertTrue(any(wear.crop((x * scale, 0, (x + 6) * scale, size[1])).getbbox() is None
                                for x in range(110, 240)))
            for box in ((0, 0, 44, 90), (316, 0, 360, 90), (0, 43, 360, 47)):
                self.assertIsNone(wear.crop(tuple(v * scale for v in box)).getbbox())

    def test_shallow_doorway_joins_the_lane_from_both_jambs(self):
        # Both jambs stand below the interior floor. Their road needs to round
        # the corner without leaving a grass notch in front of the opening.
        sprite = Image.new('RGBA', (41, 35))
        ImageDraw.Draw(sprite).rectangle((0, 0, 40, 29), fill='black')
        for direction in (1, -1):
            gate = {'im': sprite, 'left': 60, 'top': 12, 'k': 1,
                    'threshold': {'a': (5, 25), 'b': (35, 25)}}
            for scale in (1, 2, 3):
                road = Image.new('L', (160 * scale, 84 * scale))
                path = [((80 + direction * step) * scale, 40 * scale) for step in range(70)]
                self.assertTrue(draw_threshold_road(ImageDraw.Draw(road), path, gate, scale, 24 * scale))
                for y in (38, 42):
                    for x in range(69, 92):
                        self.assertEqual(road.getpixel((x * scale, y * scale)), 255)
                self.assertEqual(road.getpixel(((80 - direction * 26) * scale, 44 * scale)), 0)
                self.assertEqual(road.getpixel(((80 + direction * 55) * scale, 50 * scale)), 255)

    def test_oblique_sill_leads_into_the_lane_and_keeps_the_near_verge_clear(self):
        sprite = Image.new('RGBA', (42, 36))
        ImageDraw.Draw(sprite).polygon([(0, 0), (41, 0), (41, 34), (0, 26)], fill='black')
        gate = {'im': sprite, 'left': 98, 'top': 35, 'k': 1,
                'threshold': {'a': (5, 23), 'b': (38, 30)}}
        for scale in (1, 2, 3):
            road = Image.new('L', (174*scale, 100*scale))
            path = [((117-i)*scale, (54+i*.17)*scale) for i in range(100)]
            draw_threshold_road(ImageDraw.Draw(road), path, gate, scale, 28*scale, exit_blend=.85)
            for x, y in ((130, 63), (115, 64), (96, 63), (70, 52), (70, 72)):
                self.assertEqual(road.getpixel((x*scale, y*scale)), 255)
            for x, y in ((123, 72), (115, 74), (90, 77)):
                self.assertEqual(road.getpixel((x*scale, y*scale)), 0)

    def test_shore_plot_checks_rim_and_interior_and_blends_into_land(self):
        size = (192, 160)
        x, y = 90, 80
        islet = Image.new('RGBA', (120, 90), 'tan')
        for scale in (1, 2, 3):
            canvas = Image.new('RGBA', (size[0]*scale, size[1]*scale), 'teal')
            untouched = canvas.copy()
            land = Image.new('L', (96, 80), 255)
            draw = ImageDraw.Draw(land)
            # A wet pixel inside the bounding box, outside the ellipse.
            draw.point((31,30), fill=0)
            args = (canvas, land, size, islet, (x,y), (30,20), scale)
            self.assertFalse(shore_foundation(*args))
            self.assertIsNone(ImageChops.difference(canvas, untouched).convert('RGB').getbbox())
            # First a stream inside the ellipse, then a broad bank at the rim.
            draw.line((40,37,40,42), fill=0)
            self.assertTrue(shore_foundation(*args))
            draw.rectangle((57,0,95,79), fill=0)
            self.assertTrue(shore_foundation(*args))
            self.assertEqual(canvas.getpixel((119*scale,y*scale))[:3], (210,180,140))
            self.assertEqual(canvas.getpixel((60*scale,y*scale)), untouched.getpixel((60*scale,y*scale)))

    def test_trim_terminal_road_preserves_an_earlier_loop(self):
        paths = [[(14,65), (91,65), (165,65), (160,120), (72,120), (72,80)]]
        keep = Keep.__new__(Keep)
        keep.compact, keep.point, keep.along, keep.road = True, (72,80), (0,1), 18
        for scale in (1, 2, 3):
            mask = Image.new('L', (180*scale,145*scale))
            draw = ImageDraw.Draw(mask)
            draw.line([(x*scale,y*scale) for x,y in paths[0]], fill=255, width=18*scale, joint='curve')
            keep.trim_road(mask, scale, paths)
            self.assertEqual(mask.getpixel((71*scale,65*scale)), 255)
            self.assertLess(mask.getpixel((80*scale,81*scale)), 255)

    def test_painted_swatches_cover_fractional_tile_joins(self):
        color = (79, 103, 60, 255)
        paint = Image.new('RGBA', (53, 48), color)
        for scale in (.55, .825, 1.1, 1.65):
            result = brushed_surface(paint, (199, 97), scale, seed=9)
            self.assertEqual(result.getextrema(), tuple((c, c) for c in color))

    def test_ford_carries_water_across_road_only_between_the_banks(self):
        terrain = Image.new('RGBA', (120, 96), 'seagreen')
        land = Image.new('L', terrain.size, 255)
        ImageDraw.Draw(land).rectangle((43, 0, 73, 95), fill=0)
        road = Image.new('L', terrain.size)
        ImageDraw.Draw(road).rectangle((0, 40, 119, 56), fill=255)
        for scale in (1, 2, 3):
            size = (terrain.width * scale, terrain.height * scale)
            img = terrain.resize(size)
            patches = fords.prepare(img, land, terrain.size, [(58, 48, 41)], scale)
            track = road.resize(size, Image.Resampling.NEAREST)
            img.paste('tan', mask=track)
            before = img.copy()
            fords.paint(img, patches, track, 16, Image.new('RGBA', (8, 8), 'grey'), [], scale, seed=4)
            self.assertEqual(img.getpixel((20 * scale, 48 * scale)), before.getpixel((20 * scale, 48 * scale)))
            self.assertEqual(img.getpixel((58 * scale, 17 * scale)), before.getpixel((58 * scale, 17 * scale)))
            shallow = img.getpixel((58 * scale, 48 * scale))
            self.assertGreater(shallow[1], shallow[0])
            self.assertNotEqual(shallow, terrain.getpixel((58, 48)))

    def test_entire_decals_clear_roads_plots_crossings_and_canvas_edges(self):
        paths = [[(8, 100), (190, 100), (240, 195)], [(32, 15), (190, 100)]]
        area = DressingArea((320, 225), paths, 28, [(210, 46)], 32, 18, [(77, 65, 112, 138)])
        # A broad foliage crown whose centre clears the bridge can still clip its posts.
        self.assertFalse(area.clear((109, 58, 145, 75)))
        self.assertFalse(area.clear((-1, 160, 30, 176)))
        self.assertFalse(area.clear((180, 35, 192, 44)))
        self.assertTrue(area.clear((200, 170, 207, 179)))
        decals = Decals(lambda _: Image.new('RGBA', (37, 14), 'white'))
        poly = [(x, 100) for x in range(8, 190, 4)]
        for scale in (1, 2, 3):
            canvas = Image.new('RGBA', (320*scale, 225*scale))
            road_fringe(canvas, decals, [poly], 14, scale, 42, area.clear)
            scatter(canvas, decals, 320, 225, area.clear, scale, seed=7, n=30)
            alpha = canvas.getchannel('A')
            self.assertIsNotNone(alpha.getbbox())
            forbidden = area.mask.resize(canvas.size, Image.Resampling.NEAREST)
            self.assertIsNone(Image.composite(alpha, Image.new('L', canvas.size), forbidden).getbbox())


if __name__ == '__main__':
    unittest.main()
