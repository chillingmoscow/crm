/**
 * Display-only реестр горячих клавиш для модалки-справки
 * (src/components/shared/hotkeys-dialog.tsx). Сами обработчики живут
 * по месту (sidebar, kb-search-dialog, documents-table и т.д.);
 * этот файл — только источник правды для того, ЧТО показать пользователю.
 *
 * Группы помечены `section`: «global» показывается всегда, остальные —
 * только в своём разделе (по pathname). Так пользователь видит глобальные
 * клавиши + клавиши текущего раздела, а не весь список разом.
 *
 * Токен `Mod` рендерится как ⌘ на macOS и Ctrl на остальных платформах
 * (маппинг в компоненте по детекту платформы).
 */

export type HotkeySection = "global" | "knowledge" | "inventory";

export type HotkeyEntry = {
  /** Абстрактные токены: "Mod", "Shift", "Enter", "Esc", "?", "B"… */
  keys: string[];
  description: string;
};

export type HotkeyGroup = {
  title: string;
  section: HotkeySection;
  entries: HotkeyEntry[];
};

export const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    title: "Глобально",
    section: "global",
    entries: [
      { keys: ["Shift", "?"], description: "Открыть справку по горячим клавишам" },
      { keys: ["Mod", "K"], description: "Поиск по Базе знаний" },
      { keys: ["Mod", "B"], description: "Свернуть / развернуть боковое меню" },
    ],
  },
  {
    title: "Акты инвентаризации (список)",
    section: "inventory",
    entries: [
      { keys: ["J"], description: "Следующая строка" },
      { keys: ["K"], description: "Предыдущая строка" },
      { keys: ["Enter"], description: "Открыть выделенный акт" },
      { keys: ["/"], description: "Поиск" },
      { keys: ["F"], description: "Показать / скрыть фильтры" },
    ],
  },
  {
    title: "База знаний",
    section: "knowledge",
    entries: [
      { keys: ["Mod", "K"], description: "Открыть поиск по страницам" },
      { keys: ["Mod", "Shift", "L"], description: "Заблокировать / разблокировать страницу" },
      { keys: ["Mod", "Shift", "F"], description: "Добавить / убрать страницу из избранного" },
      { keys: ["Mod", "Shift", "D"], description: "Дублировать страницу" },
      { keys: ["Mod", "Shift", "P"], description: "Создать новую страницу" },
      { keys: ["Mod", "Shift", "H"], description: "Открыть историю версий" },
      { keys: ["Mod", "Z"], description: "Отменить удаление вида коллекции" },
      { keys: ["Mod", "Enter"], description: "Отправить комментарий / ответ в треде" },
      { keys: ["Esc"], description: "Закрыть композер или всплывающее окно" },
    ],
  },
  {
    title: "Редактор страницы",
    section: "knowledge",
    entries: [
      { keys: ["Mod", "B"], description: "Жирный текст" },
      { keys: ["Mod", "I"], description: "Курсив" },
      { keys: ["Mod", "U"], description: "Подчёркнутый" },
      { keys: ["/"], description: "Меню блоков (вставить блок)" },
      { keys: ["Enter"], description: "Новый блок" },
      { keys: ["Shift", "Enter"], description: "Перенос строки внутри блока" },
    ],
  },
];

/**
 * Группы для текущего пути: всегда «global» + те, чей раздел совпадает с
 * pathname. KB-клавиши — только в /knowledge, инвентарные — в
 * /documents/inventory.
 */
export function hotkeyGroupsForPath(pathname: string | null | undefined): HotkeyGroup[] {
  const path = pathname ?? "";
  return HOTKEY_GROUPS.filter((group) => {
    if (group.section === "global") return true;
    if (group.section === "knowledge") return path.startsWith("/knowledge");
    if (group.section === "inventory") return path.startsWith("/documents/inventory");
    return false;
  });
}
