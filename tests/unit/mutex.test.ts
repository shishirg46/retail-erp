// P4 — process-local async mutex (lib/mutex.ts).

import { describe, expect, it } from "vitest";
import { AsyncMutex } from "../../lib/mutex";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("AsyncMutex", () => {
  it("serializes exclusive critical sections", async () => {
    const mutex = new AsyncMutex();
    let inSection = 0;
    let maxConcurrent = 0;

    const critical = async (n: number) =>
      mutex.runExclusive(async () => {
        inSection += 1;
        maxConcurrent = Math.max(maxConcurrent, inSection);
        await tick(10);
        inSection -= 1;
        return n * 2;
      });

    const results = await Promise.all([critical(1), critical(2), critical(3)]);
    expect(results).toEqual([2, 4, 6]);
    expect(maxConcurrent).toBe(1);
  });

  it("does not poison the queue when a task rejects", async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.runExclusive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const result = await mutex.runExclusive(async () => 42);
    expect(result).toBe(42);
  });
});
