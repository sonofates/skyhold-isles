export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLDivElement | null = null;

/** Reads `env(safe-area-inset-*)` in CSS px through a hidden probe element. */
export function readSafeArea(): Insets {
  if (typeof document === 'undefined' || !document.body) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
  }
  if (!probe.isConnected) {
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}
