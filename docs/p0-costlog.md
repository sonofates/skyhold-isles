# P0 pipeline cost log

Wall-clock minutes are measured from timestamps (generation runs plus hands-on fixing/review). "Credits" means Flow credits for Veo/Omni. Codex image_gen runs on the ChatGPT plan, so it is recorded as tokens/runs, not money.

Earlier, pre-P0 runs for reference (2026-11-17, same pipeline):
- 3 style mockups: 1 Codex run, about 25 min (two failed starts excluded).
- 13 sprites + 1 map (first set): 1 Codex run, about 27 min, plus about 1 min keying.
- 2 maps (L1b, L1c): 1 Codex run, about 13 min. Tracing by hand without an editor took about 10 min for both.

| Family | Step | Start | End | Min | Credits / tokens | Notes |
|---|---|---|---|---|---|---|
| Map | Generate L1c at 19.5:9 (Codex image_gen, 2 style refs) | 18:36:33 | 18:40:02 | 3.5 | 1 run, 37.8k tokens | First try usable: 1846x852 (2.17:1), all gameplay inside the centred 16:9 |
| Map | Trace in the map editor + overlay check + 1 fix pass | 18:40:40 | 18:42:05 | 1.4 | — | Agent-assisted: points estimated from the image, then the overlay check moved 4 top-lane points by 8–17 px. Estimate for a person clicking by hand in the editor: about 10–15 min. Editor bug (negative zoom in a hidden pane) fixed first, not counted |
