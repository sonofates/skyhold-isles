# Stormcrown Citadel

The brass dial on the north ridge and the signal basket above the eastern war road carry two details from the island's story panels into battle. The basket holds dry billets. The keeper lights the fire in the outro.

The original altar site between two tower pads leaves room for a dial only 46 layout pixels high. The ridge lets it stand 90 pixels high. The watch fire is 115 pixels high on the east shelf. The old southeast standard stood behind the phone's wave banner.

## Source paintings

The built-in ImageGen tool produced six original paintings. These briefs record the prompts and how each painting is used.

| Painting | Prompt and use |
| --- | --- |
| `landmark-watch-dial.webp` | Paint a squat limestone weather dial on an octagonal slate foot. Give it a bronze triangular gnomon with a curled cutout, eight-point compass rose, two cracked steps and a short cast shadow. Use upper-left sunlight and a steep overhead view. Isolate the complete silhouette on transparency. |
| `landmark-watch-beacon.webp` | Put an unlit iron cresset full of pale split billets on a block-built slate platform. Put the wood store below the platform and fly a short saffron-and-teal pennant beside the basket. Use a steep three-quarter view with readable stone steps, five large iron bars and warm lichen highlights. Isolate on transparency. |
| `terrain-i13.webp` | Use the original plateau as the framing reference. Paint storm-washed slate bedding planes, blue-green turf, rusty bracken and silvery lichen. Keep the centre open. Confine the broken ledges to the edges and corners. The accompanying `land-i13.webp` mask follows their inner lips so freestanding scenery has solid footing. |
| `slate-heather.webp` | Paint a low asymmetric cushion of rusty heather and dusty pink seedheads tapering across a small shelf of blue-grey slate. Seen from above with upper-left sunlight. Keep the silhouette irregular and isolate the whole plant and rock on transparency. |
| `tex-watch-paving.webp` | Paint a field of fitted warm-grey limestone slabs and oblong setts from overhead. Use soft taupe, ivory and small cool lichen marks, narrow recessed joints and worn corners. Cover the entire painting with paving. The compositor takes staggered swatches at the scale of the keep approach. |
| `tex-watch-arcade.webp` | Paint a straight-on elevation of three evenly spaced blind round arches in slate voussoirs, half a pier at each end, recessed navy stone and a shared coping course. Fill the entire 3:1 canvas. Each exposed span samples the painting along the south-facing road edge at constant scale. Its lower courses disappear into the slope at each end. |

The three spans lie below the northwest bend, the keep approach and the southeast cave approach. The road mask covers their coping. The same wall footprints reserve the verges for the masonry when the compositor checks plots and scatters plants. The east cave's approach leaves the sill along the road tangent.

Rebuild all four map sizes and the two sets of gate fronts with `/usr/bin/python3 -B tools/map-compose/rebake_all.py i13`.
