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

/** Legacy RPC errors also use the specific recruitment activity in the UI. */
export function appointmentError(error: unknown, kind: "interview" | "trial") {
  const trial = kind === "trial";
  return candidateError(error, trial ? "Не удалось сохранить стажировку" : "Не удалось сохранить собеседование")
    .replace("Встреча изменена", trial ? "Стажировка изменена" : "Собеседование изменено")
    .replace("Встреча недоступна", trial ? "Стажировка недоступна" : "Собеседование недоступно")
    .replaceAll("встречи", trial ? "стажировки" : "собеседования")
    .replaceAll("встречу", trial ? "стажировку" : "собеседование")
    .replaceAll("со встречей", trial ? "со стажировкой" : "с собеседованием");
}
