# Archer specialization source paintings

The built-in image generator produced the two magenta source atlases. The prompts below share the same layout instructions. Both atlases are preserved as lossless WebP.

## Shared prompt

Use case: illustration-story. Create one professional production sprite atlas for original painted 2D storybook tower defense game Skyhold Isles. Landscape 3:2 canvas, exactly three equal columns and two equal rows of square cells. Flat solid chroma magenta #ff00ff background throughout, no dividers, captions, labels, shadows on background or ground plane. SIX separate cutout illustrations centered inside their respective cell with margin. TOP LEFT cell: isolated static tower body, empty open platform for an archer, no operator, no gun or bow on top, standing on a circular ring of large pale weathered stones (ellipse width to height ~3:1), nothing beyond ring. All other FIVE cells show ONLY the same archer operator, feet and whole body and nocked bow visible, camera elevated overhead 30 degrees, exactly same pose and height but turned to aim in five directions. TOP CENTRE = faces and shoots straight TOWARDS viewer (south); TOP RIGHT = faces and shoots down-right towards viewer (southeast); BOTTOM LEFT = shoots horizontally RIGHT (east), BOTTOM CENTRE = shoots upper RIGHT, back 3/4 visible (northeast); BOTTOM RIGHT = faces and shoots straight AWAY (north), viewer sees back of hood and quiver. Show pointed arrow mounted at drawn bow for muzzle registration. Characters same large size filling each cell individually, will be shrunk separately to stand on tower platform. Cozy brushed gouache, bold dark brown edge lines, chunky forms and clear silhouettes at miniature scale, warm light from top-left, olive and amber. No floating loose parts, no magenta inside art, no printed symbols, no gridlines.

## Farwatch Lodge prompt ending

Farwatch Lodge is a lofty, slender stone-and-timber archer keep with a long tapered navy swallowtail banner bearing a honey-gold eight pointed star, brass observer's telescope attached to side wall, ochre plank top deck. Operator: ONE elegant navy-hooded amber-caped longbow sharpshooter, tan boots, dark timber longbow with golden tips.

## Swallow Roost prompt ending

Swallow Roost is a broad squat treehouse archer lodge with layered russet shingle eaves, forked timber brackets, cream swallow-bird carved into lintel, hanging double forest-green pennants, spacious empty round timber roof deck. Operator: ONE nimble stout ranger with green hood, bright rust-orange short cloak, conspicuous fan of ivory feather fletchings at back, compact golden recurved shortbow.

## Packing

Run `/usr/bin/python3 tools/sprites/pack_specialization_turrets.py` from the checkout. The packer uses `design/art-2d/key.py` and `archers.json` to key each cell, place each operator by its feet, and register the release point at the foreground arrowhead. Swallow Roost places a second copy of the ranger behind the first on the wider deck. The southeast composite supplies the codex portrait.
