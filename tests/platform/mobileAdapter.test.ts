import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import {
  bindHaptics,
  createPlatformHapticDriver,
  HAPTIC_PATTERNS,
  Haptics,
  NATIVE_HAPTIC_MAP,
} from '../../src/platform/haptics.ts';
import {
  createPlatformAdapter,
  MOBILE_APP_ID,
  setPlatformAdapter,
  type MobileBridge,
  type NativeHapticFeedback,
  type SteamBridge,
} from '../../src/platform/index.ts';
import { isTouchDevice } from '../../src/platform/storage.ts';

function createMockMobile(platform: 'ios' | 'android' = 'android'): {
  mobile: MobileBridge;
  hapticsLog: NativeHapticFeedback[];
  emitAppState: (isActive: boolean) => void;
} {
  const hapticsLog: NativeHapticFeedback[] = [];
  let stateListener: ((isActive: boolean) => void) | null = null;
  const mobile: MobileBridge = {
    isNative: true,
    platform,
    async triggerHaptic(feedback) {
      hapticsLog.push(feedback);
      return true;
    },
    onAppStateChange(listener) {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
  };
  return {
    mobile,
    hapticsLog,
    emitAppState: (isActive) => stateListener?.(isActive),
  };
}

describe('platform adapter: mobile (Capacitor) flags, haptics & lifecycle', () => {
  afterEach(() => {
    setPlatformAdapter(null);
  });

  it('defaults to isMobile=false, mobilePlatform=web on browser and Steam builds', async () => {
    const web = createPlatformAdapter({ bridge: null, mobile: null });
    expect(web.isMobile).toBe(false);
    expect(web.isSteam).toBe(false);
    expect(web.mobilePlatform).toBe('web');
    expect(await web.triggerHaptic({ type: 'impact', style: 'LIGHT' })).toBe(false);

    const steamBridge: SteamBridge = {
      isSteam: true,
      unlockAchievement: async () => true,
      cloudRead: async () => null,
      cloudWrite: async () => true,
    };
    const { mobile } = createMockMobile('android');
    // Steam takes precedence and never reports isMobile=true even if a mock mobile bridge is passed.
    const steam = createPlatformAdapter({ bridge: steamBridge, mobile });
    expect(steam.isSteam).toBe(true);
    expect(steam.isMobile).toBe(false);
    expect(steam.mobilePlatform).toBe('web');
  });

  it('reports isMobile=true on native Android and iOS bridges and marks isTouchDevice() true', () => {
    const androidRig = createMockMobile('android');
    const androidAdapter = createPlatformAdapter({ bridge: null, mobile: androidRig.mobile });
    expect(androidAdapter.isMobile).toBe(true);
    expect(androidAdapter.isSteam).toBe(false);
    expect(androidAdapter.mobilePlatform).toBe('android');

    const iosRig = createMockMobile('ios');
    const iosAdapter = createPlatformAdapter({ bridge: null, mobile: iosRig.mobile });
    expect(iosAdapter.isMobile).toBe(true);
    expect(iosAdapter.mobilePlatform).toBe('ios');

    setPlatformAdapter(iosAdapter);
    expect(isTouchDevice()).toBe(true);
  });

  it('routes haptics through Capacitor Haptics when native and respects Settings gating + rate limits', () => {
    const { mobile, hapticsLog } = createMockMobile('ios');
    const adapter = createPlatformAdapter({ bridge: null, mobile });
    const webVibrate = vi.fn(() => true);
    const clock = { t: 1000 };

    const driver = createPlatformHapticDriver(
      () => adapter,
      () => webVibrate,
    );
    const h = new Haptics(driver, () => clock.t);

    expect(h.supported).toBe(true);
    expect(h.pulse('tap')).toBe(true);
    expect(hapticsLog).toEqual([NATIVE_HAPTIC_MAP.tap]);
    expect(webVibrate).not.toHaveBeenCalled();

    // Rate-limited within MIN_GAP_MS, fires again after gap.
    clock.t += 10;
    expect(h.pulse('tap')).toBe(false);
    clock.t += 100;
    expect(h.pulse('win')).toBe(true);
    expect(hapticsLog).toEqual([NATIVE_HAPTIC_MAP.tap, NATIVE_HAPTIC_MAP.win]);

    // Turning Haptics off in Settings silences native Capacitor haptics too.
    h.setEnabled(false);
    clock.t += 2000;
    expect(h.pulse('place')).toBe(false);
    expect(hapticsLog).toHaveLength(2);

    // EventBus sim bindings route through native haptics when re-enabled.
    h.setEnabled(true);
    const bus = new EventBus();
    const off = bindHaptics(bus, h);
    clock.t += 2000;
    bus.emit('enemyLeaked', { enemyType: 'grunt', livesRemaining: 19, damage: 1 });
    expect(hapticsLog).toContainEqual(NATIVE_HAPTIC_MAP.leak);
    off();
  });

  it('falls back to navigator.vibrate on web when not native', () => {
    const webAdapter = createPlatformAdapter({ bridge: null, mobile: null });
    const webPatterns: Array<number | number[]> = [];
    const driver = createPlatformHapticDriver(
      () => webAdapter,
      () => (p) => {
        webPatterns.push(p);
        return true;
      },
    );
    const h = new Haptics(driver, () => 5000);
    expect(h.supported).toBe(true);
    expect(h.pulse('upgrade')).toBe(true);
    expect(webPatterns).toEqual([HAPTIC_PATTERNS.upgrade]);
  });

  it('notifies onPause and onResume subscribers on app background/foreground transitions', () => {
    const { mobile, emitAppState } = createMockMobile('android');
    const adapter = createPlatformAdapter({ bridge: null, mobile });

    const events: string[] = [];
    const offPause = adapter.onPause(() => events.push('pause'));
    const offResume = adapter.onResume(() => events.push('resume'));
    // A throwing subscriber must not break subsequent listeners.
    adapter.onPause(() => {
      throw new Error('listener boom');
    });
    const eventsAfterThrow: string[] = [];
    adapter.onPause(() => eventsAfterThrow.push('pause-2'));

    // Duplicate initial active=true does not fire onResume.
    emitAppState(true);
    expect(events).toEqual([]);

    emitAppState(false);
    emitAppState(false); // duplicate background state ignored
    expect(events).toEqual(['pause']);
    expect(eventsAfterThrow).toEqual(['pause-2']);

    emitAppState(true);
    expect(events).toEqual(['pause', 'resume']);

    offPause();
    offResume();
    emitAppState(false);
    emitAppState(true);
    expect(events).toEqual(['pause', 'resume']);
    expect(eventsAfterThrow).toEqual(['pause-2', 'pause-2']);
  });

  it('keeps MOBILE_APP_ID as the placeholder com.skyholdisles.game', () => {
    expect(MOBILE_APP_ID).toBe('com.skyholdisles.game');
  });
});
