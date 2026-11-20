# Mortar specialization sheets

The built-in ImageGen tool produced each 1536×1024 atlas from the shared prompt followed by its branch paragraph. The lossless atlas files retain the magenta source for repacking.

## Shared prompt

Use case: illustration-story. A production painted game sprite parts sheet. Landscape 3:2, exactly three columns and two rows of equally sized invisible square cells on perfectly flat solid #FF00FF magenta. No labels, grid, floor, exterior shadow, smoke clouds, text or detached bits. Keep each component completely inside its own cell, with generous magenta gutters. Top left is the only BUILDING BASE, on a wide low circular foundation of warm tan flagstones seen as a horizontal ellipse, clean bottom arc. Top middle, top right, bottom left, bottom middle each show ONLY THE SAME detachable magical launcher assembly in four poses, centered and identical scale with a little foot pivot bottom center. Bottom right EMPTY. Chunky original hand painted storybook fantasy, broad gouache planes, firm dark outlines, warm upper left light, 3/4 high side view from 28 degrees above, very legible at 75px. The mouth points diagonally upward and RIGHT in all four poses. No operators.

## Cinder Kiln

Cinder Kiln. BASE is a squat honey-brick pottery kiln with a dark arched fire-door glowing vivid orange, wood billets stacked to left, small deep red roof tiles, top a level circular socket. CROWN launcher is a chunky terracotta crucible with black iron hoops, coal-black interior with a glowing orange rim, on a small bronze hinge foot. Deep amber glaze and embers around the lip, stubby and broad, like a tilting pot on its cradle. In idle, lean the pot to the right, with its mouth upward-right; charge it with orange heat; at release the mouth glows yellow-white with a short flame licking up from the rim; in recovery return to its warm orange glaze.

## Cloudbreak Mortar

Cloudbreak Mortar. BASE is a compact pale limestone sky observatory with deep teal tile eaves, blue weather vane motifs, a round indigo door and brass trim. Keep its top clear with a small level mounting socket. CROWN is a large fantastical upturned sky-blue enamel trumpet, on a little wooden rocker foot, with an ivory scalloped stone-flower rim, brass collar and a little cobalt pennant fastened at the base. The wide dark blue mouth looks up and right at about 45 degrees, visibly elliptical, bold fluted cloud pattern, visually reads as a trumpet throwing magic stones. In idle it rests; at charge the brass collar glows icy cyan; at release the blue-white mouth opens with a short silver star at the lip; at recovery it gently settles. No free flying projectile.

## Registration

Run `/usr/bin/python3 tools/sprites/pack_specialization_attacks.py` from the checkout. The packer uses `design/art-2d/key.py` to remove magenta. The socket, four feet and center of the open mouth in `mortar.json` use 512×512 cell-local pixels. Both sheets use the same eight-frame timing as the other full-body attacks. Frame three releases the shell. The renderer mirrors and pitches the body and its muzzle around the same stone-ring anchor.
