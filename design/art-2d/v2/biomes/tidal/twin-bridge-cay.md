# Twin-Bridge Cay

A pilot watches the upper channel from a tiled lookout beside the north entrance. Her chart rests on a barrel at the foot of the stairs. A blue rowing boat waits between the crossings. At the keep a fishing smack ties up alongside the net loft, where cork floats and creels hang out to dry.

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i02
/usr/bin/python3 -B tools/map-compose/test_ground.py
```

The two decks follow the existing road centreline. The `archBridges` recipe shears the deck and clips the piles where the bank covers them. The curb depth includes the full near beam. Both landings are flat paintings with their own waterline detail. The shore test samples the bow, middle and stern of each hull over water and the shore end of each gangway over land.

## Source paintings

The built-in image generator supplied the original paintings. All positions use the island’s 1846 × 852 layout coordinates.

| Source | Painting brief and preparation |
| --- | --- |
| `terrain-i02.webp`, `land-i02.webp` | Paint a blue-green tidal channel following the supplied shoreline guide, with a broad estuary below the keep. Use visible pebbles in the shallows, short stretches of honey-coloured quay blocks, weathered grass and drifts of sea thrift. Fit the lip to the jetties and the complete footprints of the three shoreline plots. The mask follows the finished waterline. |
| `landmark-trestle.webp`, `landmark-lifting-span.webp` | Paint two horizontal timber bridges viewed from above and south. Give the first a cross-plank deck, rope-wrapped bollards and braced trestles. Give the second an iron-strapped lifting leaf, a small hand winch and tarred piles. Register each deck to the lane width and set its piles under the bearer in the deep channel. A separate painting provides the northern bridge's brass pilot light and wave banner. |
| `landmark-pilot-jetty.webp`, `landmark-smack-landing.webp` | The blue pilot boat holds two oars and ties up at a short grey jetty on the west bank. The larger green fishing smack carries a furled ochre sail. Two lines run to the landing that reaches the net loft on the east bank. Keep the ripple marks close to the hulls. |
| `landmark-net-loft.webp`, `landmark-pilot-lookout.webp` | Paint a terracotta-roofed net loft with green shutters, drying net and wicker creels. The pilot's timber lookout overlooks the other end of the channel. Include a brass telescope, folded chart, climbing flowers and a teal pennant. |
| `pilot-gate-s.webp` | Fit timber jambs and a carved scallop keystone to the original shell-limestone cave. A copper lamp hangs beside the portal. Register the dark opening to the shipping actor mask. |
| `tex-shell-road.webp` | Paint a compacted sandy cart lane with broken shell grit and patches of worn cobbles. Reduce the stone scale and warm the gravel to match the limestone. The compositor quilts the cuttings at brush scale. |
