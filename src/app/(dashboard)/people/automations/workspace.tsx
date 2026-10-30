"use client";
import {
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PayrollEmployeePicker } from "../payroll/_components/payroll-employee-picker";
import { PayrollEmployeeCell } from "../payroll/_components/payroll-employee-cell";
import { PayrollTable } from "../payroll/_components/payroll-table";
import {
  loadAutomationWorkspace,
  saveAutomationPerson,
  addUniform,
  calculateAutomations,
  cancelUniform,
  type AutomationRun,
} from "./actions";
import type { AutomationPersonInput } from "@/lib/automations/state";
import {
  uniformSchedule,
  nextUniformPaymentDate,
} from "@/lib/automations/payroll-rules";
import { PayrollExecutionPanel } from "./execution-panel";
import { businessDate } from "@/lib/sales/time";
import Link from "next/link";

type Data = Awaited<ReturnType<typeof loadAutomationWorkspace>>;
const stateLabels = {
  unknown: "Не проверено",
  missing: "Не предоставлена",
  present: "Предоставлена",
};
const empty: AutomationPersonInput = {
  legacy_reconciled: false,
  missing_fine_state: "unknown",
  expiry_fine_state: "unknown",
  hired_on: null,
  birthday: null,
  gender: null,
  gift_role: null,
  medical_required: null,
  medical_state: "unknown",
  examined_on: null,
  valid_until: null,
  reimbursement_state: "unknown",
  new_medical_case: false,
};
const dateLabel = (v: string | null) =>
  v ? v.split("-").reverse().join(".") : "—";
export function AutomationWorkspace({ initial }: { initial: Data }) {
  const [activeOnly, setActiveOnly] = useState(true);
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<string | null>(null),
    [form, setForm] = useState(empty);
  const [uniformOpen, setUniformOpen] = useState(false),
    [employeeId, setEmployeeId] = useState(""),
    [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [bankAccountId, setBankAccountId] = useState(""),
    [purchasedOn, setPurchasedOn] = useState(""),
    [due, setDue] = useState("");
  const [cancel, setCancel] = useState<string | null>(null),
    [cancelReason, setCancelReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [date, setDate] = useState(() =>
    businessDate(new Date(), initial.timezone, 0),
  );
  const [run, setRun] = useState<AutomationRun | null>(null);
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  const uniformEmployee = data.employees.find((e) => e.id === employeeId);
  let installmentPreview: { dueOn: string; amount: number }[] = [];
  try {
    if (amount && due)
      installmentPreview = uniformSchedule(
        Number(amount),
        due,
        data.settings.uniform.installments,
        data.settings.uniform.payment_days,
      );
  } catch {
    /* The incomplete form stays editable; the server validates the final plan. */
  }
  async function act(fn: () => Promise<unknown>, close?: () => void) {
    setBusy(true);
    try {
      await fn();
      setData(await loadAutomationWorkspace());
      close?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  function openPerson(id: string) {
    const s = data.people.find((p) => p.employee_id === id);
    const employee = data.employees.find((e) => e.id === id);
    const staff = data.staffDetails.find(
      (d) => d.user_id === employee?.local_user_id,
    );
    setForm(
      s
        ? (Object.fromEntries(
            Object.keys(empty).map((k) => [
              k,
              k === "new_medical_case" ? false : s[k as keyof typeof s],
            ]),
          ) as AutomationPersonInput)
        : {
            ...empty,
            hired_on: staff?.employment_date ?? employee?.hired_on ?? null,
            valid_until: staff?.medical_book_date ?? null,
          },
    );
    setEdit(id);
  }
  const rows = data.employees
    .filter((e) => !activeOnly || e.active)
    .map((e) => ({
      ...e,
      subject: data.people.find((p) => p.employee_id === e.id),
    }));
  const selected = data.employees.find((e) => e.id === edit);
  const columns = [
    {
      id: "employee",
      header: "Сотрудник",
      accessorFn: (e: (typeof rows)[number]) => e.name,
      cell: ({ row }: { row: { original: (typeof rows)[number] } }) => (
        <PayrollEmployeeCell
          name={row.original.name}
          role={row.original.role_name}
        />
      ),
      size: 280,
    },
    {
      id: "medical",
      header: "Медкнижка",
      accessorFn: (e: (typeof rows)[number]) =>
        e.subject?.medical_required === false
          ? "Не требуется"
          : stateLabels[e.subject?.medical_state ?? "unknown"],
      size: 170,
    },
    {
      id: "expiry",
      header: "Действует до",
      accessorFn: (e: (typeof rows)[number]) => e.subject?.valid_until ?? "",
      cell: ({ row }: { row: { original: (typeof rows)[number] } }) =>
        dateLabel(row.original.subject?.valid_until ?? null),
      size: 160,
    },
  ];
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader
        title="Медкнижки и форма"
        subtitle="Сведения сотрудников, возмещение формы и расчёты"
        actions={
          <Button variant="outline" asChild>
            <Link href={`/org/venues/${data.venueId}/payroll`}>
              Настройки правил
            </Link>
          </Button>
        }
      />
      <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm">
        {data.executionPolicy?.salary_from || data.executionPolicy?.bonus_from
          ? "Режим и дата перехода заданы отдельно для зарплаты и бонусов. Состояние операций — во вкладке «Бонусы и переход»."
          : "Режим сравнения: n8n продолжает работать. Sheerly проверяет медкнижки, форму и бонусы без новых списаний. Подарки отложены."}
      </div>
      {!data.settingsSaved && (
        <p className="text-sm text-muted-foreground">
          Сначала сохраните правила в{" "}
          <Link
            className="text-brand underline-offset-4 hover:underline"
            href={`/org/venues/${data.venueId}/payroll`}
          >
            настройках заведения → Оплата труда
          </Link>
          .
        </p>
      )}
      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">Сотрудники</TabsTrigger>
          <TabsTrigger value="uniform">Форма</TabsTrigger>
          <TabsTrigger value="runs">Журнал расчётов</TabsTrigger>
          <TabsTrigger value="execution">Бонусы и переход</TabsTrigger>
        </TabsList>
        <TabsContent value="execution" className="pt-5">
          <PayrollExecutionPanel
            data={data}
            onChange={async () => setData(await loadAutomationWorkspace())}
          />
        </TabsContent>
        <TabsContent value="people" className="pt-5">
          <PayrollTable
            id="automation-people"
            rows={rows}
            columns={columns}
            onRow={(e) => openPerson(e.id)}
            actions={
              <Select
                value={activeOnly ? "active" : "all"}
                onValueChange={(v) => setActiveOnly(v === "active")}
              >
                <SelectTrigger className="w-44" aria-label="Состав сотрудников">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Действующие</SelectItem>
                  <SelectItem value="all">Все сотрудники</SelectItem>
                </SelectContent>
              </Select>
            }
            labels={{
              employee: "Сотрудник",
              medical: "Медкнижка",
              expiry: "Действует до",
            }}
            searchText={(e) => `${e.name} ${e.role_name}`}
          />
        </TabsContent>
        <TabsContent value="uniform" className="space-y-4 pt-5">
          <div className="flex justify-end">
            <Button
              disabled={
                !data.canPurchase ||
                !data.settingsSaved ||
                !data.settings.uniform.enabled
              }
              onClick={() => {
                setRequestId(crypto.randomUUID());
                const today = businessDate(new Date(), data.timezone, 0);
                setPurchasedOn(today);
                setDue(
                  nextUniformPaymentDate(
                    today,
                    data.settings.uniform.payment_days,
                  ),
                );
                setBankAccountId(
                  data.bankAccounts.length === 1 ? data.bankAccounts[0].id : "",
                );
                setUniformOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" />
              Добавить покупку
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Одна покупка — один расход по статье должности в ФОТ. Стоимость
            возмещается частями из зарплаты.
          </p>
          {!data.canPurchase && (
            <p className="text-sm text-muted-foreground">
              Для записи покупки нужен доступ к счетам и созданию расходов.
            </p>
          )}
          {data.canPurchase && !data.bankAccounts.length && (
            <p className="text-sm text-muted-foreground">
              Нет доступного рублёвого счёта. Добавьте его в разделе «Финансы».
            </p>
          )}
          {!data.uniform.length && !data.legacyUniform.length ? (
            <p className="rounded-xl border p-8 text-center text-muted-foreground">
              Покупок формы пока нет
            </p>
          ) : (
            data.uniform.map((i) => (
              <div key={i.id} className="rounded-xl border p-4 space-y-3">
                <div className="flex justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {i.title}
                      {i.cancelled_at && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          Отменено
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {names.get(i.employee_id)}
                    </p>
                  </div>
                  <p className="tabular-nums">
                    {i.installments
                      .reduce((n, s) => n + s.amount, 0)
                      .toLocaleString("ru-RU")}{" "}
                    ₽
                  </p>
                </div>
                <UniformInstallments items={i.installments} />
                {i.expense_transaction_id && (
                  <Link
                    className="inline-flex text-sm text-brand hover:underline"
                    href={`/finance/transactions/${i.expense_transaction_id}`}
                  >
                    Расход от {dateLabel(i.purchased_on)} ↗
                  </Link>
                )}
                {!i.cancelled_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCancel(i.id);
                      setCancelReason("");
                    }}
                  >
                    Отменить будущие удержания
                  </Button>
                )}
              </div>
            ))
          )}
          {!!data.legacyUniform.length && (
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Архив из Glide · {data.legacyUniform.length}
              </summary>
              <div className="mt-4 divide-y">
                {data.legacyUniform.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-col justify-between gap-2 py-4 text-sm sm:flex-row"
                  >
                    <div>
                      <p className="font-medium">
                        {names.get(u.employee_id) ?? "Сотрудник"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {u.purchased_on
                          ? dateLabel(u.purchased_on)
                          : "Дата покупки не указана"}{" "}
                        ·{" "}
                        {u.legacy_parts_created
                          ? "Удержания оформлены в прежней системе"
                          : "Части удержаний в источнике не подтверждены"}
                      </p>
                    </div>
                    <p className="shrink-0 tabular-nums">{u.amount ?? "—"} ₽</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Исторические сведения. Новых удержаний или расходов эти записи
                не создают.
              </p>
            </details>
          )}
        </TabsContent>
        <TabsContent value="runs" className="space-y-4 pt-5">
          <p className="text-sm text-muted-foreground">
            Ежедневная сверка — с 08:15 по времени заведения. Автоматический
            запуск создаёт только сравнение; деньги и бонусы не списывает.
          </p>
          {data.failedJobs.map((job) => (
            <p key={job.id} className="rounded-xl border px-4 py-3 text-sm">
              {dateLabel(job.business_date)} · {job.last_error}
            </p>
          ))}
          <div className="flex flex-wrap justify-between gap-3">
            <div className="w-48">
              <DatePicker value={date} onChange={setDate} />
            </div>
            <Button
              disabled={busy || !data.settingsSaved}
              onClick={() =>
                act(async () => {
                  await calculateAutomations(date, "comparison");
                })
              }
            >
              Сравнить расчёт
            </Button>
          </div>
          {!data.runs.length ? (
            <p className="rounded-xl border p-8 text-center text-muted-foreground">
              Выполните первый расчёт для сверки
            </p>
          ) : (
            data.runs.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setRun(r)}
                className="flex w-full flex-col items-start gap-2 rounded-xl border p-4 text-left hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {dateLabel(r.business_date)} ·{" "}
                    {r.mode === "comparison"
                      ? "Сравнение"
                      : `Учтено записей: ${r.applied_count}`}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Новых событий: {r.decisions.length} · На проверке:{" "}
                    {r.blockers.length} · Уже учтено:{" "}
                    {r.recorded_candidates.length}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("ru-RU", {
                    timeZone: data.timezone,
                  })}
                </span>
              </button>
            ))
          )}
        </TabsContent>
      </Tabs>
      <EditDrawer
        open={!!edit}
        onOpenChange={(o) => {
          if (!busy && !o) setEdit(null);
        }}
        title={selected?.name ?? "Сведения сотрудника"}
        description="Проверенные источники для автоматизаций"
        focusContentOnOpen
        footer={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEdit(null)}
            >
              Отмена
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                edit &&
                act(
                  () =>
                    saveAutomationPerson(
                      edit,
                      data.people.find((p) => p.employee_id === edit)
                        ?.version ?? 0,
                      form,
                    ),
                  () => setEdit(null),
                )
              }
            >
              Сохранить
            </Button>
          </>
        }
      >
        <Field label="Дата приёма">
          <DatePicker
            value={form.hired_on ?? ""}
            onChange={(v) => setForm({ ...form, hired_on: v || null })}
          />
        </Field>
        <Field label="Медкнижка требуется">
          <Choice
            value={
              form.medical_required === null
                ? "unknown"
                : form.medical_required
                  ? "yes"
                  : "no"
            }
            onChange={(v) =>
              setForm({
                ...form,
                medical_required: v === "unknown" ? null : v === "yes",
              })
            }
            options={{ unknown: "Не проверено", yes: "Да", no: "Нет" }}
          />
        </Field>
        <Field label="Документ">
          <Choice
            value={form.medical_state}
            onChange={(v) =>
              setForm({
                ...form,
                medical_state: v as typeof form.medical_state,
              })
            }
            options={stateLabels}
          />
        </Field>
        {form.medical_state === "missing" && (
          <Field label="Штраф за отсутствие этой медкнижки">
            <Choice
              value={form.missing_fine_state}
              onChange={(v) =>
                setForm({
                  ...form,
                  missing_fine_state: v as typeof form.missing_fine_state,
                })
              }
              options={{
                unknown: "Не проверено",
                recorded: "Уже учтён",
                waived: "Штраф отменён",
                not_recorded: "Не учтён, проверено",
              }}
            />
          </Field>
        )}
        {form.medical_state === "present" && (
          <>
            <Field label="Дата обследования">
              <DatePicker
                value={form.examined_on ?? ""}
                onChange={(v) => setForm({ ...form, examined_on: v || null })}
              />
            </Field>
            <Field label="Действует до">
              <DatePicker
                value={form.valid_until ?? ""}
                onChange={(v) => setForm({ ...form, valid_until: v || null })}
              />
            </Field>
            <Field label="Штраф за просрочку этого обследования">
              <Choice
                value={form.expiry_fine_state}
                onChange={(v) =>
                  setForm({
                    ...form,
                    expiry_fine_state: v as typeof form.expiry_fine_state,
                  })
                }
                options={{
                  unknown: "Не проверено",
                  recorded: "Уже учтён",
                  waived: "Штраф отменён",
                  not_recorded: "Не учтён, проверено",
                }}
              />
            </Field>
            <Field label="Прежняя компенсация">
              <Choice
                value={form.reimbursement_state}
                onChange={(v) =>
                  setForm({
                    ...form,
                    reimbursement_state: v as typeof form.reimbursement_state,
                  })
                }
                options={{
                  unknown: "Не проверено",
                  recorded: "Уже выплачена",
                  not_recorded: "Не выплачена, проверено",
                }}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.new_medical_case}
                onChange={(e) =>
                  setForm({
                    ...form,
                    new_medical_case: e.target.checked,
                    expiry_fine_state: "unknown",
                    reimbursement_state: "unknown",
                    legacy_reconciled: false,
                  })
                }
              />
              Это новое обследование, а не исправление даты
            </label>
          </>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-brand"
            checked={form.legacy_reconciled}
            onChange={(e) =>
              setForm({ ...form, legacy_reconciled: e.target.checked })
            }
          />
          Прежние штрафы и компенсации медкнижки сверены с Glide
        </label>
        <details className="space-y-4">
          <summary className="cursor-pointer text-sm font-medium">
            Данные для подарков
          </summary>
          <div className="space-y-4 pt-4">
            <Field label="День рождения">
              <DatePicker
                value={form.birthday ?? ""}
                onChange={(v) => setForm({ ...form, birthday: v || null })}
              />
            </Field>
            <Field label="Пол">
              <Choice
                value={form.gender ?? "unknown"}
                onChange={(v) =>
                  setForm({
                    ...form,
                    gender: v === "unknown" ? null : (v as "male" | "female"),
                  })
                }
                options={{
                  unknown: "Не указан",
                  male: "Мужской",
                  female: "Женский",
                }}
              />
            </Field>
            <Field label="Группа должности для подарков">
              <Choice
                value={form.gift_role ?? "unknown"}
                onChange={(v) =>
                  setForm({ ...form, gift_role: v === "unknown" ? null : v })
                }
                options={{
                  unknown: "Не сопоставлена",
                  ...Object.fromEntries(
                    [
                      ...new Set([
                        ...data.settings.gifts.holidays.flatMap((h) => h.roles),
                        ...data.settings.gifts.tenure.flatMap((h) => h.roles),
                      ]),
                    ].map((r) => [r, r]),
                  ),
                }}
              />
            </Field>
          </div>
        </details>
      </EditDrawer>
      <EditDrawer
        open={uniformOpen}
        onOpenChange={(o) => {
          if (!busy) setUniformOpen(o);
        }}
        title="Покупка формы"
        description="Расход и график возмещения сотрудником"
        focusContentOnOpen
        footer={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setUniformOpen(false)}
            >
              Отмена
            </Button>
            <Button
              disabled={
                busy ||
                !data.canPurchase ||
                !uniformEmployee?.role_id ||
                !bankAccountId ||
                !title ||
                !purchasedOn ||
                !installmentPreview.length ||
                installmentPreview.some((p) => p.amount <= 0) ||
                installmentPreview[0].dueOn < purchasedOn
              }
              onClick={() =>
                act(
                  () =>
                    addUniform({
                      employeeId,
                      title,
                      amount: Number(amount),
                      installments: installmentPreview,
                      bankAccountId,
                      purchasedOn,
                      roleId: uniformEmployee!.role_id!,
                      settingsVersion: data.settingsVersion,
                      requestId,
                    }),
                  () => {
                    setUniformOpen(false);
                    setTitle("");
                    setAmount("");
                  },
                )
              }
            >
              Записать покупку
            </Button>
          </>
        }
      >
        <Field label="Сотрудник">
          <PayrollEmployeePicker
            employees={data.employees.filter((e) => e.active)}
            selectedIds={employeeId ? [employeeId] : []}
            onChange={(ids) => setEmployeeId(ids[0] ?? "")}
          />
        </Field>
        <Field label="Что приобретено">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, две футболки"
          />
        </Field>
        <Field label="Стоимость, ₽">
          <Input
            inputMode="decimal"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Дата покупки">
          <DatePicker
            value={purchasedOn}
            onChange={setPurchasedOn}
            clearable={false}
          />
        </Field>
        <Field label="Счёт списания">
          <Choice
            value={bankAccountId || "unselected"}
            onChange={(v) => setBankAccountId(v === "unselected" ? "" : v)}
            options={{
              unselected: "Выберите счёт",
              ...Object.fromEntries(
                data.bankAccounts.map((b) => [b.id, b.name]),
              ),
            }}
          />
        </Field>
        {uniformEmployee && (
          <p className="text-sm text-muted-foreground">
            Статья расхода: ФОТ · {uniformEmployee.role_name}
          </p>
        )}
        <Field label="Первое удержание">
          <DatePicker
            value={due}
            onChange={(v) =>
              setDue(
                v
                  ? nextUniformPaymentDate(
                      v,
                      data.settings.uniform.payment_days,
                    )
                  : "",
              )
            }
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          {data.settings.uniform.installments} части ·{" "}
          {data.settings.uniform.payment_days.join(" и ")} числа. Последняя
          часть включает остаток копеек.
        </p>
        {!!installmentPreview.length && (
          <UniformInstallments items={installmentPreview} />
        )}
      </EditDrawer>
      <EditDrawer
        open={!!run}
        onOpenChange={(o) => {
          if (!busy && !o) setRun(null);
        }}
        title="Результат расчёта"
        description={run ? dateLabel(run.business_date) : ""}
        focusContentOnOpen
        footer={
          run?.mode === "comparison" &&
          data.canReview &&
          data.executionPolicy?.salary_from &&
          run.business_date >= data.executionPolicy.salary_from &&
          run.decisions.some((d) => d.medium === "money") ? (
            <Button
              disabled={
                busy ||
                !run.decisions.some(
                  (d) =>
                    d.medium === "money" &&
                    !run.blockers.some((b) => b.employeeId === d.employeeId),
                )
              }
              onClick={() =>
                act(
                  () =>
                    calculateAutomations(run.business_date, "native", run.id),
                  () => setRun(null),
                )
              }
            >
              Учесть денежные записи в зарплате
            </Button>
          ) : undefined
        }
      >
        {run?.mode === "comparison" && (
          <p className="text-sm text-muted-foreground">
            В зарплату попадут только денежные записи сотрудников без замечаний.
            Бонусы и скидки остаются для сравнения.
          </p>
        )}
        {run?.decisions.map((d) => (
          <div key={d.key} className="border-b pb-4">
            <p className="font-medium">{names.get(d.employeeId)}</p>
            <p className="mt-1 text-sm">{d.reason}</p>
            {d.medium !== "none" && (
              <p className="mt-2 tabular-nums">
                {d.kind === "deduction" ? "−" : "+"}
                {d.amount.toLocaleString("ru-RU")}{" "}
                {d.medium === "bonus"
                  ? "бонусов"
                  : d.medium === "money"
                    ? "₽"
                    : d.medium === "percent"
                      ? "%"
                      : ""}
              </p>
            )}
            {run?.blockers.some((b) => b.employeeId === d.employeeId) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Удерживается до проверки сведений
              </p>
            )}
            {d.medium !== "money" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Только сравнение, внешняя операция не выполняется
              </p>
            )}
          </div>
        ))}
        {run &&
          [...new Set(run.blockers.map((b) => b.employeeId))].map((id) => (
            <div key={id} className="rounded-xl border p-4 text-sm">
              <PayrollEmployeeCell
                name={names.get(id) ?? "Сотрудник"}
                role={data.employees.find((e) => e.id === id)?.role_name}
              />
              <ul className="mt-3 space-y-2 text-muted-foreground">
                {run.blockers
                  .filter((b) => b.employeeId === id)
                  .map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
              </ul>
            </div>
          ))}
        {!!run?.recorded_candidates.length && (
          <p className="text-sm text-muted-foreground">
            Уже учтённых событий: {run.recorded_candidates.length}. Повторные
            записи не создаются.
          </p>
        )}
        {run && !run.decisions.length && !run.blockers.length && (
          <p className="text-sm text-muted-foreground">
            Новых начислений на эту дату нет
          </p>
        )}
      </EditDrawer>
      <EditDrawer
        open={!!cancel}
        onOpenChange={(o) => {
          if (!o && !busy) setCancel(null);
        }}
        title="Отменить удержания за форму"
        description="Уже учтённые записи останутся в зарплате и истории. Их можно исправить в разделе начислений."
        footer={
          <Button
            disabled={busy || cancelReason.trim().length < 3}
            onClick={() =>
              cancel &&
              act(
                () => cancelUniform(cancel, cancelReason),
                () => setCancel(null),
              )
            }
          >
            Отменить будущие удержания
          </Button>
        }
      >
        <Field label="Причина отмены">
          <Input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </Field>
      </EditDrawer>
    </PageFrame>
  );
}
function UniformInstallments({
  items,
}: {
  items: { dueOn: string; amount: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((p) => (
        <span key={p.dueOn} className="rounded-lg bg-muted px-3 py-2 text-sm">
          {dateLabel(p.dueOn)} · {p.amount.toLocaleString("ru-RU")} ₽
        </span>
      ))}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}
function Choice({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
