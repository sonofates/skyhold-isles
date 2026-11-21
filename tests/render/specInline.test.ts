import { describe, expect, it } from 'vitest';
import { specializationsFor } from '../../src/data/towers.ts';
import { EN } from '../../src/i18n/en.ts';
import { TR } from '../../src/i18n/tr.ts';
import { branchTokenRules, ringTap, tipTap, type RingAction } from '../../src/render2d/buildRing.ts';
import { SpecCardGate, type GateSheet, type OpenCard } from '../../src/render2d/ui/specCardGate.ts';

/** A ring token as BuildRing drives it: live gold → enabled, the selection index. */
function ringModel(gold: number) {
  const rules = branchTokenRules(specializationsFor('archer'));
  let selected = -1;
  const bought: RingAction[] = [];
  return {
    rules,
    bought,
    get selected() {
      return selected;
    },
    tap(i: number): void {
      const r = rules[i];
      const enabled = r.cost === null || gold >= r.cost;
      const out = ringTap(r, enabled, selected === i);
      if (out === 'select') selected = i;
      else if (out) bought.push(out);
    },
  };
}

describe('tier-III branch choice in the build ring (no board)', () => {
  it('one token per branch, priced, needing a confirm tap (the ring keeps its 4-token layout)', () => {
    const branches = specializationsFor('archer');
    const rules = branchTokenRules(branches);
    expect(rules.map((r) => r.action)).toEqual(branches.map((b) => ({ kind: 'spec', id: b.id })));
    expect(rules.map((r) => r.confirm)).toEqual([true, true]);
    expect(rules.map((r) => r.cost)).toEqual(branches.map((b) => b.cost));
  });

  it('first tap selects (preview), second tap on the same token buys that branch', () => {
    const m = ringModel(10_000);
    const [a, b] = specializationsFor('archer');
    m.tap(0);
    expect(m.selected).toBe(0);
    expect(m.bought).toEqual([]);
    // Switching to the other branch only moves the preview.
    m.tap(1);
    expect(m.selected).toBe(1);
    expect(m.bought).toEqual([]);
    m.tap(1);
    expect(m.bought).toEqual([{ kind: 'spec', id: b.id }]);
    expect(a.id).not.toBe(b.id);
  });

  it('unaffordable: the token previews but the confirming tap buys nothing', () => {
    const cost = Math.min(...specializationsFor('archer').map((b) => b.cost));
    const m = ringModel(cost - 1);
    m.tap(0);
    m.tap(0);
    m.tap(1);
    m.tap(1);
    expect(m.selected).toBe(1);
    expect(m.bought).toEqual([]);
  });

  it('the "(i) Compare" row of a branch tip opens the card for that branch; other tips only swallow the tap', () => {
    expect(tipTap('farwatch')).toEqual({ kind: 'compare', id: 'farwatch' });
    expect(tipTap(undefined)).toBeNull();
  });

  it('hint strings exist in both languages and the old "tap again to compare" keys are gone', () => {
    for (const k of ['ring.tapSpec', 'ring.clickSpec', 'ring.compare']) {
      expect(EN).toHaveProperty(k);
      expect(TR).toHaveProperty(k);
    }
    expect(EN).not.toHaveProperty('ring.tapCompare');
    expect(TR).not.toHaveProperty('ring.clickCompare');
    // The one-time tip describes the two-tap choice in the ring, not a board.
    expect(String(TR['spechint.text'])).toContain('yine dokun');
    expect(String(EN['spechint.textMouse'])).toContain('click again');
  });
});

/** A fake card: `close()` runs its onClose (like dom.ts openSheet), `remove()` drops it silently. */
function fakeCard() {
  const node = { isConnected: true };
  let onClose: (() => void) | null = null;
  let closed = 0;
  const sheet: GateSheet = {
    overlay: node,
    close() {
      if (!onClose) return;
      const f = onClose;
      onClose = null;
      closed++;
      f();
    },
  };
  const make: OpenCard = (cb) => {
    onClose = cb;
    return sheet;
  };
  return {
    make,
    sheet,
    get closed() {
      return closed;
    },
    remove() {
      node.isConnected = false;
      onClose = null;
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('comparison card bookkeeping (specCardGate.ts): no stuck pause', () => {
  const setup = (paused = false) => {
    const host = { stepper: { paused } };
    return { host, gate: new SpecCardGate(host) };
  };

  it('pauses while open, the card closing itself restores the run and a new card can open', async () => {
    const { host, gate } = setup();
    const c = fakeCard();
    expect(gate.open(7, 'w', async () => c.make)).toBe(true);
    expect(host.stepper.paused).toBe(true);
    expect(gate.open(7, 'w', async () => c.make)).toBe(false);
    await flush();
    expect(gate.debugState).toBe('open');
    c.sheet.close();
    expect(gate.isOpen).toBe(false);
    expect(host.stepper.paused).toBe(false);
    expect(gate.open(7, 'w', async () => fakeCard().make)).toBe(true);
  });

  it('a card opened while already paused leaves it paused', async () => {
    const { host, gate } = setup(true);
    const c = fakeCard();
    gate.open(1, 'w', async () => c.make);
    await flush();
    c.sheet.close();
    expect(host.stepper.paused).toBe(true);
  });

  it('the lazy chunk failing to load (stale tab after a deploy) gives the run back', async () => {
    const { host, gate } = setup();
    gate.open(1, 'w', () => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    expect(host.stepper.paused).toBe(true);
    await flush();
    expect(gate.isOpen).toBe(false);
    expect(host.stepper.paused).toBe(false);
  });

  it('the card throwing while it builds, or the loader throwing at once, gives the run back', async () => {
    const { host, gate } = setup();
    gate.open(1, 'w', async () => () => {
      throw new Error('boom');
    });
    await flush();
    expect(gate.isOpen).toBe(false);
    expect(host.stepper.paused).toBe(false);
    expect(
      gate.open(1, 'w', () => {
        throw new Error('sync');
      }),
    ).toBe(false);
    expect(host.stepper.paused).toBe(false);
    expect(gate.isOpen).toBe(false);
  });

  it('a sheet removed from the DOM without its onClose (replaced) is noticed on the next frame', async () => {
    const { host, gate } = setup();
    const c = fakeCard();
    gate.open(1, 'w', async () => c.make);
    await flush();
    c.remove();
    gate.frame(true);
    expect(gate.isOpen).toBe(false);
    expect(host.stepper.paused).toBe(false);
  });

  it('run end / restart / replay / tower gone (frame(false)) closes the card and restores the pause', async () => {
    const { host, gate } = setup();
    const c = fakeCard();
    gate.open(1, 'w', async () => c.make);
    await flush();
    gate.frame(false);
    expect(c.closed).toBe(1);
    expect(gate.isOpen).toBe(false);
    expect(host.stepper.paused).toBe(false);
    // Its late onClose does nothing (the sheet already called it once): a second card still opens.
    expect(gate.open(2, 'w', async () => fakeCard().make)).toBe(true);
  });

  it('cancelled while the chunk still loads: the card never shows up', async () => {
    const { host, gate } = setup();
    const c = fakeCard();
    let built = false;
    gate.open(1, 'w', async () => {
      await flush();
      return (cb) => {
        built = true;
        return c.make(cb);
      };
    });
    gate.cancel();
    expect(host.stepper.paused).toBe(false);
    await flush();
    await flush();
    expect(built).toBe(false);
    expect(gate.isOpen).toBe(false);
  });

  it('backgrounded while open: the run stays paused after the card closes', async () => {
    const { host, gate } = setup();
    const c = fakeCard();
    gate.open(1, 'w', async () => c.make);
    await flush();
    gate.keepPausedOnClose();
    c.sheet.close();
    expect(host.stepper.paused).toBe(true);
    expect(gate.isOpen).toBe(false);
  });
});
