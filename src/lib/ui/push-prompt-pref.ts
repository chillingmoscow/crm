// Показывать ли баннер «Включите уведомления» — решение браузера, сохранённое
// в cookie. Разрешение на уведомления знает только браузер, поэтому раньше
// баннер появлялся после загрузки скриптов и сдвигал всю страницу вниз.
// Теперь браузер записывает решение («show», «ios» — подсказка про экран «Домой», «hide»), и со следующего захода
// сервер сразу рисует страницу с баннером или без него.
export const PUSH_PROMPT_COOKIE = "sheerly_push_prompt";

export type PushPromptState = "show" | "ios" | "hide";

/** Значение cookie → решение; неизвестно — undefined (баннер не рисуем). */
export function parsePushPrompt(value: string | undefined): PushPromptState | undefined {
  return value === "show" || value === "ios" || value === "hide" ? value : undefined;
}
