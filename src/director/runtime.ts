/**
 * Host runtime: the serial mock loop.
 *
 * Shape fixed by review R1 F3: capture keeps running during playback, but at
 * most one *candidate observation* is held, and generation only starts from
 * IDLE. There is no pending-utterance queue.
 */

import { isAbortError, type Clock } from '../clock.js';
import { Deduper } from '../context/deduper.js';
import { BudgetExceededError, BudgetGuard, visualTokens, type Reservation } from './budget.js';
import { Director, type JobToken } from './state.js';
import { validateDecision, countCharacters } from './validator.js';
import type { EventLog } from '../log/events.js';
import type { RuntimeConfig } from '../config/load.js';
import type { Scenario, TimelineEvent } from '../fixtures/scenario.js';
import {
  ProviderError,
  chatKey,
  type AudioPlayer,
  type CaptureAdapter,
  type ChatAdapter,
  type ChatMessage,
  type DecisionInput,
  type Frame,
  type ModelProvider,
  type Observation,
  type Persona,
  type ReferenceExcerpt,
  type TtsProvider,
} from '../types.js';

export interface CandidateSlot {
  kind: 'chat' | 'context';
  messages: ChatMessage[];
  createdAt: number;
  contextVersion: number;
}

export interface RuntimeDeps {
  scenario: Scenario;
  config: RuntimeConfig;
  clock: Clock;
  capture: CaptureAdapter;
  chat: ChatAdapter;
  model: ModelProvider;
  tts: TtsProvider;
  player: AudioPlayer;
  log: EventLog;
  persona: Persona;
  references: ReferenceExcerpt[];
}

export interface RuntimeStats {
  modelCalls: number;
  concurrentModelCallsMax: number;
  concurrentPlaybacksMax: number;
  candidateSlotMax: number;
  emergencyStops: number;
  latePlaybacksAfterStop: number;
  qualifiedChatKeys: Set<string>;
  coveredChatKeys: Set<string>;
  gameComments: number;
  drops: Map<string, number>;
  playedUtterances: number;
  budgetStops: number;
}

const SILENCE_REASONS = new Set(['no_new_information', 'unsafe_input', 'uncertain']);

export class HostRuntime {
  readonly director = new Director();
  readonly deduper = new Deduper();
  readonly budget: BudgetGuard;
  readonly stats: RuntimeStats = {
    modelCalls: 0,
    concurrentModelCallsMax: 0,
    concurrentPlaybacksMax: 0,
    candidateSlotMax: 0,
    emergencyStops: 0,
    latePlaybacksAfterStop: 0,
    qualifiedChatKeys: new Set(),
    coveredChatKeys: new Set(),
    gameComments: 0,
    drops: new Map(),
    playedUtterances: 0,
    budgetStops: 0,
  };

  private candidate: CandidateSlot | null = null;
  private lastFrame: Frame | null = null;
  private recentSpoken: string[] = [];
  private sequence = 0;
  private lastModelCallAt = Number.NEGATIVE_INFINITY;
  private callTimestamps: number[] = [];
  private cooldownUntil = 0;
  private consecutiveFailures = 0;
  private paidCallsStopped = false;
  private inFlightModelCalls = 0;
  private activePlaybacks = 0;
  private runController = new AbortController();
  private jobController: AbortController | null = null;
  private appliedTimelineEvents = new Set<TimelineEvent>();
  private stopped = false;
  private paused = false;

  constructor(private readonly deps: RuntimeDeps) {
    const { budget } = deps.config;
    this.budget = new BudgetGuard(
      { hourlyUsdLimit: budget.hourlyUsdLimit, sessionUsdLimit: budget.sessionUsdLimit },
      {
        version: budget.priceTableVersion,
        inputUsdPerMillionTokens: budget.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: budget.outputUsdPerMillionTokens,
        ttsUsdPerMillionCharacters: budget.ttsUsdPerMillionCharacters,
      },
      budget.billingMode === 'authorized',
    );
  }

  private get now(): number {
    return this.deps.clock.now();
  }

  private drop(reason: string, payload: Record<string, unknown> = {}): void {
    this.stats.drops.set(reason, (this.stats.drops.get(reason) ?? 0) + 1);
    this.deps.log.write('candidate_dropped', this.now, { reason, ...payload });
  }

  /** Mechanical eligibility only. No judgement about meaning (R1 F3). */
  private isQualified(message: ChatMessage): boolean {
    const text = message.text.trim();
    if (text.length === 0) return false;
    if ([...text].length > 200) return false;
    if (this.deduper.hasSpoken(chatKey(message))) return false;
    return true;
  }

  async start(): Promise<void> {
    await this.deps.capture.start(this.runController.signal);
    await this.deps.chat.start(this.runController.signal);
    await this.deps.player.open(this.deps.config.audio.deviceId);
    this.director.transition('IDLE');
    this.deps.log.write('run_start', this.now, {
      mode: this.deps.config.mode,
      scenario: this.deps.scenario.name,
      seed: this.deps.scenario.seed,
    });
  }

  /** Runs capture, chat and scheduler loops until `untilSceneTime`. */
  async run(untilSceneTime: number): Promise<void> {
    const loops = [this.captureLoop(untilSceneTime), this.chatLoop(untilSceneTime), this.schedulerLoop(untilSceneTime)];
    await Promise.all(loops);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.runController.abort();
    this.deps.log.write('run_end', this.now, {
      modelCalls: this.stats.modelCalls,
      played: this.stats.playedUtterances,
      state: this.director.current,
    });
  }

  // ---------------------------------------------------------------- loops

  private async captureLoop(untilSceneTime: number): Promise<void> {
    const interval = this.deps.config.capture.frameIntervalMs;
    while (!this.stopped && this.now < untilSceneTime) {
      try {
        await this.deps.clock.sleep(interval, this.runController.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        throw error;
      }
      if (this.stopped || this.now >= untilSceneTime) return;
      this.applyTimeline();
      try {
        const frame = await this.deps.capture.grab(this.runController.signal);
        this.lastFrame = frame;
      } catch (error) {
        if (isAbortError(error)) return;
        this.deps.log.write('source_health', this.now, { source: 'capture', error: (error as Error).message });
      }
      const health = this.deps.capture.health();
      if (health.state !== 'ok') {
        this.deps.log.write('source_health', this.now, { source: 'capture', state: health.state, reason: health.reason });
      }
    }
  }

  private async chatLoop(untilSceneTime: number): Promise<void> {
    const interval = this.deps.config.capture.chatIntervalMs;
    while (!this.stopped && this.now < untilSceneTime) {
      try {
        await this.deps.clock.sleep(interval, this.runController.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        throw error;
      }
      if (this.stopped || this.now >= untilSceneTime) return;
      let batch: ChatMessage[] = [];
      try {
        batch = await this.deps.chat.poll(this.runController.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        this.deps.log.write('source_health', this.now, { source: 'chat', error: (error as Error).message });
        continue;
      }
      const fresh = this.deduper.admit(batch);
      const qualified: ChatMessage[] = [];
      for (const message of fresh) {
        const ok = this.isQualified(message);
        this.deps.log.write('chat_admitted', this.now, { key: chatKey(message), qualified: ok, tag: message.tag });
        if (ok) {
          qualified.push(message);
          this.stats.qualifiedChatKeys.add(chatKey(message));
        }
      }
      if (qualified.length > 0) this.setCandidate({ kind: 'chat', messages: qualified, createdAt: this.now, contextVersion: this.director.contextVersion });
    }
  }

  /** Candidate slot: at most one entry, newest relevant event wins. */
  private setCandidate(slot: CandidateSlot): void {
    // Merging into the one slot is not a drop: nothing is discarded unless the
    // slot overflows its message cap, which is reported separately.
    let overflow = 0;
    if (this.candidate) {
      const merged = [...this.candidate.messages, ...slot.messages];
      const limit = this.deps.config.director.maxChatMessages;
      overflow = Math.max(0, merged.length - limit);
      this.candidate = { ...slot, messages: merged.slice(-limit) };
      if (overflow > 0) this.drop('candidate_overflow', { overflow });
    } else {
      this.candidate = slot;
    }
    this.stats.candidateSlotMax = Math.max(this.stats.candidateSlotMax, 1);
    this.deps.log.write('candidate_set', this.now, {
      kind: slot.kind,
      merged: overflow >= 0 && this.candidate.messages.length > slot.messages.length,
      keys: this.candidate.messages.map(chatKey),
      contextVersion: slot.contextVersion,
    });
  }

  private applyTimeline(): void {
    for (const event of this.deps.scenario.timeline) {
      if (this.appliedTimelineEvents.has(event)) continue;
      if (event.at > this.now) continue;
      this.appliedTimelineEvents.add(event);
      if (event.kind === 'scene_change') {
        const version = this.director.bumpContextVersion();
        if (this.candidate) {
          this.drop('context_changed', { keys: this.candidate.messages.map(chatKey) });
          this.candidate = null;
        }
        this.deps.log.write('context_change', this.now, { contextVersion: version, round: event.round });
      }
    }
  }

  private async schedulerLoop(untilSceneTime: number): Promise<void> {
    const tick = this.deps.config.director.tickMs;
    while (!this.stopped && this.now < untilSceneTime) {
      try {
        await this.deps.clock.sleep(tick, this.runController.signal);
      } catch (error) {
        if (isAbortError(error)) return;
        throw error;
      }
      if (this.stopped || this.now >= untilSceneTime) return;
      this.applyTimeline();
      await this.maybeRunRound();
    }
  }

  private throttleOk(): boolean {
    const now = this.now;
    if (now < this.cooldownUntil) return false;
    if (now - this.lastModelCallAt < this.deps.config.director.minModelIntervalMs) return false;
    this.callTimestamps = this.callTimestamps.filter((at) => now - at < 60_000);
    if (this.callTimestamps.length >= this.deps.config.model.maxCallsPerMinute) {
      this.deps.log.write('rate_capped', now, { callsInWindow: this.callTimestamps.length });
      return false;
    }
    return true;
  }

  private async maybeRunRound(): Promise<void> {
    if (this.paused || this.stopped) return;
    if (this.director.current !== 'IDLE') return;
    if (this.paidCallsStopped) return;
    if (!this.candidate) return;
    if (!this.throttleOk()) return;

    const slot = this.candidate;
    this.candidate = null;

    if (slot.contextVersion !== this.director.contextVersion) {
      this.drop('context_changed', { keys: slot.messages.map(chatKey) });
      return;
    }
    const ttl = slot.kind === 'chat' ? this.deps.config.director.chatTtlMs : this.deps.config.director.gameEventTtlMs;
    const freshest = Math.max(...slot.messages.map((m) => m.receivedAt), slot.createdAt);
    if (this.now - freshest > ttl) {
      this.drop('expired', { keys: slot.messages.map(chatKey), ageMs: this.now - freshest });
      return;
    }

    await this.runRound(slot);
  }

  // ---------------------------------------------------------------- round

  private async runRound(slot: CandidateSlot): Promise<void> {
    const token = this.director.beginJob();
    this.director.transition('GENERATING');
    const controller = new AbortController();
    this.jobController = controller;

    const observation: Observation = {
      observationId: `obs_${++this.sequence}_${token.jobId}`,
      sequence: this.sequence,
      capturedAt: this.lastFrame?.capturedAt ?? this.now,
      receivedAt: this.now,
      frameRef: this.lastFrame?.frameRef ?? null,
      frameHash: this.lastFrame?.frameHash ?? null,
      chatIds: slot.messages.map(chatKey),
      sourceHealth: { capture: this.deps.capture.health(), chat: this.deps.chat.health() },
      sessionGeneration: token.sessionGeneration,
      contextVersion: token.contextVersion,
    };

    const input: DecisionInput = {
      observation,
      persona: this.deps.persona,
      referenceExcerpts: this.deps.references,
      untrustedChatMessages: slot.messages,
      recentSpokenUtterances: [...this.recentSpoken],
      frame: this.lastFrame,
      directorConstraints: {
        maxSentences: this.deps.config.speech.maxSentences,
        maxCharacters: this.deps.config.speech.maxCharacters,
        targetMinCharacters: this.deps.config.speech.targetMinCharacters,
      },
      jobId: token.jobId,
      sessionGeneration: token.sessionGeneration,
      contextVersion: token.contextVersion,
    };

    const eventReceivedAt = Math.min(...slot.messages.map((m) => m.receivedAt), slot.createdAt);
    const modelSentAt = this.now;

    let reservation: Reservation | null = null;
    try {
      reservation = this.reserveModelCall(input);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        this.stats.budgetStops += 1;
        this.paidCallsStopped = true;
        this.deps.log.write('budget_stop', this.now, { reason: error.message });
        this.finishJob(token, 'IDLE');
        return;
      }
      throw error;
    }

    this.lastModelCallAt = modelSentAt;
    this.callTimestamps.push(modelSentAt);
    this.stats.modelCalls += 1;
    this.inFlightModelCalls += 1;
    this.stats.concurrentModelCallsMax = Math.max(this.stats.concurrentModelCallsMax, this.inFlightModelCalls);
    this.deps.log.write('model_call', modelSentAt, {
      jobId: token.jobId,
      observationId: observation.observationId,
      keys: observation.chatIds,
      reservedUsd: reservation?.amountUsd ?? null,
    });

    let raw;
    try {
      raw = await this.deps.model.decide(input, controller.signal);
      if (reservation) this.budget.settle(reservation, this.actualModelCostUsd());
    } catch (error) {
      // A timed-out call may still have been billed: the reservation is held,
      // not released (R1 F4).
      if (reservation) {
        this.budget.hold(reservation, error instanceof ProviderError && error.kind === 'timeout' ? 'timeout' : 'error');
      }
      this.handleModelError(error, token);
      return;
    } finally {
      this.inFlightModelCalls -= 1;
    }

    // Every completion path re-checks its own triple before touching state.
    if (!this.director.isCurrent(token)) {
      this.drop('cancelled', { jobId: token.jobId, stage: 'after_model' });
      return;
    }

    const modelReturnedAt = this.now;
    const outcome = validateDecision(raw, {
      observationId: observation.observationId,
      offeredChatKeys: new Set(observation.chatIds),
      recentSpoken: this.recentSpoken,
      maxSentences: this.deps.config.speech.maxSentences,
      maxCharacters: this.deps.config.speech.maxCharacters,
      jobId: token.jobId,
      sessionGeneration: token.sessionGeneration,
      contextVersion: token.contextVersion,
      currentJobId: this.director.currentJobId ?? '',
      currentSessionGeneration: this.director.sessionGeneration,
      currentContextVersion: this.director.contextVersion,
    });

    this.deps.log.write('decision', modelReturnedAt, {
      jobId: token.jobId,
      kind: outcome.kind,
      reason: outcome.kind === 'rejected' ? outcome.reason : outcome.reasonCode,
    });

    if (outcome.kind === 'silence') {
      // Legal silence: no TTS, not a provider failure (R1 F1).
      this.consecutiveFailures = 0;
      if (SILENCE_REASONS.has(outcome.reasonCode)) this.deduper.markSelected(observation.chatIds);
      this.finishJob(token, 'IDLE');
      return;
    }
    if (outcome.kind === 'rejected') {
      this.drop(outcome.reason, { jobId: token.jobId, detail: outcome.detail });
      this.finishJob(token, 'IDLE');
      return;
    }

    this.deduper.markSelected(outcome.replyToKeys);
    if (!this.director.transitionIfCurrent(token, 'SYNTHESIZING')) {
      this.drop('cancelled', { jobId: token.jobId, stage: 'before_tts' });
      return;
    }

    let audio;
    const ttsReservation = this.tryReserveTts(outcome.utterance);
    try {
      audio = await this.deps.tts.synthesize(
        { text: outcome.utterance, voiceId: this.deps.config.tts.voiceId ?? 'mock_voice' },
        controller.signal,
      );
      if (ttsReservation) this.budget.settle(ttsReservation, 0);
    } catch (error) {
      if (ttsReservation) this.budget.hold(ttsReservation, 'error');
      if (!isAbortError(error)) {
        this.consecutiveFailures += 1;
        this.deps.log.write('tts_error', this.now, { jobId: token.jobId, error: (error as Error).message });
        this.applyFailurePolicy();
      }
      this.finishJob(token, 'IDLE');
      return;
    }

    const audioReadyAt = this.now;
    if (!this.director.transitionIfCurrent(token, 'PLAYING')) {
      this.drop('cancelled', { jobId: token.jobId, stage: 'before_play' });
      return;
    }

    // spoken is recorded at actual playback start, not at selection (R1 F3).
    this.deduper.markSpoken(outcome.replyToKeys);
    for (const key of outcome.replyToKeys) this.stats.coveredChatKeys.add(key);
    if (outcome.reasonCode === 'game_event' || outcome.reasonCode === 'idle_comment') this.stats.gameComments += 1;

    this.recentSpoken = [...this.recentSpoken, outcome.utterance].slice(-this.deps.config.director.recentSpokenCount);
    this.activePlaybacks += 1;
    this.stats.concurrentPlaybacksMax = Math.max(this.stats.concurrentPlaybacksMax, this.activePlaybacks);
    this.stats.playedUtterances += 1;
    const generationAtPlay = this.director.sessionGeneration;

    this.deps.log.write('playback_start', audioReadyAt, {
      jobId: token.jobId,
      observationId: observation.observationId,
      utterance: outcome.utterance,
      replyToKeys: outcome.replyToKeys,
      reasonCode: outcome.reasonCode,
      characters: outcome.characterCount,
      sentences: outcome.sentenceCount,
      latency: {
        eventReceivedAt,
        modelSentAt,
        modelReturnedAt,
        audioReadyAt,
        playStartAt: audioReadyAt,
        totalMs: audioReadyAt - eventReceivedAt,
      },
      sessionGeneration: generationAtPlay,
    });

    try {
      const record = await this.deps.player.play(audio.audio, audio.mediaType, audio.durationMs, controller.signal);
      this.deps.log.write('playback_end', this.now, { jobId: token.jobId, ...record });
    } finally {
      this.activePlaybacks -= 1;
    }

    this.consecutiveFailures = 0;
    this.finishJob(token, 'IDLE');
  }

  private reserveModelCall(input: DecisionInput): Reservation | null {
    if (this.deps.config.budget.billingMode !== 'authorized') return null;
    const frame = input.frame;
    const imageTokens = frame ? visualTokens(frame.width, frame.height) : 0;
    const textTokens =
      500 +
      input.untrustedChatMessages.reduce((sum, m) => sum + [...m.text].length, 0) +
      input.referenceExcerpts.reduce((sum, r) => sum + [...r.text].length, 0);
    const amount = this.budget.modelReservationUsd({
      textInputTokens: textTokens,
      imageTokens,
      structuredOutputOverheadTokens: 250,
      maxOutputTokens: this.deps.config.model.maxOutputTokens,
    });
    return this.budget.reserve(amount);
  }

  private tryReserveTts(text: string): Reservation | null {
    if (this.deps.config.budget.billingMode !== 'authorized') return null;
    return this.budget.reserve(this.budget.ttsReservationUsd({ characters: countCharacters(text) }));
  }

  private actualModelCostUsd(): number {
    if (this.deps.config.budget.billingMode !== 'authorized') return 0;
    const inputRate = this.deps.config.budget.inputUsdPerMillionTokens ?? 0;
    const outputRate = this.deps.config.budget.outputUsdPerMillionTokens ?? 0;
    return (2200 * inputRate + 120 * outputRate) / 1_000_000;
  }

  private handleModelError(error: unknown, token: JobToken): void {
    if (isAbortError(error)) {
      this.drop('cancelled', { jobId: token.jobId, stage: 'model_abort' });
      this.deps.log.write('state', this.now, {
        jobId: token.jobId,
        note: 'stale completion did not write state',
        state: this.director.current,
      });
      return;
    }
    if (error instanceof ProviderError) {
      this.deps.log.write('model_error', this.now, { jobId: token.jobId, kind: error.kind, message: error.message });
      if (error.kind === 'spend_limit') {
        this.paidCallsStopped = true;
        this.stats.budgetStops += 1;
        this.deps.log.write('budget_stop', this.now, { reason: 'enforced_spend_limit_reached' });
      } else if (error.kind === 'rate_limit') {
        this.cooldownUntil = this.now + (error.retryAfterMs ?? this.deps.config.recovery.cooldownMs);
      } else {
        this.consecutiveFailures += 1;
        this.applyFailurePolicy();
      }
    } else {
      this.consecutiveFailures += 1;
      this.deps.log.write('model_error', this.now, { jobId: token.jobId, kind: 'unknown', message: (error as Error).message });
      this.applyFailurePolicy();
    }
    this.drop(error instanceof ProviderError ? error.kind : 'model_error', { jobId: token.jobId });
    this.finishJob(token, 'IDLE');
  }

  private applyFailurePolicy(): void {
    if (this.consecutiveFailures >= this.deps.config.recovery.consecutiveFailuresBeforePause) {
      this.cooldownUntil = this.now + this.deps.config.recovery.cooldownMs;
      this.consecutiveFailures = 0;
      this.deps.log.write('source_health', this.now, { source: 'model', state: 'paused', cooldownMs: this.deps.config.recovery.cooldownMs });
    }
  }

  /** Only writes state when the job is still current (R1 F2). */
  private finishJob(token: JobToken, to: 'IDLE'): void {
    const wrote = this.director.transitionIfCurrent(token, to);
    this.director.endJob(token);
    if (!wrote) {
      this.deps.log.write('state', this.now, { jobId: token.jobId, note: 'stale completion did not write state', state: this.director.current });
    }
    if (this.jobController && this.jobController.signal.aborted) this.jobController = null;
  }

  // -------------------------------------------------------------- control

  async emergencyStop(): Promise<void> {
    this.stats.emergencyStops += 1;
    const playedBefore = this.stats.playedUtterances;
    const generation = this.director.bumpGeneration();
    const stopStartedAt = this.now;
    await this.deps.player.stopNow();
    this.jobController?.abort();
    this.jobController = null;
    this.candidate = null;
    const silencedAt = this.now;
    this.deps.log.write('emergency_stop', silencedAt, {
      sessionGeneration: generation,
      stopStartedAt,
      silenceMs: silencedAt - stopStartedAt,
      playedBefore,
    });
    if (this.director.current !== 'STOPPED') {
      this.director.transition(this.director.current === 'PAUSED' ? 'PAUSED' : 'IDLE');
    }
  }

  pause(): void {
    this.paused = true;
    this.director.bumpGeneration();
    this.jobController?.abort();
    this.jobController = null;
    this.director.transition('PAUSED');
    this.deps.log.write('state', this.now, { state: 'PAUSED' });
  }

  resume(): void {
    this.paused = false;
    this.candidate = null;
    this.director.transition('IDLE');
    this.deps.log.write('state', this.now, { state: 'IDLE', note: 'resumed' });
  }

  stop(): void {
    this.paused = false;
    this.stopped = true;
    this.director.bumpGeneration();
    this.jobController?.abort();
    this.jobController = null;
    this.director.transition('STOPPED');
    this.deps.log.write('state', this.now, { state: 'STOPPED' });
  }

  get candidateSlot(): CandidateSlot | null {
    return this.candidate;
  }

  get modelUsage() {
    return this.deps.model.usage();
  }

  get ttsUsage() {
    return this.deps.tts.usage();
  }

  get paidStopped(): boolean {
    return this.paidCallsStopped;
  }
}
