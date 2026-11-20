# Beacon specialization sheets

The built-in ImageGen tool produced each 1536×1024 atlas from the shared prompt and one branch paragraph.

## Shared prompt

Use case: illustration-story. A production cutout sprite PARTS sheet for a hand-painted storybook sky-island strategy game. Landscape 3:2 sheet, exactly SIX equally sized invisible square cells, THREE columns TWO rows. All backgrounds absolutely uniform #ff00ff magenta, generous clear gutters. No text, grid, floor or outside shadows. Each part centered in its own cell. TOP LEFT: an entire building base, on a low, wide circular warm sandstone flagstone plinth seen as a horizontal ellipse. TOP MIDDLE, TOP RIGHT, BOTTOM LEFT, BOTTOM MIDDLE: four poses of the upper mechanism alone with a foot pivot near bottom center. BOTTOM RIGHT is empty. Only ONE base on the sheet. Same scale on all four mechanisms. Three-quarter elevated side view, looking downward 28 degrees. Saturated gouache forms, thick dark contours, large crisp shapes and warm illumination from upper left. Handcrafted fantasy miniatures that must read at 70 pixels tall.

## Tailwind Mill

Tailwind Mill. BASE is a friendly little tapered thick-walled honey stone millhouse with a dark green door, warm brick trim, an upward curling sky-blue pennant and a low teal conical roof. Small central socket on roof for wind machine. MECHANISM is a freestanding windmill on a short sturdy wood pedestal, a circular brass hub in front of it, and FOUR equal canvas-covered sails, spread symmetrically around it exactly 90 degrees apart like a pinwheel. Warm ivory cloth with a single wide ocean-blue stripe across each hem; thick golden wood sail frames. Each sail is a broad tapered quadrilateral. Rotor faces camera nearly straight on. Four poses rotate the sails CLOCKWISE on their central brass hub in small even increments from pose 1 to pose 4 (0, 22, 45, 67 degrees). First pose a diagonal X. Sails remain identical on successive turns; same hub and stand size. Keep silhouette bold and legible. No glow or magic particles.

## Horizon Lantern

Horizon Lantern. BASE is a tall narrow midnight-blue tiled lighthouse tower of ivory stone, ocean teal shutters, small brass sun emblem and a curved amber door, crowned by a dark teal flat balcony and brass mounting socket. Paint a dark trim around the round plinth for separation from grassy maps. MECHANISM is a large squat hexagonal golden lantern room with a copper domed cap, dark petrol-blue frame, prominent magnifying lens facing the viewer painted thick golden glass with turquoise ring, and a small gold mounting foot underneath. The same lantern in all four poses. First at rest: the glass glows quiet honey; second: a bright crescent glints across the left half as the Fresnel lens turns; third: warm ivory sun-star gleams across the center as the light sweeps toward the viewer; fourth: right edge still catches a golden crescent before the sweep passes. Shape is hard-edged and bold, all light contained inside lantern glass. A lighthouse for a world of floating islands.

## Packing

Rebuild with `/usr/bin/python3 tools/sprites/pack_specialization_attacks.py`. The lossless magenta atlases sit beside `beacon.json`. The packer keys the components with `design/art-2d/key.py` and exports a larger resting portrait alongside each eight-frame sheet.

Tailwind uses the resting rotor painting for the full quarter-turn. The stand mask and hub pivot keep the pedestal planted as the four sails rotate. Horizon uses the four painted lens exposures on a single registered foundation. Both animations play once on the existing beacon pulse event.
