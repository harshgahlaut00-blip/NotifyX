'use strict';

/**
 * A self-scheduling worker loop: never overlaps itself, survives errors,
 * can be woken early with trigger(), and stop() waits for the in-flight run.
 */
function createLoop({ name, intervalMs, fn, log, initialDelayMs = 1000 }) {
  let timer = null;
  let stopped = true;
  let inflight = null;
  let rerun = false;

  const tick = async () => {
    timer = null;
    if (stopped) return;
    inflight = (async () => {
      try {
        await fn();
      } catch (err) {
        log.error({ err, loop: name }, 'worker loop error');
      }
    })();
    await inflight;
    inflight = null;
    if (stopped) return;
    const next = rerun ? 0 : intervalMs;
    rerun = false;
    timer = setTimeout(tick, next);
  };

  return {
    name,
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setTimeout(tick, initialDelayMs);
    },
    /** Run as soon as possible (queued if a run is already in flight). */
    trigger() {
      if (stopped) return;
      if (inflight) {
        rerun = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      if (inflight) await inflight;
    },
    get running() {
      return !stopped;
    },
  };
}

/** Run `fn` over `items` with at most `limit` in flight. Errors must be handled inside `fn`. */
async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

module.exports = { createLoop, mapLimit };
