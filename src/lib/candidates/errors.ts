export function candidateError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (/fetch|network|load failed|econn|timeout/i.test(message))
    return "Не удалось связаться с сервером. Повторите попытку.";
  if (
    !/[а-яё]/i.test(message) ||
    /constraint|relation|schema|column|duplicate key|permission denied/i.test(
      message,
    )
  )
    return fallback;
  return message;
}
