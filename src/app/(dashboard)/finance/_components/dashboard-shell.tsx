"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { ru } from "date-fns/locale/ru";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import {
  TableConditions,
  TableControls,
  TableFilterChip,
  TablePageHeader,
} from "@/components/shared/table";
import { setActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import {
  PERIOD_PRESETS,
  defaultPeriod,
  isoDay,
  parseIsoDay,
  periodLabel,
  shiftPeriod,
  type DashboardPeriod,
} from "@/lib/finance/dashboard-period";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/**
 * Шапка и условия финансового дашборда по эталону «страница с периодом»
 * (docs/design-system.md → «Page header»): заголовок один на строке, под ним
 * период слева и инструменты справа, ниже — ряд условий. Период и заведение
 * живут в адресе страницы, юрлицо — общий выбор финансов (cookie), его
 * видят и «Транзакции», и «Счета».
 *
 * Содержимое страницы приходит с сервера через `children`; пока грузится
 * новый период, оно приглушено и помечено `aria-busy`.
 */
export function DashboardShell({
  period,
  venueId,
  venues,
  legalEntityId,
  legalEntities,
  children,
}: {
  period: DashboardPeriod;
  venueId: string | null;
  /** Пусто — фильтра по заведению нет (одно заведение или нет права видеть все). */
  venues: Option[];
  legalEntityId: string | null;
  /** Пусто — выбора юрлица нет (одно юрлицо или нет права видеть все). */
  legalEntities: Option[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const navigate = (next: { period?: DashboardPeriod; venueId?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    const p = next.period ?? period;
    const fallback = defaultPeriod();
    if (p.from === fallback.from && p.to === fallback.to) {
      params.delete("date_from");
      params.delete("date_to");
    } else {
      params.set("date_from", p.from);
      params.set("date_to", p.to);
    }
    const v = next.venueId !== undefined ? next.venueId : venueId;
    if (v) params.set("venue_id", v);
    else params.delete("venue_id");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const changeLegalEntity = (next: string | null) => {
    startTransition(async () => {
      const { error } = await setActiveFinanceLegalEntityId(next);
      if (error) {
        toast.error("Не удалось выбрать юрлицо");
        return;
      }
      router.refresh();
    });
  };

  const hasFilters = !!venueId || !!legalEntityId;
  const canFilter = venues.length > 0 || legalEntities.length > 0;
  const current = defaultPeriod();
  const isCurrent = period.from === current.from && period.to === current.to;

  return (
    <div className="space-y-4">
      <TablePageHeader
        title="Дашборд"
        period={
          <>
            <PeriodStepper
              previous="Предыдущий период"
              next="Следующий период"
              onPrevious={() => navigate({ period: shiftPeriod(period, -1) })}
              onNext={() => navigate({ period: shiftPeriod(period, 1) })}
            >
              <PeriodPicker value={period} onChange={(p) => navigate({ period: p })} />
            </PeriodStepper>
            {/* «Сегодня» возвращает к текущему месяцу — периоду по умолчанию. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              disabled={isCurrent}
              onClick={() => navigate({ period: defaultPeriod() })}
            >
              Сегодня
            </Button>
          </>
        }
        actions={
          canFilter ? (
            <TableControls
              filters={{
                active: hasFilters,
                onClick: () => setFiltersOpen((open) => !open),
              }}
            />
          ) : undefined
        }
      />

      {canFilter ? (
        <TableConditions
          label="Условия дашборда"
          open={filtersOpen}
          hasFilters={hasFilters}
          sorting={[]}
          onSortingChange={() => {}}
          sortFields={[]}
          sortLabels={{}}
          onReset={() => {
            if (venueId) navigate({ venueId: null });
            if (legalEntityId) changeLegalEntity(null);
          }}
        >
          {legalEntities.length > 0 ? (
            <TableFilterChip
              label="Юрлицо"
              value={legalEntityId ?? ""}
              options={legalEntities}
              onChange={(value) => changeLegalEntity(value || null)}
            />
          ) : null}
          {venues.length > 0 ? (
            <TableFilterChip
              label="Заведение"
              value={venueId ?? ""}
              options={venues}
              onChange={(value) => navigate({ venueId: value || null })}
            />
          ) : null}
        </TableConditions>
      ) : null}

      <div
        aria-busy={isPending}
        className={cn(
          "space-y-6 pt-2 transition-opacity duration-200",
          isPending && "pointer-events-none opacity-60",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Середина `PeriodStepper`: подпись периода, по нажатию — быстрый выбор и календарь. */
function PeriodPicker({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (next: DashboardPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>({});
  const today = new Date();

  const choose = (next: DashboardPeriod) => {
    setOpen(false);
    if (next.from !== value.from || next.to !== value.to) onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next)
          setDraft({
            from: parseIsoDay(value.from) ?? undefined,
            to: parseIsoDay(value.to) ?? undefined,
          });
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={periodTriggerClass} aria-label="Выбрать период">
          <CalendarDays className="size-4 shrink-0" />
          <span className="whitespace-nowrap">{periodLabel(value, today)}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-24px)] p-0"
      >
        <div className="flex flex-col sm:flex-row">
          {/* Быстрый выбор — «Выпадающий список вариантов» из DS. */}
          <div className="flex flex-col gap-0.5 border-b p-1 sm:w-48 sm:border-b-0 sm:border-r">
            {PERIOD_PRESETS.map((preset) => {
              const range = preset.range(today);
              const selected = range.from === value.from && range.to === value.to;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => choose(range)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                    selected && "bg-accent",
                  )}
                >
                  {preset.label}
                  {selected ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 p-3">
            <Calendar
              locale={ru}
              mode="range"
              weekStartsOn={1}
              numberOfMonths={1}
              defaultMonth={draft.from ?? today}
              selected={{ from: draft.from, to: draft.to }}
              // Свой выбор диапазона вместо встроенного: у react-day-picker
              // клик при уже выбранном периоде двигает ближайшую границу, и
              // новый период не набрать. Здесь первый клик всегда начинает
              // новый период, второй его закрывает.
              onSelect={(_, day) =>
                setDraft((d) =>
                  !d.from || d.to
                    ? { from: day, to: undefined }
                    : day < d.from
                      ? { from: day, to: d.from }
                      : { from: d.from, to: day },
                )
              }
              className={cn(
                "p-0",
                "[&_[data-range-start=true]]:bg-brand [&_[data-range-start=true]]:text-brand-foreground",
                "[&_[data-range-end=true]]:bg-brand [&_[data-range-end=true]]:text-brand-foreground",
                "[&_[data-range-middle=true]]:bg-brand/15 [&_[data-range-middle=true]]:text-foreground",
                "[&_[data-selected-single=true]]:bg-brand [&_[data-selected-single=true]]:text-brand-foreground",
              )}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {draft.from
                  ? periodLabel(
                      { from: isoDay(draft.from), to: isoDay(draft.to ?? draft.from) },
                      today,
                    )
                  : "Выберите даты"}
              </span>
              <Button
                size="sm"
                disabled={!draft.from}
                onClick={() =>
                  draft.from &&
                  choose({ from: isoDay(draft.from), to: isoDay(draft.to ?? draft.from) })
                }
              >
                Применить
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
