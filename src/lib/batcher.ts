// Collects small writes (trace lines, Qloo call logs) and sends them together, so a stage makes a handful of
// database round trips instead of one per line. Writes are best effort: they never throw into the caller.
// Anything still waiting is sent by flushAllWrites(), which stages call before they finish.

export type Batcher<T> = {
  add(row: T): void;
  flush(): Promise<void>;
};

const all = new Set<Batcher<never>>();

export function createBatcher<T>(write: (rows: T[]) => Promise<void>, delayMs = 150): Batcher<T> {
  let rows: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Batches go out one after another, so rows keep the order they were added in.
  let inflight: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = rows;
    rows = [];
    if (batch.length === 0) return inflight;
    inflight = inflight
      .then(() => write(batch))
      .catch((error) => {
        console.error("Could not save a batch of log rows:", error instanceof Error ? error.message : error);
      });
    return inflight;
  }

  const batcher: Batcher<T> = {
    add(row) {
      rows.push(row);
      timer ??= setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
  all.add(batcher as Batcher<never>);
  return batcher;
}

// Sends everything that is waiting. Call before a request or a stage ends.
export async function flushAllWrites(): Promise<void> {
  await Promise.all([...all].map((b) => b.flush()));
}
