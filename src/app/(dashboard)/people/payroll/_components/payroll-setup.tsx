"use client";
import { useState } from "react";
import { Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { MonthPicker } from "@/components/shared/month-picker";
import { Label } from "@/components/ui/label";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { ProfileSection } from "@/components/shared/profile-section";
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
      <ProfileSection
        title="Начало учёта зарплаты"
        description="Модели и правила настраиваются в Sheerly. Для фактических выходов используется подключение Quick Resto заведения."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run("initialize", {
              starts_on: starts,
              quickresto_venue_id: Number(qrVenue),
            });
          }}
        >
          <div className="space-y-2">
            <Label>Первый расчётный месяц</Label>
            <MonthPicker
              value={starts}
              min="2000-01-01"
              onChange={setStarts}
              variant="field"
              prefix=""
              ariaLabel="Первый расчётный месяц"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-qr-venue">ID заведения Quick Resto</Label>
            <Input
              id="pay-qr-venue"
              type="number"
              min="1"
              value={qrVenue}
              onChange={(e) => setQrVenue(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={busy}>Начать учёт</Button>
          </div>
        </form>
      </ProfileSection>
    );
  return (
    <>
      <ProfileSection
        title="Модели оплаты"
        description="Новая модель оплаты или условия оплаты для сотрудника, у которого их ещё нет."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen("model")}>
            <Plus />
            Добавить модель
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("employee")}>
            <UserCog />
            Настроить сотрудника
          </Button>
        </div>
      </ProfileSection>
      <EditDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open === "model" ? "Новая модель оплаты" : "Оплата сотрудника"}
        description="Все условия хранятся в Sheerly"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Отмена
            </Button>
            <Button type="submit" form="payroll-setup-form" disabled={busy}>
              Сохранить
            </Button>
          </>
        }
      >
        <form
          id="payroll-setup-form"
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
              <div className="space-y-2">
                <Label htmlFor="new-model-name">Название</Label>
                <Input
                  id="new-model-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-model-role">Должность</Label>
                <Input
                  id="new-model-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-model-basis">База процента</Label>
                <OptionSelect
                  id="new-model-basis"
                  className={selectClass}
                  value={basis}
                  onValueChange={setBasis}
                  options={[
                    { value: "none", label: "Без процента" },
                    { value: "turnover", label: "Оборот" },
                    { value: "hookah", label: "Кальяны" },
                    { value: "bar", label: "Бар" },
                  ]}
                />
              </div>
              <div className="space-y-2">
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
              </div>
              <p className="text-xs text-muted-foreground">
                После создания задайте дневные ставки, проценты и надбавки в
                правилах модели.
              </p>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="new-pay-staff">Сотрудник Sheerly</Label>
                <OptionSelect
                  id="new-pay-staff"
                  className={selectClass}
                  value={staff}
                  onValueChange={setStaff}
                  required
                  options={[
                    { value: "", label: "Выберите сотрудника" },
                    ...data.staff
                      .filter(
                        (s) =>
                          !data.employees.some(
                            (e) => e.local_user_id === s.user_id,
                          ),
                      )
                      .map((s) => ({ value: s.user_id, label: s.name })),
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pay-model">Модель оплаты</Label>
                <OptionSelect
                  id="new-pay-model"
                  className={selectClass}
                  value={model}
                  onValueChange={setModel}
                  required
                  options={[
                    { value: "", label: "Выберите модель" },
                    ...data.models.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pay-hired">Дата трудоустройства</Label>
                <DatePicker
                  id="new-pay-hired"
                  value={hired}
                  onChange={setHired}
                />
              </div>
            </>
          )}
        </form>
      </EditDrawer>
    </>
  );
}
