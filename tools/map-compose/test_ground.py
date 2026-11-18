"""Regression checks for map dressing. Run with python3 -B tools/map-compose/test_ground.py."""
import unittest

from PIL import Image, ImageDraw

import fords

from ground import Decals, DressingArea, brushed_surface, road_fringe, scatter


class GroundTests(unittest.TestCase):
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
