# Ending story art

Warden Pell’s three epilogue beats use these paintings in English and Turkish. The campaign-complete card reuses the third painting. Each key is in `paintedUi` in [the art manifest](../public/art2d/manifest.json).

| Manifest key | Painting | Scene |
| --- | --- | --- |
| `story-ending-1` | [story-ending-1.webp](../public/art2d/ui/story-ending-1.webp) | Bran, Wren and Mira watch the first gold light reach the empty Eclipse Throne. |
| `story-ending-2` | [story-ending-2.webp](../public/art2d/ui/story-ending-2.webp) | Pell lowers a spent lantern as the miller and a child greet the dawn beneath Skyhold’s keep and windmill. |
| `story-ending-3` | [story-ending-3.webp](../public/art2d/ui/story-ending-3.webp) | Two neighbors cross the rehung bridge. A copper pin holds the chain, the forge is lit, and sky ferries pass over the village. |

## Source and export

The built-in image generator painted each scene as a separate 1536 × 1024 original. The color and brushwork references were the i36 citadel dawn and the chapter-five sundial, chainwright and bridge paintings. The prologue supplied Pell, the keep and the windmill. The hero selection paintings supplied Bran’s oak shield, Wren’s blue hood and Mira’s lantern staff. [Chapter-five art direction](../design/art-2d/chapter5/islands.md) · [Hero art brief](../design/art-2d/briefs/hero-art.md)

The export follows `story-i36-outro-1`. Convert to RGB, reduce the full image to 1440 × 960 with Pillow’s Lanczos filter, and encode as a single opaque WebP at quality 93, method 5. The storybook supplies the frame, numbering and localized captions.

## Verification

All three WebPs decoded at the target dimensions. With the shipped manifest, `endingBeats` paired each painting with its EN and TR line, and `endingArt(manifest)[2]` returned the rebuilt-isles panorama for the campaign card. `npx tsc --noEmit` passed. `npx vitest run` passed 2,080 tests and skipped 19 optional DOM tests because this checkout lacks `happy-dom`.

## Generation prompts

Each scene used the following shared direction followed by its own prompt.

> Original full-bleed storybook gouache painting for Skyhold Isles, a single 3:2 landscape plate, in the house style of the existing story panels visible above. Use the references only for continuity. Render one new illustration edge to edge. Matte opaque gouache and delicate broken sepia ink on toothed paper, economical brush marks, expressive human gestures, layered atmospheric silhouettes. Make the story legible on a small card with a center crop. No lettering, borders, panel divisions, numbers, emblems of real organizations, or interface.

### 1. The eclipse breaks

> The eclipse breaks over the Eclipse Throne. The small party has just gone still, seen from behind on a fractured basalt terrace at the lower left, their heads near mid-height. Give us Bran in his green oak-leaf tabard with a round bronze-rimmed green shield, blue-hooded Wren with a white-feathered quiver, and small dark-curled Mira in vermilion carrying her lantern staff. They occupy only about a fifth of the width together. A few steps away an empty, severe black throne rises from a broken dais, the Sovereign’s fallen circlet at its foot. Beyond, chasms between jagged floating basalt isles, a hanging chain disappearing into purple cloud. Over the throne, frame a single sooty dark solar disk, about a fifth of the picture width, against a muted indigo sky. It cracks like old glass: one unmistakable fine jagged split and a sliver of yellow-gold sun at its edge. That first light grazes a succession of cliff rims and the heroes’ shoulders. Quiet awe in the moment after the battle. Match the warm and cool brushwork of story-i36-outro-1 and chapter five, deep violet dusk opening onto restrained gold. Hold the whole disk, throne and figures away from the top and bottom extremes.

The final framing pass used the first painting as the edit target.

> Revise this original gouache ending painting with one compositional change: pull well back from the three foreground heroes to make it a wide establishing shot of the ravaged floating isles. They are now three SMALL distant, entire standing figures visible from boots to heads together on a projecting spur of dark rock near the lower-left third, clearly within the picture. Tallest figure around 15 percent of the entire picture HEIGHT. Their positions cluster between 25 and 40 percent of the picture WIDTH, and between 63 and 80 percent of its height. Preserve blue hood / white quiver, green tabard / round oak-leaf shield, red cloak / lantern staff. With the space gained, let us see successive sheer floating islands emerging from cloud banks, their upper rims catching a ribbon of the first warm light beneath the great eclipse. The throne on its broken dais and the dark sun are the two biggest unmistakable shapes, both readable at thumbnail scale. Set the solar disc a little lower in the sky so its center is about 32 percent of the picture height. Preserve the dramatic single cracked dark sun and golden edge, the fallen circlet and the original violet-to-gold gouache brushwork. Full bleed 3:2 horizontal. No lettering or border.

### 2. First light reaches Skyhold

> The first light comes home to Skyhold. Return to the small hilltop crenellated honey-stone keep with red pennants and its neighboring red-capped round stone windmill with four pale canvas sails from story-l1c-intro-1. Make them large enough to recognize immediately on the same green ridge in the middle third of the composition. Human-eye-level view through a timber village doorway onto the rising meadow lane. At the left foreground Warden Pell, a brown-skinned older woman with a thick silver side braid, teal travelling coat and ochre scarf fastened with her brass compass brooch, has just pinched out the night lantern by its cap. A tiny wisp of smoke catches the light. Her face turns toward the ridge in quiet relief. On the right a flour-dusted miller steps outside into the dawn and waves back, a child in the open doorway leans out to look. Breeze fills the canvas sails and unfurls the pennants. Wildflower-covered meadow isles and their chalky undercliffs float above low, cool cloud. The rising sun outside the frame sweeps peach and honey light across the keep, mill sails and faces, with fresh greens in the meadows and dusky teal foreground shadow. Warmth and homecoming; a specific humble morning seen by its inhabitants. Closely match the painted characterization of Pell and the architecture in the prologue panels. Keep all focal points readable across the middle band.

### 3. The isles rebuilt

> The isles rebuilt, a quiet final wide panorama after sunrise. Look from a high grassy forge landing across a deep blue cloud channel between three habitable floating islands. Design the picture around a handsome, newly rehung timber suspension bridge: its intact deck leads diagonally from a stone anchorage in the left foreground across open sky to a sunlit island village near center right, BOTH landings clearly attached. A second shorter span beyond joins the village to a far isle, crossing another visible gap. The lowest loop of one heavy, mended iron chain at the near anchorage shows a fresh copper-colored joining pin; a modest stone forge with an ember-orange hearth and a curl of pale smoke sits nearby. Two small neighbors carry a basket across the span, already using it as an ordinary path. In the open blue sky flanking the village, a wooden cargo sky-ferry with a russet canvas lifting envelope and a second smaller ship make their peaceful rounds, clearly airborne, clouds visible underneath their hulls. Blue distances, butter-yellow sun on limestone, grassy orchard green, warm red tiled roofs, soft cloud shadows. Give the horizon generous breathing room, distinct island silhouettes. Stage the bridge and sky-ferry across the middle band to be readable in the campaign card. Draw on the hand-worked chains and timber landings from the chapter-five panels and the warm distant light of story-i36-outro-1. Gentle stillness, ordinary life continuing.
