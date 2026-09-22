/** Wires a full mock replay together. Used by the CLI and by the tests. */
import { VirtualClock } from './clock.js';
import { MockCaptureAdapter } from './capture/mock.js';
import { MockChatAdapter } from './chat/mock.js';
import { MockModelProvider } from './providers/mock-model.js';
import { MockTtsProvider } from './providers/mock-tts.js';
import { OfflinePlayer } from './audio/offline-player.js';
import { EventLog } from './log/events.js';
import { HostRuntime } from './director/runtime.js';
import { ScriptedControl, type ControlCommand } from './control/channel.js';
import { buildScenario, type Scenario } from './fixtures/scenario.js';
import { DEFAULT_CONFIG, type RuntimeConfig } from './config/load.js';
import type { ModelProvider, Persona, ReferenceExcerpt } from './types.js';

export const DEFAULT_PERSONA: Persona = {
  personaId: 'host_01',
  personaVersion: '0.1',
  language: 'zh-TW',
  personality: ['親切', '機靈', '輕鬆'],
  speakingStyle: '口語、短句、不挖苦觀眾',
  catchphrases: ['穩住'],
  avoidPhrases: ['根據截圖分析'],
  voiceId: null,
};

export const DEFAULT_REFERENCES: ReferenceExcerpt[] = [
  {
    id: 'ref_rules_v1',
    version: '0.1',
    source: 'fixtures/reference/rules.md',
    text: '合成規則摘要：每局最多 150 個回合，分數高者勝，換局時分數歸零。這是測試用的虛構規則。',
  },
  {
    id: 'ref_persona_v1',
    version: '0.1',
    source: 'fixtures/reference/persona.md',
    text: '節目設定：這是一個虛構的互動節目角色，不冒充特定真人，被問到是否為 AI 時如實回答。',
  },
];

export interface ReplayOptions {
  scenario?: Scenario;
  config?: RuntimeConfig;
  durationMs?: number;
  logPath?: string | null;
  control?: Array<{ at: number; command: ControlCommand }>;
  injectEstop?: number;
  modelLatencyMs?: number;
  /** Test hook: swap in a provider that misbehaves on purpose. */
  modelFactory?: (clock: VirtualClock) => ModelProvider;
}

export interface ReplayResult {
  runtime: HostRuntime;
  log: EventLog;
  clock: VirtualClock;
  scenario: Scenario;
  sceneTimeMs: number;
  wallTimeMs: number;
}

export async function runReplay(options: ReplayOptions = {}): Promise<ReplayResult> {
  const scenario = options.scenario ?? buildScenario();
  const config = options.config ?? DEFAULT_CONFIG;
  const durationMs = options.durationMs ?? scenario.durationMs;
  const clock = new VirtualClock(scenario.startAt);
  const log = new EventLog(options.logPath ?? null);

  const control: Array<{ at: number; command: ControlCommand }> = [...(options.control ?? [])];
  if (options.injectEstop && options.injectEstop > 0) {
    const spacing = Math.floor(durationMs / (options.injectEstop + 1));
    for (let i = 1; i <= options.injectEstop; i++) {
      control.push({ at: spacing * i, command: 'estop' });
    }
  }
  const scripted = new ScriptedControl(control);

  const runtime = new HostRuntime({
    scenario,
    config,
    clock,
    capture: new MockCaptureAdapter(scenario, clock),
    chat: new MockChatAdapter(scenario, clock),
    model:
      options.modelFactory?.(clock) ??
      new MockModelProvider(clock, { latencyMs: options.modelLatencyMs ?? 900, timeoutMs: config.model.timeoutMs }, scenario),
    tts: new MockTtsProvider(clock, { failAt: scenario.timeline.filter((e) => e.kind === 'tts_fault').map((e) => e.at) }),
    player: new OfflinePlayer(clock, config.audio.emergencyStopTargetMs),
    log,
    persona: DEFAULT_PERSONA,
    references: DEFAULT_REFERENCES,
  });

  const wallStart = Date.now();
  await runtime.start();

  const controlLoop = (async () => {
    while (clock.now() < durationMs) {
      await clock.sleep(config.director.tickMs);
      for (const command of scripted.due(clock.now())) {
        if (command === 'estop') await runtime.emergencyStop();
        else if (command === 'pause') runtime.pause();
        else if (command === 'resume') runtime.resume();
        else if (command === 'stop') runtime.stop();
      }
    }
  })();

  const runPromise = runtime.run(durationMs);
  await clock.runUntil(durationMs);
  await Promise.race([Promise.all([runPromise, controlLoop]), clock.drain()]);
  await runtime.shutdown();
  await clock.drain();

  return {
    runtime,
    log,
    clock,
    scenario,
    sceneTimeMs: clock.now(),
    wallTimeMs: Date.now() - wallStart,
  };
}
