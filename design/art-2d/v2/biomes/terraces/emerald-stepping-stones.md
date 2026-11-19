# Emerald Stepping Stones

The spring rises inside the eastern bend. Its stream passes under a clapper bridge, through the stepping stones and under the lantern bridge on its way to the waterfall. The grove from the intro stands south of the stream. The keeper tends the fire beside the castle in the outro.

## Source paintings

The built-in image generator supplied the paintings. The finished kit uses a common light from the upper left. The terrain, measurements and placements are in the island’s 1846 × 852 layout coordinates.

| Source | Painting brief and placement |
| --- | --- |
| `terrain-i04.webp`, `land-i04.webp` | Follow the surveyed stream from the cleft to the western edge. Paint two shallow waterfalls, amber gravel in the shallows, mossy limestone shelves, white saxifrage and open pasture. Register the banks around the complete footprints of plots 8, 9 and 13. The mask traces the waterline in the fitted painting. |
| `landmark-rope-span.webp` | Paint a north–south suspension bridge with rope lashings, four timber posts and brass oil lanterns outside the walking surface. Its upper posts stand on the ledge above the whitewater. The lower pair sits on the near bank. |
| `landmark-moss-steps.webp`, `landmark-clapper-span.webp` | Paint four separate broad, low stepping stones with wet edges. For the next crossing, set three long limestone slabs on squat piers. Both paintings follow the angle of the road. The compositor ends the gravel at the bank and casts a short shadow beneath each crossing so the water shows between the stones. |
| `landmark-emerald-oak.webp`, `landmark-blossom-drift.webp` | Bend an old flowering oak around a cluster of translucent green crystals. Keep the roots visible. Place a broken crescent of fallen petals, limestone chips and three worn pavers beneath the canopy. |
| `landmark-lantern-shrine.webp`, `landmark-grove-beacon.webp` | Give the eastern shrine a little lit doorway, offering dish, birch and steps facing southwest. Set the keeper’s iron fire basket on a low drum beside split wood. Bake two narrow approaches from a separate painting of irregular, moss-bound pavers into the terrain. The paths lead to the shrine steps and round the keep to the fire. `dressing-i04.webp` keeps scatter off both walks. |
| `grove-postern-e.webp` | Paint small mineral outcrops, saxifrage and an offering bowl among the roots and moss on the entrance mound. Fit this finish to the rock left of the original oak jambs. |
| `tex-pilgrim-road.webp`, `silver-birches.webp` | Half bury warm limestone and occasional slate in compacted pilgrim-road gravel. Quilt sections of the surface and soften the shoulders. Paint three slender young birches with an open canopy and fern at their roots for the field edges. |

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i04
/usr/bin/python3 -B tools/map-compose/test_ground.py
```

The crossing regression checks the four rope posts and both ends of each stone crossing against the bank mask. It also checks open water at midspan and dry turf under every tower ring and its contact shadow.
