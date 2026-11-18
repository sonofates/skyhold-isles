# Painted UI and tower art

Prepared on `codex/art-ui` for the orchestrator to commit.

## Art inventory

The 102 new WebPs registered under `paintedUi` in `public/art2d/manifest.json` cover all 16 requests in `docs/p3-art-needs.md`. The files live in `public/art2d/ui/`. The DOM reads the island tokens from this index. Keeping these images separate from Pixi’s `uiKit` avoids decoding the story collection into GPU textures when starting a level.

| Asset family | Contents |
| --- | --- |
| Chart | Two horizontally tileable sea resolutions, compass, 17 landmark tokens, one fog token, route dash, anchor and frontier ship |
| Buttons | Nine painted action icons, primary plank, two tab ribbons, two toggle seals, slider track and knob |
| Story | 37 full-bleed 960×600 paintings, Warden Pell portrait, open book |
| Progress | Four difficulty jewels, two Workshop rank pips, seven feat emblems and ten challenge seals keyed by challenge ID |

The art was generated for this project. Isolated pieces used a flat magenta background and `design/art-2d/key.py`. The book and long controls retain their full requested sizes. The sea uses an overlapped horizontal join at both resolutions. Story art is opaque for full-bleed placement.

## Screen integration

The chart, briefing and island ledger use landmark tokens. The chart also uses the sea, compass, ship and fog. The nine DOM glyphs, primary plank, tab ribbons, slider track and knob have painted references. The storybook uses the new book frame and reads an optional `art` URL from each beat. Meadow Crossing’s three intro and two outro references follow its existing dialogue. Story beats without an art URL keep the map-crop fallback.

UI source edits are in `src/render2d/ui/worldMap.ts`, `islandArt.ts`, `dom.ts`, `paintedIcons.ts`, `paintedUi.css`, `storyBeats.ts` and `storyPanels.ts`. The book uses 64 px top/bottom and 96 px left/right slices. The primary plank uses 42/64, the bookmark ribbons 23/46 and the slider track 14/48.

## Towers

Each mortar tier ships a body, five-frame strip and positioning JSON in `public/art2d/turrets/mortar-{1,2,3}-*`. The packer aligned the mechanism about its foot. The JSON supplies the ring, deck mount and per-direction muzzle. The mortar manifest entry uses these turret files in place of its baked whole-tower attack strip, which would otherwise show a second barrel while firing. The renderer retains the mortar-specific smoke plume at its measured muzzle. The aim QA entry accepts `type=mortar` in `src/render2d/main2d.ts`. The muzzle effect change is in `src/render2d/towerLayer.ts`.

The new `archer-2-body.webp` has an open deck above a low railing. Its existing pair of directional archers now uses a scale of 1.4262 and deck mount [233, 92.56] in `archer-2-turret.json`. Both tower families fit the existing plot rings.

## Integration left for the UI and content owners

| Surface | Assemblies needing further work |
| --- | --- |
| Voyage route | Place `route-dash` and `route-anchor` along the responsive SVG curve. The ship already marks the frontier. |
| Story caption and campaign text | Add `portrait-pell` to the caption layout. Islands i01–i16 each have `story-<id>-intro-1.webp` and `story-<id>-outro-1.webp` ready for the content owner’s beats. The current level data supplies no story copy for those islands. |
| Workshop, Settings and Briefing | Replace CSS diamond geometry with `pip-empty`, `pip-filled` and `gem-<difficulty>`. Replace the check layered over the settings medallion with the complete `toggle-on` and `toggle-off` images. Preserve existing switch behavior and accessible names. |
| Logbook and Daily | Use `seal-<feat icon>` and `seal-<challenge ID>` in the seal builders. Each painting includes its own backing. |
| End panel | Its action glyphs are Pixi Graphics. The corresponding play/map art is ready for texture-backed controls. |

The character paintings use Pell as a recurring narrator across the campaign. The content owner can assign the 32 campaign paintings once the associated text is written.

## Browser evidence

[All ten PNG captures](art-ui-shots/) cover the world map, briefing, fully revealed intro, fully revealed outro and a live level with all three mortar tiers and both archers on the tier-two platform at 844×390 and 1600×900. The captures use Chromium at DPR 1. The chart was checked through its clickable island node. The story screenshots use the existing intro/outro triggers. For the level captures, Playwright opened the production build at `2d.html?level=l1c`, funded construction with the QA gold hook, and used the normal build and upgrade controls. It placed T1/T2/T3 mortars on plots 7/11/12 and the T2 archer on plot 10, restored 200 gold and started wave one. The final capture pass reported zero page errors or failed HTTP responses.

The live aim scene loaded each tier’s JSON, body and strip and fired with its mount above the plot. Across Meadow Crossing and Emberglass Sanctum, Chromium observed all 24 tier/sector combinations. The five eastern, axial and northern poses selected the expected frames and the three western poses mirrored their eastern counterparts. An enlarged crop of the level capture confirmed that both tier-two archers stand above the deck.


## Gate

Ran the required gate with Node 22.21.1 after restoring the lockfile dependencies with `npm ci`. The gate process used two CPU cores to avoid oversubscribing the shared server.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | 1,066 passed, 11 skipped, zero failed. 82 test files passed and one skipped. |
| `npm run sim:balance` | 33/33 levels passed the Greedy and Weak targets |
| `npm run build` | Passed in 1.73 s. Vite reported its chunk-size advisory. |

Pillow verified the size and alpha mode of all 102 registered UI WebPs, all five occupied frames in each mortar strip and both dimensions of the ten screenshots. The worktree is uncommitted. Both local browser servers have been stopped. The remaining owner decision is whether to use Pell throughout the campaign or assign individual panels to local speakers when writing the island stories.
