/**
 * Clocks.
 *
 * Replay runs on a virtual clock so a 30-minute scene can be replayed
 * deterministically in seconds. Scene time and wall time are reported
 * separately; a virtual-clock run never claims real-time stability
 * (review R1 F5 / ARB-002 prompt item 9).
 */

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

interface VirtualTimer {
  at: number;
  seq: number;
  resolve: () => void;
  reject: (error: Error) => void;
  cancel?: () => void;
}

/** Deterministic clock: time only moves when no runnable work is left. */
export class VirtualClock implements Clock {
  private current: number;
  private seq = 0;
  private timers: VirtualTimer[] = [];

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer: VirtualTimer = {
        at: this.current + Math.max(0, ms),
        seq: this.seq++,
        resolve,
        reject,
      };
      const onAbort = () => {
        this.timers = this.timers.filter((t) => t !== timer);
        reject(new DOMException('aborted', 'AbortError'));
      };
      timer.cancel = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.timers.push(timer);
    });
  }

  /** Lets every already-runnable promise chain finish before time moves. */
  private static flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Advances scene time up to `endTime`, firing timers in order. Returns the
   * number of timers fired, which is useful for asserting a run did something.
   */
  async runUntil(endTime: number): Promise<number> {
    let fired = 0;
    for (;;) {
      await VirtualClock.flush();
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers[0];
      if (!next || next.at > endTime) {
        this.current = endTime;
        await VirtualClock.flush();
        return fired;
      }
      this.timers.shift();
      this.current = next.at;
      next.cancel?.();
      next.resolve();
      fired += 1;
    }
  }

  /** Drains all pending timers regardless of end time. */
  async drain(): Promise<void> {
    for (;;) {
      await VirtualClock.flush();
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift();
      if (!next) return;
      this.current = Math.max(this.current, next.at);
      next.cancel?.();
      next.resolve();
    }
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
