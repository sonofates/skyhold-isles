import { BALANCE } from '../data/balance.ts';

export type FloatingTextKind = 'damage' | 'gold' | 'heal';

interface FloatingSlot {
  active: boolean;
  kind: FloatingTextKind;
  el: HTMLDivElement;
  enemyId: number;
  amount: number;
  createdSeq: number;
  lastUpdateSec: number;
  age: number;
  duration: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export class FloatingTextPool {
  private readonly container: HTMLDivElement;
  private readonly slots: FloatingSlot[] = [];
  private seqCounter = 1;
  private activeCount = 0;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'floating-text-layer';
    parent.appendChild(this.container);

    const cap = BALANCE.pools.maxFloatingTexts;
    for (let i = 0; i < cap; i++) {
      const el = document.createElement('div');
      el.className = 'float-txt hidden';
      this.container.appendChild(el);
      this.slots.push({
        active: false,
        kind: 'damage',
        el,
        enemyId: 0,
        amount: 0,
        createdSeq: 0,
        lastUpdateSec: 0,
        age: 0,
        duration: 0.75,
        worldX: 0,
        worldY: 0,
        worldZ: 0,
      });
    }
  }

  private acquireSlot(): FloatingSlot {
    let oldestSlot = this.slots[0];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) {
        s.active = true;
        this.activeCount++;
        return s;
      }
      if (s.createdSeq < oldestSlot.createdSeq) {
        oldestSlot = s;
      }
    }
    // Cap hit (60 active): recycle the oldest active popup cleanly
    return oldestSlot;
  }

  spawnDamage(
    enemyId: number,
    damage: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    nowSec: number,
    isHeavy = false,
  ): void {
    if (damage <= 0) return;

    // Merge rapid damage numbers hitting the same enemy within 150ms
    const mergeWindow = BALANCE.floatingTextMergeWindowSec;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (
        s.active &&
        s.kind === 'damage' &&
        s.enemyId === enemyId &&
        nowSec - s.lastUpdateSec <= mergeWindow
      ) {
        s.amount += damage;
        s.lastUpdateSec = nowSec;
        s.age = 0.04;
        s.worldX = worldX;
        s.worldY = worldY;
        s.worldZ = worldZ;
        s.el.textContent = String(s.amount);
        s.el.className =
          s.amount >= 55 || isHeavy ? 'float-txt float-dmg float-heavy' : 'float-txt float-dmg';
        return;
      }
    }

    const slot = this.acquireSlot();
    slot.kind = 'damage';
    slot.enemyId = enemyId;
    slot.amount = damage;
    slot.createdSeq = this.seqCounter++;
    slot.lastUpdateSec = nowSec;
    slot.age = 0;
    slot.duration = 0.72;
    slot.worldX = worldX;
    slot.worldY = worldY;
    slot.worldZ = worldZ;
    slot.el.textContent = String(damage);
    slot.el.className = isHeavy || damage >= 55 ? 'float-txt float-dmg float-heavy' : 'float-txt float-dmg';
  }

  spawnGold(
    amount: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    nowSec: number,
  ): void {
    if (amount <= 0) return;
    const slot = this.acquireSlot();
    slot.kind = 'gold';
    slot.enemyId = 0;
    slot.amount = amount;
    slot.createdSeq = this.seqCounter++;
    slot.lastUpdateSec = nowSec;
    slot.age = 0;
    slot.duration = 0.9;
    slot.worldX = worldX;
    slot.worldY = worldY;
    slot.worldZ = worldZ;
    slot.el.textContent = `+${amount}g`;
    slot.el.className = 'float-txt float-gold';
  }

  update(
    dt: number,
    projectWorldToScreen: (x: number, y: number, z: number, out: { x: number; y: number }) => void,
  ): void {
    const out = { x: 0, y: 0 };
    let count = 0;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;

      s.age += dt;
      if (s.age >= s.duration) {
        s.active = false;
        s.el.classList.add('hidden');
        continue;
      }

      count++;
      const t = s.age / s.duration;
      const liftY = s.kind === 'gold' ? t * 1.15 : t * 0.75;
      projectWorldToScreen(s.worldX, s.worldY + liftY, s.worldZ, out);

      const spreadX = s.enemyId > 0 ? ((s.enemyId * 29) % 21) - 10 : 0;
      const popScale = t < 0.16 ? 0.75 + (t / 0.16) * 0.42 : 1.17 - t * 0.25;
      const opacity = t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1;

      s.el.style.opacity = opacity.toFixed(2);
      s.el.style.transform = `translate3d(${Math.round(out.x + spreadX)}px, ${Math.round(out.y)}px, 0) translate(-50%, -100%) scale(${popScale.toFixed(2)})`;
    }

    this.activeCount = count;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  clear(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.active) {
        s.active = false;
        s.el.classList.add('hidden');
      }
    }
    this.activeCount = 0;
  }

  dispose(): void {
    this.container.remove();
    this.slots.length = 0;
  }
}
