import "server-only";

/**
 * Dev-only impersonation («смотреть глазами другого пользователя»).
 *
 * Доступ выдаётся ТОЛЬКО через env — намеренно не через реестр прав и не
 * через роль в БД. Причина: механика по-настоящему подменяет сессию
 * (см. src/lib/impersonation/actions.ts), то есть это полноценный
 * account-takeover primitive. Пока он не обвязан аудитом и UI для
 * клиентов, единственный способ его включить — доступ к переменным
 * окружения прода.
 *
 * Пустой/незаданный список = фича выключена целиком.
 */
const ENV_KEY = "IMPERSONATION_ALLOWED_USER_IDS";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** uuid'ы из env, через запятую. Мусор молча отбрасывается. */
function allowlist(): string[] {
  return (process.env[ENV_KEY] ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => UUID_RE.test(id));
}

/** Включена ли фича в этом окружении вообще. */
export function isImpersonationEnabled(): boolean {
  return allowlist().length > 0;
}

/** Может ли конкретный пользователь запускать impersonation. */
export function isImpersonationAllowed(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return allowlist().includes(userId.toLowerCase());
}
