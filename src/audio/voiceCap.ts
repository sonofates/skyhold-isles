// One slot per scheduled WebAudio source, including delayed notes in a layered cue.
// Sources return their own slot on "ended", even when the context was suspended mid-note.
export class VoiceCap {
  private readonly counts = new Map<string, number>();
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }

  acquire(type: string): boolean {
    const count = this.counts.get(type) ?? 0;
    if (count >= this.limit) return false;
    this.counts.set(type, count + 1);
    return true;
  }

  release(type: string): void {
    const count = this.counts.get(type) ?? 0;
    if (count > 0) this.counts.set(type, count - 1);
  }
}
