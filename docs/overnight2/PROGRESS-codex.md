# Codex overnight progress

## Round 1 — Hard i09 and title artwork

### Done

- Reduced i09 starting gold from 340 to 336. Four fewer coins change the timing of the opening build on Hard. With Bran, Hard went from 22/22 lives and three stars to 12/22 and two stars. Normal still finishes at 17/22, three stars and 1,522 hero XP. Easy still finishes at 26/26.
- The full difficulty simulation passes all eight verdicts. Campaign clears are 25/25 on Easy and Normal, 12/17 on Hard chapter one and 3/8 on Hard chapter two. All 15 Hard wins cost lives and award one or two stars. Hard i24 ends at 5/22 and one star. Weak Hard wins 3/25.
- Registered the key art and two transparent title lockups under `paintedUi.title` in `public/art2d/manifest.json`. The scene shows Wren, Bran and Mira above the island castle. The two logos read **Skyhold Isles** (EN) and **Skyhold Adaları** (TR).
- Checked both exported WebP alpha channels against their PNG sources. Inspected browser composites at desktop and landscape phone sizes and zoomed in on the Turkish lettering. [Desktop EN](../../design/art-2d/title/en-1600x900.jpg) · [Phone TR](../../design/art-2d/title/tr-844x390.jpg).

### Decisions and requests for Opus

Use the raw manifest's `paintedUi.title.keyart`, `.logo` and `.logoTr`. Each value is a path relative to `/art2d/`. The opaque scene is 2400×1350, scaled from the 1672×941 painting. Both logos have matching 1200×600 transparent canvases. The proof places the logo 5% from the left and 10% from the top over a centered cover crop, with width capped at the smaller of 39vw and 76vh. These are artwork proofs. Opus owns final menu placement and controls.

### Verification and problems

TypeScript and lint passed. Vitest passed 1,344 tests with 11 skipped. The realistic-kit balance gate passed all 41 levels, including all 25 islands. The standalone L1–L16 report matches the 24,217-byte round-start baseline exactly. The production build passed and contained byte-identical copies of all three title WebPs. Vite reported its existing chunk-size and dynamic-import warnings.

### Next round

Start tower specializations. The roster has eight families: archer, cannon, frost, tesla, mortar, ballista, beacon and barracks. Implement the branch and ability purchases through the deterministic world and replay command paths, alongside the data interface Opus needs for the build ring. Chapter-two map polish follows.
