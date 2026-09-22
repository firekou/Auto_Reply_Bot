/**
 * Replay report.
 *
 * Coverage is defined by review R1 F3: covered unique qualified events over
 * unique qualified events. It is never utterances divided by messages, which
 * can exceed 100% when one reply answers several messages. Game comments are
 * counted separately.
 */

import { readFileSync } from 'node:fs';
import type { LogEvent } from '../log/events.js';

export interface LatencySummary {
  samples: number;
  medianMs: number | null;
  p95Ms: number | null;
}

export interface ReplayReport {
  scenario: string | null;
  sceneTimeMs: number;
  wallTimeMs: number;
  modelCalls: number;
  utterancesPlayed: number;
  qualifiedEvents: number;
  coveredEvents: number;
  coverageRate: number | null;
  gameCommentCount: number;
  duplicatePlaybacks: number;
  overlapCount: number;
  emergencyStops: number;
  latePlaybackAfterStop: number;
  droppedByReason: Record<string, number>;
  latency: {
    eventToModel: LatencySummary;
    modelRoundTrip: LatencySummary;
    validateAndTts: LatencySummary;
    eventToPlaybackStart: LatencySummary;
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

function summarize(values: number[]): LatencySummary {
  return { samples: values.length, medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

export function readEventLog(path: string): LogEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogEvent);
}

export function buildReport(events: readonly LogEvent[]): ReplayReport {
  const starts = events.filter((event) => event.name === 'playback_start');
  const ends = events.filter((event) => event.name === 'playback_end');
  const drops = events.filter((event) => event.name === 'candidate_dropped');
  const stops = events.filter((event) => event.name === 'emergency_stop');
  const runStart = events.find((event) => event.name === 'run_start');

  const qualified = new Set<string>();
  for (const event of events) {
    if (event.name === 'chat_admitted' && event.qualified === true) qualified.add(String(event.key));
  }

  const covered = new Set<string>();
  const playedKeyCounts = new Map<string, number>();
  for (const event of starts) {
    for (const key of (event.replyToKeys as string[] | undefined) ?? []) {
      covered.add(key);
      playedKeyCounts.set(key, (playedKeyCounts.get(key) ?? 0) + 1);
    }
  }
  // Only count coverage against events we actually admitted as qualified.
  const coveredQualified = [...covered].filter((key) => qualified.has(key));

  const droppedByReason: Record<string, number> = {};
  for (const drop of drops) {
    const reason = String(drop.reason);
    droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1;
  }

  let overlapCount = 0;
  const intervals = starts
    .map((start) => {
      const end = ends.find((candidate) => candidate.jobId === start.jobId);
      return end ? { from: start.sceneTime, to: end.sceneTime } : null;
    })
    .filter((interval): interval is { from: number; to: number } => interval !== null)
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i]!.from < intervals[i - 1]!.to) overlapCount += 1;
  }

  const duplicatePlaybacks = [...playedKeyCounts.values()].filter((count) => count > 1).length;

  const eventToModel: number[] = [];
  const modelRoundTrip: number[] = [];
  const validateAndTts: number[] = [];
  const eventToPlaybackStart: number[] = [];
  for (const start of starts) {
    const latency = start.latency as
      | { eventReceivedAt: number; modelSentAt: number; modelReturnedAt: number; audioReadyAt: number; playStartAt: number }
      | undefined;
    if (!latency) continue;
    eventToModel.push(latency.modelSentAt - latency.eventReceivedAt);
    modelRoundTrip.push(latency.modelReturnedAt - latency.modelSentAt);
    validateAndTts.push(latency.audioReadyAt - latency.modelReturnedAt);
    eventToPlaybackStart.push(latency.playStartAt - latency.eventReceivedAt);
  }

  let latePlaybackAfterStop = 0;
  for (const stop of stops) {
    const stopGeneration = Number(stop.sessionGeneration);
    for (const start of starts) {
      if (start.sceneTime >= stop.sceneTime && Number(start.sessionGeneration) < stopGeneration) {
        latePlaybackAfterStop += 1;
      }
    }
  }

  const gameCommentCount = starts.filter(
    (start) => start.reasonCode === 'game_event' || start.reasonCode === 'idle_comment',
  ).length;

  const lastEvent = events[events.length - 1];
  return {
    scenario: runStart ? String(runStart.scenario) : null,
    sceneTimeMs: lastEvent ? lastEvent.sceneTime : 0,
    wallTimeMs: lastEvent ? lastEvent.wallTime : 0,
    modelCalls: events.filter((event) => event.name === 'model_call').length,
    utterancesPlayed: starts.length,
    qualifiedEvents: qualified.size,
    coveredEvents: coveredQualified.length,
    coverageRate: qualified.size === 0 ? null : coveredQualified.length / qualified.size,
    gameCommentCount,
    duplicatePlaybacks,
    overlapCount,
    emergencyStops: stops.length,
    latePlaybackAfterStop,
    droppedByReason,
    latency: {
      eventToModel: summarize(eventToModel),
      modelRoundTrip: summarize(modelRoundTrip),
      validateAndTts: summarize(validateAndTts),
      eventToPlaybackStart: summarize(eventToPlaybackStart),
    },
  };
}

export function formatReport(report: ReplayReport): string {
  const lines: string[] = [];
  const ms = (value: number | null) => (value === null ? 'n/a' : `${value} ms`);
  lines.push(`scenario              ${report.scenario ?? 'n/a'}`);
  lines.push(`scene time            ${(report.sceneTimeMs / 1000).toFixed(1)} s  (mock clock)`);
  lines.push(`wall time             ${(report.wallTimeMs / 1000).toFixed(1)} s  (real)`);
  lines.push(`model calls           ${report.modelCalls}`);
  lines.push(`utterances played     ${report.utterancesPlayed}`);
  lines.push(`qualified events      ${report.qualifiedEvents}`);
  lines.push(`covered events        ${report.coveredEvents}`);
  lines.push(
    `coverage rate         ${report.coverageRate === null ? 'n/a' : `${(report.coverageRate * 100).toFixed(1)}%`}`,
  );
  lines.push(`game comments         ${report.gameCommentCount} (counted separately)`);
  lines.push(`duplicate playbacks   ${report.duplicatePlaybacks} (must be 0)`);
  lines.push(`overlapping playbacks ${report.overlapCount} (must be 0)`);
  lines.push(`emergency stops       ${report.emergencyStops}`);
  lines.push(`late playback @ stop  ${report.latePlaybackAfterStop} (must be 0)`);
  lines.push('drops by reason:');
  const reasons = Object.entries(report.droppedByReason).sort((a, b) => b[1] - a[1]);
  if (reasons.length === 0) lines.push('  (none)');
  for (const [reason, count] of reasons) lines.push(`  ${reason.padEnd(20)} ${count}`);
  lines.push('latency (scene time, mock providers, not real latency):');
  lines.push(`  t1 event -> model     median ${ms(report.latency.eventToModel.medianMs)}  p95 ${ms(report.latency.eventToModel.p95Ms)}`);
  lines.push(`  t2 model round trip   median ${ms(report.latency.modelRoundTrip.medianMs)}  p95 ${ms(report.latency.modelRoundTrip.p95Ms)}`);
  lines.push(`  t3 validate + tts     median ${ms(report.latency.validateAndTts.medianMs)}  p95 ${ms(report.latency.validateAndTts.p95Ms)}`);
  lines.push(
    `  total -> play start   median ${ms(report.latency.eventToPlaybackStart.medianMs)}  p95 ${ms(report.latency.eventToPlaybackStart.p95Ms)}  n=${report.latency.eventToPlaybackStart.samples}`,
  );
  return lines.join('\n');
}
