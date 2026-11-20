# Ballista specialization source paintings

The built-in image generator supplied both 1536×1024 atlases. Each lossless source atlas contains the static workshop in the first cell and the five turret facings after it.

## Shared turret and workshop prompt

Use case: illustration-story. Hand-painted storybook game sprite atlas for original Skyhold Isles, a whimsical floating-island tower defense game. 1536×1024 landscape with precisely THREE columns and TWO rows, SIX square cells, invisible grid. Every cell isolated on pure flat chroma magenta #ff00ff, no floor shadows or decor outside silhouette, center within its cell, generous margin, no words or dividers. TOP LEFT: one complete squat two-storey fortified workshop with DOOR and WINDOWS, fully enclosed tall walls, empty timber roof deck to mount a separate rotating head, circular pale stone ring foundation in perspective. NOT a bare foundation. All other five cells show ONLY the separate rotating launcher on its little turning foot. EXACTLY SAME launcher head and size rotated about vertical axis in each cell with same camera elevated about 32 degrees. TOP CENTER points bolt-tip directly south TOWARD VIEWER. TOP RIGHT points bolt tip diagonally DOWN-RIGHT (southeast, the tip is in foreground); BOTTOM LEFT points horizontally RIGHT (east), clear side profile with forward tip farthest right; BOTTOM CENTER points diagonally UP-RIGHT (northeast), observer sees breech nearest, tip far and to right; BOTTOM RIGHT points straight UP toward far side AWAY from viewer (north, see back, bolt-tip near top edge). Loaded bolt has SINGLE clear forward point visible in all views. Draw the full weapon and shaft and both ends of its bow in each cell, no cut-offs. Original chunky gouache painting with strong dark warm outlines, bright upper-left light and rich contrasting brush colors, readable at 80px on grass. No people.

## Laneweaver Loom prompt ending

Laneweaver Loom is a weaver’s timber guildhall on a circular stone foundation, with handwoven indigo banners bearing a white shuttle pattern, ochre wood, visible ivory thread spools beside door; spacious empty flat roof. Its turret is an enchanted loom that shoots a long slender pale steel-tipped shuttle, the horizontal bow is a broad curved sweep of pale ashwood with a conspicuous taut ivory silken bowstring, indigo wrappings and two small ivory thread bobbins next to the breech. Clearly readable long slender loaded shuttle and graceful swept bow shape.

## Anchor Winch prompt ending

Anchor Winch is a compact harbormaster’s tower of blue-gray stone and weathered dark timber on the pale stone foundation ring. Rust-orange sloped awning above a sea-green door, an anchor relief on the front wall, a hanging mooring chain, open flat timber roof deck. The separate rotating turret is a stout teal-and-rust sky-dock harpoon winch with a visible coil of dark chain on a wooden drum between its two short stout steel bow arms. Carries a single massive dark iron harpoon bolt with a bright silver barbed two-fluke triangular point. The tip is the front. Express the character of a salvage crew's heirloom. Bold clean stout silhouette, strong deep teal color block with warm copper fittings.

## Registration

Run `/usr/bin/python3 tools/sprites/pack_specialization_turrets.py` from the checkout. The five foot and tip pairs in `ballistas.json` register each turning base on its workshop deck and each projectile origin on the painted point of its shuttle or harpoon. Both portraits use the southeast facing.
