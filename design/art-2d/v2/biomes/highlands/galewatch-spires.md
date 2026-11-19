# Galewatch Spires

The western signal crew keeps its spare pennants and reels at a bench below the bridge. The lookout above the north rim flies teal, and the smaller masts on two distant summits relay the signal across the cloud bank. A path around the southern keep reaches the stair of the glass storm lantern from the outro.

## Painting briefs

The built-in image generator supplied the terrain, repairs and cutouts. All use upper-left sunlight and the battle map’s high three-quarter view.

| Kit art | Brief and fit |
| --- | --- |
| `terrain-i11.webp`, `land-i11.webp` | Follow the two surveyed rims of a cloud gorge through alpine turf. Paint pale limestone capstones, deep blue-grey faces, thyme and sunlit clouds far below. Leave the western crossing and narrow central saddle in position. Fit the rims to the full widths of the road and tower rings. Repaint the fitted central faces in angular strata, with the near bank hiding the bottom of the far wall. |
| Eastern needles in the terrain | Keep the silhouette of the three mountain needles. Plant a short red swallowtail and a taller ochre streamer on the two grassy summits. Leave the highest rock bare. Blend the masts and summit turf back into the original cloud painting. |
| `landmark-pin-bridge.webp` | Run weathered transverse oak planks between two stone sills. Add low iron corner pins, rope handrails and two small red pennants outside the walking surface. Fit the sills to the turn and end the road paint at the banks so the plank seams show the gorge. |
| `landmark-gale-lookout.webp`, `landmark-wind-stone.webp` | Cut steps into a twin limestone needle and perch a timber lookout at the top. Fly a forked teal streamer with a gold wind spiral. Carve the same spiral into a separate wayside stone, with a blue cord and flowering thrift beside its steps. |
| `landmark-flag-rack.webp`, `landmark-gale-lantern.webp` | Hang folded signal flags from an oak rail over a line reel, telescope and rope bench. For the light beside the keep, enclose a flame in thick copper-framed glass and wrap the base with a keeper’s stair. Fly its small pennon east with the other signals. |
| `tex-gale-track.webp`, `dressing-i11.webp` | Half bury irregular limestone slabs in warm mountain grit. The main road quilts small areas of that surface. A separate narrow chalk trail supplies the broken soil and slabs baked into the four service walks. The dressing mask keeps scatter clear of them. |
| `gale-postern-s.webp` | Incise the spiral into the original south-facing portal and soften its foot with small thyme tufts. Fit the finish to the original silhouette and keep the original opening along its inner edge. |

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i11
/usr/bin/python3 -B tools/map-compose/test_ground.py
```

The bridge regression samples all four pin feet and the middle of the deck. It checks the full road against the land or the space between the handrails. It also checks the ellipse and contact shadow of every saved plot against the land mask.
