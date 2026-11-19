# Campaign difficulty retune

Branch `codex/diff-tune` starts at `cc4b90b` on `art-2d`. The changes are uncommitted for the orchestrator. The runtime diff is confined to the Easy and Hard patches in `src/data/difficulty.ts`.

## Results

| Campaign measure | Result |
|---|---:|
| Easy greedy clears | 25/25 |
| Easy greedy finishes with at least 12 lives | 25/25 (minimum 23) |
| Easy weak clears in chapter one | 15/17 |
| Normal greedy clears | 25/25 |
| Hard greedy clears in chapter one | 12/17 |
| Hard greedy clears in chapter two | 4/8 |
| Hard wins with lost lives and 1–2★ | 16/16 |
| Hard i24 | 5/22 lives, 1★ |
| Hard weak clears | 3/25 |

Easy spends the single star actually awarded on each previous clear. Hard uses the Normal first-clear entry save for each island. Weak copies that difficulty’s entry inventory. Bare runs the greedy towers alone. The complete table and modifier values are in [difficulty.md](difficulty.md).

Hard shifts income from the opening treasury to kills. Meadow Crossing starts with zero gold, so Bran and Meteor fund the first tower. The existing briefing displays the percentage change in starting gold. The full calculation also deducts 250 gold, applies Treasury, and floors at zero. The kill bounty and spell cooldown adjustments are listed in the difficulty table.

## Verification

Run with Node 22.21.1 and `PATH=/usr/local/lib/node22/bin:$PATH`.

```sh
npm run sim:difficulty -- --md
npx tsc --noEmit && npm run lint && npm test && npm run sim:balance && npm run build
```

All eight difficulty checks passed. The documented 25 rows match the generated Markdown. A standalone `--levels=i24` run reproduced all nine i24 cells.

The full gate passed. TypeScript and ESLint exited cleanly. Vitest reported 1,329 passed and 11 skipped across 101 files. The production build completed with chunk-size and ineffective dynamic-import warnings.

`sim:balance` passed all 41 levels. A byte comparison against output captured before editing matched all 65,102 bytes. Both captures have SHA-256 `865647a1970528e6ef01a8fd4072473dba3503b0e1a6a847140e0c08edeb6309`.
