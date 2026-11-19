# Windmill Switchback

The harvest runs from the west cornfield to the threshing floor inside the first hairpin. Tied stooks stand in the cut strip south of the mill. A cart waits at the east field. The jackdaw on the scarecrow's sleeve links the scene to *Scarecrow's Gambit*, the tenth wave.

The new sails and grain shed occupy 181 layout pixels of height. The mill stands 55 pixels farther south, so the tower on the inner north bend has room behind the sails. A flat, tapering apron grounds the doorway. Its western stones lead toward the wagon road. The seven fields have an exclusion mask for loose scenery and ground decals. The two fields nearest plots 0 and 13 narrow at their inner edges.

The wheel ruts follow the existing road spline. Small offset swatches of the loam painting keep the stones in scale with the cart. At the shoulders, field soil shows through in irregular patches. Both entrance jambs and the east keep retain their saved positions.

Rebuild the four map textures and their gate fronts from the checkout root.

```sh
/usr/bin/python3 -B tools/map-compose/rebake_all.py i05
```

## Source paintings

The built-in ImageGen tool produced these eight paintings. The finished kit keeps the generated alpha on the freestanding objects and the floor.

### terrain-i05.webp

Repaint this extra-wide original storybook tower-defense battlefield terrain plate, preserving its exact framing, aspect and registration. The flat bright yellow polygons are placement guides. Replace only these guides with lovingly brush-painted patches of ripe wheat in oblique aerial view, at the scale of individual thumb-sized kernels in this miniature landscape. Upper west large parcel: standing tawny golden ears bend in softly curved diagonal furrows, broken with a few muted russet poppies and short harvested swaths. Southeast: contrasting direction of curving wheat rows, partially reaped and with cut stubble. The three small parcels are a mix of stubble and late wheat. Densely painted irregular natural borders where stalks trail off into low olive and warm earthen headlands. The surrounding terrain between the fields is quiet ochre pasture. Varied low-relief marks, ochre shadows, cool olive at the stems, wheaten sunlight. Warm gouache, broad readable shapes, thin dark ochre contours. No hard polygon outlines or yellow guide remaining, no fences, bundles, trees, paths, buildings, people, sky, text, circles or UI. Full bleed.

### landmark-harvest-mill.webp

Original hand-painted storybook tower defense landmark sprite, transparent background with generous padding, view steeply down at a three-quarter angle onto a single working flour windmill. A squat tapering warm limestone tower with courses of stone near the ground, honeyed plaster and small arched open door facing lower left, dark oak trim, a copper-red shingled cap. Four distinct expressive windmill sails in an X on a common hub with weathered oatmeal sailcloth laced to dark wooden lattice spars. One partly reefed sail exposes the ladder at its tip. Small attached lean-to grain shed under a red tile roof at right, two tied flour sacks by the door. Entire design compact and readable like a painted miniature, silhouette roughly square and a bit taller than wide, perspective with visible roof planes. Clear inked dark umber edges, matte warm gouache brushwork, broad planes of light upper left and shade under eaves. No ground tile, landscape, cast shadow, people, lettering, labels or surrounding scene.

### landmark-threshing-floor.webp

Original storybook game ground decal painted in warm gouache, with a truly transparent background. Broad, narrow, slightly irregular oval patch of old threshing-floor paving viewed from steep overhead three-quarter angle, about three-and-a-half times wider than tall. A worn central bed of flat staggered ochre sandstone setts with uneven shapes, cracked joints full of fine earth and straw, the western end narrows to a short spill of four half-buried walking stones, the eastern end widens into a small roundish working apron for a stone windmill. Edges dissolve into loose individual stones and earth. Soft warm brown lines, quiet desaturated buff limestone dusted with flour, sunlight upper left. The flat paving itself is the whole subject, silhouette compact, no lifted platform, no thick border, no tall object, no building, no tools, no signs or text, no grass lawn, no cast shadow. Entirely flat low contrast surface, seen from an aerial game camera; generous padding.

### harvest-loam.webp

Seamless-looking broad landscape surface painting of the surface of a well-used medieval harvest wagon lane from straight overhead, used as a texture under a curved road mask for a hand-painted fantasy storybook landscape. Fill the whole wide frame with sunbaked ochre-brown and sienna loam. Many small irregular angular warm grey stone chips half submerged in packed clay, subtle brush-shaped copper dry patches and ochre dusty areas, small occasional broken straw splinters. Keep the largest single pebble less than half a percent of the image width. Small curved shrinkage cracks in scattered pockets. Restrained contrast, mostly calm road earth. Tiny crisp gouache strokes and rubbed broken ochre-ink edges give material texture at close zoom. Broad even daylight, no big shadows. No road edges, horizon, linear ruts, paths, arrangements, tessellations or plants. No objects, no text. Extra-wide full bleed texture plate.

### landmark-sheaf-cart.webp

A single original storybook game scenery sprite on transparent background: a weathered two-wheeled oak harvest cart laden with ochre cut wheat sheaves tied with russet cord, two chunky dark spoked wheels with iron tyres, long wooden shafts pointing down-left resting on the ground. A rolled brick-red blanket over the near rail gives it a distinct color accent. Steep overhead three quarter camera from the front, wooden bed and one wheel visible. Compact silhouette and bold simple shapes clear at a 75-pixel game height. Warm gouache with subtle inked umber edges and softly shaded painted volumes, sunlight upper left. Full object isolated with padding. No horse, no people, no ground patch or platform, no text or shadow.

### landmark-crow-keeper.webp

Original 2D hand-painted storybook tower defense scenery sprite on a transparent background. An original single scarecrow made by a wheat farmer, a small crooked alder crosspiece on one narrow planted stake. A faded indigo-blue work smock suspended from the crosspiece, a twisted maroon neckerchief, an old straw sun hat over a simple blank burlap sack for a head, with a little black jackdaw perched on one sleeve. Sparse tufts of straw poking from each sleeve. The crossbar tilts a little. Quiet, weathered and charming. One small peg at the base, no ground tile. From a steep three-quarter overhead angle. Reads as an inanimate farm implement with a strong blue and ochre silhouette, not as an armed or moving creature. Warm matte gouache, clear dark umber contour, grouped light and shade in broad readable forms, sun from the upper left. No text or border.

### autumn-apple.webp

Original 2D hand-painted storybook tower defense scenery sprite on a transparent background. A single old small orchard apple tree in late autumn, with a gnarled leaning forked trunk, grey brown crooked branches revealing the architecture of the tree, a loose asymmetric umbrella crown of russet, muted olive and dusty honey-colored leaves and just a handful of ripe red apples. A tiny group of three windfall apples tucked at the root on the right. The trunk is wide enough for legibility. Steep three-quarter overhead view of the full tree and trunk as a compact miniature. Fully contained cutout on transparent background. No ground platform, lawn, crates or fence. Warm matte gouache, clear dark umber contour, grouped light and shade in broad readable forms, sun from the upper left. No text or border.

### landmark-stooks.webp

A single compact group of freshly harvested wheat in a storybook farming landscape, painted game sprite on transparent background. Two leaning stooks made from several ochre wheat sheaves stacked together upright like little conical tents with their cut ends splayed on the ground, one older straw hummock behind and one loose tied sheaf lying diagonally in front. Dark rust twine, grain-head textures near tops, matte weathered straw. No crates, no hay bales, no fence, no farmland ground tile. Aerial three-quarter game perspective. Entire group grounded and framed with air around the silhouette. Original hand-painted gouache, grouped warm ochre highlights, russet shadow, finer dark contour than a UI icon. Soft sunlight from upper left. No text.
