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

## Round 2 — Specialization rules, purchases and campaign builds

### Done

- All eight plot-tower families now have two exclusive tier-IV branches and one permanent purchasable ability per branch. Target acquisition, projectiles, chain lightning, beacon auras and barracks troops use the purchased stats. Each projectile keeps its launch-time stats through impact.
- Branch and ability purchases use gold, count towards the usual sell refund, emit economy/upgrade events and record canonical sim commands. The world rejects invalid purchases before changing gold, investment or replay history.
- Both campaign simulators use the same specialization build orders. On Normal, Lantern Glassworks (i18) buys Bell Foundry after the second ballista upgrade at plot 13 and clears at 7/22. Kitewright Down (i21) buys Farwatch Lodge and Throughshot at plot 18 and clears at 5/22. The existing island tuning is unchanged. Moving both i18 purchases immediately after its cannon reached T3 produced 19/22, above the 6–11 life target. The selected order cannot afford Aftershock before the Normal run ends.

### API and requests for Opus

- Read `specializationsFor(tower)` or `specializationsFor(type)` from `src/data/towers.ts` for both branch definitions. Each has `id`, `name`, `description`, `cost`, `changes` and `abilities[]`. Each ability has the same purchase fields except `abilities`. Stat changes are absolute replacements. `towerEntry(type).specializations` exposes the same catalog for the codex.
- For a plot tower at `tower.tier === 3 && !tower.specialization`, offer both branches. Call `world.specializeTower(tower.id, branch.id)`. For a specialized tower, find its chosen definition using `tower.specialization.id`; `tower.specialization.abilities` lists purchased IDs. Call `world.buyTowerAbility(tower.id, ability.id)`. Both calls return true only on a completed purchase. Abilities take effect automatically. No ability activation button is needed.
- Use `towerStats(tower)` for the effective tier, stats and range ring (then apply the existing aura/hero bonuses). `tower.tier` tracks the linear upgrades through III so existing three-slot art and legacy callers remain valid. `towerStats(tower).tier` returns IV for a specialized tower. The fourth-tier upgrade, firing, beacon-pulse and sale events carry numeric tier 4.
- In the owned 2D UI replay adapter, route the new ring actions through the same command path on input and playback. The sim supports `{kind:'specializeTower', towerId, specializationId}` and `{kind:'buyTowerAbility', towerId, abilityId}`. The canonical replay parser, player and hash already support both. The UI adapter in `src/render2d/ui/replay2d.ts` has its own command union. Opus also owns the localized codex presentation. The legacy MVP summary currently reports the linear tier.
- Barracks branches keep squad size, HP ceiling and rally radius. Purchasing a branch or an ability preserves wounds, formation, current fights and respawn timers. The new stats apply on subsequent swings, hits and deaths.

### EN / TR copy for Opus

English descriptions and costs are in the definitions. Each row gives the corresponding Turkish tooltips in branch, then ability order.

| Family | Branch EN / TR | Ability EN / TR | Branch tooltip TR | Ability tooltip TR |
|---|---|---|---|---|
| Archer | Farwatch Lodge / Uzak Nöbet Karakolu | Throughshot / Delip Geçen Ok | Uzun yaylar daha yavaş atış yapar ama daha uzağa erişir. Her ok 8 zırhı yok sayar. | Ok hedefi delip arkasındaki bir düşmana %75 hasar verir. |
| Archer | Swallow Roost / Kırlangıç Tüneği | Gathering Flock / Toplanan Sürü | Her üç atışta bir, yarı güçte iki ek ok fırlatır. | Her yaylımda dört ek ok fırlatır. |
| Cannon | Honeycomb Battery / Petek Bataryası | Wax Caps / Balmumu Kapsülleri | Her isabetin çevresinde halka biçiminde beş küçük bomba patlar. | Küçük bombaların her biri ana merminin yarısı kadar hasar verir. |
| Cannon | Bell Foundry / Çan Dökümhanesi | Aftershock / Artçı Sarsıntı | Tek bir ağır gülle geniş bir alana yüksek hasar verir. | Patlama düşmanları iki saniyeliğine %28 yavaşlatır. |
| Frost | Snowbell Garden / Kardelen Bahçesi | Deep Drifts / Kar Yığınları | Geniş bir alana yayılan kar, düşmanları dört saniyeliğine yavaşlatır. | Karın etki yarıçapı 3,4 birime, yavaşlatma oranı %55’e çıkar. |
| Frost | Rimeglass Needle / Kırağı İğnesi | Cold Fracture / Ayaz Çatlağı | Dar bir alana saçılan cam parçaları, soğuktan yavaşlamış düşmanlara ek hasar verir. | Cam parçaları isabet ettiğinde 12 zırhı yok sayar. |
| Tesla | Relay Grove / Yıldırım Korusu | Live Wire / Akım Teli | Yıldırım, daha geniş aralıkları aşarak yedi düşmana kadar sıçrar. | Her sıçrama bir önceki isabetin hasarının %94’ünü korur. |
| Tesla | Stormheart Coil / Fırtına Yüreği Bobini | Thunderbeat / Gök Gürültüsü | Kısa şimşekler en fazla üç düşmana vurur. Her dördüncü saldırı iki kat hasar verir. | Bobin her üçüncü saldırıda iki kat hasar verir. |
| Mortar | Cinder Kiln / Kor Ocağı | Banked Fire / Köz Ateşi | Mermiler ardında beş saniye yanan geniş köz yatakları bırakır. | Közler her vuruşta zırhı yok sayarak 16 hasar verir. |
| Mortar | Cloudbreak Mortar / Bulutdelen Havanı | Stone Petals / Taş Yapraklar | Hızlı ve ağır mermiler daha uzağa erişir. Havan, yakındaki hedeflere de atış yapabilir. | Her isabetin çevresinde üç parça patlar. |
| Ballista | Laneweaver Loom / Yol Dokuma Tezgâhı | Silk Line / İpek Hat | Uzun oklar ilk hedefi delip arkasındaki dört düşmana daha ulaşabilir. | Oklar hedefin sekiz birim ardına kadar ulaşır ve yol boyunca tam hasar verir. |
| Ballista | Anchor Winch / Çapa Çıkrığı | Drag Chain / Sürükleme Zinciri | Ağır zıpkın tek bir düşmana 230 hasar verir ve 22 zırhı yok sayar. | Zıpkınlar hedefi iki saniyeliğine %45 yavaşlatır. |
| Beacon | Tailwind Mill / Arka Yel Değirmeni | Full Sail / Tam Yelken | Değirmenin yakınındaki birlikler %38 daha hızlı saldırır. | Değirmenin saldırı hızı desteği %48’e çıkar. |
| Beacon | Horizon Lantern / Ufuk Feneri | Clear Lens / Berrak Mercek | Fener daha geniş bir alanı aydınlatır ve müttefiklerin menzilini %20 artırır. | Fener, müttefiklerin menzilini %30 artırır. |
| Barracks | Gateward Hall / Kapı Muhafızları Kışlası | Iron Mantle / Demir Pelerin | Kalkanlı muhafızların 9 zırhı vardır. Düşen muhafızlar beş saniyede geri döner. | Her kalkanlı muhafız 5 zırh daha kazanır. |
| Barracks | Briar Lodge / Diken Ocağı | Wide Sweep / Geniş Savuruş | Kancalı baltacılar 35 hasar verir. Savuruşları ikinci düşmana bunun %70’ini verir. | Savuruş ikinci düşmana da tam hasar verir. |

### Verification

TypeScript and lint passed. Vitest passed 1,366 tests with 11 skipped, including 22 new tests for all 16 branches, replay round trips, purchase rejection, refunds, projectiles, support and barracks. The full realistic-kit balance gate passed all 41 levels. The 24,217-byte standalone L1–L16 report matches the pre-specialization report byte for byte. All eight difficulty verdicts passed: Easy and Normal clear 25/25; Hard clears 12/17 and 3/8, with i09 at 12/22 and i24 at 5/22. Production build passed with the existing Vite chunk-size and dynamic-import warnings. This round changes rules and data only.

### Next round

Paint and hook up the two archer branches first, then carry the verified workflow across the other seven families. The directional families use separate body art and five turret facings; frost, tesla, beacon and barracks use full-body animation sheets. Inspect plot fit, release or muzzle registration, and scaled in-game screenshots. All 16 branch paintings are pending. Chapter-two map polish follows specialization art.

## Round 3 — Archer specialization art

### Done

- Farwatch Lodge has an amber-cloaked longbow scout, a navy star banner and a brass telescope. Swallow Roost has two green-hooded rangers on a broad timber deck with a carved swallow over the entrance.
- Both branches have keyed bodies, five-facing turret strips, measured arrow tips and southeast portraits. They use the existing eight-sector aim, recoil and projectile launch paths. The two Swallow operators share a frame and the leading ranger supplies the arrow origin.
- The live renderer requests branch art on first purchase. It draws the family art until the branch body and strip are both ready. Subsequent purchases of the same branch share those textures. The QA turret report exposes the visible branch ID and tier.
- Source atlases, ImageGen prompts and registration measurements are in [design/art-2d/specializations](../../design/art-2d/specializations/archer-prompts.md). Repack with `/usr/bin/python3 tools/sprites/pack_specialization_archers.py`. Keying uses the project chroma key with trimming disabled to preserve cell coordinates.

### Requests for Opus

The raw art manifest now has `towerSpecializations[id].portrait` and `.turret` for `farwatch` and `swallow`. Paths are relative to `/art2d/`. The portrait includes the building and its crew on transparency. Use it for the branch choice and codex. The turret descriptor references its body and five-frame strip relative to itself. Round 2 above has purchase calls, names and Turkish copy.

In `src/render2d/game2d.ts`, `towerReach` and `towerHasTarget` still read linear tier stats. Use `towerStats(t)` for the purchased tower's actual range and minimum range when wiring the branch UI. This covers the selected range ring and anticipatory aiming when a foe is in Farwatch's extended range. The sim already uses the purchased range and the renderer uses the exact sim yaw on a shot.

### Verification

- Bought both branches through the live world in the built game. The aim scene exercised all five painted frames, including mirrored southwest and northwest views, with 36 Farwatch and 57 Swallow shots in the production sample. The sampled drawn sectors agreed with the sim yaw within the renderer's hysteresis tolerance. Inspected all ten arrow registrations at enlarged scale.
- In the L1c screenshots, the towers from left to right are tier III, Farwatch Lodge and Swallow Roost. Checked both screenshots enlarged. The measured ring center, bottom and width errors were zero for all three towers at both viewport sizes. [1600×900 desktop](../../design/art-2d/specializations/archers-l1c.jpg) · [844×390 landscape phone](../../design/art-2d/specializations/archers-l1c-phone.jpg).
- TypeScript and lint passed. Vitest passed 1,367 tests with 11 skipped. Realistic-kit balance passed all 41 levels including all 25 islands, and all eight difficulty verdicts passed. Hard i09 ended at 12/22, Hard i24 at 5/22. The 24,217-byte L1–L16 report matched the pre-specialization baseline exactly.
- The production build passed with the existing Vite chunk-size and dynamic-import warnings. All eight published branch files matched their built copies byte for byte.

### Next round

Paint Honeycomb Battery and Bell Foundry. Verify their five facings, muzzle placement and blast recoil on the map. Fourteen of the sixteen branches still need art. Chapter-two map polish follows.

## Round 4 — Cannon and ballista specialization art

### Done

- Honeycomb Battery has a three-bore brass turret over a honey-lit blockhouse. Bell Foundry fires from a patinated bronze bell mouth on a red yoke. Its smaller casting bell hangs in the workshop below.
- Laneweaver Loom pairs an ashwood bow and ivory thread spools with an indigo weavers’ guildhall. Anchor Winch has a teal iron chain drum, barbed harpoon and anchor-marked harbor workshop.
- Each purchase has a keyed body, five-facing turret sheet, measured projectile origins and a southeast portrait. The existing lazy loader reads all four from the raw art manifest. The specialization asset test now covers all six branches across the three directional families.
- Repack these and both archers with `/usr/bin/python3 tools/sprites/pack_specialization_turrets.py`. The lossless source atlases retain their magenta backgrounds. [Cannon prompts and registration](../../design/art-2d/specializations/cannon-prompts.md) · [Ballista prompts and registration](../../design/art-2d/specializations/ballista-prompts.md).

### Requests for Opus

The manifest records `towerSpecializations[id].portrait` and `.turret` for `honeycomb`, `bellfoundry`, `loom` and `anchor`. The IDs match the data definitions. The earlier EN/TR copy and purchase API still apply. All six directional branch portraits are ready for the build ring and codex.

### Verification

- Checked all twenty source registrations enlarged. In the running production aim scene, Honeycomb Battery fired 21 times and Bell Foundry fired 19 times over their 23-second samples. Both displayed all five painted facings. The firing and settled frames show the flash at the painted muzzle, with the turret returning to position on its stationary workshop. [Cannon recoil detail](../../design/art-2d/specializations/cannons-recoil.jpg).
- Bought both cannons alongside a tier-III cannon in L1c. All three plot rings had zero center, bottom and width error at 1600×900 and 844×390. Inspected both screenshots enlarged. [Desktop](../../design/art-2d/specializations/cannons-l1c.jpg) · [Phone](../../design/art-2d/specializations/cannons-l1c-phone.jpg).
- Bought both ballistas alongside tier III. The desktop and landscape-phone plots also measured zero alignment error at both sizes. The aim scene displayed all five painted frames for each branch and counted 14 Loom and 13 Anchor shots. [Desktop](../../design/art-2d/specializations/ballistas-l1c.jpg) · [Phone](../../design/art-2d/specializations/ballistas-l1c-phone.jpg).
- All four strips passed dimension, transparent-padding and opaque-magenta checks. All sixteen published branch files and the manifest match their built copies byte for byte.
- TypeScript and lint passed. Vitest passed 1,367 tests with 11 skipped. Realistic-kit balance passed all 41 levels, including all 25 islands. All eight difficulty verdicts passed. Hard i09 finished at 12/22 and two stars, Hard i24 at 5/22 and one star. The 24,217-byte L1–L16 report matched the round-one baseline byte for byte. Production build passed with the existing Vite bundle warnings.

### Finding for the projectile renderer owner

In one frozen eastward Loom release, the airborne bolt points back toward the launcher. The painted bolt and the reported turret sector point east. The Anchor sample points forward. Inspect initial rotation on projectile-slot reuse in `src/render2d/projectileLayer.ts`; the cause is unconfirmed. Reproduce in `?towers=aim&type=ballista&tier=3&hold=2`, purchase `loom` and inspect the frame at a change in the shot count. [Firing / settled frame pairs, Loom above Anchor](../../design/art-2d/specializations/ballistas-release.jpg).

### Next round

Six of sixteen branches have production art. Start the full-body attack-sheet path with the two frost branches, Snowbell Garden and Rimeglass Needle. Check the ring across frames, pre-roll and projectile release against a frozen shot. Tesla, mortar, beacon and barracks art and chapter-two map polish remain.

## Round 5 — Frost and Tesla specialization art

### Done

- Snowbell Garden has a glazed greenhouse and three porcelain snowdrops. The flowers draw inward to charge and open together when they release the snow. Rimeglass Needle has an ice-clad slate tower and a cut-glass point that lights along its seam before firing from the tip.
- Relay Grove carries three turquoise terminals on copper branches. Its discharge bridges the terminals. Stormheart Coil turns two copper hoops around a cobalt thunderstone and fires from its center.
- Each branch has an eight-frame full-body sheet at 12 fps, a measured release point and a larger transparent portrait. Frame zero supplies the resting map sprite. The painted foundation stays fixed through anticipation, release and recovery. [ImageGen prompts and packing instructions](../../design/art-2d/specializations/frost-tesla-prompts.md).
- The renderer loads the branch sheet on purchase. A shot already waiting for a tier-III release finishes before the art changes. Subsequent pre-rolls, shot delays, flashes and bolt predictions use the displayed branch. The existing directional branches still use their separate body and turret. The QA plot ring report includes the visible specialization and painted attack frame.

### Requests for Opus

The raw art manifest now has `towerSpecializations[id].portrait` and `.attack` for `snowbell`, `rimeglass`, `relay` and `stormheart`. Both paths are relative to `/art2d/`. The UI can use the same portrait field across all ten painted branches. The branch and ability copy is in round 2 above.

### Verification

- The four final WebP sheets have transparent padding on every frame. The bottom 36% of each building is pixel-identical across the eight decoded frames. All four return exactly to their idle pose on frame seven. The opaque-magenta scan found zero pixels.
- Bought each branch in the production L1c map. The comparison shows tier III on the left and its two branches beside it. Ring center, bottom and width errors measured zero on desktop (1600×900) and landscape phone (844×390). Inspected the screenshots enlarged. [Frost desktop](../../design/art-2d/specializations/frost-l1c.jpg) · [Frost phone](../../design/art-2d/specializations/frost-l1c-phone.jpg) · [Tesla desktop](../../design/art-2d/specializations/tesla-l1c.jpg) · [Tesla phone](../../design/art-2d/specializations/tesla-l1c-phone.jpg).
- In four 12-second combat samples stepped at 60 Hz, every branch showed frames 0–7 and returned to rest. Each frost branch fired 17 times, including 16 pre-rolled shots. Each Tesla branch fired 14 times, including 13 pre-rolled shots. Every pre-rolled shot landed on release frame 3. Frozen shots showed a frost projectile spawning or the lightning bolt count incrementing on that frame. Enlarged captures show charge, release and recovery from left to right. [Frost release](../../design/art-2d/specializations/frost-release.jpg) · [Tesla release](../../design/art-2d/specializations/tesla-release.jpg).
- The realistic-kit balance gate passed all 41 levels. All eight difficulty verdicts passed, with Hard i09 at 12/22 and Hard i24 at 5/22. The 24,217-byte L1–L16 report matched the round-one baseline. The production build contained byte-identical copies of all twelve new published files and the manifest.
- TypeScript, lint and the production build passed. Vitest passed 1,371 tests with 11 skipped, including asset registration checks for all four new sheets. The all-map backdrop test hit its five-second timeout in two default-concurrency runs. The full suite passed with two workers and the original timeout. Vite reported its existing bundle warnings.

### Next round

Ten of sixteen specializations have production art. Paint Cinder Kiln and Cloudbreak Mortar next. Mortar aims by mirroring and tilting its full sprite. Its shot handler currently reads the linear-tier ring and tip when it recomputes the aimed muzzle. Use the branch measurements there when adding mortar art and verify leftward and rightward launches. The remaining four branches belong to beacon and barracks. Chapter-two map polish follows.

## Round 6 — Mortar and beacon specialization art

### Done

- Cinder Kiln fires from an iron-bound terracotta crucible above a glowing brick firebox. Cloudbreak Mortar has a scalloped enamel launcher on a teal-roofed observatory. Each has a keyed eight-frame attack sheet, a resting portrait and a measured mouth on release frame three. [ImageGen prompts and packing instructions](../../design/art-2d/specializations/mortar-prompts.md).
- The mortar shot handler now uses the visible branch’s ring and mouth coordinates when it mirrors and pitches toward the target. The turret QA report includes the drawn mortar branch and tier.
- Tailwind Mill turns four blue-striped canvas sails on a fixed axle. Horizon Lantern sweeps amber light across a Fresnel lens. Both use the existing beacon pulse event. [ImageGen prompts and packing instructions](../../design/art-2d/specializations/beacon-prompts.md).

### Requests for Opus

The raw manifest now exposes `towerSpecializations[id].portrait` and `.attack` for `cinderkiln`, `cloudbreak`, `tailwind` and `horizon`. Portrait and descriptor paths are relative to `/art2d/`. The round-two table has the branch and ability copy in EN and TR. The earlier range-ring request also covers Cloudbreak’s longer reach and smaller blind spot.

### Verification

- Tested the release coordinates inside the firing event and again after rendering. Both mortars fired 24 times in the aim scene. The difference from the independently transformed painted mouth was zero layout pixels on every sampled shot. The comparison shows eastward and westward launches, Cinder above Cloudbreak. [Release detail](../../design/art-2d/specializations/mortar-release.jpg).
- The L1c plot comparison shows tier III, Cinder and Cloudbreak from left to right. Ring center, bottom and width errors measured zero at both sizes. Inspected the towers enlarged. [Desktop](../../design/art-2d/specializations/mortar-l1c.jpg) · [Landscape phone](../../design/art-2d/specializations/mortar-l1c-phone.jpg).
- All four sheets passed decoded WebP checks for dimensions, transparent gutters, zero opaque magenta and a pixel-identical foundation across every frame. Frame seven returns to the resting image.
- Bought both beacon branches beside tier III on L1c. Ring center, bottom and width errors were zero on desktop and landscape phone. Each beacon received five pulses in a twelve-second combat sample stepped at 60 Hz. Every pulse started on frame zero, and both branches displayed all eight frames and returned to rest. Inspected enlarged map and pulse captures. [Desktop](../../design/art-2d/specializations/beacon-l1c.jpg) · [Landscape phone](../../design/art-2d/specializations/beacon-l1c-phone.jpg) · [Pulse detail](../../design/art-2d/specializations/beacon-pulse.jpg).
- TypeScript, lint and the full default Vitest suite passed with 1,375 tests passing and 11 skipped. The realistic-kit gate passed all 41 levels, including all 25 islands. All eight difficulty verdicts passed. Hard i09 finished at 12/22 and Hard i24 at 5/22. The 24,217-byte L1–L16 report matched the round-one baseline byte for byte.
- The gate command reached its execution time limit while starting the production build. The standalone production build completed with the existing Vite bundle warnings. All twelve new published files and the manifest matched their copies in both the browser proof build and the final build.

### Next round

Fourteen of sixteen specializations have production art. Paint Gateward Hall and Briar Lodge, then exercise their gate animations on actual soldier spawns and respawns. Chapter-two map polish on i17–i24 follows.

## Round 7 — Barracks specialization art

### Done

- Gateward Hall raises a bronze portcullis beneath a blue sun banner. Briar Lodge swings two oak doors into the shadow of a leaf-roofed watchhouse. Each branch has a keyed eight-frame sheet, a transparent closed-gate portrait and a stationary plot ring. Repainted the original low buildings as taller towers after comparing them with tier III on a phone. [ImageGen prompts and packing instructions](../../design/art-2d/specializations/barracks-prompts.md)
- Fixed a missed spawn animation in the tower renderer. The sim creates the starting squad before the tower sprite exists. The renderer now collects the barracks IDs until the next draw and plays the gate once per spawning squad. A recruit arriving on a tier upgrade uses the new tier’s gate. A branch sheet arriving mid-animation picks up the current playback time.
- All sixteen specialization IDs now have painted map art and portraits. The simulation, purchase API and EN/TR copy are documented in round 2.

### Verification

- Bought tier III, Gateward and Briar side by side on L1c. The ring center, bottom and width matched all three plots exactly at 1600×900 and 844×390. Inspected enlarged captures from both viewports. [Desktop](../../design/art-2d/specializations/barracks-l1c.jpg) · [Landscape phone](../../design/art-2d/specializations/barracks-l1c-phone.jpg)
- Stepped a production melee scene against Basalt Golems at 60 Hz. On each run, placing the barracks spawned two soldiers and upgrading recruited a third. Both bursts began on gate frame zero. A fallen Gateward guard returned after its five-second timer and a Briar fighter after seven seconds. Both gates played frames 0–7 and settled closed. The battle captures include the normal spawn dust. Each inset shows the corresponding doorway from the decoded sheet. [Gate playback](../../design/art-2d/specializations/barracks-gates.jpg)
- Both WebP sheets have transparent gutters, zero opaque magenta pixels and pixel-identical closed poses at frames zero and seven. Pixel differences over the eight frames are confined to the registered doorway and its resampling edge.
- The integration regression test exercises the first squad and tier-up recruit through real world purchases and Pixi sprite updates. The browser and final builds contain all 54 specialization asset files. Repacking all ten full-body branches reproduced all 30 sheets, portraits and descriptors byte for byte.
- TypeScript, lint and the production build passed. Vitest passed 1,378 tests with 11 skipped. The existing all-map backdrop test intermittently reached its five-second timeout at default concurrency. The final full suite passed with two workers and the original timeout. Vite reported its existing bundle warnings.
- The realistic-kit balance gate passed all 41 levels, including all 25 islands. All eight difficulty verdicts passed. Hard i09 finished at 12/22 with two stars and Hard i24 at 5/22 with one. The 24,217-byte L1–L16 simulation report matched the round-one baseline byte for byte.

### Requests for Opus

Use `towerSpecializations[id].portrait` for the branch choice and codex across all eight families. The two new IDs are `gateward` and `briar`. Their `.attack` fields point to the full-body gate descriptors. The build-ring and localized codex integration remain with Opus.

### Next round

Start chapter-two map polish at Cloudbell Cloister (i17). The current bake has two matching entrance caves and repeats small bell frames on the meadow. The introductory painting already establishes a fallen bronze bell and a frayed blue rope. Bring that landmark onto the playable island and check it against the saved plots, tower envelopes and HUD at both viewport sizes. The remaining map pass covers i18–i24.

## Round 8 — Cloudbell Cloister and Lantern Glassworks

### Done

- **i17 Cloudbell Cloister.** The cracked bronze bell and frayed blue rope from the intro lie beside the broken colonnade. Raiders from the east emerge through a limestone arcade and follow courses of flagstones to the junction. The western cave and shared switchback have a chalk surface. Repeated freestanding bell frames have been removed from the meadow. [Desktop combat](../../design/art-2d/chapter2/polish/i17-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i17-phone.jpg)
- **i18 Lantern Glassworks.** The walk-through entrance shares a copper furnace with a glowing firebox. Three lanterns hang above a glassblower’s bench near the old kilns. The ore-cart road carries shallow wheel ruts through slate, ash and fragments of colored glass. The initial track had a similar brightness to the cavern floor on parts of the bend. The shipped strip uses a lighter ash finish. [Desktop combat](../../design/art-2d/chapter2/polish/i18-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i18-phone.jpg)
- Rebuilt all four map resolutions per island and the matching gate foregrounds. The layout diff contains just the art identifiers and foreground bounds of the two repainted entrances. The saved ground and flight paths, 43 build plots, wave definitions and balance data are unchanged. [Native gate and landmark details](../../design/art-2d/chapter2/polish/i17-i18-detail.jpg) · [Built-in ImageGen prompts, source kits and rebake command](../../design/art-2d/chapter2/second-pass.md)

### Verification and decisions

- The wave horn covered the bell in the first combat captures, and the phone cropped part of the bench. Moved the bell to the meadow below the western bend and the bench to the kiln side of the return bend. Both complete silhouettes clear the actual HUD pieces and viewport in all ten final samples. The compositor also checked the saved tower envelopes and roads. Both landmarks sit entirely inside their island’s dressing mask.
- Played the opening wave with Bran and three towers purchased with starting gold. Each final combat capture contains eleven ground enemies. Inspected enlarged desktop EN and landscape-phone TR screenshots. The 1600×900 desktop at DPR 1 used the 1.5× map, the 844×390 phone at DPR 2 used 1×, and the 1600×900 desktop at DPR 2 streamed both native 5538×2556 maps with the matching gate fronts. All ten HUD checks reported zero overlaps.
- Sampled both new entrance foregrounds along the walkers’ line in the master and native exports. At the spawn point the arcade alpha was 232/255 and the furnace alpha was 235/255. Their foregrounds cleared the lane completely by 24 and 16 layout pixels respectively. All 18 shipped WebPs decoded and matched their final production copies byte for byte.
- TypeScript, lint, production build and all 22 Python map-dressing tests passed. The full Vitest suite passed with two workers, 1,378 tests passing and 11 skipped. Realistic-kit balance passed all 41 levels. Normal finished i17 at 8/22 and i18 at 7/22. All eight difficulty verdicts passed, including Hard i09 at 12/22 and Hard i24 at 5/22. The 24,217-byte L1–L16 report matches the round-one baseline. Vite emitted its existing bundle warnings.

### Finding for Opus

At 844×390 in Turkish, the current fit leaves a large right-side area behind the HUD. The prior build covered 71.0% of the phone viewport on i17 and 70.2% on i18. The new captures measured 70.9% and 71.0% respectively. On i18 this clips the outer left edge of the furnace while keeping its doorway and the complete glassblower’s bench visible. The phone captures above show the tradeoff for any future HUD or camera-fit pass.

### Next round

Six chapter-two islands remain for the second map pass, i19–i24. Start with Lanternseed Fig (i19). Its two root entrances and central fig tree already have distinct paintings. The canopy keeper’s seed baskets and rope ladder from the story offer a way to distinguish the nursery approach from the upper loop.

## Round 9 — Lanternseed Fig and Three Pennants Head

### Done

- **i19 Lanternseed Fig.** The canopy keeper’s seed hoist stands beside the hollow log. Its basket, rope ladder and red bandana connect the nursery to the story panels. Walkers leave the log over split fig boards and reach the red clay at the first bend. Ferns and bromeliads replace most of the repeated baskets in the clearing. [Desktop combat](../../design/art-2d/chapter2/polish/i19-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i19-phone.jpg)
- **i20 Three Pennants Head.** A red pilot boat rests on rollers beside the blue boat shelter. The southern lane starts on a timber slipway, the eastern red-flag lane follows courses of basalt setts, and the yellow-flag lane leads over shingle. The three surfaces are visible together when wave two brings enemies from every entrance. [Desktop combat](../../design/art-2d/chapter2/polish/i20-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i20-phone.jpg)
- The compositor lays the timber across each lane as it turns and reserves a road width before the junction. A regression test checks grain orientation and both stopping limits at three scales. Rebuilt the four map resolutions and seven pairs of gate foregrounds. Both layout JSON files match the round-start versions byte for byte. [Native details](../../design/art-2d/chapter2/polish/i19-i20-detail.jpg) · [Four source paintings, ImageGen prompts and rebake command](../../design/art-2d/chapter2/second-pass.md#lanternseed-fig-and-three-pennants-head)

### Verification and decisions

- Both landmarks fit inside the land mask and clear the roads and saved tower envelopes. Played the production maps with Bran, Tesla, barracks and archer bought from starting gold. The i19 captures show 15 enemies on wave one. The i20 captures show 27 on desktop and 28 on phone after an early call of wave two. Inspected both landmarks and the occupied approaches enlarged.
- Both maps loaded at 1.5× on the 1600×900 desktop and 1× on the 844×390 landscape phone. The high-density desktop streamed the native 5538×2556 maps and their matching fronts. The landmarks stayed fully on screen and outside every reported HUD rectangle in all ten samples. The Turkish phone fit still uses roughly 71% of the viewport on both maps, consistent with the round-eight camera finding for Opus.
- TypeScript, lint and production build passed. Vitest passed 1,378 tests with 11 skipped using two workers and the original timeout. At default concurrency the existing all-map backdrop test exceeded five seconds. All 23 Python dressing tests passed. All 22 published WebPs decoded and matched the production build byte for byte. Vite reported its existing bundle warnings.
- The realistic-kit balance gate passed all 41 levels. Normal ended i19 at 10/22 and i20 at 7/22. All eight difficulty verdicts passed, including Hard i09 at 12/22 and Hard i24 at 5/22. The 24,217-byte L1–L16 report matches the round-one baseline.

### Next round

Four chapter-two islands remain for the second pass, i21–i24. Start with Kitewright Down. Its central fallen kite and windlass already read clearly. The store entrance and the long upper chalk bend have room for the kitewright’s sailmaking details. Check any new placement against the flight line across the kite and the saved plots. There are no new requests for other agents this round.

## Round 10 — Kitewright Down and Brineglass Ferry

### Done

- **i21 Kitewright Down.** A patched sail sits on its stretching frame outside the kite store. The white hare from the intro holds a length of red ribbon on the grass inside the upper bend. The chalk road has embedded flint and dusty turf edges. The flight line stays clear above the fallen weather kite. [Desktop combat](../../design/art-2d/chapter2/polish/i21-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i21-phone.jpg)
- **i22 Brineglass Ferry.** The west mooring has a repair frame with a frayed cable, hanging block and amber lantern. Cart ruts follow a pearl-grey salt road around the pool. Freight porters leave their shed over courses of blue-green slate and join the mine road at a transverse row of paving. [Desktop combat](../../design/art-2d/chapter2/polish/i22-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i22-phone.jpg)
- Rebuilt both islands at all four resolutions with their matching gate fronts. Both layout JSONs match the round-start files byte for byte. [Native detail from both maps](../../design/art-2d/chapter2/polish/i21-i22-detail.jpg) · [Six source paintings and rebake instructions](../../design/art-2d/chapter2/second-pass.md#kitewright-down-and-brineglass-ferry)

### Verification

- Both island recipes pass the compositor’s checks against all 40 saved plots. The three new landmarks fit entirely inside their land masks. The first proposed position of the ferry frame overlapped a tower envelope. The west mooring has room for a 60-pixel frame.
- The first salt-road bake blended into the cavern floor. Lifted the midtones for the mine lane and matched the repeated edges of the freight flags to remove a visible join at the bend.
- Bought the scripted opening Tesla, barracks and archer on i21, then called waves two and three early. Inspected enlarged desktop and phone captures with 46 enemies active, including flyers on the route across the kite. Both landmarks cleared the HUD at both sizes. The high-density desktop streamed the native 5538 × 2556 map and its matching fronts.
- All eight difficulty verdicts passed. Normal finished i21 at 5/22 and i22 at 8/22. Hard finished i09 at 12/22 and i24 at 5/22. The 24,217-byte L1–L16 simulation report matches the round-one baseline byte for byte.
- On i22, the first wave brought three Kilnbacks down the mine road and ten raiders through the freight shed. Checked the two occupied lanes, slate joints and repair frame enlarged on desktop EN and phone TR. The new art cleared every HUD rectangle in all ten opening, combat and high-density samples across the two islands. All 18 published map and gate WebPs decoded and matched the production build byte for byte.
- TypeScript, lint, the production build and all 23 Python dressing tests passed. Vitest passed 1,378 tests with 11 skipped using two workers and the original timeout. The default-concurrency attempt hit the existing five-second all-map backdrop test timeout. Realistic-kit balance passed all 41 levels, including all 25 islands. Vite emitted its existing bundle warnings.

### Finding for Opus

At 844 × 390 in Turkish the camera fit covers 64.6% of the viewport on i21 and 64.4% on i22. The open gutter sits on the left on i21 and the right on i22. On i22 the phone crops the outer west wall of the freight shed. The doorway, porters and both new road surfaces are visible. The round-start captures show the same camera fits.

### Next round

Waxlight Orchard (i23) and Lastlight Head (i24) remain. Start at the orchard’s cider-press lane. The beekeeper’s beeswax taper connects the orchard outro to the keeper in the finale, and the two entrances currently share the same red loam. The finale already has its dark beacon, stepping slabs and tern roost.

## Round 11 — Waxlight Orchard, Lastlight Head and late chapter-one encounters

### Done

- **i23 Waxlight Orchard.** The beekeeper’s last load of dipped candles waits on a handcart between the pear crates and the cider press. Raiders from the press follow a curved brick lane into the rutted orchard road. In the opening-wave captures, 15 raiders are moving along the two routes. [Desktop combat](../../design/art-2d/chapter2/polish/i23-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i23-phone.jpg)
- **i24 Lastlight Head.** The keeper shelters the orchard taper beside the steps to the dark beacon. Runners climb worn granite steps from the western boat shelter. The fort column takes the basalt road, and the reef raiders take the shingle. Called wave two early to inspect all three occupied approaches together. [Desktop combat](../../design/art-2d/chapter2/polish/i24-desktop.jpg) · [Phone combat](../../design/art-2d/chapter2/polish/i24-phone.jpg)
- This finishes the second map pass on i17–i24. The two new recipes passed the saved-plot checks for all 43 plots. Both new landmarks sit wholly on the dressing masks. The desktop and phone opening and combat samples and the two native-resolution samples kept both landmarks clear of the HUD. The four map resolutions and seven pairs of gate fronts decoded and matched the production copies. Both layout JSON files match the round-start versions byte for byte. [Native details](../../design/art-2d/chapter2/polish/i23-i24-detail.jpg) · [ImageGen prompts, source kits and rebake command](../../design/art-2d/chapter2/second-pass.md#waxlight-orchard-and-lastlight-head)
- **Late chapter one.** Moonwell Crossing (i15) sends six Slipstream Moths along its flight path in wave four, *Veil of Mist*. Emberglass Sanctum (i16) sends three Kilnback Tortoises down the second ring road in wave three, *Gatecrash*. Each is a single formation substitution on the painted map, using the existing art, abilities and EN/TR foe entries. The formation test checks the two source formations and the complete resulting wave lists.

### Balance and decisions

- Kept the original group sizes, lane assignments, spawn intervals, rewards for clearing waves, starting gold and HP tuning. With the realistic kit, Normal i15 goes from 11/22 to 9/22 and i16 from 11/22 to 10/22. Both stay at two stars. The weak build still loses at wave 19 of 22 and wave 23 of 24 respectively.
- All 41 realistic-kit levels and all eight difficulty verdicts passed after the encounter changes. Easy and Normal clear 25/25. Hard clears 12/17 in chapter one and 3/8 in chapter two. Hard i09 ends at 12/22 and Hard i24 at 5/22. The 24,217-byte standalone L1–L16 simulation report matches the round-one baseline byte for byte.

### Verification and handoff

- Inspected enlarged combat screenshots at 1600 × 900 in English and 844 × 390 in Turkish. The production camera chose the 1.5× and 1× maps on those devices. A 1600 × 900 desktop at DPR 2 streamed both native 5538 × 2556 maps and all matching gate fronts. The phone fit covers 73.2% on i23 and 72.7% on i24. All ten HUD checks passed. No additional UI action is needed for these maps.
- Used the world’s QA wave selector in the production game to start each new encounter. Both device captures contain six airborne moths and three tortoises on lane 1 in their respective waves. The moths show their paired trails as they close on the lead flyer. [Desktop and phone details](../../design/art-2d/chapter2/polish/i15-i16-encounters.jpg)
- TypeScript, lint and all 23 Python dressing tests passed. Vitest passed 1,378 tests with 11 skipped using one worker and the original timeout. In the earlier two-worker run, the all-map backdrop placement test exceeded its five-second limit.
- The combined gate command was terminated during its balance run after Vitest passed. Reran the full balance simulation and production build successfully. The final build has byte-identical copies of all 22 map and gate WebPs. Vite emitted its existing bundle warnings.
- No new localization is needed for these encounters. Opus’s specialization build ring and codex presentation continue to use the round-two API and all sixteen branch portraits.

### Next round

All four assigned backlog items now have content and balance coverage. Start the next quality audit with specialization textures on a slow or interrupted connection. In `src/render2d/towerLayer.ts`, a failed branch load leaves its ID cached with a null value. Reproduce a transient asset failure during a purchase and check recovery and projectile release after the texture becomes available.
