"""Contact sheet of QA screenshots: python3 qa/contact.py <glob> <out.jpg> [cols] [thumb_w]

Labels each thumbnail with its file name (minus extension). Used for the bar / card sweeps.
"""
import glob
import os
import sys

from PIL import Image, ImageDraw

pattern, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 480
files = sorted(glob.glob(pattern))
if not files:
    sys.exit('no files')
thumbs = []
for f in files:
    im = Image.open(f).convert('RGB')
    th = int(im.height * tw / im.width)
    im = im.resize((tw, th), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    label = os.path.splitext(os.path.basename(f))[0]
    d.rectangle([0, 0, 8 + 7 * len(label), 16], fill=(0, 0, 0))
    d.text((4, 2), label, fill=(255, 255, 255))
    thumbs.append(im)
th = max(t.height for t in thumbs)
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th), (30, 30, 30))
for i, t in enumerate(thumbs):
    sheet.paste(t, ((i % cols) * tw, (i // cols) * th))
sheet.save(out, quality=82)
print(out, sheet.size)
