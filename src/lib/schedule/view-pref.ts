// Выбор вида «Расписания» в этом браузере: вид сетки, показ задач и порядок
// строк «По шаблонам».
//
// Хранится в localStorage и дублируется в cookie: страницу рисует сервер, а
// localStorage он не видит. Без cookie сервер рисовал вид по умолчанию, и
// после загрузки скриптов сетка перестраивалась на запомненный. С cookie
// сервер сразу рисует то, что человек выбрал. Тот же приём — у «Обзора»
// (`src/lib/ui/overview-pref.ts`).

import { isTemplateSort, type TemplateSort } from "./template-order.ts";

export type ScheduleView = "week" | "list" | "templates";
export type SchedulePrefKind = "view" | "tasks" | "templateSort";

/** Выбор, прочитанный сервером из cookie; нет cookie — поле не задано. */
export type SchedulePrefs = {
  view?: ScheduleView;
  showTasks?: boolean;
  templateSort?: TemplateSort;
};

const STORAGE_PREFIX: Record<SchedulePrefKind, string> = {
  view: "schedule.view",
  tasks: "schedule.tasks",
  templateSort: "schedule.templateSort",
};

/** Ключ localStorage: `schedule.view.<заведение>.<пользователь>`. */
export function schedulePrefStorageKey(kind: SchedulePrefKind, venueId: string, userId: string) {
  return `${STORAGE_PREFIX[kind]}.${venueId}.${userId}`;
}

/** Имя cookie для того же ключа — без точек, дефисов и прочих символов. */
export function schedulePrefCookieName(kind: SchedulePrefKind, venueId: string, userId: string) {
  return `sheerly_${schedulePrefStorageKey(kind, venueId, userId).replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export function isScheduleView(value: unknown): value is ScheduleView {
  return value === "week" || value === "list" || value === "templates";
}

/** Значения cookie (или localStorage) → выбор; мусор и пустота — не задано. */
export function parseSchedulePrefs(values: {
  view?: string | null;
  tasks?: string | null;
  templateSort?: string | null;
}): SchedulePrefs {
  const prefs: SchedulePrefs = {};
  if (isScheduleView(values.view)) prefs.view = values.view;
  if (values.tasks === "true" || values.tasks === "false") prefs.showTasks = values.tasks === "true";
  if (isTemplateSort(values.templateSort)) prefs.templateSort = values.templateSort;
  return prefs;
}

/** Записать выбор в cookie (в браузере), рядом с localStorage. */
export function writeSchedulePrefCookie(kind: SchedulePrefKind, venueId: string, userId: string, value: string) {
  document.cookie = `${schedulePrefCookieName(kind, venueId, userId)}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
