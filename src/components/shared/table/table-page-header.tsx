import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TablePageHeaderProps = {
  title: ReactNode;
  /** Число записей раздела; при активных условиях — строка «N из M». */
  count?: number | string;
  /**
   * Описание под заголовком. У списков по эталону его нет (что это за
   * страница, объясняет справка «?»); оставлено для страниц, которые ещё не
   * приведены к эталону.
   */
  subtitle?: ReactNode;
  meta?: ReactNode;
  /**
   * Период или вид страницы: `PeriodStepper`, «Сегодня». Если задан, заголовок
   * стоит один на строке, а инструменты переезжают в строку периода.
   */
  period?: ReactNode;
  /** Инструменты и главная кнопка: всегда в нижней строке шапки, справа. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Шапка страницы-списка. Правило из `docs/design-system.md` → «Page header»:
 * инструменты стоят в нижней строке шапки — в строке периода, если он есть,
 * и напротив заголовка, если его нет.
 */
export function TablePageHeader({
  title,
  count,
  subtitle,
  meta,
  period,
  actions,
  className,
}: TablePageHeaderProps) {
  const heading = (
    <div className="min-w-0">
      <h1 className="truncate text-[28px] font-bold leading-[1.2] tracking-[-0.5px] sm:text-[36px]">
        {count === undefined ? (
          title
        ) : (
          <span className="inline-flex items-center gap-3">
            {title}
            <span
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-2 text-sm font-normal tracking-normal tabular-nums text-muted-foreground"
              aria-label={`Всего: ${count}`}
            >
              {count}
            </span>
          </span>
        )}
      </h1>
      {subtitle ? (
        <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
      ) : null}
      {meta ? <div className="mt-2 flex flex-wrap gap-2">{meta}</div> : null}
    </div>
  );
  const tools = actions ? (
    <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
      {actions}
    </div>
  ) : null;

  if (period)
    return (
      <div className={cn("flex flex-col gap-5", className)}>
        {heading}
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {period}
          </div>
          {tools}
        </div>
      </div>
    );

  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:flex-row md:flex-wrap md:justify-between",
        // С описанием инструменты прижаты к низу, в линию с ним; без описания
        // стоят по центру высоты заголовка.
        subtitle ? "md:items-end" : "md:items-center",
        className,
      )}
    >
      {heading}
      {tools}
    </div>
  );
}
