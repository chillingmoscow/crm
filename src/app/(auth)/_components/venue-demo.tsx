"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Banknote } from "lucide-react";

import { cn } from "@/lib/utils";
import { countRu } from "@/lib/format/plural";
import { StatusBadge, statusTones, type StatusTone } from "@/components/ui/status-badge";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";

/**
 * Живое демо на странице входа: карточки разных разделов одного заведения
 * (продажи, смена, кандидаты, зарплата, инвентаризация, финансы, база
 * знаний), в которых идёт обычный рабочий день. Люди и цифры выдуманы.
 *
 * Движение (docs/motion.md, «Демо заведения на входе»): раз в 2,8 с
 * происходит одно «событие» — новый чек, приход сотрудника, новая анкета.
 * Суммы и проценты досчитываются `AnimatedMoney` / `AnimatedNumber`, текст
 * меняется только когда правда поменялся (`.motion-rise` по `key`). Высоты
 * карточек заданы сеткой, поэтому смена текста ничего не сдвигает. Всё, что
 * может закончиться (акт, разбор платежей, приход на смену), доходит до
 * итога и остаётся — день не «откатывается» назад. При «Уменьшить движение»
 * часы стоят.
 */

const TICK_MS = 2800;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Номер «события» с открытия страницы; в скрытой вкладке время не идёт. */
function useTick(): number {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return tick;
}

/** Сумма чеков и столы — по кругу, выручка при этом только растёт. */
const CHECKS = [
  [650, 12], [1240, 3], [480, 7], [1890, 1],
  [720, 9], [960, 4], [530, 11], [1410, 6],
] as const;
const CHECKS_SUM = CHECKS.reduce((sum, [amount]) => sum + amount, 0);

const CANDIDATES = [
  ["Алина Морозова", "Бариста"],
  ["Дмитрий Орлов", "Официант"],
  ["Софья Лебедева", "Хостес"],
  ["Марк Егоров", "Повар"],
  ["Ева Соколова", "Бармен"],
] as const;

const TEAM: { initials: string; tone: StatusTone }[] = [
  { initials: "АС", tone: "info" },
  { initials: "ИП", tone: "accent" },
  { initials: "МК", tone: "warning" },
  { initials: "ОЗ", tone: "info" },
  { initials: "ТА", tone: "success" },
];

const INBOX = [
  ["3 платежа на разбор", "Финансы · банк прислал утром"],
  ["2 платежа на разбор", "Правило разнесло «Аренда»"],
  ["1 платёж на разбор", "Правило разнесло «Поставщики»"],
  ["Всё разобрано", "Финансы · новых платежей нет"],
] as const;

/** Столбики выручки по часам; последний — текущий час, он растёт. */
const HOURS = [20, 32, 44, 38, 58, 76, 100];

function dayAt(tick: number) {
  let revenue = 184_300 + Math.floor(tick / CHECKS.length) * CHECKS_SUM;
  for (let i = 0; i < tick % CHECKS.length; i++) revenue += CHECKS[i]![0];
  const lastCheck = tick > 0 ? CHECKS[(tick - 1) % CHECKS.length]! : null;
  const candidate = Math.floor(tick / 4);
  const actPercent = Math.min(100, 72 + tick * 3);
  return {
    revenue,
    checks: 212 + tick,
    lastCheck,
    hourBar: Math.min(96, 34 + tick * 3),
    arrived: tick >= 4,
    candidate: CANDIDATES[candidate % CANDIDATES.length]!,
    candidatesWeek: 13 + candidate,
    payrollReady: tick >= 6,
    actPercent,
    inbox: INBOX[Math.min(INBOX.length - 1, Math.floor(tick / 3))]!,
    kbRead: Math.min(14, 9 + Math.floor(tick / 5)),
  };
}

/** Текст, который мягко сменяется, когда поменялся сам. */
function Swap({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("block overflow-hidden", className)}>
      <span key={value} className="motion-rise block truncate">
        {value}
      </span>
    </span>
  );
}

function Tile({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "motion-rise flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background p-5 shadow",
        className,
      )}
      style={{ animationDelay: `${index * 70}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

const label = "text-[13px] text-muted-foreground";

export function VenueDemo() {
  const day = dayAt(useTick());
  const onShift = day.arrived ? 5 : 4;

  return (
    <div aria-hidden className="grid w-full select-none grid-cols-3 grid-rows-[164px_148px_100px] gap-3 text-foreground">
      <Tile index={0} className="col-span-2 gap-3">
        <div className="flex h-6 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          <span className={cn(label, "min-w-0 flex-1 truncate")}>Выручка сегодня · Продажи</span>
          {day.lastCheck && (
            <span key={day.checks} className="motion-rise shrink-0">
              <StatusBadge tone="success">
                +{day.lastCheck[0].toLocaleString("ru-RU")} ₽ · стол {day.lastCheck[1]}
              </StatusBadge>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-end justify-between gap-4">
          <div className="min-w-0">
            <AnimatedMoney value={day.revenue} className="text-[32px] font-bold leading-none tracking-tight" />
            <p className={cn(label, "mt-2 truncate")}>
              <AnimatedNumber value={day.checks} format={(n) => countRu(Math.round(n), "чек", "чека", "чеков")} />
              {" · "}
              <span className="text-emerald-700 dark:text-emerald-400">+12% к неделе</span>
            </p>
          </div>
          <div className="flex h-14 w-40 shrink-0 items-end gap-1">
            {[...HOURS, day.hourBar].map((height, i) => (
              <span
                key={i}
                className={cn(
                  "chart-bar-grow-y flex-1 rounded-t-[3px] transition-[height] duration-500 ease-[var(--ease-soft)]",
                  i >= 5 ? "bg-brand" : "bg-brand/15",
                )}
                style={{ height: `${height}%`, animationDelay: `${200 + i * 60}ms` }}
              />
            ))}
          </div>
        </div>
      </Tile>

      <Tile index={1} className="gap-2">
        <span className={label}>На смене сейчас</span>
        <p className="text-[32px] font-bold leading-none tracking-tight">
          <AnimatedNumber value={onShift} />
          <span className="ml-1.5 text-base font-medium text-muted-foreground">из 5</span>
        </p>
        <div className="mt-auto flex gap-1">
          {TEAM.map((person, i) => (
            <span
              key={person.initials}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-[opacity,transform] duration-500 ease-[var(--ease-soft)]",
                statusTones[person.tone],
                i === TEAM.length - 1 && !day.arrived && "scale-75 opacity-0",
              )}
            >
              {person.initials}
            </span>
          ))}
        </div>
        <Swap value={day.arrived ? "Тимур пришёл в 10:08" : "Тимур в пути"} className="text-xs text-muted-foreground" />
      </Tile>

      <Tile index={2} className="gap-2">
        <span className={label}>Новая анкета</span>
        <div key={day.candidate[0]} className="motion-rise mt-auto min-w-0">
          <p className="truncate text-base font-semibold">{day.candidate[0]}</p>
          <p className="mt-1 truncate text-[13px] text-muted-foreground">{day.candidate[1]} · только что</p>
        </div>
        <StatusBadge tone="accent" className="self-start">
          <AnimatedNumber value={day.candidatesWeek} /> за неделю
        </StatusBadge>
      </Tile>

      <Tile index={3} className="gap-2">
        <span className={label}>Зарплата 5 декабря</span>
        <AnimatedMoney
          value={day.payrollReady ? 412_000 : 409_600}
          className="mt-auto text-2xl font-bold leading-none tracking-tight"
        />
        <Swap
          value={day.payrollReady ? "План готов" : "Считаем часы"}
          className="text-[13px] text-muted-foreground"
        />
      </Tile>

      <Tile index={4} className="gap-2">
        <span className={label}>Акт № 48 · Бар</span>
        <span className="mt-auto text-2xl font-bold leading-none tracking-tight">
          {day.actPercent < 100 ? (
            <AnimatedNumber value={day.actPercent} format={(n) => `${Math.round(n)} %`} />
          ) : (
            <Swap value="Посчитан" />
          )}
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-soft)]",
              day.actPercent < 100 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${day.actPercent}%` }}
          />
        </span>
      </Tile>

      <Tile index={5} className="col-span-2 flex-row items-center gap-3 py-4">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", statusTones.success)}>
          <Banknote />
        </span>
        <div className="min-w-0 flex-1">
          <Swap value={day.inbox[0]} className="text-sm font-semibold" />
          <Swap value={day.inbox[1]} className="text-[13px] text-muted-foreground" />
        </div>
        <span
          className={cn(
            "shrink-0 text-[13px] font-medium text-brand transition-opacity duration-200 ease-in",
            day.inbox === INBOX[INBOX.length - 1] && "opacity-0",
          )}
        >
          Разобрать
        </span>
      </Tile>

      <Tile index={6} className="justify-center gap-1 py-4">
        <span className={label}>База знаний</span>
        <span className="truncate text-sm font-semibold">Стандарты подачи</span>
        <span className="text-xs text-muted-foreground">
          прочитали <AnimatedNumber value={day.kbRead} /> из 14
        </span>
      </Tile>
    </div>
  );
}
