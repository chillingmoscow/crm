"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, HandCoins, Wallet } from "lucide-react";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { Money } from "@/components/shared/money";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DrawerSummary, DrawerSummaryItem } from "@/components/ui/drawer-blocks";
import {
  departmentMember,
  memberTotal,
  type DayTeam,
  type DayMember,
} from "@/lib/sales/day-context";
import type { AdditionalKind } from "@/lib/sales/additional";
import { unwrapAction } from "@/lib/actions/result";
import { loadDayTeam } from "../day-actions";

export function DayTeamList({
  members,
  source,
  showExtras = false,
  date,
}: {
  members: DayMember[];
  source: "native" | "archive";
  showExtras?: boolean;
  date?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {!!members.length && (
        <DrawerSummary label="Итоги команды за день">
          <DrawerSummaryItem icon={<Wallet />} label="Начислено">
            <Money value={memberTotal(members, "salary")} />
          </DrawerSummaryItem>
          <DrawerSummaryItem
            icon={<HandCoins />}
            label={showExtras ? "Доля допродаж" : "Чаевые"}
          >
            <Money value={memberTotal(members, showExtras ? "extras" : "tips")} />
          </DrawerSummaryItem>
        </DrawerSummary>
      )}
      <ul className="divide-y">
        {members.map((m) => {
          const expanded = open === m.id;
          const panelId = `day-member-${m.id}`;
          return (
            <li key={m.id}>
              {/* Строка раскрывает расчёт, имя ведёт в карточку сотрудника и
                  строку не раскрывает (DS «Кликабельное имя»). С клавиатуры
                  раскрывает кнопка-шеврон. */}
              <div
                className="flex w-full cursor-pointer items-center justify-between gap-3 py-3 text-left"
                onClick={() => setOpen(expanded ? null : m.id)}
              >
                <EmployeeIdentity
                  name={m.name}
                  role={m.position ?? m.role}
                  avatarUrl={m.avatarUrl}
                  href={m.userId ? `/people/staff/${m.userId}` : undefined}
                />
                <span className="flex shrink-0 items-center gap-2 text-right">
                  <span>
                    <Money
                      className="block text-sm font-medium"
                      value={showExtras ? m.extras : m.salary}
                    />
                    <span
                      className={
                        !showExtras && m.issues.length
                          ? "block text-xs text-amber-700 dark:text-amber-400"
                          : "block text-xs text-muted-foreground"
                      }
                    >
                      {showExtras
                        ? "Допродажи"
                        : m.issues.length
                          ? "Нужна проверка"
                          : "Начислено"}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={`Расчёт: ${m.name}`}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(expanded ? null : m.id);
                    }}
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn("motion-chevron size-4", expanded && "rotate-180")}
                    />
                  </button>
                </span>
              </div>
              <ExpandPanel id={panelId} open={expanded}>
                <div className="space-y-3 pb-4 text-sm">
                  {m.issues.map((issue) => (
                    <p
                      key={issue}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      {issue}
                    </p>
                  ))}
                  <dl className="space-y-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        Зарплата за смену
                      </dt>
                      <dd>
                        <Money value={m.salary} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Чаевые</dt>
                      <dd>
                        <Money value={m.tips} />
                      </dd>
                    </div>
                    {!showExtras && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          В том числе допродажи
                        </dt>
                        <dd>
                          <Money value={m.extras} />
                        </dd>
                      </div>
                    )}
                  </dl>
                  {!showExtras &&
                    m.components.map((c, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 border-t pt-2"
                      >
                        <div className="min-w-0">
                          <p className="break-words">{c.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.basis}
                          </p>
                        </div>
                        <Money className="shrink-0" value={c.amount} />
                      </div>
                    ))}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {m.employeeId && (
                      <Link
                        className="text-[13px] text-brand hover:underline"
                        href={`/people/payroll/${m.employeeId}${date ? `?month=${date.slice(0, 7)}` : ""}`}
                      >
                        Расчёт сотрудника
                      </Link>
                    )}
                    {source === "archive" && m.origin && (
                      <a
                        className="text-[13px] text-brand hover:underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(m.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(m.origin.range)}`}
                      >
                        Исходная запись в архиве Glide
                      </a>
                    )}
                  </div>
                </div>
              </ExpandPanel>
            </li>
          );
        })}
      </ul>
      {!members.length && (
        <p className="py-4 text-sm text-muted-foreground">
          {source === "archive"
            ? "В архиве нет сотрудников за этот день"
            : "Начисления за этот день ещё не загружены"}
        </p>
      )}
    </div>
  );
}
export function DayTeamPanel({
  venueId,
  date,
  source,
  archiveId,
  kind,
}: {
  venueId: string;
  date: string;
  source: "native" | "archive";
  archiveId?: string;
  kind?: AdditionalKind;
}) {
  const [data, setData] = useState<DayTeam | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    void loadDayTeam(venueId, date, source, archiveId)
      .then(unwrapAction)
      .then((d) => live && setData(d))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error && /[А-Яа-яЁё]/.test(e.message)
              ? e.message
              : "Не удалось загрузить команду",
          ),
      );
    return () => {
      live = false;
    };
  }, [venueId, date, source, archiveId, attempt]);
  if (error)
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p className="text-destructive">{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAttempt((x) => x + 1)}
        >
          Повторить
        </Button>
      </div>
    );
  if (!data) return <DayTeamSkeleton />;
  if (!data.allowed)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Начисления команды видны с правом просмотра зарплаты
      </p>
    );
  const members = kind
    ? data.members.filter((m) => departmentMember(m, kind))
    : data.members;
  return (
    <div className="space-y-3">
      <DayTeamList date={date} members={members} source={source} showExtras={!!kind} />
    </div>
  );
}

/** Скелетон команды дня: итоги и три строки «аватар, имя, сумма». */
export function DayTeamSkeleton({ label = "Загружаем команду" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy className="space-y-4">
      <Skeleton className="h-16 rounded-xl" />
      <div className="divide-y">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
