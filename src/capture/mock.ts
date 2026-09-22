/** Replays synthetic frames from a scenario. Touches no browser. */
import type { Clock } from '../clock.js';
import { CaptureError, type CaptureAdapter, type Frame, type SourceHealth } from '../types.js';
import { hashFrame, renderFrame, type Scenario, type TimelineEvent } from '../fixtures/scenario.js';

function windowsOf(scenario: Scenario, kind: TimelineEvent['kind']): Array<{ at: number; untilAt: number }> {
  return scenario.timeline
    .filter((event) => event.kind === kind)
    .map((event) => ({ at: event.at, untilAt: (event as { untilAt: number }).untilAt }));
}

export class MockCaptureAdapter implements CaptureAdapter {
  readonly id = 'mock_capture';
  private healthState: SourceHealth = { state: 'ok', lastOkAt: null, consecutiveFailures: 0, reason: null };
  private readonly blackouts: Array<{ at: number; untilAt: number }>;
  private readonly stalls: Array<{ at: number; untilAt: number }>;
  private lastHash: string | null = null;
  private sameHashCount = 0;

  constructor(
    private readonly scenario: Scenario,
    private readonly clock: Clock,
    private readonly latencyMs = 40,
  ) {
    this.blackouts = windowsOf(scenario, 'capture_blackout');
    this.stalls = windowsOf(scenario, 'capture_stall');
  }

  async start(): Promise<void> {}

  async grab(signal: AbortSignal): Promise<Frame> {
    await this.clock.sleep(this.latencyMs, signal);
    const now = this.clock.now();
    const inBlackout = this.blackouts.some((w) => now >= w.at && now < w.untilAt);
    const inStall = this.stalls.some((w) => now >= w.at && now < w.untilAt);
    const stallAnchor = this.stalls.find((w) => now >= w.at && now < w.untilAt)?.at ?? now;
    const sampleTime = inStall ? stallAnchor : now;

    const bytes = renderFrame(this.scenario, sampleTime, inBlackout);
    const frameHash = hashFrame(bytes);

    if (frameHash === this.lastHash) this.sameHashCount += 1;
    else this.sameHashCount = 0;
    this.lastHash = frameHash;

    // R1 non-blocking correction: an unchanged hash alone is not "offline".
    // Degraded needs an unchanged hash AND a dark frame, and degraded only
    // means "stop producing new frame events".
    if (inBlackout && this.sameHashCount >= 2) {
      this.healthState = {
        state: 'degraded',
        lastOkAt: this.healthState.lastOkAt,
        consecutiveFailures: this.sameHashCount,
        reason: 'dark and unchanged frames',
      };
    } else if (inStall && this.sameHashCount >= 4) {
      this.healthState = {
        state: 'degraded',
        lastOkAt: this.healthState.lastOkAt,
        consecutiveFailures: this.sameHashCount,
        reason: 'frame stopped updating',
      };
    } else {
      this.healthState = { state: 'ok', lastOkAt: now, consecutiveFailures: 0, reason: null };
    }

    if (signal.aborted) throw new CaptureError('aborted');

    return {
      frameRef: `frame_${sampleTime}`,
      bytes,
      mediaType: 'image/png',
      width: this.scenario.frameWidth,
      height: this.scenario.frameHeight,
      frameHash,
      capturedAt: sampleTime,
    };
  }

  health(): SourceHealth {
    return this.healthState;
  }

  async stop(): Promise<void> {}
}
