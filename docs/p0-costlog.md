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
| Enemy (Veo) | Back-view design for the away-from-camera clip (Codex image_gen) | 18:42:42 | 18:47:33 | 4 | 1 run, 37.3k tokens | Consistent with the front sprite on the first try |
| Enemy (Veo) | Flow setup: new project, upload 2 start frames (owner dragged them from Finder), read model prices | 18:46:00 | 18:53:59 | 8 | — | One-time per session. Prices on Ultra: Omni 1.2 Flash 720p 4 s = 12 cr; Veo 3.1 Lite = 5 cr, Fast = 10 cr, Quality = 100 cr (4 s and 8 s cost the same); 1080p upscale free, 4K 50 cr. Veo 3.1 Fast and Quality show "Leaving Dec 5" |
| Enemy (Veo) | 4 clips: Omni 1.2 Flash front + back (4 s), Veo 3.1 Quality front + back (8 s) | 18:53:59 | 19:00:07 | 6 | 2×12 + 2×100 = 224 cr | Generation ran in parallel, about 2–4 min per clip. Download via the signed-URL log + curl |
| Tower | Archer T2 + T3 (Codex image_gen, T1 as reference), same run as 4 leg-swap frames | 18:37:45 | 18:53:48 | 16 | 1 run, 90.5k tokens for 6 images | T2/T3 usable on the first try. Per tower (3 tiers) with T1 from the first set: about 8 min generation + 1 min keying (6-image run split pro rata) |
| Enemy (cheap) | Brute + kite leg-swap frames, 2 each (same Codex run as above) | — | — | (in the 16) | (in the 90.5k) | Upper body stays consistent; usable for a 3-frame cycle |
| Enemy (Veo) | Loop extraction: tools/sprites/veo_to_sheet.py (key, feet anchor, loop search, sheet + JSON + GIF), 4 clips | 19:00:52 | 19:01:12 | 1 | — | Writing the tool took about 10 min (one-time). Per clip it is under 30 s, fully automatic |
