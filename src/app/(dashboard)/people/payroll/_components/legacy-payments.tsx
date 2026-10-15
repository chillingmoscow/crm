"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PayrollData } from "@/lib/payroll/types";
import { money } from "@/lib/sales/format";
import { confirmLegacyPayment } from "../actions";
import { selectClass } from "./employee-pay";
export function LegacyPayments({
  data,
  month,
  onChange,
}: {
  data: PayrollData;
  month: string;
  onChange: () => Promise<void>;
}) {
  const [bank, setBank] = useState(""),
    [category, setCategory] = useState(data.settings?.salary_category_id ?? ""),
    [busy, setBusy] = useState<string | null>(null);
  const rows = data.legacyPayments
    .filter((p) => p.month === month && p.state === "review")
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (!rows.length) return null;
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-medium">
          Прежние выплаты · требуется подтверждение
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} записей ·{" "}
          {money(rows.reduce((s, p) => s + Number(p.amount), 0))} ₽. Ещё не
          включены в «Выплачено». Подтверждение создаст расход в финансах;
          повторное подтверждение не создаст его снова.
        </p>
      </div>
      {data.permissions.includes("payroll.approve") &&
        data.permissions.includes("payroll.pay") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="legacy-bank">Счёт Sheerly</Label>
              <select
                id="legacy-bank"
                className={selectClass}
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
            </div>
            <div>
              <Label htmlFor="legacy-category">Статья расхода</Label>
              <select
                id="legacy-category"
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
          </div>
        )}
      <div className="divide-y">
        {rows.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="text-sm font-medium">
                {data.employees.find((e) => e.id === p.employee_id)?.name} ·{" "}
                {money(Number(p.amount))} ₽
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(p.occurred_at).toLocaleDateString("ru-RU", {
                  timeZone: data.timezone,
                })}{" "}
                · {p.source_bank}
              </p>
            </div>
            {data.permissions.includes("payroll.approve") &&
              data.permissions.includes("payroll.pay") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy || !bank || !category}
                  onClick={async () => {
                    setBusy(p.id);
                    try {
                      await confirmLegacyPayment(p.id, bank, category);
                      await onChange();
                      toast.success("Историческая выплата учтена");
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Не удалось подтвердить",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Подтвердить
                </Button>
              )}
          </div>
        ))}
      </div>
    </section>
  );
}
