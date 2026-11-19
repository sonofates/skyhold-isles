# Handoff — overnight UI/UX + game flow (`hermes/skyhold-night-opus`, Opus)

Brief: restart / replay, missing genre basics, HUD layout bugs, polish. **No file under `src/sim`,
`src/data`, `tools`, `public/art2d`, `enemyLayer.ts`, `enemySpecials.ts` or `src/platform` was
changed.** Everything is data-driven (any number of islands / foe types). Day-by-day log:
`docs/overnight/PROGRESS-skyhold-night-opus.md`. Shots: `docs/overnight/opus-shots/`.

## 1. Restart + Replay

- **Command layer** (`game2d.ts command(c)`, pure `ui/replay2d.ts`): every UI → sim mutation
  (build, upgrade, sell, target, rally, wave, hero move / skill, meteor, overcharge, speed) goes
  through one recorded path with the fixed-tick count. The ability bar and hero HUD now call
  `game.castAbility` / `game.castHeroSkill` (same rules as before).
- **Replay**: the sim is deterministic (seeded hero RNG, fixed ticks), so the last finished run
  replays from the same setup + recorded commands. End board → **Watch / İzle** (4th button,
  framed-play glyph). Player bar at the top: badge, wave, progress line, pause/play, 1×/2×/4×,
  leave ✕; keys Space / 1 2 4 / Esc. Input is blocked while watching; the run's own end board
  (hero XP, mode notes) comes back at the end or on leave; nothing is recorded twice. A fingerprint
  check (`game.replayMatched`) warns in the console if a replay ever drifts.
  - Bug found + fixed on the way: the tick counter kept running after the run ended, so the end
    tick depended on how frames chunked ticks.
  - Kept in memory only (decision: modifiers / hero level can change after a run).
- **Pause menu** under the Paused plate: Resume · Restart · Settings · World Map; Restart and
  World Map ask first (`confirmBoard`); Endless keeps its best wave either way.
- **3× speed** (the stepper already supported it): speed button cycles 1→2→3, key `3`.

## 2. Missing basics

- **Next-wave card** beside the horn (calm moments only): foe portraits × count, elite star, boss
  ring, **New** tag for never-seen foes, "Marches in 11s" / "Blow the horn to begin", "Call early:
  +26". Compact on phones, click-through. **Countdown ring** round the horn + seconds.
- **Foe info card** on tap (not on a plot): portrait, tags, live HP / ward shield, armour, speed,
  lives cost, bounty, description, how to stop it; gold dashed ring under the foe.
- **First-play coach** on l1c (5 tips, arrows, Skip; once, `skyhold2d_coach_v1`; `?coach=1`).
- **New-foe toast** when an unseen foe first marches (`skyhold2d_foes_seen_v1`, seeded from cleared
  islands).
- **Low lives**: red edge flash per life lost, slow pulse at ≤25 % / ≤3, lives number reacts.
- **Victory star rule** under the caption ("5 lives lost · 3 stars up to 2 lost, 2 stars up to 10").
- **HUD hover tooltips** (desktop) for horn / pause / speed; **pause on window blur** (desktop).
- Settings → Controls lists 3× and the replay keys.

## 3. Layout

- **Ability / hero bar** (`uiLayout.abilityBarSpot`): new two-row **block** layout, top-row and
  mid-edge candidates, castle / caves as weighted keep-outs (`gateKeepOutsPx`), rows/blocks
  preferred over an edge column down to 70 % size; the planned width was missing a gap (W chip ran
  off-screen). Desktop 1920/2560/1366: clear on every island except a graze of tower headroom on
  1366 l1c/i13 and the dense 1366 i12; edge column only on 1920 i11/i15. Phone: left-edge column on
  most islands (thumb reach), block on a few. Sheets: `opus-shots/bar-sheet-*.jpg`.
- **Horn** (`uiLayout.hornSpot`): keeps its old spot when clear, else the clearest spot near the
  caves (i09's horn sat on the cave mouth).

## 4. Polish

Gold "+N" pops on kills, HUD gold bump on earn / dip on spend, dust ring on build, gold ring +
sparks on upgrade. World map checked with 25 islands (`?mockislands=8`): already pages correctly.
Natural Turkish for every new string (glossary kept).

## 5. Round 2 (later in the night)

- **Boss / final-wave call-out** (`ui/waveBanner2d.ts`): big lettering mid-screen — "Boss
  incoming!" + name, or "Final wave!" (+ "{boss} leads the charge" when one does; every island but
  l1c ends on a boss). Click-through, fades in 2.6 s.
- **Next wave's caves** (`ui/laneMarks2d.ts`): on multi-cave islands (l1c, i10, i13–i16, and any
  new ones — data-driven) a bobbing red chevron with "×N" over each cave the next wave uses, shown
  with the next-wave card; it slides along its road off the card / horn / HUD.
- **Phone bar**: new narrow three-row **stack** (portrait / hero skills / abilities) up a side —
  the old right-edge column ran over the wave banner on l1c / i08. HUD pieces now weigh 10× a plot
  in the bar placement, so the bar never sits on the banner / plaque / buttons. Desktop unchanged.
- **Coach card** slides off the bar when the bar is in the top row (1366 l1c hid the skills),
  "Skip tips" sits on the title row, the hero arrow points at the hero's head (was far above on
  phones), tips hide under the pause menu, mouse wording for every step (meteor names Q).
- **Esc** with nothing open toggles the pause menu (never when it closed / cancelled something).
- **Desktop**: hover a built tower = pointer + faint range; hover the plaque = lives / gold tips;
  ring tooltips / rally banner / Workshop + reset confirms / map + hero tree hints no longer say
  "Tap" with a mouse; a fresh tower's "0 foes · 0 damage" is hidden.
- **Rally banner** moves to the top / bottom band when it would cover the barracks' range circle.
- **Next-wave card**: plot rings weigh 3×, HUD pieces / its horn 12× (i14 fixed, never over the
  bar). Still grazes one plot on dense i13 (1920/1366) and l1c 1366 between waves.
- Foe tips drop the 3D-only "Press R to see the sky lane" (R is a hero skill in 2D); end board's
  plain "Level n" in soft ink; "Wave n/N" bumps when a wave marches; text-wrap balance / pretty.

## QA scripts (all against `npx vite preview --port 4381`)

`qa/replayshots.mjs` (replay reproduces the run on EN/TR × desktop/phone), `qa/waveshots.mjs`,
`qa/flowshots.mjs` (lives, foe card, tooltip, blur, controls, new foe, victory), `qa/coachshots.mjs`,
`qa/barshots.mjs` (+ `qa/contact.py` sheets), `qa/mapshots.mjs`, `qa/juiceshots.mjs`. QA hooks:
`__p0.replay.{cmd,step,start,exit,speed,restart,probe}`, `__p0.{waveCard,lives,foe,foeAt,coach,goldPops,newFoe,callout,laneMarks}`.
Round 2: `qa/rallyBanner.mjs`, `qa/probe-bar.mjs`; `python3 qa/withPreview.py node qa/<x>.mjs` runs
one script against a short-lived preview; `python3 qa/gate.py` is the commit gate.

## Open questions

1. Replays live in memory only (one per page). Persisting would need the run's modifiers + hero
   config saved with it.
2. Phone bar: a left-edge column or the new side stack, whichever covers least; say if you prefer
   one pattern on every island.
3. The coach shows only on l1c's first plain play; Settings → General → Tips "Show again" brings it
   (and the new-foe notes) back.
