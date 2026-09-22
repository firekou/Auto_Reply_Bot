/**
 * Core types for the Auto Reply Bot host runtime.
 *
 * Everything here is mock-facing at this stage. No real capture, model, TTS or
 * audio device is touched by any code in this repository yet.
 */

export type SourceState = 'ok' | 'degraded' | 'offline';

export interface SourceHealth {
  state: SourceState;
  lastOkAt: number | null;
  consecutiveFailures: number;
  reason: string | null;
}

export interface Frame {
  frameRef: string;
  bytes: Buffer;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  frameHash: string;
  capturedAt: number;
}

export type IdStability = 'stable' | 'synthetic';

export interface ChatMessage {
  messageId: string;
  idStability: IdStability;
  source: string;
  text: string;
  author?: string;
  receivedAt: number;
  sourceTime?: number;
  confidence?: number;
  /** Fixture-only tag used to script deterministic mock model behaviour. */
  tag?: string;
}

/** Dedupe key. Review R1 F3: the key is source + messageId, never messageId alone. */
export function chatKey(message: Pick<ChatMessage, 'source' | 'messageId'>): string {
  return `${message.source}::${message.messageId}`;
}

export interface Observation {
  observationId: string;
  sequence: number;
  capturedAt: number;
  receivedAt: number;
  frameRef: string | null;
  frameHash: string | null;
  chatIds: string[];
  sourceHealth: { capture: SourceHealth; chat: SourceHealth };
  sessionGeneration: number;
  contextVersion: number;
}

export type ReasonCode =
  | 'chat_reply'
  | 'game_event'
  | 'idle_comment'
  | 'no_new_information'
  | 'uncertain'
  | 'unsafe_input';

export const REASON_CODES: readonly ReasonCode[] = [
  'chat_reply',
  'game_event',
  'idle_comment',
  'no_new_information',
  'uncertain',
  'unsafe_input',
];

/** Raw, still-untrusted model output. Never played before the validator accepts it. */
export interface RawDecision {
  speak: unknown;
  utterance: unknown;
  reply_to_ids: unknown;
  observation_id: unknown;
  reason_code: unknown;
}

export interface Persona {
  personaId: string;
  personaVersion: string;
  language: string;
  personality: string[];
  speakingStyle: string;
  catchphrases: string[];
  avoidPhrases: string[];
  voiceId: string | null;
}

export interface ReferenceExcerpt {
  id: string;
  version: string;
  source: string;
  text: string;
}

/**
 * What the model provider is given for one round. Persona and reference data
 * travel in their own fields; untrusted chat never shares a field with system
 * rules (ARB-002 prompt item 3).
 */
export interface DecisionInput {
  observation: Observation;
  persona: Persona;
  referenceExcerpts: ReferenceExcerpt[];
  untrustedChatMessages: ChatMessage[];
  recentSpokenUtterances: string[];
  frame: Frame | null;
  directorConstraints: {
    maxSentences: number;
    maxCharacters: number;
    targetMinCharacters: number;
  };
  jobId: string;
  sessionGeneration: number;
  contextVersion: number;
}

export interface ProviderUsage {
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  characters: number | null;
  /** UNKNOWN rather than 0 when the provider has no per-call rate. */
  costUsd: number | 'UNKNOWN';
}

export interface TtsRequest {
  text: string;
  voiceId: string;
  rate?: number;
}

export interface TtsResult {
  audio: Buffer;
  mediaType: 'audio/wav' | 'audio/mpeg';
  durationMs: number;
}

export interface PlaybackRecord {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  interrupted: boolean;
}

export interface CaptureAdapter {
  readonly id: string;
  start(signal: AbortSignal): Promise<void>;
  grab(signal: AbortSignal): Promise<Frame>;
  health(): SourceHealth;
  stop(): Promise<void>;
}

export interface ChatAdapter {
  readonly id: string;
  readonly kind: 'api' | 'dom' | 'ocr' | 'mock';
  start(signal: AbortSignal): Promise<void>;
  poll(signal: AbortSignal): Promise<ChatMessage[]>;
  health(): SourceHealth;
  stop(): Promise<void>;
}

export interface ModelProvider {
  readonly id: string;
  decide(input: DecisionInput, signal: AbortSignal): Promise<RawDecision>;
  usage(): ProviderUsage;
}

export interface TtsProvider {
  readonly id: string;
  synthesize(request: TtsRequest, signal: AbortSignal): Promise<TtsResult>;
  usage(): ProviderUsage;
}

export interface AudioPlayer {
  open(deviceId: string | null): Promise<void>;
  play(audio: Buffer, mediaType: string, durationMs: number, signal: AbortSignal): Promise<PlaybackRecord>;
  stopNow(): Promise<void>;
  isPlaying(): boolean;
}

export class CaptureError extends Error {}
export class ChatError extends Error {}
export class DeviceError extends Error {}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'rate_limit' | 'spend_limit' | 'server' | 'malformed',
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
