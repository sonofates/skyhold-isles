# Heroes — shared spec (owner decision 2026-11-18)

The owner reversed the P0 "no hero" decision: the 2D game gets heroes. This file is the single shared spec for the agents (sim/logic, UI, art). Change it only through the orchestrator.

## Rules
- One hero per run, picked on the island briefing (default = last used). Five heroes, unlocked progressively (hero 1 free from the start; the others unlock at campaign milestones — exact milestones in data, placeholder: after islands 2, 4, 7, 10). Monetisation of heroes on mobile is an OWNER DECISION — keep it data-driven, no IAP wiring yet.
- The hero is a unit on the map: tap/click the hero (or its HUD portrait) then tap a point on/near the road to move it there (it walks along the ground at its speed). It blocks and fights enemies in melee/ranged range automatically like barracks soldiers, but stronger. If it dies it respawns after a timer (`respawnSec`, scaled by difficulty such as Hard's `heroRespawnMul`) at its **last commanded rally point** (or, if never moved, at the first merge/chokepoint near the castle side of the road outside the castle); if that point is unsafe (ground enemies on/near it), it respawns at the nearest safe walkable road point within a short radius (`4.5u`) behind it towards the castle, and gains **1.5 s** of brief post-respawn invulnerability (`HERO_RULES.respawnInvulnSec = 1.5`) so it cannot be instantly killed.
- Each hero has: base stats (hp, armor, damage, attack speed, range, move speed, respawn time), 1 passive, 2 active skills with cooldowns (used from the HUD), and levels 1-10 within a run? NO — keep it simple: hero XP is earned per run (enemies killed, waves cleared) and is PERSISTENT across runs; hero level 1-20 from total XP; each level gives 1 skill point.
- Skill tree per hero: 3 branches x 4 tiers (12 nodes) + 1 capstone needing 2 branches at tier 3. Nodes upgrade stats, the passive, or the two actives (damage, radius, cooldown, extra effect). Respec is free on the world map.
- The existing global active abilities (Meteor, Overcharge from `src/data/abilities.ts`) are separate from hero skills and also come to 2D.
- Deterministic sim: hero logic lives in `src/sim` with seeded RNG only; render-only effects in `src/render2d`.
- Balance: `npm run sim:balance` keeps its current no-hero baseline (must stay identical). Add a separate hero balance report (each hero at level 1 and level 20 on a few islands) — informational, not a gate.

## The five heroes (original IP; never reference or imitate existing games)
| id | Name | Role | Look (art brief) | Passive | Active 1 | Active 2 |
|---|---|---|---|---|---|---|
| `bran` | Bran Ironoak | Shield knight, melee tank | Broad, kind-faced knight, oak-leaf tabard (green/bronze), round shield with an oak emblem, short beard | Bulwark: enemies he blocks deal less damage | Shield Bash: stun + damage in a small cone | Rally Banner: nearby soldiers gain armor and damage for a few seconds |
| `wren` | Wren Skyfletch | Ranger, long range | Lean young archer, sky-blue hooded cloak, feathered quiver, longbow, freckles | Keen Eye: crits on flyers | Volley: rain of arrows on an area | Hunter's Mark: marked enemy takes extra damage from all towers |
| `mira` | Mira Emberwisp | Fire mage, area damage | Small mage in a red-orange robe with ember embroidery, floating flame wisp companion, staff with a lantern head | Kindling: hits leave a short burn | Fire Ring: burning ring at a point | Wisp Burst: wisp dashes along the road, damaging all in its line |
| `tobb` | Tobb Gearwright | Tinkerer, support/builder | Stout tinkerer with goggles, leather apron full of tools, brass backpack with a little crane arm, cheerful moustache | Tinker: nearby towers attack slightly faster | Deploy Gizmo: places a small temporary auto-turret | Overhaul: instantly reloads + boosts a tower for a few seconds |
| `sela` | Sela Tidecaller | Storm priestess, control/heal | Tall serene priestess, teal and white robes with wave patterns, conch-shell staff, silver hair braids | Calm Waters: slowly heals nearby soldiers | Undertow: slows all enemies in an area | Thunder Call: lightning chains between several enemies |

Art needs (Codex): per hero — portrait (512 sq, for HUD/select), full-body select art (~900 tall), in-game sprite sheets in the same format/scale as the soldier and enemy sheets in `public/art2d/manifest.json` (idle, walk down/up/side, attack with impact frame, death), 2 skill icons + passive icon, 12 skill-tree node icons can reuse a per-branch icon set.
