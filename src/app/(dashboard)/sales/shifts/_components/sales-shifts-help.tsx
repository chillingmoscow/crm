import { ColorDot } from "@/components/ui/color-dot";
import { CircleDot } from "lucide-react";
import { SalesStatusBadge, salesStatuses, type SalesStatusKey } from "./sales-status-badge";

// Справка раздела «Смены» (/sales/shifts) для кнопки «?» в верхней панели.
export function SalesShiftsHelp() {
  return (
    <>
      <section className="space-y-2">
        <h3 className="font-semibold">Что здесь</h3>
        <p>
          Показатели каждого рабочего дня за выбранный месяц: оборот, чаевые,
          парковка, такси, чеки, депозиты. Данные приходят из Quick Resto,
          рабочий день начинается в час, указанный в карточке заведения.
          Стрелки у месяца листают период, «Сегодня» возвращает к текущему.
        </p>
        <p>
          Итоги над таблицей и строка «Итого» считаются по всем найденным
          сменам месяца, независимо от страницы. Если у части смен значения
          нет, под итогом написано, по скольким сменам он посчитан.
        </p>
        <p>
          План месяца задаётся в «Настройках продаж». Кольцо под итогами
          показывает долю плана по обороту, светлая дуга — прогноз на конец
          месяца: средний оборот закрытой смены, умноженный на смены, которые
          ещё будут при том же ритме работы.
        </p>
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Статусы</h3>
        <ul className="space-y-3">
          {(Object.keys(salesStatuses) as SalesStatusKey[]).map((status) => (
            <li key={status} className="space-y-1">
              <SalesStatusBadge status={status} />
              <p className="text-muted-foreground">
                {salesStatuses[status].description}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Обозначения</h3>
        <p className="flex items-start gap-2">
          <CircleDot className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            Текущая смена. Пока она обновляется, значок вращается; подсказка
            показывает время последнего обновления.
          </span>
        </p>
        <p className="flex items-center gap-2">
          <ColorDot color="purple" size="sm" />
          <span>Значение исправлено вручную. Исходное значение в подсказке.</span>
        </p>
        <p>Прочерк: данных нет. Ноль: известный нулевой результат.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Смена</h3>
        <p>
          Нажмите строку, чтобы открыть смену: показатели, команду с
          начислениями, комментарии и историю. Там же сверка поступлений по
          счетам, контроль кассы и инкассации.
        </p>
        <p>
          Показатель можно исправить вручную с указанием причины. Исправление
          не теряется при обновлении из Quick Resto, его можно снять кнопкой
          «Вернуть исходное». Бар и чаевые со сбором пересчитываются из
          составляющих, если их не исправляли отдельно.
        </p>
        <p>
          «Обновить смену» загружает текущий рабочий день из Quick Resto.
          Другой день обновляется из меню строки. Рабочий день, автообновление,
          пересчёт истории, сверка поступлений и кассы настраиваются на
          странице «Настройки продаж» (кнопка с шестерёнкой в ряду
          инструментов).
        </p>
      </section>
    </>
  );
}
