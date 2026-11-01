"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { Button } from "@/components/ui/button";
import {
  departmentMember,
  memberTotal,
  type DayTeam,
  type DayMember,
} from "@/lib/sales/day-context";
import type { AdditionalKind } from "@/lib/sales/additional";
import { money } from "@/lib/sales/format";
import { loadDayTeam } from "../day-actions";

const amount = (v: number | null) => (v === null ? "—" : `${money(v)} ₽`);
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
  return (
    <div className="space-y-4">
      {!!members.length && (
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-4">
          {(
            [
              ["salary", "Начислено"],
              [
                showExtras ? "extras" : "tips",
                showExtras ? "Доля допродаж" : "Чаевые",
              ],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-lg font-semibold tabular-nums">
                {amount(memberTotal(members, key))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="divide-y">
        {members.map((m) => (
          <details key={m.id} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-md">
              <EmployeeIdentity
                name={m.name}
                role={m.position ?? m.role}
                avatarUrl={m.avatarUrl}
              />
              <span className="shrink-0 text-right">
                <span className="block text-sm font-medium tabular-nums">
                  {amount(showExtras ? m.extras : m.salary)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {showExtras
                    ? "Допродажи"
                    : m.issues.length
                      ? "Нужна проверка"
                      : "Начислено"}
                </span>
              </span>
            </summary>
            <div className="space-y-3 pb-4 text-sm">
              {m.issues.map((issue) => (
                <p key={issue} className="text-amber-700 dark:text-amber-400">
                  {issue}
                </p>
              ))}
              <dl className="space-y-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Зарплата за смену</dt>
                  <dd className="tabular-nums">{amount(m.salary)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Чаевые</dt>
                  <dd className="tabular-nums">{amount(m.tips)}</dd>
                </div>
                {!showExtras && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      В том числе допродажи
                    </dt>
                    <dd className="tabular-nums">{amount(m.extras)}</dd>
                  </div>
                )}
              </dl>
              {!showExtras &&
                m.components.map((c, i) => (
                  <div
                    key={i}
                    className="flex justify-between gap-3 border-t pt-2"
                  >
                    <div>
                      {c.label}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.basis}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {amount(c.amount)}
                    </span>
                  </div>
                ))}
              {m.employeeId && (
                <Link
                  className="inline-block text-brand hover:underline"
                  href={`/people/payroll/${m.employeeId}${date?`?month=${date.slice(0,7)}`:""}`}
                >
                  Расчёт сотрудника →
                </Link>
              )}
              {source === "archive" && m.origin && (
                <a
                  className="inline-block text-xs text-muted-foreground hover:text-brand"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(m.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(m.origin.range)}`}
                >
                  Исходная запись Glide ↗
                </a>
              )}
            </div>
          </details>
        ))}
      </div>
      {!members.length && (
        <p className="py-4 text-sm text-muted-foreground">
          {source === "archive"
            ? "В источнике нет сотрудников за этот день."
            : "Начисления за этот день ещё не загружены."}
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
      .then((d) => live && setData(d))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить команду",
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
        Загружаем состав смены…
      </p>
    );
  if (!data.allowed)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Начисления команды доступны с правом просмотра зарплаты.
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
