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

test('jitter widens a paid gap without ever undercutting the floor', async () => {
  // 规则 1.1: a fixed cadence is a signature in itself. random()=0 is the
  // smallest possible draw, so the gap is exactly the floor — the budget the
  // operator declared is a floor, not an average.
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, jitterRatio: 0.4,
    random: () => 0, now: c.now, sleep: c.sleep,
  });
  await rl.wait();
  c.advance(1_000);
  assert.equal(await rl.wait(), 14_000, 'a zero draw leaves the declared floor intact');
});

test('jitter never exceeds the ratio, and differs between gaps', async () => {
  const c = mkClock();
  // A fixed draw per limiter would make the cadence perfectly reproducible,
  // which is the thing jitter exists to prevent. Drawing per gap has to vary.
  const draws = [0, 0.5, 1];
  let i = 0;
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 10_000, jitterRatio: 0.5,
    random: () => draws[i++ % draws.length], now: c.now, sleep: c.sleep,
  });
  // intervalMs 10000, so each gap owes 1000 after 9s of work, and jitter is
  // floor(draw × 0.5 × 10000): 0 → +0, 0.5 → +2500, 1 → +5000.
  await rl.wait();                       // first: free
  c.advance(9_000);
  assert.equal(await rl.wait(), 1_000, '0 draw → floor only');
  c.advance(9_000);
  assert.equal(await rl.wait(), 3_500, '0.5 draw → floor + half the jitter span');
  c.advance(9_000);
  assert.equal(await rl.wait(), 6_000, '1 draw → floor + the whole jitter span');
});

test('jitter does not delay an action that owes no gap', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, jitterRatio: 0.4,
    random: () => 0.99, now: c.now, sleep: c.sleep,
  });
  assert.equal(await rl.wait(), 0, 'the first action stays free');
  c.advance(30_000);                     // far past any gap
  assert.equal(await rl.wait(), 0, 'an idle run must not wait before acting');
  assert.deepEqual(c.sleeps, []);
});

test('a challenge cooldown is jittered too — the wait itself is a signature', async () => {
  const c = mkClock();
  const rl = createRateLimiter({
    platform: 'boss', intervalMs: 15_000, challengeCooldownMs: 15_000,
    jitterRatio: 0.4, random: () => 0.5, now: c.now, sleep: c.sleep,
  });
  await rl.wait();
  c.advance(1_000);
  rl.noteChallenge();
  // The cooldown is the full 15s from now, which already exceeds the interval's
  // 14s remainder, so it wins — then jitter adds floor(0.5 × 0.4 × 15000).
  assert.equal(await rl.wait(), 15_000 + 3_000);
});

test('a nonsensical jitter value falls back to the floor rather than failing', () => {
  // Refusing the collection over a number in the wrong range would be worse than
  // running with no jitter: the floor is what protects the account.
  // A negative or unparseable value is not a budget question, it is a typo:
  // it must land on "no jitter" so the floor is exactly what the operator
  // declared. An oversized one clamps to the maximum rather than growing
  // without bound.
  for (const jitterRatio of [-1, NaN, 'x', null]) {
    const rl = createRateLimiter({ platform: 'boss', jitterRatio });
    assert.equal(rl.jitterRatio, 0, `jitter=${jitterRatio} must not widen the gap`);
  }
  for (const jitterRatio of [3, 99]) {
    const rl = createRateLimiter({ platform: 'boss', jitterRatio });
    assert.equal(rl.jitterRatio, 1, `jitter=${jitterRatio} must clamp to the maximum`);
  }
  // Omitting it entirely takes the default, which is off: a run that did not
  // ask for unpredictability should not get it silently.
  assert.equal(createRateLimiter({ platform: 'boss' }).jitterRatio, 0);
});

test('an unknown platform falls back to the shared default', () => {
  const rl = createRateLimiter({ platform: 'unknown-board' });
  assert.equal(rl.intervalMs, DEFAULT_ACTION_INTERVAL_MS);
  assert.equal(rl.challengeCooldownMs, 0);
});
