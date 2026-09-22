/** Review R1 F4: reserve before the call, settle after, hold on timeout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceededError, BudgetGuard, BudgetUnconfiguredError, visualTokens } from '../src/director/budget.js';
import { ConfigError, DEFAULT_CONFIG, validateConfig } from '../src/config/load.js';

const FAKE_PRICES = {
  version: 'fake-2026-09-22',
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 5,
  ttsUsdPerMillionCharacters: 16,
};

test('visual tokens follow the published formula', () => {
  assert.equal(visualTokens(960, 540), 35 * 20);
  assert.equal(visualTokens(1280, 720), 46 * 26);
  assert.equal(visualTokens(1000, 1000), 36 * 36);
});

test('a reservation holds the full max_output_tokens, not the expected output', () => {
  const guard = new BudgetGuard({ hourlyUsdLimit: 10, sessionUsdLimit: 10 }, FAKE_PRICES, true);
  const amount = guard.modelReservationUsd({
    textInputTokens: 1500,
    imageTokens: visualTokens(960, 540),
    structuredOutputOverheadTokens: 250,
    maxOutputTokens: 180,
  });
  // (1500 + 700 + 250) * 1/1e6 + 180 * 5/1e6
  assert.equal(amount, (2450 * 1 + 180 * 5) / 1_000_000);
});

test('a reservation that would exceed the session limit is refused', () => {
  const guard = new BudgetGuard({ hourlyUsdLimit: 0.001, sessionUsdLimit: 0.001 }, FAKE_PRICES, true);
  guard.reserve(0.0009);
  assert.throws(() => guard.reserve(0.0005), BudgetExceededError);
  assert.ok(guard.committedUsd <= 0.001);
});

test('settling replaces the reservation with the real cost', () => {
  const guard = new BudgetGuard({ hourlyUsdLimit: 1, sessionUsdLimit: 1 }, FAKE_PRICES, true);
  const reservation = guard.reserve(0.01);
  assert.equal(guard.committedUsd, 0.01);
  guard.settle(reservation, 0.004);
  assert.equal(guard.settledTotalUsd, 0.004);
  assert.equal(guard.heldUsd, 0);
});

test('a timed-out call keeps its reservation: no zero-cost assumption', () => {
  const guard = new BudgetGuard({ hourlyUsdLimit: 1, sessionUsdLimit: 1 }, FAKE_PRICES, true);
  const reservation = guard.reserve(0.01);
  guard.hold(reservation, 'timeout');
  assert.equal(guard.heldUsd, 0.01, 'the held amount must survive a timeout');
  assert.equal(guard.openReservations.length, 1);
  assert.equal(guard.openReservations[0]?.heldReason, 'timeout');
});

test('paid mode refuses null limits and an unversioned price table', () => {
  assert.throws(
    () => new BudgetGuard({ hourlyUsdLimit: null, sessionUsdLimit: 5 }, FAKE_PRICES, true),
    BudgetUnconfiguredError,
  );
  assert.throws(
    () => new BudgetGuard({ hourlyUsdLimit: 5, sessionUsdLimit: 5 }, { ...FAKE_PRICES, version: null }, true),
    BudgetUnconfiguredError,
  );
});

test('an unknown rate is never treated as zero', () => {
  const guard = new BudgetGuard(
    { hourlyUsdLimit: 5, sessionUsdLimit: 5 },
    { ...FAKE_PRICES, ttsUsdPerMillionCharacters: null },
    false,
  );
  assert.throws(() => guard.ttsReservationUsd({ characters: 100 }), BudgetUnconfiguredError);
});

test('config validation blocks paid mode without authorized limits', () => {
  assert.throws(
    () =>
      validateConfig({
        ...DEFAULT_CONFIG,
        budget: { ...DEFAULT_CONFIG.budget, billingMode: 'authorized' },
      }),
    ConfigError,
  );
});

test('config validation blocks real mode on mock providers and a null device', () => {
  assert.throws(
    () =>
      validateConfig({
        ...DEFAULT_CONFIG,
        mode: 'real',
        budget: {
          ...DEFAULT_CONFIG.budget,
          billingMode: 'authorized',
          hourlyUsdLimit: 1,
          sessionUsdLimit: 1,
          priceTableVersion: 'x',
        },
      }),
    ConfigError,
  );
});

test('config validation refuses a non-zero per-event retry count', () => {
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, model: { ...DEFAULT_CONFIG.model, retriesPerEvent: 1 } }),
    ConfigError,
  );
});
