"use client";
import Link from "next/link";
import { DisciplineSettings } from "./discipline-settings";
import { AutomationSettings } from "./automation-settings";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayrollRules, payrollCommand } from "../actions";
import { selectClass } from "./employee-pay";
import { PayrollSetup } from "./payroll-setup";
import { PayrollInitialData } from "./payroll-initial-data";
export function PayrollSettings({ venueId }: { venueId: string }) {
  const [data, setData] = useState<PayrollData | null>(null),
    [error, setError] = useState(""),
    [comments, setComments] = useState(""),
    [category, setCategory] = useState(""),
    [salaryCategory, setSalaryCategory] = useState(""),
    [cashAccounts, setCashAccounts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [benefitsConfirmed, setBenefitsConfirmed] = useState(false);
  const reload = useCallback(async () => {
    const d = await loadPayrollRules();
    if (d.venueId !== venueId)
      throw new Error(
        "Выберите это заведение в переключателе, чтобы изменить его условия оплаты",
      );
    if (!d.permissions.includes("payroll.configure"))
      throw new Error("Нет доступа к настройке оплаты труда");
    setData(d);
    setComments(d.settings?.tip_comments.join("\n") ?? "чаевые");
    setBenefitsConfirmed(d.settings?.benefits_mode === "active");
    setCategory(d.settings?.tip_category_id ?? "");
    setSalaryCategory(d.settings?.salary_category_id ?? "");
    setCashAccounts(d.settings?.cashbox_accounts ?? {});
  }, [venueId]);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [reload]); // scoped server loader protects other venues
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <p className="rounded-xl border p-5 text-sm text-muted-foreground">
        {error}
      </p>
    );
  if (!data)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        Загружаем условия оплаты…
      </p>
    );
  return (
    <div className="space-y-6">
      <PayrollSetup data={data} onChange={reload} /><DisciplineSettings />
      <AutomationSettings key={venueId} venueId={venueId} />
      <section className="rounded-xl border p-5"><h2 className="font-semibold">Оплата должностей</h2><div className="mt-4 flex flex-wrap gap-2">{(data.roles??[]).filter(r=>data.models.some(m=>m.role_id===r.id&&m.is_role_default&&!m.archived)).map(r=><Button key={r.id} variant="outline" size="sm" asChild><Link href={`/people/roles/${r.id}?tab=compensation`}>{r.name}</Link></Button>)}</div></section>
      <form
        className="space-y-4 rounded-xl border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            payrollCommand("settings", {
              benefits_mode: benefitsConfirmed ? "active" : "review",
              ...(data.permissions.includes("payroll.pay") &&
              data.permissions.includes("finance.create_transaction")
                ? {
                    tip_comments: comments
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    tip_category_id: category,
                    salary_category_id: salaryCategory,
                    cashbox_accounts: Object.fromEntries(
                      Object.entries(cashAccounts).filter(([, value]) => value),
                    ),
                  }
                : {}),
            }),
          );
        }}
      >
        <h2 className="font-semibold">Выдача чаевых и финансы</h2>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={benefitsConfirmed}
            onCheckedChange={(v) => setBenefitsConfirmed(v === true)}
          />
          Правила надбавок проверены. Начислять стаж и знания по подтверждённым
          тестам.
        </label>
        <p className="text-sm text-muted-foreground">
          Распознаём точное совпадение комментария инкассации. Суммируем
          операции за рабочий день; до 100 ₽ включительно считаем округлением.
        </p>
        <Label htmlFor="tip-comments">Комментарии · один на строку</Label>
        <textarea
          id="tip-comments"
          className="min-h-20 w-full rounded-md border bg-background p-3 text-base md:text-sm"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ...new Set([
              ...data.cashbox.map((c) => String(c.kkm_id)),
              ...Object.keys(cashAccounts),
            ]),
          ].map((id) => (
            <div className="space-y-2" key={id}>
              <Label htmlFor={`tip-bank-${id}`}>Касса {id} · счёт выдачи</Label>
              <select
                id={`tip-bank-${id}`}
                className={selectClass}
                value={cashAccounts[id] ?? ""}
                disabled={
                  !data.permissions.includes("payroll.pay") ||
                  !data.permissions.includes("finance.create_transaction")
                }
                onChange={(e) =>
                  setCashAccounts((current) => ({
                    ...current,
                    [id]: e.target.value,
                  }))
                }
              >
                <option value="">Не настроен</option>
                {data.banks.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {!data.cashbox.length && !Object.keys(cashAccounts).length && (
            <p className="text-sm text-muted-foreground">
              Кассы появятся после загрузки инкассаций Quick Resto.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="tip-category">Статья чаевых</Label>
            <select
              id="tip-category"
              className={selectClass}
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="salary-category">Статья зарплаты</Label>
            <select
              id="salary-category"
              className={selectClass}
              value={salaryCategory}
              onChange={(e) => setSalaryCategory(e.target.value)}
            >
              <option value="">Выберите статью</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button
          disabled={
            busy ||
            (data.permissions.includes("payroll.pay") &&
              data.permissions.includes("finance.create_transaction") &&
              (!category || !salaryCategory))
          }
        >
          Сохранить
        </Button>
      </form>
      <PayrollInitialData venueId={venueId} />

    </div>
  );
}
