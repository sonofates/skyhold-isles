# Skyhold Isles Market

The Market exchanges Sky Crystals (Gök Kristali) for individual belt items between islands. In a live game, the belt and inventory both decrease on a successful cast. Restarting or leaving keeps that debit. Unused items remain in inventory.

## Screen and belt API

| UI action | Module | Signature |
|---|---|---|
| Read wallet, inventory and equipped types | `src/render2d/ui/market2d.ts` | `readMarket2D(): MarketWallet` |
| Buy one item for crystals | same | `buyItem2D(id: ItemId): boolean` |
| Replace equipped slots, in display order | same | `setLoadout2D(ids: readonly ItemId[]): boolean` |
| Preview the belt for a proposed run | same | `runItemBelt2D(difficulty: DifficultyId, disabled: boolean): ItemCounts` |
| Read remaining uses in the active run | `src/sim/itemSystem.ts` | `game.world.itemSystem.belt(): ItemCounts` |
| Cast from live 2D input | `src/render2d/game2d.ts` | `game.useItem(id: ItemId, x?: number, z?: number): boolean` |
| Cast in a headless sim | `src/sim/world.ts` | `world.useItem(id: ItemId, x?: number, z?: number): boolean` |
| Read catalog, targeting and prices | `src/data/market.ts` | `ITEM_IDS`, `ITEMS[id].target`, `ITEMS[id].price`, `MARKET_RULES` |
| Get translated item text | `src/i18n/data.ts` | `itemName(id: ItemId): string`, `itemDesc(id: ItemId): string` |

`MarketWallet` in `src/game/market.ts` has `crystals: number`, `inventory: Record<ItemId, number>` and `loadout: ItemId[]`. Both read APIs return snapshots the UI can safely modify. Read the wallet when opening the screen, after a purchase or loadout change, and after cloud hydration. The existing `onProgress2DCloudHydrated(listener)` in `src/render2d/ui/progress2d.ts` returns an unsubscribe function.

The loadout accepts zero to three distinct IDs. An empty slot list is valid. An equipped, out-of-stock item keeps its slot and displays zero uses. Purchases require room under the 99-per-type cap and enough crystals. Save mutations return false on failure. The EN/TR dictionaries expose `market.title`, `market.currency`, `market.price` (parameter `n`), and the other `market.*` labels in `src/i18n/en.ts` and `tr.ts`.

`Game2D.newRun()` already initializes live charges from the current save. `ItemCounts` is a partial record keyed by `ItemId`. Each equipped type starts with the smaller of current stock and the difficulty cap (Easy/Normal 3, Hard 1). Changes in the Market apply on the next island start. Challenge toggles, Daily Squall and Endless disable all items to keep handicaps and records comparable. Workshop upgrades and ordinary difficulty selection allow items. For a preview, pass the resolved run's `modifiers.itemsDisabled`.

For targeting, `point` and `road` items take map **world x/z**, the same coordinates as Meteor. For `self` items, omit the coordinates. The first horn opens the belt. Live input is rejected while paused, viewing a replay, or after the run ends. A full-health heal, an off-map point, a banner too far from a road, an empty freeze radius, or a bell with nobody to push costs nothing. Ember Pot can ignite an empty patch in anticipation of a wave. The cast call handles debit, effects and recording. Read the updated belt after acceptance. Replay playback uses the recorded starting belt and tick-stamped commands and never debits the wallet or pays another win reward.

## Economy

All values come from `src/data/market.ts`. New saves and v1/v2 migrations receive 28 crystals and one of each item. The default first three slots are Ember Pot, Frost Lantern and Heartstone.

| Awarded stars | Easy first / repeat | Normal first / repeat | Hard first / repeat |
|---|---:|---:|---:|
| 1 | 29 / 5 | 38 / 6 | 51 / 9 |
| 2 | — | 42 / 8 | 57 / 10 |
| 3 | — | 46 / 9 | 62 / 12 |

For a win, the base is `14 + 4 × awarded stars`. Add 20 for the first clear of that island across all difficulties. On later clears multiply the base by 0.35. Multiply by difficulty (0.75 / 1 / 1.35) and round to the nearest integer. Easy awards at most one star. A Daily Squall win counted by the existing day/streak rule adds 18 after rounding. Repeating that day's Squall earns the ordinary replay rate. Losses, Endless, and replay viewing award zero crystals.

At two stars on Normal, each of the 25 islands pays 42 on first clear. That buys an Ember Pot, a Frost Lantern and a Sky Purse with two crystals left. The campaign plus starter gift provides 1,078 crystals at that rating. The normal game-end hook in `src/render2d/ui/progress2d.ts` persists the payment alongside the win. `recordRunResult2D(outcome, levels?).crystalsEarned ?? 0` is the amount for the end panel. Read the result of the existing call once per run.

| ID | EN / TR | Crystals | Effect |
|---|---|---:|---|
| `emberPot` | Ember Pot / Kor Çömleği | 12 | Radius 3. Immediate armor-piercing hit for 65% of that wave's Meteor damage, rounded. The ground burns for 2 s, dealing 6 per burn tick to surfaced ground enemies. |
| `frostLantern` | Frost Lantern / Ayaz Feneri | 14 | Radius 3.4. Freezes surfaced foes, including flyers, for 4 s. Bosses and empowered champions instead receive a 50% slow. |
| `heartstone` | Heartstone / Can Taşı | 16 | Restores up to 5 lost lives, capped at the run's initial lives including bonuses. Stars count every leaked life, even after healing. Best-lives records also exclude restored lives. |
| `skyPurse` | Sky Purse / Gök Kesesi | 14 | Immediately adds `round(0.30 × island starting gold + 5 × current one-based wave)` gold. |
| `cloudguard` | Cloudguard Banner / Bulut Muhafızı Sancağı | 12 | Snaps within 1.2 world units to any ground lane. Three tier-I barracks soldiers block and fight for up to 15 s. Fallen guards stay down. |
| `galeBell` | Gale Bell / Fırtına Çanı | 18 | Moves all living enemies back along their own ground or flight path, including burrowed enemies. Distance is 4 world units, or 1 for bosses, stopping at the entrance. |

## Renderer events and art

Subscribe to the current `game.events` with `.on(name, listener)`. It returns an unsubscribe function. A new run or replay creates a new event bus. Payloads are typed by `GameEventMap` in `src/core/eventBus.ts`.

| Event | Payload used by the renderer |
|---|---|
| `itemCast` | `{ id, remaining, x?, z? }`. Accepted cast, with snapped road coordinates for the banner. |
| `groundZone` | `{ kind: 'fire', x, z, radius, duration }` for the Ember Pot patch. |
| `enemyFrozen` | `{ enemyId, x, z, seconds, slowOnly }`. Use `slowOnly` for bosses and champions. |
| `enemyPushed` | `{ enemyId, fromX, fromZ, x, z, distance }` per displaced enemy. |
| `rallyMoved`, `soldierSpawned`, `soldierDied`, `soldierRemoved` | Existing barracks lifecycle and melee events. Banner squads use negative tower IDs. `soldierSpawned` and `soldierRemoved` carry `{ soldierId, towerId, x, z }`. |
| `economyChanged` | `{ gold, lives }` after healing or paying out the purse. |

| Asset | Browser path | Size |
|---|---|---|
| Item icons | `/art2d/items/<id>@1x.webp`, `/art2d/items/<id>@2x.webp` | 128² / 256², transparent |
| Currency glyph | `/art2d/market/skyCrystal.webp`, `/art2d/market/skyCrystal-large.webp` | 48² / 192², transparent |
| Market header | `/art2d/market/stall.webp` | 1920 × 640, opaque, text-free |

The built-in image generator painted each source separately. The icon prompts specified a flame-lit terracotta pot, a brass frost lantern, a rose-quartz heart in copper vines, a teal cloud-stitched purse, a blue cloud-and-shield standard, a brass bell with wind ribbons, and an asymmetrical sky-blue crystal. All used a centered storybook gouache treatment, dark ink contours and transparent backgrounds. The header prompt called for a teal-and-ivory awning, timber market counter, floating cliffs and an open center. Native Pillow compositing trimmed the icons to alpha, padded and resized each density, and encoded the shipping WebPs.

## Mobile crystal packs

The screen calls these functions from `src/platform/iap.ts`:

```ts
crystalStoreEnabled(): boolean
listCrystalPacks(): Promise<IapStoreProduct[]>
purchaseCrystalPack(id: CrystalPackId): Promise<IapPurchaseResult>
```

Show the pack section only when `crystalStoreEnabled()` is true. List products returned by the store and render their localized `title` and `priceString`. Match the ID against `isCrystalPack(id)` before passing it to the purchase call. Disable the purchase button while its promise is pending. An `ok` result means the transaction has been delivered to the save. Refresh the wallet then. For `pending_delivery`, show `market.pendingDelivery` and refresh the product list to reconcile the completed charge. Cancellation preserves the wallet. Both the UI facade and the underlying adapter gate web, Steam and standalone Electron before billing. A URL flag cannot enable purchases.

| Internal ID | Crystals | Suggested US store tier |
|---|---:|---:|
| `crystals_small` | 80 | $0.99 |
| `crystals_medium` | 260 | $2.99 |
| `crystals_large` | 600 | $5.99 |

`CRYSTAL_PACKS` in `src/data/market.ts` defines grants. `src/platform/iapProducts.ts` defines consumable SKUs as `${MOBILE_APP_ID}.<id>`. TODO(owner) Finalize the app ID, native SKUs, store-localized copy and regional prices, configure the RevenueCat public keys, then verify purchase and redelivery in both store sandboxes.

## Save and QA

Progress v3 stores per-installation lifetime earnings, spending and item counts, the ordered loadout and its revision, and a transaction-ID ledger. The wallet derives current stock and crystals from those records. Save codes, island-ID remapping and Steam Cloud use the same merge rules. A merge takes maxima per installation counter and unions receipts by ID, so an older backup cannot restore a consumed item. A concurrent loadout edit uses the larger revision, with an ordered-ID tie-break. First-clear premiums merge by island ID and Daily bonuses by UTC day. Separate offline devices can spend the same last unit before synchronizing. Both debits are kept and the displayed balance floors at zero.

The native bridge checks the purchased SKU and records the grant and receipt together in the 2D progression slot. Opening the mobile product list or restoring purchases reconciles RevenueCat's non-subscription transaction history after an interrupted write. An explicit progress reset retains receipt IDs at zero credit to prevent redelivery into the reset save. The ledger travels with a save code. Cross-device continuity of spent currency requires carrying that save history.

For headless QA, construct `new SimWorld(level, events, { itemBelt: { emberPot: 2 } })`, start the first wave and call `world.useItem(...)`. The plain constructor starts with an empty belt. `npm run sim:balance` continues to exercise the original item-free scripts. Focused coverage lives in `tests/platform/market.test.ts` and `tests/sim/items.test.ts`.

## Painted UI (2D)

| Piece | Module | Notes |
|---|---|---|
| Market screen | `src/render2d/ui/marketScreen.ts` + `market.css` | World map crystal button (wallet chip, one-time "New" ribbon until opened, `skyhold_market_seen_v1`). Stall header + wallet pinned above the scrolling body. Six cards: Buy ×1 / ×5, belt toggle, reason when Buy is off. `?screen=market` opens it. |
| Crystal packs | same (`packSection`) | Built only when `crystalStoreEnabled()`. Store titles / prices, one purchase at a time, `pending_delivery` re-lists, Restore via `getIap().restore()`. QA: `?iapqa=1` (or `pending`, `cancel`, `error`, `empty`, `slow`) swaps in `marketQaShop.ts` on the **vite dev server only**; production builds drop that branch (`import.meta.env.DEV`). |
| Briefing belt row | `src/render2d/ui/marketBelt.ts` | Three slots with the uses the chosen difficulty gives, greyed for challenge / Endless runs; a slot or Change opens the belt picker. |
| Item belt (HUD) | `src/render2d/ui/itemBelt2d.ts` + `.css` | Group behind the abilities in the tray. `hudDock` `items` sizes it; `fullBleedFitItems` picks the row, or a one-button pouch where the row would cover more of the island (or does not fit). Keys Z / X / C. Targeted items aim like Meteor (Esc / right click / second press cancel); refused casts keep the aim and cost nothing. |
| Item FX | `src/render2d/itemFx.ts` | Listens to `itemCast`, `groundZone`, `enemyFrozen`, `enemyPushed`; Low quality and Reduced motion trim it. |
| View-models | `src/render2d/ui/marketModel.ts` | Pure: `marketView`, `toggleLoadout`, `beltView`, `beltPress`, `ITEM_KEYS` (tests: `tests/render/marketUi.test.ts`). |
| Victory board | `src/render2d/endPanel.ts` `setCrystals` | `+n` with the crystal after the gold, from `crystalsEarned`. |

QA screenshots: `qa/marketshots.mjs` (dev server), output in `docs/feedback/2026-11-21/market/`.
