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
