# Emberglass Sanctum

The upper west tunnel raises ore. Glass cools below the lower west tunnel. The short east road serves the furnace. Its firebox occupies the rock beside the troop door, with the bellows nozzle seated in the copper socket.

## Source paintings

These original paintings were made with the built-in ImageGen tool. The briefs below identify each painted part of the i16 recipe.

| Source | Art direction and registration |
| --- | --- |
| `terrain-i16.webp` and `land-i16.webp` | Use the previous terrace as the camera reference. Paint bedded volcanic tuff at upper left, ropy cooled lava at lower left, scoria at upper right and fractured black glass at lower right. Keep the central ash floor open. Fit the southern rock lip below plots 10–12. The ash mask follows the fitted rock edge. |
| `tex-furnace-road.webp` | Paint one whole glassworks courtyard from directly above. Use worn mauve-brown and umber flagstones, fine chisel marks, narrow ash-filled joints and restrained highlights. The compositor samples the courtyard at map coordinates through the road mask. |
| `tex-firebrick.webp` | Paint ten courses of hand-laid firebrick in a running bond. Mix warm terracotta, dark rose and a few vitrified faces. The brick strip follows the east spur and ends in a transverse course before the junction. |
| `landmark-ore-whim.webp` | A squat oak mine winding drum, iron crank wheel, thick rope and small skip of copper ore. Paint broad top surfaces and short front faces for the overhead camera. |
| `landmark-annealing-rack.webp` | Three upright sea-green glass discs on a low cooling trestle, with pale handblown rims, copper feet and wooden chocks. |
| `cooling-wall-e.webp` | Use the east-facing cave painting as the reference. Fit pale firebrick masonry and three glazed green tiles to its west flank. Keep the copper jambs and lintel. |
| `firebox-w.webp` | Use the same cave elevation. Build a barred coal grate into its flank with a brick arch, glowing coals and a short copper socket. Register the finished layer on the mirrored west-facing gate. |
| `landmark-furnace-bellows.webp` | A low russet leather floor bellows under an oak paddle. Point the nozzle away from the viewer toward the upper right, with the handles toward the lower left. Fit the nozzle into the socket and keep the paddle clear of the emerging lane. |

The two wall finishes use the source gate's 404 × 226 canvas after facing is resolved. The compositor takes their colour from the overlay and retains the original silhouette and opening mask for depth sorting. The courtyard, equipment and two fire baskets are baked into the four map resolutions. The foreground textures are cut from the resulting paint.

Rebuild the master, variants and native 3× pass with `/usr/bin/python3 -B tools/map-compose/rebake_all.py i16`.
