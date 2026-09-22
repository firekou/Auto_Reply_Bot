/**
 * Offline player: simulates playback on the clock, touches no audio device.
 *
 * `stopNow` has its own timeout so a stuck player cannot block the rest of an
 * emergency stop (R1 F2).
 */
import type { Clock } from '../clock.js';
import { isAbortError } from '../clock.js';
import type { AudioPlayer, PlaybackRecord } from '../types.js';

export class OfflinePlayer implements AudioPlayer {
  private playing = false;
  private stopController: AbortController | null = null;
  private stopTimeouts = 0;

  constructor(private readonly clock: Clock, private readonly stopTimeoutMs = 1000) {}

  async open(): Promise<void> {}

  async play(_audio: Buffer, _mediaType: string, durationMs: number, signal: AbortSignal): Promise<PlaybackRecord> {
    if (this.playing) throw new Error('exclusive player: another playback is already running');
    this.playing = true;
    const startedAt = this.clock.now();
    const local = new AbortController();
    this.stopController = local;
    const onAbort = () => local.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let interrupted = false;
    try {
      await this.clock.sleep(durationMs, local.signal);
    } catch (error) {
      if (!isAbortError(error)) throw error;
      interrupted = true;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.playing = false;
      this.stopController = null;
    }
    const endedAt = this.clock.now();
    return { startedAt, endedAt, durationMs: endedAt - startedAt, interrupted };
  }

  async stopNow(): Promise<void> {
    const controller = this.stopController;
    if (!controller) return;
    controller.abort();
    const deadline = this.clock.now() + this.stopTimeoutMs;
    while (this.playing && this.clock.now() < deadline) {
      await this.clock.sleep(10);
    }
    if (this.playing) {
      this.stopTimeouts += 1;
      this.playing = false;
    }
  }

  get stopTimeoutCount(): number {
    return this.stopTimeouts;
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
