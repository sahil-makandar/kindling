import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher, flushAllWrites } from "@/src/lib/batcher";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createBatcher", () => {
  it("sends rows added close together as one batch, in order, after the delay", async () => {
    const writes: number[][] = [];
    const batcher = createBatcher<number>(async (rows) => {
      writes.push(rows);
    }, 150);
    batcher.add(1);
    batcher.add(2);
    batcher.add(3);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(151);
    expect(writes).toEqual([[1, 2, 3]]);
  });

  it("flush sends what is waiting at once and cancels the timer", async () => {
    const writes: number[][] = [];
    const batcher = createBatcher<number>(async (rows) => {
      writes.push(rows);
    }, 150);
    batcher.add(1);
    await batcher.flush();
    expect(writes).toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([[1]]);
  });

  it("keeps batches in order even when an earlier write is slow", async () => {
    const order: string[] = [];
    let first = true;
    const batcher = createBatcher<string>(async (rows) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 1000));
      }
      order.push(...rows);
    }, 10);
    batcher.add("a");
    const one = batcher.flush();
    batcher.add("b");
    const two = batcher.flush();
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.all([one, two]);
    expect(order).toEqual(["a", "b"]);
  });

  it("does nothing when there is nothing to send", async () => {
    const write = vi.fn(async () => undefined);
    const batcher = createBatcher<number>(write);
    await batcher.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("never throws into the caller when a write fails, and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const writes: number[][] = [];
    let fail = true;
    const batcher = createBatcher<number>(async (rows) => {
      if (fail) {
        fail = false;
        throw new Error("db down");
      }
      writes.push(rows);
    });
    batcher.add(1);
    await expect(batcher.flush()).resolves.toBeUndefined();
    batcher.add(2);
    await batcher.flush();
    expect(writes).toEqual([[2]]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("flushAllWrites", () => {
  it("flushes every batcher", async () => {
    const a: number[][] = [];
    const b: string[][] = [];
    const one = createBatcher<number>(async (rows) => {
      a.push(rows);
    });
    const two = createBatcher<string>(async (rows) => {
      b.push(rows);
    });
    one.add(1);
    two.add("x");
    await flushAllWrites();
    expect(a).toEqual([[1]]);
    expect(b).toEqual([["x"]]);
  });
});
