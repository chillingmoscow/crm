"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ProfileSection } from "@/components/shared/profile-section";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useSaveSection } from "@/components/shared/save-bar";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  loadEmployeeDocuments,
  saveEmployeeMedical,
  addUniform,
  cancelUniform,
} from "../../../automations/actions";
import { updateStaffAccountDetails } from "../../actions";
import {
  employeeMedicalSchema,
  type EmployeeDocumentsData,
  type EmployeeMedicalInput,
} from "@/lib/payroll/employee-documents";
import {
  uniformSchedule,
  nextUniformPaymentDate,
} from "@/lib/automations/payroll-rules";
import { businessDate } from "@/lib/sales/time";

const dateLabel = (v: string | null) =>
  v ? v.split("-").reverse().join(".") : "—";
type BasicMedical = {
  userId: string;
  accountId: string;
  number: string | null;
  until: string | null;
  canEdit: boolean;
};
type Target = { userId: string } | { employeeId: string };

export function EmployeeDocuments({
  target,
  basic,
  onChanged,
}: {
  target: Target;
  basic?: BasicMedical;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<EmployeeDocumentsData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const byUser = "userId" in target;
  const targetId = byUser ? target.userId : target.employeeId;
  const reload = useCallback(async () => {
    const d = await loadEmployeeDocuments(
      byUser ? { userId: targetId } : { employeeId: targetId },
    );
    setData(d);
    setError("");
    return d;
  }, [targetId, byUser]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadEmployeeDocuments(
      byUser ? { userId: targetId } : { employeeId: targetId },
    )
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить документы",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetId, byUser]);
  const refresh = async () => {
    const d = await reload();
    onChanged?.();
    return d;
  };
  if (loading)
    return (
      <div className="space-y-5" aria-label="Загрузка документов сотрудника">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  if (error)
    return (
      <div role="alert" className="space-y-3 rounded-xl border p-5 text-sm">
        <p>{error}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void reload().catch((e) => setError(e.message))}
        >
          Повторить загрузку
        </Button>
      </div>
    );
  if (!data)
    return basic ? (
      <BasicMedicalCard basic={basic} onChanged={onChanged} />
    ) : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <MedicalCard
        key={`${data.employee.id}.${data.person?.version ?? 0}.${data.medicalNumber}.${data.medicalUntil}`}
        data={data}
        onSaved={refresh}
      />
      <UniformCard data={data} reload={refresh} />
    </div>
  );
}

export function BasicMedicalCard({
  basic,
  onChanged,
}: {
  basic: BasicMedical;
  onChanged?: () => void;
}) {
  const [number, setNumber] = useState(basic.number ?? ""),
    [until, setUntil] = useState(basic.until ?? ""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState({
      number: basic.number ?? "",
      until: basic.until ?? "",
    });
  const dirty =
    basic.canEdit && (number !== saved.number || until !== saved.until);
  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const r = await updateStaffAccountDetails(basic.userId, basic.accountId, {
        medical_book_number: number.trim() || null,
        medical_book_date: until || null,
      });
      if (r.error) throw new Error(r.error);
      setSaved({ number, until });
      onChanged?.();
      toast.success("Медкнижка сохранена");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Сохраняется общей полосой карточки, как и остальные поля.
  const bar = useSaveSection({
    dirty,
    saving: busy,
    save,
    reset: () => {
      setNumber(saved.number);
      setUntil(saved.until);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && !busy) void save();
  };
  return (
    <>
    <ProfileSection title="Медкнижка">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Номер">
            {(control) => (
              <Input
                {...control}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                readOnly={!basic.canEdit}
                maxLength={100}
              />
            )}
          </Field>
          <Field label="Действует до">
            {(control) => (
              <DatePicker
                {...control}
                value={until}
                onChange={setUntil}
                readOnly={!basic.canEdit}
              />
            )}
          </Field>
        </div>
      </form>
    </ProfileSection>
    {bar}
    </>
  );
}

function initialMedical(data: EmployeeDocumentsData): EmployeeMedicalInput {
  const p = data.person;
  return {
    medical_required: p?.medical_required ?? null,
    medical_state: p?.medical_state ?? "unknown",
    examined_on: p?.examined_on ?? null,
    valid_until: data.medicalUntil ?? p?.valid_until ?? null,
  };
}
function MedicalCard({
  data,
  onSaved,
}: {
  data: EmployeeDocumentsData;
  onSaved: () => Promise<unknown>;
}) {
  const initial = initialMedical(data);
  const [form, setForm] = useState(initial),
    [number, setNumber] = useState(data.medicalNumber ?? ""),
    [busy, setBusy] = useState(false);
  const patch = (value: Partial<EmployeeMedicalInput>) =>
    setForm((f) => ({ ...f, ...value }));
  const canEditDates = !data.employee.local_user_id || data.canEditHr;
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) ||
    number !== (data.medicalNumber ?? "");
  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const medical = employeeMedicalSchema.parse(form);
      await saveEmployeeMedical({
        employeeId: data.employee.id,
        version: data.person?.version ?? 0,
        medical,
        number: data.employee.local_user_id ? number.trim() || null : null,
        expectedNumber: data.medicalNumber,
        expectedUntil: data.medicalUntil,
      });
      await onSaved();
      toast.success("Медкнижка сохранена");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Сохраняется общей полосой карточки; на странице без неё — своей.
  const bar = useSaveSection({
    dirty,
    saving: busy,
    save,
    reset: () => {
      setForm(initial);
      setNumber(data.medicalNumber ?? "");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && !busy) void save();
  };
  return (
    <>
    <ProfileSection title="Медкнижка">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice
            label="Состояние"
            value={
              form.medical_required === false
                ? "not_required"
                : form.medical_state
            }
            options={{
              unknown: "Нужно уточнить",
              missing: "Не предоставлена",
              present: "Предоставлена",
              not_required: "Не требуется",
            }}
            onChange={(v) =>
              patch(
                v === "not_required"
                  ? { medical_required: false }
                  : {
                      medical_required: true,
                      medical_state: v as EmployeeMedicalInput["medical_state"],
                    },
              )
            }
          />
          {form.medical_required !== false && (
            <>
              {data.employee.local_user_id && (
                <Field label="Номер">
                  {(control) => (
                    <Input
                      {...control}
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      readOnly={!data.canEditHr}
                      maxLength={100}
                    />
                  )}
                </Field>
              )}
              <Field label="Дата обследования">
                {(control) => (
                  <DatePicker
                    {...control}
                    value={form.examined_on ?? ""}
                    onChange={(v) => patch({ examined_on: v || null })}
                    readOnly={!canEditDates || form.medical_state !== "present"}
                  />
                )}
              </Field>
              <Field label="Действует до">
                {(control) => (
                  <DatePicker
                    {...control}
                    value={form.valid_until ?? ""}
                    onChange={(v) => patch({ valid_until: v || null })}
                    readOnly={!canEditDates || form.medical_state !== "present"}
                  />
                )}
              </Field>
            </>
          )}
        </div>
      </form>
    </ProfileSection>
    {bar}
    </>
  );
}

function UniformCard({
  data,
  reload,
}: {
  data: EmployeeDocumentsData;
  reload: () => Promise<EmployeeDocumentsData | null>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [bank, setBank] = useState(""),
    [purchased, setPurchased] = useState(""),
    [due, setDue] = useState(""),
    [request, setRequest] = useState("");
  const [cancel, setCancel] = useState<string | null>(null),
    [reason, setReason] = useState("");
  let parts: { dueOn: string; amount: number }[] = [];
  try {
    if (Number(amount) > 0 && due)
      parts = uniformSchedule(
        Number(amount),
        due,
        data.uniformSettings.installments,
        data.uniformSettings.payment_days,
      );
  } catch {
    /* Incomplete form remains editable. */
  }
  const valid =
    title.trim().length > 0 &&
    !!bank &&
    !!purchased &&
    parts.length > 0 &&
    parts.every((p) => p.amount > 0) &&
    parts[0].dueOn >= purchased &&
    !!data.employee.role_id;
  function begin() {
    const today = businessDate(new Date(), data.timezone, 0);
    setTitle("");
    setAmount("");
    setBank(data.banks[0]?.id ?? "");
    setPurchased(today);
    setDue(nextUniformPaymentDate(today, data.uniformSettings.payment_days));
    setRequest(crypto.randomUUID());
    setOpen(true);
  }
  async function save() {
    if (!valid || !data.employee.role_id) return;
    setBusy(true);
    try {
      await addUniform({
        employeeId: data.employee.id,
        title: title.trim(),
        amount: Number(amount),
        installments: parts,
        bankAccountId: bank,
        purchasedOn: purchased,
        roleId: data.employee.role_id,
        settingsVersion: data.settingsVersion,
        requestId: request,
      });
      await reload();
      setOpen(false);
      toast.success("Покупка формы записана");
    } catch (e) {
      const latest = await reload().catch(() => null);
      if (latest?.uniform.some((i) => i.id === request)) {
        setOpen(false);
        toast.success("Покупка формы записана");
      } else
        toast.error(
          e instanceof Error
            ? e.message
            : "Не удалось подтвердить покупку. Проверьте список перед повтором",
        );
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!cancel) return;
    setBusy(true);
    try {
      await cancelUniform(cancel, reason);
      await reload();
      setCancel(null);
      toast.success("Будущие удержания отменены");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отменить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ProfileSection
        title="Рабочая форма"
        actions={
          data.canPurchase && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                !data.employee.active ||
                !data.employee.role_id ||
                !data.settingsVersion ||
                !data.uniformSettings.enabled
              }
              onClick={begin}
            >
              <Plus className="size-4" />
              Добавить покупку
            </Button>
          )
        }
      >
        {!data.uniform.length && !data.legacyUniform.length && (
          <p className="text-sm text-muted-foreground">
            Покупок формы пока нет
          </p>
        )}
        <div className="divide-y">
          {data.uniform.map((i) => {
            const total = i.installments.reduce(
              (n, p) => n + Number(p.amount),
              0,
            );
            return (
              <div key={i.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateLabel(i.purchased_on)}
                      {i.cancelled_at ? " · Удержания остановлены" : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums">
                    <Money value={total} fraction="auto" />
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Учтено в зарплате <Money value={i.deducted} fraction="auto" /> из{" "}
                  <Money value={total} fraction="auto" />
                </p>
                <details>
                  <summary className="w-fit cursor-pointer text-sm text-muted-foreground">
                    График удержаний
                  </summary>
                  <Installments items={i.installments} />
                </details>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {i.expense_transaction_id && (
                    <Link
                      className="text-brand hover:underline"
                      href={`/finance/transactions?id=${i.expense_transaction_id}`}
                    >
                      Расход на покупку ↗
                    </Link>
                  )}
                  {!i.cancelled_at && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCancel(i.id);
                        setReason("");
                      }}
                    >
                      Остановить удержания
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!!data.legacyUniform.length && (
          <details className="border-t pt-4">
            <summary className="w-fit cursor-pointer text-sm text-muted-foreground">
              Прежние покупки · {data.legacyUniform.length}
            </summary>
            <div className="mt-2 divide-y">
              {data.legacyUniform.map((i) => (
                <div
                  key={i.id}
                  className="flex justify-between gap-4 py-3 text-sm"
                >
                  <span>{dateLabel(i.purchased_on)}</span>
                  <span className="tabular-nums">
                    <Money value={i.amount == null ? null : Number(i.amount)} fraction="auto" />
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </ProfileSection>
      <EditDrawer
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="Покупка формы"
        description={data.employee.name}
        focusContentOnOpen
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={busy || !valid}
              onClick={() => void save()}
            >
              Записать покупку
            </Button>
          </>
        }
      >
        <Field label="Что приобретено" required>
          {(control) => (
            <Input
              {...control}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, две футболки"
              maxLength={200}
            />
          )}
        </Field>
        <Field label="Стоимость, ₽" required>
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Дата покупки" required>
          {(control) => (
            <DatePicker
              {...control}
              value={purchased}
              onChange={setPurchased}
              clearable={false}
            />
          )}
        </Field>
        <Choice
          label="Счёт списания"
          required
          value={bank}
          options={Object.fromEntries(data.banks.map((b) => [b.id, b.name]))}
          onChange={setBank}
          placeholder="Выберите счёт"
        />
        <p className="text-sm text-muted-foreground">
          Статья ФОТ · {data.employee.role_name}
        </p>
        <Field label="Первое удержание" required>
          {(control) => (
            <DatePicker
              {...control}
              value={due}
              onChange={(v) =>
                setDue(
                  v
                    ? nextUniformPaymentDate(
                        v,
                        data.uniformSettings.payment_days,
                      )
                    : "",
                )
              }
            />
          )}
        </Field>
        {!!parts.length && <Installments items={parts} />}
      </EditDrawer>
      <ConfirmDialog
        open={!!cancel}
        onOpenChange={(v) => {
          if (!v) setCancel(null);
        }}
        title={`Остановить удержания за «${
          data.uniform.find((i) => i.id === cancel)?.title ?? "форму"
        }»?`}
        description="Будущие части удержаний отменятся. Уже учтённые суммы и расход на покупку сохранятся."
        confirmLabel="Остановить удержания"
        pendingLabel="Останавливаем…"
        destructive
        busy={busy}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() => void stop()}
      >
        <Field label="Причина">
          {(control) => (
            <Input
              {...control}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Например, сотрудник вернул форму"
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
function Installments({
  items,
}: {
  items: { dueOn: string; amount: number }[];
}) {
  return (
    <div className="mt-3 divide-y rounded-lg border px-3">
      {items.map((i) => (
        <div
          key={i.dueOn}
          className="flex justify-between gap-4 py-2.5 text-sm"
        >
          <span>{dateLabel(i.dueOn)}</span>
          <Money value={i.amount} fraction="auto" />
        </div>
      ))}
    </div>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} required={required}>
      {(control) => (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger {...control}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(options).map(([key, text]) => (
              <SelectItem key={key} value={key}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
