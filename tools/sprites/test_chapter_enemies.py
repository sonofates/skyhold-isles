"""Production plate and sprite registration checks. Run with system Python."""
import json
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from chapter_enemies import POSES, split_plate

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT/'public/art2d'


class ChapterEnemyArtTests(unittest.TestCase):
    def test_wing_crossing_a_column_stays_with_its_owner(self):
        plate = Image.new('RGBA', (360,300))
        draw = ImageDraw.Draw(plate)
        for row in range(5):
            for col in range(6):
                x, y = 60*col+30, 60*row+27
                draw.rectangle((x-16,y-16,x+16,y+16), fill='gold')
        # The other pose above the swept wing overlaps its horizontal range.
        draw.rectangle((39,38,70,41), fill='cyan')
        draw.rectangle((65,13,86,17), fill='tan')
        poses = split_plate(plate)
        first, second = poses[0][0][0], poses[0][1][0]
        self.assertIn((0,255,255,255),first.getdata())
        self.assertNotIn((0,255,255,255),second.getdata())
        self.assertIn((210,180,140,255),second.getdata())
        self.assertNotIn((210,180,140,255),first.getdata())

    def test_registered_clips_have_distinct_unclipped_frames_and_a_common_anchor(self):
        manifest = json.loads((ART/'manifest.json').read_text())
        for ident in ('bellrunner', 'kilnback', 'reedpiper', 'draftwing'):
            with self.subTest(ident=ident):
                art = manifest['enemies'][manifest['enemyMap'][ident]]
                paths = [art['sheet'][key] for key in ('down','up','side')] + [art['attack'],art['death']]
                common = set()
                for pose, file in zip(POSES,paths):
                    spec_path = ART/file
                    spec = json.loads(spec_path.read_text())
                    w, h = spec['frameW'], spec['frameH']
                    common.add((w,h,*spec['anchor']))
                    with Image.open(spec_path.with_name(spec['image'])) as strip:
                        self.assertEqual(strip.size, (w*spec['count'],h))
                        self.assertGreaterEqual(spec['count'],6)
                        seen = set()
                        for i in range(spec['count']):
                            frame = strip.crop((i*w,0,(i+1)*w,h))
                            left,top,right,bottom = frame.getchannel('A').getbbox()
                            self.assertTrue(0 < left < right < w and 0 < top < bottom < h, (pose,i))
                            seen.add(frame.tobytes())
                        self.assertEqual(len(seen),spec['count'])
                    if pose == 'attack':
                        self.assertEqual(spec['impact'],3)
                self.assertEqual(len(common),1)


if __name__ == '__main__':
    unittest.main()
