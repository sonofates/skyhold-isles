# Handoff — UI round 6: global abilities in 2D + graphics settings (`hermes/skyhold-ui6`, Opus)

Owner asks (2026-11-18): "the old game had Meteor and tower boost skills, we forgot them" and
"why are there so few settings — where are graphics/visual settings?". Both are in, UI only:
no file under `src/sim`, `src/data`, `src/core`, `public/art2d`, `tools`, `progress2d.ts` or
`game2d.ts` was touched.

## 1. Global abilities (Meteor Strike, Overcharge)

**Bar** (`src/render2d/ui/abilityBar2d.ts` + `abilityBar2d.css`, logic in `ui/abilities2d.ts`)
- Two painted medallion buttons (`ui/medallion.webp`, `medallion-hi.webp` when ready), DOM over the
  canvas like the Settings/Guide buttons. Icon in the medallion's sky disc (procedural SVG until
  the painted icons land), dark recharge sweep + seconds (`27s` / `27 sn`), gold "ready" pulse and a
  pop when it comes back, cyan ring that runs down while Overcharge is active, red ✕ badge while
  aiming, key chip (Q / W) on desktop, parchment tooltip on hover/focus with the rules text,
  current-wave Meteor damage, slow, surge %, duration and recharge — all read from
  `src/data/abilities.ts` (EN + TR, locale numbers: `38%` / `%38`, `1.6s` / `1,6 sn`).
- States: `waiting` (dimmed before wave 1, like the sim's rule), `ready`, `cooldown`, `noTargets`
  (Overcharge with no tower built), `disabled` (run rules forbid abilities: grey + red bar),
  hidden with the end panel and story panels. Phones: a tap on a button that is not ready shows its
  tooltip for 1.8 s.
- **Placement is plot-aware** (`uiLayout.ts abilityBarSpot`, pure + unit-tested). First try was
  the bottom centre, but l1c has a row of plots along the bottom edge and the bar covered two of
  them. Now the bar takes the first clear spot among: bottom band between plaque and wave banner
  (centre, then sliding), above the plaque / banner, or a column up the left/right edge. "Clear" =
  not over any plot (plus room for the tower standing on it), the horn, the top-right HUD row;
  roads count a little. `node qa/ui6shots.mjs spots` checks all 17 islands at 1920x1080 and
  844x390: **score 0 (nothing covered) on every island at both sizes.** The build ring and its
  tooltip keep out of the bar (`addHudKeepOut`).

**Aiming**
- Tap / click the button or press **Q** (Meteor) / **W** (Overcharge). 1/2 were taken (speed).
- Meteor: the area circle (sim radius 3.4 units) follows the mouse; on touch it starts at the
  screen centre, follows the finger while it is down and casts on release. Outside the island it
  greys out and does not cast.
- Overcharge: every built tower gets a pulsing cyan glow + gold ring, the hovered one turns gold;
  tap/click a tower to cast. Tapping empty ground keeps aiming (the hint nudges).
- Cancel: a second tap on the button, **Esc**, or **right click**. Pausing, opening Settings /
  Codex, or the end panel also drop the aim. A tap on pause / speed / horn while aiming cancels
  and still works.
- A parchment hint next to the bar says what to do ("Tap the map to drop the meteor" / "Esc or
  right click cancels", TR too).
- Input: listeners on the canvas's parent in the capture phase, so while aiming game2d's own plot
  taps / hover never see the pointer. **No game2d.ts hook was needed.** To close an open build
  ring when aiming starts, the bar sends game2d's own Esc shortcut (its ring/selection are
  private).

**Casting — needs the sim owner's attention.** `SimWorld.castMeteor/castOvercharge` refuse on
plot maps: `canUseAbilities()` has `!this.grid.isPlotMode` (from when 2D had no ability UI), and
`tests/render/modifiers2d.test.ts` asserts that. src/sim was off limits, so `castMeteor2D` /
`castOvercharge2D` first ask the world (they will win as soon as the sim allows plot maps), then
fall back to the world's own `abilitySystem.castMeteor/castOvercharge` behind the same gate minus
the plot clause (`!mods.abilitiesDisabled`, outcome ongoing, first wave started). Cooldowns
(Workshop-scaled), damage, slow, cleanse, fire-rate surge and events are all the sim's.
Recommended sim follow-up: drop the plot-mode clause from `canUseAbilities()`, update that test,
and let `silentSkies` / `abilityCooldownMul` count in 2D again (`hasModifierEffectIn2D`,
`isChallengeEffectiveIn2D` currently filter them out, so no 2D challenge disables abilities yet —
the disabled look is wired and unit-tested but not reachable in normal play).

**Overcharge targeting vs the sim:** the brief says "tap a tower", but the sim's Overcharge is
island-wide (every tower +65% attack speed, all stuns cleansed). The tap picks the tower the surge
starts from (biggest burst) and confirms; every tower gets the aura. Open question below.

**FX** (`src/render2d/abilityFx.ts`, procedural now, in map px so they follow fit + shake)
- Meteor: ground warning ring, the meteor streaking in over the sim's 0.32 s impact delay (flatter
  run for targets near the top edge, embers + smoke trail), then flash, shock rings, rock shards,
  smoke, embers and a scorch that fades in 2.6 s. Screen shake is game2d's existing
  `meteorImpact → triggerShake2D`, so it follows Screen shake and Reduced motion.
- Overcharge: burst on every tower, then a pulsing aura + rising sparks under each tower while it
  lasts. FX density follows the Effects setting.
- Sound: already there — the shared SoundManager binds `abilityTargeted`, `meteorImpact`,
  `overchargeActivated` (audio2d.ts untouched).

**Painted art Codex is making — expected manifest keys** (`public/art2d/manifest.json`, a new
top-level `"abilities": { key: "path relative to /art2d/" }`; the parsed manifest drops unknown
sections, so the bar reads the raw JSON itself; every key is optional):

| key | used for | notes |
| --- | --- | --- |
| `abilities.meteorIcon` | Meteor button icon | round, transparent, fills the medallion's sky disc (~62% of the medallion), 256 px+ |
| `abilities.overchargeIcon` | Overcharge button icon | same |
| `abilities.meteorRock` | the falling meteor | head bottom-left, tail up-right (≈45°), transparent; anchor (0.3, 0.7) |
| `abilities.meteorCrater` | scorch decal after impact | top-down, soft transparent edges, drawn ≈ 1.15 × radius wide, squashed to 0.62 |
| `abilities.overchargeAura` | ground ring under overcharged towers | top-down, drawn untinted with normal blending, squashed to 0.55 |
| `abilities.targetRing` | Meteor aiming circle | top-down ring, transparent middle, drawn at the true radius |

Missing keys keep the procedural stand-ins; nothing else needs a code change.

## 2. Settings: General / Audio / Graphics / Controls

`ui/metaScreens.ts openSettings` now has four painted tabs (the Logbook's tab planks, above the
scrolling body, fixed board height so it does not jump). Same sheet on the world map and in game.
- **General:** Language, Damage numbers, Vibration (+ store and progress reset on the world map).
- **Audio:** Sound, Volume, Music (unchanged behaviour).
- **Graphics:**
  - Quality: Auto / Low / Medium / High → the shared `GameSettings.quality` field (already in
    storage.ts) → locks the render tier live (`AdaptiveQuality`), `?quality=` still wins. On
    desktops the tier only trims effects (the owner's earlier blur fix stays intact); on phones
    it also sets the canvas resolution, as before.
  - Render resolution (desktop only): Auto or 50–100% (slider, 5% steps), applied live.
  - Effects: Low / Normal / High (particle density ×0.5 / ×1 / ×1.35, capped by the pool).
  - Frame rate cap: 30 / 60 / Unlimited (= display refresh; default, so nothing changes for
    existing players). The governor judges frames against the cap, so a 30 cap is not taken for a
    slow device.
  - Show FPS: parchment chip top-left (from main2d's FrameStats, twice a second).
  - Reduced motion: no screen shake (whatever the Shake toggle says), flashes capped at 40 map px,
    no pulsing on the ability bar / primary planks. Defaults to the OS `prefers-reduced-motion`.
  - Screen shake moved here (dimmed with a note while Reduced motion is on).
  - Fullscreen (desktop, when the browser allows it): toggles `requestFullscreen`.
- **Controls:** key caps for Space, 1, 2, N, Q, W, Esc and right click; touch devices also get the
  three touch rules.

**Persistence:** the quality preset is `GameSettings.quality`. The rest is a `graphics` object in
the same settings JSON plus a mirror key `skyhold_isles_graphics_v1` (storage.ts drops unknown
fields on save, same trick as the language in `i18n/localeSetting.ts`); `reapplyGraphicsSettings()`
runs after every Settings save. Junk / missing values → defaults; old saves load unchanged.

**Live apply:** each change fires `skyhold:graphics`; main2d re-applies prefs, ticker cap, FPS chip
and the reduced-motion settings view; `AdaptiveQuality.observe` returns true once so game2d re-runs
its own `fx.setQuality` + `applyResolution` (no game2d change).

## Files

New: `src/render2d/abilityFx.ts`, `src/render2d/ui/abilityBar2d.ts`, `ui/abilityBar2d.css`,
`ui/abilities2d.ts`, `ui/graphicsSettings.ts`, `ui/fpsCounter.ts`, `tests/render/ui6.test.ts`,
`qa/ui6shots.mjs`, `docs/ui6-shots/*`, this file.

Changed (mine): `src/render2d/main2d.ts` (wiring, `__p0.abilities/aimAbility/freeze` QA hooks,
`&settab=`), `ui/metaScreens.ts` (Settings sections), `ui/paintedUi.css` (tab/choice/key styles),
`uiLayout.ts` (`abilityBarSpot`), `src/i18n/en.ts` + `tr.ts` (`set.*`, `key.*`, `touch.*`,
`ab.*`, `fps.counter`).

**Minimal hooks in render files outside my list (please keep when merging):**
- `src/render2d/renderResolution.ts`: `GraphicsPrefs` / `setGraphicsPrefs` / `graphicsPrefs`
  (module state, neutral by default); `renderResolution()` multiplies by `renderScale`;
  `AdaptiveQuality` takes the player's lock (`isLocked` includes it), re-applies on a prefs change
  (returns true once from `observe`), normalises frame time under a <60 fps cap.
- `src/render2d/fxLayer.ts`: `setFxPrefs` / `fxPrefsNow` (density multiplier applied in
  `setQuality`; `spawn('flash')` capped at 40 px under Reduced motion).
- `game2d.ts`: **no change.** The settings it reads come from `Game2DHooks.getSettings` (existing
  hook), which main2d now fills with a cached view (Shake off under Reduced motion).

## Gate (final commit)

`npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm test`: **85 files passed, 1 skipped; 1117 tests
passed, 11 skipped** (15 new in `tests/render/ui6.test.ts`) · `npm run sim:balance`: **"Balance
check PASSED: Greedy & Weak targets met across 33 level(s)!"** (sim untouched) · `npm run build` ✓.

## QA shots (`docs/ui6-shots/`, `node qa/ui6shots.mjs [abilities|settings|spots]` against `vite preview --port 4361`)

- `ab-<en|tr>-<1920x1080|844x390>-N-*.jpg`: 0 prewave, 1 idle (ready), 2 tooltip (desktop),
  3 aiming Meteor, 4 meteor falling, 5 impact, 6 recharge, 7 aiming Overcharge, 8 Overcharge aura.
  Mid-cast frames are frozen with the QA-only `__p0.freeze` (ticker stop), not the pause plate.
- `set-<en|tr>-<size>-<general|audio|graphics|controls>.jpg` (+ `-graphics-scrolled` where the
  phone needs it), `set-map-en-*-general.jpg` (world map), `spot-<i05|i12|i16>-*.jpg`.
- The script also checks: bar ready in wave, aim shown, impact happened, recharge running,
  highlights + auras drawn, no settings row wider than the board, Quality=Low and Show FPS apply
  live in a run. Result: **no problems**.

## Open questions for the owner

1. Overcharge: keep it island-wide (tap any tower to fire it, as now), or should it become a
   single-tower boost (needs a sim change: per-tower surge, probably stronger)?
2. Abilities are usable from wave 1 on, as in the old game; recharge only runs during waves (sim
   rule). OK?
3. Should `Silent Skies` (abilities off) come back as a 2D challenge now that abilities exist?
4. Keys Q / W — fine, or prefer the old F / G (still in `src/data/abilities.ts` `hotkey`)?

## Doubtful / left undone

- Visuals are procedural placeholders until Codex's `abilities.*` art lands; the meteor rock in
  particular is a simple painted-looking blob.
- No in-game "disabled" case is reachable today (see the Silent Skies note).
- SwiftShader (headless) runs at a few fps, so the shots show single frames; motion timing was
  checked by counters, not by eye on a real GPU.
