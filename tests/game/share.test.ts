import { describe, expect, it } from 'vitest';
import { dailyShareText, dayToIsoDate } from '../../src/game/share.ts';

describe('daily share text', () => {
  it('formats the day as an ISO date', () => {
    expect(dayToIsoDate(0)).toBe('1970-01-01');
    expect(dayToIsoDate(20409)).toBe('2025-11-17');
    expect(dayToIsoDate(Number.NaN)).toBe('1970-01-01');
  });

  it('builds a three-line result with stars, lives and streak', () => {
    const text = dailyShareText({
      day: 20409,
      islandName: 'Grand Skyhold',
      challenges: ['ironTide', 'thaw'],
      stars: 2,
      livesLost: 6,
      streak: 3,
    });
    expect(text.split('\n')).toEqual([
      'Skyhold Isles · Daily Squall 2025-11-17',
      'Grand Skyhold · Iron Tide + Thaw',
      '★★☆ · 6 lives lost · 3-day streak',
    ]);
  });

  it('says flawless for zero lives lost, no streak line below 2, clamps junk', () => {
    const text = dailyShareText({ day: 1, islandName: 'X', challenges: [], stars: 9, livesLost: -2, streak: 1 });
    expect(text).toContain('★★★ · flawless');
    expect(text).not.toContain('streak');
    expect(text.split('\n')[1]).toBe('X');
    expect(dailyShareText({ day: 1, islandName: 'X', challenges: [], stars: 1, livesLost: 1, streak: 0 })).toContain(
      '1 life lost',
    );
  });
});
