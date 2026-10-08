import { fixedWindow, slidingWindow, tokenBucket } from './algorithms.js';
import type { RateLimitPolicy } from './rate-limit.policies.js';
import { MemoryRateLimitStore } from './rate-limit.stores.js';

const policy = (
  algorithm: RateLimitPolicy['algorithm'],
  limit: number,
  windowMs: number,
): RateLimitPolicy => ({
  name: 'default',
  algorithm,
  limit,
  windowMs,
  key: 'user-or-ip',
});

/** Runs `count` requests at the given times through a pure algorithm. */
function run<State>(
  step: (
    state: State | undefined,
    p: RateLimitPolicy,
    now: number,
  ) => { state: State; decision: { allowed: boolean } },
  p: RateLimitPolicy,
  times: readonly number[],
): boolean[] {
  let state: State | undefined;
  return times.map(now => {
    const result = step(state, p, now);
    state = result.state;
    return result.decision.allowed;
  });
}

describe('fixedWindow', () => {
  const p = policy('fixed-window', 3, 1_000);

  it('allows the limit, refuses the rest, then opens a new window', () => {
    expect(run(fixedWindow, p, [0, 10, 20, 30, 999, 1_000])).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('reports remaining, reset and retry-after', () => {
    const first = fixedWindow(undefined, p, 0);
    expect(first.decision).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetMs: 1_000,
      retryAfterMs: 0,
    });
    let state = first.state;
    for (const now of [100, 200]) {
      state = fixedWindow(state, p, now).state;
    }
    const refused = fixedWindow(state, p, 400).decision;
    expect(refused).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 600,
    });
  });

  it('allows a burst across a window boundary (its known weakness)', () => {
    expect(run(fixedWindow, p, [0, 998, 999, 1_000, 1_001, 1_002])).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('slidingWindow', () => {
  const p = policy('sliding-window', 3, 1_000);

  it('does not allow a burst across the boundary', () => {
    expect(run(slidingWindow, p, [997, 998, 999, 1_000, 1_001, 1_002])).toEqual(
      [true, true, true, false, false, false],
    );
  });

  it('frees one slot when the oldest request leaves the window', () => {
    expect(run(slidingWindow, p, [0, 100, 200, 999, 1_000, 1_001])).toEqual([
      true,
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it('tells the client when the oldest request leaves', () => {
    let state = slidingWindow(undefined, p, 0).state;
    state = slidingWindow(state, p, 100).state;
    state = slidingWindow(state, p, 200).state;
    expect(slidingWindow(state, p, 300).decision).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 700,
    });
  });

  it('does not count refused requests', () => {
    // Retrying while refused must not push the window further out.
    let state = slidingWindow(undefined, p, 0).state;
    state = slidingWindow(state, p, 1).state;
    state = slidingWindow(state, p, 2).state;
    for (let now = 3; now < 50; now += 1) {
      state = slidingWindow(state, p, now).state;
    }
    expect(state.hits).toEqual([0, 1, 2]);
  });
});

describe('tokenBucket', () => {
  // 10 tokens, refilled 10 per second: one every 100 ms.
  const p = policy('token-bucket', 10, 1_000);

  it('allows a burst up to the capacity', () => {
    const allowed = run(tokenBucket, p, Array<number>(11).fill(0));
    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(allowed.at(-1)).toBe(false);
  });

  it('refills continuously at the configured rate', () => {
    let state = tokenBucket(undefined, p, 0).state;
    for (let i = 0; i < 9; i += 1) {
      state = tokenBucket(state, p, 0).state;
    }
    const empty = tokenBucket(state, p, 50);
    expect(empty.decision).toMatchObject({
      allowed: false,
      retryAfterMs: 50,
    });
    expect(tokenBucket(empty.state, p, 100).decision.allowed).toBe(true);
  });

  it('never holds more than its capacity', () => {
    const idle = tokenBucket(undefined, p, 0);
    const later = tokenBucket(idle.state, p, 60_000);
    expect(later.decision.remaining).toBe(9);
  });
});

describe('MemoryRateLimitStore', () => {
  it('keeps separate counters per key', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    const p = policy('fixed-window', 1, 1_000);

    expect((await store.consume('a', p)).allowed).toBe(true);
    expect((await store.consume('a', p)).allowed).toBe(false);
    expect((await store.consume('b', p)).allowed).toBe(true);
    now = 1_000;
    expect((await store.consume('a', p)).allowed).toBe(true);
  });
});
