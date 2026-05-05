const DEFAULT_AUTH_REDIRECT = "/dashboard";

/**
 * Accept only same-origin relative paths for auth continuation redirects.
 * Values like `//evil.com` are network-path URLs and must not be passed to
 * `new URL(next, baseUrl)`.
 */
export function safeAuthRedirectPath(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_REDIRECT,
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  return value;
}
