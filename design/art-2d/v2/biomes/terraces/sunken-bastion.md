# Sunken Bastion

A lowered drawbridge connects the last turn of the road to the inner keep. The western arch stands in the marsh, with the stumps of a second wall closer to the keep. A worn path leads off the southern bend to the lantern the keeper lights in the outro.

## Painting briefs

The built-in image generator supplied these source paintings in a high three-quarter view, with sunlight from the upper left.

| Kit art | Prompt and fit |
| --- | --- |
| `terrain-i08.webp`, `land-i08.webp` | Paint golden-green turf, thyme and worn grass on the green areas of the bank survey. Fill the blue areas with clear marsh water, horizontal sunset reflections, broken stone, lily pads and uneven ochre reeds. Keep the exact contours of both interior pools. The survey reserves the full footprints of all 28 rings and both road approaches. Bring the eastern bank under the near drawbridge pier. |
| `landmark-drowned-arch.webp`, `landmark-flooded-piers.webp` | Build one broad pointed limestone arch with a broken merlon, a faded teal pennant, climbing ivy and a dark flood mark on its lowest course. For the second wall, paint two unequal, partly collapsed piers joined by rubble, with cattails and a few white lilies. The compositor flips and shortens each silhouette at the flood mark and displaces its rows to follow the ripples. The land mask clips the reflections at the banks. |
| `landmark-marsh-drawbridge.webp` | Paint the broad oak deck of a lowered west-to-east drawbridge. Show weathered planks, iron straps, mossy stone sills and a slack chain on a small hand winch. Leave the channel transparent between the two abutments. The near side of each abutment disappears into its bank. |
| `marsh-postern-e.webp` | Fit an incised three-window shield and a small caged votive light to the rock left of the existing timber entrance. Work ochre grass into the seams. The finish preserves the gate silhouette, posts and opening used to draw passing enemies. |
| `landmark-marsh-light.webp` | Mount a bronze cage lantern on two courses of a collapsed limestone wall. Put a closed oil flask and a wick trimmer on the lowest step. |
| `tex-moat-road.webp`, `dressing-i08.webp` | Half bury groups of small limestone setts in light-brown gritty earth with a few brick fragments. Crop the painting into irregular swatches for the road. Use a narrow worn strip to reach the lantern step and reserve that path from scatter. |

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i08
/usr/bin/python3 -B tools/map-compose/test_ground.py
```

The map regression checks the two sills, water at midspan, the width of the saved road and the ground beneath every ring and its contact shadow. A separate regression checks the reflection around a transparent arch opening and across a bank at three resolutions.
