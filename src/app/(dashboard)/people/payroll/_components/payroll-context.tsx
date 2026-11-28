"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { loadEmployeePayroll, loadPayroll, reconcileTips } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import type { PayrollData } from "@/lib/payroll/types";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/ui/status-badge";
import { selectClass } from "./select-class";
import { StaffPaySheet } from "./staff-pay-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshFailedNotice, useAutoRefresh } from "./auto-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { DayTeamList, DayTeamSkeleton } from "@/app/(dashboard)/sales/_components/day-team";
import { nativeDayMembers } from "@/lib/sales/day-context";
import { toast } from "sonner";
/** Вкладка «Оплата» в карточке сотрудника: расчётный лист за выбранный месяц. */
export function StaffPayPanel({
  userId,
  initialMonth,
}: {
  userId: string;
  /** Месяц из ссылки «Зарплаты»; вне доступного окна — текущий. */
  initialMonth?: string;
}) {
  const [data, setData] = useState<PayrollData | null>(null),
    [error, setError] = useState(""),
    [picked, setPicked] = useState<string | null>(initialMonth ?? null);
  // Только зарплата этого сотрудника: полную ведомость заведения ради одной
  // вкладки не читаем.
  const reload = useCallback(async () => {
    setData(unwrapAction(await loadEmployeePayroll(userId)));
  }, [userId]);
  const load = useCallback(() => {
    setError("");
    void reload().catch((e) =>
      setError(e instanceof Error ? e.message : "Не удалось загрузить расчёт"),
    );
  }, [reload]);
  useEffect(() => {
    setData(null);
    setPicked(initialMonth ?? null);
    load();
  }, [userId, initialMonth, load]);
  // Расчёт идёт весь день (смены, допродажи): пока вкладка открыта, суммы
  // обновляются сами раз в минуту.
  const autoRefresh = useAutoRefresh(reload, 60000);
  const shell = "mx-auto flex w-full max-w-[720px] flex-col gap-5";
  if (error)
    return (
      <div className={shell}>
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <span>Не удалось загрузить расчёт. {error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Повторить
          </Button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className={shell} aria-busy="true" aria-label="Загружаем расчёт">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-[148px] rounded-[14px]" />
        <Skeleton className="h-[220px] rounded-[14px]" />
        <Skeleton className="h-[120px] rounded-[14px]" />
      </div>
    );
  const employee = data.employees.find((e) => e.local_user_id === userId);
  if (!employee)
    return (
      <div className={shell}>
        <section className="rounded-[14px] border bg-card p-5">
          <h2 className="text-base font-semibold">Расчёта пока нет</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Карточка сотрудника ещё не связана с зарплатой.
            {data.permissions.includes("payroll.view") && (
              <>
                {" "}
                Свяжите её в разделе{" "}
                <Link href="/people/payroll" className="font-medium text-brand hover:underline">
                  Зарплата
                </Link>
                .
              </>
            )}
          </p>
        </section>
      </div>
    );
  // Открываем текущий месяц заведения, а не месяц начала учёта.
  const current = `${(data.asOfDate ?? new Date().toISOString()).slice(0, 7)}-01`;
  const firstAccrual = data.accruals
    .filter((a) => a.employee_id === employee.id)
    .reduce<string | null>(
      (min, a) => (min === null || a.business_date < min ? a.business_date : min),
      null,
    );
  const earliest = `${(data.settings?.starts_on ?? firstAccrual ?? current).slice(0, 7)}-01`;
  const min = earliest > current ? current : earliest;
  const month = picked && picked >= min && picked <= current ? picked : current;
  return (
    <>
      {autoRefresh.failed && (
        <RefreshFailedNotice {...autoRefresh} className="mx-auto mb-4 w-full max-w-[720px]" />
      )}
      <StaffPaySheet
        data={data}
        employee={employee}
        month={month}
        minMonth={min}
        maxMonth={current}
        onMonth={setPicked}
        onChange={reload}
      />
    </>
  );
}
export function PayrollDayPanel({ date }: { date: string }) {
  const [data, setData] = useState<PayrollData | null>(null),
    [error, setError] = useState(""),
    [bank, setBank] = useState(""),
    [category, setCategory] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    const d = unwrapAction(await loadPayroll());
    if (!d.permissions.includes("payroll.view"))
      throw new Error(
        "Начисления команды доступны при наличии права просмотра зарплаты",
      );
    setData(d);
    setCategory(d.settings?.tip_category_id ?? "");
    setBank(Object.values(d.settings?.cashbox_accounts ?? {})[0] ?? "");
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [date]);
  if (error)
    return <p className="p-5 text-sm text-muted-foreground">{error}</p>;
  if (!data)
    return (
      <div className="pt-4">
        <DayTeamSkeleton label="Загружаем расчёт команды" />
      </div>
    );
  // Имя ведёт в карточку сотрудника — только если её можно открыть
  // (страница карточки требует обоих прав), как в команде дня продаж.
  const canOpenStaff =
    data.permissions.includes("people.view_staff") &&
    data.permissions.includes("people.view_staff_details");
  const userIds = new Map(data.employees.map((e) => [e.id, e.local_user_id ?? undefined]));
  const accruals = data.accruals.filter(
      (a) =>
        a.business_date === date && a.calculation_snapshot.kind !== "monthly",
    ),
    cash = data.cashbox.filter((c) => c.business_date === date);
  return (
    <div className="space-y-5 pt-4">
      <DayTeamList
        date={date}
        members={nativeDayMembers(accruals, data.employees).map((m) => ({
          ...m,
          userId: canOpenStaff && m.employeeId ? userIds.get(m.employeeId) : undefined,
        }))}
      />
      <Link
        href={`/schedule/attendance?date=${date}`}
        className="inline-block text-sm text-brand hover:underline"
      >
        Проверить фактические выходы →
      </Link>
      {cash.length > 0 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="font-medium">Выдача чаевых</h3>
          {cash.some((c) => c.source_error) && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Источник изменил проведённую инкассацию. Нужна отдельная сверка.
            </p>
          )}
          {cash.map((c) => (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" key={c.id}>
              <span>
                Инкассация №{c.external_id} · <Money value={Number(c.amount)} />
              </span>
              <StatusBadge
                tone={
                  c.state === "posted"
                    ? "success"
                    : c.state === "cancelled"
                      ? "neutral"
                      : "warning"
                }
              >
                {c.state === "posted"
                  ? "Учтена"
                  : c.state === "cancelled"
                    ? "Отменена"
                    : c.recognition === "ambiguous"
                      ? "Неоднозначный комментарий"
                      : "Выдача не подтверждена"}
              </StatusBadge>
            </p>
          ))}
          {data.permissions.includes("payroll.pay") &&
            cash.some((c) => ["review", "ready"].includes(c.state)) && (
              <>
                <Label>Счёт списания</Label>
                <OptionSelect
                  className={selectClass}
                  aria-label="Счёт выдачи чаевых"
                  value={bank}
                  onValueChange={setBank}
                  placeholder="Выберите счёт"
                  options={[
                    { value: "", label: "Выберите счёт" },
                    ...data.banks.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
                <Label>Статья расхода</Label>
                <OptionSelect
                  className={selectClass}
                  aria-label="Статья выдачи чаевых"
                  value={category}
                  onValueChange={setCategory}
                  placeholder="Выберите статью"
                  options={[
                    { value: "", label: "Выберите статью" },
                    ...data.categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Причина расхождения чаевых"
                  placeholder="Причина расхождения, если больше 100 ₽"
                />
                <Button
                  disabled={busy || !bank || !category}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      unwrapAction(await reconcileTips(date, bank, category, reason));
                      await reload();
                      toast.success("Выдача чаевых учтена в финансах");
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Не удалось учесть выдачу",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Учесть выдачу
                </Button>
              </>
            )}
        </section>
      )}
    </div>
  );
}
