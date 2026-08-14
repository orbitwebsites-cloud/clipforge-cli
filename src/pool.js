/**
 * Bounded-concurrency helpers.
 *
 * Measured on this machine (8 cores, 20 s 1080p source, cheap-blur chain):
 *
 *   N=1  4.3 clips/min   x1.00
 *   N=2  5.8 clips/min   x1.35
 *   N=4  9.2 clips/min   x2.13
 *   N=6  9.4 clips/min   x2.18
 *   N=8  9.4 clips/min   x2.17
 *
 * ffmpeg already slice-threads across every core, so concurrency only recovers
 * the gaps where one process is single-threaded (filter-graph setup, muxing,
 * I/O). That runs out at 4. Going higher costs memory and disk churn to buy
 * roughly 2%, which is why RENDER_CONCURRENCY defaults there rather than to
 * core count.
 */

/** Counting semaphore. `release()` is idempotent per acquisition. */
export class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.waiting = [];
  }

  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }

  /** Run `fn` holding a slot, releasing it even if `fn` throws. */
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Map over `items` with at most `limit` in flight, preserving input order.
 *
 * Unlike a bare `Promise.all` over a sliced array this has no barrier between
 * batches: a worker that finishes early immediately takes the next item instead
 * of idling until the slowest member of its batch is done.
 *
 * If any task rejects, the remaining in-flight tasks are still awaited before
 * the first error is rethrown — abandoning them would leave orphaned ffmpeg
 * processes writing to files the caller is about to clean up.
 */
export async function mapPool(items, limit, fn) {
  const list = [...items];
  const results = new Array(list.length);
  const errors = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      try {
        results[i] = await fn(list[i], i);
      } catch (err) {
        errors.push(err);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, worker));
  if (errors.length) throw errors[0];
  return results;
}
