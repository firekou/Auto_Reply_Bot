/** Review R1 F1: validation order, legal silence and the short-reply case. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, countSentences, validateDecision, type ValidationContext } from '../src/director/validator.js';

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    observationId: 'obs_1',
    offeredChatKeys: new Set(['src::m1', 'src::m2']),
    recentSpoken: [],
    maxSentences: 3,
    maxCharacters: 80,
    jobId: 'job_1',
    sessionGeneration: 0,
    contextVersion: 0,
    currentJobId: 'job_1',
    currentSessionGeneration: 0,
    currentContextVersion: 0,
    ...overrides,
  };
}

test('a legal silence is accepted and never reaches TTS', () => {
  const outcome = validateDecision(
    { speak: false, utterance: '', reply_to_ids: [], observation_id: 'obs_1', reason_code: 'no_new_information' },
    context(),
  );
  assert.equal(outcome.kind, 'silence');
});

test('a short reaction is playable: 20 characters is a target, not a floor', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '漂亮！', reply_to_ids: ['src::m1'], observation_id: 'obs_1', reason_code: 'chat_reply' },
    context(),
  );
  assert.equal(outcome.kind, 'speech');
  if (outcome.kind === 'speech') assert.equal(outcome.characterCount, 3);
});

test('81 characters is rejected while 80 is accepted', () => {
  const eighty = '欸'.repeat(80);
  const eightyOne = '欸'.repeat(81);
  assert.equal(
    validateDecision(
      { speak: true, utterance: eighty, reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
      context(),
    ).kind,
    'speech',
  );
  const rejected = validateDecision(
    { speak: true, utterance: eightyOne, reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
    context(),
  );
  assert.equal(rejected.kind, 'rejected');
  if (rejected.kind === 'rejected') assert.equal(rejected.reason, 'length');
});

test('speak=true with an empty utterance is rejected', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '   ', reply_to_ids: [], observation_id: 'obs_1', reason_code: 'chat_reply' },
    context(),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'empty_utterance');
});

test('an invalid silence payload is rejected rather than silently played', () => {
  const outcome = validateDecision(
    { speak: false, utterance: '其實我想說話', reply_to_ids: ['src::m1'], observation_id: 'obs_1', reason_code: 'uncertain' },
    context(),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'invalid_silence');
});

test('an unknown reply id is rejected', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '好的我看到了', reply_to_ids: ['src::not_offered'], observation_id: 'obs_1', reason_code: 'chat_reply' },
    context(),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'unknown_chat_id');
});

test('four sentences are rejected', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '一。二。三。四。', reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
    context(),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'sentence_count');
});

test('a stale observation id is rejected before any content rule runs', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '欸'.repeat(200), reply_to_ids: [], observation_id: 'obs_old', reason_code: 'game_event' },
    context(),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'stale_observation');
});

test('a reply from a superseded generation is rejected as cancelled', () => {
  const outcome = validateDecision(
    { speak: true, utterance: '還在說舊的事', reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
    context({ sessionGeneration: 0, currentSessionGeneration: 1 }),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind === 'rejected') assert.equal(outcome.reason, 'cancelled');
});

test('characters count Unicode code points, not UTF-16 units', () => {
  // A single emoji is two UTF-16 units but one character to a viewer.
  assert.equal('🎮'.length, 2);
  assert.equal(countCharacters('🎮'), 1);
  const seventyNinePlusEmoji = `${'欸'.repeat(79)}🎮`;
  assert.equal(countCharacters(seventyNinePlusEmoji), 80);
  assert.equal(
    validateDecision(
      { speak: true, utterance: seventyNinePlusEmoji, reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
      context(),
    ).kind,
    'speech',
  );
});

test('sentence counting ignores trailing punctuation and whitespace', () => {
  assert.equal(countSentences('這樣就好。'), 1);
  assert.equal(countSentences('這樣就好。真的嗎？'), 2);
  assert.equal(countSentences('  '), 0);
});

test('markdown and em dashes are rejected as format errors', () => {
  for (const bad of ['**很強**', '- 第一點', '```code```', '這樣——不行']) {
    const outcome = validateDecision(
      { speak: true, utterance: bad, reply_to_ids: [], observation_id: 'obs_1', reason_code: 'game_event' },
      context(),
    );
    assert.equal(outcome.kind, 'rejected', `expected ${bad} to be rejected`);
  }
});
