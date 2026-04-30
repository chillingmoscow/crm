// DaData server-side fetch wrapper.
//
// All DaData calls MUST go through this module — never call DaData
// directly from a 'use client' file (that would expose the API key).
//
// Endpoints we use:
//   - https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party
//   - https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address
//
// Both are served from suggestions.dadata.ru and authenticate with the
// PUBLIC API key (X-Secret is only required for the cleaner.dadata.ru
// host, which we don't use for stage 2B).

const DADATA_BASE = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";

export class DadataError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "DadataError";
  }
}

/**
 * Whether the DaData integration has its API key set in env.
 * Server-only (reads process.env). Pages call this once and pass the
 * boolean down to client components so they can hide DaData-bound
 * controls instead of letting the user trigger a guaranteed error.
 */
export function isDadataConfigured(): boolean {
  return !!process.env.DADATA_API_KEY;
}

/**
 * POST a JSON body to a DaData endpoint and return the parsed JSON.
 * Throws DadataError on non-2xx responses or missing API key.
 */
export async function dadataPost<TResponse>(
  path: string,
  body: unknown
): Promise<TResponse> {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) {
    // User-facing message — keeps env-var name out of the toast and
    // gives ops a clear next step without leaking implementation
    // detail to end users.
    throw new DadataError(
      "Сервис подсказок DaData не настроен. Обратитесь к администратору."
    );
  }

  const url = `${DADATA_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify(body),
    // DaData returns instantly; cache nothing.
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DadataError(
      `DaData ${path} failed: ${res.status} ${text.slice(0, 200)}`,
      res.status
    );
  }

  return (await res.json()) as TResponse;
}
