/**
 * Control channel.
 *
 * P1 choice (IMPLEMENTATION_DESIGN 1.1.1, review R1 F6): a stdin channel in
 * the same process as the scheduler. There is no resident service and no
 * local IPC yet, so this is the whole control surface. A scripted channel is
 * used by replay so an emergency stop can be injected deterministically.
 */

export type ControlCommand = 'pause' | 'resume' | 'stop' | 'estop' | 'status';

export interface ControlHandler {
  (command: ControlCommand): void | Promise<void>;
}

export const CONTROL_COMMANDS: readonly ControlCommand[] = ['pause', 'resume', 'stop', 'estop', 'status'];

export function parseCommand(line: string): ControlCommand | null {
  const normalized = line.trim().toLowerCase();
  return (CONTROL_COMMANDS as readonly string[]).includes(normalized) ? (normalized as ControlCommand) : null;
}

/** Reads commands from stdin lines. Returns a detach function. */
export function attachStdin(handler: ControlHandler): () => void {
  const onData = (chunk: Buffer | string) => {
    for (const line of chunk.toString().split('\n')) {
      const command = parseCommand(line);
      if (command) void handler(command);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  process.stdin.resume();
  return () => {
    process.stdin.off('data', onData);
    process.stdin.pause();
  };
}

/** Scene-time scripted control, used by replay and tests. */
export class ScriptedControl {
  private readonly pending: Array<{ at: number; command: ControlCommand }>;

  constructor(entries: Array<{ at: number; command: ControlCommand }>) {
    this.pending = [...entries].sort((a, b) => a.at - b.at);
  }

  due(now: number): ControlCommand[] {
    const commands: ControlCommand[] = [];
    while (this.pending.length > 0 && this.pending[0]!.at <= now) {
      commands.push(this.pending.shift()!.command);
    }
    return commands;
  }

  get remaining(): number {
    return this.pending.length;
  }
}
