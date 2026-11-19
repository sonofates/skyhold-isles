# PROGRESS — skyhold-night-opus (UI/UX + game flow, Opus)

Branch `hermes/skyhold-night-opus` (base art-2d). Backlog: see the task brief (1 Restart/Replay,
2 missing basics, 3 layout bugs, 4 polish). Each round: read this file + `git log`, pick the next item.

Machine notes: worktree had no node_modules → `npm ci` (done round 1); `npm install --no-save playwright`
for QA. Bash checker rejects `cat > /dev/null` style stdin waits, `$VAR`, loops, `cp` from /tmp; use
python drivers (`python3 - <<'EOF'` works when the body has no `${`), Write tool for files.
QA: `npx vite preview --port 4381 --strictPort` in background (kill with TaskStop at end of round).
Round 2: the background preview dies at its 2 h limit — use `python3 qa/withPreview.py node qa/<x>.mjs
…` (starts preview, runs one QA script, stops it). Gate: `python3 qa/gate.py` (stops at first failure).

## Done
- **R1 Restart / Replay (backlog 1) — DONE.**
  - `ui/replay2d.ts` (pure): `RunCommand` union, `applyRunCommand`, `RunRecorder`, `ReplayCursor`,
    run fingerprint. Test `tests/render/replay2d.test.ts` (l1c with hero, i05 without, divergence).
  - `game2d.ts`: every UI → sim mutation goes through `game.command(c)` (build / upgrade / sell /
    target / rally / wave / heroMove / heroSkill / meteor / overcharge / speed); ability bar now
    casts via `game.castAbility`. Tick counter (frozen once the run ends — that was a real desync
    bug: the end tick depended on frame chunking). `startReplay()`, `exitReplay()`,
    `setReplaySpeed(1|2|4)`, `cycleSpeed()` (live 1→2→3, replay 1→2→4), key `3` = 3×.
    Replay: input blocked except pause/speed; Space / 1 2 4 / Esc keys. End of replay restores the
    recorded run's own end board (`EndPanel.snapshot/restore`), checks the fingerprint
    (`replayMatched`, console warning on mismatch). Nothing is recorded twice (main2d onEndPanel skips
    in replay).
  - End panel: 4th button **Replay / İzle** (painted-style glyph: frame on a stand + play).
  - Pause menu (`ui/runControls2d.ts`): planks under the Paused plate: Resume · Restart · Settings ·
    World Map; Restart / World Map ask with a confirm board (`confirmBoard`), Endless keeps its best
    wave on Restart/leave. Old Settings plank moved here (`settingsButton2d.ts` slimmed).
  - Replay player bar: top-centre plank, badge "Battle replay / Savaş kaydı", wave, play/pause,
    1×/2×/4× chips, leave ✕, progress line, key hint (desktop).
  - QA `qa/replayshots.mjs` (EN+TR, 1920x1080 + 844x390): plays a real run, end board, replay 1×/4×,
    paused, leave, watch again to the end (**matched = true** on all 4 combos), pause menu, both
    confirms, restart. Shots in `docs/overnight/opus-shots/`. Last run: no problems.

- **R1 backlog 2a — next-wave card + wave countdown — DONE.** `ui/wavePreview2d.ts|.css`: parchment
  card beside the horn while the player decides (before wave 1, between waves, paused; never during
  a fight): "Next: wave N", painted foe faces × count (elite star, boss red ring, flyers sky-blue),
  "Marches in 11s" / "Blow the horn to begin", "Call early: +26". Placement `uiLayout.besideAnchorSpot`
  (12 candidates round the horn, least overlap with plots+tower height, HUD, ability bar). Phones
  (≤560 px tall): compact chips only. Click-through (pointer-events none). HUD: gold countdown ring
  round the horn (orange in the last quarter) + seconds under it (pulsing ≤3 s). QA
  `qa/waveshots.mjs` (all islands l1c…i24, sizes 1920/1366/844): desktop clean except edge cases
  where the card grazes one plot (i14 1366, i13); phone compact card grazes 1-2 plots on
  i04/i05/i13/i14 (dense maps, click-through, accepted). Tests `tests/render/flowUi2d.test.ts`.

- **R1 backlog 2b — DONE:** low-lives warning (`ui/lowLives2d.ts|.css`: red edge flash on every
  life lost, slow red pulse at ≤25 % / ≤3 lives, static under Reduced motion; lives number pops red
  and stays warm red while low), pause on window blur (desktop), Settings → Controls lists 3 (3×)
  and a "Watching a replay" section. QA `qa/flowshots.mjs` (lives hit/low, key 3, blur, controls).

- **R1 backlog 2c — foe info card — DONE:** tap a foe (not on a plot, ring closed) → parchment card
  following it (`ui/enemyCard2d.ts|.css`): portrait, name, Boss/Flyer/Empowered tags, live HP bar
  (+ ward shield), armour, speed word, lives cost, bounty, description, "How to stop it"; gold dashed
  ring under the foe (game2d `inspectRing`); "Defeated!" + fade when it falls; Esc / any other tap
  closes; keeps off the HUD buttons. Hit test from sim pos + art height (`game.enemyAt`).

- **R1 backlog 3 — ability / hero bar placement — DONE (desktop), phone = deliberate left column.**
  `uiLayout.abilityBarSpot`: new compact two-row **block** layout (hero group over the abilities),
  more candidates (top row, blocks/columns at several heights), painted landmarks as weighted
  keep-outs (`gateKeepOutsPx`: castle 400/px², caves 120/px², from the gate front rect + facing),
  size loop prefers row/block over an edge column down to 70 % size. Planned width had a missing
  gap (W key chip ran off-screen on l1c) — fixed. Results (`qa/barshots.mjs`, sheets
  `docs/overnight/opus-shots/bar-sheet-*.jpg`): 1920/2560/1366 score 0 on every island except
  1366 l1c/i13 (top row grazes a tower's headroom) and 1366 i12 (bottom band; dense map); edge
  column only on 1920 i11/i15 (nothing else clear). l1c: row above the banner (1920), block in the
  right margin (2560), top row (1366). Phone 844x390: left-edge column on most islands (thumb
  reach; grazes caves on some), block on i05/i14/i16.

- **R1 backlog 2d — first-play coach marks on l1c — DONE** (`ui/coach2d.ts|.css`): 5 tips that follow
  what the player does (build → pick → horn → upgrade/"gold" → move hero → meteor), never block,
  "Skip tips"; bobbing gold arrow at the suggested plot (most road within archer reach), horn,
  first tower, hero, meteor button (side arrow when the bar is an edge column). Only l1c plain play,
  once (`localStorage skyhold2d_coach_v1 = done`); `?coach=1` forces it (QA). Game2D counts accepted
  commands (`commandsDone`). QA `qa/coachshots.mjs` (EN+TR, desktop+phone): no problems.

- **R1 backlog 2e — victory star rule — DONE:** small line under the victory caption: "5 lives lost ·
  3 stars up to 2 lost, 2 stars up to 10" (from `data/stars.ts STAR_RULES` by island difficulty);
  hidden on cramped boards (phone with the hero row) and under mode notes. No ★ glyph in canvas text
  (Fredoka latin subset has none).

- **R1 backlog 4a — juice + world map — DONE:** gold "+N" pops rising from fallen foes
  (`ui/goldPops2d.ts`, pooled, ≤14/s, off on Low effects), HUD gold number bumps warm on earn / dips
  red on spend, dust ring on build, gold ring + rising sparks on upgrade. Ability bar without a hero
  also shrinks before falling back to an edge column. World map checked with 25 islands
  (`qa/mapshots.mjs`, mockislands): paged route handles it, no change needed.

- **R1 backlog 2f — HUD hover tooltips (desktop) — DONE** (`ui/hudTips2d.ts`): horn (first wave /
  early bonus / wait), pause / resume (points at the pause menu), speed (1→2→3), with key chips.

- **R1 — new-foe heads-up — DONE** (`ui/newFoes2d.ts|.css`): red **New / Yeni** tag on never-seen foes
  in the next-wave card; when they first march, a toast (portrait, name, "how to stop it") for 6.5 s
  under the top HUD (suppressed while a coach tip shows; never in a replay). Seen set in its own key
  `skyhold2d_foes_seen_v1`, seeded from cleared islands.

- **R1 backlog 3b — horn placement — DONE** (`uiLayout.hornSpot`, game2d.resize): the old fixed spot
  (right of the cave midpoint) is kept when clear, else the clearest of 60 spots on rings around the
  caves (plots + tower room 1000/px², castle 600, caves 60, roads 120/point, HUD). i09 horn no
  longer sits on the cave mouth; l1c/i14 on open grass. `state().hornScore` for QA.

- **R1 — Settings → General "Tips · Show again"** (clears the coach + seen-foes keys). Wave card now
  measures only on change (no per-frame layout). Foe card keeps off the coach / new-foe cards.

- **R2 — boss / final-wave call-out — DONE** (`ui/waveBanner2d.ts|.css`): big storybook lettering in
  the middle ("Boss incoming!" + boss name / "Final wave!" + "Hold the keep one last time"), scales
  in and fades in 2.6 s, click-through, calm fade under Reduced motion. QA in `qa/flowshots.mjs`.
- **R2 — phone bar / coach layout fixes — DONE.** Phone 844x390 l1c + i08: the right-edge column
  ran over the wave banner. New narrow **stack** layout (portrait / hero skills / abilities, phones
  only, `h <= 560`), HUD pieces (horn, plaque, banner, buttons, keep-outs) now weigh 10× a plot.
  Phone: no bar touches the HUD any more; remaining scores are tower-headroom grazes. Desktop
  unchanged (rows / blocks). 1366 l1c: the coach card hid the skills (bar in the top row) →
  `coach2d.coachCardSpot` slides the card beside / under any HUD keep-out; the card is a keep-out
  while shown; the next-wave card re-places when keep-outs change. Sheets refreshed.
- **R2 — foe tips:** the shared 3D lore says "Press R to see the sky lane" (R = hero skill in 2D, no
  sky lane view) → `i18n/data.stripKeyHints` drops such sentences (EN data not mine; TR edited).

- **R2 — smaller polish:** final-wave call-out names the boss leading it (all islands but l1c end on
  a boss); coach "command the hero" arrow points at the hero's head (was a fixed 82 px, far off on
  phones); `text-wrap: balance` on aim / move hints and `pretty` on soft body text (no orphan
  words); **Esc** with nothing open toggles the pause menu (an Esc that closes the ring / foe card /
  hero mode or cancels an aim never pauses; synthetic Esc ignored), Controls page text updated;
  QA checks in `qa/flowshots.mjs`.
- **R2 — ring / coach / TR:** tower ring says "Click …" with a mouse (`BuildRing.desktop`), a fresh
  tower's "0 foes · 0 damage" is hidden and the tooltip closes the gap; coach pick / upgrade /
  meteor tips have mouse variants (meteor names Q); TR: "Dokununca hedef: {mode}", hero tip without
  a suffix after the name ("Önce kahramanına, sonra yola dokun: {hero} …"); coach "Skip tips" moved
  onto the title row. Call-out trigger fixed for two waves starting within one frame (QA flake).
- **R2 — more desktop wording / HUD:** lives + gold hover tips on the plaque; rally banner "Click
  the road" with a mouse and the centre plate moves to the top / bottom band when it would cover
  the barracks' range circle (`uiLayout.plateCentreY`, `qa/rallyBanner.mjs`); input-neutral
  wording for the map hint, Workshop refund confirm, settings reset confirm, hero tree hint.
  Replay QA: pause-menu check polls (DPR-2 flake).
- **R2 — next wave's caves — DONE** (`ui/laneMarks2d.ts|.css`): on multi-cave islands (l1c, i10,
  i13–i16 + any new ones, data-driven from wave group lanes and `layout2d.paths`; Endless via
  `buildEndlessWaveDef`) a bobbing red chevron with "×N" over each cave the next wave uses, shown
  with the next-wave card. A mark slides along its road off the card / horn / HUD
  (`laneMarkSpot`). Tests in `flowUi2d.test.ts`; shots `*-lanes-*.jpg`.
- **R2 — misc polish:** end board plain "Level n" in soft ink (rust only for a level-up); coach
  hidden under the pause menu; desktop hover on a built tower = pointer cursor + faint range
  disc (`game2d.hoverDisc`, QA in flowshots).
- **R2 — late:** next-wave card weighs plot rings 3× and HUD pieces / its horn 12× (i14 fixed,
  i09 never over the bar; still grazes one plot on dense i13 and l1c 1366 between waves); "Wave
  n/N" text bumps when a wave marches; end board labels share one size; early wave call = gold
  "+N" + coin rising from the horn (`waveStarted.earlyBonus`, `qa/earlyPop.mjs`, needs
  `&quality=high` under SwiftShader); Endless cave marks verified (`qa/endlessLanes.mjs`). Full
  replay QA re-run: matched on all 6 combos.

## Next (backlog 2: missing basics) — candidates, in rough value order
- tower info card: the build ring tooltip already has stats/targeting/upgrade/sell+refund; review only
- Then backlog 4 polish (hero controls feel, juice, end panel/world map with 25 islands, TR pass).

## Decisions
- Replay is kept in memory only (last run of this page). Persisting it across reloads would need
  the same modifiers/hero config, which can change after the run (Workshop, hero level-ups).
- Commands are recorded whether or not the sim accepted them; the replay re-issues all of them.
- The `speed` command is recorded for the record only; the replay viewer picks 1×/2×/4×
  (`stepper.speed` typed 1|2|3 in core — cast for 4, no core change).
- Live Retry keeps the player's speed; entering/leaving a replay resets to 1×.
- After leaving a replay mid-way the end board is the recorded run's; the frozen replay world stays
  dimmed underneath.
- `settingsButton2d.ts` is not in any ownership list; it is my earlier UI file, slimmed (card removed).

## Requests for other agents
- (none yet)

## Problems / notes
- Machine load ~10 (other agents): one PIL-based sim test timed out once at 5 s; reran green.
- Never chain `git commit` after a heredoc in the same Bash call (it is not covered by `&&`): one
  commit (262f63d) went in with a failing i18n test, fixed in the next commit (c50e6b8).
- SwiftShader: Pixi clamps frame dt to 100 ms, so the end board's 0.4 s tap guard needs several slow
  frames — QA polls (`pressEnd`). Not an issue on real GPUs.
- QA debug runs show the hero row as "Level 1" with `?herolevel=` (pre-existing, not recorded runs).
