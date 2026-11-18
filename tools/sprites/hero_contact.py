#!/usr/bin/python3
"""Render the hero contact sheet from the shipping manifest, including every animation frame."""
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'public/art2d'
ROSTER = {
    'bran': ('Bran Ironoak', 'Shield knight', '#bbca85'),
    'wren': ('Wren Skyfletch', 'Ranger', '#9dcfec'),
    'mira': ('Mira Emberwisp', 'Fire mage', '#f4b17a'),
    'tobb': ('Tobb Gearwright', 'Tinkerer', '#e1be87'),
    'sela': ('Sela Tidecaller', 'Storm priestess', '#9dd8cf'),
}
CREAM = '#faecd3'
MUTED = '#b2c4be'
SPRITES = '#384d50'
BASELINE = '#637475'


def label(draw, xy, value, size=18, fill=CREAM, anchor='la'):
    draw.text(xy, value, font=ImageFont.load_default(size=size), fill=fill, anchor=anchor)


def place(canvas, image, box):
    x, y, w, h = box
    im = image.convert('RGBA')
    im.thumbnail((w, h), Image.Resampling.LANCZOS)
    canvas.paste(im, (x + (w-im.width)//2, y + (h-im.height)//2), im)


def strip(canvas, draw, path, box, floor=False):
    x, y, w, h = box
    spec = json.loads(path.read_text())
    sheet = Image.open(path.parent / spec['image']).convert('RGBA')
    fw, fh, cols = (spec[k] for k in ('frameW', 'frameH', 'cols'))
    slot = w / spec['count']
    scale = min((slot-8)/fw, (h-3)/fh)
    for i in range(spec['count']):
        sx, sy = i % cols * fw, i // cols * fh
        frame = sheet.crop((sx, sy, sx+fw, sy+fh))
        frame = frame.resize((round(fw*scale), round(fh*scale)), Image.Resampling.LANCZOS)
        dx = round(x + (i+.5)*slot - frame.width/2)
        dy = y + (h-frame.height)//2
        if floor:
            baseline = dy + round(spec['anchor'][1] * scale)
            mid = dx + round(spec['anchor'][0] * scale)
            draw.line((mid-43, baseline, mid+43, baseline), fill=BASELINE)
            draw.line((mid, baseline, mid, baseline+3), fill=BASELINE)
        canvas.paste(frame, (dx,dy), frame)


def hero_block(canvas, draw, y, hero, data):
    name, role, accent = ROSTER[hero]
    draw.rectangle((0, y, 1599, y+536), fill='#253c3e')
    draw.rectangle((0,y,9,y+536), fill=accent)
    draw.rectangle((717,y,1599,y+536), fill=SPRITES)
    label(draw,(36,y+17), name, 36)
    label(draw,(37,y+61), role, 20, accent)
    place(canvas, Image.open(ART / data['select']), (20,y+98,282,416))
    place(canvas, Image.open(ART / data['portrait']), (331,y+24,170,170))
    label(draw, (329,y+211), 'Skills', 19, accent)
    label(draw, (329,y+370), 'Tree branches', 19, accent)
    for group, top in [('skills', y+245), ('branches', y+407)]:
        for i,(key,path) in enumerate(data[group].items()):
            cx = 374 + 125*i
            place(canvas, Image.open(ART / path), (cx-40,top,80,80))
            title = {'passive':'Passive','active1':'Active I','active2':'Active II',
                     'huntersMark':"Hunter’s Mark"}.get(key,re.sub(r'([A-Z])', r' \1', key).title())
            label(draw, (cx,top+86), title, 16, CREAM, 'ma')
    for r, (name,path) in enumerate([
        ('Idle', data['idle']), ('Walk down', data['sheet']['down']),
        ('Walk up', data['sheet']['up']), ('Walk side', data['sheet']['side']),
        ('Attack', data['attack']), ('Death', data['death']),
    ]):
        top = y+6+87*r
        label(draw,(740,top+29),name,19)
        if name=='Attack':
            label(draw,(740,top+52),'Impact  ·  02',14,accent)
        strip(canvas,draw,ART / path,(872,top,700,84),floor=True)


def main():
    manifest = json.loads((ART / 'manifest.json').read_text())
    canvas = Image.new('RGB',(1600,3210),'#182e30')
    draw = ImageDraw.Draw(canvas)
    label(draw,(36,24),'Skyhold Isles',48)
    label(draw,(396,46),'Hero art and global abilities',26,MUTED)
    label(draw,(1570,51),'2D  /  ART REFERENCE',17,'#dfbd86','ra')
    for i,hero in enumerate(ROSTER):
        hero_block(canvas,draw,102+i*547,hero,manifest['heroes'][hero])
    y=2840
    label(draw,(36,y),'Global abilities',32)
    for i,(key,title) in enumerate([('meteor','Meteor Strike'),('overcharge','Overcharge')]):
        top=y+60+148*i
        data=manifest['abilities'][key]
        draw.rectangle((15,top,1584,top+133),fill=SPRITES)
        place(canvas,Image.open(ART/data['icon']),(30,top+9,110,114))
        label(draw,(160,top+43),title,26)
        if key=='meteor':
            label(draw,(350,top+14),'Falling',16,MUTED)
            place(canvas,Image.open(ART/data['falling']),(342,top+41,115,83))
            label(draw,(490,top+14),'Impact',16,MUTED)
            strip(canvas,draw,ART/data['impact'],(555,top+4,1000,120))
        else:
            label(draw,(350,top+47),'Tower aura',16,MUTED)
            strip(canvas,draw,ART/data['aura'],(530,top+6,1025,120))
    canvas.save(ROOT/'docs/hero-art-sheet.jpg', quality=91, subsampling=0, optimize=True)


if __name__ == '__main__':
    main()
