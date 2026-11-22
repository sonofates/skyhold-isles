"""Run with python3 -B tools/map-anim/test_road_mask.py."""
import json
import math
import unittest

from PIL import Image, ImageChops, ImageDraw

from road_mask import ROOT, animation_clearance, catmull, clip_atlas


def layout_support(mask, data, size):
    """Union of positive mask coverage sampled at layout pixel centres."""
    support = Image.new('L', size)
    sx, sy = mask.width / data['width'], mask.height / data['height']
    for element in data['elements']:
        x, y, w, h = element['rect']
        cx, cy, cw, ch = element['cell']
        left, top = math.ceil(x - .5), math.ceil(y - .5)
        right, bottom = math.ceil(x + w - .5), math.ceil(y + h - .5)
        dx, dy = cw * sx / w, ch * sy / h
        projected = mask.transform((right-left, bottom-top), Image.Transform.AFFINE,
            (dx, 0, cx*sx + (left-x)*dx, 0, dy, cy*sy + (top-y)*dy),
            Image.Resampling.BILINEAR)
        box = left, top, right, bottom
        support.paste(ImageChops.lighter(support.crop(box), projected), box)
    return support.point(lambda v: 255 if v else 0)


class RoadMaskTests(unittest.TestCase):
    def test_fractional_uvs_sample_the_same_world_strip_on_both_tiers(self):
        clearance = Image.new('L', (64, 32), 255)
        ImageDraw.Draw(clearance).rectangle((20, 0, 35, 31), fill=0)
        # Deliberately place the affected rectangle second in the atlas.
        tiles = [
            dict(rect=[40, 8, 12, 8], cell=[4, 4, 23, 15]),
            dict(rect=[12.5, 8, 31, 8], cell=[32, 4, 61, 15]),
        ]
        for scale in (1, .5):
            size = int(96*scale), int(24*scale)
            matte = Image.new('L', size, 180)
            clip_atlas(matte, clearance, tiles, (96, 24))
            for index, x, expected in [(0, 42, 180), (1, 16, 180), (1, 29, 0), (1, 41, 180)]:
                wx, _, ww, _ = tiles[index]['rect']
                cx, cy, cw, ch = tiles[index]['cell']
                u, v = int(scale*(cx+(x-wx)/ww*cw)), int(scale*(cy+ch/2))
                self.assertEqual(matte.getpixel((u, v)), expected)

    def test_shipped_masks_obey_clearance_at_both_resolutions(self):
        for path in sorted((ROOT / 'src/data/mapAnim').glob('*.json')):
            data = json.loads(path.read_text())
            world = animation_clearance(path.stem)
            master = (data['width'], data['height'])
            for track in (data, data['compact']):
                with self.subTest(mask=track['mask']), Image.open(ROOT / 'public/art2d' / track['mask']) as image:
                    self.assertEqual(image.size, (track['width'], track['height']))
                    mask = image.getchannel('R')  # mapAnimLayer's shader reads red
                    allowed = clip_atlas(Image.new('L', mask.size, 255), world, data['elements'], master)
                    self.assertIsNone(ImageChops.subtract(mask, allowed).getbbox())

    def test_shipped_masks_stay_off_protected_layout_pixels(self):
        for path in sorted((ROOT / 'src/data/mapAnim').glob('*.json')):
            data = json.loads(path.read_text())
            layout = json.loads((ROOT / 'src/data/levels2d' / path.name).read_text())
            forbidden = animation_clearance(path.stem).point(lambda v: 255 if v < 255 else 0)
            draw = ImageDraw.Draw(forbidden)
            radius = layout.get('plotRadiusPx', 48)
            for x, y in layout['plots']:
                draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=255)
            for lane in layout['paths']:
                points = list(map(tuple, lane))
                draw.line(points, fill=255)
                draw.line(catmull(points), fill=255)
            for track in (data, data['compact']):
                with self.subTest(mask=track['mask']), Image.open(ROOT / 'public/art2d' / track['mask']) as image:
                    painted = layout_support(image.getchannel('R'), data, forbidden.size)
                    self.assertIsNone(ImageChops.multiply(painted, forbidden).getbbox())


if __name__ == '__main__':
    unittest.main()
