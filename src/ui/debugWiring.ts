import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import type { SimWorld } from '../sim/world.ts';
import { DebugPanel } from './debugPanel.ts';
import type { FloatingTextPool } from './floatingText.ts';

export interface DebugWiringContext {
  getSimWorld: () => SimWorld;
  renderWorld: RenderWorld;
  floatingTextPool: FloatingTextPool;
  pendingDebugSpawns: Array<{ type: EnemyType; delay: number }>;
  syncUi: () => void;
  getQualityLabel?: () => string;
}

export function createDebugPanelIfEnabled(
  parent: HTMLElement,
  ctx: DebugWiringContext,
): DebugPanel | null {
  const isDebugMode = new URLSearchParams(window.location.search).has('debug');
  if (!isDebugMode) return null;

  return new DebugPanel(parent, {
    onAddGold: (amount) => {
      ctx.getSimWorld().gold += amount;
      ctx.syncUi();
    },
    onSetLives: (lives) => {
      ctx.getSimWorld().lives = lives;
      ctx.syncUi();
    },
    onSkipToWave: (waveOneBased) => {
      ctx.getSimWorld().debugSkipToWave(waveOneBased);
      ctx.syncUi();
    },
    onSpawnEnemies: (type, count) => {
      const interval = count >= 40 ? 0.03 : 0.18;
      for (let i = 0; i < count; i++) {
        ctx.pendingDebugSpawns.push({ type, delay: i * interval });
      }
    },
    onInstantWin: () => {
      ctx.getSimWorld().debugForceWin();
      ctx.syncUi();
    },
    onInstantLose: () => {
      ctx.getSimWorld().debugForceLose();
      ctx.syncUi();
    },
    onToggleAllRangeRings: (show) => {
      ctx.renderWorld.setShowAllRanges(show);
    },
    getTelemetry: () => {
      const sim = ctx.getSimWorld();
      const m = ctx.renderWorld.getRenderMetrics();
      const mem = ctx.renderWorld.getMemoryStats();
      return {
        fps: 60,
        frameTimeMs: 16.7,
        drawCalls: m.drawCalls,
        drawsWithShadows: m.drawsWithShadows,
        drawsNoShadows: m.drawsNoShadows,
        triangles: m.triangles,
        geometries: mem.geometries,
        enemiesActive: sim.enemyPool.getActiveCount(),
        enemiesMax: BALANCE.pools.maxEnemies,
        towersCount: sim.towers.length,
        projectilesActive: sim.projectilePool.getActiveCount(),
        projectilesMax: BALANCE.pools.maxProjectiles,
        particlesActive: ctx.renderWorld.effectsRenderer.getActiveFxCount(),
        particlesMax: BALANCE.pools.maxParticles + BALANCE.pools.maxShards,
        floatingTextsActive: ctx.floatingTextPool.getActiveCount(),
        floatingTextsMax: BALANCE.pools.maxFloatingTexts,
        quality: ctx.getQualityLabel?.(),
        pixelRatio: ctx.renderWorld.sceneManager.renderer.getPixelRatio(),
      };
    },
  });
}
