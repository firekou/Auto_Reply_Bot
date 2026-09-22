/**
 * Budget guard: reserve before the call, settle after it.
 *
 * Review R1 F4:
 *  - a reservation uses the worst case, including the full max_output_tokens
 *    and every image actually sent;
 *  - a timeout does not assume zero cost: the reservation stays held;
 *  - unknown rates mean paid mode does not start at all.
 */

export interface PriceTable {
  version: string | null;
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
  ttsUsdPerMillionCharacters: number | null;
}

export interface BudgetLimits {
  hourlyUsdLimit: number | null;
  sessionUsdLimit: number | null;
}

export interface ModelReservationRequest {
  textInputTokens: number;
  imageTokens: number;
  structuredOutputOverheadTokens: number;
  maxOutputTokens: number;
}

export interface TtsReservationRequest {
  characters: number;
}

export interface Reservation {
  id: string;
  amountUsd: number;
  settled: boolean;
  heldReason?: 'timeout' | 'error';
}

export class BudgetExceededError extends Error {
  constructor(readonly attemptedUsd: number, readonly limitUsd: number) {
    super(`reservation of ${attemptedUsd} USD would exceed the limit of ${limitUsd} USD`);
  }
}

export class BudgetUnconfiguredError extends Error {}

/** Visual tokens per the official formula: ceil(w/28) * ceil(h/28). */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

export class BudgetGuard {
  private reservedUsd = 0;
  private settledUsd = 0;
  private counter = 0;
  private readonly open = new Map<string, Reservation>();

  constructor(
    private readonly limits: BudgetLimits,
    private readonly prices: PriceTable,
    private readonly paidMode: boolean,
  ) {
    if (paidMode) {
      if (limits.hourlyUsdLimit === null || limits.sessionUsdLimit === null) {
        throw new BudgetUnconfiguredError(
          'paid mode requires authorized hourly and session limits; null is not "no limit"',
        );
      }
      if (prices.version === null) {
        throw new BudgetUnconfiguredError('paid mode requires a versioned price table');
      }
    }
  }

  get committedUsd(): number {
    return this.settledUsd + this.reservedUsd;
  }

  get settledTotalUsd(): number {
    return this.settledUsd;
  }

  get heldUsd(): number {
    return this.reservedUsd;
  }

  private rate(value: number | null, label: string): number {
    if (value === null) {
      throw new BudgetUnconfiguredError(`${label} rate is unknown; refusing to treat unknown as zero`);
    }
    return value;
  }

  modelReservationUsd(request: ModelReservationRequest): number {
    const input =
      request.textInputTokens + request.imageTokens + request.structuredOutputOverheadTokens;
    const inputRate = this.rate(this.prices.inputUsdPerMillionTokens, 'model input');
    const outputRate = this.rate(this.prices.outputUsdPerMillionTokens, 'model output');
    return (input * inputRate + request.maxOutputTokens * outputRate) / 1_000_000;
  }

  ttsReservationUsd(request: TtsReservationRequest): number {
    const rate = this.rate(this.prices.ttsUsdPerMillionCharacters, 'tts');
    return (request.characters * rate) / 1_000_000;
  }

  reserve(amountUsd: number): Reservation {
    const limit = this.limits.sessionUsdLimit;
    if (limit !== null && this.committedUsd + amountUsd > limit) {
      throw new BudgetExceededError(this.committedUsd + amountUsd, limit);
    }
    this.reservedUsd += amountUsd;
    const reservation: Reservation = { id: `res_${++this.counter}`, amountUsd, settled: false };
    this.open.set(reservation.id, reservation);
    return reservation;
  }

  /** Replaces the reservation with the real usage cost. */
  settle(reservation: Reservation, actualUsd: number): void {
    if (reservation.settled) return;
    this.reservedUsd -= reservation.amountUsd;
    this.settledUsd += actualUsd;
    reservation.settled = true;
    this.open.delete(reservation.id);
  }

  /**
   * A timed-out or failed call may still have been billed upstream, so the
   * reservation is kept until it can be reconciled against real usage.
   */
  hold(reservation: Reservation, reason: 'timeout' | 'error'): void {
    if (reservation.settled) return;
    reservation.heldReason = reason;
  }

  get openReservations(): readonly Reservation[] {
    return [...this.open.values()];
  }
}
