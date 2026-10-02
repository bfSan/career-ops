import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimiter,
  DEFAULT_ACTION_INTERVAL_MS,
  PLATFORM_ACTION_INTERVAL_MS,
  CHALLENGE_COOLDOWN_MS,
} from '../../china/rate-limiter.mjs';

// A controllable clock so every test is instant and deterministic.
function mkClock(start = 1_000_000) {
  let t = start;
  const sleeps = [];
  return {
    sleeps,
    get now() { return t; },
    advance(ms) { t += ms; },
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
  };
}

test('the first action is free — pacing bounds a rate, not a startup', async () => {
  const c = mkClock();
  const rl = createRateLimiter({ platform: 'boss', now: c.now, sleep: c.sleep });
  assert.equal(await rl.wait(), 0, 'first wait must not sleep');
  assert.equal(c.sleeps.length, 0);
});

test('the second action pays the full interval', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, now: c.now, sleep: c.sleep,
  });
  await rl.wait();                       // first: free
  c.advance(1_000);                     // 1s of real work
  const waited = await rl.wait();        // second: 15s - 1s = 14s
  assert.equal(waited, 14_000);
  assert.deepEqual(c.sleeps, [14_000]);
});

test('an interval already satisfied costs nothing', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, now: c.now, sleep: c.sleep,
  });
  await rl.wait();
  c.advance(20_000);                     // plenty of time passed
  assert.equal(await rl.wait(), 0, 'no gap needed');
  assert.deepEqual(c.sleeps, []);
});

test('a challenge holds the next action past the normal cadence', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, challengeCooldownMs: 15_000,
    now: c.now, sleep: c.sleep,
  });
  await rl.wait();
  c.advance(1_000);
  rl.noteChallenge();                    // security page seen
  // Only 1s since the last action, so the normal floor says "wait 14s" — but
  // the challenge floor is 15s from now, and it wins.
  const waited = await rl.wait();
  assert.equal(waited, 15_000, 'challenge cooldown must not be shortened by the interval');
});

test('a challenge seen mid-wait still defers the following action', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, challengeCooldownMs: 15_000,
    now: c.now, sleep: c.sleep,
  });
  await rl.wait();                       // first: free, stamps the action
  c.advance(1_000);
  // wait() is told a challenge happened while it was resolving the interval.
  // The cooldown runs from the moment the challenge was seen, so the gap paid
  // here is the full cooldown rather than the remainder of the interval.
  const waited = await rl.wait({ challenged: true });
  assert.equal(waited, 15_000, 'challenge cooldown is measured from the challenge');
  // And the action after that one is still paced — the challenge does not
  // consume the interval, it adds to it.
  assert.equal(await rl.wait(), 15_000, 'the challenge does not reset the clock for free');
  assert.deepEqual(c.sleeps, [15_000, 15_000]);
});

test('pending() reports the remaining gap without sleeping', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, now: c.now, sleep: c.sleep,
  });
  assert.equal(rl.pending(), 0, 'nothing pending before the first action');
  await rl.wait();
  c.advance(5_000);
  assert.equal(rl.pending(), 10_000);
  assert.deepEqual(c.sleeps, [], 'pending() must not sleep');
});

test('per-platform defaults keep a single knob', () => {
  for (const platform of ['boss', 'liepin', 'linkedin']) {
    assert.equal(
      PLATFORM_ACTION_INTERVAL_MS[platform], DEFAULT_ACTION_INTERVAL_MS,
      `${platform} shares the CLI minimum`,
    );
  }
});

test('猎聘 keeps a zero challenge cooldown — its captcha is not walkable', () => {
  // COLLECTION_RULES.md 规则 2.1: 猎聘 verification needs a human click, and
  // the login action itself can trip the account guard, so the driver
  // terminates rather than waiting. A non-zero cooldown here would imply the
  // check resolves itself, which is the wrong belief to encode.
  assert.equal(CHALLENGE_COOLDOWN_MS.liepin, 0);
  assert.equal(CHALLENGE_COOLDOWN_MS.boss, 15_000);
});

test('an unknown platform falls back to the shared default', () => {
  const rl = createRateLimiter({ platform: 'unknown-board' });
  assert.equal(rl.intervalMs, DEFAULT_ACTION_INTERVAL_MS);
  assert.equal(rl.challengeCooldownMs, 0);
});
