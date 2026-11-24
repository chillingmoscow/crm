"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, HandCoins, Wallet } from "lucide-react";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
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
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                className="flex w-full items-center justify-between gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                onClick={() => setOpen(expanded ? null : m.id)}
              >
                <EmployeeIdentity
                  name={m.name}
                  role={m.position ?? m.role}
                  avatarUrl={m.avatarUrl}
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
                  <ChevronDown
                    aria-hidden
                    className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {expanded && (
                <div id={panelId} className="space-y-3 pb-4 text-sm">
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
              )}
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
  if (!data)
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        Загружаем команду…
      </p>
    );
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
