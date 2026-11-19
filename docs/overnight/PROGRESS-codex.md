# Content overnight · codex

## Round 3 · 23:46 UTC–00:14 UTC · codex/night

Started from `d668b3a`. The runner owns the commit.

### Done

- Four chapter enemies now have authored stats, melee profiles, counter hints, bestiary entries and deterministic sim behaviours. The Belfry Hare gains up to 85% run speed over 2.4 seconds. Soldiers, a melee hero, frost or stun break the run. Successive hits on the Kilnback chip three armor from the next hit, down to zero. A 1.45-second lull restores its full spawn armor, including elite and challenge bonuses. Shield-only hits leave its shell intact.
- The Reed Piper stops for 0.85 seconds. Its last note clears slows from surfaced ground allies within 3.2 world units, including itself. Stun or death interrupts the phrase. Slipstream Moths accelerate behind another moth on the flight path and coast for up to 1.4 seconds. A pair can trade the lead. They sample a completed movement pass so swapping their pool slots gives the same distances.
- The enemy layer plays the piper's painted flute poses during its channel. The four enemies use sprint, shell, music and wake effects. The renderer supports a third, horizontal walk sequence and plays death clips in a separate capped sprite pool, so a reused sim slot can immediately show its next occupant.
- **i17 Cloudbell Cloister** introduces the hare and moth. Two opposing gate roads merge above the belfry switchback. It has 21 build plots and ten hand-written waves. **i18 Lantern Glassworks** introduces the Kilnback and Reed Piper. One long ore road doubles back to the keep while the flyers cut across the vault. It has 22 plots and eleven waves. Each island has four map textures, foregrounds at master and native 3× resolution, a new terrain painting, original prop and road paintings, and an intro and outro illustration. The kits reuse orchard and hollow gate architecture. [Paintings and generation prompts](../../design/art-2d/chapter2/islands.md)
- Both islands are listed after i16 in the chapter-two data. `LEVELS_2D` includes each island once its waves' enemy and melee definitions are registered. The current shipping roster presents 17 islands. The standalone balance CLI loads the four chapter profiles and evaluates all 35 targets, including i17 and i18. Direct iteration works with `npm run sim:balance -- --levels=i17,i18`.
- The bulk rebaker discovers new layout files and compares a first-time, uncommitted island against its starting geometry. The kit loader can reuse base-kit stonework. A biome mask reserves cliffs, machinery and painted ruins from scatter and plot placement. A repeat-spacing option keeps pairs of identical broken columns apart.

### Verification

| Island | Difficulty | Greedy | Weak | Workshop-maxed lives lost |
| --- | --- | --- | --- | --- |
| i17 | Heroic | 9 lives, 2 stars | Lost on wave 6 of 10 | 0 |
| i18 | Master | 7 lives, 2 stars | Lost on wave 5 of 11 | 4 |

- Node 22 release gate covered TypeScript, ESLint, Vitest, all 35 balance targets, and Vite. Vitest reported 1,168 passed and 11 skipped. The build emits its chunk-size advisory. The 695-line balance stdout has SHA-256 `91ad49bd8b4243de1daadc5da80c009807b553c576544055b9b65a8caa1ab3e4`. A byte comparison against round 2 found three insertions for the two new islands and the final target count changing from 33 to 35. Every existing level's output matches.
- Six new behavioural tests and one chapter balance test run in `tests/sim/chapterEnemies.test.ts`. Five Python compositor and two sprite tests passed. Validated all 19 layouts and decoded 76 map and 94 foreground textures. The 17 original layout files, game textures and waves have no diff. A fresh staged native rebake of i17 and i18 reproduced every 3× map and gate byte for byte. An intermediate i05 layout test exceeded its five-second timeout while the native bakers were busy. The full suite passed again after they finished.
- Playwright captured the actual opening wave, six-tower combat with all four new enemies, and a painted death on each new island at 1920 × 1080 DPR 1 and 2, and 844 × 390 DPR 3. Both final desktop DPR 2 captures waited for the native 3× map and foregrounds to finish streaming. The isolated Vite fixture registered the real chapter definitions in browser memory, supplied the regular sprite loader's side/death sequences and forwarded the kill event. The shipping shared loader and game event callback still need the small integration below. Full device frames, chapter diagnostics and the reproducible browser fixtures are in `/tmp/skyhold-codex-r3`. [Cloister and story paintings](maps-round3-i17.jpg) · [Cloister combat](maps-round3-i17-play.jpg) · [Glassworks and story paintings](maps-round3-i18.jpg) · [Glassworks combat](maps-round3-i18-play.jpg) · [Native 1× and 2× detail](maps-round3-native.jpg).

### Requests for other agents

1. **Integrator / sim owner.** Extend the closed `EnemyType` union in `src/core/types.ts` with `bellrunner`, `kilnback`, `reedpiper`, `draftwing`. Spread the exported `CHAPTER_ENEMY_MELEE` into `ENEMY_MELEE` in `src/data/soldiers.ts`. Complete the exhaustive badge and SVG records in `src/ui/icons.ts`, `DEATH_PITCH` in `src/audio/soundManager.ts` and the shard colors in `src/render/effectsRenderer.ts`. In the coordinated merge, spread `CHAPTER_ENEMY_DEFS` into `ENEMY_DEFS` and `...CHAPTER_ENEMY_TYPES` into `ENEMY_TYPES` before the final bosses in the content-owned `src/data/enemies.ts`. Those two additions, the shared records, and the Turkish lookup entries should land together. The chapter waves, combat, codex and island ordering are already wired. Once they ship, the two CLI-only registration assignments in `scripts/balanceSim.ts` and the two isolated roster mocks in the chapter test can be removed.
2. **2D loader / game owner.** Read `sheet.side` and `death` in the enemy manifest parser. When the optional side sheet loads, append its frames as `SheetRuntime.seqs[2]`. Expose the loaded death sequence on `EnemyArtRuntime.death` with `frames`, `fps` and the normalized `anchor`; prewarm its frames. Call `this.enemies.playDeath(e.enemyId)` from the existing `enemyKilled` listener in `game2d.ts`. The renderer and the published JSON already use these shapes.
3. **Opus / story.** Include `i17` and `i18` in `GENERIC_STORY_ISLANDS` in `src/render2d/ui/storyBeats.ts`. Their four images use the existing file convention and are registered in `paintedUi`. Verify the chapter-two navigation on the desktop and phone world maps after activation.
4. **Opus / i18n.** Add the following entries to `DATA_TR.islands` and `DATA_TR.enemies` in `src/i18n/dataTr.ts`. All four enemies use existing translated codex tags.

```ts
// DATA_TR.islands
i17: { name: 'Bulut Çanı Manastırı', subtitle: 'Yıkık çan kulesinin altında iki yol birleşiyor. Tavşanlar çanların tokmaklarını kaçırmış.' },
i18: { name: 'Cam Fener Atölyesi', subtitle: 'Fırınlar sönmüş. Cevher yolunu izleyip kristal mağaranın çevresini dolaş.' },

// DATA_TR.enemies
bellrunner: {
  name: 'Çan Tavşanı',
  desc: 'Açık yolda hızlandıkça koşumundaki çanlar da sıklaşan adımlarına ayak uydurur.',
  counter: 'Önüne bir asker çıkar ya da ayazla hızını kes. Yeniden hızlanması zaman alır.',
},
kilnback: {
  name: 'Fırın Sırtlı Kaplumbağa',
  desc: 'Kabuğuna ulaşan her darbe, pişmiş toprak plakalarından birini gevşetir. Ateş kesilince plakalar yeniden yerine oturur.',
  counter: 'Hızlı atışlarla kabuğunu gevşet, ardından plakalar yerine oturmadan ağır bir darbe indir.',
},
reedpiper: {
  name: 'Kamış Kavalcısı',
  desc: 'Durup kaval çalar. Son notası, yakındaki kara birliklerini yavaşlatan ayazı dağıtır.',
  counter: 'Çalarken sersemlet ya da ayaz saldırısını son notadan sonraya sakla.',
},
draftwing: {
  name: 'Esinti Güvesi',
  desc: 'Gök yolunda önündeki güvenin kanat çırpışlarıyla oluşan hava akımına girip hızlanır.',
  counter: 'Zincirleme yıldırımla sürüyü dağıt. Öndeki güveyi düşürürsen arkasındaki de yavaşlar.',
},
```

Wave names, in order, for Turkish surfaces that display them:

- i17 — Çalınan Tokmaklar · Doğu Revakı · Bulutların Üstünde · Bakır Alayı · Kopan Çanlar · Virajda · Bulutlar Aralanırken · Çan İpi · İki Koro · Manastırın Çanları
- i18 — Yürüyen Fırın · Kılcal Çatlaklar · Derinden Bir Nota · Cevher Katarı · Mağara Havası · Fırın Kapakları · Taşın İçinde Bir Koro · Hava Bacası · Çınlayan Kil · Cam Çağlayanı · Son Pişirim

### Next round

Start i19 and i20 in a new canopy or storm-coast biome. Continue to i24 with the full chapter balance runner. Give later islands different lane lengths and firing positions. Use the existing four behaviours in waves where their counters matter. The first chapter and the new enemy paintings are verified. Shared activation and the two story entries remain pending.

## Round 2 · 23:20–23:46 UTC · codex/night

Started from `46caef6`. The runner owns the commit.

### Done

- Re-baked i02, i06, i07, i08, i09, i10, i11 and i15 at all four shipping sizes using `--keep-plots`. The seven islands with water or ravine masks now support 55 build pads with painted foundations. The previous centre test placed 18. The new test covers the full ellipse and four layout pixels of contact shadow. Shelves fade into the existing paint on the inland side. On i06 the original mask missed the pale green surf, so its waterline now follows the actual sand and water painting.
- The i08 moat has a stone retaining face on its wet road edges and a longer eastern bridge. The compact gatehouse was cutting a square notch out of the earlier loop below its sill. The trim now preserves that earlier road. Checked identical trim pixels on the other compact keeps, i06 and i12, at 1×, 2× and 3×.
- On i09 individual veined slabs follow the road and turn around the tight inside bends. They use cuttings from the original marble painting.
- Added production art for four original enemies. Each has six drawn frames facing down, up and sideways, a six-frame attack with contact on frame four, and a six-frame death. The five clips share their scale and foot anchor. All 120 poses appear in the packed strips. [Motion review](../../design/art-2d/chapter2/motion-review.gif) · [Source paintings, prompts and rebuild command](../../design/art-2d/chapter2/motion.md).
- Registered the four art IDs in `public/art2d/manifest.json`. The existing loader can already display their front, back, down, up and attack art. The preview attached each art ID to a walking grunt in the Playwright browser's copy of the manifest. Twelve final captures exercised the game renderer at desktop DPR 1 and 2 and phone DPR 3. It did not exercise any new sim behaviour. [Game-size comparison](../../design/art-2d/chapter2/play-review.jpg).

### Verification

- All 17 compositor layout checks passed. All 17 layout JSON files are byte-identical to the round's starting revision, including paths, gates and all 405 plot positions. Decoded all 68 map textures and 84 foreground textures. Compared the gate and plot bake sidecars for all eight changed islands against their saved layouts.
- Captured all eight changed islands with firing towers and live enemies at desktop DPR 1 and 2 and on a landscape phone. The before captures are the final round-one bakes. [Whole islands at 1×](maps-round2-1x.jpg) · [Native 2× details](maps-round2-2x.jpg) · [1920 × 1080 DPR 1](maps-round2-play-1920-dpr1.jpg) · [1920 × 1080 DPR 2](maps-round2-play-1920-dpr2.jpg) · [844 × 390 DPR 3](maps-round2-play-844-dpr3.jpg).
- Fixed an interrupted bulk bake which had truncated a native WebP. The bulk tool now stages each island, checks its geometry and decodes its textures before replacing game files. A fresh staged rebuild of i06 and i09 reproduced all 16 published map and gate files byte for byte. The sprite packer also swaps each encoded WebP into place after encoding.
- Repacked all four enemies from their checked-in source plates. Each of the 48 files matched the published copy byte for byte. The packer follows connected silhouettes across nominal gutters. This recovered the tip of a moth wing which projected into the neighbouring frame.
- Node 22 release gate passed. TypeScript and ESLint passed, Vitest reported 1,161 passed and 11 skipped, all 33 balance targets passed, and Vite built successfully with its chunk-size advisory. Both 645-line balance outputs have SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`.
- Five compositor tests and two sprite tests passed. Re-run with `/usr/bin/python3 -B tools/map-compose/test_ground.py` and `/usr/bin/python3 -B tools/sprites/test_chapter_enemies.py`. Full-resolution screenshot frames and QA logs are in `/tmp/skyhold-codex-r2`.

### Next round

Implement the new enemy definitions, behaviours, tests and bestiary entries using the art IDs below. The creatures are currently available as art. The campaign has no waves containing them. Start chapter-two layouts and custom scenery in parallel with the registration handoff if shared files are still unavailable. The i17–i24 layouts and waves remain open.

| ID | English | Türkçe | Intended decision |
| --- | --- | --- | --- |
| `bellrunner` | Belfry Hare | Çan Tavşanı | Builds speed during an uninterrupted run. A blocker or frost breaks its momentum. |
| `kilnback` | Kilnback Tortoise | Fırın Sırtlı Kaplumbağa | Repeated strikes chip its shell. A gap in fire lets its plates settle back into place. |
| `reedpiper` | Reed Piper | Kamış Kavalcısı | Pauses to play a phrase that clears slows from nearby ground troops. Stun during the phrase or delay the frost shot. |
| `draftwing` | Slipstream Moth | Esinti Güvesi | A trailing moth gains speed behind a nearby leader. Break the formation with area or chain fire. |

### Requests for other agents

- Integrator / sim owner: coordinate the four ID additions to the closed `EnemyType` union in `src/core/types.ts` and its exhaustive consumers in `src/data/soldiers.ts`, `src/ui/icons.ts`, `src/audio/soundManager.ts` and `src/render/effectsRenderer.ts` with the content-owned definitions and lore. Melee profiles needed are single-block for hare and piper, two-block for tortoise, and ignore for the flying moth.
- 2D loader owner: extend enemy `SheetSpec` and `loadEnemy` to read the existing `enemies.<id>.sheet.side` and `enemies.<id>.death` paths. A third entry in `SheetRuntime.seqs` and an optional loaded death sequence on `EnemyArtRuntime` will allow the content-owned enemy layer to play them. The hero loader already supports both slots.
- Opus i18n: the data-only lookup is `DATA_TR.enemies` in `src/i18n/dataTr.ts`. Use the entries below with the proposed mechanics. The sim owner should flag wording changes if tuning changes the actual counterplay.

```ts
bellrunner: {
  name: 'Çan Tavşanı',
  desc: 'Yolu açık kaldıkça hızlanır. Önüne bir asker çıktığında ya da ayaz yediğinde yeniden hız toplaması gerekir.',
  counter: 'Yolun düzlüğünde bir asker beklet ya da ayaz kulesiyle hızını kes.',
},
kilnback: {
  name: 'Fırın Sırtlı Kaplumbağa',
  desc: 'Art arda gelen darbeler kabuğunun pişmiş topraktan plakalarını gevşetir. Ateş kesilirse plakalar yeniden yerine oturur.',
  counter: 'Hızlı atışlarla kabuğunu gevşet, ardından ağır bir darbe indir.',
},
reedpiper: {
  name: 'Kamış Kavalcısı',
  desc: 'Durup kaval çalar. Ezgisi bitince yakındaki kara birliklerini yavaşlatan etkiler kalkar.',
  counter: 'Çalarken sersemlet ya da ayaz saldırısını ezginin sonuna sakla.',
},
draftwing: {
  name: 'Esinti Güvesi',
  desc: 'Başka bir güvenin hemen arkasında uçarken onun oluşturduğu hava akımıyla hızlanır.',
  counter: 'Alan saldırılarıyla ya da zincirleme yıldırımla sürüyü dağıt.',
},
```

## Round 1 · archive

Round 1 ran 22:52–23:19 UTC on `codex/night` from `0f854bb`. The changes are in the working tree for the overnight runner.

### Done

- Reviewed all 17 original maps at 1846 and 3692 px wide. Playwright captured all 17 with towers and live enemies at 1920 × 1080 DPR 1 and 2, and 844 × 390 DPR 3. The before sheets are in this directory.
- Replaced the evenly spaced roadside dots with short seeded groups on the verge. Both freestanding props and decals now check their complete bounds against roads, build rings, landmarks, bridge decks and map borders. Props vary in size and check their ground contact against the island's land mask. L1c grass and dirt, i01 orchard soil and i05 loam use staggered swatches of their original paint.
- Seated the i04 ramp across the actual terrace ledge and moved the lantern posts beside its lower bank. Linked the i06 lighthouse shelf to the castle and beach with a short gangway and a longer pier. Used cool granite on i07 and i11, including a new bridge over the i11 ravine.
- On i10 the river now passes through three shallow fords with individual stepping stones, one timber crossing and the existing lower stone span. Corrected the land mask at the stream fork and moved the sluice from the field into the lower channel.
- TypeScript, ESLint and Vitest passed. Vitest reported 1,161 passed and 11 skipped. Three additional compositor regressions passed. Both balance runs have identical 645-line stdout and SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e`.

### Verification and evidence

- All 17 layout JSON files match the starting revision byte for byte. The bake used `--keep-plots` and the generated gate records and all 405 plot coordinates match the layouts. Decoded 68 maps and 84 foreground textures and checked their dimensions against the manifest and saved rectangles. The 68 maps total 25.3 MiB, down from 27.3 MiB.
- The full Node 22 gate passed on the final tree, including the production build. Vite emitted its chunk-size advisory. Three Pillow regressions cover opaque texture joins, decal bounds, and submerged road paint. Run them with `/usr/bin/python3 -B tools/map-compose/test_ground.py`.
- Whole islands and native master crops use identical framing before and after. [Before overview](maps-before-1x.jpg) · [After overview](maps-after-1x.jpg) · [Before at 2×](maps-before-2x.jpg) · [After at 2×](maps-after-2x.jpg).
- Bridge and ford details include the banks as well as the decks. [Before](maps-before-crossings.jpg) · [After](maps-after-crossings.jpg) · [Native phone comparison with towers](maps-play-crossings.jpg).
- Reproduce the live review after building with `NODE_PATH=/tmp/skyui-qa-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/tmp/skyui-browsers node tools/map-compose/play_maps.mjs /tmp/map-review`. Append island IDs for a subset. The session uses Chromium with SwiftShader and real tower, soldier and enemy rendering.

- Captured 51 original and 51 final gameplay frames. The QA scene showed at least three enemies and six towers on every island. The desktop selected the 1.5× texture at DPR 1 and the 3× texture at DPR 2. The phone selected 1.5×. Full-size JPEGs are in `/tmp/skyhold-codex-r1-qa/{before,after}` on this machine. [Desktop DPR 1](maps-after-play-1920-dpr1.jpg) · [Desktop DPR 2](maps-after-play-1920-dpr2.jpg) · [Phone DPR 3](maps-after-play-844-dpr3.jpg).

### In progress and problems

No pending bakes, servers or checks. An interrupted bulk bake and a timed-out capture were rerun. All final files decoded, and all 51 final frames are present.

### Next at the end of round 1

Start the next round with shoreline build-pad support. On i06 plot 12 and i10 plot 12 the tower base extends into water even though its centre is on land. The current plot foundation test samples only the centre. Inspect the entire ellipse and place a bank extension where needed, without moving any plots. Also review the i08 outer moat approach and the repeating marble paving on i09. Then continue with enemy art and behaviours. The original roster already includes a healer, warden, burrower, carrier, blinker and phased boss. Give new enemies different counterplay.

### Round 1 requests

New enemy registration crosses ownership. The current `EnemyType` is a closed union in `src/core/types.ts`. Coordinate the union extension and exhaustive consumers in `src/data/soldiers.ts`, `src/ui/icons.ts`, `src/audio/soundManager.ts` and `src/render/effectsRenderer.ts` with the integrator when new IDs are chosen. The 2D enemy and codex work stays on this branch.

No new player-facing names or translation keys in round 1.
