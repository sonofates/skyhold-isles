# Phase B handoff

Three Master islands are playable by ID. The registry appends `NEW_ISLANDS` once. Phase A owns the chapter ordering. I verified the intended sequence separately by playing the Normal simulator from a fresh save-equivalent inventory, carrying earned XP and stars forward.

| ID and island | Position | Waves | Pads | Normal first clear |
| --- | --- | ---: | ---: | ---: |
| i25 · Galeglass Orrery | After i15 | 12 | 19 | 11/22 lives, 2★ |
| i26 · Cinderlift Terraces | After i25, before i16 | 13 | 18 | 10/22 lives, 2★ |
| i27 · Wickweavers’ Strand | After i23, before i24 | 13 | 20 | 10/22 lives, 2★ |

The same run cleared i15, i16, i23 and i24 with 13/22 lives each. In the shipping registry’s append order, all three new islands earned the same first-clear results. The weak Normal builds lost on all three.

## Maps and story

- At the orrery, two survey parties follow opposite arcs around a brass instrument before the road hooks toward the keep. A dislodged blue glass plumb bob holds the next weather chart in doubt. Cloud shadows and gusts pass over the silver oats. [Map painting](../public/art2d/map-i25-layered@1x.webp)
- At the cinderlift, two quarry entrances feed a haul road that descends in steps. A tender needs time to land the last bucket of glass sand. Dust crosses the open yard and heat shimmers on the sand. [Map painting](../public/art2d/map-i26-layered@1x.webp)
- At the ropewalk, an upper towpath doubles back past the winding jack. Ferry traffic joins its last stretch. The weavers finish the wick that will carry the orchard’s flame to Lastlight. The shore has separate grass and tidal masks. [Map painting](../public/art2d/map-i27-layered@1x.webp)

The built-in image generator painted fifteen source assets. Each island has a terrain plate, four-object transparent atlas, road texture, and separate intro and outro panels. The compositor uses the first cutout as a landmark and places the other three as scenery. The biome kits retain the atlases and their cutouts. The runtime has the master maps, 1×, 1.5× and native 3× variants, depth-sorted gate fronts, map tokens and both panels per island. [Production prompts and kit links](../design/art-2d/new-islands/islands.md)

English and Turkish cover the names, subtitles, wave titles and narrated story beats. The painted wave preview displays the bilingual titles. The first two islands draw from the Stormcrown roster. The strand uses all four Bell & Lantern specialists.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Vitest, capped at two workers | 1,832 passed, 15 skipped in the two optional DOM suites |
| Balance | Passed across all 44 2D and legacy entries, including Normal runs with alternate heroes, seeds and HP variation |
| Difficulty | Passed all verdicts across 28 islands. Hard lost i25 and i26, and cleared i27 with 7/22 lives and 1★ |
| Item and economy simulation | Passed with two workers across 28 islands. The selected belt cleared Normal with 165 net lives lost against 228 without items. It increased Hard clears from 15 to 20 |
| Production build | Passed |
| Plot and asset checks | All 57 pads passed the compositor’s checks for scenery, gates, road clearance, spacing and reach. Layout tests found zero covered plots at 1280×800 and 932×430. The new asset tests verified both gate-front tiers, every map resolution and the exclusion masks at path vertices and pad centres |

To reproduce the map bakes, run `python3 tools/map-compose/rebake_all.py i25,i26,i27 --jobs 1`. The existing `gen_sway_mask.py` handles i25 and i27. The new surface generator rebuilds the Cinderlift haze and the ferry water. [Surface mask generator](../tools/map-life/gen_new_island_surfaces.py)

The terrain and registration changes required shared edits in the compositor recipe, art manifest, registry, translations and story lookup. The wave-card mount and renderer received the localized title. The sim reports and tests account for the enlarged campaign and distinguish the Bell & Lantern roster from the two new Stormcrown islands. The plot checker gained a mode scoped to this delivery.

## Open browser QA

Six battle screenshots and the live HUD overlap check remain outstanding. The workspace rejects a loopback listener. Chromium also exits during startup with `shutdown: Operation not permitted`. The preview wrapper and browser launches have ended.

This command opens one Chromium, visits just the three new islands and captures each battle at both requested sizes after towers and enemies appear.

```sh
python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs --new-islands
```

The destinations below are reserved for the pending captures.

| Island | Desktop | Landscape phone |
| --- | --- | --- |
| i25 | `docs/new-islands-shots/i25-1280x800.jpg` | `docs/new-islands-shots/i25-932x430.jpg` |
| i26 | `docs/new-islands-shots/i26-1280x800.jpg` | `docs/new-islands-shots/i26-932x430.jpg` |
| i27 | `docs/new-islands-shots/i27-1280x800.jpg` | `docs/new-islands-shots/i27-932x430.jpg` |

## Delivery

The supplied checkout has a read-only `.git` mount. The changes are present in its working tree. The commits use the requested author and branch name in a separate local Git directory, based on `fa1a6d86`. The bundle in `qa-out/new-islands.bundle` carries those commits for import into a writable checkout with that base. No push occurred. The requested `/root/work/new-islands.done` marker is outside the writable roots and remains pending.
