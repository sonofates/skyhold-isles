export const BALANCE = {
  // Grid & world scale
  tileSize: 2.0,
  tileGrassTopY: 0,
  tilePathTopY: -0.1,
  waterPlaneY: -0.95,
  flyerHeight: 2.15,

  // Simulation timing
  fixedDt: 1 / 60,
  maxFrameDt: 0.1,
  speedMultipliers: [1, 2, 3] as const,

  // Economy & lives
  startingLives: 20,
  sellRefundRatio: 0.7,
  earlyWaveBonusMaxGold: 30,
  interWaveCountdownSec: 12,
  starThresholds: {
    threeStarsMinLives: 18,
    twoStarsMinLives: 10,
  },

  // Combat & status rules
  minArmorDamage: 1,
  maxSlowRatio: 0.55,
  defaultSlowDuration: 2.4,

  // Camera
  camera: {
    defaultFrustumHalfHeight: 13.5,
    minZoom: 0.55,
    maxZoom: 2.25,
    zoomStep: 0.12,
    zoomLerpSpeed: 10,
    panSpeed: 18,
    panLerpSpeed: 14,
    rotationDurationSec: 0.34,
    dragThresholdPx: 6,
    panBoundsPadding: 6,
    shakeDecay: 8.5,
    bossHitShake: 0.16,
    mortarImpactShake: 0.11,
  },

  // Object pools & spatial hash
  spatialHashCellSize: 4.0,
  pools: {
    maxEnemies: 360,
    maxProjectiles: 240,
    maxShards: 480,
    maxParticles: 600,
    maxLightningArcs: 48,
    maxPulseRings: 48,
    maxFloatingTexts: 60,
  },
  floatingTextMergeWindowSec: 0.15,
} as const;
