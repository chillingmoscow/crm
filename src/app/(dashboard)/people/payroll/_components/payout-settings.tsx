"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { ProfileSection } from "@/components/shared/profile-section";
import { useSaveSection } from "@/components/shared/save-bar";
import { unwrapAction } from "@/lib/actions/result";
import { DEFAULT_PAYOUT_SCHEDULES, type PayoutScheduleCode } from "@/lib/payroll/payout-plan";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayoutAssignments, savePayoutSettings, setPayoutAuto, type PayoutAssignments } from "../payout-actions";
import { Switch } from "@/components/ui/switch";
import { PayrollEmployeePicker } from "./payroll-employee-picker";
import { selectClass } from "./select-class";

type Saved = PayoutAssignments;
type Form = {
  auto: boolean;
  minCash: string;
  bankId: string;
  chatId: string;
  mainStep: string;
  mainReserve: string;
  cleaner: string[];
  transfer: string[];
};

const num = (v: unknown, fallback: number) => String(v ?? fallback);

function formFrom(data: PayrollData, saved: Saved): Form {
  const row = saved.saved;
  const byName = (type: string, pattern: RegExp) =>
    data.banks.find((b) => b.type === type && pattern.test(b.name))?.id ?? "";
  const schedules = (row?.schedules ?? {}) as Partial<Record<PayoutScheduleCode, { step?: number; reserve?: number; bank_account_id?: string | null }>>;
  return {
    auto: row?.auto_issue === true,
    minCash: num(row?.min_cash, 120000),
    bankId: row?.bank_account_id ?? byName("cash", /кэшбокс/i),
    chatId: row?.chat_id ?? "",
    mainStep: num(schedules.main?.step, DEFAULT_PAYOUT_SCHEDULES.main.step),
    mainReserve: num(schedules.main?.reserve, DEFAULT_PAYOUT_SCHEDULES.main.reserve),
    cleaner: saved.employees.filter((e) => e.schedule === "cleaner").map((e) => e.id).sort(),
    transfer: saved.employees.filter((e) => e.schedule === "transfer").map((e) => e.id).sort(),
  };
}

const sameForm = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b);

function validate(form: Form): string | null {
  const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
  const step = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 100000;
  if (!money(form.minCash)) return "Укажите минимум в кэшбоксе в рублях";
  if (!form.bankId) return "Выберите кассу для выдачи наличными";
  if (form.chatId.trim() && !/^-?\d+$/.test(form.chatId.trim())) return "ID чата: число, например -1001234567890";
  if (!step(form.mainStep)) return "Шаг округления: целое число от 1 до 100 000";
  if (!money(form.mainReserve)) return "Укажите запас в рублях";
  return null;
}

/**
 * «График выплат»: минимум наличных после выдачи, касса и чат менеджеров,
 * шаг и запас по графикам, кто из сотрудников на особом графике.
 */
export function PayoutScheduleSettings({ data, onSaved }: { data: PayrollData; onSaved: () => Promise<void> }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setSaved(unwrapAction(await loadPayoutAssignments()));
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить график выплат"));
  }, [load]);
  if (error)
    return (
      <ProfileSection title="График выплат">
        <p role="alert" className="text-sm text-muted-foreground">{error}</p>
      </ProfileSection>
    );
  if (!saved)
    return (
      <ProfileSection title="График выплат">
        <p className="text-sm text-muted-foreground">Загружаем график выплат…</p>
      </ProfileSection>
    );
  return (
    <PayoutScheduleForm
      data={data}
      saved={saved}
      onSaved={async () => {
        await load();
        await onSaved();
      }}
    />
  );
}

function PayoutScheduleForm({ data, saved, onSaved }: { data: PayrollData; saved: Saved; onSaved: () => Promise<void> }) {
  const initial = useMemo(() => formFrom(data, saved), [data, saved]);
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    setForm(JSON.parse(initialKey) as Form);
  }, [initialKey]);
  const canConfigure = data.permissions.includes("payroll.configure");
  const canIssue = data.permissions.includes("payroll.pay") && data.permissions.includes("finance.create_transaction");
  const dirty = canConfigure && !sameForm(form, initial);
  const blocked = validate(form);
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const cash = data.banks.filter((b) => b.type === "cash");
  const people = data.employees
    .filter((e) => e.active && !e.casual)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const names = (ids: string[]) =>
    people.filter((e) => ids.includes(e.id)).map((e) => e.name).join(", ");

  const save = async () => {
    if (!canConfigure || blocked) return false;
    setBusy(true);
    try {
      const scheduleOf = (id: string): PayoutScheduleCode =>
        form.cleaner.includes(id) ? "cleaner" : form.transfer.includes(id) ? "transfer" : "main";
      unwrapAction(
        await savePayoutSettings({
          min_cash: Number(form.minCash),
          chat_id: form.chatId.trim(),
          bank_account_id: form.bankId || null,
          schedules: {
            main: { step: Number(form.mainStep), reserve: Number(form.mainReserve) },
            cleaner: { step: DEFAULT_PAYOUT_SCHEDULES.cleaner.step, reserve: DEFAULT_PAYOUT_SCHEDULES.cleaner.reserve },
          },
          // Только те, у кого график меняется: остальных не трогаем.
          assignments: saved.employees
            .filter((e) => scheduleOf(e.id) !== e.schedule)
            .map((e) => ({ employee_id: e.id, schedule: scheduleOf(e.id) })),
        }),
      );
      if (form.auto !== initial.auto) unwrapAction(await setPayoutAuto(form.auto));
      await onSaved();
      toast.success("График выплат сохранён");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveBar = useSaveSection({
    dirty,
    saving: busy,
    blocked: dirty ? blocked : null,
    save,
    reset: () => setForm(initial),
  });
  const disabled = !canConfigure || busy;
  const field = (id: string, label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="numeric" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <ProfileSection
      title="График выплат"
      description="Как приложение планирует первую и вторую выплату и сколько наличных оставляет в кассе."
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !blocked && !busy) void save();
        }}
      >
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="payout-auto">Выдавать автоматически в 14:00</Label>
            <p className="text-[13px] text-muted-foreground">
              В день выплаты по утверждённому плану приложение само проверяет кассы, проводит выплаты и пишет менеджерам.
              Если выдать нельзя, придёт сообщение в чат отчётов. Выключено — выдача только кнопкой «Выдать сейчас».
            </p>
            {!canIssue && (
              <p className="text-[13px] text-muted-foreground">
                Включить могут те, у кого есть права на выплаты и операции в финансах.
              </p>
            )}
          </div>
          <Switch
            id="payout-auto"
            checked={form.auto}
            // Включить — только с правами на выплаты; выключить может и настройщик.
            disabled={disabled || (!form.auto && !canIssue)}
            onCheckedChange={(auto) => set({ auto })}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {field("payout-min-cash", "Минимум в кэшбоксе после выдачи, ₽", form.minCash, (minCash) => set({ minCash }),
            "Столько наличных останется в кассах после выдачи зарплаты.")}
          <div className="space-y-2">
            <Label htmlFor="payout-cash-bank">Касса для выдачи наличными</Label>
            <OptionSelect
              id="payout-cash-bank"
              className={selectClass}
              value={form.bankId}
              disabled={disabled}
              onValueChange={(bankId) => set({ bankId })}
              placeholder="Не выбрана"
              options={cash.map((b) => ({ value: b.id, label: b.name }))}
            />
            <p className="text-[13px] text-muted-foreground">С неё проводятся выплаты по кнопке «Выдать сегодня».</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="payout-chat">Чат менеджеров</Label>
            <Input
              id="payout-chat"
              inputMode="numeric"
              placeholder="-1001234567890"
              value={form.chatId}
              disabled={disabled}
              onChange={(e) => set({ chatId: e.target.value })}
            />
            <p className="text-[13px] text-muted-foreground">
              ID Telegram-чата, куда бот пишет, кому и сколько выдать. Бот должен состоять в этом чате.
            </p>
            {busy && form.chatId.trim() && form.chatId.trim() !== initial.chatId && (
              <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Проверяем в Telegram, что бот состоит в чате…
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Основной · наличными</h3>
          <p className="text-[13px] text-muted-foreground">
            Первая выплата с 25-го по 1-е число, вторая с 10-го по 16-е. Сумма: половина месяца с прогнозом
            по оставшимся сменам, округлённая вниз.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {field("payout-main-step", "Шаг округления, ₽", form.mainStep, (mainStep) => set({ mainStep }))}
            {field("payout-main-reserve", "Запас на инвентаризацию и штрафы, ₽", form.mainReserve, (mainReserve) => set({ mainReserve }))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Вне плана</h3>
          <p className="text-[13px] text-muted-foreground">
            Сотрудники, которые сами выставляют счета (самозанятые), в план выплат не входят: их выплаты вносятся
            вручную, как обычно.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Сотрудники на особых графиках</h3>
          <p className="text-[13px] text-muted-foreground">Остальные на основном графике.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Клинер · первая выплата 18–22, вторая 3–7</Label>
              <PayrollEmployeePicker
                multiple
                employees={people}
                selectedIds={form.cleaner}
                disabled={disabled}
                onChange={(ids) => set({ cleaner: [...ids].sort(), transfer: form.transfer.filter((id) => !ids.includes(id)) })}
              />
              <p className="text-[13px] text-muted-foreground">{names(form.cleaner) || "Никого"}</p>
            </div>
            <div className="space-y-2">
              <Label>Вне плана</Label>
              <PayrollEmployeePicker
                multiple
                employees={people}
                selectedIds={form.transfer}
                disabled={disabled}
                onChange={(ids) => set({ transfer: [...ids].sort(), cleaner: form.cleaner.filter((id) => !ids.includes(id)) })}
              />
              <p className="text-[13px] text-muted-foreground">{names(form.transfer) || "Никого"}</p>
            </div>
          </div>
        </div>
        {saveBar}
      </form>
    </ProfileSection>
  );
}
