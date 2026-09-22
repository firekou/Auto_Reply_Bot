#!/usr/bin/env node
/**
 * arb CLI.
 *
 * Commands: replay, report, make-fixtures, doctor.
 * Everything runs against mock adapters. Nothing here touches a browser, an
 * audio device, a paid provider or a live broadcast.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config/load.js';
import { buildScenario } from '../fixtures/scenario.js';
import { buildReport, formatReport, readEventLog } from '../metrics/report.js';
import { buildTranscript } from '../metrics/transcript.js';
import { runReplay } from '../replay.js';
import { CONTROL_COMMANDS } from '../control/channel.js';

interface Args {
  command: string;
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, 'true');
    }
  }
  return { command, flags };
}

function usage(): string {
  return [
    'arb <command> [flags]',
    '',
    'commands:',
    '  replay          run the mock loop on a synthetic scenario',
    '  report          summarize an existing JSONL event log',
    '  transcript      print a readable transcript of an event log',
    '  make-fixtures   write the deterministic fixture files',
    '  doctor          report which checks can run in this environment',
    '',
    'replay flags:',
    '  --minutes <n>        scene minutes to replay (default 30)',
    '  --seed <n>           scenario seed (default 20260922)',
    '  --out <path>         JSONL event log path',
    '  --inject-estop <n>   fire n evenly spaced emergency stops',
    '  --transcript <n>     also print the first n transcript lines',
    '',
    `control commands on stdin: ${CONTROL_COMMANDS.join(', ')}`,
  ].join('\n');
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || command === '--help') {
    console.log(usage());
    return 0;
  }

  if (command === 'make-fixtures') {
    const seed = Number(flags.get('seed') ?? 20260922);
    const minutes = Number(flags.get('minutes') ?? 30);
    const dir = flags.get('dir') ?? join('fixtures', 'scenario-a');
    const scenario = buildScenario({ seed, durationMs: minutes * 60_000 });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'scenario.json'),
      `${JSON.stringify({ name: scenario.name, seed: scenario.seed, startAt: scenario.startAt, durationMs: scenario.durationMs, frameIntervalMs: scenario.frameIntervalMs, frameWidth: scenario.frameWidth, frameHeight: scenario.frameHeight, chatCount: scenario.chat.length }, null, 2)}\n`,
    );
    writeFileSync(join(dir, 'chat.jsonl'), `${scenario.chat.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    writeFileSync(join(dir, 'timeline.json'), `${JSON.stringify(scenario.timeline, null, 2)}\n`);
    console.log(`wrote ${scenario.chat.length} chat entries and ${scenario.timeline.length} timeline events to ${dir}`);
    console.log('frames are rendered deterministically at replay time and are not committed');
    return 0;
  }

  if (command === 'replay') {
    const minutes = Number(flags.get('minutes') ?? 30);
    const seed = Number(flags.get('seed') ?? 20260922);
    const out = flags.get('out') ?? join('runtime', 'logs', `replay-${seed}.jsonl`);
    const injectEstop = Number(flags.get('inject-estop') ?? 0);
    const config = loadConfig(flags.get('config'));
    const durationMs = minutes * 60_000;
    const scenario = buildScenario({ seed, durationMs });

    mkdirSync(dirname(out), { recursive: true });
    const result = await runReplay({ scenario, config, durationMs, logPath: out, injectEstop });
    const report = buildReport(result.log.events);
    const transcriptLines = Number(flags.get('transcript') ?? 0);
    if (transcriptLines > 0) {
      console.log(buildTranscript(result.log.events, transcriptLines));
      console.log('');
    }
    console.log(formatReport(report));
    console.log('');
    console.log(`event log: ${out}`);
    console.log('mode: mock. No real capture, model, TTS, audio device or broadcast was involved.');
    console.log('Scene time is virtual: this is not a 30-minute real-time stability run.');
    return report.duplicatePlaybacks === 0 && report.overlapCount === 0 && report.latePlaybackAfterStop === 0 ? 0 : 1;
  }

  if (command === 'transcript') {
    const path = flags.get('log');
    if (!path) {
      console.error('transcript requires --log <path>');
      return 2;
    }
    const limit = Number(flags.get('lines') ?? 80);
    console.log(buildTranscript(readEventLog(path), limit));
    return 0;
  }

  if (command === 'report') {
    const path = flags.get('log');
    if (!path) {
      console.error('report requires --log <path>');
      return 2;
    }
    console.log(formatReport(buildReport(readEventLog(path))));
    return 0;
  }

  if (command === 'doctor') {
    const checks = [
      { name: 'config loads', status: 'RUN' },
      { name: 'mock scenario builds', status: 'RUN' },
      { name: 'browser reachable', status: 'SKIPPED (no browser adapter in this build)' },
      { name: 'chat selector matches', status: 'SKIPPED (no real chat adapter in this build)' },
      { name: 'audio device present', status: 'SKIPPED (offline player only)' },
      { name: 'model credentials', status: 'SKIPPED (mock provider only)' },
      { name: 'tts credentials', status: 'SKIPPED (mock provider only)' },
    ];
    loadConfig(flags.get('config'));
    buildScenario({ durationMs: 60_000 });
    for (const check of checks) console.log(`${check.status.padEnd(48)} ${check.name}`);
    console.log('');
    console.log('SKIPPED is not a pass. Nothing here was verified on a streaming machine.');
    return 0;
  }

  console.error(`unknown command: ${command}\n`);
  console.error(usage());
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
