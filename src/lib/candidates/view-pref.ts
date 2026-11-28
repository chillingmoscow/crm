// Вид списка кандидатов — таблица или доска по этапам; выбор этого браузера.
//
// Хранится в localStorage и дублируется в cookie (как выбор «Обзора»,
// `src/lib/ui/overview-pref.ts`): страницу рисует сервер, а localStorage он не
// видит. Без cookie список появлялся только после загрузки скриптов, чтобы при
// выбранной доске не мелькала таблица.

export type CandidatesView = "table" | "board";

/** Ключ localStorage; `preferenceKey` — «аккаунт:пользователь». */
export function candidatesViewKey(preferenceKey: string) {
  return `candidates.view.${preferenceKey}`;
}

/** Имя cookie для того же выбора. */
export function candidatesViewCookieName(preferenceKey: string) {
  return `sheerly_view_${candidatesViewKey(preferenceKey).replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

/** Значение cookie или localStorage → вид; неизвестно — undefined. */
export function parseCandidatesView(value: string | null | undefined): CandidatesView | undefined {
  return value === "board" || value === "table" ? value : undefined;
}

/** Колонки доски по этапам — по порядку (общие для доски и сервера). */
export const BOARD_STAGES = ["new", "review", "interview", "trial", "rejected"] as const satisfies readonly string[];
