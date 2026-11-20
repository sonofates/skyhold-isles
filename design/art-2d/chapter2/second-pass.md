# Chapter two map polish

## Cloudbell Cloister and Lantern Glassworks

On Cloudbell Cloister, the cracked bell from the opening painting lies beside the ruined colonnade. Its clapper is missing and a frayed blue rope curls around the lip. The east arcade has its own arched threshold and a paved walk that ends one road width before the two lanes meet. The west entrance keeps its chalk footpath. Flowers, broken columns and capitals line the meadow.

On Lantern Glassworks, the copper furnace entrance feeds an ore road with shallow cart ruts. The glassblower’s finishing bench stands beside the kilns with three colored lanterns and a tray of cullet. The cool slate track is lighter than the cavern floor, with embedded glass fragments along the route.

The compositor reads the six source paintings from the [cloister](../v2/biomes/cloister/) and [glassworks](../v2/biomes/glassworks/) kits. The gate fronts use the measured dark openings in the painted gates. The glass road strip joins five horizontal bands of the original yard painting in alternating directions, with 64 source pixels of crossfade at each join. The final strip includes a lighter ash grade for the cavern floor. Rebuild both islands from the repository root with the saved plots.

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i17,i18 --jobs 1
```

## Paintings

The built-in ImageGen tool produced the following artwork. The two gate references were the original orchard entrance mirrored to face west, and the original east-facing hollow entrance, respectively.

### landmark-fallen-bell.webp

Use case: illustration-story. Make a single isolated isometric map scenery sprite for an original hand-painted storybook tower defense. One ancient fallen bronze abbey bell rests on its side, crown at upper left, flared dark empty mouth pointing right and slightly toward viewer. A conspicuous triangular crack splits the sunlit lip, the clapper is missing, two simple bands of embossed arch ornament, warm honey bronze worn through muted verdigris. A thick frayed royal-blue braided bell rope passes through its crown and curls once around the front of the bell on the ground. One or two small chalk rubble stones and a little moss touch the base. World view is elevated three-quarter from above, soft daylight from upper left; readable chunky gouache brushwork and restrained dark painted edge, distinctive broad silhouette to hold up when shrunk to 85 pixels. Entire sprite centered with even padding on transparent background. Include a tight contact shadow under the metal. No scenery, plinth, landscape tile, people, grass carpet, writing, border, or extra objects.

### gate-arcade-w.webp

Edit the attached isolated west-facing tunnel game sprite. Keep this exact steep overhead camera, diagonal front face, near pier at bottom right of the entrance and far pier at upper left of the entrance. The mouth is on the extreme LEFT end, and the mass of the structure extends off toward the RIGHT. Keep the dark passage entirely empty with the same left-facing and diagonally sloping sill, opening height and width, so a small walker can emerge horizontally left. Repaint the old timber into an ancient honey-ivory limestone monastery archivolt with carved courses, pale stone square jambs with worn capitals, upper sunlit carving of a bell, a tiny strip of frayed blue cloth on the outside of the near right pier. Replace the flowered rocky mound behind it with a receding ruined vaulted arcade of pale limestone ashlar, broken ribs and a tiny empty bellcote, ochre grass growing in the joints. Close-cropped small isometric game miniature, gouache storybook painting with broken warm umber edges. Entire silhouette fully isolated on genuine transparent background, no backdrop or floor, no people, text or cart. Preserve the angle of the threshold and positions of the feet of both jambs exactly as in the reference.

### tex-arcade-flags.webp

Use case illustration-story. Square full-bleed painted material swatch for the floor of an ancient open-air limestone cloister. Orthographic straight overhead, absolutely flat edge-to-edge, no perspective. Ten horizontal courses of short chunky pale honey and pearl-grey limestone flags laid in staggered running bond. Each course runs left-right, about 5 to 7 irregular rectangular stones across the picture. Narrow pale ochre dusty joints partly filled flush, worn corners and slightly irregular profiles like old hand-cut chalk stone. About a fifth of the flags are nearly buried by pale biscuit-colored fine dust in soft uneven groups. Some chipped antique edges, scattered tiny smudges of sandy gold lichen. Gouache painted edges and subtle soft warm light from upper left. Keep the tonal range fairly narrow for game walkability. One continuous pavement filling the entire canvas to the very edges. No large cracks, holes, foreground objects, vegetation, lettering, border, horizon, decorative motif, or designs.

### landmark-glassbench.webp

Use case illustration-story. An isolated environmental landmark sprite on true transparent background, for a tiny production map within an original hand-painted sky-island storybook game. A glassblower’s low oak workbench, viewed steeply from above in three-quarter view, in a cool mineral cavern. Two oxidized copper uprights at the BACK of the bench support a gently arched horizontal brass rail from which hang exactly three round newly blown lanterns on short hooks: a large luminous sea-green glass globe in the middle, a smaller rich amber flask on the left and a little azure teardrop on the right. Jewel-like saturated colored glass with painted inner glints, visible overhead silhouettes, chunky readable at small scale. A long iron blowpipe rests diagonally across the worktop, a few bright teal cullet fragments lie in a small low bin at the bench's right foot. Humble warm ochre timber, blue slate shadows, upper-left soft light and slight amber illumination reflected on work surface, no theatrical glow outside silhouette. Group a compact SINGLE object, wider than tall with solid sturdy feet. Matte painted gouache surface and restrained ink silhouettes. Entire prop and feet visible with generous transparent padding. No people, towers, stone plinth, landscape, floor tile, UI, labels, text or surrounding background.

### gate-furnace-e.webp

Edit this isolated tunnel game sprite into the workers’ entrance of a glassworks. Keep exactly the same right-facing diagonal tunnel opening on the right side, completely empty, deep black, from lintel to floor. Keep the placement of the existing posts and their feet, near post at lower left of mouth, far post at upper right, so workers can step directly out toward the right under the lintel. Replace the timbers with two broad brick piers and a slender riveted copper lintel, worn pale warm ochre firebrick. Repaint the rocky mound to the left as one broad banked masonry furnace clad in cool mottled greenish copper panels nestled among dark blue cavern shale. A short copper chimney with a dark rim rises from its top near the left, distinct silhouette; a small arched AMBER glowing firebox is inset in the panel on the LEFT face of the kiln, with a simple black grate. The firing chamber is a small bright feature well away from the RIGHT black walk-through mouth. A few turquoise glassy fragments at the foundation. Steep overhead isometric game perspective as reference, chunky hand-painted gouache in a storybook, warm/cool contrast, the upper surfaces softly lit from upper left. Single squat freestanding piece, isolated with transparency, no projecting road, floor tile, scenery, people, text, smokey glow or backdrop. Keep some space around the complete object.

### tex-cullet-road.webp

Original material painting for an overhead illustrated fantasy cavern game. Wide landscape 3:2 canvas, full bleed. Entire canvas is a single close-up top-down view of the same heavily trodden crushed purple-grey shale workshop yard, flecked with ash and fine ochre dust. Broad low-contrast dark pewter/muted mauve palette, subtly lighter than a midnight teal cavern. Flat angular slate embedded flush in the dusty surface. Here and there small discreet clusters of broken SEA GREEN and AMBER glass offcuts with soft little edges of reflected light, like old glassworks cullet crushed almost flush into the ground. A low amber sweep of ash across one stretch, scattered little milky mica fragments elsewhere. No glowing gems. Keep individual painted pieces small, 0.3 to 1.5 percent of the whole image width, grown organically in irregular local groups. Readable but quiet road material beneath walking characters. Fine matte hand-painted storybook gouache, subtle ink here and there. Entire image filled with continuous ground from edge to edge, overhead with no perspective, no horizon. No tile patterns, banks, road boundaries, tracks, figures, buildings, text, drawn separators, or large gemstones.

## Lanternseed Fig and Three Pennants Head

Lanternseed Fig’s canopy keeper hangs a full basket of amber seeds over the nursery ladder. The fork stands between the upper root entrance and the hollow log. A short walk of split fig boards leads out of the log and meets the red clay on its first bend. The meadow scatter favors ferns and bromeliads.

Three Pennants Head’s pilot boat rests on rollers beside the blue streamers and the overturned hull of the shelter. The grey sleepers of its slipway run across the southern approach. The red reef entrance opens onto basalt setts from the squall kit. The yellow shelter feeds the shingle track.

Both island recipes use `timberApproach`. Its three fields select the zero-based entrance lane, the painted material and the run in layout pixels. The compositor maps the horizontal boards across the lane as it turns, stops at the specified distance or one road width before the junction, and uses the material’s color for light reflected into the doorway. Rebuild with the saved plots from the repository root.

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i19,i20 --jobs 1
```

### Source paintings

The built-in ImageGen tool produced the following four assets. The prop exports retain their generated alpha and are cropped to their painted silhouettes. The maps use the [figwood kit](../v2/biomes/figwood/) and [squall kit](../v2/biomes/squall/).

#### landmark-seed-hoist.webp

Use case illustration-story. Single isolated hand-painted environmental sprite for an original storybook sky-island game. A canopy keeper's seed hoist: a sturdy low fork of living mossy fig wood bends over a tiny elevated timber platform. One chunky honey-wicker hanging basket full of glowing round apricot-orange lantern seeds, suspended from the right arm by rope, is the unmistakable focal point. A short four-rung knotted rope ladder hangs from the left edge of the platform to the ground, spreading slightly at its foot. A red bandana tied to a post beside the ladder. Short knuckled roots, a few glossy jade leaves, two coral orchids, tight contact shadow. Compact single silhouette, fully visible on true transparent background with padding, no floor tile. Elevated three-quarter bird's-eye game view, sunlight from upper left, chunky warm gouache and broken umber edging matching lush storybook jungle scenery, broad readable forms to be seen at 90 pixels tall. No giant tree crown, person, building, words, interface or border.

#### tex-nursery-walk.webp

Use case illustration-story. A full-bleed, square, overhead flat material painting of a hand-laid nursery footway built from the broad split buttress roots and warm sawn planks of an ancient jungle fig. Across the entire picture, about 12 long HORIZONTAL boards in gently irregular parallel rows, mostly spanning the whole width with some staggered ends. Wood is weathered honey teak with tawny clay rubbed into the grain, sparser little silvery sun spots, moss clinging in a few seams, a couple of fallen coral flower petals at most. Smooth worn tops, narrow dark warm seams, small knotholes and thin uneven bark strips at the board edges. Painterly original gouache with firm broken brushwork and restrained natural colours. No perspective, bevel outline, framing timbers, handles, nails, rope, foreground objects, borders, writing or scenery. Flat playable path surface for little walking units.

#### landmark-pilot-boat.webp

Use case illustration-story. An isolated miniature environmental sprite for an original painted storybook game. A single open wooden pilot boat hauled ashore on two short tarred wooden rollers. A rich brick-red hull with one pale cream sheer stripe, an old loose ochre sail furled on an unstepped spar lying along the benches inside, two worn oars with faded turquoise blades laid athwart the gunwales. Bow at lower left and stern at upper right in shallow diagonal, broad clear recognisable almond-shaped hull seen from steeply above in three-quarter view, approximate width to height ratio 1.6. Patch of barnacles on the keel, little coil of thick rope draped over the bow. Overcast coastal gouache, lively but weathered muted colors, small soft contact shadow, crisp painted silhouette matching a stormy offshore fishing village. True transparent background, centered complete isolated prop, no ground tile, water, people, dock, flags, writing, border or scenery.

#### tex-slipway.webp

Use case illustration-story. Square full bleed overhead gouache material texture. Old coastal boat slipway in an original illustrated game. Six broad uneven-spaced horizontal parallel runs of heavy weathered grey wooden sleepers bedded deep in a mixture of small charcoal basalt and lighter sea shingle. Horizontal sleepers extend end to end across the texture with a few staggered joins. Timber worn silver and smooth in its center, warm honey brown showing through at the split ends and a little muted verdigris seaweed halfway buried in the gravel. The pebbly spaces BETWEEN sleepers about as wide as the pale boards, irregular damp slate fragments. A restrained painterly irregular surface under soft overcast daylight. Orthographic view from directly above, no perspective or edge of road, fills every pixel. No rails, big objects, boat, landscape, writing, symbols, borders, foreground ropes or lettering.
