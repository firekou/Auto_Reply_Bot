/** JSONL event log. Holds ids, timings and drop reasons; never secrets. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type EventName =
  | 'run_start'
  | 'run_end'
  | 'chat_admitted'
  | 'candidate_set'
  | 'candidate_dropped'
  | 'model_call'
  | 'model_error'
  | 'decision'
  | 'tts_error'
  | 'playback_start'
  | 'playback_end'
  | 'state'
  | 'context_change'
  | 'emergency_stop'
  | 'budget_stop'
  | 'rate_capped'
  | 'source_health';

export interface LogEvent {
  seq: number;
  sceneTime: number;
  wallTime: number;
  name: EventName;
  [key: string]: unknown;
}

export class EventLog {
  private seq = 0;
  private readonly memory: LogEvent[] = [];
  private readonly startedWallTime = Date.now();

  constructor(private readonly filePath: string | null = null) {
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, '');
    }
  }

  write(name: EventName, sceneTime: number, payload: Record<string, unknown> = {}): LogEvent {
    const event: LogEvent = {
      seq: ++this.seq,
      sceneTime,
      wallTime: Date.now() - this.startedWallTime,
      name,
      ...payload,
    };
    this.memory.push(event);
    if (this.filePath) appendFileSync(this.filePath, `${JSON.stringify(event)}\n`);
    return event;
  }

  get events(): readonly LogEvent[] {
    return this.memory;
  }

  byName(name: EventName): LogEvent[] {
    return this.memory.filter((event) => event.name === name);
  }
}
