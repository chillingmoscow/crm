"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadPayroll, reconcileTips } from "../actions";
import type { PayrollData } from "@/lib/payroll/types";
import { money } from "@/lib/sales/format";
import { EmployeePay, selectClass } from "./employee-pay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DayTeamList } from "@/app/(dashboard)/sales/_components/day-team";
import { nativeDayMembers } from "@/lib/sales/day-context";
import { toast } from "sonner";
export function StaffPayPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<PayrollData | null>(null),
    [error, setError] = useState("");
  const reload = async () => setData(await loadPayroll());
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [userId]);
  if (error)
    return <p className="p-5 text-sm text-muted-foreground">{error}</p>;
  const employee = data?.employees.find((e) => e.local_user_id === userId);
  return (
    <div className="rounded-xl border p-5">
      {data && employee ? (
        <EmployeePay
          data={data}
          employee={employee}
          month={data.settings?.starts_on ?? "2026-09-01"}
          onChange={reload}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {data
            ? "Условия оплаты пока не связаны с карточкой сотрудника. Сопоставьте её в ведомости."
            : "Загружаем условия оплаты…"}
        </p>
      )}
    </div>
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
    const d = await loadPayroll();
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
      <p className="p-5 text-sm text-muted-foreground">
        Загружаем расчёт команды…
      </p>
    );
  const accruals = data.accruals.filter(
      (a) =>
        a.business_date === date && a.calculation_snapshot.kind !== "monthly",
    ),
    cash = data.cashbox.filter((c) => c.business_date === date);
  return (
    <div className="space-y-5 pt-4">
      <DayTeamList
        date={date}
        source="native"
        members={nativeDayMembers(accruals, data.employees)}
      />
      <Link
        href="/schedule/attendance"
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
            <p className="text-sm" key={c.id}>
              Инкассация №{c.external_id} · {money(Number(c.amount))} ₽ ·{" "}
              {c.state === "posted"
                ? "Учтена"
                : c.state === "cancelled"
                  ? "Отменена"
                  : c.recognition === "ambiguous"
                    ? "Неоднозначный комментарий"
                    : "Выдача не подтверждена"}
            </p>
          ))}
          {data.permissions.includes("payroll.pay") &&
            cash.some((c) => ["review", "ready"].includes(c.state)) && (
              <>
                <Label>Счёт списания</Label>
                <select
                  className={selectClass}
                  aria-label="Счёт выдачи чаевых"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                >
                  <option value="">Выберите счёт</option>
                  {data.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <Label>Статья расхода</Label>
                <select
                  className={selectClass}
                  aria-label="Статья выдачи чаевых"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Выберите статью</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                      await reconcileTips(date, bank, category, reason);
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
