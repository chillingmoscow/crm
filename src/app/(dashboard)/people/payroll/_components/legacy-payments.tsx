"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import type { PayrollData } from "@/lib/payroll/types";
import { Money } from "@/components/shared/money";
import { countRu } from "@/lib/format/plural";
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
          {countRu(rows.length, "запись", "записи", "записей")} ·{" "}
          <Money value={rows.reduce((s, p) => s + Number(p.amount), 0)} />. Ещё не
          включены в «Выплачено». Подтверждение создаст расход в финансах;
          повторное подтверждение не создаст его снова.
        </p>
      </div>
      {data.permissions.includes("payroll.approve") &&
        data.permissions.includes("payroll.pay") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="legacy-bank">Счёт Sheerly</Label>
              <OptionSelect
                id="legacy-bank"
                className={selectClass}
                value={bank}
                onValueChange={setBank}
                placeholder="Выберите счёт"
                options={[
                  { value: "", label: "Выберите счёт" },
                  ...data.banks.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </div>
            <div>
              <Label htmlFor="legacy-category">Статья расхода</Label>
              <OptionSelect
                id="legacy-category"
                className={selectClass}
                value={category}
                onValueChange={setCategory}
                placeholder="Выберите статью"
                options={[
                  { value: "", label: "Выберите статью" },
                  ...data.categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
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
                <Money value={Number(p.amount)} fraction={!Number.isInteger(Number(p.amount))} />
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
