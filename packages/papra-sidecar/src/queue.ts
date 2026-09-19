export interface JobQueue<T> {
  enqueue(item: T): void;
  readonly size: number;
}

export function createJobQueue<T>(
  worker: (item: T) => Promise<void>,
  concurrency = 1,
): JobQueue<T> {
  const items: T[] = [];
  let active = 0;

  const pump = (): void => {
    while (active < concurrency) {
      const item = items.shift();
      if (item === undefined) {
        return;
      }
      active += 1;
      void worker(item)
        .catch((error: unknown) => {
          console.error('Unhandled queue worker error', error);
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return {
    enqueue(item: T): void {
      items.push(item);
      pump();
    },
    get size(): number {
      return items.length + active;
    },
  };
}