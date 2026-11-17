import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance.ts';
import { FloatingTextPool } from '../../src/ui/floatingText.ts';

class FakeClassList {
  private readonly classes = new Set<string>();
  syncFromClassName(name: string): void {
    this.classes.clear();
    for (const part of name.split(/\s+/)) {
      if (part) this.classes.add(part);
    }
  }
  add(...tokens: string[]): void {
    for (const t of tokens) this.classes.add(t);
  }
  contains(token: string): boolean {
    return this.classes.has(token);
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent: string | null = '';
  style: Record<string, string> = {};
  readonly classList = new FakeClassList();
  private _className = '';

  get className(): string {
    return this._className;
  }
  set className(val: string) {
    this._className = val;
    this.classList.syncFromClassName(val);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx !== -1) this.parent.children.splice(idx, 1);
    this.parent = null;
  }
}

describe('FloatingTextPool', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges same-enemy damage within 150ms, splits outside window, and promotes heavy threshold >= 55', () => {
    const root = new FakeElement();
    const pool = new FloatingTextPool(root as unknown as HTMLElement);
    const layer = root.children[0];
    expect(layer.children).toHaveLength(BALANCE.pools.maxFloatingTexts);

    // Non-positive amounts are ignored
    pool.spawnDamage(1, 0, 0, 0, 0, 1.0);
    pool.spawnGold(0, 0, 0, 0, 1.0);
    pool.update(0.01, (_x, _y, _z, out) => {
      out.x = 100;
      out.y = 200;
    });
    expect(pool.getActiveCount()).toBe(0);

    // Two hits on enemyId=7 within 0.15s merge into 60 -> float-heavy
    pool.spawnDamage(7, 30, 1, 1, 1, 2.0, false);
    pool.spawnDamage(7, 30, 2, 1, 2, 2.1, false);
    pool.update(0.01, (_x, _y, _z, out) => {
      out.x = 320;
      out.y = 240;
    });
    expect(pool.getActiveCount()).toBe(1);

    const activeDmgEls = layer.children.filter((el) => el.className.includes('float-dmg') && !el.classList.contains('hidden'));
    expect(activeDmgEls).toHaveLength(1);
    expect(activeDmgEls[0].textContent).toBe('60');
    expect(activeDmgEls[0].className).toContain('float-heavy');

    // Hit at exact 150ms merge window boundary still merges into same active popup
    pool.spawnDamage(7, 10, 2, 1, 2, 2.1 + BALANCE.floatingTextMergeWindowSec, false);
    expect(activeDmgEls[0].textContent).toBe('70');

    // Hit after 150ms window allocates a second slot; explicit isHeavy=true marks low damage (<55) heavy
    pool.spawnDamage(7, 15, 2, 1, 2, 2.5, true);
    pool.update(0.01, (_x, _y, _z, out) => {
      out.x = 320;
      out.y = 240;
    });
    expect(pool.getActiveCount()).toBe(2);
    const secondDmgEl = layer.children.find(
      (el) => el.textContent === '15' && !el.classList.contains('hidden'),
    )!;
    expect(secondDmgEl.className).toContain('float-heavy');

    // Advancing into final 35% of lifetime (t > 0.65) fades opacity cleanly below 1.0
    pool.update(0.55, (_x, _y, _z, out) => {
      out.x = 320;
      out.y = 240;
    });
    expect(Number(secondDmgEl.style.opacity)).toBeLessThan(1);

    // Advancing past duration (0.72s) expires and hides slots cleanly
    pool.update(0.3, (_x, _y, _z, out) => {
      out.x = 320;
      out.y = 240;
    });
    expect(pool.getActiveCount()).toBe(0);
    expect(activeDmgEls[0].classList.contains('hidden')).toBe(true);

    pool.dispose();
    expect(root.children).toHaveLength(0);
  });

  it('recycles oldest active popup at 60-slot pool cap and steps upgrade banners with uiDt while paused', () => {
    const root = new FakeElement();
    const pool = new FloatingTextPool(root as unknown as HTMLElement);
    const layer = root.children[0];
    const cap = BALANCE.pools.maxFloatingTexts;

    for (let i = 1; i <= cap + 5; i++) {
      pool.spawnGold(i, i, 0, 0, i);
    }

    pool.update(0.01, (_x, _y, _z, out) => {
      out.x = 100;
      out.y = 100;
    });
    expect(pool.getActiveCount()).toBe(cap);

    // Oldest gold (+1g..+5g) were recycled so +1g is no longer present while +65g is present
    const texts = new Set(layer.children.map((el) => el.textContent));
    expect(texts.has('+1g')).toBe(false);
    expect(texts.has(`+${cap + 5}g`)).toBe(true);

    pool.clear();
    expect(pool.getActiveCount()).toBe(0);

    // Upgrade tier popups advance via uiDt even when sim dt === 0 (paused), fanning out across lanes
    pool.spawnUpgradeTier(2, 0, 1, 0, 10);
    pool.spawnUpgradeTier(3, 0, 1, 0, 10);
    const screenXs: number[] = [];
    pool.update(
      0,
      (x, _y, _z, out) => {
        out.x = 400 + x;
        out.y = 300;
      },
      0.2,
    );
    expect(pool.getActiveCount()).toBe(2);
    for (const el of layer.children) {
      if (!el.classList.contains('hidden') && el.className.includes('float-upgrade')) {
        const m = /translate3d\((\d+)px/.exec(el.style.transform ?? '');
        if (m) screenXs.push(Number(m[1]));
      }
    }
    expect(screenXs).toHaveLength(2);
    expect(screenXs[0]).not.toBe(screenXs[1]);

    // Expire upgrade popups via uiDt while sim dt remains 0
    pool.update(
      0,
      (_x, _y, _z, out) => {
        out.x = 400;
        out.y = 300;
      },
      1.0,
    );
    expect(pool.getActiveCount()).toBe(0);
  });
});
