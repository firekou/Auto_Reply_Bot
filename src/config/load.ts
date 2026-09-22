/**
 * Config loading and validation.
 *
 * Paid mode refuses to start without authorized limits and a versioned price
 * table: null means unconfigured, never "no limit" (R1 F4).
 */
import { readFileSync } from 'node:fs';

export interface RuntimeConfig {
  mode: 'mock' | 'real';
  capture: { frameIntervalMs: number; chatIntervalMs: number; maxImageLongEdge: number; maxImagesPerRequest: number };
  director: {
    minModelIntervalMs: number;
    gameEventTtlMs: number;
    chatTtlMs: number;
    recentSpokenCount: number;
    maxChatMessages: number;
    maxChatCharacters: number;
    maxReferenceCharacters: number;
    tickMs: number;
  };
  model: { provider: string; maxOutputTokens: number; maxCallsPerMinute: number; retriesPerEvent: number; timeoutMs: number };
  tts: { provider: string; voiceId: string | null; timeoutMs: number };
  speech: { minSentences: number; maxSentences: number; maxCharacters: number; targetMinCharacters: number };
  audio: { deviceId: string | null; exclusivePlayer: boolean; emergencyStopTargetMs: number };
  budget: {
    billingMode: 'unconfigured' | 'authorized';
    hourlyUsdLimit: number | null;
    sessionUsdLimit: number | null;
    priceTableVersion: string | null;
    inputUsdPerMillionTokens: number | null;
    outputUsdPerMillionTokens: number | null;
    ttsUsdPerMillionCharacters: number | null;
  };
  recovery: { consecutiveFailuresBeforePause: number; cooldownMs: number };
}

export class ConfigError extends Error {}

export const DEFAULT_CONFIG: RuntimeConfig = {
  mode: 'mock',
  capture: { frameIntervalMs: 2000, chatIntervalMs: 1000, maxImageLongEdge: 1280, maxImagesPerRequest: 2 },
  director: {
    minModelIntervalMs: 5000,
    gameEventTtlMs: 12000,
    chatTtlMs: 30000,
    recentSpokenCount: 10,
    maxChatMessages: 20,
    maxChatCharacters: 2000,
    maxReferenceCharacters: 4000,
    tickMs: 250,
  },
  model: { provider: 'mock', maxOutputTokens: 180, maxCallsPerMinute: 12, retriesPerEvent: 0, timeoutMs: 8000 },
  tts: { provider: 'mock', voiceId: null, timeoutMs: 5000 },
  speech: { minSentences: 1, maxSentences: 3, maxCharacters: 80, targetMinCharacters: 20 },
  audio: { deviceId: null, exclusivePlayer: true, emergencyStopTargetMs: 1000 },
  budget: {
    billingMode: 'unconfigured',
    hourlyUsdLimit: null,
    sessionUsdLimit: null,
    priceTableVersion: null,
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
    ttsUsdPerMillionCharacters: null,
  },
  recovery: { consecutiveFailuresBeforePause: 3, cooldownMs: 30000 },
};

function merge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (typeof base !== 'object' || Array.isArray(base)) return override as T;
  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (key in result) {
      result[key] = merge((base as Record<string, unknown>)[key], value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function validateConfig(config: RuntimeConfig): RuntimeConfig {
  if (config.mode !== 'mock' && config.mode !== 'real') {
    throw new ConfigError(`unknown mode ${config.mode}`);
  }
  if (config.speech.maxSentences < 1) throw new ConfigError('speech.maxSentences must be at least 1');
  if (config.speech.maxCharacters < 1) throw new ConfigError('speech.maxCharacters must be at least 1');
  if (config.model.retriesPerEvent !== 0) {
    throw new ConfigError('model.retriesPerEvent must be 0: an event is never retried');
  }

  const paid = config.budget.billingMode === 'authorized';
  if (paid) {
    if (config.budget.hourlyUsdLimit === null || config.budget.sessionUsdLimit === null) {
      throw new ConfigError('paid mode requires authorized hourly and session USD limits; null is not "no limit"');
    }
    if (config.budget.priceTableVersion === null) {
      throw new ConfigError('paid mode requires a versioned price table');
    }
  }

  if (config.mode === 'real') {
    if (!paid) throw new ConfigError('real mode requires an authorized budget');
    if (config.audio.deviceId === null) {
      throw new ConfigError('real mode requires an explicit audio.deviceId; null means unset, not system default');
    }
    if (config.model.provider === 'mock' || config.tts.provider === 'mock') {
      throw new ConfigError('real mode cannot run on mock providers');
    }
  }
  return config;
}

export function loadConfig(path?: string): RuntimeConfig {
  if (!path) return validateConfig(DEFAULT_CONFIG);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`cannot read config at ${path}: ${(error as Error).message}`);
  }
  return validateConfig(merge(DEFAULT_CONFIG, parsed));
}
