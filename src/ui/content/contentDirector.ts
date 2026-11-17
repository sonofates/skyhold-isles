import type { EventBus } from '../../core/eventBus.ts';
import type { TowerType } from '../../core/types.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import type { ContentStore } from '../../platform/contentStorage.ts';
import { allEnemyEntries, allTowerEntries, eliteEntry } from './codexData.ts';
import { CodexScreen, type CodexTab } from './codexScreen.ts';
import { CoachMark } from './coachMark.ts';
import { seenIdOf, SightingQueue, waveHasElite } from './firstSighting.ts';
import { coachMessage, OnboardingMachine, TOUR_TILE, type OnboardingObs } from './onboardingMachine.ts';
import { SightingCard } from './sightingCard.ts';

export interface ContentHost {
  /** The card opened/closed: re-evaluate pause + input gating. */
  onBlockingChange: () => void;
  /** Restart island 1 from scratch (tutorial replay). */
  startTutorialIsland: () => void;
}

/**
 * Glue between the game session and the onboarding / first-sighting / codex UI. The session pushes
 * observations and events in; the director decides what to show and persists what was seen.
 */
export class ContentDirector {
  readonly codex: CodexScreen;
  private readonly store: ContentStore;
  private readonly host: ContentHost;
  private readonly card: SightingCard;
  private readonly coach: CoachMark;
  private readonly machine: OnboardingMachine;
  private readonly queue: SightingQueue;
  private doneTimer: number | null = null;
  private setHasNew: ((has: boolean) => void) | null = null;
  private wantMarker = false;
  private readonly markerOut = { x: 0, y: 0 };

  constructor(uiRoot: HTMLElement, store: ContentStore, host: ContentHost) {
    this.store = store;
    this.host = host;
    this.queue = new SightingQueue(store);
    this.machine = new OnboardingMachine(store.getOnboardingStatus() === 'pending');
    this.coach = new CoachMark(uiRoot, () => this.onCoachButton());
    this.card = new SightingCard(uiRoot, {
      onVisibilityChange: () => this.host.onBlockingChange(),
      onOpenCodex: (tab, id) => this.codex.open(tab, id),
      isCoveredByOverlay: () => this.codex.isOpen(),
    });
    this.codex = new CodexScreen(uiRoot, {
      isSeen: (id) => store.hasSeen(id),
      isNew: (id) => store.isNew(id),
      onView: (id) => {
        store.markViewed(id);
        this.refreshNewBadge();
      },
      onClose: () => this.refreshNewBadge(),
    });
  }

  /** Connects the Codex menu buttons' "new" dot. */
  attachEntryHandle(handle: { setHasNew: (has: boolean) => void }): void {
    this.setHasNew = handle.setHasNew;
    this.refreshNewBadge();
  }

  private refreshNewBadge(): void {
    if (!this.setHasNew) return;
    const ids = [...allEnemyEntries(), eliteEntry(), ...allTowerEntries()].map((e) => e.seenId);
    this.setHasNew(ids.some((id) => this.store.isNew(id)));
  }

  /** True while the first-sighting card holds the game paused. */
  isBlocking(): boolean {
    return this.card.isOpen();
  }

  isTourActive(): boolean {
    return this.machine.active;
  }

  openCodex(tab: CodexTab = 'enemies', id?: string): void {
    this.codex.open(tab, id);
  }

  /** Subscribe to the new level's sim events. Listeners die with the bus on the next level load. */
  bindLevel(bus: EventBus, level: LevelDef, levelIndex: number): void {
    this.dismissCard();
    this.machine.onLevelStart(levelIndex);
    this.coach.resetDoneStyle();
    bus.on('enemySpawned', (e) => {
      if (this.queue.offerEnemy(e.enemyType)) this.flush();
    });
    bus.on('waveStarted', (e) => {
      if (e.endless || !waveHasElite(level, e.waveIndex)) return;
      if (this.queue.offerElite()) this.flush();
    });
    const onCast = (): void => {
      this.machine.onAbilityCast();
      if (this.machine.step === 'done' && this.store.getOnboardingStatus() === 'pending') this.finishTour('done');
    };
    bus.on('abilityTargeted', onCast);
    bus.on('overchargeActivated', onCast);
  }

  /** A tower type became available (e.g. unlocked by progression): show its card once. */
  towerUnlocked(type: TowerType): void {
    if (this.queue.offerTower(type)) this.flush();
  }

  private flush(): void {
    const refs = this.queue.drain();
    if (refs.length > 0) {
      this.card.show(refs);
      this.refreshNewBadge();
    }
  }

  /** Called with every UI sync while playing. */
  observe(obs: OnboardingObs): void {
    if (!this.machine.active) return;
    if (!obs.inPlay || obs.levelIndex !== 0) {
      this.wantMarker = false;
      this.coach.hide();
      return;
    }
    this.machine.update(obs);
    if (this.machine.step === 'done') {
      this.finishTour('done');
      return;
    }
    if (obs.modalOpen || this.card.isOpen() || this.codex.isOpen()) {
      this.wantMarker = false;
      this.coach.hide();
      return;
    }
    const msg = coachMessage(this.machine.step, obs);
    this.wantMarker = msg?.marker === true;
    if (msg) this.coach.show(msg);
    else this.coach.hide();
    if (!this.wantMarker) this.coach.setMarker(null);
  }

  /**
   * Per-frame: keep the "build here" marker on the suggested tile. `project` writes the tile's screen
   * position into `out` and returns whether it is on screen.
   */
  updateMarker(project: (col: number, row: number, out: { x: number; y: number }) => boolean): void {
    if (!this.wantMarker || !this.machine.active || this.card.isOpen() || this.codex.isOpen()) return;
    if (project(TOUR_TILE.col, TOUR_TILE.row, this.markerOut)) this.coach.setMarker(this.markerOut);
    else this.coach.setMarker(null);
  }

  /** Left the play screen (menu / level select). */
  onLeavePlay(): void {
    this.wantMarker = false;
    this.coach.hide();
    this.dismissCard();
  }

  /** Closes the card; foes queued behind the one on screen were never shown, so they stay "unseen". */
  private dismissCard(): void {
    for (const ref of this.card.closeKeepingUnshown()) {
      this.store.unmarkSeen(seenIdOf(ref));
    }
    this.refreshNewBadge();
  }

  onLevelWon(levelIndex: number): void {
    if (levelIndex === 0 && this.machine.active) this.finishTour('done', false);
  }

  private finishTour(status: 'done' | 'skipped', celebrate = status === 'done'): void {
    this.machine.stop();
    this.store.setOnboardingStatus(status);
    if (celebrate) {
      this.coach.showDone();
      if (this.doneTimer !== null) window.clearTimeout(this.doneTimer);
      this.doneTimer = window.setTimeout(() => {
        this.doneTimer = null;
        this.coach.hide();
        this.coach.resetDoneStyle();
      }, 7000);
    } else {
      this.coach.hide();
    }
  }

  /** The coach card's button: "Skip tour" while running, "Close" on the closing message. */
  private onCoachButton(): void {
    if (this.machine.active) this.finishTour('skipped');
    else {
      if (this.doneTimer !== null) window.clearTimeout(this.doneTimer);
      this.doneTimer = null;
      this.coach.hide();
      this.coach.resetDoneStyle();
    }
  }

  /** Settings → "Replay tutorial". */
  replayTutorial(): void {
    if (this.doneTimer !== null) {
      window.clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
    this.store.setOnboardingStatus('pending');
    this.machine.start();
    this.coach.hide();
    this.coach.resetDoneStyle();
    this.host.startTutorialIsland();
  }

  dispose(): void {
    if (this.doneTimer !== null) window.clearTimeout(this.doneTimer);
    this.coach.dispose();
    this.card.dispose();
    this.codex.dispose();
  }
}
