"""Overlay of a full-bleed fit dump (scripts/fullbleedDump.ts): the map at the fit, the hard
shapes (plots green, gates/castle red, roads in safe area yellow), the safe area (cyan), the
must-see box (magenta), the placed HUD pieces (white) and their homes (grey dashed-ish).

    python3 scripts/fullbleed_overlay.py /tmp/fb/i07-1920x1080.json public/art2d out.png
"""
import json
import sys

from PIL import Image, ImageDraw

d = json.load(open(sys.argv[1]))
art = sys.argv[2]
out = sys.argv[3]
W, H = d["w"], d["h"]
f = d["fit"]
s, ox, oy = f["scale"], f["offsetX"], f["offsetY"]
iw, ih = d["imageSize"]
name = d["image"]
src = Image.open(f"{art}/{name}.webp").convert("RGB")
img = src.resize((max(1, round(iw * s)), max(1, round(ih * s))))
canvas = Image.new("RGB", (W, H), (40, 30, 30))
canvas.paste(img, (round(ox), round(oy)))
dr = ImageDraw.Draw(canvas, "RGBA")
X = lambda v: ox + v * s
Y = lambda v: oy + v * s
sh = d["shapes"]
sa = sh["safe"]
dr.rectangle([X(sa["x"]), Y(sa["y"]), X(sa["x"] + sa["w"]), Y(sa["y"] + sa["h"])], outline=(0, 255, 255, 255), width=2)
m = sh["mustSee"]
dr.rectangle([X(m["x"]), Y(m["y"]), X(m["x"] + m["w"]), Y(m["y"] + m["h"])], outline=(255, 0, 255, 255), width=2)
rr = sh["roadR"] * s
for g in sh["roads"]:
    dr.line([X(g["ax"]), Y(g["ay"]), X(g["bx"]), Y(g["by"])], fill=(255, 220, 0, 90), width=max(1, round(rr * 2)))
for p in sh["plots"]:
    r = p["r"] * s
    dr.ellipse([X(p["x"]) - r, Y(p["y"]) - r, X(p["x"]) + r, Y(p["y"]) + r], outline=(0, 255, 0, 255), width=2)
for g in sh["gates"]:
    dr.rectangle([X(g["x"]), Y(g["y"]), X(g["x"] + g["w"]), Y(g["y"] + g["h"])], outline=(255, 0, 0, 255), width=2)
for k, r in d["home"].items():
    dr.rectangle([r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]], outline=(150, 150, 150, 200), width=1)
for k, r in d["pieces"].items():
    dr.rectangle([r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]], fill=(255, 255, 255, 60), outline=(255, 255, 255, 255), width=2)
    dr.text((r["x"] + 4, r["y"] + 4), k, fill=(0, 0, 0, 255))
dr.text((10, H - 20), f"{d['id']} {W}x{H} shrink {f['shrink']:.3f} coverage {f['coverage']:.3f}", fill=(255, 255, 255, 255))
canvas.save(out)
