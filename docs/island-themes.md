# Island themes (render-side visual identity)

Every island has a render-only theme keyed by `LevelDef.id` in `src/render/islandThemeTable.ts`. Themes never touch the
sim or the level grid; `src/data/levels/*.ts` stays pure data. Islands without an authored theme get a deterministic
biome preset derived from their id (palette/trees/sky/ambient, but no set pieces).

## Anatomy (`IslandTheme`, see `src/render/islandThemes.ts`)

| field | what it does |
| --- | --- |
| `pathStyle` | `dirt` (Kenney trail), `stone` (dark slate swatch), `sand` (tan) — colormap cell remap on the path tiles |
| `bridge` | `timber` (posts + rails + lanterns), `rope` (emerald lanterns), `stone` (parapets + masonry piers) |
| `grassTint`, `grassZones` | multiplicative tint of the grass texture, plus soft circular zones (golden fields, ...) |
| `ground` | per-tile ground kinds: `sand`, `cobble`, `field` (furrowed gold), `moss`; rules `shore` / `shore2` / `zone` / `all` |
| `cliff` | stone / bedrock / dirt colours of the island underside, `depthMul`, `spireMul` |
| `hills` | chance/height of dome hillocks on free decor tiles; `cap` = grass / stone / snow. Capped to 0.28 beside the route |
| `trees` | density + weights over `tree`, `treeLarge`, `oak`, `pine` (`snow` caps), `palm`, `autumn`, `blossom` |
| `decorBake` | odds of baked rocks / shrubs / crystals on decor tiles (+ crystal tint) |
| `details` | flower palettes, tuft/pebble multipliers, wheat tufts, shells + starfish on sand |
| `parapet` | low crenellated wall rim along coast edges of non-route tiles (fortress islands) |
| `waterDetails` | counts of lily pads / buoys / driftwood bobbing on the wave field |
| `goal`, `spawnCrystalCell` | goal crystal colours/glow + trimmings (`pillars`, `goldPillars`, `shards`, `sheaves`, `shells`, `poles`), spawn-gate crystal colour |
| `water`, `atmosphere` | sea colour; sky horizon/zenith, hemisphere, sun colour/intensity (`SceneManager.setAtmosphere`) |
| `ambient` | birds, butterflies (custom colours/size = fireflies, moths), falling leaves, themed islets (`isletStyle`), clouds |
| `setPieces` | authored landmarks (below) |

## Set pieces

`{ kind, col, row, yaw?, scale?, variant? }`, grid coordinates may be fractional. Rules (enforced by
`tests/render/islandThemes.test.ts` and `tests/render/siteLines.test.ts`):

- the origin tile must be a decor tile (`T`) or open water — never buildable grass or route tiles;
- each decor tile hosts at most one piece (claimed tiles get no trees / baked decor / ground details);
- tall pieces (windmill, watchtower, lighthouse, obelisk) must not hide route tiles from any of the four camera
  quarter-turns (shrink with `scale` or move them if the test complains).

Kinds: `windmill`, `cottage`, `lighthouse`, `waterfall` (face the coast with `yaw`), `arch`, `ruinWall`, `pillars`
(variant >= 2 adds a half-sunk plinth so they can stand in water), `banner`, `crystalGrove`, `dock`, `watchtower`,
`hayBales`, `scarecrow`, `brazier`, `seaStack` (variant 2 = crystal), `peak` (snow mountain, background), `boat`,
`gatehouse`, `obelisk`, `pond`, `stall`, `hut`, `parasol`, `tent`, `statue` (variant >= 2 = on a plinth), `cabin`,
`cairn`, `fountain`, `sheep`, `lamp`. Add a new one in `setPieceGeometry.ts` / `setPieceExtras.ts` (a function that
appends boxes/cylinders/cones to a `PieceBuilder`), then register it in `BUILDERS`, `KIND_SCALE` and `SetPieceKind`.

Animated parts (`windmill` blades, `banner` cloth, `waterfall` streaks, `boat`, `flame`) are instanced per family, so a
whole island costs ~7 extra draw calls at most.

## Dev loop without a browser

```bash
npx tsx scripts/previewMap.ts all                  # PNG of every island in /tmp/skyhold-preview (open with an image viewer)
npx tsx scripts/previewMap.ts 5 /tmp/p 0 1400 8,4,6  # island 5, default camera, zoomed on grid (8,4)
npx vitest run tests/render                        # placement / sight-line / draw-call budget checks
```

The preview is a software rasteriser (flat shading, no shadows/AO/post-processing) — good for composition and colour
relations, not for final lighting.
