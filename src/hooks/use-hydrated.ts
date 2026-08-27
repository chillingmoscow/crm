"use client";

import * as React from "react";

/**
 * `false` на сервере и на первом клиентском рендере, `true` — после
 * гидратации.
 *
 * Нужен там, где значение заведомо не совпадёт между SSR и клиентом и
 * его безопаснее дорисовать после mount'а. Первый клиентский рендер
 * обязан совпасть с серверным — иначе лечим одно расхождение
 * гидратации другим.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}

type HiddenAriaControls = { "aria-controls"?: undefined };
type HiddenTabsTriggerIds = { id?: undefined; "aria-controls"?: undefined };
type HiddenTabsContentIds = { id?: undefined; "aria-labelledby"?: undefined };

/** Стабильные ссылки, чтобы спред не создавал новый объект на рендер. */
const KEEP_IDS = {};
const HIDE_ARIA_CONTROLS: HiddenAriaControls = { "aria-controls": undefined };
const HIDE_TABS_TRIGGER_IDS: HiddenTabsTriggerIds = {
  id: undefined,
  "aria-controls": undefined,
};
const HIDE_TABS_CONTENT_IDS: HiddenTabsContentIds = {
  id: undefined,
  "aria-labelledby": undefined,
};

/**
 * Пропсы для Radix-триггера, убирающие `aria-controls` из SSR-разметки;
 * после гидратации атрибут дорисовывается значением самого Radix'а.
 *
 * Зачем. Radix безусловно вешает на триггер `aria-controls={contentId}`,
 * где contentId — это `React.useId()`. В App Router'е useId расходится
 * между сервером и клиентом, если к моменту гидратации чанк клиентского
 * компонента ещё не догрузился: React теряет один уровень «tree id» и
 * выдаёт другой идентификатор (ловится и на проде — достаточно
 * медленной сети). Расхождения в атрибутах React не патчит («This won't
 * be patched up»), поэтому в DOM навсегда остаётся серверный id, а
 * контент, который смонтируется позже уже на клиенте, получает
 * клиентский — связь «триггер → контент» рвётся, плюс ошибка гидратации
 * в консоли.
 *
 * У закрытого триггера `aria-controls` всё равно указывает в пустоту
 * (контента в DOM ещё нет), поэтому в SSR-разметку его не отдаём вовсе.
 * Явный `aria-controls: undefined` перебивает Radix, потому что в
 * примитиве props спредятся ПОСЛЕ его собственного значения.
 *
 * Спредить результат нужно ДО `{...props}` — тогда явный `aria-controls`
 * от вызывающего кода (если вдруг понадобится) переживёт SSR, а не будет
 * затёрт нашим undefined.
 *
 * Применять к триггерам, у которых контент монтируется позже: Dialog,
 * Sheet, AlertDialog, Popover, Select. DropdownMenu не нужен — там Radix
 * сам отдаёт `aria-controls` только когда меню открыто.
 */
export function useSsrSafeAriaControls(): HiddenAriaControls {
  return useHydrated() ? KEEP_IDS : HIDE_ARIA_CONTROLS;
}

/**
 * То же для TabsTrigger: у Radix Tabs из одного `useId()` собираются сразу
 * четыре атрибута — `id` + `aria-controls` на триггере и `id` +
 * `aria-labelledby` на панели. Съезжает базовый id — съезжают все четыре,
 * поэтому прятать надо тоже все: убрать только `aria-controls` мало,
 * оставшийся серверный `id` продолжит расходиться с клиентским.
 *
 * Связь «вкладка ↔ панель» тут не косметика: панель без `forceMount`
 * монтируется на переключении уже на клиенте и получает клиентский id,
 * а на триггере в DOM остаётся серверный `aria-controls`.
 */
export function useSsrSafeTabsTriggerIds(): HiddenTabsTriggerIds {
  return useHydrated() ? KEEP_IDS : HIDE_TABS_TRIGGER_IDS;
}

/** Пара к useSsrSafeTabsTriggerIds — для TabsContent. */
export function useSsrSafeTabsContentIds(): HiddenTabsContentIds {
  return useHydrated() ? KEEP_IDS : HIDE_TABS_CONTENT_IDS;
}
