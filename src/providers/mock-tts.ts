/** Produces silence of the right length. A mock pass is never a real TTS pass. */
import type { Clock } from '../clock.js';
import { silentWav } from '../fixtures/wav.js';
import { ProviderError, type ProviderUsage, type TtsProvider, type TtsRequest, type TtsResult } from '../types.js';

export interface MockTtsOptions {
  latencyMs?: number;
  msPerCharacter?: number;
  failAt?: number[];
}

export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock_tts';
  private calls = 0;
  private characters = 0;
  private readonly failAt: number[];

  constructor(private readonly clock: Clock, private readonly options: MockTtsOptions = {}) {
    this.failAt = [...(options.failAt ?? [])].sort((a, b) => a - b);
  }

  async synthesize(request: TtsRequest, signal: AbortSignal): Promise<TtsResult> {
    this.calls += 1;
    const now = this.clock.now();
    const failIndex = this.failAt.findIndex((at) => at <= now);
    if (failIndex !== -1) {
      this.failAt.splice(failIndex, 1);
      await this.clock.sleep(20, signal);
      throw new ProviderError('tts synthesis failed', 'server');
    }
    await this.clock.sleep(this.options.latencyMs ?? 350, signal);
    if (signal.aborted) throw new ProviderError('aborted', 'server');
    const characterCount = [...request.text].length;
    this.characters += characterCount;
    const durationMs = Math.max(600, characterCount * (this.options.msPerCharacter ?? 180));
    return { audio: silentWav(durationMs), mediaType: 'audio/wav', durationMs };
  }

  usage(): ProviderUsage {
    return { calls: this.calls, inputTokens: null, outputTokens: null, characters: this.characters, costUsd: 'UNKNOWN' };
  }
}
