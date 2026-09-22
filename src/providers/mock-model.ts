/**
 * Scripted model provider.
 *
 * It returns pre-written JSON. That means it can demonstrate that the
 * inference layer has no tools and that untrusted text stays in its own
 * field, but it proves nothing about a real model understanding a frame or
 * resisting prompt injection (R1 non-blocking correction).
 */

import type { Clock } from '../clock.js';
import { ProviderError, type DecisionInput, type ModelProvider, type ProviderUsage, type RawDecision } from '../types.js';
import type { Scenario } from '../fixtures/scenario.js';

export type ModelFault = 'timeout' | 'rate_limit' | 'spend_limit' | 'malformed' | 'overlong';

export interface MockModelOptions {
  latencyMs?: number;
  timeoutMs?: number;
  /** Scene times at which a specific fault fires, consumed once each. */
  faults?: Array<{ at: number; fault: ModelFault }>;
}

export class MockModelProvider implements ModelProvider {
  readonly id = 'mock_model';
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly pendingFaults: Array<{ at: number; fault: ModelFault }>;

  constructor(
    private readonly clock: Clock,
    private readonly options: MockModelOptions = {},
    scenario?: Scenario,
  ) {
    const fromScenario = (scenario?.timeline ?? [])
      .filter((event) => event.kind === 'model_fault')
      .map((event) => ({ at: event.at, fault: (event as { fault: ModelFault }).fault }));
    this.pendingFaults = [...(options.faults ?? []), ...fromScenario].sort((a, b) => a.at - b.at);
  }

  private takeFault(now: number): ModelFault | null {
    const index = this.pendingFaults.findIndex((entry) => entry.at <= now);
    if (index === -1) return null;
    const [entry] = this.pendingFaults.splice(index, 1);
    return entry!.fault;
  }

  async decide(input: DecisionInput, signal: AbortSignal): Promise<RawDecision> {
    this.calls += 1;
    const fault = this.takeFault(this.clock.now());

    if (fault === 'timeout') {
      await this.clock.sleep(this.options.timeoutMs ?? 8000, signal);
      throw new ProviderError('model call timed out', 'timeout');
    }
    if (fault === 'rate_limit') {
      await this.clock.sleep(20, signal);
      throw new ProviderError('429 rate limited', 'rate_limit', 5000);
    }
    if (fault === 'spend_limit') {
      await this.clock.sleep(20, signal);
      throw new ProviderError('enforced_spend_limit_reached', 'spend_limit');
    }

    await this.clock.sleep(this.options.latencyMs ?? 900, signal);
    if (signal.aborted) throw new ProviderError('aborted', 'server');

    this.inputTokens += 2200;
    this.outputTokens += 120;

    if (fault === 'malformed') {
      return { speak: 'yes', utterance: 42, reply_to_ids: 'nope', observation_id: input.observation.observationId, reason_code: 'chat_reply' };
    }
    if (fault === 'overlong') {
      return {
        speak: true,
        utterance: '這一波的節奏其實從剛剛那個轉角就開始變了，'.repeat(6),
        reply_to_ids: [],
        observation_id: input.observation.observationId,
        reason_code: 'game_event',
      };
    }

    return this.scriptedReply(input);
  }

  private scriptedReply(input: DecisionInput): RawDecision {
    const observationId = input.observation.observationId;
    const candidates = input.untrustedChatMessages;
    const primary = candidates[candidates.length - 1];

    if (!primary) {
      return { speak: false, utterance: '', reply_to_ids: [], observation_id: observationId, reason_code: 'no_new_information' };
    }

    const key = `${primary.source}::${primary.messageId}`;
    const tag = primary.tag ?? 'normal';

    if (tag === 'injection') {
      // Refuses the instruction, stays in character, executes nothing.
      return { speak: false, utterance: '', reply_to_ids: [], observation_id: observationId, reason_code: 'unsafe_input' };
    }
    if (tag === 'no_reply' || tag === 'empty') {
      return { speak: false, utterance: '', reply_to_ids: [], observation_id: observationId, reason_code: 'no_new_information' };
    }
    if (tag === 'short_reaction') {
      // A valid two-character reaction. Under the old rules this was dropped
      // for being under 20 characters (R1 F1).
      return { speak: true, utterance: '漂亮！', reply_to_ids: [key], observation_id: observationId, reason_code: 'chat_reply' };
    }
    if (tag === 'multi_target') {
      const keys = candidates.filter((m) => m.tag === 'multi_target').map((m) => `${m.source}::${m.messageId}`);
      return {
        speak: true,
        utterance: '兩位問的是同一件事，現在還沒到收尾，穩著打還有機會。',
        reply_to_ids: keys.length > 0 ? keys : [key],
        observation_id: observationId,
        reason_code: 'chat_reply',
      };
    }
    if (tag === 'overlong') {
      return { speak: false, utterance: '', reply_to_ids: [], observation_id: observationId, reason_code: 'uncertain' };
    }

    const round = input.observation.contextVersion + 1;
    const excerpt = [...primary.text.trim()].slice(0, 10).join('');
    const line = `剛剛有人問${excerpt}，第${round}局先穩住再看下一步。`;
    const utterance = [...line].length > 80 ? [...line].slice(0, 80).join('') : line;
    return {
      speak: true,
      utterance,
      reply_to_ids: [key],
      observation_id: observationId,
      reason_code: 'chat_reply',
    };
  }

  usage(): ProviderUsage {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      characters: null,
      costUsd: 'UNKNOWN',
    };
  }
}
