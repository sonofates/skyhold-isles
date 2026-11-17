import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import { parseTileChar } from '../../src/data/levels/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CameraController } from '../../src/render/cameraController.ts';
import type { PxRect } from '../../src/render/occlusionFit.ts';
import { gridToWorldX, gridToWorldZ } from '../../src/sim/grid.ts';

/** HUD control rectangles measured in a real browser (scripts: .shots-tool/dumpRects.mjs). */
function r(x0: number, y0: number, x1: number, y1: number): PxRect {
  return { x0, y0, x1, y1 };
}

interface Viewport {
  name: string;
  w: number;
  h: number;
  hud: PxRect[];
}

const VIEWPORTS: Viewport[] = [
  {
    name: 'portrait 390x844',
    w: 390,
    h: 844,
    hud: [r(12, 10, 260, 47), r(288, 742, 378, 832), r(12, 55, 96, 95), r(330, 74, 374, 118), r(330, 126, 374, 170), r(220, 758, 280, 818), r(326, 10, 378, 62), r(12, 766, 74, 828), r(84, 766, 146, 828)],
  },
  {
    name: 'phone 360x640',
    w: 360,
    h: 640,
    hud: [r(12, 10, 260, 47), r(258, 538, 348, 628), r(12, 55, 96, 95), r(300, 74, 344, 118), r(300, 126, 344, 170), r(190, 554, 250, 614), r(296, 10, 348, 62), r(12, 562, 74, 624), r(84, 562, 146, 624)],
  },
  {
    name: 'landscape 844x390',
    w: 844,
    h: 390,
    hud: [r(12, 8, 260, 45), r(746, 296, 832, 382), r(268, 8, 352, 48), r(784, 68, 828, 112), r(784, 118, 828, 162), r(678, 309, 738, 369), r(780, 8, 832, 60), r(538, 312, 596, 370), r(606, 312, 664, 370)],
  },
  {
    name: 'tablet 820x1180',
    w: 820,
    h: 1180,
    hud: [r(12, 10, 260, 47), r(718, 1078, 808, 1168), r(12, 55, 96, 95), r(760, 74, 804, 118), r(760, 126, 804, 170), r(650, 1094, 710, 1154), r(756, 10, 808, 62), r(12, 1102, 74, 1164), r(84, 1102, 146, 1164)],
  },
  {
    name: 'desktop 1440x900',
    w: 1440,
    h: 900,
    hud: [r(12, 10, 289, 53), r(422, 10, 594, 62), r(604, 14, 687, 58), r(697, 14, 786, 58), r(796, 14, 887, 58), r(1020, 10, 1066, 56), r(1074, 10, 1120, 56), r(1128, 10, 1266, 56), r(1274, 10, 1320, 56), r(1328, 10, 1374, 56), r(1382, 10, 1428, 56), r(12, 824, 76, 888), r(86, 824, 150, 888), r(374, 800, 1066, 888)],
  },
];

interface Measure {
  coverage: number;
  keyVisible: boolean;
  zoom: number;
}

function measure(levelIndex: number, vp: Viewport, withHud: boolean): Measure {
  const lvl = LEVELS[levelIndex];
  const cam = new CameraController(vp.w, vp.h);
  if (withHud) cam.setHudRects(vp.hud);
  cam.configureForMap(lvl.cols, lvl.rows, lvl.layout);
  cam.camera.updateMatrixWorld(true);
  const out = { x: 0, y: 0 };
  const margin = 8;
  let seen = 0;
  let total = 0;
  let keyVisible = true;
  for (let row = 0; row < lvl.rows; row++) {
    const tokens = (lvl.layout[row] ?? '').trim().split(/\s+/);
    for (let col = 0; col < lvl.cols; col++) {
      const tile = parseTileChar(tokens[col] ?? '~');
      if (tile === 'empty' || tile === 'decor') continue;
      const key = tile === 'spawn' || tile === 'goal';
      const wgt = key ? 6 : tile === 'path' ? 0.7 : 1;
      cam.worldCoordsToScreen(gridToWorldX(col, lvl.cols), key ? 1.85 : 0.5, gridToWorldZ(row, lvl.rows), out);
      const inView = out.x >= margin && out.x <= vp.w - margin && out.y >= margin && out.y <= vp.h - margin;
      const hidden = vp.hud.some((h) => out.x > h.x0 - 4 && out.x < h.x1 + 4 && out.y > h.y0 - 4 && out.y < h.y1 + 4);
      total += wgt;
      if (inView && !hidden) seen += wgt;
      else if (key) keyVisible = false;
    }
  }
  return { coverage: seen / total, keyVisible, zoom: cam.camera.zoom };
}

describe('default framing keeps the playable island clear of the HUD', () => {
  const rows: string[] = [];
  for (const vp of VIEWPORTS) {
    for (let i = 0; i < LEVELS.length; i++) {
      it(`${vp.name} · island ${i + 1}`, () => {
        const m = measure(i, vp, true);
        const old = measure(i, vp, false);
        rows.push(
          `${vp.name} L${i + 1} cov ${m.coverage.toFixed(2)} (was ${old.coverage.toFixed(2)}) zoom ${m.zoom.toFixed(2)} (was ${old.zoom.toFixed(2)}) key ${m.keyVisible}`,
        );
        // Spawn and goal are the tiles players care about most: they must always be reachable.
        expect(m.keyVisible).toBe(true);
        expect(m.coverage).toBeGreaterThanOrEqual(0.8);
        // Never worse than the HUD-blind framing it replaces.
        expect(m.coverage).toBeGreaterThanOrEqual(old.coverage - 0.04);
        // ...and never framed farther away than needed (the "map too far away" complaint).
        expect(m.zoom).toBeGreaterThanOrEqual(old.zoom * 0.7);
      });
    }
  }
  it('writes a summary for the handoff notes', () => {
    try {
      mkdirSync('.shots-tool', { recursive: true });
      writeFileSync('.shots-tool/framing-report.txt', rows.join('\n') + '\n');
    } catch {
      // read-only checkout: the report is optional
    }
    expect(BALANCE.tileSize).toBeGreaterThan(0);
  });
});
