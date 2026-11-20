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

RESULTS_PLACEHOLDER
