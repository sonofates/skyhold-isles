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

## Round 12 — Specialization art after an interrupted purchase

### Done

- Reproduced the reported failure in the round-start production build by returning HTTP 503 for Rimeglass Needle’s attack sheet at purchase. After the connection recovered, the tower fired 17 times over 12 seconds of play. The browser had requested the sheet only once and the map still showed tier III.
- The tower layer now retries failed branch requests while a tower of that branch is on the map. It waits one second of render time after the first failure, then doubles the interval up to 30 seconds. Towers of the same branch share one in-flight request. Selling the last tower stops further attempts. A missing catalog entry or invalid art registration keeps the family fallback.
- A regression test buys Rimeglass for two frost towers, interrupts the catalog and descriptor requests, and holds the successful sheet download. One tower can switch immediately while the other completes its queued shot. The test verifies the release delay and the muzzle coordinates for both paintings.
- Corrected Relay Grove’s English description in the shared tower and codex data. Its sixth discharge inherits the tier-III overload and can reach an eighth foe. A nine-foe combat test recorded 7, 7, 7, 7, 7, 8 and 7 targets on consecutive discharges.

### Production checks

- On L1c, the Rimeglass sheet request returned 503, then 200. Held the second response until a tier-III shot began, released the download, and stepped the game at 60 Hz. The old sheet reached frame three and emitted its nine muzzle particles before the tower changed. A subsequent Rimeglass shot released on its own frame three with a projectile active. Plot center, bottom and width errors were zero throughout.
- In the cannon aim scene, Bell Foundry’s turret strip loaded but its body request returned 503. The tier-III cannon kept aiming and firing while the body was missing. The body loaded on its second request and the strip was fetched once. The recovered east-facing muzzle matched the painted tip to within 0.001 map pixel. [Enlarged combat captures](../../design/art-2d/specializations/texture-recovery.jpg)

### Request for Opus

Update the Relay Grove branch tooltip in both locales to match the corrected data. EN “Lightning crosses wider gaps to hit up to seven foes. Every sixth discharge can hit an eighth.” TR “Yıldırım daha geniş aralıkları aşarak yedi düşmana kadar sıçrar. Her altıncı saldırıda sekizinci bir düşmana da ulaşabilir.” Costs and ability text are in round 2.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,380 tests with 11 skipped using one worker and the original timeouts. The first combined gate after the tooltip change was terminated during Vitest. The rerun completed the suite, the full balance simulation and the build. All 41 realistic-kit levels and all eight difficulty verdicts passed, including Hard i09 at 12/22 and Hard i24 at 5/22. The standalone L1–L16 report matched the 24,217-byte round-one baseline byte for byte. Vite reported its existing bundle warnings. Both local preview servers were stopped.

### Next round

The four original backlog items are complete. Continue the combat audit at projectile impact. The current Farwatch regression checks Throughshot’s stats at launch. Exercise the secondary hit on an armored foe, then repeat after selling the firing tower while the arrow is in flight. Compare damage, kill credit and replay outcomes.

## Round 13 — Farwatch Throughshot at impact

### Done

- Added a two-golem encounter to the specialization tests. The player buys Farwatch Lodge and Throughshot, fires twice, and either keeps the lodge or sells it and builds a tier-I archer on the same plot while the second arrow is airborne. Both cases use ordinary wave spawns, tower acquisition and recorded player commands.
- Each Basalt Golem starts with 102 HP and 12 armor. The first arrow deals 71 to the lead golem and 52 to the one behind it. Eight points of armor pierce apply separately to each hit. The second arrow removes the remaining 31 and 50 HP in both cases.
- Both runs award two world kills, 20 gold in bounties and the 15-gold wave bonus. The standing lodge earns 204 damage and two kills. In the sale case, the lodge has 123 damage when sold and the replacement archer finishes with zero damage, shots or kills. Both serialized replays reproduce all four hits in order and match their respective win and final state hash.

### Campaign check and decision

On Normal Kitewright Down (i21), the realistic kit with level-20 Bran bought Throughshot on plot 18 in wave 12. Of 47 primary impacts that could pierce, 33 damaged a second foe, dealing 1,764 additional damage and earning two secondary kills. The island finished at 5/22 lives and one star. Kept the existing combat rules, price and scripted purchase timing.

### Verification

TypeScript, lint and the production build passed. Vite emitted its existing chunk-size and dynamic-import warnings. Vitest passed 1,382 tests with 11 skipped using one worker. Realistic-kit balance passed all 41 levels, including all 25 islands. All eight difficulty verdicts passed. Hard i09 finished at 12/22 with two stars and Hard i24 at 5/22 with one star. The standalone 24,217-byte L1–L16 report matched the round-one baseline byte for byte.

### Next round

Audit Cinder Kiln’s Banked Fire beside a tier-III mortar. The shared burn tick visits patches in pool-slot order and suppresses further hits on each enemy for that tick. Compare damage and tower credit when the stronger and weaker patches land in opposite orders. No new art, UI or localization requests this round.

## Round 14 — Cinder Kiln and overlapping mortar burns

### Done

- Reproduced a landing-order bug with Banked Fire and a tier-III mortar firing at the same Basalt Golem. Both shells dealt 146 damage, leaving 24 HP. When the kiln's patch landed first, its embers finished the golem in two ticks of 16 and 8. When the tier-III patch landed first, it took credit for three ticks of 5, and the golem survived until the kiln hit it again.
- Each ground enemy now takes one burn tick from the strongest patch covering its position. That patch's tower receives the actual damage and kill credit. Equal-strength patches keep their existing pool-slot priority. The priority applies only when damage ticks, preserving the slot order used for rendering, expiry and reuse.
- Both landing orders now finish with the same four hits. The kiln earns 170 damage and one kill, the tier-III mortar earns 146 damage, and the player earns one 10-gold bounty and the 15-gold clear bonus. Both serialized replays reproduce the hit sequence, final hash and win. A separate two-mortar test checks tie credit on a lethal overlap and damage to a second foe standing in only one patch.

### Verification

All eight difficulty verdicts passed. Easy and Normal cleared all 25 islands. Hard cleared 12/17 in chapter one and 3/8 in chapter two, including i09 at 12/22 and i24 at 5/22. The 24,217-byte standalone L1–L16 balance report matched the round-one baseline byte for byte. The full 41-level balance report and the difficulty report also matched round 13 byte for byte. TypeScript, lint and the production build passed. Vitest passed 1,384 tests with 11 skipped using one worker. Vite reported its existing chunk-size and dynamic-import warnings.

### Next round

Audit Swallow Roost's Gathering Flock in sparse and crowded waves. Check how the four extra arrows divide among eligible foes, where spare arrows go when targets run out, and whether the volley keeps Tobb's Tinker range bonus and the beacon's range bonus at the edge of coverage. No cross-agent changes requested.

## Round 15 — Swallow Roost volley targeting

### Done

- Reproduced a spare arrow hitting a grunt 3.54 units from the primary. The grunt occupied a corner of the spatial query's square, outside the intended 3.2-unit circle. Swallow Roost now checks the exact distance after the grid lookup. This rule is on the branch definition and applies before and after buying Gathering Flock.
- Six combat tests cover the branch's third-shot cadence, a mid-cycle ability purchase, sparse and crowded groups, burrowed enemies, and flyers. In a crowd the four extra arrows each hit a different nearby foe for 19 damage. Against a lone eligible target the primary arrow and all four extras deal 114 damage together. With one flyer exactly 3.2 units from the primary, the flyer takes 19 and the primary takes 95.
- Verified the range edge with no support, Tobb's Sighting Lenses, Horizon Lantern's Clear Lens, and both together. The last combination extends the tower's reach from 6.9 to 9.522 units. A flyer at the edge takes a secondary hit and a stronger grunt 0.01 units past it draws no arrows.

### Campaign replay

A single-archer run on Meadow Crossing used the standard starting gold and level-20 Tobb. Plot 11 bought Swallow Roost on wave three and Gathering Flock on wave four. Of 126 five-arrow volleys, 24 went to one foe, 61 reached two, 14 reached three, 12 reached four and 15 reached five. The single-tower build lost. Playback of the serialized commands reproduced all 150 branch volleys target for target, the loss and the final state hash.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,390 tests with 11 skipped using one worker. All 41 realistic-kit levels and all eight difficulty verdicts passed. Hard i09 finished at 12/22 with two stars and Hard i24 at 5/22 with one star. Both full reports match round 14 byte for byte. The standalone 24,217-byte L1–L16 report matches the round-one baseline. Vite reported its existing chunk-size and dynamic-import warnings.

### Next round

Audit Honeycomb Battery's Wax Caps on armored ground foes at the main impact and the edge of two overlapping charges. Check the effect of buying Wax Caps while a shell is airborne. No new UI or localization requests.

## Round 16 — Honeycomb Battery impact and campaign build

### Done

- Added a four-lane encounter with one armored Basalt Golem per lane. On the first shell, the golem at the crater took 80 damage. The golem near a charge center took 39 from the main blast, then 20 from the charge. With Wax Caps bought before launch, that charge dealt 34. The golem just inside two charges took 6 and 6 without the upgrade, or 14 and 13 with it. The golem just outside both took zero.
- Buying Wax Caps while the first shell was airborne gave the first and second shells their respective launch-time damage. The second shell’s ring rotated and reached the fourth lane for 16 damage, versus 8 without the purchase. All three purchase timings reproduced every hit, all five charges per shell, the final state hash and the win on replay. Each battery earned exactly the damage it dealt and two kills.
- Brineglass Ferry’s realistic build now buys Honeycomb Battery on plot 14 after upgrading the second Tesla on plot 8. Level-20 Bran’s Normal run bought the branch in wave 10 and Wax Caps in wave 11. The battery fired 20 shells before buying the ability and 88 afterward. It earned 30,343 damage and 24 kills after the ability purchase. The island finished at 8/22 lives and two stars, matching the previous build. Buying the branch immediately at cannon tier III left the same kit at 2/22, below the 4–9 life target.

### Request for Opus

The Wax Caps tooltip now describes base damage. Each charge loses damage with distance, then meets the target’s armor separately. EN “Each charge’s base damage rises from 35% to 50% of shell damage.” TR “Her küçük bombanın temel hasarı, mermi hasarının %35’inden %50’sine çıkar.”

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,393 tests with 11 skipped using one worker. Vite emitted its existing bundle warnings. Realistic-kit balance passed all 41 levels. The only changes to the balance report are i22’s purchases and gold accounting. The final difficulty report matched round 15 byte for byte, including all eight passing verdicts, Hard i09 at 12/22 and Hard i24 at 5/22. The standalone 24,217-byte L1–L16 report matched the round-one baseline byte for byte.

### Next round

Audit Rimeglass Needle’s Cold Fracture on fresh and already chilled armored targets in the same splash. Check the order of damage, armor piercing, brittle bonus and slow application when the first hit cracks a Basalt Golem’s armor.

## Round 17 — Rimeglass Needle and Cold Fracture

### Done

- Added a combat regression with two Basalt Golems on one road. The first shard chills the lead golem. Half a second after the lead, a fresh elite enters the same splash with its full 13 armor.
- Without Cold Fracture, the second shard deals 59 to the chilled lead and 21 to the fresh elite. Buying the ability before combat raises those hits to 62 and 33. The lead's existing 42% slow supplies the 71.4% brittle bonus. At the elite's position, splash falloff leaves 34 base damage and one point of its armor survives the pierce. Both golems take damage before the new slow applies. Each shell of basalt cracks once.
- Buying Cold Fracture while the second shard is airborne preserves its original damage. The third shard uses the upgrade and deals 70 to the lead at the 55% slow cap and 60 to the elite at 42% slow. Across all three purchase timings, the Needle earns both kills and 514 damage. Replaying each serialized command log reproduces every hit, both armor cracks, the brittle effects, the win and the final state hash. The audit found no combat-rule defect.

### Campaign decision

Emberglass Sanctum's realistic build buys Rimeglass Needle and Cold Fracture after plot 15 reaches frost tier III. With level-20 Bran and the 44-star entry kit, the player affords both purchases during wave 20 of 24. The Needle fires five times between purchases and 173 times afterward, earning 48,089 damage and 68 kills after buying Cold Fracture. Normal still clears at 10/22 lives and two stars. The shared simulator plan applies to the painted i16 campaign build.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,396 tests with 11 skipped using one worker. All 41 realistic-kit levels passed, including all 25 islands. The i16 purchases cost 255 gold and reduce final-wave peak ground progress from 67% to 63%. The complete difficulty report matches round 16 byte for byte, with all eight verdicts passing, Hard i09 at 12/22 and Hard i24 at 5/22. The standalone 24,217-byte L1–L16 report matches the round-one baseline byte for byte.

### Next round

Audit overlapping Tailwind Mill and Horizon Lantern auras. Measure an allied tower’s firing interval and effective range with both abilities purchased, then sell each support tower separately to check which bonus persists. No UI, art or translation changes requested this round.

## Round 18 — Overlapping beacon specializations

### Done

- Added two three-wave encounters for Tailwind Mill with Full Sail and Horizon Lantern with Clear Lens. A tier-I archer stands on the coverage boundary of each support. On every wave its opening arrow fires on the first tick a golem crosses the expected range. Five consecutive reloads per wave establish the steady firing interval at 60 Hz.

| Supports on the plot map | Archer reach in world units | Ticks between arrows |
|---|---:|---:|
| Tailwind and Horizon | 7.15 | 25 |
| Tailwind only | 6.05 | 25 |
| Horizon only | 7.15 | 29 |
| Both sold | 5.50 | 37 |

- Sold each support ten ticks into a reload. Selling Tailwind first gave a 28-tick interval on that shot, and later selling Horizon gave 34. Reversing the sales gave 25 and 32 ticks respectively. The archer retained the reload progress it had earned before each sale. Both serialized replays reproduced every firing tick, target distance, win and final state hash.

### Campaign decision

- Tried the pair in Emberglass Sanctum with level-20 Bran and the 44-star entry kit. Plot 17 took a beacon in place of frost and plot 6 used its existing beacon. With Tailwind on 17 and Horizon on 6, the plot-18 ballista fired 71 times with both purchased bonuses over waves 23 and 24. Swapping the branches gave 69 shots. Both runs bought Cold Fracture, Full Sail and Clear Lens and finished at 10/22 lives with two stars.
- Waxlight Orchard lost on wave six when the first support replaced the plot-5 mortar, before it could buy either branch. Kept the authored campaign builds. The Sanctum alternative exercises the overlap in a full campaign encounter and the existing Orchard mortar covers the first elite golem wave.

### Verification

TypeScript and lint passed. Vitest passed 1,398 tests with 11 skipped using one worker. All eight difficulty verdicts passed, including Hard i09 at 12/22 and Hard i24 at 5/22. All 41 realistic-kit levels passed, including all 25 islands. The full balance and difficulty reports matched round 17 byte for byte. The standalone L1–L16 report matched the 24,217-byte round-one baseline. The production build passed with the existing Vite chunk-size and dynamic-import warnings.

### Next round

Check the first barracks swing after a beacon specialization purchase or sale. In the world tick, soldiers act before the combat system refreshes tower auras. Measure the effect on an engaged squad and record any needed soldier-system changes for its owner.

## Round 19 — Beacon purchases during a barracks fight

### Done

- Reproduced a stale attack-speed bonus on an engaged Gateward guard. Buying Tailwind Mill or Full Sail left the guard one tick late on its next hit. Selling the fully upgraded mill let the guard hit one tick early. The squad read the previous bonus before the combat system updated it.
- The world now refreshes beacon coverage when a player buys a beacon specialization or its ability, sells a specialized beacon, or places a barracks. This uses the existing coverage, jam and overlap rules. A swing already in progress keeps its elapsed time.
- In the three recorded Basalt Golem encounters, the guard's next hit landed 6 ticks after buying Tailwind, 27 after buying Full Sail and 10 after selling the mill. Before the fix those intervals were 7, 28 and 9. All three command replays reproduced every soldier hit, the kill, the win and the final state hash.
- A fourth regression gives rally orders without advancing the clock. A tier-I barracks at the edge of Horizon Lantern's coverage can use its 3.84-unit rally range immediately after purchase and 4.16 after Clear Lens. A replacement barracks on the same plot also gets 4.16. Selling the lantern brings the next order back to the 3.2-unit radius. No changes are needed from the soldier-system owner.

### Campaign decision

Kept Waxlight Orchard's authored build, which clears Normal with 9/22 lives and two stars. With level-20 Bran and the 54-star entry kit, adding a mill on vacant plot 3 after the first barracks upgrade gave the plot-19 squad six primary swings under Full Sail in wave 12. The squad dealt 104 damage under Full Sail, including cleaves. The added spending left the island at 6/22 and one star. Replacing the plot-4 archer with the mill gave 3/22. Replacing the plot-18 Tesla lost the island.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,402 tests with 11 skipped, including all four new regressions. All 41 balance checks and all eight difficulty verdicts passed. Easy and Normal cleared all 25 islands. Hard i09 finished at 12/22 and Hard i24 at 5/22. The full balance and difficulty reports matched round 18 byte for byte. The 24,217-byte standalone L1–L16 report also matched the pre-specialization baseline. Vite emitted its existing chunk-size and dynamic-import warnings.

### Next round

Audit Briar Lodge's Wide Sweep. Exercise a lethal primary hit with an armored secondary beside it, then buy Wide Sweep during a soldier's wind-up and check the secondary hit and kill credit on replay. No new UI or localization requests.

## Round 20 — Briar Lodge and Wide Sweep

### Done

- Three combat regressions put a six-armor Iron Brute beside a grunt that dies on the first billhook strike. Without Wide Sweep, the side swing deals 19 damage to the 26-HP brute. A squadmate earns the kill on the next tick. Buying Wide Sweep four ticks into the wind-up lets the original fighter kill both enemies on the scheduled impact, 12 ticks after the wind-up began.
- Against a 39-HP brute, the upgraded side hit deals 29 and the squadmate finishes the remaining 10 HP. Each serialized replay reproduces the wind-ups, hits, soldier IDs, bounties, tower damage and kills, win and final state hash. All three tests pass with the existing soldier combat rules.

### Campaign decision

- The i24 realistic build now reserves gold for Briar Lodge and Wide Sweep at plot 9 by deferring the last plot-4 mortar upgrade until after both purchases. The ordinary autoplay script keeps its original order. A fourth regression runs the Normal encounter and checks that the kit can afford both purchases before the island ends.
- Level-20 Bran with the 56-star entry kit buys both on wave 14 of Normal. The squad lands 21 secondary hits for 138 damage after the purchase and finishes at 3/22 lives. On Hard, both purchases happen on wave 13. Its 55 secondary hits on wave 14 deal 2,116 damage and finish one foe. Hard ends at 2/22 and one star, previously 5/22. Moving the purchases one more upgrade earlier cost the Hard run its last life.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,406 tests with 11 skipped. All 41 realistic-kit levels and all eight difficulty verdicts passed. Easy and Normal cleared 25/25 islands. Hard cleared 12/17 in chapter one and 3/8 in chapter two, with i09 at 12/22. The Normal i24 finale now stops the Tempest and leaks two golems, ending before the deferred mortar upgrade. The 24,217-byte standalone L1–L16 report matches the round-one baseline byte for byte. Vite emitted its existing chunk-size and dynamic-import warnings.

### Next round

Audit Relay Grove's Live Wire. Check jump distance, falloff and target order across a mixed ground and air formation, including the extra eighth target on the sixth discharge. Exercise an ability purchase between discharges and compare the serialized replay.

## Round 21 — Relay Grove and Live Wire

### Done

- Three combat regressions follow a grunt, a flyer and seven ground enemies on parallel lanes. With a 4.80-unit gap to the flyer, the first five discharges each hit the nearest seven enemies in order. Moving the flight path 0.01 units farther away breaks the first jump. Even the sixth discharge then hits only the lead grunt.
- Bought Live Wire between discharges five and six. The overload killed the lead grunt for its remaining 65 HP and the flyer for its remaining 21 HP. The next jump dealt 74 to the armored elite grunt, and the eighth foe took 55. In the same formation without Live Wire those two hits dealt 59 and 25. All three serialized command replays reproduced every firing tick, target, damage amount, outcome and final state hash.

### Campaign decision

- Lanternseed Fig’s realistic build now buys Relay Grove on plot 9 after the plot-15 barracks upgrade. With level-20 Bran and 48 entry stars, Normal bought the branch on wave nine and Live Wire on wave ten. The upgraded grove fired 57 times, reached eight foes five times, dealt 13,294 damage and earned 23 kills. The island still finished at 10/22 lives and two stars. Waiting until the plot-14 ballista upgrade left only six upgraded shots and two lives.
- Checked the same kit at −3%, −1.5%, +1.5% and +3% enemy HP. The new build finished with 8, 11 and 9 lives at the first three settings and lost at +3%. The previous build cleared only the −1.5% check. These are sensitivity checks around the authored difficulty.

### Request for Opus

Updated the English Live Wire ability text in the shared tower and codex data. Each jump uses the preceding jump’s damage before armor and remaining HP limit the actual hit. EN “Lightning loses 6% damage per jump, down from 16%. Armor applies separately to each foe.” TR “Yıldırımın hasarı her sıçramada %16 yerine %6 azalır. Her düşmanın zırhı ayrı hesaplanır.”

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,409 tests with 11 skipped. All 41 realistic-kit levels and all eight difficulty verdicts passed. Easy and Normal cleared all 25 islands. Hard i09 finished at 12/22 lives and Hard i24 at 2/22. The only difficulty-report change was the i19 bare Easy run, up from 20 to 22 of 25 lives. The 24,217-byte standalone L1–L16 report matches the round-one baseline byte for byte. Vite emitted its existing bundle-size and dynamic-import warnings.

### Next round

Audit Stormheart Coil’s Thunderbeat. Buy the branch and ability at different points in the firing cycle. Check which discharges double in strength, the three-target cap and replay when an overloaded primary hit kills its target.

## Round 22 — Stormheart Coil and Thunderbeat

### Done

- Three combat regressions buy the branch and ability between shots while six Iron Brutes march on parallel lanes. Both purchases preserve the tower’s lifetime firing count. Buying the branch after shot one and Thunderbeat after shot two produced overloads on shots 3, 6 and 9. Buying after shots three and eight produced overloads on 4, 8 and 9. Waiting until shots six and seven let tier III overload on 6 and Thunderbeat overload on 9.
- Ordinary Stormheart arcs dealt 69, 53 and 40 damage against six armor. On the ninth discharge the primary brute had 106, 32 or 98 HP left, depending on the encounter. Each overload finished it, awarded one kill and a seven-gold bounty, and dealt 111 and 85 damage to the next two brutes. The three other brutes stayed untouched by that discharge. All three serialized replays reproduced the firing ticks, targets, hits, bounties, win and final state hash. The audit found no combat-rule defect.

### Campaign decision

- Three Pennants Head’s realistic build now buys Stormheart Coil on plot 17 after the second plot-15 ballista upgrade. Level-20 Bran with the 50-star entry kit bought the branch in wave 11 and Thunderbeat in wave 12. The coil fired 30 times after the ability purchase, including 10 overloads and 26 three-target chains, for 5,934 damage and 14 kills. Normal finished at 9/22 lives, up from 7/22.
- The selected order also cleared with enemy HP at −3%, −1.5%, +1.5% and +3%, finishing at 5, 9, 16 and 9 lives. Buying immediately when the Tesla reached tier III lost both 3% variants. The normal balance window for this island is 6–11 lives at authored HP.

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,412 tests with 11 skipped. All 41 realistic-kit balance checks and all eight difficulty verdicts passed. The second Normal star carries through the remaining campaign inventory. The i20 bare Easy run ended at 18/25 lives, previously 21/25. Hard i09 finished at 12/22 and Hard i24 at 2/22. The standalone 24,217-byte L1–L16 report matched the round-one baseline byte for byte. Vite reported its existing bundle-size and dynamic-import warnings.

### Next round

Audit Bell Foundry’s Aftershock against a Bellrunner in full stride. Check the momentum reset, slow duration and which shells carry the slow when the ability is bought during flight. The i18 Normal build currently buys Bell Foundry but finishes 18 gold short of Aftershock. No new UI, art or localization requests.

## Round 23 — Bell Foundry and Aftershock

### Combat

Three encounters send a Belfry Hare into cannon range at full sprint. Buying Aftershock while the first shell is airborne lets the hare keep its full speed through that hit. The second shell immediately resets its momentum and slows it by 28% for two seconds. Buying before the first launch gives both shells the effect. The second hit then raises the slow to 42% and refreshes its duration. The control hare kept sprinting through both unupgraded shells.

Sold the foundry after the second impact to measure recovery without another shell. The hare stayed at the expected speed for the slow's duration, then built back up to its 85% sprint bonus over 2.4 seconds. All three serialized replays reproduced the firing, damage, impact and leak ticks, final state hash and outcome.

### Campaign decision

Moved the scripted Glassworks cannon from plot 7 to plot 0, in reach of both the entrance road and the return bend. The realistic build buys Bell Foundry and Aftershock as soon as the cannon reaches tier III and the player can afford each purchase. Level-20 Bran with the 47-star entry kit bought both on wave 11. The foundry fired 21 upgraded shells, applied 57 slows, dealt 7,440 damage and earned four kills after the ability purchase. Those 57 slows all landed on other ground enemies. The isolated encounters above cover sprint interruption.

Normal finished at 10/22 lives and two stars, previously 7/22 and one star. The ordinary build also finished at 10/22 with that kit. The realistic build cleared at −3%, −1.5%, +1.5% and +3% enemy HP with 14, 16, 10 and 16 lives respectively. A fourth regression checks that the authored Normal kit wins and can afford both purchases.

### Request for Opus

The Belfry Hare's codex counter now covers slows from any tower. EN “Block or slow the hare to break its sprint. It needs a clear road to build up speed again.” TR “Tavşanın önünü kes ya da onu yavaşlat. Yeniden hızlanabilmesi için yolunun açık olması gerekir.”

### Verification

Inspected the new cannon plot in the production game at desktop size and at 3× magnification. The base sits below the entrance road and clear of the return bend. The renderer reported tier IV and the Bell Foundry turret with Aftershock purchased. The screenshot uses a staged wave 11 for the placement check. [Glassworks entrance and return bend](../../design/art-2d/specializations/bellfoundry-glassworks.jpg)

TypeScript, lint and the production build passed. Vitest passed 1,416 tests with 11 skipped. All 41 balance checks and all eight difficulty verdicts passed. Easy and Normal cleared 25/25 islands. Hard i09 finished at 12/22 lives and Hard i24 at 2/22. Glassworks now clears the towers-only Easy run at 23/25 and reaches wave five on campaign Hard. The 24,217-byte standalone L1–L16 report matches the round-one baseline byte for byte. Vite emitted its existing bundle-size and dynamic-import warnings.

### Next round

Audit Cloudbreak Mortar's 2.1-unit minimum range and Stone Petals. Check whether the crew reacquires a target entering or leaving its dead zone and which shell produces fragments if the ability is bought during flight.

## Round 24 — Cloudbreak Mortar and Stone Petals

### Combat

- Followed a lone Iron Brute through the mortar’s blind spot. The crew fired on approach, reloaded while the brute was too close, then fired on the first tick it crossed back outside 2.1 units. Its distance increased from 2.090 to 2.114 units on that tick.
- With a second brute on a parallel road, the crew switched roads for two reloads and reacquired the lead brute on the next one. The roads are 3.55 units apart, just beyond the main blast’s 3.5-unit radius. Buying Stone Petals before launch let the first shell hit the other road for 32 damage. Buying it in flight kept that shell’s single crater. The second shell then hit its target for 210 and the brute beside the crew for 30. Each upgraded impact scattered three fragments three units from the crater.
- All four serialized replays reproduced the firing ticks, target lanes, hit damage, impact locations, outcome and final state hash. The combat checks passed with the existing targeting and projectile rules.

### Campaign decision

Moonwell Crossing’s realistic build now buys Cloudbreak and Stone Petals for the plot-15 mortar after upgrading the plot-6 Tesla. Level-20 Bran with the 42-star entry kit bought both on wave 15 of 22. The upgraded mortar fired 196 shells, dealt 161,078 damage and earned 92 kills. Seven targets were inside the tier-III blind spot and 58 were beyond tier-III reach. Normal finished at 9/22 lives and two stars, matching the prior build. The player spent 170 more gold overall and finished with the final two ordinary upgrades still queued. At −3%, −1.5%, +1.5% and +3% enemy HP, the new build cleared with 17, 6, 10 and 5 lives. The Waxlight Orchard kit reached the end before it could buy the branch on its existing tier-III mortar.

### Requests for Opus

- The branch tooltip now explains the loss of tier-III burning ground and gives the base firing range. EN “Heavy shells replace incendiary rounds. They deal 218 base damage and can target foes 2.1 to 14.2 units away.” TR “Havan artık yangın mermisi yerine ağır mermi atar. Bu mermiler 218 temel hasar verir. Havan, 2,1 ile 14,2 birim arasındaki düşmanları hedef alabilir.”
- The selected range disc and attack anticipation still use tier-III stats in `src/render2d/game2d.ts`. On 31 of the 196 post-purchase shots at Moonwell, the existing render-side range check would find zero eligible ground targets. Use `towerStats(t)` for the built tower’s base range and minimum range, preserving the existing outer-range bonuses. The sim and the measured shots already use the branch stats.

### Verification

In the built game, inspected plot 15 on a staged wave 15 at 1600×900 and at 3× magnification. Cloudbreak sits below the northern road beside the right entrance. Its painted base matches the plot ring in center, bottom and width. The capture shows attack frame two with a Stone Petals shell in flight. [Moonwell Crossing with Cloudbreak](../../design/art-2d/specializations/cloudbreak-moonwell.jpg)

TypeScript, lint and the production build passed. Vite emitted its existing chunk-size and dynamic-import warnings. All 41 realistic-kit balance checks passed, including all 25 islands. Vitest passed 1,421 tests with 11 skipped, including the five new Cloudbreak checks. All eight difficulty verdicts passed. The full difficulty report matched round 23 byte for byte, with Hard i09 at 12/22 and Hard i24 at 2/22. The 24,217-byte standalone L1–L16 report matched the round-one baseline byte for byte.

### Next round

Audit Anchor Winch and Drag Chain against an armored ground target beside a flyer. Check single-target damage, slow duration, and a sale or ability purchase while the harpoon is airborne.

## Round 25 — Anchor Winch and Drag Chain

### Combat

Two recorded encounters put a Basalt Golem and a Sky Skimmer in the same line of fire. Buying Anchor Winch while a tier-III bolt was airborne preserved its skewer. It dealt 148 to the golem and 98 to the flyer behind it. The next harpoon dealt 230 to the golem alone. Buying Drag Chain before that launch cracked the golem’s armor from 12 to 3 for 2.6 seconds and slowed it by 45% for two seconds. Buying during flight left that hit’s damage intact and its target at full speed and armor.

Switched from Strongest to First, then sold the winch with its third shot airborne. The harpoon hit the flyer for 230 and slowed it for two seconds. The tests check distance traveled at reduced speed and again at full speed. Both serialized replays reproduced the launch, hit, impact and armor-crack events, the win and the final state hash.

### Campaign decision

Waxlight Orchard’s realistic kit defers the plot-17 Tesla’s final upgrade to buy Anchor Winch and Drag Chain on the plot-8 ballista. Level-20 Bran with 56 entry stars bought both on wave 10. The winch landed 66 upgraded harpoons for 13,639 damage and four kills. It slowed 62 survivors, including three moths, and cracked golem armor eight times. A third regression checks that the Normal kit can afford both purchases and clear the island.

Normal finished at 7/22 lives, previously 9/22. The losses came from two golems, one grunt and eight moths. At −3%, −1.5%, +1.5% and +3% enemy HP the build finished with 13, 13, 4 and 13 lives. Buying after the plot-5 mortar upgrade instead lost eight of fourteen lives to moths, exceeding the balance gate’s 55% cap. Easy now ends at 24/27 and Hard at 6/22. The other 24 islands’ difficulty results match round 24.

### Requests for Opus

- Updated the Basalt Golem’s English description, first-encounter hint and codex counter. TR description “Yürüyen bir bazalt kütlesi. Yavaşlatan vuruşlar zırhlı kabuğunu çatlatır.” TR first-encounter hint “Golemi yavaşlatarak zırhını 3’e indir. Kabuğu çatlamışken hızlı saldırılar etkili olur.” TR codex counter “Yavaşlatan vuruşlar kabuğunu 2,6 saniyeliğine çatlatır. Zırhı 3’e düştüğünde hızlı saldırılarla vur. Balista okları zırhı deler, közlerin verdiği hasar ise zırhı yok sayar.”
- The open 2D enemy card keeps its initial armor text when a shell cracks. In a staged Orchard wave 10, select the first Empowered golem, then let an Anchor Winch with Drag Chain hit it. The card’s HP updated from 3,184 to 2,954. The sim had 3 armor and a 45% slow, while the card’s stat text still read “Armor 13.” The compact desktop card hid the stat row in this capture. Refresh the armor field when the selected enemy’s armor changes in either direction. The sim already restores armor when the crack expires.

### Verification

Inspected the production game at 1600×900. The staged wave-10 capture shows the harpoon in flight and the tier-IV winch aiming northwest, with zero center, bottom and width error at plot 8. Checked the tower at 3× and the English codex counter enlarged. [Waxlight Orchard](../../design/art-2d/specializations/anchor-orchard.jpg) · [Basalt Golem codex](../../design/art-2d/specializations/dragchain-golem-codex.jpg)

TypeScript, lint and the production build passed. Vitest passed 1,424 tests with 11 skipped. All 41 realistic-kit checks and all eight difficulty verdicts passed. Easy and Normal cleared all 25 islands. Hard i09 finished at 12/22 and Hard i24 at 2/22. The 24,217-byte standalone L1–L16 report matched the round-one baseline byte for byte. Vite emitted its existing bundle-size and dynamic-import warnings.

### Next round

Audit Laneweaver Loom’s Silk Line with more than four eligible secondary targets. Check which four it hits, the eight-unit reach and the damage to each armored foe when the ability is bought while a bolt is in flight.

## Round 26 — Laneweaver Loom and Silk Line

### Combat

Two recorded encounters follow a Loom bolt already in flight when the player buys Silk Line. With six secondary golems inside the original 6.4-unit reach, both bolts struck the nearest four in order, even though the farthest spawned first. The original bolt dealt 119 damage to each armored elite and 120 to each ordinary secondary golem. Silk Line dealt 159 and 160 respectively. The primary had only 146 HP left on the second hit. Killing it preserved the bolt’s full damage against the golems behind it.

A second formation put golems 6.39, 6.41, 7.99 and 8.01 units behind the primary. The airborne bolt hit only the first. The next bolt hit the first three. Both serialized replays reproduced every launch, impact, target lane and damage amount, the outcome and the final state hash. In a temporary copy, changing the sim to take the first eligible enemy in grid order made the crowded-lane regression fail on the hit list.

### Campaign decision

Emberglass Sanctum’s realistic build keeps the plot-15 Rimeglass Needle and Cold Fracture, then buys Laneweaver Loom and Silk Line after the plot-18 ballista reaches tier III. Level-20 Bran with 44 entry stars bought the Loom and its ability on wave 23 of 24. Its next 46 launches dealt 18,217 damage and earned five kills. The pierce accounted for 74 secondary hits, 11,435 damage and four kills. Five bolts hit all four secondary targets. All 74 were within 6.4 units, so the benefit on this run came from Silk Line’s damage. The isolated encounters cover its extra reach.

Normal finished at 10/22 lives and two stars. It completed the build with 345 gold, spending 315 from the previous kit’s surplus. At −3%, −1.5%, +1.5% and +3% enemy HP the build cleared with 18, 10, 8 and 16 lives. A third regression checks that the first-clear kit can afford all four purchases and win. Cloudbell Cloister’s existing build ran out of time to buy the Loom. Advancing the plot-12 upgrades enough to afford both purchases on wave ten cost the last life, so the Cloister keeps its existing build.

### Request for the effects renderer owner

On a staged wave 23 in the production game, the Loom hit a Cloud Hauler and three Sky Skimmers. Each secondary took 162 damage. The ballista pierce streak began **99 screen pixels below the projectile endpoint** at 1600×900. The bolt ended at screen Y 522, while the streak began at Y 621. In `src/render2d/specialFx.ts`, the ballista impact uses a fixed ground-relative height for the spark and both ends of the streak. Project the impact’s supplied `e.y` at both ends, then check an airborne and a ground impact. Inspected the capture at 2×. The Loom’s plot ring measured zero center, bottom and width error. [Emberglass Sanctum air impact](../../design/art-2d/specializations/loom-sanctum.jpg)

### Verification

TypeScript and lint passed. Vitest passed 1,427 tests with 11 skipped. All eight difficulty verdicts passed and the difficulty report matched round 25 byte for byte. Hard i09 ended at 12/22 lives and Hard i24 at 2/22. The 24,217-byte standalone L1–L16 balance report matched the round-one baseline byte for byte. All 41 realistic-kit balance checks passed. The production build passed with the existing Vite bundle-size and dynamic-import warnings.

### Next round

Audit Gateward Hall’s Iron Mantle against an armored melee wave. Buy during an enemy wind-up and while a guard is down. Check the damage floor, the return timer and whether respawned guards have the purchased armor. Compare the serialized replay.

## Round 27 — Gateward Hall and Iron Mantle

### Combat

Four regressions exercise the purchases through the live world and serialized command replay. A brute dealt 4 damage to a Gateward guard and began winding up its next swing. Buying Iron Mantle four ticks later preserved the wound. The next blow landed on the same guard at the same tick in both runs, dealing 1 damage with Iron Mantle and 4 without it.

In two golem encounters, the first guard fell at tier III or at Gateward. Buying Iron Mantle one second into the countdown preserved the remaining six or four seconds respectively. The guard respawned at the hall with 230 HP, took 44 damage on the next hit and received Gateward’s five-second timer on the next death. Before the purchase, the golems’ hits dealt 54 damage against tier III and 49 against Gateward. All four replays matched the original enemy wind-ups, hits, guard deaths and returns, outcome and final state hash.

### Campaign decision

Kept the existing campaign build orders. At Cloudbell Cloister, bringing the two barracks upgrades forward let the first-clear kit afford Gateward and Iron Mantle, but every tested order that bought both lost. At Brineglass Ferry, prioritizing the hall after the plot-0 archer upgrade finished within the island’s target at 5/22 lives. All four neighboring HP settings (−3%, −1.5%, +1.5%, +3%) lost. At Waxlight Orchard, the earliest purchase on the existing barracks left 3/22 lives, with flyers costing 13 of the 19 lost lives.

### Request for Opus

The English tower and codex data now tell players which guards receive the shorter return timer and how much damage can pass through Iron Mantle. Gateward EN “Shield bearers have 9 armor. Guards who fall after this upgrade have a base respawn time of 5 seconds.” TR “Kalkanlı muhafızların 9 zırhı vardır. Bu yükseltmeden sonra düşen muhafızların temel dönüş süresi 5 saniyedir.” Iron Mantle EN “Raises guard armor from 9 to 14. Each melee hit still deals at least 1 damage.” TR “Muhafızların zırhını 9’dan 14’e çıkarır. Her yakın dövüş vuruşu yine de en az 1 hasar verir.”

### Verification

In the production melee scene, bought Gateward and Iron Mantle while a tier-III guard had six seconds left to return. The gate stayed closed after purchase and began opening on the guard’s actual return, 421 fixed ticks after death. Both frames measured zero plot alignment error. The left crop shows the closed gate during the countdown. The right shows gate frame four with spawn dust. Inspected both at 2×. [Gateward Hall during the countdown and at the guard’s return](../../design/art-2d/specializations/gateward-return.jpg)

TypeScript, lint and the production build passed. Vitest passed 1,431 tests with 11 skipped. The first run timed out in the existing map-frame test at five seconds. The full rerun with two workers passed at the original timeout. All 41 realistic-kit balance checks and all eight difficulty verdicts passed. Both reports matched round 26 byte for byte. Hard i09 finished at 12/22 lives and Hard i24 at 2/22. The 24,217-byte L1–L16 report matched the round-one baseline byte for byte. Vite emitted its existing chunk-size and dynamic-import warnings.

### Next round

Audit Snowbell Garden and Deep Drifts against a mixed pack at the splash boundary. Check slow strength, refresh duration and which shots carry the wider radius when the player buys Deep Drifts during flight.

## Round 28 — Snowbell Garden and Deep Drifts

### Combat

Three recorded encounters sent four grunts and a Sky Skimmer across parallel lanes. The first ordinary flurry slowed the grunt at 2.94 units by 48% and missed the skimmer at 2.96. With Deep Drifts purchased before launch, the same flurry slowed both and the grunt at 3.39 units by 55%. The grunt at 3.41 stayed at full speed in every run.

Buying Deep Drifts in flight preserved the first shot’s radius and strength. The next shot caught the skimmer. By then, the untouched grunt on the 3.39-unit lane had pulled ahead and escaped the wider splash. Two ordinary flurries also reached the 55% slow cap on repeat hits. In all three runs the second hit refreshed the timer to four seconds. After selling the tower, the lead grunt traveled at 45% speed and recovered its full speed when the timer expired. Each serialized replay reproduced the launches, impacts, affected enemies, slow timers, outcome and final hash.

### Campaign decision

Amberstone Mesa’s first-clear build now buys Snowbell Garden and Deep Drifts after the frost tower on plot 13 reaches tier III. Level-19 Bran entered with 40 stars and bought both on wave 17 of 22. The garden landed 313 upgraded flurries for 55,230 damage and 25 kills. Of those flurries, 79 hit both air and ground enemies. The expanded radius accounted for 373 hits beyond the ordinary garden’s reach.

Normal finished at 12/22 lives and two stars. The build also cleared at −3%, −1.5%, +1.5% and +3% enemy HP with 15, 11, 8 and 1 life respectively. The +3% run has little margin. A fourth regression checks that the first-clear kit can buy the branch and ability and win.

### Visual check

Inspected plot 13 at 1600×900 and enlarged the tower and nearby road to 2×. In a staged wave 17, one flurry hit a skimmer and four Aegis Wardens. The skimmer and two wardens were outside the ordinary garden’s radius. The tower displayed its tier-IV sheet and measured zero center, bottom and width error on its plot. [Snowbell Garden at Amberstone Mesa](../../design/art-2d/specializations/snowbell-mesa.jpg)

### Verification

TypeScript, lint and the production build passed. Vitest passed 1,435 tests with 11 skipped on a single-worker rerun at the original timeout. The first two-worker run timed out in the Mesa and Moonwell campaign tests. The realistic-kit balance gate passed all 41 levels. All eight difficulty verdicts passed and the difficulty report matched round 27 byte for byte. Hard i09 finished at 12/22 lives and Hard i24 at 2/22. The standalone 24,217-byte L1–L16 report matched the round-one baseline byte for byte. Vite emitted its existing chunk-size and dynamic-import warnings.

### Next round

Try a Reed Piper formation in the painted Amberstone Mesa’s “Salt Wind” wave. Check whether its last note clears ground allies while leaving the skimmers chilled, whether players can see the cast on the road, and whether the campaign and difficulty gates still pass. The existing Reed Piper has EN/TR copy and art. No new requests for Opus this round.

## Round 29 — Reed Pipers at Amberstone Mesa

### Encounter and balance

In wave ten, “Salt Wind,” four Reed Pipers now follow the three Basalt Golems out of the lower-right gate. The first piper enters at 5.6 seconds and the others follow at 2.4-second intervals. They take the four healer slots on the painted island. The direct swap on the original approach left the Normal kit at 7/22 lives and cleared a single blinker slow over the whole wave. Following the golems gives the player time to see which enemies the music helps.

The first-clear kit heard six completed phrases. Their final notes cleared seven slows from golems and nine from pipers, counting repeat hits. One phrase cleared a golem and two pipers inside the ring while all five skimmers overhead kept their 55% slow. The golem continued walking with 3 armor and 0.2 seconds left on its cracked shell. The combat regression covers the separate armor countdown and its eventual recovery.

Bran entered the wave at 18 lives and cleared it without a leak. The island ended at 12/22 lives and two stars, including both Snowbell purchases. At −3%, −1.5%, +1.5% and +3% enemy HP, the kit finished with 19, 13, 6 and 6 lives.

### Visual check

In the first production capture the golems' health bars obscured the flute notes. Raised the notes above the pack and enlarged them slightly. The segmented ring stays centered on the caster throughout the phrase. Inspected the revised cast at 2× on both devices. The screenshots stage wave ten with the earlier towers in place and show the existing EN and TR first-encounter cards. [Desktop](../../design/art-2d/chapter2/polish/i14-salt-wind.jpg) · [Landscape phone](../../design/art-2d/chapter2/polish/i14-salt-wind-phone.jpg)

### Verification

TypeScript and lint passed. Vitest passed 1,435 tests with 11 skipped. The updated cue and armor checks also passed in a focused run. All eight difficulty verdicts passed and the complete report matched round 28 byte for byte. Easy and Normal cleared all 25 islands. Hard i09 ended at 12/22 and Hard i24 at 2/22. The standalone 24,217-byte L1–L16 report matched the round-one baseline byte for byte. All 41 realistic-kit balance checks passed, including all 25 islands. The production build passed with its existing Vite bundle-size and dynamic-import warnings.

### Next round

Try a small Belfry Hare formation on i13’s “North Road.” Check how much open road it gets before the first slow or block and keep it only if the campaign gates and neighboring HP settings support it. The pipers use existing localized copy and art. No requests for Opus this round.

## Round 30 — Belfry Hares on Stormcrown Citadel’s North Road

### Encounter

Four Belfry Hares replace the fourteen northern Scuttle Mites in wave two of the painted i13. The runners take the main road first. The first hare emerges from the north cave at 3.6 seconds, followed by the other three at one-second intervals. The formation test checks the painted wave against the original campaign data.

With level-18 Bran and 38 entry stars, the lead hare traveled 6.92 world units before it died. The second reached full speed and covered 8.34 units in 2.45 seconds before Bran blocked it. He intercepted the last two earlier, at 6.99 and 6.85 units. All three blocks reset the sprint on the next movement tick. None of the four was slowed before its first block or death. The wave cost no lives.

### Balance decision

At 1.2-second spacing, Normal finished at 12/22 lives but the weak Easy kit lost on wave 22. At one-second spacing, Normal still finished at 12/22 with two stars, and the weak Easy kit cleared at 21/26. Normal also cleared with 8, 8, 5 and 9 lives at −3%, −1.5%, +1.5% and +3% enemy HP. The hares use the existing Belfry Hare / Çan Tavşanı art and localized copy.

### Visual check

Staged wave two in the production build with the opening towers. The captures show three hares spaced along the northern bend, the main-road column below and the first-encounter card in each language. Inspected both road crops at 2×. [Desktop EN](../../design/art-2d/chapter2/polish/i13-north-road.jpg) · [Landscape phone TR](../../design/art-2d/chapter2/polish/i13-north-road-phone.jpg)

### Verification

All 41 realistic-kit checks and all eight difficulty verdicts passed. The i13 campaign kit cleared Easy at 26/26, Normal at 12/22 and Hard at 6/22. Hard previously ended at 3/22. The other 24 islands’ difficulty rows matched round 29. Hard i09 finished at 12/22 and i24 at 2/22. The 24,217-byte standalone L1–L16 report matched the round-one baseline byte for byte. TypeScript, lint and the production build passed. Vite reported its existing bundle-size and dynamic-import warnings.

Vitest passed 1,435 tests with 11 skipped on the full rerun. During screenshot capture, the all-island backdrop test exceeded its five-second timeout. The rerun used the original timeout and one worker after the preview and browsers closed.

### Next round

Audit the Kilnback Tortoises in i16’s “Gatecrash.” Measure where their armor first reaches zero, how long it stays down and whether the cracked-shell effect is readable when the tortoises overlap. No requests for Opus this round.

## Round 31 — Kilnback shells in Gatecrash

### First-clear combat

Traced the three Kilnbacks in spawn order on Emberglass Sanctum’s second road. With level-20 Bran and 44 entry stars, all three reached zero armor on the fourth damaging hit. Repeated hits held their plates open. The first two lost their last plate on the same simulation tick despite entering the road 0.9 seconds apart.

| Tortoise | Distance from gate at first zero armor | First time spent at zero | Distance when all 11 armor returned | Later time at zero |
|---|---:|---:|---:|---|
| First | 12.39 units | 9.6 s | 18.80 units | 1.5 s, then recovered |
| Second | 11.03 units | 9.6 s | 17.44 units | 2.2 s, until killed |
| Third | 13.04 units | 7.8 s | 18.25 units | 0.2 s, until killed |

The first-clear kit entered and left wave three with 16 lives and finished the island with 10/22. Kept the wave and combat tuning. A regression covers two tortoises in the same place during the recovery interval. A shield absorbed the first tortoise’s next hit, while the second lost HP. The first regained its armor a full second earlier.

### Shell damage on the road

The previous effect drew the same diagonal cross over all three tortoises. Its lines extended past the feet and shell rims onto neighboring bodies. The revised cue sits on the fired-clay plates. The first chip leaves one fissure. Further chips fork the fissure, and at zero armor a dark piece opens in its center. The fissures follow the tortoise’s facing and melee pose, sort with its body and disappear when its armor recovers. A renderer regression checks the three shapes, pose changes and restoration, including a tortoise with bonus armor.

Staged Gatecrash with the early towers in the production build. In both captures the leading two shells had zero armor and the trailing shell had two. Checked the pack enlarged at 3× on desktop and 4× on the phone capture. The shortest cracks are small at phone play size. [Before and after on desktop](../../design/art-2d/chapter2/polish/i16-shell-detail.jpg) · [Full desktop EN](../../design/art-2d/chapter2/polish/i16-gatecrash.jpg) · [Landscape phone TR](../../design/art-2d/chapter2/polish/i16-gatecrash-phone.jpg)

### Verification

TypeScript, lint and the production build passed. The focused combat and renderer suites passed all 20 tests. All 41 realistic-kit checks and all eight difficulty verdicts passed. Both reports matched round 30 byte for byte. Hard i09 ended at 12/22 and i24 at 2/22. The 24,217-byte standalone L1–L16 report matched the round-one baseline. Vite emitted its existing bundle-size and dynamic-import warnings. The first full Vitest process was terminated before reporting results. The single-worker rerun passed 1,437 tests with 11 skipped at the original timeouts.

### Next round

Check the Hard first-clear kit’s wave-three defeat at Emberglass Sanctum. Trace which Gatecrash enemies reach the goal and try an affordable change to placement or targeting with the same hero and Workshop budget before considering any tuning. No new requests for Opus.

## Round 32 — A Hard opening for Emberglass Sanctum

### Gatecrash

Hard i16 starts with zero gold. Bran, Meteor and Overcharge stopped nine of the first twenty grunts. The 69 gold available at the end of wave one fell six short of the planned cannon. The cannon arrived eight seconds into wave two, and seven runners escaped. With four lives left in Gatecrash, the defense killed one Kilnback at 25.3 seconds. The other two reached the goal at 30 seconds and took two lives each. The mites and grunts cost no lives in that wave.

The painted island's greedy build now buys frost on plot 24, archer on 1, cannon on 23 and mortar on 8. All four use first targeting. The Hard kit spends 65 gold on frost between the first two waves. On the second road, it chilled seven runners in wave two and all three Kilnbacks in wave three. Every runner and Kilnback died. The last two tortoises fell 30.3 seconds into Gatecrash, and the kit could then afford the mortar. Six skimmers escaped in wave four. Bran held the remaining five lives through wave 24 and bought Rimeglass Needle, Cold Fracture, Laneweaver Loom and Silk Line.

### Balance decision

Repositioning either of the first two planned towers or changing its targeting extended the old Hard opening as far as wave seven. Buying frost first produced a full clear. Buying the archer next kept the Normal losses spread across both ground and air. Normal finished with 11/22 lives and two stars, losing six to grunts, one to a skimmer and four to two haulers. The player uses the same plots, towers, prices, hero and Workshop budget on both difficulties. The existing campaign test now checks a full clear, both branch abilities and zero lives lost in Gatecrash on Normal and Hard.

| Enemy HP multiplier relative to each difficulty | −3% | −1.5% | Authored | +1.5% | +3% |
|---|---:|---:|---:|---:|---:|
| Normal lives remaining | 11 | 11 | 11 | 13 | 13 |
| Hard lives remaining | 3 | 5 | 5 | 5 | 5 |

### Verification

All 41 realistic-kit balance checks and all eight difficulty verdicts passed. Easy i16 finished at 22/26, down one life. The towers-only Normal attempt lost on wave one, previously wave two. The other 24 islands’ difficulty rows matched round 31. Hard cleared 13/17 chapter-one islands and 3/8 chapter-two islands. Hard i09 held at 12/22 and i24 at 2/22. The standalone 24,217-byte 3D L1–L16 report matched the round-one baseline byte for byte.

TypeScript and lint passed. The single-worker Vitest suite passed 1,438 tests with 11 skipped. The production build passed with the existing bundle-size and dynamic-import warnings.

### Next round

Trace the six Slipstream Moths in Moonwell Crossing's “Veil of Mist.” Check which moth supplies the draft, how long a follower coasts after its leader dies, and whether the painted trail disappears at the same time as the speed bonus. No new requests for Opus.
