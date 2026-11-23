# Market Item Balance & Campaign Economy (`sim:items`)

The tables below record the first Market tuning pass. Current caps, belt results and per-island comparisons are in [Normal campaign rebalance v2](rebalance-normal-v2.md).

`scripts/itemSim.ts` (`npm run sim:items`) evaluates single-use Market items and Sky Crystal progression across all 25 2D islands (`l1c`, `i01`–`i24`) and all three difficulties (`easy`, `normal`, `hard`) on top of the existing `campaignKit` / `balanceSim` progression driver.

```bash
npm run sim:items                         # full item + economy report & target checks
npm run sim:items -- --md                 # Markdown tables below
npm run sim:items -- --levels=i06,i20     # filter islands while keeping full campaign entry kits
npm run sim:items -- --loadout=a,b,c      # override 3-item belt (defaults to top-3 by marginal value/crystal)
```

---

## 1. Simulation Model & Item Policy

- **Entry kits & profiles** match `scripts/difficultySim.ts` (`docs/difficulty.md`):
  - **Easy** builds entry Hero XP and Workshop stars (1★ cap per win) sequentially from fresh Easy clears.
  - **Normal** builds entry Hero XP and Workshop stars from sequential greedy Normal clears.
  - **Hard** enters each island with the corresponding Normal entry kit (modelling players attempting Hard ribbons as islands unlock).
  - **`campaign`** runs the greedy specialization build order (`balanceBuildOrder(level, 'greedy')`) alongside `driveScriptedHero` and `driveGlobalAbilities` (Meteor + Overcharge).
  - **`weak`** runs the struggling ~70% build order (`balanceBuildOrder(level, 'weak')`) with the same entry kit.
- **Difficulty item caps in this historical run** allowed up to **3** charges per equipped slot on Easy/Normal (max 9 casts/island) and **1** charge per equipped slot on Hard (max 3 casts/island).
- **Sensible wave-focused item policy** (`driveItems` in `scripts/itemSim.ts`):
  - Inspects the itemless baseline run to identify the hardest waves (waves that leaked lives or pushed past 85% ground progress, plus waves around defeat) so limited charges are reserved for genuine danger windows rather than wasted on trivial skirmishes or already-flawless runs.
  - `heartstone`: cast when `missingLives >= 5` or in lethal danger (`lives <= 6`, or `<= 12` on the final wave). Restored lives never inflate star ratings (`computeStars` counts every leaked life).
  - `skyPurse`: cast at scheduled pre-trouble waves while build/upgrade steps are waiting on gold.
  - `cloudguard`: snapped onto the highest-DPS tower kill-zone ahead of unheld ground pushes.
  - `frostLantern`: cast on surfaced enemy clusters inside active tower kill-zones (or emergency gate leakers).
  - `emberPot`: cast on armor/cluster targets past mid-path (or emergency gate leakers) for armor-piercing burst + ground burn.
  - `galeBell`: rung when dangerous waves breach 80–85% path progress to push foes back into tower coverage.
- **Marginal value metric** (`computeRunMarginalGain` across 25 islands × 3 difficulties × 2 kits = 150 runs per item in isolation):
  - `+8` per net loss turned into a win (`-8` if a timing shift costs a marginal win),
  - `+1` per net surviving life on victory,
  - `+1.5` per additional wave survived when both runs still end in defeat.

---

## 2. Catalog Tuning — Before vs After (`src/data/market.ts`)

Constants quoted directly in EN/TR UI strings (`burnSeconds = 2`, `frostLantern.seconds = 4`, `eliteSlow = 0.5`, `heartstone.lives = 5`, `cloudguard.soldiers = 3`, `cloudguard.seconds = 15`) were intentionally kept unchanged so localized UI copy remains accurate without touching `src/i18n` or `src/render2d`.

| Item | Price (Before → After) | Parameters (Before → After) | Why It Changed |
| --- | ---: | --- | --- |
| `emberPot` | **12 → 12** | `radius: 3.0 → 3.4`, `meteorFraction: 0.65 → 0.80`, `burnDamage: 6 → 16` (2s) | At 65% Meteor + 6 burn, single casts failed to secure mid/late armored packs (`0.079` val/crystal). Raising impact to 80% Meteor and ground burn to 16/tick gives reliable wave-saving AoE without eclipsing full Meteor. |
| `frostLantern` | **14 → 11** | `radius: 3.4 → 3.6`, added `markVuln: 0 → 0.30` (+30% incoming dmg for 4s), cracks Basalt Golem `brittleArmor`, resets elite `momentum` sprint | Pure 4s stall at 14 crystals underperformed (`0.054` val/crystal, 3.1× below `heartstone`). Adding +30% shatter vulnerability, golem shell cracking, and a 11-crystal price makes freeze windows convert directly into tower kills (`0.062` val/crystal). |
| `heartstone` | **16 → 22** | `lives: 5` (unchanged; leaks still count against stars & `bestLives`) | Guaranteed +5 life buffer dominated per-crystal value (`0.167`) at 16 crystals. Pricing at 22 crystals preserves clutch rescue identity while aligning per-crystal efficiency (`0.121`) with tactical items. |
| `skyPurse` | **14 → 16** | `startingGoldFraction: 0.30 → 0.15`, `goldPerWave: 5 → 5` | `0.30 × level.startingGold` injected ~130–240g immediately on Hard, erasing Hard's `-250g / ×0.87` opening gold penalty and producing 7/21 Hard 3★ blowouts. Halving the starting-gold fraction to `0.15` (~70–130g tempo boost) at 16 crystals helps struggling builds bridge key upgrades without trivializing Hard. |
| `cloudguard` | **12 → 11** | `snapRadius: 1.2 → 1.4`, royal guard stats (`soldierHp: 110 → 170`, `soldierDamage: 14 → 20`, `soldierArmor: 1 → 3`, `soldierHoldCap: 1 → 2`, `waveScale: 0 → 0.05`/wave) | Unscaled Tier-I militia (`110 HP, 1 armor, holdCap 1`) melted in ~3s on Heroic/Master islands (`0.059` val/crystal). Wave-scaled royal guards with `holdCap: 2` hold up to 6 ground foes for up to 15s and despawn cleanly when fallen or expired (`0.075` val/crystal). |
| `galeBell` | **18 → 14** | `distance: 4.0 → 6.5`, `bossDistance: 1.0 → 2.2` | At 18 crystals for a 4u push (`1u` on bosses), Gale Bell was the weakest item by 5.17× (`0.032` val/crystal). Lowering price to 14 and increasing pushback to `6.5u` (`2.2u` on bosses, floored at `dist = 0`) buys a full tower volley cycle (`0.078` val/crystal). |

Average catalog price remained **14.33 crystals** (`(12 + 11 + 22 + 16 + 11 + 14) / 6 = 86 / 6`), identical to the untuned catalog (`(12 + 14 + 16 + 14 + 12 + 18) / 6 = 86 / 6`).

---

## 3. Single-Item Marginal Value — Before vs After

Each row runs all 150 scenarios (`25 islands × 3 difficulties × 2 kits`) equipping **only** that item (`cap = 3` on Easy/Normal, `1` on Hard).

### Before Tuning
| Item | Price | Casts | Crystals | ΔWins | ΔLives | ΔStars | ΔWaves(L) | MargVal | Val/CrysSpent | TotVal/Price |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `heartstone` | 16 | 180 | 2880 | +6 | +374 | +6 | +39 | 480.5 | **0.167** | 30.03 |
| `skyPurse` | 14 | 183 | 2562 | +3 | +273 | +38 | +68 | 399.0 | **0.156** | 28.50 |
| `emberPot` | 12 | 253 | 3036 | -2 | +192 | +16 | +42 | 239.0 | 0.079 | 19.92 |
| `cloudguard` | 12 | 246 | 2952 | -1 | +142 | +14 | +26 | 173.0 | 0.059 | 14.42 |
| `frostLantern` | 14 | 255 | 3570 | -3 | +180 | +15 | +24 | 192.0 | 0.054 | 13.71 |
| `galeBell` | 18 | 247 | 4446 | -4 | +120 | +11 | +37 | 143.5 | **0.032** | 7.97 |

- **Before dominance check**: `heartstone` & `skyPurse` were **2.11×** the 3rd-best item (`0.167` vs `0.079`) and **5.17×** `galeBell` (`0.167` vs `0.032`) — **FAIL**.

### After Tuning
| Item | Price | Casts | Crystals | ΔWins | ΔLives | ΔStars | ΔWaves(L) | MargVal | Val/CrysSpent | TotVal/Price |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `heartstone` | 22 | 180 | 3960 | +6 | +374 | +6 | +39 | 480.5 | **0.121** | 21.84 |
| `skyPurse` | 16 | 186 | 2976 | +1 | +226 | +22 | +56 | 318.0 | **0.107** | 19.88 |
| `emberPot` | 12 | 253 | 3036 | -1 | +219 | +18 | +28 | 253.0 | **0.083** | 21.08 |
| `galeBell` | 14 | 244 | 3416 | -1 | +205 | +17 | +46 | 266.0 | **0.078** | 19.00 |
| `cloudguard` | 11 | 246 | 2706 | -4 | +161 | +15 | +49 | 202.5 | **0.075** | 18.41 |
| `frostLantern` | 11 | 255 | 2805 | +0 | +145 | +17 | +19 | 173.5 | **0.062** | 15.77 |

- **After dominance check**:
  - Top vs 2nd `Val/CrysSpent`: **1.14×** (`heartstone` `0.121` vs `skyPurse` `0.107`, well below the `2.0×` ceiling).
  - Top vs 2nd `TotVal/Price`: **1.04×** (`heartstone` `21.84` vs `emberPot` `21.08`).
  - **Entire 6-item catalog max/min spread**: **1.96×** (`0.121` vs `0.062` — even the #1 item is `< 2×` the #6 item per crystal) — **PASS**.

---

## 4. Campaign Balance: No Items vs 3-Item Belt `[heartstone, skyPurse, emberPot]`

### Aggregate Summary (Before vs After)

| Profile / Difficulty | No-Item Wins | Before Belt Wins | **After Belt Wins** | No-Item Avg Lives | **After Belt Lives** | No-Item ★ | Before Belt ★ | **After Belt ★** | After Avg Casts | After Avg Crystals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `campaign easy` | 25/25 (100%) | 25/25 (+0) | **25/25 (+0)** | 25.7 | **26.0** | 25 (1.00★) | 25 (1.00★) | **25 (1.00★)** | 0.84 | 11.0 |
| `campaign normal` | 25/25 (100%) | 25/25 (+0) | **25/25 (+0)** | 14.0 | **21.0** | 58 (2.32★) | 74 (2.96★) | **72 (2.88★)** | 4.96 | 71.4 |
| `campaign hard` | 19/25 (76%) | 21/25 (+2) | **21/25 (+2)** | 5.5 | **12.4** | 25 (1.00★) | 43 (1.72★) | **43 (1.72★)** | 2.76 | 45.1 |
| `weak easy` | 16/25 (64%) | 18/25 (+2) | **17/25 (+1)** | 12.5 | **15.9** | 16 (0.64★) | 18 (0.72★) | **17 (0.68★)** | 4.60 | 71.9 |
| `weak normal` | 5/25 (20%) | 9/25 (+4) | **9/25 (+4)** | 2.4 | **6.2** | 10 (0.40★) | 16 (0.64★) | **18 (0.72★)** | 7.04 | 116.0 |
| `weak hard` | 3/25 (12%) | 3/25 (+0) | **5/25 (+2)** | 1.1 | **2.8** | 5 (0.20★) | 8 (0.32★) | **10 (0.40★)** | 2.88 | 47.6 |

Key takeaways:
- **Struggling runs convert losses into wins (`+7` wins on `weak`, `+2` on `campaign hard` = `+9` net clears)**:
  - `weak normal` nearly doubles its clear count from **5/25 (20%) → 9/25 (36%)** (`i03, i06, i08, i09`), while `weak easy` clears **16/17** of Chapter 1 (`i10` flips `L @20 → W 21/26 1★`) and `weak hard` picks up `i04` and `i06` (`3/25 → 5/25`).
- **Hard remains challenging and non-trivial (1-use-per-slot cap + moderated `skyPurse`)**:
  - `campaign hard` improves from **19/25 (76%) → 21/25 (84%)**, rescuing `i06` (`L @8 → W 3/21(+5♥) 1★`) and `i20` (`L @9 → W 4/22(+5♥) 1★`), while `i08, i14, i21, i22` still defeat greedy scripts (`Ch2 = 6/8`).
  - Zero Chapter 2 islands earn 3★ on Hard (`0/6` Ch2 3★; `5/21` total Hard 3★, down from `7/21` before tuning), `i24` Hard ends at a tense `W 9/22(+5♥) 1★` (4 unhealed lives), and `weak hard` still loses **20/25** islands.

### Per-Island Results — After Tuning (`No Items → With 3-Item Belt`)

`(+N♥)` denotes lives restored by `heartstone`; awarded stars still count every leaked life.

| Island | campaign easy | campaign normal | campaign hard | weak easy | weak normal | weak hard |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| l1c | W 25/25 1★ → W 25/25 1★ | W 20/20 3★ → W 20/20 3★ | W 17/20 2★ → W 20/20 3★ | W 25/25 1★ → W 25/25 1★ | W 20/20 3★ → W 20/20 3★ | W 10/20 2★ → W 20/20 3★ |
| i01 | W 25/25 1★ → W 25/25 1★ | W 20/20 3★ → W 20/20 3★ | W 14/20 2★ → W 20/20 3★ | W 25/25 1★ → W 25/25 1★ | W 20/20 3★ → W 20/20 3★ | W 14/20 2★ → W 20/20 3★ |
| i02 | W 25/25 1★ → W 25/25 1★ | W 21/21 3★ → W 21/21 3★ | W 11/21 2★ → W 16/21 2★ | W 25/25 1★ → W 25/25 1★ | W 11/21 2★ → W 16/21 2★ | W 4/21 1★ → W 16/21(+5♥) 2★ |
| i03 | W 25/25 1★ → W 25/25 1★ | W 21/21 3★ → W 21/21 3★ | W 7/21 1★ → W 16/21(+5♥) 2★ | W 25/25 1★ → W 25/25 1★ | L @18 → W 15/21(+15♥) 1★ | L @15 → L @18 |
| i04 | W 25/25 1★ → W 25/25 1★ | W 21/21 3★ → W 21/21 3★ | W 6/21 1★ → W 21/21(+5♥) 2★ | W 15/25 1★ → W 25/25 1★ | W 3/21 1★ → W 16/21(+10♥) 1★ | L @14 → W 2/21(+5♥) 1★ |
| i05 | W 26/26 1★ → W 26/26 1★ | W 21/21 3★ → W 21/21 3★ | W 3/21 1★ → W 20/21 3★ | W 26/26 1★ → W 26/26 1★ | W 7/21 1★ → W 21/21 3★ | L @15 → L @15 |
| i06 | W 26/26 1★ → W 26/26 1★ | W 11/21 2★ → W 21/21(+5♥) 3★ | L @8 → W 3/21(+5♥) 1★ | W 14/26 1★ → W 26/26 1★ | L @17 → W 21/21(+5♥) 3★ | L @16 → W 11/21(+5♥) 1★ |
| i07 | W 26/26 1★ → W 26/26 1★ | W 16/21 3★ → W 21/21 3★ | W 11/21 2★ → W 21/21(+5♥) 3★ | W 9/26 1★ → W 21/26(+5♥) 1★ | L @17 → L @18 | L @17 → L @17 |
| i08 | W 26/26 1★ → W 26/26 1★ | W 17/22 3★ → W 22/22 3★ | L @3 → L @10 | W 26/26 1★ → W 26/26 1★ | L @20 → W 17/22(+15♥) 1★ | L @3 → L @10 |
| i09 | W 26/26 1★ → W 26/26 1★ | W 17/22 3★ → W 22/22 3★ | W 12/22 2★ → W 17/22(+5♥) 2★ | W 26/26 1★ → W 26/26 1★ | L @22 → W 10/22(+15♥) 1★ | L @22 → L @22 |
| i10 | W 26/26 1★ → W 26/26 1★ | W 20/22 3★ → W 22/22 3★ | W 6/22 1★ → W 17/22(+5♥) 2★ | L @20 → W 21/26 1★ | L @19 → L @19 | L @11 → L @18 |
| i11 | W 26/26 1★ → W 26/26 1★ | W 18/22 3★ → W 20/22 3★ | W 3/22 1★ → W 14/22(+5♥) 2★ | W 4/26 1★ → W 18/26(+10♥) 1★ | L @17 → L @19 | L @17 → L @17 |
| i12 | W 26/26 1★ → W 26/26 1★ | W 20/22 3★ → W 17/22 3★ | W 8/22 2★ → W 22/22 3★ | L @19 → L @20 | L @18 → L @18 | L @13 → L @17 |
| i13 | W 26/26 1★ → W 26/26 1★ | W 12/22 2★ → W 18/22(+15♥) 1★ | W 6/22 1★ → W 18/22(+5♥) 2★ | W 21/26 1★ → W 16/26(+15♥) 1★ | L @19 → L @20 | L @18 → L @18 |
| i14 | W 26/26 1★ → W 26/26 1★ | W 12/22 2★ → W 22/22 3★ | L @2 → L @4 | W 21/26 1★ → W 26/26 1★ | L @21 → L @21 | L @2 → L @4 |
| i15 | W 26/26 1★ → W 26/26 1★ | W 12/22 2★ → W 22/22 3★ | W 4/22 1★ → W 13/22(+5♥) 2★ | W 14/26 1★ → W 20/26 1★ | L @19 → L @19 | L @5 → L @19 |
| i16 | W 22/26 1★ → W 26/26 1★ | W 11/22 2★ → W 22/22 3★ | W 5/22 1★ → W 15/22(+5♥) 2★ | W 21/26 1★ → W 22/26 1★ | L @23 → L @24 | L @3 → L @4 |
| i17 | W 26/26 1★ → W 26/26 1★ | W 8/22 1★ → W 22/22 3★ | W 6/22 1★ → W 2/22(+5♥) 1★ | L @10 → L @10 | L @9 → L @9 | L @7 → L @8 |
| i18 | W 26/26 1★ → W 26/26 1★ | W 8/22 2★ → W 22/22 3★ | W 4/22 1★ → W 14/22(+5♥) 2★ | L @11 → L @11 | L @9 → L @10 | L @5 → L @6 |
| i19 | W 26/26 1★ → W 26/26 1★ | W 11/22 2★ → W 22/22 3★ | W 7/22 1★ → W 13/22(+5♥) 2★ | W 15/26 1★ → W 25/26(+5♥) 1★ | L @11 → L @11 | L @8 → L @9 |
| i20 | W 26/26 1★ → W 26/26 1★ | W 9/22 2★ → W 22/22 3★ | L @9 → W 4/22(+5♥) 1★ | L @11 → L @12 | L @9 → L @10 | L @8 → L @9 |
| i21 | W 27/27 1★ → W 27/27 1★ | W 5/22 1★ → W 22/22 3★ | L @5 → L @5 | L @10 → L @12 | L @5 → L @6 | L @5 → L @5 |
| i22 | W 27/27 1★ → W 27/27 1★ | W 8/22 2★ → W 21/22(+5♥) 3★ | L @13 → L @13 | L @13 → L @13 | L @11 → L @13 | L @10 → L @9 |
| i23 | W 24/27 1★ → W 27/27 1★ | W 7/22 1★ → W 22/22(+5♥) 3★ | W 6/22 1★ → W 14/22(+5♥) 2★ | L @12 → L @13 | L @6 → L @10 | L @6 → L @6 |
| i24 | W 27/27 1★ → W 27/27 1★ | W 3/22 1★ → W 18/22(+5♥) 2★ | W 2/22 1★ → W 9/22(+5♥) 1★ | L @13 → L @14 | L @10 → L @11 | L @9 → L @10 |

---

## 5. Non-IAP Campaign Economy Simulation

### Earn Formula (`MARKET_RULES` in `src/data/market.ts`)
- **Starter gift (new save & v1/v2 → v3 migration)**: `28` Sky Crystals + `1` of each of the 6 items (`86` crystals of starter inventory).
- **Island victory**:
  - `base = 14 + 4 × awardedStars` (`Easy` caps `awardedStars` at `1`).
  - First clear of an island across all difficulties: `(base + 20) × diffMul`, rounded (`Easy: 29`, `Normal: 38 / 42 / 46`, `Hard: 51 / 57 / 62`).
  - Repeat clear: `(base × 0.35) × diffMul`, rounded (`Easy: 5`, `Normal: 6 / 8 / 9`, `Hard: 9 / 10 / 12`).
  - Counted Daily Squall victory: `+18` crystals once per UTC day (`27` total for a 3★ Normal Daily win; `9` on same-day repeat).
  - Losses, Endless runs, quits/restarts, and replay playback award `0` crystals.

### 25-Island Campaign Scenarios (Zero IAP, Avg Catalog Price = `14.33` Crystals)

| Playthrough Scenario | Assumption | Total Crystals | Crystals / Isle | Bought Items / Isle | Incl. Starter / Isle |
| --- | --- | ---: | ---: | ---: | ---: |
| **Typical Campaign (No IAP)** | 25 Normal first clears (sim stars), 8 natural replays (5 Normal star-ups + 3 Hard ribbons), 6 Daily Squalls | **1,342** | **53.7** | **3.75** | **3.99** |
| **First Clears Only (Zero Replays / Dailies)** | 25 Normal first clears at simulated stars, 0 replays, 0 Daily Squalls | **1,110** | **44.4** | **3.10** | **3.34** |
| **Struggling Player (Mixed Easy/Normal + Retries)** | 17 Normal (1–2★) + 8 Easy first clears, 6 Normal replays, 5 Daily Squalls (failed attempts pay 0) | **1,126** | **45.0** | **3.14** | **3.38** |
| **Easy-Only Casual** | All 25 islands cleared once on Easy (1★ cap), 0 island replays, 3 Daily Squalls | **831** | **33.2** | **2.32** | **2.56** |

### Cumulative Wallet Checkpoints — Typical Non-IAP Campaign

| Checkpoint | Island | Cumulative Crystals | Cumulative Items Affordable (Bought) | Incl. 6 Starter Items |
| --- | ---: | ---: | ---: | ---: |
| Isle 1 | `l1c` | 74 | 5.2 | 11.2 |
| Isle 5 | `i04` | 294 | 20.5 | 26.5 |
| Isle 10 | `i09` | 566 | 39.5 | 45.5 |
| Isle 15 | `i14` | 833 | 58.1 | 64.1 |
| Isle 20 | `i19` | 1,074 | 74.9 | 80.9 |
| Isle 25 | `i24` | 1,342 | 93.6 | 99.6 |

Every non-IAP player archetype lands cleanly inside the **2–4 items per island** target (**2.32–3.75** bought items/island, or **2.56–3.99** including starter supplies) with zero grinding required, so `MARKET_RULES` earn numbers required no changes.
