# Content overnight · codex

## Round 10 · 02:27–02:49 UTC · codex/night

Started from `c5acb4b`. The runner owns the commit.

### Done

- **i13 Stormcrown Citadel.** The compass dial from the intro stands above the northern bend. The eastern watch fire has a fuel store and an unlit iron basket ready for the keeper in the outro. The former altar site between two tower pads had room for a 46 px dial. Moving it to the ridge let it reach 90 px. The old southeast standard sat behind the wave banner on phone. The 115 px signal basket is visible beside the northern war road.
- Warm limestone paving follows the spiral over three stretches of slate arches. At the east cave the two road edges turn from the painted jambs into the approach. Low heather grows in the seams of the slate plateau. The exposed cliff lips and new retaining walls have scatter exclusions. The first trial used oversized slabs and a road flare below the east jamb. The final recipe scales the paving against the keep and eases the departure angle toward the lane. [Before and after maps with native 2× details](maps-round10-citadel.jpg) · [Paintings, prompts and rebuild command](../../design/art-2d/v2/biomes/highlands/stormcrown.md)
- The first release run hit the recurring five-second i05 geometry-test timeout. Profiling located the cost in the compositor's keep transform. Oblique elevations now skip an identity interpolation, and the four-neighbour paint and depth sampler works in row strips. Across all 25 island keeps, the transformed RGBA painting, depth mask, paving swatch, anchor and scale match the starting revision exactly. In the paired check, i05's keep preparation took 0.345 s against 1.189 s at the starting revision.

### Verification

- Played Static Sparks at tick 181 with seven towers and seven enemies, and Crown of Storms at tick 510 with 24 towers and 39 enemies including the Tempest Colossus. Matched the before and after game state on all six pairs in the production build. Desktop used 1920 × 1080 at DPR 1 and 2, phone used 844 × 390 at DPR 3. Both high-density desktop captures loaded the native 3× map. On phone the dial occupies 41 × 41 CSS px and the beacon 55 × 53 CSS px. Both clear the horn, wave banner and playback controls. [Desktop combat](maps-round10-desktop.jpg) · [Phone combat at CSS size](maps-round10-phone.jpg)
- Re-baked the four map sizes and six foregrounds with `--keep-plots`. All 25 saved layout files match the starting revision byte for byte. Decoded all 100 maps and 132 gate fronts at their registered sizes. The alpha channels of all six i13 fronts match the original pixels. The ten i13 textures grew by 844,236 bytes in total. The 1.5× map used on phone grew by 92,300 bytes.
- Thirteen Python compositor regressions and both sprite tests passed. The new coverage exercises clearing the near verge at an oblique doorway, the buried ends of an arcade and sampling the keep's transparent border across row strips.
- All 25 islands passed the compositor geometry checks. An interrupted native reproducibility pass was retried from the saved layout. The clean master, both variants, native map and all six fronts match the published bytes. The northern cave retains its existing 3 px bleed at the top of the safe area.
- The final Node 22 gate passed TypeScript, ESLint, Vitest (1,186 passed, 11 skipped), all 41 balance targets and the Vite production build. Vite printed its chunk-size advisory. The complete 848-line balance stdout is byte-identical to round nine, SHA-256 `a843de0e6d4ece932d0de94bac52f34d8a7ca5dcd5dcb11f8c4c4a23a22d6e47`. Full device frames, bake comparisons and release logs are under `/tmp/skyhold-codex-r10`.

### Requests for other agents

Chapter two still awaits the shared roster, clip/death callback, story and Turkish registrations listed in earlier rounds, and the i21 horn placement. Round ten adds scenery to a shipping island and introduces no UI strings.

### Next round

Inspect i05 Windmill Switchback in production on phone. Its story panel shows a working mill surrounded by golden wheat. The battle map has a lone mill, open ochre ground and repeated green trellises. Fit the fields and harvesting equipment to the two hairpins and check the mill against tall towers. Retain the east keep, west entrance and all 19 plots. If the chapter registrations have landed, verify the shipping unlock, stories and first kills first.

## Round 9 · 02:05–02:27 UTC · codex/night

Started from `eab2202`. The runner owns the commit.

### Done

- **i16 Emberglass Sanctum.** The upper west ore tunnel has a winding drum and loaded skip. The lower west cooling chamber has glazed masonry and three cast-glass discs on a trestle. At the east furnace a leather bellows plugs into the copper socket of a glowing barred firebox. Two braziers serve the furnace yard. The former ring of identical perimeter fires is gone.
- A full courtyard painting supplies the flagstones on the two long approaches. Firebrick courses follow the short eastern lane, ending with a transverse row before the three-way junction. The terrace has bedded tuff, cooled lava and fractured black glass at its outer edge. A new ash mask keeps scattered props off these formations. The lower rock lip was fitted below the three existing southern pads.
- The compositor supports painted finishes on measured cave faces. Colours can change while the opening, silhouette and actor depth mask retain their original registration. Two regressions exercise that behaviour and check the brick courses at a bend and just before a shared road, at 1×, 2× and 3×. [Paintings and art briefs](../../design/art-2d/v2/biomes/ember/sanctum.md)

### Verification

- Re-baked the four map sizes and eight gate foregrounds with `--keep-plots`. All 25 saved layouts match the starting revision byte for byte and pass their geometry checks. Decoded 100 maps and 132 gate fronts at their registered dimensions. All eight i16 foreground alpha channels match the original pixels. The twelve i16 shipping textures together use 111,298 fewer bytes.
- Captured the optimized production campaign before and after, using its scripted autoplay to buy towers with earned gold. Gatecrash at wave tick 368 had six towers and five ground enemies across all three lanes. Heart of the Sanctum at wave tick 552 had 24 towers, 27 ground enemies and 13 flyers. On all six pairs, the tick, ground positions, tower builds, gold, lives, total enemy count, camera fit and gate texture widths matched. Desktop ran at 1920 × 1080 DPR 1 and 2, phone at 844 × 390 DPR 3. Both DPR 2 frames loaded the 3× map. [Before and after maps and native 2× gate details](maps-round9-sanctum.jpg) · [Desktop combat](maps-round9-desktop.jpg) · [Phone combat at CSS size](maps-round9-phone.jpg)
- The final Node 22 gate passed TypeScript, lint, Vitest (1,186 passed, 11 skipped), all 41 balance targets and Vite. Vite printed its chunk-size advisory. The complete 848-line balance output is byte-identical to round eight, SHA-256 `a843de0e6d4ece932d0de94bac52f34d8a7ca5dcd5dcb11f8c4c4a23a22d6e47`. Ten Python compositor tests and two sprite tests passed. A clean second bake reproduced all twelve i16 textures byte for byte. The same check on i09 reproduced all eight of its existing map and gate textures after extracting the shared paving sampler. Full-resolution frames, diagnostics and gate logs are under `/tmp/skyhold-codex-r9`.

### Requests for other agents

The chapter-two roster activation, clip loader, kill callback, story registrations, i21 horn placement and Turkish lookups from earlier rounds remain pending on this branch. Round nine adds scenery to a shipping chapter-one island and introduces no UI strings.

### Next round

Inspect i13 Stormcrown Citadel’s spiral in a late wave. The altar in the northern court is very small and the yellow standard at the southeast rim sits among scattered rubble. Check both at phone scale. Give the storm watch an identifiable station at one of these sites, retaining the two entrances, inner keep and all 28 plots. If the shared chapter registrations land first, verify chapter-two unlock, story, enemy kills and Turkish lookups in production.

## Round 8 · 01:46–02:05 UTC · codex/night

Started from `1d526a4`. Changes are in the working tree for the overnight runner.

### Done

- **i06 Crescent Lagoon.** An oystercatcher feeds in the shallow surf west of the keep. The painted legs and bill break the surface in three places. The lagoon shows through the ripple gaps. This island is available in the shipping campaign.
- **i20 Three Pennants Head.** A saffron triangle marks the west shelter, a red square with an ivory diagonal marks the reef cave, and two blue streamers mark the boat. The shapes read in the phone battle while the units emerge from their gates. Loose scattered copies of the yellow signal pole have given way to marram, sea pinks, basalt and fishing floats. The small streamer on the west-facing reef gate now follows the same wind as its signal mast on both coastal maps. Every painted pixel below that mast joint matches the mirrored original.
- **i24 Lastlight Head.** Two terns roost on a slate ledge in the western cliffs. The keeper's beacon now has an extinguished lens during battle, an open service door and six stepping stones from the door to the verge. The outro shows the rekindled lamp. On the first placement the slates entered plot 19's reserved tower clearance. Moving the walk three layout pixels west cleared it. [Full before and after maps](maps-round8-coasts.jpg) · [Native 2× details](maps-round8-details.jpg) · [Source paintings and five built-in ImageGen prompts](../../design/art-2d/chapter2/islands.md#coastal-signals-birds-and-the-keepers-entrance)
- Recipes can place `groundPaint` with the same coordinates and size as landmarks. This reserves room for the painting and bakes it directly onto the terrain. Water reflections and stones set flush into turf can carry their own contact details. The compositor also checks each authored landmark's visible silhouette against the road, including on bends. The new regression exercises both a transparent corner and a pennant tip extending into the lane.

### Verification

- Played authored waves at 1920 × 1080 DPR 1 and 2 and 844 × 390 DPR 3. The final frames match the before frames on wave tick, tower builds, enemy IDs, positions, facing and ability timers. The i06 fifth wave had five towers and ten enemies. The i20 finale had ten towers and eleven enemies. The i24 thirteenth wave had ten towers and fifteen enemies. All three desktop DPR 2 captures loaded the native 3× maps. The chapter captures used the local roster preview. The optimized production build also loaded i06 at all three device settings. [Phone before and after at CSS size](maps-round8-phone.jpg) · [Both desktop resolutions](maps-round8-desktop.jpg)
- Re-baked all four map sizes with `--keep-plots`. All 25 layout JSON files are byte-identical to the starting revision, including gate records and every plot. All 25 passed the revised layout check. Decoded all 100 map and 132 gate textures and verified their dimensions. A clean second bake reproduced all 32 map and gate textures for the three islands byte for byte. Together they use 11,074 fewer bytes of shipping art. Their wildlife and signals use the existing map texture requests.
- The Node 22 release gate passed TypeScript, ESLint, Vitest (1,186 passed, 11 skipped), 41 balance targets and Vite. Vite printed its chunk-size advisory. The 848-line balance stdout matches round seven byte for byte, SHA-256 `a843de0e6d4ece932d0de94bac52f34d8a7ca5dcd5dcb11f8c4c4a23a22d6e47`. Eight compositor tests and two sprite tests passed. Full device frames, audit scripts and gate logs are under `/tmp/skyhold-codex-r8`.

### Requests for other agents

The shipping roster still exposes 17 islands. The shared enemy registrations, clip loader and kill callback remain with the owners listed in round three. Story registration, the i21 horn and the chapter's Turkish data lookups remain with Opus. All round-eight changes are visual.

### Next round

Inspect i16's three cave mouths and perimeter braziers at actual wave density. Its two western mouths use the same painting, and the eastern one mirrors it. Give the approaches a distinct purpose in the furnace scene while preserving the doors, gate fronts, roads and 26 plots. Use the production entry point for chapter one. If shared registration arrives first, verify chapter-two navigation, stories, kills and Turkish data in the shipping campaign.

## Round 7 · 01:28–01:46 UTC · codex/night

Started from `639cd2c`. The runner owns the commit.

### Done

- All eight chapter islands have painted landmarks on the voyage chart and in the briefing. The old circular crop on i24 showed an empty road bend. The new miniature shows the lit beacon, on i22 the cable ferry, and on i21 the weather kite and winding drum. The eight transparent 384 × 384 WebPs total 407,632 bytes, 69% smaller than the eight 1× battle maps previously requested for these thumbnails. The landmarks fit the medallion's circular inset including their pennants, branches and surf. [Chart and briefing before and after](maps-round7-chart.jpg) · [Asset paths and built-in ImageGen prompts](../../design/art-2d/chapter2/chart.md)
- A Reed Piper now lifts two joined notes beside its flute while it plays. Broken gold arcs on the ground mark its full 3.2-unit cleanse radius throughout the phrase. Both marks disappear as soon as the channel ends or a stun interrupts it. The elite marker can remain visible during the phrase. On i22 wave seven, the capture shows a healer restoring HP beside a playing Piper, three simulation ticks after the healing pulse.
- A drafting Slipstream Moth leaves two tapered wingtip trails. They turn with the sky lane and shorten and fade as the speed bonus expires. Wingbeats advance on simulation time while slowed and begin at a different phase for each moth. Three flight heights, within 0.22 world units of the sim altitude, distinguish overlapping moths. The shared geometry is built once per cue in the enemy layer, and views reuse it. [Same-tick combat comparisons on i18, i21 and i22](maps-round7-cues.jpg)

### Verification

- Played a later authored wave on every island i17–i24 at 1920 × 1080 DPR 1 and 2, and at 844 × 390 DPR 3. Each battle had 8–10 towers bought with earned gold and 11–22 live enemies. Compared all 24 final captures with the corresponding round-six code at the same wave tick. Enemy IDs, ground positions and ability timers matched across each pair. DPR 2 used the native 3× maps. The highest elite crown in the eight selected phone frames cleared the top by 20.7 CSS pixels. The measurement covers the eight sampled combat frames. [Desktop](maps-round7-play-desktop.jpg) · [Phone](maps-round7-play-phone.jpg)
- Clicked all eight chart nodes and inspected their briefings on the three devices. Each final chart and briefing loaded its own 384 px landmark. A browser save that had cleared i16 on the 17-island campaign opened i17 and kept i18 locked. Clicking Play on that newly unlocked i17 opened the correct island. Five towers bought with starting gold killed a Belfry Hare and the painted death clip played. The four chapter bestiary cards each showed the matching portrait, English name and counter. These checks used the round-six local chapter preview and isolated browser saves. The production roster and story registrations are still pending.
- Node 22 release gate passed TypeScript, ESLint, Vitest (1,186 passed, 11 skipped), all 41 balance targets and Vite. The 848-line balance report matches round six byte for byte, SHA-256 `a843de0e6d4ece932d0de94bac52f34d8a7ca5dcd5dcb11f8c4c4a23a22d6e47`. Vite printed its chunk-size advisory. The seven compositor tests and two sprite tests passed. The two new renderer tests cover radius, interruption, facing, coasting and reuse of cue graphics. Full-resolution before/after frames, browser fixtures, diagnostics and gate logs are under `/tmp/skyhold-codex-r7`.

### Requests for other agents

- The shipping campaign currently exposes 17 islands. The shared roster, melee registrations, side/death loader and kill callback are listed under round three. The eight chart landmarks now resolve automatically once those islands enter the shipping campaign.
- Opus still owns the eight story registrations, the Turkish data lookups listed under rounds three through six, and the i21 horn position under round five. This round adds no player-facing strings.

### Next round

Start ambient map life on the chapter coasts. Inspect the i20 signal masts and i24 beacon in live play, choose one low-cost treatment that reads at phone size, and keep road edges, gates and combat cues clear. Check the 41-target balance output against the hash above. If the shared registrations land first, exercise chart → briefing → story → first kill through the production entry point and retire the preview-only registrations.

## Round 6 · 01:05–01:28 UTC · codex/night

Started from `1605b47`. Changes are in the working tree for the overnight runner.

### Done

- **i23 Waxlight Orchard** has 21 plots and 13 hand-written waves. The two orchard roads have similar travel times. The packing cellar sends troops around the hives, while the cider press feeds a lower track. In wave six, Kilnbacks and Reed Pipers leave the press together and moths cross the orchard diagonally. The two roads join on the east side and return to the keep. The cart road has broken wheel tracks that follow its bends. [Desktop and phone combat](maps-round6-i23-play.jpg)
- **i24 Lastlight Head** closes the chapter with 22 plots, 14 waves and an elite Tempest Colossus. The sea fort road measures 47.5 world units, the reef quay 35.1 and the boat landing 22.2. The quay joins the fort road first, then the boat road joins at the lower fork. In the finale, Kilnbacks and pipers depart the boat landing, hares from the quay, and moths take the flight route as the Colossus approaches its first phase. The fort road has basalt setts, with gravel on both side roads. [Finale, Stormwall and enrage on all three devices](maps-round6-i24-play.jpg)
- Both islands have an original terrain plate, exclusion mask, road material, entrance and scenery paintings, intro and outro panels, four map resolutions and separate 2× and 3× gate fronts. The last beacon is lit with wax from the orchard. The two islands inherit their keep paintings from the orchard and tidal kits. [Maps and story panels](maps-round6-islands.jpg) · [First bakes, final bakes and native 2× details](maps-round6-detail.jpg) · [Art sources and prompts](../../design/art-2d/chapter2/islands.md)
- The first i24 layout took the Colossus so close to the top edge that its crown clipped on desktop. Lowered the north bend and refitted four plots on the new island. In the final battle captures the crown cleared the top by at least 23 CSS px on desktop and 8 on phone from spawn through enrage. [Same instant on the first and final layouts](maps-round6-boss-clearance.jpg)
- **Play the chapter locally** from the checkout root with `node tools/map-compose/preview_chapter.mjs i24` on Node 22. Open the printed loopback URL. The command accepts i17–i24 and stages the roster, side/death clips and kill callback in the Vite dev server. A clean browser session opened i23 and i24, loaded the extra clips, showed active enemies and towers and reported all eight islands in campaign order. Ctrl+C closes the preview. [Local chapter preview](../../tools/map-compose/preview_chapter.mjs)

### Verification

| Master island | Greedy | Weak | Workshop-maxed lives lost | Greedy lives at −3%, −1.5%, baseline, +1.5%, +3% HP |
| --- | --- | --- | --- | --- |
| i23 | 9 lives, 2 stars | Lost on wave 8 of 13 | 11 | 9, 6, 9, 7, 6 |
| i24 | 8 lives, 2 stars | Lost on wave 9 of 14 | 10 | 7, 6, 8, 5, 9 |

- The final Node 22 gate passed TypeScript, ESLint, Vitest (1,184 passed, 11 skipped), all 41 balance targets and Vite. The build printed its chunk-size advisory. An earlier i05 geometry test timed out while Chromium was running. The full suite passed after the captures finished. The 848-line balance stdout has SHA-256 `a843de0e6d4ece932d0de94bac52f34d8a7ca5dcd5dcb11f8c4c4a23a22d6e47`. Removing the two new island reports and restoring the previous target count reproduces the full round-five stdout byte for byte.
- All 25 saved layouts pass the compositor checks. Decoded and checked the size of 100 maps, 132 gate fronts and the four new story panels against the game manifest and layouts. A fresh native rebuild reproduced the two new 3× maps and all seven 3× fronts byte for byte. The seven compositor and two sprite tests pass. The new cart-track regression covers their separations, thresholds and clear centre at three scales. The finale test checks the boss, the two reinforcement lanes and the ordering of their compiled route lengths.
- Captured the actual opening waves and later combat at 1920 × 1080 DPR 1 and 2 and 844 × 390 DPR 3. The i23 battle has 17 live enemies and nine towers. The i24 final wave has 20 enemies and ten towers in the three-lane view, with separate frames from each boss phase. Both DPR 2 captures used the native 3× maps and fronts. The full-size captures, diagnostics, QA scripts and release logs are under `/tmp/skyhold-codex-r6`.

### Requests for other agents

- **Integrator / sim and loader owners.** All eight islands i17–i24 are authored and balanced. The shipping campaign still exposes the original 17 until the four cross-owner enemy registrations land. The exact shared records, side/death loader changes and game callback are listed under round three. The local preview exercises all eight in the interim.
- **Opus / UI.** Add i23 and i24 to `GENERIC_STORY_ISLANDS` along with i17–i22. All sixteen chapter panels are in `paintedUi`. The i21 wave horn placement from round five is still outstanding.
- **Opus / i18n.** Add these two entries to `DATA_TR.islands` in `src/i18n/dataTr.ts`. The previous six islands and four enemy translations are listed in rounds three through five.

```ts
i23: { name: 'Mum Işığı Bahçesi', subtitle: 'Deniz fenerini yeniden yakmak için bir alev gerek. Son balmumu arabası geçene dek armut bahçesinin yollarını açık tut.' },
i24: { name: 'Son Işık Burnu', subtitle: 'Deniz feneri söndü. Fenerci lambayı yeniden yakana dek deniz kalesini ve iki iskeleyi savun.' },
```

Turkish wave titles in play order for surfaces that display them.

- i23 — İlk Hasat · Mahzen Kapısı · Armut Dallarında · Kırık Sepet Kovan · Çitin Arasından · Dökülen Armutlar · Bal Presi · Uzayan Gölgeler · Balmumu Eriyor · Fitiller Balmumuna Batıyor · Oğul Vakti · Dalların Altında · Mum Arabası
- i24 — Bir Işık Sönüyor · Tekne Açılıyor · Basamaklarda Köpük · İki İskele · Yükselen Sular · Çanı Çalın · Dış Sur · Yırtık Yelkenler · Sertleşen Rüzgâr · Pirinç Kepenkler · Rıhtım Çöküyor · Fitil Tutuşuyor · Mercek Dönüyor · Günün İlk Işığı

### Next round

Audit the complete chapter in play, especially elite crowns, healing and music cues in dense waves, flight-line readability, and late-wave tower occlusion on phone. Use the local preview until the shared roster lands. Once integrated, check chapter selection, story and kills via the production entry point and retire the temporary preview registrations. Scenery and ambient-life polish from backlog item four remain open. Preserve the 41 balance reports during art-only changes.

## Round 5 · 00:42–01:04 UTC · codex/night

Started from `d2162b4`. The runner owns the commit.

### Done

- **i21 Kitewright Down** has one ground road that folds back twice beside a fallen weather kite. Barracks inside the lower bend can hold ground troops while towers on the chalk ridge cover the flight line. In wave six, elite Slipstream Moths cross the kite as Belfry Hares sprint along the outer road. Wave seven follows with elite Kilnbacks and Reed Pipers. There are 20 build plots and 12 hand-written waves. [Desktop and phone combat](maps-round5-i21-play.jpg)
- **i22 Brineglass Ferry** has two entrances. The mine convoy circles the brine pool. The lower freight shed opens onto a much shorter road, letting its blinkers arrive while the mine's Kilnbacks, healers and pipers are still on the north bank. In the finale, a boss takes the long route and nine elite Kilnbacks depart the lower landing. There are 20 plots and 13 hand-written waves. [Desktop and phone combat](maps-round5-i22-play.jpg)
- Both islands have a new terrain painting, terrain exclusion mask, entrance paintings, working equipment, three new small props apiece and two story panels. They reuse the cloister and glassworks roads and keeps. A recipe can now select its own scatter paintings from a shared kit. Kite spars sit by the storage tunnel, salt bales beside the freight shed and a mooring bollard beside the water. All four map sizes and all five gate foregrounds at 2× and 3× are registered. [Maps and story panels](maps-round5-islands.jpg) · [First and final bakes with 2× details](maps-round5-detail.jpg) · [Asset locations and built-in imagegen prompts](../../design/art-2d/chapter2/islands.md)
- Six chapter tests now check campaign ordering under the staged roster, both ends of the ground routes, the separate flight route and the lane selected by every wave group. This catches a lane typo even when the simulator falls back to a playable route.

### Verification

| Master island | Greedy | Weak | Workshop-maxed lives lost | Greedy lives at −3%, −1.5%, baseline, +1.5%, +3% HP |
| --- | --- | --- | --- | --- |
| i21 | 8 lives, 2 stars | Lost on wave 6 of 12 | 10 | 8, 8, 8, 7, 5 |
| i22 | 7 lives, 2 stars | Lost on wave 8 of 13 | 3 | 10, 5, 7, 5, 6 |

- TypeScript, ESLint, Vitest (1,179 passed, 11 skipped), all 39 balance targets and the Vite build passed on Node 22. Vite issued its chunk-size advisory. The full 800-line balance stdout has SHA-256 `d9eff69f8d322e341f6023124b19550ddc7735ea5a16c749e5cb5f143eac34c6`. Removing the two new reports and restoring the target count reproduces round four byte for byte.
- Checked every saved layout, decoded 92 map textures, 118 foreground textures and the four new story images, and verified their dimensions. A clean native rebuild reproduced both 3× maps and all five 3× fronts byte for byte. All six compositor and two sprite tests passed.
- Chromium captured the real opening waves and later combat at 1920 × 1080 DPR 1 and 2 and 844 × 390 DPR 3. Both desktop DPR 2 captures used the native 3× map and gate fronts. Each later battle had 15 live enemies, with eight towers on i21 and nine on i22. The Vite fixture staged the chapter roster, optional enemy clips and kill callback in browser memory as in round four. Twelve full-size combat/opening frames and the fixture are under `/tmp/skyhold-codex-r5`.

### Requests for other agents

- **Integrator / sim and loader owners.** The shared registrations listed in round three are still needed for the shipping campaign. The six authored chapter islands are ordered immediately after i16 when the roster is present. The unmodified shipping roster exposes the original 17 islands.
- **Opus / story and HUD.** Add i21 and i22 to `GENERIC_STORY_ISLANDS` with the four previous chapter ids. The wave horn on i21 covers the storage doorway and emerging troops. In a browser-only preview, passing map pixel **(257, 388)** to the HUD through `map.screenX/Y` seats the horn on open grass below the workshop at all three device settings. The shipping HUD still uses its shared entrance offset. [Current and proposed positions](maps-round5-horn.jpg)
- **Opus / i18n.** Add these entries to `DATA_TR.islands` in `src/i18n/dataTr.ts`. English names and subtitles are in the island files.

```ts
i21: { name: 'Uçurtmacı Çayırı', subtitle: 'Rüzgârı ölçen uçurtma düştü. Uçurtmacı kopan ipi sarana dek kayalıklardaki virajları savun.' },
i22: { name: 'Tuzcam Salı', subtitle: 'Salın halatı koptu. Son yük karşı kıyıya varana kadar iki tuz yolunu da savun.' },
```

Turkish wave names in play order for surfaces that display the authored titles.

- i21 — Kırık Çıta · Makara Boşalıyor · Yükselen Hava Akımı · Gerilmiş İki İp · Çıkrık Sıkışıyor · Tebeşir Kayalıklarından Geçiş · İpte Düğüm · Makarada Son Bir Tur · Uçurtma Havalanıyor · Çıtanın Üstünde · Kuyruk Fiyonkları · Posta Seferi
- i22 — Kopan Halat · Boş Tuz Çuvalları · Kuyudaki Işıklar · Sığ İskele · Yük Listesi · Tuzlu Suyun Üstünde Kanatlar · Maden Yolu Boyunca · Asılın Halata · Beyaz Altın · Karşı Ağırlık · Derin İskele · Suda Fener Işığı · Son Geçiş

### Next round

Build i23 and the i24 chapter boss island. Preserve the 39 existing balance reports. Make the final boss and its reinforcements take visibly different routes, and use the existing four enemy behaviours to distinguish the later waves. Shared roster activation, story selection, the Turkish lookups and i21's horn placement remain with the owners above.

## Round 4 · 00:15–00:42 UTC · codex/night

Started from `e406588`. The working tree is ready for the overnight runner.

### Done

- **i19 Lanternseed Fig** has 18 plots, two root roads around an old fig tree, an aerial shortcut across its crown and eleven hand-written waves. The upper lane brings hares out of a living root tunnel. The hollow nursery log opens onto the lower lane. Elite Kilnbacks travel with a Reed Piper there while the hares draw fire on the upper road.
- **i20 Three Pennants Head** has 20 plots and twelve hand-written waves. Yellow, red and blue flags identify the west shelter, east reef cave and upturned fishing boat. The boat road reaches the three-way junction first. The eastern road takes the long hook, giving players time to thin the boss escort before it meets the short-lane reinforcements.
- Both islands have original painted terrain, road material, four scenery pieces, entrance art for each lane, and an intro and outro panel. The keep paintings come from the orchard and tidal kits. Four map resolutions and separate 2× and 3× foregrounds ship for each island. The tree and the coastal inlet have their own plot and scenery exclusion masks. [Finished maps and story panels](maps-round4-islands.jpg) · [Asset locations and complete built-in imagegen prompts](../../design/art-2d/chapter2/islands.md)
- The compositor can now choose entrance art by lane and draw the approach from the actual feet of the jambs. On the first canopy bake, a square road end stopped beside the door and left grass in front of the black opening. Both verge curves now emerge from beneath the painting and meet the full road tangent. The new kits also reflect some of the road colour inside the mouth. The older recipes retain their original rendering. [Matched 2× threshold details](maps-round4-thresholds.jpg)

### Verification

| Master island | Greedy | Weak | Workshop-maxed lives lost | Greedy lives at −3%, −1.5%, baseline, +1.5%, +3% HP |
| --- | --- | --- | --- | --- |
| i19 | 9 lives, 2 stars | Lost on wave 8 of 11 | 4 | 5, 9, 9, 9, 8 |
| i20 | 6 lives, 2 stars | Lost on wave 7 of 12 | 8 | 10, 8, 6, 6, 5 |

- Chromium played the real opening and a later authored wave on both maps at 1920 × 1080 DPR 1 and 2 and 844 × 390 DPR 3. The fixture bought the level's scripted defenses with earned gold. Lanternseed Fig's sixth wave had 22 live foes and eight towers. The headland's fourth had 14 foes and seven towers. Each desktop DPR 2 capture waited for the native 3× map, and the recorded foreground texture widths confirm the native set. Twelve final frames and the reusable Vite fixture are in `/tmp/skyhold-codex-r4`. The fixture installed the round-three enemy registration, side/death sequences and kill callback in browser memory. [Canopy combat](maps-round4-i19-play.jpg) · [Storm coast combat](maps-round4-i20-play.jpg)
- All 21 saved layouts passed geometry checks. Decoded all 84 map textures, all 108 foregrounds and the four new story panels and checked their dimensions. A fresh staged `--only-3x` rebuild matched both published maps and all seven native gate fronts byte for byte. Six compositor tests and both sprite tests passed. The new test checks a shallow threshold from both directions at 1×, 2× and 3×.
- Node 22 release gate passed TypeScript, ESLint, Vitest (1,171 passed, 11 skipped), all 37 balance targets and the Vite production build. Vite emitted its chunk-size advisory. The 751-line balance stdout has SHA-256 `53ff4deb38dd32b69c54d5c5840fc65818c8f6e0bdfc7336ff254d57762e5c26`. Removing the two new reports and restoring the previous target count reproduces the entire round-three stdout byte for byte, including Endless and Workshop.

### Requests for other agents

- **Integrator / sim and loader owners.** The round-three activation request below still applies. The chapter data now orders i17, i18, i19 and i20 directly after i16. The shared enemy roster and melee profiles determine when these four become selectable in the shipping campaign. The balance CLI and chapter tests already exercise them.
- **Opus / story.** Include all four ids in `GENERIC_STORY_ISLANDS` in `src/render2d/ui/storyBeats.ts`. All eight panels are present in `paintedUi`. The existing world-map thumbnail fallback can read their layered maps.
- **Opus / i18n.** Add these two entries to `DATA_TR.islands` in `src/i18n/dataTr.ts`, alongside the round-three entries for i17 and i18 and the four enemy definitions. English strings are in the island data.

```ts
i19: { name: 'Fener İnciri', subtitle: 'Tohum sepetleri düşüyor. Yaşlı incir ağacının çevresini dolanan iki kök yolunu izle.' },
i20: { name: 'Üç Flama Burnu', subtitle: 'Üç fırtına flaması ipinden kopmuş. Tekneler kayalıkları geçene kadar burnu savun.' },
```

Turkish wave names in play order for surfaces that display the authored titles.

- i19 — Yırtık Sepet · Köklerin Altında · Dallardaki Kanatlar · Kabuk ve Kil · Üst Dal · Alt Dal · İp Merdiven · Kovuk Dal · Dökülen Meyveler · Kalın Kökler · İncirlerdeki Son Işık
- i20 — İlk Flama · Rüzgâr Altındaki Bayrak · Resif Kuşları · Üç Gözcü · İskandil İpi · Yan Rüzgâr · Dış Sığlık · Orta Sığlık · İç Sığlık · Direk Kırılıyor · Sığlıktaki Tekneler · Son Flama

### Next round

Build i21 and i22, then i23 and the i24 boss island. Use the four existing chapter kits where they fit, with new terrain paintings, distinct ground and air routes, and late waves that make the four enemies' counters matter. Keep the existing 37 balance reports byte-identical when adding targets. The last four islands, shared roster activation, story selection and Turkish lookup integration remain open.

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
