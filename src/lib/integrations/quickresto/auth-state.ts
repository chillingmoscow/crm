export type StoredBackOfficeAuth = {
  authorization: string;
  expiresAt: string | null;
};

export function parseStoredBackOfficeAuth(raw: string): StoredBackOfficeAuth | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBackOfficeAuth>;
    if (typeof parsed.authorization === "string" && /^Bearer \S+$/.test(parsed.authorization)) {
      return {
        authorization: parsed.authorization,
        expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
      };
    }
  } catch {
    // Старая cookie-строка не является токеном и требует нового входа.
  }
  return null;
}

export function isBackOfficeAuthFresh(auth: StoredBackOfficeAuth, now = Date.now()) {
  // Неизвестный срок действия нельзя трактовать как бессрочный токен.
  if (!auth.expiresAt) return false;
  const expiresAtMs = Date.parse(auth.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs - now > 60_000;
}

export function isBackOfficeAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^Quick Resto back-office auth failed \((401|3\d\d)\)/.test(message);
}

export function isBackOfficePermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Quick Resto back-office access denied (403)");
}
