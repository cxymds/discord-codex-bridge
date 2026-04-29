export class SessionQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly pendingCounts = new Map<string, number>();

  enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    this.pendingCounts.set(sessionId, this.pendingCount(sessionId) + 1);
    const previous = this.chains.get(sessionId) ?? Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          return await work();
        } finally {
          const remaining = Math.max(0, this.pendingCount(sessionId) - 1);
          if (remaining === 0) {
            this.pendingCounts.delete(sessionId);
          } else {
            this.pendingCounts.set(sessionId, remaining);
          }
        }
      });

    this.chains.set(sessionId, next);
    next.finally(() => {
      if (this.chains.get(sessionId) === next) {
        this.chains.delete(sessionId);
      }
    }).catch(() => undefined);

    return next;
  }

  pendingCount(sessionId: string): number {
    return this.pendingCounts.get(sessionId) ?? 0;
  }

  trackedSessionCount(): number {
    return this.pendingCounts.size;
  }
}
