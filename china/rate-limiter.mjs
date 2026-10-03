// Rate limiter for the browser-driven CN platforms (BOSS / 猎聘 / LinkedIn).
//
// Why this exists: the per-page `delayMs` on the drivers is a *page-readiness*
// wait (it polls a page until it stops being a security screen), not a floor on
// how fast a session may act. Nothing anywhere else paced the job loop, so
// `collect()` went from one detail view to the next with no gap at all — and on
// BOSS, whose detail path is a click that never touches `wait()`, that is a
// click train. It is the mechanism behind the `_security_check` counter climbing
// on an account that was otherwise logged in and healthy.
//
// The four zero-auth CN board providers in `providers/` have the same shape of
// problem, but they solved it with a different primitive (per-page delay plus a
// 429 backoff against `_http.mjs`). The difference matters: those boards answer
// a throttle with a status code, whereas BOSS and 猎聘 answer with a redirect to
// a security page, and a redirect carries no Retry-After to read. So the lever
// here is a spacing floor plus a cooldown that trips on the challenge, not a
// retry-on-429.
//
// Budget shape (规则 1 of docs/COLLECTION_RULES.md): the CLI's `--delay-ms` is
// the operator's declared budget and is honoured verbatim as the *minimum* gap
// between two requests. Defaults here are per-platform because the platforms do
// not have equal tolerance: BOSS counts visits and escalates across sessions,
// 猎聘's guard is IP-level and does not care about visit spacing, so its floor
// is purely defensive.
//
// Jitter (规则 1.1, added 2026-10-03): a fixed cadence is itself a signal. Two
// gaps of exactly 15000ms are as regular as a cron, and the floor that protects
// the account also publishes the account's behaviour. `jitterRatio` widens each
// gap by a random amount in [0, ratio × interval) on top of the floor, so the
// operator's declared budget is still never undercut — the delay only grows.
// Off by default: tests assert exact gaps, and a run that has not asked for
// unpredictability should not get it silently.

/** Minimum gap between two actions on the same platform, in ms. */
export const DEFAULT_ACTION_INTERVAL_MS = 15_000;

/**
 * 猎聘's guard is an IP-level ban plus a human-click captcha, so spacing buys
 * little; it is set to the same floor as BOSS to keep one knob and to stay
 * consistent with the CLI minimum.
 */
export const PLATFORM_ACTION_INTERVAL_MS = {
  boss: DEFAULT_ACTION_INTERVAL_MS,
  liepin: DEFAULT_ACTION_INTERVAL_MS,
  linkedin: DEFAULT_ACTION_INTERVAL_MS,
};

/**
 * Fraction of the interval added at random to each gap, as a multiplier of
 * `intervalMs`. 0.4 means a 15s floor becomes 15–21s. Never negative and never
 * more than 1: a jitter larger than the floor would spend more time hiding the
 * cadence than the budget itself, and a negative one would undercut a budget
 * the operator declared.
 */
export const DEFAULT_JITTER_RATIO = 0;

/**
 * How long to sit still after the platform shows a security check, before the
 * session is allowed to continue. BOSS's check walks itself off in ~12s
 * (measured 2026-10-02), so this is only a floor; 猎聘's is not walkable at
 * all and the driver terminates before reaching it (see COLLECTION_RULES.md
 * 规则 2.1), which is why 猎聘 keeps 0 there.
 */
export const CHALLENGE_COOLDOWN_MS = {
  boss: 15_000,
  liepin: 0,
  linkedin: 0,
};

/**
 * Create a rate limiter.
 *
 * @param {object} [options]
 * @param {string} [options.platform] boss | liepin | linkedin
 * @param {number} [options.intervalMs] minimum gap between two waits() calls
 * @param {number} [options.challengeCooldownMs] extra floor after a challenge
 * @param {number} [options.jitterRatio] random share of intervalMs added to each
 *   gap, in [0, 1). 0 disables it, which is the default.
 * @param {() => number} [options.random] random source, injectable for tests
 * @param {() => number} [options.now] clock, injectable for tests
 * @param {(ms: number) => Promise<void>} [options.sleep] sleep, injectable for tests
 */
export function createRateLimiter({
  platform = 'boss',
  intervalMs = PLATFORM_ACTION_INTERVAL_MS[platform] ?? DEFAULT_ACTION_INTERVAL_MS,
  challengeCooldownMs = CHALLENGE_COOLDOWN_MS[platform] ?? 0,
  jitterRatio = DEFAULT_JITTER_RATIO,
  random = Math.random,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  // Clamped rather than rejected: an operator asking for jitter=3 or -1 has
  // made a typo, and silently running with 1 (or 0) is better than refusing the
  // whole collection over a number in the wrong range. The floor is what
  // protects the account, so that is what a bad value falls back to.
  const jitter = Math.min(1, Math.max(0, Number(jitterRatio) || 0));
  // Drawn once per gap, not once per limiter: a fixed draw would defeat the
  // purpose and make the "random" cadence perfectly reproducible.
  const jitterFor = () => (jitter > 0 ? Math.floor(random() * jitter * intervalMs) : 0);

  let lastActionAt = 0;
  let challengeAt = 0;
  // A first action is free: pacing exists to bound the *rate*, and there is no
  // previous action to be too close to. Mirrors the providers' idiom where the
  // first request of a run skips the inter-page delay.
  let chargedFirstAction = false;

  /**
   * Wait long enough that the next platform action is at least `intervalMs`
   * after the previous one, and at least `challengeCooldownMs` after a challenge
   * was last seen. Returns the ms actually waited, so callers can log the real
   * pacing rather than the configured number.
   */
  async function wait({ challenged = false } = {}) {
    const at = now();
    if (challenged) challengeAt = at;

    let due = 0;
    if (chargedFirstAction) due = Math.max(due, lastActionAt + intervalMs - at);
    if (challengeAt) due = Math.max(due, challengeAt + challengeCooldownMs - at);
    // Jitter is drawn only when a gap is actually being paid. Adding it to a
    // due of 0 would make an idle run wait before its first action too, which
    // is the opposite of what pacing is for.
    if (due > 0) due += jitterFor();
    if (due <= 0) {
      // Still stamp the action even when nothing had to be waited out. The
      // caller is about to touch the platform, so the next call has to measure
      // its gap from *now* — not from a stale zero, which would let an idle run
      // fire two requests back to back the moment work resumes.
      lastActionAt = at;
      chargedFirstAction = true;
      return 0;
    }

    await sleep(due);
    lastActionAt = now();
    chargedFirstAction = true;
    // A challenge seen while waiting still has to be honoured after the sleep.
    challengeAt = challengeAt ? Math.max(challengeAt, lastActionAt) : 0;
    return due;
  }

  /** True when a caller just paid a gap; lets the collector report pacing. */
  function pending() {
    const at = now();
    if (chargedFirstAction && lastActionAt + intervalMs > at) return lastActionAt + intervalMs - at;
    if (challengeAt && challengeAt + challengeCooldownMs > at) return challengeAt + challengeCooldownMs - at;
    return 0;
  }

  return {
    wait,
    pending,
    /** Exposed for the driver's challenge handling to reset the floor. */
    noteChallenge() { challengeAt = now(); },
    noteAction() { lastActionAt = now(); chargedFirstAction = true; },
    get intervalMs() { return intervalMs; },
    get challengeCooldownMs() { return challengeCooldownMs; },
    get jitterRatio() { return jitter; },
  };
}
