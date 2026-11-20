# Skyhold Isles ford repairs

| i10 view | Before | After |
| --- | --- | --- |
| Full map, 1× | [Before](i10-full-before.webp) | [After](i10-full-after.webp) |
| North cave bend, native 3× crop | [Before](i10-north-before.webp) | [After](i10-north-after.webp) |
| Forked tributary, native 3× crop | [Before](i10-middle-before.webp) | [After](i10-middle-after.webp) |
| East loop, native 3× crop | [Before](i10-east-before.webp) | [After](i10-east-after.webp) |

The terrace recipe now places two sandstone culverts and a timber span over the opaque road. The middle span reaches across both branches. All four map resolutions share the same placement in layout pixels. Gate A, gate B and the goal use separate transparent foreground crops at 2× and 3×. All six gate rectangles clear the repairs.

Decoded-pixel comparisons against the branch base found zero differences outside the three local repair regions on every tier. Both pre-existing bridges also matched pixel for pixel. The shipped 3× map is 1,236,682 bytes. In Chromium, holding the 3× requests kept the 2× map and its three gate fronts together. Releasing them loaded the 5538 × 2556 map with front widths of 624, 562 and 465 pixels.

## Animation coverage

Pink shows where a movie can paint over the map. Each row shows the original mask on the left and the shipped replacement on the right.

| Island | Affected animation cells |
| --- | --- |
| [i02](i02-animation-mask-before-after.webp) | Lifting-span outflow, trestle current, pilot boat and trestle banner. The banner lies entirely inside the protected trestle rectangle and now shows its static painting. |
| [i04](i04-animation-mask-before-after.webp) | Trestle tailwater and spring outlet |
| [i06](i06-animation-mask-before-after.webp) | South lagoon wash |
| [i07](i07-animation-mask-before-after.webp) | Between-arches current |

The audit covered all 232 layered WebPs on the 25 layouts. Samples at intervals of up to four layout pixels followed the paths and both shoulders on all four map resolutions. The land masks and crossing recipes identified rivers, channels and ravines for visual inspection. The moss stepping stones on i04 stand above the water. The gangway and plank span on i06 meet dry approaches. Neither showed the translucent overpaint found on i10.

All 50 shipped animation masks were checked in world coordinates, including all four bilinear taps on the compact atlas. Both i10 cells, `bridge-tributary` and `east-terrace-channel`, already cleared the protected geometry.

<details>
<summary>Bridge art prompts</summary>

The built-in ImageGen used the existing i10 stone bridge crop as its style reference. The compositor uses the resulting keyed WebP props in the terraces biome kit.

**Stone**

Create one isolated horizontal bridge sprite for this original illustrated overhead tower defense map, using the supplied existing bridge crop only as style, palette and camera reference. Output genuine transparent background. One short rustic sandstone culvert with muted warm honey-grey chipped slabs, irregular large rectangular paving, delicate hairline cracks, tiny moss in crevices, a low curb of stout rectangular stone blocks along each of the two long sides and a little dark recessed arch shadow on the lower long side. Its road runs exactly left to right and is open at both short ends, centered and level horizontally, viewed almost straight down like the reference. Keep its silhouette a near rectangle 1.65 times as wide as tall including sides. Match the subdued sunny paint, fine umber edge strokes and soft watercolor/gouache brushwork. No surrounding landscape, plants, dirt, water, detached shadow, lettering, or other objects. No dramatic perspective or high walls. Deck solid and fully opaque. Generous empty transparent margin.

**Timber**

A single isolated original illustrated timber bridge sprite, seen directly from overhead for the game map in the reference. Match the reference's muted sunlit storybook brushwork, simplified shapes, fine dark umber lines and palette. Traffic goes exactly LEFT TO RIGHT. A long rectangular deck, 2.6 times as long as it is wide, made of solid snug faded chestnut oak boards laid across the width (their seams oriented vertically in the image). Rustic low rope handrails along the upper and lower long edges, thick wooden capped posts at each end and one at the midpoint of each rail. Slim darker timber beam beneath the lower rail. The silhouettes and details must read well at a rendered height of 70px. Orthographic overhead like the reference, no angle or vanishing point, flat rectangular walkable deck with open straight short ends, not a side view. Isolate the prop on true transparency. No terrain, water, road, text, cast shadow on background or other props.

</details>
