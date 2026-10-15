import { CircleDot } from "lucide-react";
import { SalesStatusBadge, salesStatuses } from "./sales-status-badge";

export function SalesShiftsHelp() {
  return (
    <>
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Статусы и фильтры
        </h3>
        <ul className="space-y-4">
          {Object.entries(salesStatuses).map(([status, entry]) => (
            <li key={status} className="space-y-1.5">
              <SalesStatusBadge status={status as keyof typeof salesStatuses} />
              <p className="text-muted-foreground">{entry.description}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Обозначения
        </h3>
        <p className="flex items-start gap-2">
          <CircleDot className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            Текущая смена. Во время загрузки индикатор вращается. Подсказка
            рядом с датой показывает время последнего обновления.
          </span>
        </p>
        <p className="mt-2">
          Суммы указаны в рублях. Прочерк — нет данных; ноль — известный нулевой
          результат. Янтарная точка у значения — ручное исправление. Если данные
          есть не для всех смен, под итогом указано, сколько смен учтено.
        </p>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Работа со сменами
        </h3>
        <p>
          По умолчанию показаны все смены. Кнопка фильтров открывает выбор
          периода и статуса. Итоги считаются по всем найденным сменам,
          независимо от страницы.
        </p>
        <p className="mt-2">
          «Обновить» загружает текущую смену из Quick Resto. Для другого дня
          используйте меню строки. Нажмите дату, чтобы посмотреть показатели и
          историю изменений.
        </p>
        <p className="mt-2">
          Рабочий день, автообновление и правила расчёта настраиваются в
          карточке заведения: Организация → Заведения → Продажи. Ручные
          исправления сохраняются при пересчёте.
        </p>
      </section>
    </>
  );
}
