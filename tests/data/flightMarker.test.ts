import { expect, it } from 'vitest';
import { I15 } from '../../src/data/levels2d/i15.ts';
import { laneMarkSpot, pointAlong } from '../../src/render2d/ui/laneMarks2d.ts';

it('laneMarkSpot does not slide past clear right-side spots beyond x = 1024 due to float ULP', () => {
  const lay = I15.layout2d!;
  const scale = 0.9464788732394367;
  const offsetX = -143.4232394366198;
  const offsetY = -31.988732394366252;
  const toScreen = (p: { x: number; z: number }) => ({
    x: offsetX + (p.x * lay.pxPerUnit + lay.imageSize[0] / 2) * scale,
    y: offsetY + (p.z * lay.pxPerUnit + lay.imageSize[1] / 2) * scale,
  });
  const spot = laneMarkSpot(lay.flightPath, toScreen, [], 12.977, { w: 1366, h: 768 });
  const expected = toScreen(pointAlong(lay.flightPath, 2.6)!);
  expect(spot).not.toBeNull();
  expect(spot!.x).toBeCloseTo(expected.x, 3);
  expect(spot!.y).toBeCloseTo(expected.y, 3);
});
