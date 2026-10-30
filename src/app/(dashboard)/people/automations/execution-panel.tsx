"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { PayrollTable } from "../payroll/_components/payroll-table";
import { PayrollEmployeeCell } from "../payroll/_components/payroll-employee-cell";
import { businessDate } from "@/lib/sales/time";
import {
  saveExecutionPolicy,
  reviewBonusOperation,
  reverseBonusOperation,
  type loadAutomationWorkspace,
  type BonusOperationRow,
} from "./actions";

export const bonusOperationLabels: Record<string, string> = {
  pending: "В очереди",
  reading: "Проверяем баланс",
  sending: "Отправлена в Quick Resto",
  done: "Проведена",
  review: "Нужна сверка",
  cancelled: "Отменена",
  money: "Удержано деньгами",
};
type Data = Awaited<ReturnType<typeof loadAutomationWorkspace>>;
export function PayrollExecutionPanel({
  data,
  onChange,
}: {
  data: Data;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [salary, setSalary] = useState(false),
    [bonuses, setBonuses] = useState(false),
    [stopped, setStopped] = useState(false),
    [date, setDate] = useState("");
  const [selected, setSelected] = useState<BonusOperationRow | null>(null),
    [evidence, setEvidence] = useState(""),
    [checked, setChecked] = useState(false);
  const label = (v: string | null | undefined) =>
    v ? `С ${v.split("-").reverse().join(".")}` : "Только сравнение";
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChange();
      setOpen(false);
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border p-5">
        <dl className="grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              Медкнижки и удержания за форму
            </dt>
            <dd className="mt-1 font-medium">
              {label(data.executionPolicy?.salary_from)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              Бонусные операции Quick Resto
            </dt>
            <dd className="mt-1 font-medium">
              {label(data.executionPolicy?.bonus_from)}
            </dd>
          </div>
        </dl>
        {data.canReview && (
          <Button
            variant="outline"
            onClick={() => {
              setSalary(!!data.executionPolicy?.salary_from);
              setBonuses(!!data.executionPolicy?.bonus_from);
              setStopped(false);
              setDate(
                data.executionPolicy?.salary_from ??
                  data.executionPolicy?.bonus_from ??
                  businessDate(new Date(), data.timezone, 0),
              );
              setOpen(true);
            }}
          >
            Режим работы
          </Button>
        )}
      </div>
      {!data.bonusWorkerReady && (
        <p className="text-sm text-muted-foreground">
          Реальные бонусные операции на сервере выключены. Для перехода сначала
          проверяем результаты и останавливаем прежние обработчики, затем
          включаем исполнитель Sheerly.
        </p>
      )}
      <PayrollTable<BonusOperationRow>
        id="payroll-bonus-operations"
        rows={data.bonusOperations}
        onRow={(r) => {
          setSelected(r);
          setEvidence("");
          setChecked(false);
        }}
        labels={{
          employee: "Сотрудник",
          operation: "Действие",
          amount: "Бонусы",
          state: "Состояние",
        }}
        numeric={["amount"]}
        searchText={(r) =>
          `${data.employees.find((e) => e.id === r.employee_id)?.name ?? ""} ${bonusOperationLabels[r.state] ?? ""}`
        }
        columns={[
          {
            id: "employee",
            header: "Сотрудник",
            accessorFn: (r) =>
              data.employees.find((e) => e.id === r.employee_id)?.name ?? "",
            cell: ({ row }) => {
              const e = data.employees.find(
                (e) => e.id === row.original.employee_id,
              );
              return (
                <PayrollEmployeeCell
                  name={e?.name ?? "Сотрудник"}
                  role={e?.role_name}
                />
              );
            },
          },
          {
            id: "operation",
            header: "Действие",
            accessorFn: (r) =>
              r.operation === "reverse"
                ? "Отмена операции"
                : r.direction === "debit"
                  ? "Списание"
                  : "Начисление",
          },
          {
            id: "amount",
            header: "Бонусы",
            accessorFn: (r) => Number(r.amount),
            cell: ({ row: { original: r } }) => (
              <span className="tabular-nums">
                {r.direction === "debit" ? "−" : "+"}
                {Number(r.amount).toLocaleString("ru-RU")} б.
              </span>
            ),
          },
          {
            id: "state",
            header: "Состояние",
            accessorFn: (r) => bonusOperationLabels[r.state] ?? "Нужна сверка",
            cell: ({ row: { original: r } }) => (
              <span
                className={
                  r.state === "review"
                    ? "text-amber-700"
                    : r.state === "done"
                      ? "text-emerald-700"
                      : "text-muted-foreground"
                }
              >
                {bonusOperationLabels[r.state] ?? "Нужна сверка"}
              </span>
            ),
          },
        ]}
      />
      <EditDrawer
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="Переход на Sheerly"
        description="Зарплата и бонусы переключаются отдельно. Архивные записи автоматически не повторяются."
        footer={
          <Button
            disabled={
              busy ||
              ((salary || bonuses) &&
                (!stopped || !date || !data.settingsSaved))
            }
            onClick={() =>
              void act(() =>
                saveExecutionPolicy({
                  version: data.executionPolicy?.version ?? 0,
                  salaryFrom: salary ? date : null,
                  bonusFrom: bonuses ? date : null,
                  legacyStopped: stopped,
                }),
              )
            }
          >
            Сохранить режим
          </Button>
        }
      >
        <div className="space-y-6 text-sm">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={salary}
              onCheckedChange={(v) => setSalary(v === true)}
            />
            Медкнижки и удержания за форму — автоматически
          </label>
          <label className="flex items-start gap-3">
            <Checkbox
              checked={bonuses}
              onCheckedChange={(v) => setBonuses(v === true)}
            />
            Бонусные операции — через Sheerly
          </label>
          {(salary || bonuses) && (
            <>
              <div className="space-y-2">
                <Label>Начиная с даты</Label>
                <DatePicker value={date} onChange={setDate} />
              </div>
              <label className="flex items-start gap-3 rounded-xl border p-4">
                <Checkbox
                  checked={stopped}
                  onCheckedChange={(v) => setStopped(v === true)}
                />
                <span>
                  Сверка завершена. Прежние обработчики соответствующих операций
                  остановлены. Только Sheerly выполняет новые операции.
                </span>
              </label>
            </>
          )}
          <p className="text-muted-foreground">
            Подарки остаются в прежнем процессе. Задачи и фотоотчёты перенесём
            отдельно.
          </p>
        </div>
      </EditDrawer>
      <EditDrawer
        open={!!selected}
        onOpenChange={(v) => {
          if (!v && !busy) setSelected(null);
        }}
        title="Бонусная операция"
        description={selected ? bonusOperationLabels[selected.state] : ""}
      >
        {selected && (
          <div className="space-y-5 text-sm">
            <PayrollEmployeeCell
              name={
                data.employees.find((e) => e.id === selected.employee_id)
                  ?.name ?? "Сотрудник"
              }
            />
            <p className="text-3xl font-semibold tabular-nums">
              {selected.direction === "debit" ? "−" : "+"}
              {Number(selected.amount).toLocaleString("ru-RU")} б.
            </p>
            {selected.message && (
              <p className="text-muted-foreground">{selected.message}</p>
            )}
            {selected.provider_reference && (
              <p className="break-words">
                Подтверждение: {selected.provider_reference}
              </p>
            )}
            {data.canReview && selected.state === "review" && (
              <div className="space-y-4 border-t pt-5">
                <Label htmlFor="bonus-evidence">
                  Номер операции или результат сверки в Quick Resto
                </Label>
                <Input
                  id="bonus-evidence"
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  maxLength={1000}
                />
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => setChecked(v === true)}
                  />
                  История счёта проверена, результат подтверждён
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || !checked || evidence.trim().length < 3}
                    onClick={() =>
                      void act(() =>
                        reviewBonusOperation(selected.id, true, evidence),
                      )
                    }
                  >
                    Операция проведена
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !checked || evidence.trim().length < 3}
                    onClick={() =>
                      void act(() =>
                        reviewBonusOperation(selected.id, false, evidence),
                      )
                    }
                  >
                    Операции нет — разрешить повтор
                  </Button>
                </div>
              </div>
            )}
            {data.canReview &&
              selected.state === "done" &&
              selected.operation === "apply" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      reverseBonusOperation(selected.adjustment_id),
                    )
                  }
                >
                  Отменить через обратную операцию
                </Button>
              )}
          </div>
        )}
      </EditDrawer>
    </div>
  );
}
