/**
 * State machine and the (jobId, sessionGeneration, contextVersion) guard.
 *
 * Review R1 F2: an async completion path may only write state if its own
 * triple is still current. Otherwise a late `finally` from a cancelled job can
 * overwrite a manual PAUSED or STOPPED back to IDLE.
 */

export type HostState =
  | 'STOPPED'
  | 'IDLE'
  | 'GENERATING'
  | 'SYNTHESIZING'
  | 'PLAYING'
  | 'PAUSED'
  | 'ERROR';

const ALLOWED: Record<HostState, readonly HostState[]> = {
  STOPPED: ['IDLE'],
  IDLE: ['GENERATING', 'PAUSED', 'ERROR', 'STOPPED'],
  GENERATING: ['SYNTHESIZING', 'IDLE', 'PAUSED', 'ERROR', 'STOPPED'],
  SYNTHESIZING: ['PLAYING', 'IDLE', 'PAUSED', 'ERROR', 'STOPPED'],
  PLAYING: ['IDLE', 'PAUSED', 'ERROR', 'STOPPED'],
  PAUSED: ['IDLE', 'STOPPED', 'ERROR'],
  ERROR: ['IDLE', 'STOPPED'],
};

export class IllegalTransitionError extends Error {
  constructor(from: HostState, to: HostState) {
    super(`illegal transition ${from} -> ${to}`);
  }
}

export interface JobToken {
  jobId: string;
  sessionGeneration: number;
  contextVersion: number;
}

export class Director {
  private state: HostState = 'STOPPED';
  private generation = 0;
  private context = 0;
  private jobCounter = 0;
  private activeJobId: string | null = null;
  readonly illegalTransitions: Array<{ from: HostState; to: HostState }> = [];

  get current(): HostState {
    return this.state;
  }

  get sessionGeneration(): number {
    return this.generation;
  }

  get contextVersion(): number {
    return this.context;
  }

  get currentJobId(): string | null {
    return this.activeJobId;
  }

  transition(to: HostState): void {
    const allowed = ALLOWED[this.state];
    if (this.state === to) return;
    if (!allowed.includes(to)) {
      this.illegalTransitions.push({ from: this.state, to });
      throw new IllegalTransitionError(this.state, to);
    }
    this.state = to;
  }

  /** Human control and connection events: cancels everything in flight. */
  bumpGeneration(): number {
    this.generation += 1;
    this.activeJobId = null;
    return this.generation;
  }

  /**
   * Explicit scene change only. Never inferred from a frame hash (R1 F2):
   * an identical hash may just be a static scene, and a changed one may just
   * be an animation.
   */
  bumpContextVersion(): number {
    this.context += 1;
    this.activeJobId = null;
    return this.context;
  }

  beginJob(): JobToken {
    const token: JobToken = {
      jobId: `job_${++this.jobCounter}`,
      sessionGeneration: this.generation,
      contextVersion: this.context,
    };
    this.activeJobId = token.jobId;
    return token;
  }

  endJob(token: JobToken): void {
    if (this.activeJobId === token.jobId) this.activeJobId = null;
  }

  isCurrent(token: JobToken): boolean {
    return (
      this.activeJobId === token.jobId &&
      token.sessionGeneration === this.generation &&
      token.contextVersion === this.context
    );
  }

  /**
   * The only way an async completion path may write state. Returns false when
   * the caller is stale, in which case the caller must not touch the machine.
   */
  transitionIfCurrent(token: JobToken, to: HostState): boolean {
    if (!this.isCurrent(token)) return false;
    this.transition(to);
    return true;
  }
}
