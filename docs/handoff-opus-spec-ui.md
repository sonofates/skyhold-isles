# Handoff — tier-IV specialization UI (Opus, branch `hermes/skyhold-spec-ui`, base `art-2d`)

Codex built the 16 specializations (8 families × 2 branches, one ability each), their sim rules and
painted art. This branch gives them a UI. No sim rule or specialization number was changed.

## What the player gets

| Where | Before | Now |
|---|---|---|
| Build ring, tier III | "MAX" medallion (fully upgraded) | Two **specialization medallions** (branch portrait, upgrade arrow, price tag; greyed + red price when short of gold) above the tower, targeting / rally and sell below. Hover / first tap: tooltip with name, one-line role, price, the branch text and the tier-III → branch pips (gains in green); the range preview shows the branch's own reach (e.g. Cloudbreak 14.2). Second tap / click: the comparison card — also when gold is short (the card says what is missing) |
| Comparison card | — | Painted board "Choose a specialization": both branches side by side — portrait, name, role, price, **Choose** plank, the branch text, **Changes from tier III** (every player-facing stat, `old → new`, gain green / loss red, "—" for an effect that goes away), **Ability to buy later** (name, price, text, its stat changes), "Permanent: the tower keeps this branch until you sell it." Pauses the run while open; Escape / B / the close seal cancel (ring stays open). Keyboard / pad: focus lands on the tapped branch's plank, arrows walk between the two, Enter / A chooses. Portrait phones stack the two columns |
| Specialized tower ring | — | One medallion per ability (branch portrait, upgrade arrow, price tag, **level pip** over it — empty / filled, "Owned" when bought), targeting / rally, sell (refund includes branch + ability). The **tower info card** shows on open without hovering anything: branch name, "Archer · tier IV", "Abilities: Throughshot" / "No abilities bought yet", effective stat pips (`towerStats`) |
| World | — | Transformation flourish on the specialization (gold glow column, two rolling rings, sparks and rising motes over the sim's pop; Reduced motion = one soft ring + a calm glow). An ability buy gets the plain upgrade puff. The branch art (Codex) swaps in |
| Codex → Towers | Tiers + signature | Plus **Specializations (tier IV)**: both branches per family with portrait, name, role, price, text, stat changes and the ability (name, price, text, its changes) |
| Tip | — | One-time "Choose a specialization" card + bobbing arrow at the first tier-III tower (live play, any island), gone for good after the first specialization or "Got it" (`skyhold2d_spechint_v1`); hidden while the ring / a board / the coach / a replay / the pause is up. `?spechint=1` forces it |
| EN / TR | English data only | Names, roles, branch and ability texts in both languages by id (`DATA_TR.specs`, `DATA_TR.abilities`, `specName / specRole / specDesc / abilityName / abilityDesc` in `src/i18n/data.ts`), Codex's TR table plus the later corrections (Relay Grove, Live Wire, Cloudbreak, Gateward, Iron Mantle, Wax Caps) |

## Wiring (files)

- `src/render2d/ui/replay2d.ts` — `RunCommand` `{k:'spec', id, spec}` / `{k:'ability', id, ability}` → `world.specializeTower` / `world.buyTowerAbility`; live input and replay go through the same `applyRunCommand`.
- `src/render2d/buildRing.ts` — `RingAction` `compare` / `ability`; `TowerPanelInfo.branches / specialization / stats`; tier-III and specialized token sets; ability pips; wrapped `desc` paragraph in the tooltip; the default info card (`infoTip`); lazy branch portraits (`src/render2d/specArt.ts`, manifest `towerSpecializations.<id>.portrait` parsed into `ArtManifest.specPortraits`).
- `src/render2d/uiLayout.ts` — `statRowsFor(type, stats)`; `TOWER_RING_4` (4-medallion tower ring: the choices high left / right, clear of the tower; top-row and edge variants).
- `src/render2d/game2d.ts` — passes branches / specialization / `towerStats` to the ring; `onSpecCompare` hook, `specializeTower()` / `buyTowerAbility()` through `command()`; range disc and attack pre-roll use `towerStats(t)` (Codex's round-24 request: Cloudbreak range / blind spot); portraits prefetched when a tower reaches III; `specFlourish()`; `towerTopScreen()`.
- `src/render2d/main2d.ts` — opens the card (pauses / restores), mounts the tip, QA hooks `__p0.spec()` and `__p0.towerTop(id)`.
- `src/render2d/ui/specCard2d.ts` + `.css` (card), `ui/specInfo.ts` (pure: stat diffs, formats), `ui/specHint2d.ts` (tip), `ui/codexSheet.ts` + `codex2d.ts` (codex branches).

## Gate (final commit)

`npx tsc --noEmit && npm run lint && npm test && npm run sim:balance && npm run build` — all green:
TypeScript 0 errors, ESLint 0, **Vitest 1,539 passed / 11 skipped (121 files)**, **sim:balance PASSED, 41 levels**, build ✓ (the usual Vite chunk / dynamic-import warnings).
New tests: `tests/render/specUi.test.ts` (stat diffs for all 16 branches in EN + TR, every changed stat shown or deliberately internal, direction of good / bad, portraits present for all 16 ids, tip target), `tests/render/replay2d.test.ts` (spec + ability through the command layer replay to the identical world; a second branch / a repeated or foreign ability is refused), `tests/i18n/coverage.test.ts` (DATA_TR covers exactly the 16 branch + 16 ability ids, EN role lines), `tests/render/uiLayout2d.test.ts` (4-medallion ring never covers the tower / stays on screen at every plot position and view; choices above, below on top-row plots).

## Browser QA (real input: canvas taps / clicks, the DOM card, keyboard)

| Run | What | Result |
|---|---|---|
| `qa/specshots.mjs` × 8 (EN / TR × 2000×991 / 844×390 phone × branch 1 / branch 2) | every family on l1c: build via ring → upgrade to III via ring → tier-III tip → tooltip + branch range preview → card (both columns: portrait loaded, changes, ability) → keyboard walk (both planks reached) → Choose (Enter on desktop, tap on phone) → flourish → branch art drawn on the plot → ring with info card → buy ability via ring → ring with "Owned" | **64 / 64 family runs, 0 problems**; 8 flourishes per run; branch ring fit dx / dy / dw = 0 for all 16; canvas text audit clean; card DOM audit 0 problems (476 texts per run); `hudCheck` 0 overlaps, 0 pieces outside their slot after all eight branches stand |
| `qa/specextra.mjs` | short of gold (Farwatch 155 vs 150 gold, Swallow affordable): grey token + red price, tooltip "Need 155 gold", card opens, Farwatch plank disabled + "Need 155 gold", focus on the affordable plank, run paused under the card, Escape closes and resumes with nothing bought (EN desktop, TR phone); Reduced motion flourish; replay of a run that earned its gold and bought Swallow Roost + Gathering Flock through the ring | **0 problems**; replay world has swallow / flock again |
| `qa/specaim.mjs` | the four directional families' 8 branches in the turret-aim scene, one crop per 45° sector | all 8 branches draw their own turret / body in all 8 sectors (`spec-ui-shots/sheet-directional-branches.jpg`). 10 "drawn one sector off" lines — **identical on the plain tier-III towers** (`--baseline=1`): the aim scene parks its target near sector borders, not a branch-art fault |
| `qa/uiaudit.mjs` (full: 540 screens EN + TR × 6 sizes, with 5 new screens: codex branches, tier-III ring, card, specialized ring, tip) | DOM overflow / frame / cramp + canvas text | first full pass: 6 frame findings, all on the new screens (codex scroll cut a line in half = QA scroll position; 932×430 TR card note 1.5 px over the foot = real). Fixed (QA scroll snaps to a block, the "permanent" line became the card's fixed foot); re-audit of every spec screen at all 6 sizes × 2 languages: **0 problems** |

Shots (all looked at enlarged): `docs/spec-ui-shots/` — comparison cards for all eight families in EN + TR at 2000×991 and phone (`*-3-card`), both branches (`b0` / `b1`), the full flow for one family (`*-1-ring … 7-owned`), tier-III tip (`*-0-hint`), all eight branches on the map and in battle, short-of-gold ring + card, Reduced-motion flourish, codex branches, the uiaudit spec screens, directional sheet. Phone shots are 2× DPR downscaled to 1400 px. The `tr-desk-b0` / `en-phone-b0` / `*-b1` cards were taken one build before the "permanent" line moved to the board's foot (it sits at the end of the scrolling body there); everything else is the final build.

## Art check (task item 3)

No missing art: all 16 branches load their map art and portrait, draw on the plot ring with zero error, and the eight directional branches show all 8 facings. Full-body families played their attack frames in battle (Snowbell, Rimeglass, Relay, Stormheart, Tailwind, Horizon); the Gateward / Briar gates only open on a squad spawn / return, which my battle sample did not reach (Codex verified them in round 7).

## Findings / open points

- **Mortar mirror at the south sector (Codex / towerLayer owner):** in the aim scene, Cinder Kiln and Cloudbreak draw sector 2 (straight down) with frame 0 *mirrored*, the plain tier-III mortar unmirrored. The painted south frame is near-symmetric so it reads fine; worth a look if the art is not symmetric.
- **"tier IV" lettering:** in the 14 px canvas tooltips the roman "IV" sets tight in Fredoka and can read like "M" at a glance (same font as the existing "III"). A letter-spacing tweak or "Tier 4" would fix it; left as is for consistency with the existing roman tiers.
- **Barracks now in the 2D codex** (it is 2D-only, so the shared 3D list left it out; its two branches had no codex page otherwise). The tower count reads 8.
- The tip shows on any island in plain play until the first specialization; on l1c it waits while the first-play coach card is up.
- Each ability has one level today; the ring's pips support up to three per medallion if levels are added.
- `qa/specdebug.mjs` is a small geometry probe for the card (kept for the next layout change).

## Not done / out of scope

Push / deploy (runner pushes the branch). No sim or number changes. Codex's other requests in PROGRESS-codex.md (camera fit on i17–i22 phones, enemy card armor refresh) were not part of this task.
