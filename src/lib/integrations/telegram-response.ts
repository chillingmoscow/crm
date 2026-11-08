/** A malformed response cannot establish whether Telegram delivered the request. */
export type TelegramApiResult<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  uncertain?: boolean;
};

export async function readTelegramResponse<T>(
  response: Response,
): Promise<TelegramApiResult<T>> {
  const body: unknown = await response.json().catch(() => null);
  const unknown = (): TelegramApiResult<T> => ({
    ok: false,
    uncertain: true,
    description: `Некорректный ответ Telegram (${response.status})`,
  });
  if (!body || typeof body !== "object" || !("ok" in body)) return unknown();
  const value = body as Record<string, unknown>;
  if (value.ok === true && response.ok && value.result != null)
    return { ok: true, result: value.result as T };
  // Only a complete API rejection is safe to retry. HTTP status alone is not a delivery verdict.
  if (
    value.ok === false &&
    value.result == null &&
    Number.isInteger(value.error_code) &&
    typeof value.description === "string" &&
    value.description.length > 0
  )
    return { ok: false, description: value.description };
  return unknown();
}

export function telegramMessageReceipt(
  value: TelegramApiResult<{ message_id?: number }>,
): { messageId: number | null; uncertain: boolean } {
  const id = value.result?.message_id;
  if (!value.uncertain && value.ok && Number.isSafeInteger(id) && (id ?? 0) > 0)
    return { messageId: id!, uncertain: false };
  return {
    messageId: null,
    uncertain: !!value.uncertain || value.ok || value.result != null,
  };
}
