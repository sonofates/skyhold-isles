# P3 UI — painted art still needed

The P3 screens are built entirely from the existing kit (`public/art2d/ui/*`, `ui-*.webp`) plus
procedural placeholders. Each item below names the placeholder it replaces, where it plugs in, and the
size to deliver. Style: same storybook kit (warm wood, gold trim, parchment, thick dark-brown outline),
transparent background unless noted, `.webp`. Original designs only.

| # | Asset | Size (px) | Replaces (placeholder) | Plugs in |
|---|---|---|---|---|
| 1 | **Sea chart background**: painted open sea, soft waves, a few foam curls and distant cloud banks, darker toward the edges; seamless left↔right so it can tile for long routes. Opaque. | 2048×1024 (tileable horizontally), plus a @0.5x | `seaPainter.ts` (canvas washes, brush dabs, wave crests, vignette) | `.pu-sea` in `worldMap.ts` (swap the canvas for a repeating background) |
| 2 | **Compass rose** in the kit style (gold/cream points, red north) | 256×256 | canvas compass in `seaPainter.ts` | world map, bottom-right |
| 3 | **Island tokens**: one floating/sea island per isle as seen on the chart (small cliff + shore + the isle's landmark), so nodes are not a crop of the gameplay map | 384×384 each (16 + new ones) | medallion framing a circular crop of the island's own map (`islandArt.ts`) | `medal()` in `dom.ts` (`.pu-medal-thumb`) |
| 4 | **Locked island token**: the same island under fog / sea mist | 384×384 (or one generic fog overlay) | greyscale + brightness filter + drawn padlock | `.pu-node.locked` |
| 5 | **Route marks**: dotted voyage line pieces (dash, small anchor or footprints) and a ship marker for "you are here" | dash 32×16, ship 160×160 | SVG dotted path + the kit's rally flag (`icon-rally.webp`) | `.pu-route`, `.pu-node-flag` |
| 6 | **Round-button icons** in the painted icon style (like `icon-upgrade.webp`): workshop (hammer & anvil), logbook (book with bookmark), daily (sun + storm cloud), settings (cog), codex/bestiary (book with claw marks), close (X), world map (folded chart), lock, play | 224×224 each | inline SVG glyphs (`paintedIcons.ts`) | `roundButton()` everywhere, end-panel glyphs (`endPanel.ts`) |
| 7 | **Storybook panel art**: per island, 2–3 painted story vignettes (intro + outro) with characters | 960×600 each | crops of the island's gameplay map (`vignetteStyle`) | `.pu-vignette` in `storyPanels.ts`; add a `story[].art` key when the art exists |
| 8 | **Narrator portrait** (the warden character used in the placeholder beats) | 256×256 | none (speaker name only) | story caption, left of the text |
| 9 | **Storybook frame**: open-book double page or framed comic strip board | 1600×900, 9-sliceable | the ribbon board (`end-panel.webp`) | `.pu-story` |
| 10 | **Tab / bookmark ribbons** for Logbook (Islands / Feats), active + idle | 320×110 each | small wood planks with a glow on the active one | `.pu-tabs` |
| 11 | **Toggle**: painted lever or seal, on + off states | 160×160 ×2 | medallion + `icon-confirm.webp` | `.pu-toggle` |
| 12 | **Slider**: rope/plank track and a knob | track 512×64 (9-slice), knob 128×128 | ui-plaque track + button-round knob | `.pu-slider` |
| 13 | **Primary button**: a distinct "go" plank (green-painted wood or gold-trimmed) | 512×141, 9-sliceable like `ui-plaque` | `ui-plaque.webp` + CSS gold glow | `.pu-plank.primary` |
| 14 | **Difficulty gems** (Breezy / Challenging / Heroic / Master) | 96×96 ×4 | CSS diamond with outline | `.pu-gem` |
| 15 | **Rank pips** for Workshop (empty + filled) | 64×64 ×2 | CSS diamonds | `.pu-pip` |
| 16 | **Feat / rule seals**: wax-seal or medal badges for feats, plus challenge-rule badges | 192×192 per icon | round button + SVG glyph / tower sprite with a red slash | Logbook feats, Daily rules |

Notes
- Items 1, 3, 6 and 7 matter most for the look; the rest are polish.
- Everything in `paintedUi.css` already uses `border-image` 9-slices for the kit planks/boards, so a new
  board or plank only needs its slice insets measured (as done for `end-panel.webp`: 165 / 100 / 80 / 100).
