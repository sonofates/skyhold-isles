import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { StartupTimingMetrics } from '../render/perfGovernor.ts';
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
  getPacingInfo?: () => { mode: string; targetFps: number | null };
  getStartupMetrics?: () => StartupTimingMetrics | null;
}

export interface DebugPanelFlags {
  readonly hasDebug: boolean;
  readonly hasPerf: boolean;
}

export function readDebugPanelFlags(): DebugPanelFlags {
  if (typeof window === 'undefined') {
    return { hasDebug: false, hasPerf: false };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    hasDebug: params.has('debug'),
    hasPerf: params.has('perf'),
  };
}

export function createDebugPanelIfEnabled(
  parent: HTMLElement,
  ctx: DebugWiringContext,
): DebugPanel | null {
  const { hasDebug, hasPerf } = readDebugPanelFlags();
  if (!hasDebug && !hasPerf) return null;

  const mode = hasDebug ? 'debug' : 'perf';
  return new DebugPanel(
    parent,
    {
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
        const perf = ctx.renderWorld.sceneManager.getPerfSnapshot();
        const mem = ctx.renderWorld.getMemoryStats();
        const pacing = ctx.getPacingInfo?.();
        let drawCalls: number;
        let drawsWithShadows: number;
        let drawsNoShadows: number;
        let triangles: number;
        if (mode === 'perf') {
          const info = ctx.renderWorld.sceneManager.renderer.info.render;
          drawCalls = info.calls;
          drawsWithShadows = info.calls;
          drawsNoShadows = info.calls;
          triangles = info.triangles;
        } else {
          const m = ctx.renderWorld.getRenderMetrics();
          drawCalls = m.drawCalls;
          drawsWithShadows = m.drawsWithShadows;
          drawsNoShadows = m.drawsNoShadows;
          triangles = m.triangles;
        }
        return {
          fps: perf.fps,
          frameTimeMs: perf.avgMs,
          p95FrameMs: perf.p95Ms,
          maxFrameMs: perf.maxMs,
          workAvgMs: perf.workAvgMs,
          workP95Ms: perf.workP95Ms,
          drawCalls,
          drawsWithShadows,
          drawsNoShadows,
          triangles,
          geometries: mem.geometries,
          textures: mem.textures,
          programs: ctx.renderWorld.sceneManager.renderer.info.programs?.length,
          dpr: perf.dpr,
          nativeDpr: perf.nativeDpr,
          pixelWidth: perf.pixelWidth,
          pixelHeight: perf.pixelHeight,
          composerEnabled: perf.composerEnabled,
          activePasses: perf.activePasses,
          shadowsEnabled: perf.shadowsEnabled,
          shadowMapSize: perf.shadowMapSize,
          qualityMode: perf.qualityMode,
          activeTier: perf.activeTier,
          tierLabel: perf.tierLabel,
          lockedCeilingTier: perf.lockedCeilingTier,
          defaultMaxTier: perf.defaultMaxTier,
          tierTransitions: perf.tierTransitions,
          pacingMode: pacing?.mode,
          pacingFps: pacing?.targetFps,
          startup: ctx.getStartupMetrics?.() ?? null,
          enemiesActive: sim.enemyPool.getActiveCount(),
          enemiesMax: BALANCE.pools.maxEnemies,
          towersCount: sim.towers.length,
          projectilesActive: sim.projectilePool.getActiveCount(),
          projectilesMax: BALANCE.pools.maxProjectiles,
          particlesActive: ctx.renderWorld.effectsRenderer.getActiveFxCount(),
          particlesMax: BALANCE.pools.maxParticles + BALANCE.pools.maxShards,
          floatingTextsActive: ctx.floatingTextPool.getActiveCount(),
          floatingTextsMax: BALANCE.pools.maxFloatingTexts,
        };
      },
    },
    mode,
  );
}
