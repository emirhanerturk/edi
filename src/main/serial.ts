/**
 * Runs tasks one after another. A task asked for again while the same one (same key) is still waiting
 * or running isn't queued twice: the caller shares the result of the one already there.
 */
export class Serial<T> {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Forgotten as it ends, before its caller hears of it: a request after that runs anew.
    const result: Promise<T> = this.tail.then(task).finally(() => {
      if (this.pending.get(key) === result) this.pending.delete(key);
    });
    this.pending.set(key, result);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
