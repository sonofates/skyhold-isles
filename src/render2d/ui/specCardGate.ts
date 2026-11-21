/**
 * Bookkeeping of the optional specialization comparison card (specCard2d.ts): pauses the run
 * while it is open and ALWAYS gives the pause back, whichever way the card goes away:
 *  - its own close (Escape / B, the seal, the backdrop, "Choose") → `onClose`;
 *  - the lazy chunk failing to load, or the card throwing while it builds (a stale tab after a
 *    deploy did exactly this: the run stayed paused for good, so no plot answered taps any more);
 *  - the sheet leaving the DOM without its `onClose` (replaced / removed by another board);
 *  - the run moving on under it (end board, restart, replay, the tower gone or already
 *    specialized): `frame(false)` cancels it.
 * DOM-free so tests drive it with a fake stepper and fake sheets.
 */

/** What the gate needs of an opened card. */
export interface GateSheet {
  close(): void;
  /** The card's root element (or anything with `isConnected`): gone from the DOM = closed. */
  readonly overlay: { readonly isConnected: boolean };
}

/** Builds the card; it must call `onClose` when the card closes itself. */
export type OpenCard = (onClose: () => void) => GateSheet;

export interface GateHost {
  readonly stepper: { paused: boolean };
}

export class SpecCardGate {
  private state: 'closed' | 'loading' | 'open' = 'closed';
  private sheet: GateSheet | null = null;
  private wasPaused = false;
  /** Bumped on every open / finish: late callbacks of an older card are ignored. */
  private seq = 0;
  /** Tower the open card is for (-1 = none). */
  towerId = -1;
  /** The world the card was opened in (a restart swaps it: ids are reused). */
  owner: unknown = null;

  private readonly host: GateHost;

  constructor(host: GateHost) {
    this.host = host;
  }

  /** Loading or open. */
  get isOpen(): boolean {
    return this.state !== 'closed';
  }

  get debugState(): 'closed' | 'loading' | 'open' {
    return this.state;
  }

  /** The app went to the background while the card was up: the run stays paused after it closes. */
  keepPausedOnClose(): void {
    if (this.state !== 'closed') this.wasPaused = true;
  }

  /** Opens the card (pauses the run). False when one is already up. */
  open(towerId: number, owner: unknown, load: () => Promise<OpenCard>): boolean {
    if (this.state !== 'closed') return false;
    this.state = 'loading';
    this.towerId = towerId;
    this.owner = owner;
    this.wasPaused = this.host.stepper.paused;
    this.host.stepper.paused = true;
    const seq = ++this.seq;
    let p: Promise<OpenCard>;
    try {
      p = load();
    } catch {
      this.finish(seq);
      return false;
    }
    void p
      .then((make) => {
        if (seq !== this.seq || this.state !== 'loading') return;
        const sheet = make(() => this.finish(seq));
        if (seq !== this.seq) {
          // Closed while it was being built (its own onClose ran): nothing to keep.
          return;
        }
        this.sheet = sheet;
        this.state = 'open';
      })
      .catch(() => this.finish(seq));
    return true;
  }

  /** Closes whatever is up and gives the pause back (no-op when closed). */
  cancel(): void {
    if (this.state === 'closed') return;
    const s = this.sheet;
    this.finish(this.seq);
    // Its onClose comes back with an old seq: ignored.
    s?.close();
  }

  /**
   * Every frame: `keep` = the card still makes sense (same run, tower alive at tier III without a
   * branch, no end board / replay). A sheet that left the DOM on its own also resets the gate.
   */
  frame(keep: boolean): void {
    if (this.state === 'closed') return;
    if (!keep) {
      this.cancel();
      return;
    }
    if (this.state === 'open' && this.sheet && !this.sheet.overlay.isConnected) this.finish(this.seq);
  }

  private finish(seq: number): void {
    if (seq !== this.seq || this.state === 'closed') return;
    this.state = 'closed';
    this.sheet = null;
    this.towerId = -1;
    this.owner = null;
    this.seq++;
    this.host.stepper.paused = this.wasPaused;
  }
}
