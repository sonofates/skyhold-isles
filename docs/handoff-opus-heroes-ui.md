# Handoff — hero UI + hero rendering (`hermes/skyhold-heroes-ui`, Opus)

Brief: render the run's hero, wire its input, put it on the HUD, add the hero picker on the
briefing, the skill-tree screen and the end-panel XP — on top of agy's hero sim
(`docs/handoff-agy-heroes.md`) and Codex's hero art (`docs/handoff-codex-hero-art.md`).
**No sim rule or hero data number was changed** (`src/sim/**`, `src/data/**`, `src/core/**`
untouched). Silent Skies left as is.

## 1. Hero rendering — `src/render2d/heroLayer.ts` (new)

- **Art loading:** `manifest.ts` now keeps the `heroes` section (`parseHeroArt`, never throws);
  `assets2d.ts loadHeroArt` loads only the run's hero (idle, walk down/up/side, attack, death,
  mipmapped) into `LoadedArt.hero`; `loadArt(..., heroId)` gets it from main2d; its textures join
  the boot prewarm upload.
- **Scale:** `heroes.<id>.height` world units over 90 % of the frame height (the figure measures
  ≈ 228/256 px in every idle frame). The same scale holds through attack and death, as Codex asked.
- **Sheets:** idle loop (4 fps); walking picks side / down / up from the smoothed screen motion with
  hysteresis (side when |dx| > 1.25·|dy|), mirroring per manifest metadata (down + side face right,
  up faces left); walk speed follows the real speed. Idle faces the sim's yaw.
- **Attack sync:** the swing is **pre-rolled** so the painted contact frame (`impact: 2`) lands on the
  sim tick that resolves the hit: when `hero.attackTimer` ≤ impact/fps and a hit is expected (melee:
  `state === 'fighting'`; ranged: a target in range), the sheet starts. The `heroAttack` event then
  confirms; if no pre-roll happened it jumps straight to the impact frame. QA counters: every
  attack in the runs was pre-rolled (`prerolled === attacksPlayed`). Skills play the attack sheet as
  a cast pose. Crits flash at the target.
- **Death / respawn:** death sheet once, fallen pose held 2 s then faded; respawn countdown (number
  + filling ring in the hero colour) over the castle spawn; respawn = fade/pop-in at the castle with a
  ring, glow and sparks.
- **Selection + bars:** faint ring in the hero colour always under the hero; a pulsing gold ring
  while selected; HP bar (green/amber/red with a hero-colour tag) always shown; red tint on hits.
- **Move feedback:** dotted path along the sim's waypoints + a pennant marker at the target; the
  reachable road (every ground lane + junction link at `maxOffRoadDist`) glows while selected;
  desktop hover shows the snapped target, or a red ✕ when the point is too far from a road; an
  invalid tap shows the ✕ briefly.
- **Skill FX (procedural, hero colours, `HERO_COLORS`):** Shield Bash cone shockwave + dust; Rally
  Banner standard planted by Bran + aura ring for its duration; Volley 16 arrows raining into the
  circle; Hunter's Mark red reticles over every marked foe (`enemy.markTimer`); Fire Ring burst +
  flame tongues on the sim's live `fireRings` (scorch = existing groundZone FX); Wisp Burst — Mira's
  ember wisp (always bobbing at her shoulder) dashes along the line and returns; Deploy Gizmo — the
  sim's gizmos drawn as little brass turrets (barrel follows yaw, life ring, cyan when overcharged);
  Overhaul gear ring + sparks under every tower with `overhaulTimer`; Undertow swirling tide; Thunder
  Call flashes (the chain itself is the existing `lightningChain` bolt). Passive reach (Tinker,
  Calm Waters) shown while selected. The painted skill icon pops above the hero on each cast.
- Depth: the body sorts in `layers.actors` by feet y like soldiers / enemies; gizmos too.

## 2. Input — priority rules (`src/render2d/heroInput.ts`, pure + tested)

Order of a tap/click (first match wins):
1. End panel → its buttons.
2. **Aiming** a global ability *or* a hero skill: the DOM layer takes the pointer in the capture
   phase (tap = cast; HUD pause/speed/horn cancel and go through).
3. Build ring hit → ring.
4. HUD buttons.
5. Paused → nothing.
6. Rally-flag placement pending.
7. Hero rules (`resolveHeroTap`):
   - no hero / hero down → pass (a selection is dropped);
   - tap on the hero (body box, grown to ≥ 44 px) → select, or deselect if selected (wins over a plot under it);
   - not selected → pass;
   - selected + tap on a plot / tower → hero dropped, that plot's ring opens;
   - selected + within `maxOffRoadDist + 0.8` of a road → move there (sim clamps to the verge), hero dropped;
   - selected + anywhere else → red ✕, hero stays selected.
8. Plots / towers as before.

Also: **portrait tap / H** toggles selection; **right click** (desktop) with the hero selected = move
and keep it selected (never a tap any more; a right click while aiming still cancels the aim);
**Esc** drops the selection (and closes the ring); opening the build ring, aiming an ability or a hero
skill drops the selection; hero aim and ability aim cancel each other.

## 3. HUD — `src/render2d/ui/heroHud2d.ts` (+ `.css`, new)

- Portrait medallion (Codex's brass-rimmed portrait) with an HP ring around the rim (respawn
  progress, grey, while down), level badge, respawn seconds over a greyed portrait, gold glow while
  selected, key chip H.
- Two skill buttons in the kit medallion with the painted icons, recharge sweep + seconds, ready
  glow / pop, red ✕ while aiming, key chips **E / R**, dimmed while the hero is down.
- Tooltips (EN/TR) from the data: hero (name, level + title, passive, HP, hint) and skills
  (description, live damage / duration from the resolved stats, recharge, state; "casts at once"
  for self skills).
- Aiming per skill shape: circle (Volley, Mark, Fire Ring, Gizmo, Undertow, Thunder), cone (Shield
  Bash), line (Wisp Burst), towers (Overhaul: candidates ringed, the one the sim will pick in gold —
  same rule as `heroSystem.pickTowersNear`, unit-tested against the sim). The hero's cast range is a
  dashed circle; touch: drag preview, cast on release. If the sim refuses (Thunder Call / Mark with
  no foe there) the hint says so and aiming stays. Rally Banner casts on press.
- It is one bar with the global abilities: `abilityBar2d.ts` takes a `lead` group and lays out the
  whole thing; when the longer bar does not fit cleanly it now shrinks the buttons (down to 46 px)
  and treats the plaque / wave banner as keep-outs. On l1c it becomes a column on the right edge
  (desktop) / left edge (phone).
- While selected, a small parchment hint replaces a centre banner ("Tap the road to send Bran there").
- `abilityArtFiles` now also reads Codex's nested `abilities.meteor.icon` / `abilities.overcharge.icon`
  (the painted ability icons were not showing before).

## 4. Hero select — briefing row + `openHeroSelect` (`src/render2d/ui/heroScreens.ts`, new)

Briefing (open islands): "Your hero" row — portrait + level, name + title, XP bar, **Change** and
**Skill tree** (badge = unspent points). Change opens **Choose your hero**: the five portraits
(level badge, ✓ on the chosen one, padlock on locked), the full-body select art, name, title · role,
blurb, level + XP bar + points, HP / damage / melee-ranged, passive and both actives with icons and
recharge; locked heroes show the rule ("Clear 7 islands to unlock", "5 of 7 cleared"). "Take this
hero" saves `heroes.selectedHero` (pure `selectHero` + `saveProgress2D`), which the next run uses;
`?hero=` / `?herolevel=` still win in main2d.

## 5. Skill tree — `openSkillTree`

From the map's new **Heroes** button (top row; the chosen hero's portrait, badge = unspent points
across heroes) and from the briefing / picker. Hero tabs; header with portrait, level, XP bar,
points ("2 skill points · 7 spent of 9") and **Reset (free)** (tap twice, like the Workshop
refund). Three branch columns (painted branch icon, name, description) × 4 tiers + the capstone
(three branch icons fanned, bar joining the branches). Node states: owned (gold ring + ✓, gold
connector), available (glow), not enough points (grey), locked by prerequisite (padlock). Tap a node
→ detail card: name, branch · tier · cost, effect text, why it is locked, **Learn**.

## 6. End panel

`EndPanel.setHero`: portrait, "Bran Ironoak +75 XP", "Level 5! · +1 skill point", XP bar animating
from the old fill to the new one (wrapping on level-ups). Stars/summary/buttons make room when it is
shown. Recorded runs use `recordRunOutcome(...).hero`; QA / debug scenes show the run's XP only.

## 7. Text

EN + TR for all UI (`hero.*`, `end.hero*`, `key.hero*`, `touch.hero`). Turkish hero data in
`src/i18n/heroesTr.ts` (names: Bran Demirmeşe, Wren Göktüy, Mira Korperi, Tobb Çarkusta, Sela
Gelgitçağıran; all 65 nodes, branches, skills, roles) behind `i18n/data.ts` lookups (`heroName`,
`heroSkillDesc`, `heroNodeDesc`, …; English data is the fallback). Settings → Controls lists H / E /
R, right click = move, and the touch rule.

## Files

New: `src/render2d/heroLayer.ts`, `heroInput.ts`, `ui/heroHud2d.ts|.css`, `ui/heroScreens.ts|.css`,
`ui/heroBits.ts|.css`, `ui/heroKeys.ts`, `src/i18n/heroesTr.ts`, `tests/render/heroesUi.test.ts`,
`qa/heroshots.mjs`, `qa/herosmoke.mjs`, `docs/heroes-ui-shots/*`, this file.
Changed: `game2d.ts` (layer + input wiring, `setHeroSelected`, `rightClick`, debug), `main2d.ts`
(hero art, HUD mount, end XP, `__p0.hero` QA hooks, `&herosel=1`), `manifest.ts`, `assets2d.ts`,
`endPanel.ts`, `ui/abilityBar2d.ts` (lead group, shrink-to-fit, nested icon keys), `ui/briefing.ts`,
`ui/worldMap.ts` (Heroes button, `?screen=heroes|herosel&focus=<id>`), `ui/metaScreens.ts`
(Controls), `src/i18n/data.ts|en.ts|tr.ts`.

## Gate

Final commit, Node 22: `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm test`: **88 files passed, 1
skipped; 1158 tests passed, 11 skipped** (16 new in `tests/render/heroesUi.test.ts`: tap priority,
hit box, aim helpers, an Overhaul preview-vs-sim check, HUD states, key clashes, the manifest's hero
section, TR coverage of every hero / branch / node) · `npm run sim:balance`: **"Balance check
PASSED: Greedy & Weak targets met across 33 level(s)!"** (sim untouched) · `npm run build` ✓.

## QA shots — `docs/heroes-ui-shots/` (`node qa/heroshots.mjs [all|map|select|tree|game|end|casts]`)

Against `vite preview --port 4371`, seeded save (5 islands won; Bran L10, Wren L4, Mira L1; Tobb /
Sela locked). Names `<en|tr>-<1920x1080|844x390>-<shot>.jpg`:
`map-briefing`, `map-topbar`, `select-unlocked`, `select-locked`, `tree-fresh(-detail)`,
`tree-spent(-detail)`, `game-idle`, `hud-tooltip-hero|skill` (desktop), `game-selected`,
`game-walking`, `game-attacking`, `game-skill-aim`, `game-skill-cast`, `game-skill2-cast`,
`game-dead`, `game-respawn-timer`, `game-respawn-fadein`, `end-xp`; plus `en-1920x1080-cast-<hero>-<0|1>`
for all ten skills. Mid-action frames are frozen with `__p0.freeze`. The script also checks: portrait
tap selects, a walking and an attack frame occur, the skill casts, the portrait shows the respawn
timer, Learn spends a point and owns the node, no sheet content overflows. Last full run (`all`, EN + TR, both sizes, 90 files): **no problems**.

## Open questions / doubtful

1. Unlock milestones are agy's placeholders (2 / 4 / 7 / 10 islands). Mobile monetisation of heroes
   is still an owner decision; nothing wired.
2. Keys: H / E / R chosen (Q / W are abilities, 1 / 2 speed, N wave, Space pause). OK?
3. After a left-click/tap move the hero is deselected (one select, one move — simplest on touch);
   right click keeps it selected. Want "stay selected" on touch too?
4. A plot tap while the hero is selected opens the plot (and drops the hero) rather than moving it
   next to the plot. Plots sit right beside roads, so this felt safer; say if you want the reverse.
5. Bar on l1c is a column at the screen edge because the bottom band holds plots; with five
   medallions there is no clean horizontal spot on that island. Other islands not swept.
6. The respawn countdown sits over the castle *gate* (the sim's spawn point), not the keep.
7. Gizmo, banner, wisp and all FX are procedural stand-ins; dedicated art could replace them.
8. SwiftShader runs at a few fps, so motion was checked by frame counters and frozen frames, not
   by eye on a real GPU.

## Notes for the sim owner (nothing changed there)

- Tobb's Deploy Gizmo clamps its point onto the road verge (2.4 u), so on l1c it can land on an
  empty build plot beside the road; the plot stays buildable. Looks odd, harmless.
- Overhaul is refused when no tower is within its range of Tobb; the HUD greys the preview out
  ("towers" shape invalid) before the tap, so the player never sees a silent refusal.
