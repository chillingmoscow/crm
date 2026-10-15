import "server-only";

export class SalesRateLimitError extends Error {
  constructor(public retryAfterMs = 60000) {
    super(
      "Quick Resto временно ограничил частоту запросов. Продолжим автоматически",
    );
  }
}
// Shared between concurrent cron requests in this process. The database cooldown
// also prevents other processes from claiming work after a provider 429.
const tails = new Map<string, Promise<unknown>>();
const nextStart = new Map<string, number>();
export async function salesRead<T>(
  accountId: string,
  read: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(accountId) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const delay = (nextStart.get(accountId) ?? 0) - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      nextStart.set(accountId, Date.now() + 350);
      return read();
    });
  tails.set(accountId, run);
  try {
    return await run;
  } finally {
    if (tails.get(accountId) === run) tails.delete(accountId);
  }
}
