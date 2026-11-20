# Barracks specialization sheets

The built-in ImageGen tool produced both 1536×1024 source paintings. Each prompt combined the shared direction with the paragraph for that barracks.

## Shared direction

Original hand-painted storybook miniature tower for a top-down fantasy video game. Landscape 1536x1024 production sprite parts atlas on perfect clean uniform #ff00ff magenta ground. At LEFT CENTER (building centered near x=550,y=500): one whole complete very tall slender THREE-STORY VERTICAL TOWER on a round warm stone plinth. Exact silhouette ratio requirement: base plinth is only 560 px across and entire tower including plinth must reach 900 px high. Feet at about y=950 and highest point y=50. Wide clear magenta gutters. The plinth is a shallow horizontal ellipse. Almost frontal, elevated three-quarter strategy view, can see roof surfaces and a strip of the right wall. Ground floor has a single unobstructed RECTANGULAR opening with vertical parallel jambs, dead straight-on, about half of building width, with dark shaded passage inside. No gate or door on the tower itself. At RIGHT CENTER (around x=1280,y=620) paint a single detached gate panel on its own, face-on, for the doorway. The gate panel will be separately cut and resized. Feature absolutely no other parts or objects, text, scenery, captions, ground, outside shadows or people. Painted with softly blended gouache volumes, thick sepia shadow lines, broad clean stone/siding shapes and chunky details capable of reading at 80 pixels high. Warm light from upper left. Create a strong asymmetrical silhouette but clearly vertical, no wide wings.

## Gateward Hall

Gateward Hall is the shield guild's tall square citadel. From the top downward: lofty crenellated crown inset with shadowed watch windows, a large vertically hanging deep royal blue shield-shaped banner bearing a single bold golden sun, overhanging sandstone floor with small slate blue roofs at its shoulders, then a bronze-banded open gate in an ochre limestone base. Tiny flanking blue shields on the parapet. Tower tall and commanding, a single slender keep rising high above the foot, at least twice the height of the gate. Right component: rectangular bronze portcullis alone, with four thick golden-bronze vertical bars ending in broad spear tips and two horizontal riveted crossbars, NO solid door behind the bars. Chroma magenta in the gaps. Do not make a sprawling fortress.

## Briar Lodge

Briar Lodge is a woodland watchhouse of leaf-green shingles and dark carven wood. A three-story TALL NARROW WATCHTOWER, with a steep copper-capped peaked roof, russet pennant and small lookout dormer above a projecting timber-framed upper story, then a cream gable with two crossed iron billhooks mounted on it, then stout carved oak pillars around the ground-floor open door. Ivy curls up the sunlit right wall. Hand-carved thorn motif on the bargeboards. Dried herb bundles on side wall, few bold shapes. Just a single narrow tower; no sprawling longhouse. Right component: one rectangular rustic double barn door, solid honey-coloured upright timber planks with a central seam between two equal rectangular leaves, each on two dark iron hinge straps, ornamental black iron details scaled bold. No latch crossing the seam, no frame around the panel, no steps. Front view, level horizon.

## Packing

Run `/usr/bin/python3 tools/sprites/pack_specialization_attacks.py barracks` from the repository root. The adjacent lossless source atlases preserve the magenta backdrop. The packer keys the building and gate separately with `design/art-2d/key.py`, then fits the panel to the doorway in `barracks.json`. The coordinates use source-atlas pixels.

Gateward's portcullis rises behind the lintel. Briar's two leaves swing inward on the outer jambs and darken in the passage. The doors reach their open pose on frame three, hold for a second frame while the squad exits, and close on frame seven. The building and its ring stay stationary. The portrait uses the closed pose.
