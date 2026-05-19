/**
 * Display-only реестр горячих клавиш для модалки-справки
 * (src/components/shared/hotkeys-dialog.tsx). Сами обработчики живут
 * по месту (sidebar, kb-search-dialog, kb-collection-block и т.д.);
 * этот файл — только источник правды для того, ЧТО показать пользователю.
 *
 * Токен `Mod` рендерится как ⌘ на macOS и Ctrl на остальных платформах
 * (маппинг в компоненте по детекту платформы).
 */

export type HotkeyEntry = {
  /** Абстрактные токены: "Mod", "Shift", "Enter", "Esc", "?", "B"… */
  keys: string[];
  description: string;
};

export type HotkeyGroup = {
  title: string;
  entries: HotkeyEntry[];
};

export const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    title: "Глобально",
    entries: [
      { keys: ["Shift", "?"], description: "Открыть справку по горячим клавишам" },
      { keys: ["Mod", "K"], description: "Поиск по Базе знаний" },
      { keys: ["Mod", "B"], description: "Свернуть / развернуть боковое меню" },
    ],
  },
  {
    title: "База знаний",
    entries: [
      { keys: ["Mod", "K"], description: "Открыть поиск по страницам" },
      { keys: ["Mod", "Z"], description: "Отменить удаление вида коллекции" },
      { keys: ["Mod", "Enter"], description: "Отправить комментарий / ответ в треде" },
      { keys: ["Esc"], description: "Закрыть композер или всплывающее окно" },
    ],
  },
  {
    title: "Редактор страницы",
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
