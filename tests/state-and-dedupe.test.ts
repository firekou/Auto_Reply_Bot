/** Review R1 F2 (state write guards) and F3 (dedupe keys and sets). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, IllegalTransitionError } from '../src/director/state.js';
import { Deduper } from '../src/context/deduper.js';
import { chatKey, type ChatMessage } from '../src/types.js';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    messageId: 'm1',
    idStability: 'stable',
    source: 'primary',
    text: '這波能翻盤嗎',
    receivedAt: 1000,
    ...overrides,
  };
}

test('a late finally from a cancelled job cannot overwrite a manual PAUSED', () => {
  const director = new Director();
  director.transition('IDLE');
  const token = director.beginJob();
  director.transition('GENERATING');

  // Operator pauses while the model call is still in flight.
  director.bumpGeneration();
  director.transition('PAUSED');

  // The old job's finally runs afterwards and tries to return to IDLE.
  assert.equal(director.transitionIfCurrent(token, 'IDLE'), false);
  assert.equal(director.current, 'PAUSED');
});

test('a late resolve after stop cannot revive the machine', () => {
  const director = new Director();
  director.transition('IDLE');
  const token = director.beginJob();
  director.transition('GENERATING');
  director.bumpGeneration();
  director.transition('STOPPED');

  assert.equal(director.transitionIfCurrent(token, 'SYNTHESIZING'), false);
  assert.equal(director.current, 'STOPPED');
});

test('a job from before a scene change is no longer current', () => {
  const director = new Director();
  director.transition('IDLE');
  const token = director.beginJob();
  director.bumpContextVersion();
  assert.equal(director.isCurrent(token), false);
});

test('resume starts a job that the old token cannot touch', () => {
  const director = new Director();
  director.transition('IDLE');
  const stale = director.beginJob();
  director.bumpGeneration();
  director.transition('PAUSED');
  director.transition('IDLE');

  const fresh = director.beginJob();
  assert.equal(director.isCurrent(fresh), true);
  assert.equal(director.isCurrent(stale), false);
  assert.equal(director.transitionIfCurrent(stale, 'GENERATING'), false);
  assert.equal(director.current, 'IDLE');
});

test('illegal transitions throw and are recorded rather than ignored', () => {
  const director = new Director();
  director.transition('IDLE');
  assert.throws(() => director.transition('PLAYING'), IllegalTransitionError);
  assert.equal(director.illegalTransitions.length, 1);
});

test('two sources may reuse the same message id without colliding', () => {
  const deduper = new Deduper();
  const a = message({ source: 'primary', messageId: 'm42' });
  const b = message({ source: 'secondary', messageId: 'm42', text: '另一個來源說：這波能翻盤嗎' });
  const admitted = deduper.admit([a, b]);
  assert.equal(admitted.length, 2);
  assert.notEqual(chatKey(a), chatKey(b));
});

test('a resend of the same id from the same source is not admitted twice', () => {
  const deduper = new Deduper();
  const first = message({ messageId: 'm7', receivedAt: 1000 });
  const resend = message({ messageId: 'm7', receivedAt: 4000 });
  assert.equal(deduper.admit([first]).length, 1);
  assert.equal(deduper.admit([resend]).length, 0);
});

test('spoken is written at playback, so a failed round does not consume the message', () => {
  const deduper = new Deduper();
  const only = message({ messageId: 'm9' });
  const key = chatKey(only);
  deduper.admit([only]);

  // Round one: selected, then TTS fails before playback.
  deduper.markSelected([key]);
  assert.equal(deduper.hasSpoken(key), false, 'selection alone must not mark it spoken');

  // Round two reaches playback.
  deduper.markSpoken([key]);
  assert.equal(deduper.hasSpoken(key), true);
});

test('synthetic ids dedupe inside the window and admit a genuine later repeat', () => {
  const deduper = new Deduper({ windowMs: 8000 });
  const base = message({ idStability: 'synthetic', messageId: 'syn1', author: 'viewer_1', receivedAt: 1000 });
  assert.equal(deduper.admit([base]).length, 1);
  assert.equal(deduper.admit([{ ...base, messageId: 'syn2', receivedAt: 3000 }]).length, 0);
  assert.equal(deduper.admit([{ ...base, messageId: 'syn3', receivedAt: 20000 }]).length, 1);
});

test('the same sentence from a different author is not swallowed', () => {
  const deduper = new Deduper({ windowMs: 8000 });
  const first = message({ idStability: 'synthetic', messageId: 's1', author: 'viewer_1', receivedAt: 1000 });
  const second = message({ idStability: 'synthetic', messageId: 's2', author: 'viewer_2', receivedAt: 1500 });
  assert.equal(deduper.admit([first]).length, 1);
  assert.equal(deduper.admit([second]).length, 1);
});
