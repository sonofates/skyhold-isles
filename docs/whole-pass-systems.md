# Whole-game pass #1 — gameplay, systems and progression (2026-11-24)

Branch `hermes/sky-pass-sys` (base `art-2d` @ 3d5203a3). Scope: sim, towers/heroes/items, progression and
save, run modes, mobile store gate, sim performance. UI/visual/phone layout was out of scope (parallel pass).
Balance numbers, waves, stats, item rules and prices were **not** changed; every fix below leaves
`sim:balance`, `sim:difficulty` and `sim:items` output identical to the baseline.

## How it was covered

| What | Result |
|---|---|
| Code review of `src/sim/**`, `src/data/**`, `src/game/**`, `src/platform/**`, `progress2d.ts`, `modes2d.ts`, `game2d.ts`, `main2d.ts`, `heroes2d.ts` (4 parallel reviews + own reading; every finding below re-checked with a probe or test) | findings below |
| Headless QA bot, full (`npx tsx qa/bot/index.ts --jobs=3`): 656 scenarios — greedy, weak, difficulty, abilities, hero, challenge, daily, endless on all 25 islands; invariants: NaN, negative gold, stuck enemies, hung waves, hero graph, entity leaks, determinism replays, save round-trip | **656/656, 0 violations**, 21.0 M ticks, 28 determinism replays, 1044 hero deaths / 992 respawns |
| Browser sweep, real renderer (`qa/islandSweep.mjs`, new): every island `?autoplay=1&speed=4` from wave 1 | 25/25 boot, play and reach the end board; 1 transient error on i09 in the first pass that did not reproduce (see "not verified") |
| Browser sweep `--final`: every island from its last wave with 300 k gold (finale formations, bosses, win board) | 25/25, **0 page / console errors**; 17 wins, 8 losses (the demo build script, not a balance signal) |
| Random-action fuzz of towers / barracks / heroes / abilities (40 seeds) + 25 record-and-replay seeds | no invariant breaks; every replay matched outcome + state hash |
| Sim performance probe: i24 / i16, endless waves 30–40, 22–26 upgraded towers, level-20 hero, up to 241 live enemies | ~0.28 ms per tick average; no O(n²) loop over enemies; one per-tick closure found and removed |

## Fixed (commit, test)

| # | Sev | Bug | Repro (before) | Fix | Test |
|---|---|---|---|---|---|
| 1 | **High** | **Mobile soft-lock without RevenueCat keys.** `REVENUECAT_API_KEYS` are still empty, but a mobile build resolved the store to `native`, so `storeEnabled()` kept the free-version gate on while nothing could be bought or restored. | Mobile build, clear `i05` → every island from `i06` on wears the "full adventure" lock; the store card is empty; deep links / Next Isle redirect to it. Campaign stops at island 6. | An unconfigured native store (no key, no explicit mode) is `noop`: no gate, every island playable. With a key it is unchanged. `97eba23a` | `tests/platform/iap.test.ts` (no-key store is noop, all islands playable; explicit native still uses the bridge) |
| 2 | Med | **Reset/import backup overwritten by an empty save after a crystal purchase.** A reset keeps purchase receipts at 0 crystals (so a pack is never delivered twice); `hasAnyProgress` counted those tombstones as progress. | Win islands, buy a crystal pack, Reset → backup OK. Reset again → backup replaced by the empty save; Recover can no longer restore the islands. Same for the import backup. | Backup guard ignores 0-crystal receipts (`worthBackingUp2D`, only at the two backup sites — the tombstones still travel in save codes). `0254ba89` | `tests/platform/market.test.ts` "a second reset after a crystal purchase keeps the real progress backup" |
| 3 | Low | **Selling a plain tier-III beacon left its aura on nearby towers** until the next combat step. | Tier-III barracks + tier-III beacon; sell the beacon, set the rally before the next tick → rally lands 4.17 from a 3.8-range barracks, and stays there (a tier-III barracks never re-checks on upgrade). | Any beacon sale recomputes auras (was: only specialized beacons). `b25ace59` | `tests/sim/beaconOverlap.test.ts` |
| 4 | Low (perf) | Per-tick closure (`squad.every(...)`) for every active Cloudguard banner. | — | Closure-free loop. `b25ace59` | covered by existing barracks/items tests |
| 5 | Low | **Daily Squall link opened just after UTC midnight silently became a plain run** (no Daily rules, no credit, no warning to the player). The sheet picks the island when opened; the run page re-derived "today". | Open the Daily sheet at 23:58 UTC, tap Play at 00:01 → plain island run. | Within 30 min of midnight a `?daily=1` link naming **yesterday's** Daily island plays yesterday's Daily (which `applyDailyWin` already credits as its one-day grace). `5bd7ec14` | `tests/render/modifiers2d.test.ts` "a Daily link opened just after UTC midnight…" |
| 6 | Low | **Retry kept the hero level from page load.** A run that levelled the hero up showed the level-up, saved the XP, but Retry played at the old level until a reload. | Run with Bran L4 that reaches L5 → Retry → still L4. | Live (re)starts re-read the hero from the save (`refreshHero` hook); a replay uses the exact hero config its run was recorded with (replays stay deterministic). `5f8f9646` | `qa/retryHeroLevel.mjs` (browser, dev server): before 1 → after Retry 11 → replay 11, no errors |

Files touched outside the sim/platform core (flagged for the UI pass): `src/render2d/ui/progress2d.ts`
(save logic, #2) and `src/render2d/ui/modes2d.ts` (run resolution, #5). Both are logic-only edits, no UI.

## Needs an owner decision

### A. Enemy abilities keep running while the enemy is stunned (Med) — fix ready, but it moves Hard balance
Hero stuns (Shield Bash, Thunder Call) and tower stuns do not stop three enemy abilities. Reed Piper
already does it right (`updateRefrain` returns while stunned).
- **Gloam Hexer** (`enemySystem.ts` `applyStun` / `updateHex`): `applyStun` cuts the channel, but the
  hexer re-locks a tower on the **same tick** and lands the hex while still stunned
  (probe: stun at t=0.98 → `hexCharge` at 0.98 → `towerHexed` at 1.68 with 1.28 s of stun left).
- **Rift Blinker** (`updateBlink`): the blink charge ignores `stunTimer`, so a stunned blinker teleports 4.5 units mid-stun.
- **Loam Burrower** (`updateBurrow`): a stunned burrower can dive and become untargetable for the rest of the stun.

The one-line gates (`stunMul !== 0` / `stunTimer > 0`) and regression tests were written and work, but each
one changes the tuned sims, so they were **reverted** per the "no balance change" rule:
- hexer gate: i23 greedy goes 0 lives lost (Master window 8–13) → `chapterEnemies` fails;
- burrower gate: i19 greedy 9 lives left (window 10–15), `aftershock` Hard clear fails;
- blinker gate: `sim:items` "Hard stays non-trivial" fails (Ch2 Hard 3★ 0/5 → 2/5, total Hard 3★ 3/18 → 6/16).

Recommendation: ship the three gates together with a small chapter-two retune in the next balance pass.

### B. Save codes can mint crystals (Med, money)
Save codes carry an unsigned hash (typo check only). `importSaveCode2D` merges the code's market data:
per-device `earned` counters are not capped and any `purchaseLedger` receipt id/amount is accepted.
Probe: a code with `counters:{x:{earned:1e12}}, purchaseLedger:{forged:999999}` imported → wallet
1,000,001,000,027 crystals. Sharing a genuine code also hands the buyer's receipts to every importer.
Stars/unlocks in codes are equally forgeable, so this is inherent to unsigned codes; it matters because
crystal packs are real money. Options: drop or zero imported receipts the device doesn't already have
(lean on RevenueCat restore), and cap imported `earned` to a plausible maximum (like `spent` already is).
Not fixed: a wrong choice either loses legitimately bought crystals on device moves or keeps the hole.

### C. URL parameters bypass progression on web (Low–Med)
`resolveQueryRun2D` builds the run straight from the URL, without the checks the 3D build has
(`runConfig.ts` `resolveRunConfig`):
- `?level=<locked island>` plays and **records** the win (unlocks the next island);
- `?challenge=a,b,c` on an uncleared island / challenges it doesn't offer are accepted (badges are
  limited to offered ones, but every active challenge goes to `wonChallenges`, which Steam achievements read);
- `?endless=1` on an uncleared island writes `bestEndlessWaves`;
- `?hero=<locked hero>&herolevel=20` is honoured in normal play (Daily, Hard, challenges) and the result,
  crystals and hero XP are saved.

Deep links that ignore locks are deliberate for QA (`isUnlocked2D` says so), and iOS/Steam have no URL
bar. Decide whether web should record such runs; the lightest fix is "debug-param runs don't record"
(treat `herolevel` and a locked `hero`/`level` like `isDebugScene`).

### D. Smaller design questions
- **Overcharge between waves** (`abilitySystem.ts`): its 7 s buff keeps ticking between waves while the
  36 s cooldown is frozen; a cast as a wave ends is wasted. Either freeze the buff or block the cast between waves.
- **Bosses and the Tempest keep pulsing / summoning / jamming while stunned** (they take half-length stuns).
  Likely intended set pieces; same family as A.
- **First-clear crystals are fixed by the first win on any difficulty.** Clearing on Easy first (1★ cap,
  ×0.75) pays a 24-crystal first-clear premium; the later Normal 3★ first clear (37) never tops it up. The
  test says "once across difficulties", so it is intended — noting the ~13-crystal cost of starting on Easy.
- Splitter children spawn before the parent's pool slot is freed: at the 360-enemy cap only one child spawns.
  Only reachable at the cap.
- Placing or upgrading a beacon leaves one tick of old aura values (soldiers update before combat).
  Harmless; fixing it shifts tick order in the sims, so left alone.

## Checked and found correct
- Kill / leak accounting (one place, slot freed at once, no double gold or lives); win detection waits for
  splitter children, raiders, escorts and mites; loss mid-pass is caught.
- Pool reuse: projectiles check `uid`, hexer locks use never-reused tower ids, every enemy field reset on spawn.
- Path math guards zero-length segments and NaN; every wave group's lane exists on every island (i01–i24).
- Determinism: no `Math.random` / `Date.now` / `performance.now` in sim or data; speed 1–4× only changes ticks per frame (fixed 60 Hz, frame dt capped); pause runs no ticks; backgrounding pauses.
- Towers: tier cap, spec only at tier III and once, abilities once, 70 % refund of everything spent; targeting modes measure from the tower and honour min range / aura / hero range; flyers skipped only by towers that can't hit them.
- Soldiers released on target death / burrow / flight / leash; removed on sale; rally snapped to road in range.
- Hero: hold cap, respawn in sim time, XP capped, skill points can't be double spent, broken saves fall back.
- Items (new rule): one shared cast counter with unlocks at 5 / 10 lives lost on Normal/Hard, healing doesn't cancel an unlock, Heartstone ceiling = half start lives rounded up (full on Easy, Bastion included), stars / best lives subtract healed lives, every rejection happens before the debit, charges debited at cast and never refunded by Restart, replays never spend, items off in Endless / Daily / challenges and while paused.
- Crystals only on wins, never on replays; first-clear and Daily bonuses de-duplicated across forks.
- Best records only rise; Easy caps stars at 1 and keeps the best-lives record; Workshop spend checked against available stars, merges refund/top up rather than go negative.
- Corrupt saves are cleaned field by field; truncated JSON repaired or recovered from the mirror.
- End of run recorded once (`endShown`), Retry/Restart on the victory board can't re-award a win.
- Endless HP / group counts capped; best wave is a max.

## Not verified
- Real iOS / Android devices and a configured RevenueCat project (only the adapter logic and the no-key path).
- Steam Cloud merge timing edge cases (read, not probed). Save-code import was reviewed, not fuzzed.
- Phone-class performance: the sim probe ran on the build server; the browser sweeps ran in SwiftShader.
- The first browser sweep logged one error on i09 whose text was cut from the runner's 30-line tail; two
  further i09 runs (full and from the last wave) and a second full sweep pass were clean.
