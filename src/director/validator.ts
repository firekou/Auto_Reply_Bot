/**
 * Local validator.
 *
 * Structured outputs cannot express length or sentence constraints (see
 * IMPLEMENTATION_DESIGN 3.3), so every content rule is enforced here. The
 * order matters and is fixed by review R1 F1:
 *
 *   1. common fields (schema, observation id, job/generation/context)
 *   2. branch on `speak`
 *   3. utterance rules, for speaking replies only
 *
 * Applying utterance rules to a silence reply would turn "correctly chose to
 * stay quiet" into a validation error.
 */

import { REASON_CODES, type RawDecision, type ReasonCode } from '../types.js';

export type ValidationReason =
  | 'schema'
  | 'stale_observation'
  | 'cancelled'
  | 'invalid_silence'
  | 'empty_utterance'
  | 'unknown_chat_id'
  | 'sentence_count'
  | 'length'
  | 'format'
  | 'duplicate'
  | 'expired';

export interface ValidationContext {
  observationId: string;
  offeredChatKeys: Set<string>;
  recentSpoken: readonly string[];
  maxSentences: number;
  maxCharacters: number;
  jobId: string;
  sessionGeneration: number;
  contextVersion: number;
  currentJobId: string;
  currentSessionGeneration: number;
  currentContextVersion: number;
}

export interface SilenceOutcome {
  kind: 'silence';
  reasonCode: ReasonCode;
}

export interface SpeechOutcome {
  kind: 'speech';
  utterance: string;
  replyToKeys: string[];
  reasonCode: ReasonCode;
  characterCount: number;
  sentenceCount: number;
}

export interface RejectedOutcome {
  kind: 'rejected';
  reason: ValidationReason;
  detail: string;
}

export type ValidationOutcome = SilenceOutcome | SpeechOutcome | RejectedOutcome;

/** Unicode code points, not UTF-16 units, after whitespace normalization. */
export function normalizeUtterance(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function countCharacters(text: string): number {
  return [...normalizeUtterance(text)].length;
}

export function countSentences(text: string): number {
  const normalized = normalizeUtterance(text);
  if (normalized.length === 0) return 0;
  const parts = normalized
    .split(/[。．.！!？?\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return Math.max(1, parts.length);
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /```/, label: 'code fence' },
  { pattern: /^\s*[-*+]\s/m, label: 'bullet list' },
  { pattern: /^\s*#{1,6}\s/m, label: 'markdown heading' },
  { pattern: /\*\*/, label: 'bold marker' },
  { pattern: /—|--/, label: 'em dash' },
];

function reject(reason: ValidationReason, detail: string): RejectedOutcome {
  return { kind: 'rejected', reason, detail };
}

export function validateDecision(raw: RawDecision, context: ValidationContext): ValidationOutcome {
  // --- stage 1: common fields -------------------------------------------
  if (typeof raw.speak !== 'boolean') return reject('schema', 'speak is not a boolean');
  if (typeof raw.utterance !== 'string') return reject('schema', 'utterance is not a string');
  if (!Array.isArray(raw.reply_to_ids) || raw.reply_to_ids.some((id) => typeof id !== 'string')) {
    return reject('schema', 'reply_to_ids is not a string array');
  }
  if (typeof raw.observation_id !== 'string') return reject('schema', 'observation_id is not a string');
  if (typeof raw.reason_code !== 'string' || !REASON_CODES.includes(raw.reason_code as ReasonCode)) {
    return reject('schema', `reason_code is not one of ${REASON_CODES.join(', ')}`);
  }

  if (raw.observation_id !== context.observationId) {
    return reject('stale_observation', `expected ${context.observationId}, got ${raw.observation_id}`);
  }

  if (
    context.jobId !== context.currentJobId ||
    context.sessionGeneration !== context.currentSessionGeneration ||
    context.contextVersion !== context.currentContextVersion
  ) {
    return reject(
      'cancelled',
      `job ${context.jobId}/gen ${context.sessionGeneration}/ctx ${context.contextVersion} is no longer current`,
    );
  }

  const replyToIds = raw.reply_to_ids as string[];
  const reasonCode = raw.reason_code as ReasonCode;
  const utterance = raw.utterance;

  // --- stage 2: branch on speak -----------------------------------------
  if (!raw.speak) {
    if (normalizeUtterance(utterance).length > 0 || replyToIds.length > 0) {
      return reject('invalid_silence', 'speak=false must carry an empty utterance and no reply ids');
    }
    return { kind: 'silence', reasonCode };
  }

  // --- stage 3: utterance rules -----------------------------------------
  const normalized = normalizeUtterance(utterance);
  if (normalized.length === 0) return reject('empty_utterance', 'speak=true with an empty utterance');

  for (const id of replyToIds) {
    if (!context.offeredChatKeys.has(id)) {
      return reject('unknown_chat_id', `${id} was not offered this round`);
    }
  }

  const sentenceCount = countSentences(normalized);
  if (sentenceCount < 1 || sentenceCount > context.maxSentences) {
    return reject('sentence_count', `${sentenceCount} sentences, max ${context.maxSentences}`);
  }

  // Upper bound is hard. There is deliberately no lower bound: "漂亮！" is a
  // valid reaction and target_min_characters is a tuning target only (R1 F1).
  const characterCount = [...normalized].length;
  if (characterCount > context.maxCharacters) {
    return reject('length', `${characterCount} characters, max ${context.maxCharacters}`);
  }

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return reject('format', `contains ${label}`);
  }

  if (context.recentSpoken.some((spoken) => normalizeUtterance(spoken) === normalized)) {
    return reject('duplicate', 'identical to a recently spoken utterance');
  }

  return {
    kind: 'speech',
    utterance: normalized,
    replyToKeys: replyToIds,
    reasonCode,
    characterCount,
    sentenceCount,
  };
}
