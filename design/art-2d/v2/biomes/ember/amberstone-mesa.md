# Amberstone Mesa

The market in the intro stands on the old paving between the western and northern entrances. A potter works under a striped shade, opposite a cloth merchant with a brass balance. A pack mule rests by the date palm and drinking trough. A laden cart waits at the edge of the square. Beside the keep, the signal basket holds the split wood and pitch torch for the scene in the outro.

## Rebuild

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i14
```

The island recipe in `tools/map-compose/campaign.json` sets the standing paintings by their bottom centres. The road and its three thresholds use the saved layout. The north and west gate finishes register to the measured cave sprites. The foregrounds keep the openings used by the actor depth masks.

## Paintings

The built-in image generator produced the terrain, materials and transparent scenery. The following briefs record the subjects, palette and lighting for future additions.

| Source | Painting brief |
| --- | --- |
| `terrain-i14.webp` | Steep overhead view of a red earth mesa with horizontal ochre and rose sandstone ledges at its edges. Reveal half-buried sandstone market paving in the west. A second pass followed a guide from the east rim to the southern margin, where a dry flood has left gravel bars, russet shingle and cracked silt. Match the original full-bleed framing. |
| `tex-caravan-road.webp` | Sun-washed sandstone courses, partly buried in honey-coloured sand, with fine wheel scuffs. The compositor takes staggered cuttings at the scale of the road. |
| `tex-alluvium.webp` | Flat material from a dry wash. Bands of rounded rose-grey stones, wind-rippled sand and cracked apricot clay. The southern lane crosses this deposit and joins the caravan road. |
| `landmark-cloth-merchant.webp` | Ochre canvas awning with embroidered sun rays, two pale stripes and four palmwood poles. Display folded teal and madder cloth, rolled rugs and a balance with brass pans. Front left aerial view. |
| `landmark-potter.webp` | Seated potter in a teal tunic, working a jar under a red and cream striped shade. Finished jars stand on the bench beside the wheel. |
| `landmark-date-trough.webp` | A date palm shades a long, low sandstone watering trough. An earthenware pitcher stands on its lip. |
| `landmark-pack-mule.webp` | Resting grey-brown mule with a rolled blanket and loaded panniers. Lower its head to a woven feed basket beside a hitching post. |
| `landmark-pot-cart.webp` | Chocked two-wheeled handcart carrying amphorae, a grain jar and a turquoise ewer secured with rope. Point its drawbars towards the viewer. |
| `landmark-signal-basket.webp` | Open iron basket on a stepped sandstone plinth. Split wood and a pitch torch stand ready for the evening signal. |
| `landmark-beacon-footing.webp` | Flat, ash-stained flagstones under the basket. A shallow worn step and loose charcoal mark the keeper’s working area. |
| `sun-gate-s.webp`, `cloth-gate-e.webp` | Repaint the original south- and east-facing mesa caves. Carve a sun above the northern arch, hang saffron cloth and paired brass lanterns beside it. On the western buttress, tie a rolled awning with teal cord. Register the jambs and lintels to the original entrances. |

`dressing-i14.webp` follows the outer shelf. Its dark areas reserve the exposed cliff faces from loose stones and shrubs. All freestanding paintings use upper-left sunlight and retain their painted alpha.
