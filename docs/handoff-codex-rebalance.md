# Handoff for the 2D campaign rebalance

The working tree on `codex/rebalance` contains the uncommitted changes against `art-2d` at `301da3d`. The per-island measurements, isolated kit comparisons and hero spot checks are in [the balance report](rebalance.md).

## Player outcomes

| First-clear measure | Live tuning | Retuned |
|---|---:|---:|
| Greedy Bran wins | 25/25 | 25/25 |
| Greedy Bran earns 3★ | 25/25 | 12/25 |
| Weak wins on Heroic or Master | 7/20 | 0/20 |
| Greedy lives lost per chapter-one island | 0.06 | 4.59 |
| Greedy lives lost per chapter-two island | 0.38 | 15.13 |
| Greedy i24, lives remaining and stars | 22/22, 3★ | 3/22, 1★ |

Bran and the four alternatives all clear the retuned finale with the greedy order. The climax costs Bran ten lives. The original tower-only greedy order now loses from i03 onward. The three onboarding islands retain their previous tuning.

## Maintenance

`scripts/balanceSim.ts` runs both 2D build orders with the inventory earned on previous greedy clears. `scripts/lib/campaignKit.ts` handles purchases and global spell targeting. The hero uses the same merge-point driver as `scripts/heroBalance.ts`. Filtered runs reconstruct the same progression as the full run. Use `npm run sim:balance -- --levels=i24 --kit-detail` to inspect the boss with each hero and each kit component in isolation.

The island adjustments are confined to the 2D wrappers from i03 through i24. The chapter-two regression test evaluates all eight islands in a single campaign pass. Each additional per-island pass would repeat the XP and star history.

## Verification

| Check | Result |
|---|---|
| Node 22 TypeScript and ESLint | Passed |
| Unit tests | 1,309 passed, 11 skipped |
| Balance gate | 41/41 islands passed |
| L1–L16 parity | All greedy and weak wave traces and all 35 summary, Endless and Workshop lines matched the live baseline byte for byte |
| Bot QA | 557/557 scenarios across 25 islands, 17,098,730 ticks, 11 determinism replays, zero invariant violations |
| Production build | Passed with Vite chunk-size and dynamic-import warnings |

The checks measure deterministic scripted play. The starter profile assumes one clear per island and frequent ability use. The other heroes were sampled on i10, i16 and i24.
