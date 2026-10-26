// Lets work start at most once per interval, in the order it was asked for.
// Used for outside APIs with strict limits (Qloo, Nominatim).
export function createPacer(
  intervalMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  return function waitForTurn(): Promise<void> {
    const turn = queue.then(async () => {
      const wait = lastStart + intervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}
