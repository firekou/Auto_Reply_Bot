/**
 * Human-readable transcript of a replay: what was read, what was selected,
 * what was said and when it was played on the mock clock.
 */
import type { LogEvent } from '../log/events.js';

function stamp(ms: number): string {
  const total = Math.floor(ms / 100) / 10;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

export function buildTranscript(events: readonly LogEvent[], limit = Number.POSITIVE_INFINITY): string {
  const lines: string[] = [];
  for (const event of events) {
    if (lines.length >= limit) break;
    const at = stamp(event.sceneTime);
    switch (event.name) {
      case 'chat_admitted':
        lines.push(`[${at}] read     ${event.qualified ? ' ' : 'x'} ${String(event.key)}${event.tag ? ` (${String(event.tag)})` : ''}`);
        break;
      case 'model_call':
        lines.push(`[${at}] ask        ${String(event.jobId)} on ${((event.keys as string[]) ?? []).join(', ') || '(no chat)'}`);
        break;
      case 'decision':
        if (event.kind === 'silence') lines.push(`[${at}] quiet      ${String(event.reason)}`);
        else if (event.kind === 'rejected') lines.push(`[${at}] dropped    ${String(event.reason)}`);
        break;
      case 'playback_start':
        lines.push(
          `[${at}] SAY        「${String(event.utterance)}」  -> ${((event.replyToKeys as string[]) ?? []).join(', ') || '(game comment)'} [${String(event.reasonCode)}, ${String(event.characters)} chars]`,
        );
        break;
      case 'playback_end':
        lines.push(`[${at}] played     ${String(event.durationMs)} ms${event.interrupted ? ' (interrupted)' : ''}`);
        break;
      case 'context_change':
        lines.push(`[${at}] SCENE      contextVersion=${String(event.contextVersion)} round=${String(event.round)}`);
        break;
      case 'emergency_stop':
        lines.push(`[${at}] ESTOP      silenced in ${String(event.silenceMs)} ms of scene time`);
        break;
      case 'budget_stop':
        lines.push(`[${at}] BUDGET     ${String(event.reason)}`);
        break;
      case 'model_error':
        lines.push(`[${at}] error      model ${String(event.kind)}`);
        break;
      case 'tts_error':
        lines.push(`[${at}] error      tts failed`);
        break;
      case 'source_health':
        if (event.state) lines.push(`[${at}] source     ${String(event.source)} ${String(event.state)}${event.reason ? `: ${String(event.reason)}` : ''}`);
        break;
      default:
        break;
    }
  }
  return lines.join('\n');
}
