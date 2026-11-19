/**
 * Mobile In-App Purchases (IAP) store adapter & free-version scope gate.
 *
 * Modes:
 *  - `'noop'`   Web & Steam desktop builds (Steam is a paid full game — zero IAPs).
 *  - `'mock'`   Deterministic mock store for unit tests and `?iapmock=1` in browser QA.
 *  - `'native'` Capacitor iOS / Android builds backed by `@revenuecat/purchases-capacitor`.
 *
 * Entitlements are cached in save storage (`skyhold_isles_entitlements_v1`) so offline launches
 * and reloads preserve owned unlocks immediately without waiting on store network round-trips,
 * and without being wiped if the player resets campaign progress in Settings.
 *
 * Pure simulation layers (`src/sim`, `src/data`, `src/core`) must never import this module.
 */
import type {
  CustomerInfo,
  PurchasesStoreProduct,
} from '@revenuecat/purchases-capacitor';
import { LEVELS_2D } from '../data/levels2d/index.ts';
import {
  findIapProduct,
  FULL_UNLOCK_ENTITLEMENT,
  IAP_PRODUCTS,
  type IapProductDef,
  type IapProductKind,
} from './iapProducts.ts';
import { REVENUECAT_API_KEYS } from './mobileConfig.ts';
import {
  getPlatform,
  type CloudStorageLike,
  type MobilePlatformName,
  type PlatformAdapter,
} from './platform.ts';

export const IAP_SAVE_KEY = 'skyhold_isles_entitlements_v1';
export const IAP_MOCK_LEDGER_KEY = 'skyhold_isles_iap_mock_ledger_v1';
const IAP_SAVE_VERSION = 1;

export type IapStoreMode = 'noop' | 'mock' | 'native';

export interface IapStoreProduct {
  readonly id: string;
  readonly storeProductId: string;
  readonly kind: IapProductKind;
  readonly title: string;
  readonly description: string;
  /** Localized formatted price from the store (or `'MOCK'` in mock mode — never a hardcoded price). */
  readonly priceString: string;
  readonly currencyCode: string;
}

export type IapPurchaseStatus =
  | 'purchased'
  | 'cancelled'
  | 'unavailable'
  | 'unknown_product'
  | 'error';

export interface IapPurchaseResult {
  readonly ok: boolean;
  readonly status: IapPurchaseStatus;
  readonly productId: string;
  readonly entitlements: readonly string[];
  readonly error?: string;
}

export interface IapRestoreResult {
  readonly ok: boolean;
  readonly restored: readonly string[];
  readonly entitlements: readonly string[];
  readonly error?: string;
}

export interface IapStoreAdapter {
  readonly mode: IapStoreMode;
  /** Resolves available store products from the catalogue (`[]` on web/Steam no-op). */
  products(): Promise<IapStoreProduct[]>;
  /** Initiates a purchase flow for `id` (catalogue id or store SKU) and updates the save cache. */
  purchase(id: string): Promise<IapPurchaseResult>;
  /** Restores previously purchased non-consumables from the store into the save cache. */
  restore(): Promise<IapRestoreResult>;
  /** Synchronous entitlement check backed by the save cache (`false` on web/Steam no-op). */
  owned(id: string): boolean;
  /** Snapshot of all currently owned entitlement identifiers (`empty` on web/Steam no-op). */
  entitlements(): ReadonlySet<string>;
}

// --- Free-version scope gate --------------------------------------------------------------------

/**
 * Free mobile island roster (playable on mobile without owning `full_unlock`).
 *
 * TODO(owner): Decide final free-vs-paid island split before mobile store launch.
 * Placeholder: the first 6 islands of `LEVELS_2D` (`l1c`, `i01`, `i02`, `i03`, `i04`, `i05`).
 */
export const FREE_ISLANDS: readonly string[] = Object.freeze(
  LEVELS_2D.slice(0, 6).map((level) => level.id),
);

export type EntitlementCollection =
  | ReadonlySet<string>
  | readonly string[]
  | Iterable<string>
  | Readonly<Record<string, boolean>>;

function hasFullUnlockEntitlement(entitlements: EntitlementCollection): boolean {
  if (!entitlements || typeof entitlements !== 'object') return false;
  if (Symbol.iterator in entitlements) {
    for (const raw of entitlements as Iterable<unknown>) {
      if (typeof raw !== 'string') continue;
      const clean = raw.trim();
      if (!clean) continue;
      const mapped = findIapProduct(clean)?.entitlementId ?? clean;
      if (mapped === FULL_UNLOCK_ENTITLEMENT) return true;
    }
    return false;
  }
  const rec = entitlements as Readonly<Record<string, boolean>>;
  for (const [key, active] of Object.entries(rec)) {
    if (active !== true) continue;
    const mapped = findIapProduct(key)?.entitlementId ?? key.trim();
    if (mapped === FULL_UNLOCK_ENTITLEMENT) return true;
  }
  return false;
}

/**
 * Pure free-version scope gate for mobile builds.
 *
 * Returns `true` when `levelId` is in `freeIslands` (defaults to `FREE_ISLANDS`) or when
 * `entitlements` grants `full_unlock`. Not wired into the UI yet — see `docs/p5-mobile.md`.
 */
export function isUnlocked(
  levelId: string,
  entitlements: EntitlementCollection,
  freeIslands: readonly string[] = FREE_ISLANDS,
): boolean {
  const cleanId = typeof levelId === 'string' ? levelId.trim() : '';
  if (!cleanId) return false;
  if (freeIslands.includes(cleanId)) return true;
  return hasFullUnlockEntitlement(entitlements);
}

// --- Entitlement save cache ---------------------------------------------------------------------

interface StoredEntitlementCache {
  readonly version: number;
  readonly entitlements: readonly string[];
  readonly updatedAt: number;
}

function defaultStorage(): CloudStorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const SAFE_ENTITLEMENT_RE = /^[a-zA-Z0-9_.-]{1,80}$/;

function lookupInCatalogue(
  idOrSku: string,
  catalogue: readonly IapProductDef[],
): IapProductDef | undefined {
  const clean = idOrSku.trim();
  if (!clean) return undefined;
  return catalogue.find(
    (p) => p.id === clean || p.storeProductId === clean || p.entitlementId === clean,
  );
}

function normalizeEntitlementId(
  raw: unknown,
  catalogue: readonly IapProductDef[] = IAP_PRODUCTS,
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const mapped =
    lookupInCatalogue(trimmed, catalogue)?.entitlementId ??
    findIapProduct(trimmed)?.entitlementId ??
    trimmed;
  return SAFE_ENTITLEMENT_RE.test(mapped) ? mapped : null;
}

function sanitizeIdList(
  raw: unknown,
  catalogue: readonly IapProductDef[] = IAP_PRODUCTS,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const clean = normalizeEntitlementId(item, catalogue);
    if (clean && !out.includes(clean)) {
      out.push(clean);
    }
  }
  return out;
}

function readIdSetFromKey(
  storage: CloudStorageLike | null,
  key: string,
  catalogue: readonly IapProductDef[] = IAP_PRODUCTS,
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(sanitizeIdList(parsed, catalogue));
    if (parsed && typeof parsed === 'object') {
      const list = (parsed as { entitlements?: unknown }).entitlements;
      return new Set(sanitizeIdList(list, catalogue));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeIdSetToKey(
  storage: CloudStorageLike | null,
  key: string,
  ids: Iterable<string>,
  nowMs: () => number,
  catalogue: readonly IapProductDef[] = IAP_PRODUCTS,
): boolean {
  if (!storage) return false;
  const payload: StoredEntitlementCache = {
    version: IAP_SAVE_VERSION,
    entitlements: sanitizeIdList([...ids], catalogue),
    updatedAt: nowMs(),
  };
  try {
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// --- Query flag detection -----------------------------------------------------------------------

function defaultLocationSearch(): string {
  try {
    return typeof location === 'undefined' ? '' : location.search;
  } catch {
    return '';
  }
}

/** True when `?iapmock=1` is present in the URL query string. */
export function isIapMockEnabled(search: string = defaultLocationSearch()): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get('iapmock') === '1';
  } catch {
    return false;
  }
}

// --- Mock store driver (tests & ?iapmock=1) -----------------------------------------------------

export interface MockIapBackend {
  readonly products: () => Promise<IapStoreProduct[]>;
  readonly purchase: (product: IapProductDef) => Promise<{
    readonly status: 'purchased' | 'cancelled' | 'error';
    readonly entitlements: readonly string[];
    readonly error?: string;
  }>;
  readonly restore: () => Promise<{
    readonly ok: boolean;
    readonly entitlements: readonly string[];
    readonly error?: string;
  }>;
  /** Test helper: forces the next `purchase()` call to cancel or fail once. */
  setNextPurchaseOutcome(outcome: 'purchased' | 'cancelled' | 'error', errorMsg?: string): void;
  /** Test helper: forces the next `restore()` call to fail once. */
  setNextRestoreError(errorMsg: string | null): void;
  /** Test helper: seeds remote store ownership (e.g. purchases made on another device). */
  grantRemoteEntitlement(entitlementId: string): void;
}

export interface CreateMockBackendOptions {
  readonly catalogue?: readonly IapProductDef[];
  readonly initialOwned?: readonly string[];
  /** Optional storage to persist the simulated remote receipt ledger across `?iapmock=1` reloads. */
  readonly ledgerStorage?: CloudStorageLike | null;
  readonly now?: () => number;
}

export function createMockIapBackend(options: CreateMockBackendOptions = {}): MockIapBackend {
  const catalogue = options.catalogue ?? IAP_PRODUCTS;
  const ledgerStorage = options.ledgerStorage ?? null;
  const now = options.now ?? (() => Date.now());
  const remoteLedger = readIdSetFromKey(ledgerStorage, IAP_MOCK_LEDGER_KEY, catalogue);
  for (const id of options.initialOwned ?? []) {
    const clean = normalizeEntitlementId(id, catalogue);
    if (clean) remoteLedger.add(clean);
  }
  if (remoteLedger.size > 0) {
    writeIdSetToKey(ledgerStorage, IAP_MOCK_LEDGER_KEY, remoteLedger, now, catalogue);
  }

  let nextOutcome: 'purchased' | 'cancelled' | 'error' = 'purchased';
  let nextErrorMsg: string | undefined;
  let nextRestoreError: string | null = null;

  return {
    async products(): Promise<IapStoreProduct[]> {
      return catalogue.map((def) => ({
        id: def.id,
        storeProductId: def.storeProductId,
        kind: def.kind,
        title: `[Mock] ${def.id}`,
        description: `Placeholder store entry for ${def.id} (owner pricing/contents pending)`,
        priceString: 'MOCK',
        currencyCode: 'XXX',
      }));
    },
    async purchase(product: IapProductDef) {
      const outcome = nextOutcome;
      const errMsg = nextErrorMsg;
      nextOutcome = 'purchased';
      nextErrorMsg = undefined;

      if (outcome === 'cancelled') {
        return { status: 'cancelled', entitlements: [...remoteLedger] };
      }
      if (outcome === 'error') {
        return {
          status: 'error',
          entitlements: [...remoteLedger],
          error: errMsg ?? 'Mock billing error',
        };
      }
      if (product.kind === 'non_consumable') {
        const clean = normalizeEntitlementId(product.entitlementId, catalogue);
        if (clean) remoteLedger.add(clean);
        writeIdSetToKey(ledgerStorage, IAP_MOCK_LEDGER_KEY, remoteLedger, now, catalogue);
      }
      return { status: 'purchased', entitlements: [...remoteLedger] };
    },
    async restore() {
      if (nextRestoreError !== null) {
        const msg = nextRestoreError;
        nextRestoreError = null;
        return { ok: false, entitlements: [], error: msg };
      }
      return { ok: true, entitlements: [...remoteLedger] };
    },
    setNextPurchaseOutcome(outcome, errorMsg): void {
      nextOutcome = outcome;
      nextErrorMsg = errorMsg;
    },
    setNextRestoreError(errorMsg): void {
      nextRestoreError = errorMsg;
    },
    grantRemoteEntitlement(entitlementId: string): void {
      const clean = normalizeEntitlementId(entitlementId, catalogue);
      if (!clean) return;
      remoteLedger.add(clean);
      writeIdSetToKey(ledgerStorage, IAP_MOCK_LEDGER_KEY, remoteLedger, now, catalogue);
    },
  };
}

// --- Native Capacitor RevenueCat driver ---------------------------------------------------------

export interface NativePurchasesBridge {
  readonly isConfigured: () => boolean;
  readonly ensureConfigured: () => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly getProducts: (storeSkus: readonly string[]) => Promise<readonly PurchasesStoreProduct[]>;
  readonly purchaseStoreProduct: (
    product: PurchasesStoreProduct,
  ) => Promise<{ readonly customerInfo: CustomerInfo }>;
  readonly restorePurchases: () => Promise<{ readonly customerInfo: CustomerInfo }>;
}

export interface RevenueCatBridgeOptions {
  readonly mobilePlatform: MobilePlatformName;
  readonly apiKeys?: { readonly ios: string; readonly android: string };
}

/** Extracts active entitlement IDs and known non-consumable product unlocks from `CustomerInfo`. */
export function extractEntitlementsFromCustomerInfo(
  customerInfo: Pick<CustomerInfo, 'entitlements' | 'allPurchasedProductIdentifiers'>,
  catalogue: readonly IapProductDef[] = IAP_PRODUCTS,
): string[] {
  const out = new Set<string>();
  const active = customerInfo.entitlements?.active ?? {};
  for (const [entId, info] of Object.entries(active)) {
    if (info && info.isActive) {
      const mapped = normalizeEntitlementId(entId, catalogue);
      if (mapped) out.add(mapped);
    }
  }
  for (const sku of customerInfo.allPurchasedProductIdentifiers ?? []) {
    if (typeof sku !== 'string') continue;
    const def = lookupInCatalogue(sku, catalogue);
    if (def && def.kind === 'non_consumable') {
      const mapped = normalizeEntitlementId(def.entitlementId, catalogue);
      if (mapped) out.add(mapped);
    }
  }
  return [...out];
}

export function createRevenueCatBridge(options: RevenueCatBridgeOptions): NativePurchasesBridge {
  const keys = options.apiKeys ?? REVENUECAT_API_KEYS;
  const apiKey = (options.mobilePlatform === 'ios' ? keys.ios : keys.android).trim();
  let configurePromise: Promise<{ readonly ok: boolean; readonly error?: string }> | null = null;

  const ensureConfigured = (): Promise<{ readonly ok: boolean; readonly error?: string }> => {
    if (!apiKey) {
      return Promise.resolve({
        ok: false,
        error: `RevenueCat ${options.mobilePlatform} public SDK key is not configured (TODO owner).`,
      });
    }
    if (!configurePromise) {
      configurePromise = import('@revenuecat/purchases-capacitor')
        .then(async ({ Purchases }) => {
          await Purchases.configure({ apiKey });
          return { ok: true as const };
        })
        .catch((err: unknown) => {
          configurePromise = null;
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          };
        });
    }
    return configurePromise;
  };

  return {
    isConfigured: () => apiKey.length > 0,
    ensureConfigured,
    async getProducts(storeSkus: readonly string[]): Promise<readonly PurchasesStoreProduct[]> {
      const { Purchases, PRODUCT_CATEGORY } = await import('@revenuecat/purchases-capacitor');
      const { products } = await Purchases.getProducts({
        productIdentifiers: [...storeSkus],
        type: PRODUCT_CATEGORY.NON_SUBSCRIPTION,
      });
      return products;
    },
    async purchaseStoreProduct(product: PurchasesStoreProduct) {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      const res = await Purchases.purchaseStoreProduct({ product });
      return { customerInfo: res.customerInfo };
    },
    async restorePurchases() {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      return Purchases.restorePurchases();
    },
  };
}

function isUserCancelledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { userCancelled?: unknown }).userCancelled === true;
}

// --- Store adapter factory ----------------------------------------------------------------------

export interface CreateIapStoreOptions {
  readonly mode?: IapStoreMode;
  readonly platform?: PlatformAdapter;
  readonly storage?: CloudStorageLike | null;
  readonly catalogue?: readonly IapProductDef[];
  readonly mockBackend?: MockIapBackend;
  readonly nativeBridge?: NativePurchasesBridge;
  readonly locationSearch?: string;
  readonly now?: () => number;
}

function resolveMode(
  explicitMode: IapStoreMode | undefined,
  platform: PlatformAdapter,
  search: string,
): IapStoreMode {
  if (explicitMode) return explicitMode;
  // Steam is a paid full game — never enable IAPs on Steam.
  if (platform.isSteam) return 'noop';
  if (platform.isMobile) return 'native';
  if (isIapMockEnabled(search)) return 'mock';
  return 'noop';
}

export function createIapStore(options: CreateIapStoreOptions = {}): IapStoreAdapter {
  const platform = options.platform ?? getPlatform();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const catalogue = options.catalogue ?? IAP_PRODUCTS;
  const search = options.locationSearch ?? defaultLocationSearch();
  const now = options.now ?? (() => Date.now());
  const mode = resolveMode(options.mode, platform, search);

  if (mode === 'noop') {
    const emptySet: ReadonlySet<string> = new Set();
    return {
      mode: 'noop',
      async products(): Promise<IapStoreProduct[]> {
        return [];
      },
      async purchase(id: string): Promise<IapPurchaseResult> {
        const safeId = typeof id === 'string' ? id.trim() : '';
        return {
          ok: false,
          status: 'unavailable',
          productId: safeId,
          entitlements: [],
        };
      },
      async restore(): Promise<IapRestoreResult> {
        return { ok: true, restored: [], entitlements: [] };
      },
      owned(): boolean {
        return false;
      },
      entitlements(): ReadonlySet<string> {
        return emptySet;
      },
    };
  }

  // Hydrate persistent entitlement cache from save storage immediately on boot.
  const cachedEntitlements = readIdSetFromKey(storage, IAP_SAVE_KEY, catalogue);

  const persistEntitlements = (incoming: Iterable<string>): string[] => {
    for (const id of incoming) {
      const clean = normalizeEntitlementId(id, catalogue);
      if (clean) cachedEntitlements.add(clean);
    }
    writeIdSetToKey(storage, IAP_SAVE_KEY, cachedEntitlements, now, catalogue);
    return [...cachedEntitlements];
  };

  const resolveCatalogueProduct = (idOrSku: string): IapProductDef | undefined =>
    typeof idOrSku === 'string' ? lookupInCatalogue(idOrSku, catalogue) : undefined;

  const owned = (id: string): boolean => {
    const key = normalizeEntitlementId(id, catalogue);
    return key !== null && cachedEntitlements.has(key);
  };

  const entitlements = (): ReadonlySet<string> => new Set(cachedEntitlements);

  if (mode === 'mock') {
    const mock =
      options.mockBackend ??
      createMockIapBackend({
        catalogue,
        ledgerStorage: storage,
        now,
      });

    return {
      mode: 'mock',
      products: () => mock.products(),
      async purchase(id: string): Promise<IapPurchaseResult> {
        const safeId = typeof id === 'string' ? id.trim() : '';
        const def = resolveCatalogueProduct(safeId);
        if (!def) {
          return {
            ok: false,
            status: 'unknown_product',
            productId: safeId,
            entitlements: [...cachedEntitlements],
          };
        }
        const res = await mock.purchase(def);
        if (res.status === 'purchased') {
          const updated =
            def.kind === 'non_consumable'
              ? persistEntitlements([...res.entitlements, def.entitlementId])
              : [...cachedEntitlements];
          return {
            ok: true,
            status: 'purchased',
            productId: def.id,
            entitlements: updated,
          };
        }
        return {
          ok: false,
          status: res.status,
          productId: def.id,
          entitlements: [...cachedEntitlements],
          ...(res.error ? { error: res.error } : {}),
        };
      },
      async restore(): Promise<IapRestoreResult> {
        const before = new Set(cachedEntitlements);
        const res = await mock.restore();
        if (!res.ok) {
          return {
            ok: false,
            restored: [],
            entitlements: [...cachedEntitlements],
            ...(res.error ? { error: res.error } : {}),
          };
        }
        const updated = persistEntitlements(res.entitlements);
        const restored = updated.filter((e) => !before.has(e));
        return { ok: true, restored, entitlements: updated };
      },
      owned,
      entitlements,
    };
  }

  // Native mode (`@revenuecat/purchases-capacitor`).
  const native =
    options.nativeBridge ??
    createRevenueCatBridge({
      mobilePlatform: platform.mobilePlatform,
    });
  const cachedStoreProducts = new Map<string, PurchasesStoreProduct>();

  return {
    mode: 'native',
    async products(): Promise<IapStoreProduct[]> {
      const cfg = await native.ensureConfigured();
      if (!cfg.ok) return [];
      try {
        const skus = catalogue.map((p) => p.storeProductId);
        const rawProducts = await native.getProducts(skus);
        const out: IapStoreProduct[] = [];
        for (const sp of rawProducts) {
          cachedStoreProducts.set(sp.identifier, sp);
          const def = catalogue.find(
            (p) => p.storeProductId === sp.identifier || p.id === sp.identifier,
          );
          if (!def) continue;
          out.push({
            id: def.id,
            storeProductId: sp.identifier,
            kind: def.kind,
            title: sp.title,
            description: sp.description,
            priceString: sp.priceString,
            currencyCode: sp.currencyCode,
          });
        }
        return out;
      } catch {
        return [];
      }
    },
    async purchase(id: string): Promise<IapPurchaseResult> {
      const safeId = typeof id === 'string' ? id.trim() : '';
      const def = resolveCatalogueProduct(safeId);
      if (!def) {
        return {
          ok: false,
          status: 'unknown_product',
          productId: safeId,
          entitlements: [...cachedEntitlements],
        };
      }
      const cfg = await native.ensureConfigured();
      if (!cfg.ok) {
        return {
          ok: false,
          status: 'unavailable',
          productId: def.id,
          entitlements: [...cachedEntitlements],
          ...(cfg.error ? { error: cfg.error } : {}),
        };
      }
      try {
        let storeProduct = cachedStoreProducts.get(def.storeProductId);
        if (!storeProduct) {
          const fetched = await native.getProducts([def.storeProductId]);
          storeProduct = fetched.find(
            (p) => p.identifier === def.storeProductId || p.identifier === def.id,
          );
          if (storeProduct) cachedStoreProducts.set(storeProduct.identifier, storeProduct);
        }
        if (!storeProduct) {
          return {
            ok: false,
            status: 'unavailable',
            productId: def.id,
            entitlements: [...cachedEntitlements],
            error: `Store SKU "${def.storeProductId}" not returned by native store.`,
          };
        }
        const { customerInfo } = await native.purchaseStoreProduct(storeProduct);
        const extracted = extractEntitlementsFromCustomerInfo(customerInfo, catalogue);
        if (def.kind === 'non_consumable' && !extracted.includes(def.entitlementId)) {
          extracted.push(def.entitlementId);
        }
        const updated = persistEntitlements(extracted);
        return {
          ok: true,
          status: 'purchased',
          productId: def.id,
          entitlements: updated,
        };
      } catch (err: unknown) {
        if (isUserCancelledError(err)) {
          return {
            ok: false,
            status: 'cancelled',
            productId: def.id,
            entitlements: [...cachedEntitlements],
          };
        }
        return {
          ok: false,
          status: 'error',
          productId: def.id,
          entitlements: [...cachedEntitlements],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async restore(): Promise<IapRestoreResult> {
      const cfg = await native.ensureConfigured();
      if (!cfg.ok) {
        return {
          ok: false,
          restored: [],
          entitlements: [...cachedEntitlements],
          ...(cfg.error ? { error: cfg.error } : {}),
        };
      }
      try {
        const before = new Set(cachedEntitlements);
        const { customerInfo } = await native.restorePurchases();
        const extracted = extractEntitlementsFromCustomerInfo(customerInfo, catalogue);
        const updated = persistEntitlements(extracted);
        const restored = updated.filter((e) => !before.has(e));
        return { ok: true, restored, entitlements: updated };
      } catch (err: unknown) {
        return {
          ok: false,
          restored: [],
          entitlements: [...cachedEntitlements],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    owned,
    entitlements,
  };
}

let activeIapStore: IapStoreAdapter | null = null;

/** Process-wide IAP store singleton (lazily initialised). */
export function getIap(): IapStoreAdapter {
  if (!activeIapStore) activeIapStore = createIapStore();
  return activeIapStore;
}

/** Replaces or resets (`null`) the singleton IAP store (for unit tests). */
export function setIapStore(store: IapStoreAdapter | null): void {
  activeIapStore = store;
}
