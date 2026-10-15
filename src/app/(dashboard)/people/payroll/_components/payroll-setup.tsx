"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDrawer } from "@/components/ui/edit-drawer";
import type { PayrollData } from "@/lib/payroll/types";
import { payrollCommand } from "../actions";
import { selectClass } from "./employee-pay";
export function PayrollSetup({
  data,
  onChange,
}: {
  data: PayrollData;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState<"model" | "employee" | null>(null),
    [name, setName] = useState(""),
    [role, setRole] = useState("Мастер"),
    [basis, setBasis] = useState("hookah"),
    [monthly, setMonthly] = useState("0"),
    [staff, setStaff] = useState(""),
    [model, setModel] = useState(""),
    [hired, setHired] = useState(""),
    [busy, setBusy] = useState(false),
    [starts, setStarts] = useState("2026-09-01"),
    [qrVenue, setQrVenue] = useState("");
  const run = async (action: string, input: Record<string, unknown>) => {
    setBusy(true);
    try {
      await payrollCommand(action, input);
      await onChange();
      setOpen(null);
      toast.success("Сохранено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  if (!data.settings)
    return (
      <form
        className="space-y-3 rounded-xl border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run("initialize", {
            starts_on: starts,
            quickresto_venue_id: Number(qrVenue),
          });
        }}
      >
        <h2 className="font-medium">Начало учёта зарплаты</h2>
        <p className="text-sm text-muted-foreground">
          Модели и правила настраиваются в Sheerly. Для фактических выходов
          используется подключение Quick Resto заведения.
        </p>
        <Label htmlFor="pay-starts">Первый расчётный месяц</Label>
        <Input
          id="pay-starts"
          type="month"
          value={starts.slice(0, 7)}
          onChange={(e) => setStarts(`${e.target.value}-01`)}
          required
        />
        <Label htmlFor="pay-qr-venue">ID заведения Quick Resto</Label>
        <Input
          id="pay-qr-venue"
          type="number"
          min="1"
          value={qrVenue}
          onChange={(e) => setQrVenue(e.target.value)}
          required
        />
        <Button disabled={busy}>Начать учёт</Button>
      </form>
    );
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setOpen("model")}>
          Добавить модель
        </Button>
        <Button variant="outline" onClick={() => setOpen("employee")}>
          Настроить сотрудника
        </Button>
      </div>
      <EditDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open === "model" ? "Новая модель оплаты" : "Оплата сотрудника"}
        description="Все условия хранятся в Sheerly"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (open === "model"
              ? run("model", {
                  name,
                  role_name: role,
                  basis,
                  monthly_amount: Number(monthly),
                })
              : run("new_employee", {
                  local_user_id: staff,
                  model_id: model,
                  hired_on: hired || null,
                }));
          }}
        >
          {open === "model" ? (
            <>
              <Label htmlFor="new-model-name">Название</Label>
              <Input
                id="new-model-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
              <Label htmlFor="new-model-role">Должность</Label>
              <Input
                id="new-model-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
              />
              <Label htmlFor="new-model-basis">База процента</Label>
              <select
                id="new-model-basis"
                className={selectClass}
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
              >
                {[
                  ["none", "Без процента"],
                  ["turnover", "Оборот"],
                  ["hookah", "Кальяны"],
                  ["bar", "Бар"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <Label htmlFor="new-model-monthly">
                Оклад за месяц · 0 для оплаты по выходам
              </Label>
              <Input
                id="new-model-monthly"
                type="number"
                min="0"
                step="0.01"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                После создания задайте дневные ставки, проценты и надбавки в
                правилах модели.
              </p>
            </>
          ) : (
            <>
              <Label htmlFor="new-pay-staff">Сотрудник Sheerly</Label>
              <select
                id="new-pay-staff"
                className={selectClass}
                value={staff}
                onChange={(e) => setStaff(e.target.value)}
                required
              >
                <option value="">Выберите сотрудника</option>
                {data.staff
                  .filter(
                    (s) =>
                      !data.employees.some(
                        (e) => e.local_user_id === s.user_id,
                      ),
                  )
                  .map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <Label htmlFor="new-pay-model">Модель оплаты</Label>
              <select
                id="new-pay-model"
                className={selectClass}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
              >
                <option value="">Выберите модель</option>
                {data.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Label htmlFor="new-pay-hired">Дата трудоустройства</Label>
              <Input
                id="new-pay-hired"
                type="date"
                value={hired}
                onChange={(e) => setHired(e.target.value)}
              />
            </>
          )}
          <Button disabled={busy}>Сохранить</Button>
        </form>
      </EditDrawer>
    </>
  );
}
