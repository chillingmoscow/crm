/** Per-origin queue in this server process; other applications may share QR's limit. */
export class QuickRestoRateLimitError extends Error {
  constructor() {
    super("Quick Resto временно ограничил частоту запросов. Подождите и повторите попытку.");
    this.name = "QuickRestoRateLimitError";
  }
}

type Runtime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 10_000;
const RETRY_BUDGET_MS = 15_000;

function retryDelay(response: Response, attempt: number, now: number) {
  const header = response.headers.get("Retry-After")?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(250, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(250, date - now);
  }
  return 1_000 * 2 ** attempt;
}

export function createQuickRestoRequestQueue(runtime: Runtime = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const origins = new Map<string, { tail: Promise<void>; nextAt: number }>();
  return async function request(
    url: string,
    send: () => Promise<Response>,
    options: { retryRateLimit: boolean; intervalMs?: number },
  ): Promise<Response> {
    const origin = new URL(url).origin;
    let state = origins.get(origin);
    if (!state) {
      state = { tail: Promise.resolve(), nextAt: 0 };
      origins.set(origin, state);
    }
    const queue = state;
    const startedAt = runtime.now();
    for (let attempt = 0; ; attempt += 1) {
      // Queue request starts, not the HTTP response: slow requests must not
      // block unrelated reads or turn five concurrent timeouts into five serial ones.
      const slot = queue.tail.then(async () => {
        let wait: number;
        while ((wait = Math.max(0, queue.nextAt - runtime.now())) > 0) {
          if (wait > MAX_WAIT_MS || runtime.now() - startedAt + wait > RETRY_BUDGET_MS) {
            throw new QuickRestoRateLimitError();
          }
          await runtime.sleep(wait);
          // Another in-flight request may have extended the shared cooldown.
        }
        queue.nextAt = runtime.now() + (options.intervalMs ?? 0);
      });
      queue.tail = slot.then(() => undefined, () => undefined);
      await slot;
      const response = await send();
      if (response.status !== 429) return response;

      const delay = retryDelay(response, attempt, runtime.now());
      queue.nextAt = Math.max(queue.nextAt, runtime.now() + delay);
      const retry = options.retryRateLimit && attempt < MAX_RETRIES &&
        delay <= MAX_WAIT_MS && runtime.now() - startedAt + delay <= RETRY_BUDGET_MS;
      await response.body?.cancel();
      if (!retry) throw new QuickRestoRateLimitError();
    }
  };
}
