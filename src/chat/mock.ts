/** Replays synthetic chat from a scenario. Touches no chat platform. */
import type { Clock } from '../clock.js';
import type { ChatAdapter, ChatMessage, SourceHealth } from '../types.js';
import type { Scenario } from '../fixtures/scenario.js';

export class MockChatAdapter implements ChatAdapter {
  readonly id = 'mock_chat';
  readonly kind = 'mock' as const;
  private cursor = 0;
  private healthState: SourceHealth = { state: 'ok', lastOkAt: null, consecutiveFailures: 0, reason: null };
  private readonly outages: Array<{ at: number; untilAt: number }>;

  constructor(
    private readonly scenario: Scenario,
    private readonly clock: Clock,
    private readonly latencyMs = 15,
  ) {
    this.outages = scenario.timeline
      .filter((event) => event.kind === 'chat_outage')
      .map((event) => ({ at: event.at, untilAt: (event as { untilAt: number }).untilAt }));
  }

  async start(): Promise<void> {}

  async poll(signal: AbortSignal): Promise<ChatMessage[]> {
    await this.clock.sleep(this.latencyMs, signal);
    const now = this.clock.now();
    const outage = this.outages.find((w) => now >= w.at && now < w.untilAt);
    if (outage) {
      this.healthState = {
        state: 'offline',
        lastOkAt: this.healthState.lastOkAt,
        consecutiveFailures: this.healthState.consecutiveFailures + 1,
        reason: 'chat source offline',
      };
      // On reconnect the adapter resumes from now, it does not read back
      // the whole backlog.
      while (this.cursor < this.scenario.chat.length && this.scenario.chat[this.cursor]!.receivedAt <= now) {
        this.cursor += 1;
      }
      return [];
    }

    const batch: ChatMessage[] = [];
    while (this.cursor < this.scenario.chat.length && this.scenario.chat[this.cursor]!.receivedAt <= now) {
      batch.push(this.scenario.chat[this.cursor]!);
      this.cursor += 1;
    }
    this.healthState = { state: 'ok', lastOkAt: now, consecutiveFailures: 0, reason: null };
    return batch;
  }

  health(): SourceHealth {
    return this.healthState;
  }

  async stop(): Promise<void> {}
}
