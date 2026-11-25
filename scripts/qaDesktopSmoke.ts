/**
 * Headless Linux Xvfb smoke verification for the packaged AppImage (or unpackaged Electron build).
 *
 * Verifies both:
 *  1. Default launch (`http://skyhold.local/2d.html` -> title screen with the PC Quit plank -> World Map,
 *     >= 25 islands over the chapter pages, no store UI, Steam preload bridge, all 65 achievements loaded from `desktop/achievements.json`, 0 failed HTTP/bundle loads).
 *  2. Gameplay launch on Chapter-Two Boss `i24` (`?level=i24&diff=hard&hero=sela&herolevel=20` ->
 *     Pixi v8 WebGL2 canvas, 0 missing art files, Sela active, Steam preload bridge, 0 failed loads).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface SmokePayload {
  readonly ready: boolean;
  readonly scene: 'worldMap' | 'game';
  readonly hasBridge: boolean;
  readonly secureContext?: boolean;
  readonly achievementsLoaded: number;
  readonly failedLoads: number;
  readonly islands?: number;
  readonly titleQuit?: boolean;
  readonly storeVisible?: boolean;
  readonly mode?: string;
  readonly hero?: string | null;
  readonly art?: {
    readonly filesPresent: number;
    readonly filesMissing: number;
  };
}

function findAppImage(rootDir: string): string | null {
  const releaseDir = resolve(rootDir, 'release');
  if (!existsSync(releaseDir)) return null;
  const match = readdirSync(releaseDir).find((f) => f.endsWith('.AppImage'));
  return match ? resolve(releaseDir, match) : null;
}

function runSmokeCase(
  label: string,
  cmd: string,
  args: readonly string[],
  extraEnv: Record<string, string>,
): SmokePayload {
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const bin = useXvfb ? 'xvfb-run' : cmd;
  const fullArgs = useXvfb ? ['-a', cmd, ...args] : [...args];

  const stdout = execFileSync(bin, fullArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    env: {
      ...process.env,
      SKYHOLD_SMOKE_TEST: '1',
      ...extraEnv,
    },
  });

  const line = stdout
    .split(/\r?\n/)
    .find((l) => l.startsWith('[smoke] '));
  if (!line) {
    throw new Error(`[${label}] Missing [smoke] JSON output:\n${stdout}`);
  }
  return JSON.parse(line.slice('[smoke] '.length)) as SmokePayload;
}

function main(): void {
  const rootDir = process.cwd();
  const targetPref = process.env.SKYHOLD_DESKTOP_TARGET ?? 'auto';
  const appImage = targetPref === 'electron' ? null : findAppImage(rootDir);

  const cmd = appImage ?? resolve(rootDir, 'node_modules', '.bin', 'electron');
  const baseArgs = appImage
    ? ['--appimage-extract-and-run', '--no-sandbox']
    : ['.', '--no-sandbox'];

  const worldMap = runSmokeCase('worldMap', cmd, baseArgs, {});
  if (
    worldMap.scene !== 'worldMap' ||
    !worldMap.hasBridge ||
    !worldMap.secureContext ||
    worldMap.achievementsLoaded < 65 ||
    worldMap.failedLoads !== 0 ||
    (worldMap.islands ?? 0) < 25 ||
    !worldMap.titleQuit ||
    worldMap.storeVisible
  ) {
    throw new Error(`WorldMap smoke invariant failed: ${JSON.stringify(worldMap)}`);
  }

  const bossGame = runSmokeCase('i24-hard-boss', cmd, baseArgs, {
    SKYHOLD_QUERY: 'level=i24&diff=hard&hero=sela&herolevel=20',
  });
  if (
    bossGame.scene !== 'game' ||
    bossGame.mode !== 'play' ||
    bossGame.hero !== 'sela' ||
    !bossGame.hasBridge ||
    !bossGame.secureContext ||
    bossGame.achievementsLoaded < 65 ||
    bossGame.failedLoads !== 0 ||
    !bossGame.art ||
    bossGame.art.filesMissing !== 0 ||
    bossGame.art.filesPresent < 100
  ) {
    throw new Error(`Gameplay smoke invariant failed: ${JSON.stringify(bossGame)}`);
  }

  console.log(
    JSON.stringify({
      target: appImage ? 'AppImage' : 'electron',
      binary: cmd,
      worldMap,
      bossGame: {
        scene: bossGame.scene,
        mode: bossGame.mode,
        hero: bossGame.hero,
        hasBridge: bossGame.hasBridge,
        achievementsLoaded: bossGame.achievementsLoaded,
        failedLoads: bossGame.failedLoads,
        filesPresent: bossGame.art.filesPresent,
        filesMissing: bossGame.art.filesMissing,
      },
    }),
  );
}

main();
