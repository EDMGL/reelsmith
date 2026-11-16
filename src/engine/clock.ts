/**
 * Playback clock: maps a monotonic wall clock (performance.now or the audio
 * context clock, in seconds) to project time. Pure apart from the injected
 * `now` function, so it is fully testable.
 */
export class PlaybackClock {
  private anchorProject = 0;
  private anchorWall = 0;
  private running = false;

  constructor(private readonly now: () => number) {}

  /** Starts (or restarts) running from project time `t`. */
  start(t: number): void {
    this.anchorProject = t;
    this.anchorWall = this.now();
    this.running = true;
  }

  /** Stops; `time()` then stays at the stop position. */
  stop(): void {
    if (!this.running) return;
    this.anchorProject = this.time();
    this.running = false;
  }

  /** Jumps to `t`, keeping the running state. */
  seek(t: number): void {
    this.anchorProject = t;
    this.anchorWall = this.now();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Current project time. */
  time(): number {
    if (!this.running) return this.anchorProject;
    return this.anchorProject + (this.now() - this.anchorWall);
  }
}

export interface TickResult {
  /** Time to publish with setPlaybackTime. */
  time: number;
  /** True when the end was reached: publish `time` and pause. */
  ended: boolean;
}

/**
 * Decides what a playback tick does: clamps at the project end and reports
 * that playback must stop there. An empty project (duration 0) ends at once.
 */
export function playbackTick(clockTime: number, duration: number): TickResult {
  if (!(duration > 0) || clockTime >= duration) return { time: Math.max(0, duration), ended: true };
  return { time: Math.max(0, clockTime), ended: false };
}
