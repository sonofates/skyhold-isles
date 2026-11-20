// This id belongs to the installation. It deliberately stays outside portable/cloud saves.
const KEY = 'skyhold_isles_market_writer';
let fallback: string | undefined;
function newWriterId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
export function marketWriter(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[a-z0-9-]{8,64}$/i.test(saved)) return saved;
    const id = newWriterId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return fallback ??= newWriterId();
  }
}
