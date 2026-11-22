import { describe, expect, it } from 'vitest';
import {
  END_FRAME,
  endBoardFit,
  endButtonR,
  endHeroRoom,
  endLayout,
  endStarsBottom,
  endTextStack,
  NO_INSETS,
  type EndBoardText,
  type EndLayout,
  type Insets,
} from '../../src/render2d/uiLayout.ts';

/** Viewports the end board is checked at: desktops, MacBook, phones in landscape (incl. notch), portrait. */
const VIEWS: readonly [string, number, number, Insets][] = [
  ['1920x1080', 1920, 1080, NO_INSETS],
  ['1440x900', 1440, 900, NO_INSETS],
  ['1366x768', 1366, 768, NO_INSETS],
  ['1280x800', 1280, 800, NO_INSETS],
  ['1280x720', 1280, 720, NO_INSETS],
  ['932x430', 932, 430, NO_INSETS],
  ['915x412', 915, 412, NO_INSETS],
  ['844x390', 844, 390, NO_INSETS],
  ['844x390 notch', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
  ['740x360', 740, 360, NO_INSETS],
  ['667x375', 667, 375, NO_INSETS],
  ['390x844', 390, 844, NO_INSETS],
];
const ASPECT = 1024 / 674;
const INNER = END_FRAME.innerBottom - END_FRAME.innerTop;

/** Text heights as Pixi reports them (~1.3 × the font size; the rule line at its 10 px floor or more). */
function texts(L: EndLayout, v: Omit<EndBoardText, 'captionH' | 'ruleH' | 'labelH'> & { rule: boolean }): EndBoardText {
  const f = L.fontBody;
  const r = endButtonR(L, v.buttons);
  return {
    ...v,
    captionH: Math.round(f * 0.9) * 1.3,
    ruleH: v.rule ? Math.max(10, Math.round(f * 0.68)) * 1.3 : 0,
    labelH: Math.max(13, Math.round(r * 0.42)) * 1.3,
  };
}

const VARIANTS = [
  { name: 'victory, 4 buttons', won: true, hero: false, buttons: 4, rule: true, victoryBoard: false },
  { name: 'victory, 3 buttons', won: true, hero: false, buttons: 3, rule: true, victoryBoard: false },
  { name: 'victory + hero', won: true, hero: true, buttons: 4, rule: true, victoryBoard: false },
  { name: 'victory + note (no rule)', won: true, hero: false, buttons: 4, rule: false, victoryBoard: false },
  { name: 'defeat', won: false, hero: false, buttons: 3, rule: false, victoryBoard: false },
  { name: 'endless note', won: false, hero: false, buttons: 3, rule: false, victoryBoard: true },
] as const;

describe('end board text vs buttons', () => {
  it('never lets the caption or the star-rule line reach the button circles, and keeps labels on the parchment', () => {
    for (const [name, w, h, ins] of VIEWS) {
      for (const v of VARIANTS) {
        const base = endLayout(w, h, ins, ASPECT, END_FRAME);
        const L = v.hero ? endHeroRoom(base, INNER) : base;
        const m = texts(L, v);
        const { layout, stack, btnR } = endBoardFit(L, m);
        const tag = `${name} / ${v.name}`;
        const f = L.fontBody;
        const btnTop = stack.btnY - btnR;
        // The hero row (its portrait, round(0.8 f) × 2.3) needs its band between the text and the
        // buttons — within 1 px on the tightest board (portrait phone; the QA run measures it clear);
        // the rule line asks for more (2.6 f) before it is kept on a hero board.
        const room = v.hero ? Math.round(f * 0.8) * 2.3 - 1 : 3;
        expect(stack.captionY + m.captionH / 2 + room, tag).toBeLessThanOrEqual(btnTop + 1e-6);
        if (stack.ruleVisible) expect(stack.ruleY + m.ruleH / 2 + (v.hero ? f * 2.6 : room), tag).toBeLessThanOrEqual(btnTop + 1e-6);
        // The rule line sits strictly under the caption, never overlapping it.
        if (stack.ruleVisible) expect(stack.ruleY - m.ruleH / 2, tag).toBeGreaterThanOrEqual(stack.captionY + m.captionH / 2 + 0.4);
        // A lowered button row keeps its labels on the parchment's foot; the row never rises.
        if (stack.btnY > L.buttons[0].y) expect(stack.btnY + btnR * 1.38 + m.labelH / 2, tag).toBeLessThanOrEqual(L.panel.y + L.panel.h * (END_FRAME.innerBottom + 0.02) + 1e-6);
        expect(stack.btnY, tag).toBeGreaterThanOrEqual(L.buttons[0].y);
        expect(layout.buttons[0].y, tag).toBe(stack.btnY);
        // The stats row (icons 1.5 f tall) stays under the stars.
        if (v.won) expect(stack.rowY - f * 0.75, tag).toBeGreaterThanOrEqual(endStarsBottom(layout) - 1e-6);
        // The rule line only goes when there is a rule to show.
        if (!v.rule) expect(stack.ruleVisible, tag).toBe(false);
      }
    }
  });

  it('keeps the star-rule line on a landscape phone (844x390, 4 buttons, TR) — the reported bug', () => {
    for (const ins of [NO_INSETS, { top: 0, right: 47, bottom: 21, left: 47 }]) {
      const L = endLayout(844, 390, ins, ASPECT, END_FRAME);
      const fit = endBoardFit(L, texts(L, VARIANTS[0]));
      expect(fit.stack.ruleVisible).toBe(true);
    }
    // A narrow phone too.
    const N = endLayout(667, 375, NO_INSETS, ASPECT, END_FRAME);
    expect(endBoardFit(N, texts(N, VARIANTS[0])).stack.ruleVisible).toBe(true);
  });

  it('leaves roomy desktop boards (nearly) as they were: full-size stars, the rule shown, buttons barely moved', () => {
    for (const [w, h] of [
      [1440, 900],
      [1280, 800],
      [1920, 1080],
    ]) {
      const L = endLayout(w, h, NO_INSETS, ASPECT, END_FRAME);
      for (const v of VARIANTS.filter((x) => !x.hero)) {
        const fit = endBoardFit(L, texts(L, v));
        expect(fit.layout.starR).toBe(L.starR);
        expect(fit.stack.rowY).toBe(v.won ? L.summary.y : fit.stack.rowY);
        expect(fit.stack.ruleVisible).toBe(v.rule);
        expect(fit.stack.btnY - L.buttons[0].y).toBeLessThanOrEqual(L.panel.h * 0.04);
      }
    }
  });
  it('never overlaps the difficulty pill with the middle star or title across desktop and phone viewports', () => {
    const victoryVariants = VARIANTS.filter((v) => v.won);
    for (const [name, w, h, ins] of VIEWS) {
      for (const v of victoryVariants) {
        const base = endLayout(w, h, ins, ASPECT, END_FRAME);
        const L = v.hero ? endHeroRoom(base, INNER) : base;
        const diffFs = Math.max(12, Math.round(L.fontBody * 0.8));
        const diffPillH = diffFs * 1.6;
        const m = { ...texts(L, v), diffPillH };
        const { layout, stack, btnR, diffSpot } = endBoardFit(L, m);
        const tag = `${name} / ${v.name}`;
        const f = L.fontBody;
        const titleBottom = layout.title.y + layout.fontTitle * 0.5;
        const midStarTop = layout.stars[1].y - layout.starR * 1.15;

        if (diffSpot === 'below') {
          // Exact placement formula from EndPanel.layoutDiffTag: must clear BOTH title and middle star by >= 2 px.
          const P = layout.panel;
          const defaultCy = P.y + P.h * (END_FRAME.ribbonMid + (END_FRAME.innerTop - END_FRAME.ribbonMid) * 0.6);
          const minCy = titleBottom + diffPillH / 2 + 2;
          const cy = Math.max(minCy, Math.min(defaultCy, midStarTop - diffPillH / 2 - 2));
          expect(cy - diffPillH / 2, `${tag} pill vs title`).toBeGreaterThanOrEqual(titleBottom + 2 - 1e-6);
          expect(cy + diffPillH / 2, `${tag} pill vs middle star`).toBeLessThanOrEqual(midStarTop - 2 + 1e-6);
        } else {
          // Beside-title placement sits vertically centred on the ribbon title: well clear of the middle star.
          expect(layout.title.y + diffPillH / 2, `${tag} beside pill vs middle star`).toBeLessThanOrEqual(midStarTop - 2 + 1e-6);
        }

        // Stars must still clear the stats row icons (1.5 f tall), and text must clear buttons.
        expect(stack.rowY - f * 0.75, `${tag} stars vs stats`).toBeGreaterThanOrEqual(endStarsBottom(layout) - 1e-6);
        const btnTop = stack.btnY - btnR;
        const room = v.hero ? Math.round(f * 0.8) * 2.3 - 1 : 3;
        expect(stack.captionY + m.captionH / 2 + room, `${tag} caption vs buttons`).toBeLessThanOrEqual(btnTop + 1e-6);
      }
    }

    // Regression check: reported 667x375 + hero moves the pill beside the title instead of clipping the star;
    // roomy 1366x768 + hero reserves room cleanly underneath the ribbon.
    const phoneHero = endHeroRoom(endLayout(667, 375, NO_INSETS, ASPECT, END_FRAME), INNER);
    const phonePillH = Math.max(12, Math.round(phoneHero.fontBody * 0.8)) * 1.6;
    expect(endBoardFit(phoneHero, { ...texts(phoneHero, VARIANTS[2]), diffPillH: phonePillH }).diffSpot).toBe('beside');

    const deskHero = endHeroRoom(endLayout(1366, 768, NO_INSETS, ASPECT, END_FRAME), INNER);
    const deskPillH = Math.max(12, Math.round(deskHero.fontBody * 0.8)) * 1.6;
    const deskFit = endBoardFit(deskHero, { ...texts(deskHero, VARIANTS[2]), diffPillH: deskPillH });
    expect(deskFit.diffSpot).toBe('below');
    expect(deskFit.layout.stars[1].y - deskFit.layout.starR * 1.15).toBeGreaterThanOrEqual(
      deskFit.layout.title.y + deskFit.layout.fontTitle * 0.5 + deskPillH + 4 - 1e-6,
    );
  });
});

describe('endTextStack', () => {
  const base = { rowY: 100, minRowY: 100, captionOff: 18, captionH: 16, ruleH: 13, ruleOff: 13, ruleOffMin: 11, room: 4, btnY: 170, maxBtnY: 170, btnR: 22 };

  it('changes nothing when the text already clears the buttons', () => {
    const s = endTextStack(base);
    expect(s).toEqual({ rowY: 100, captionY: 118, ruleY: 131, ruleVisible: true, btnY: 170, short: 0 });
  });

  it('drops the buttons, then tightens the rule line, then lifts the stack — in that order', () => {
    // Rule bottom 137.5 + 4 = 141.5 vs button top 120 → 21.5 px short.
    const s = endTextStack({ ...base, btnY: 142, maxBtnY: 150, minRowY: 80 });
    expect(s.btnY).toBe(150);
    expect(s.ruleY - s.captionY).toBe(11);
    expect(s.rowY).toBeCloseTo(100 - (21.5 - 8 - 2), 6);
    expect(s.ruleVisible).toBe(true);
  });

  it('hides the rule line when nothing frees enough room, and still fits the caption', () => {
    const s = endTextStack({ ...base, btnY: 150, maxBtnY: 151, minRowY: 99 });
    expect(s.ruleVisible).toBe(false);
    expect(s.captionY + base.captionH / 2 + base.room).toBeLessThanOrEqual(s.btnY - base.btnR + 1e-6);
  });

  it('has no rule line to show when its height is 0', () => {
    expect(endTextStack({ ...base, ruleH: 0 }).ruleVisible).toBe(false);
  });
});
