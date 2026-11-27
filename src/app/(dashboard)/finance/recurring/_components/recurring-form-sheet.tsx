"use client";

import { Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DrawerSection, DrawerStatus } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/finance/amount-input";
import { BankAccountPicker } from "@/components/finance/bank-account-picker";
import { CategoryDrawer } from "@/components/finance/category-drawer";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyCreateDrawer } from "@/components/finance/counterparty-create-drawer";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  createRecurringTemplate,
  getRecurringTemplateImpact,
  updateRecurringTemplate,
} from "@/lib/finance/recurring";
import { defaultScheduleFromDate, scheduleFromTemplate } from "@/lib/finance/recurring-schedule";
import type { AmountRoundingScale } from "@/lib/format/amount";
import { pluralRu } from "@/lib/format/plural";
import { calendarDateInZone } from "@/lib/format/zoned-day";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  RecurringTemplateInput,
  RecurringTemplateRow,
  TransactionRow,
} from "@/types/finance";

import { FieldAction } from "../../transactions/_components/fields/field-action";
import { TypeSwitch } from "../../transactions/_components/fields/type-switch";
import { withSelected } from "../../transactions/_components/fields/with-selected";
import type { TransactionPermissions } from "../../transactions/_lib/labels";
import { ScheduleFields, type ScheduleFieldsValue } from "./schedule-fields";

export type RecurringFormMode =
  | { kind: "closed" }
  | { kind: "create"; from?: TransactionRow }
  | { kind: "edit"; template: RecurringTemplateRow };

/** Права, которые нужны панели: те же, что у панели операции. */
export type RecurringFormPermissions = Pick<
  TransactionPermissions,
  "create" | "manageCategories" | "manageCounterparties"
>;

type Props = {
  mode: RecurringFormMode;
  onClose: () => void;
  /** Шаблон сохранён: `created` — новый. Уведомление показывает вызывающий. */
  onSaved: (result: { id: string; created: boolean }) => void;
  /** Действующие счета — для выбора. */
  bankAccounts: BankAccountRow[];
  /** Все счета, включая архивные, — для подписи уже выбранного. */
  allBankAccounts: BankAccountRow[];
  /** Счёт нового шаблона по умолчанию. */
  preferredAccountId?: string;
  /** Заведения, которые можно выбрать (без view_all_venues — только активное). */
  venues: AccountVenueRow[];
  /** Все заведения — для подписи уже выбранного. */
  allVenues: AccountVenueRow[];
  /** Все статьи и контрагенты, включая архивные: в выборе — действующие и уже выбранный. */
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  permissions: RecurringFormPermissions;
  amountRoundingScale: AmountRoundingScale;
  /** DaData настроена: при создании контрагента реквизиты подтянутся по ИНН. */
  dadataEnabled: boolean;
  /** Пояс аккаунта: какой это день у операции и какое сегодня число. */
  timeZone: string;
};

type TemplateType = RecurringTemplateInput["type"];

type FormState = {
  name: string;
  type: TemplateType;
  amount: number | null;
  amount_varies: boolean;
  bank_account_id: string;
  category_id: string | null;
  counterparty_id: string | null;
  venue_id: string | null;
  description: string;
  schedule: ScheduleFieldsValue;
};

type FieldErrors = Partial<Record<"name" | "amount" | "account" | "starts_on" | "ends_on", string>>;

const TEMPLATE_TYPES: TemplateType[] = ["income", "expense"];
const FALLBACK_NAME = "Платёж";

/**
 * Панель повторяющегося платежа (design-system «Боковая панель», тип А —
 * форма): создание с нуля, из операции и правка. Разделы «Платёж» и
 * «Расписание»; пикеры — те же, что в панели операции.
 */
export function RecurringFormSheet({
  mode,
  onClose,
  onSaved,
  bankAccounts,
  allBankAccounts,
  preferredAccountId,
  venues,
  allVenues,
  categories,
  counterparties,
  permissions,
  amountRoundingScale,
  dadataEnabled,
  timeZone,
}: Props) {
  const router = useRouter();
  const open = mode.kind !== "closed";
  const template = mode.kind === "edit" ? mode.template : null;
  const source = mode.kind === "create" ? (mode.from ?? null) : null;
  const editable = permissions.create;

  const [form, setForm] = useState<FormState>(() =>
    emptyForm(bankAccounts, preferredAccountId, today(timeZone)),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Сколько платежей шаблона ждут разбора: правка их не меняет. */
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmSave, setConfirmSave] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [counterpartySheetOpen, setCounterpartySheetOpen] = useState(false);

  // Для выбранного архивного счёта — показать его имя.
  const pickerAccounts = useMemo(() => {
    if (bankAccounts.some((b) => b.id === form.bank_account_id)) return bankAccounts;
    const current = allBankAccounts.find((b) => b.id === form.bank_account_id);
    return current ? [...bankAccounts, current] : bankAccounts;
  }, [allBankAccounts, bankAccounts, form.bank_account_id]);

  // Выбранное заведение остаётся в списке, даже если его нельзя выбрать заново.
  const venueChoices = useMemo(() => {
    const current = allVenues.find((v) => v.id === form.venue_id);
    return current && !venues.some((v) => v.id === current.id) ? [...venues, current] : venues;
  }, [allVenues, form.venue_id, venues]);

  const formKey =
    mode.kind === "edit"
      ? `edit:${mode.template.id}`
      : mode.kind === "create"
        ? `create:${mode.from?.id ?? ""}`
        : "closed";
  useEffect(() => {
    if (mode.kind === "closed") return;
    const day = today(timeZone);
    if (mode.kind === "edit") setForm(formFromTemplate(mode.template));
    else if (mode.from)
      setForm(formFromTransaction(mode.from, { categories, counterparties, timeZone, today: day }));
    else setForm(emptyForm(bankAccounts, preferredAccountId, day));
    setErrors({});
    setServerError(null);
    setDirty(false);
    setPendingCount(0);
    setConfirmSave(false);
    if (mode.kind !== "edit") return;
    let stale = false;
    getRecurringTemplateImpact(mode.template.id)
      .then(({ pending }) => {
        if (!stale) setPendingCount(pending);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // Форма заполняется при открытии, а не при каждом обновлении списков.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const patch = (next: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...next }));
    setDirty(true);
    setServerError(null);
    setErrors((e) => {
      const copy = { ...e };
      if ("name" in next) delete copy.name;
      if ("amount" in next) delete copy.amount;
      if ("bank_account_id" in next) delete copy.account;
      if ("schedule" in next) {
        delete copy.starts_on;
        delete copy.ends_on;
      }
      return copy;
    });
  };

  const selectType = (next: TemplateType) => {
    if (next === form.type) return;
    // Статья другого типа в выборе не видна — снимаем её, а не прячем.
    const category = categories.find((c) => c.id === form.category_id);
    patch({ type: next, category_id: category && category.type !== next ? null : form.category_id });
  };

  const account = pickerAccounts.find((b) => b.id === form.bank_account_id);
  const currency = account?.currency ?? "RUB";

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!form.name.trim()) next.name = "Укажите название";
    if (form.amount === null || !(form.amount > 0)) next.amount = "Укажите сумму больше нуля";
    if (!form.bank_account_id) next.account = "Выберите счёт";
    if (!form.schedule.starts_on) next.starts_on = "Укажите дату начала";
    else if (form.schedule.ends_on && form.schedule.ends_on < form.schedule.starts_on)
      next.ends_on = "Окончание раньше начала";
    return next;
  };

  const handleSave = async (confirmed = false) => {
    if (saving || !editable) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!account) {
      setErrors({ account: "Счёт не найден. Обновите страницу" });
      return;
    }
    // Уже порождённые платежи — снимки: правка шаблона их не меняет, и об этом
    // спрашиваем перед сохранением (DS «Боковая панель»).
    if (template && pendingCount > 0 && !confirmed) {
      setConfirmSave(true);
      return;
    }

    const input: RecurringTemplateInput = {
      name: form.name.trim(),
      type: form.type,
      legal_entity_id: account.legal_entity_id,
      venue_id: form.venue_id,
      bank_account_id: account.id,
      category_id: form.category_id,
      counterparty_id: form.counterparty_id,
      amount: form.amount as number,
      amount_varies: form.amount_varies,
      description: form.description.trim() || null,
      schedule: form.schedule.schedule,
      starts_on: form.schedule.starts_on,
      ends_on: form.schedule.ends_on,
      source_transaction_id: source?.id ?? null,
    };

    setSaving(true);
    setServerError(null);
    try {
      if (template) {
        const { error } = await updateRecurringTemplate(template.id, input);
        if (error) {
          setServerError(error);
          return;
        }
        setDirty(false);
        onSaved({ id: template.id, created: false });
      } else {
        const { id, error } = await createRecurringTemplate(input);
        if (error || !id) {
          setServerError(error ?? "Не удалось создать повторяющийся платёж");
          return;
        }
        setDirty(false);
        onSaved({ id, created: true });
      }
    } catch {
      setServerError("Нет связи с сервером. Проверьте соединение и повторите");
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && editable) setConfirmDiscard(true);
    else onClose();
  };

  // ─── Шапка и подвал ───────────────────────────────────────────────────────

  const title = template ? template.name : "Новый повторяющийся платёж";
  const description = template
    ? undefined
    : source
      ? `Из операции №${source.public_id}`
      : undefined;
  const titleAccessory = template ? (
    template.paused_at ? (
      <DrawerStatus label="На паузе" tone="neutral" />
    ) : (
      <DrawerStatus label="Активен" tone="success" />
    )
  ) : null;

  const footer = editable ? (
    <>
      <Button variant="outline" onClick={requestClose} disabled={saving}>
        Отмена
      </Button>
      <Button onClick={() => void handleSave()} disabled={saving} className="min-w-36">
        {saving ? "Сохраняем…" : template ? "Сохранить" : "Создать платёж"}
      </Button>
    </>
  ) : (
    <Button variant="outline" onClick={onClose}>
      Закрыть
    </Button>
  );

  const locked = !editable;

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        title={title}
        description={description}
        titleAccessory={titleAccessory}
        footer={footer}
      >
        {locked ? (
          <p
            role="status"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
          >
            Нет прав на изменение повторяющихся платежей
          </p>
        ) : null}

        <DrawerSection title="Платёж">
          <Field label="Название" required error={errors.name}>
            {(control) => (
              <Input
                {...control}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Например: аренда"
                readOnly={locked}
              />
            )}
          </Field>

          {locked ? null : (
            <TypeSwitch value={form.type} onChange={selectType} types={TEMPLATE_TYPES} />
          )}

          <div className="space-y-3">
            <Field label="Сумма" required error={errors.amount}>
              {(control) => (
                <AmountInput
                  {...control}
                  value={form.amount}
                  onChange={(amount) => patch({ amount })}
                  currency={currency}
                  disabled={locked}
                />
              )}
            </Field>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="recurring-amount-varies" className="cursor-pointer">
                  Сумма меняется
                </Label>
                {form.amount_varies ? (
                  <p className="text-xs text-muted-foreground">
                    При проведении сумму укажете заново, эта останется подсказкой
                  </p>
                ) : null}
              </div>
              <Switch
                id="recurring-amount-varies"
                checked={form.amount_varies}
                onCheckedChange={(amount_varies) => patch({ amount_varies })}
                disabled={locked}
              />
            </div>
          </div>

          <Field label="Счёт" required error={errors.account}>
            {() => (
              <BankAccountPicker
                bankAccounts={pickerAccounts}
                value={form.bank_account_id || null}
                onChange={(id) => patch({ bank_account_id: id ?? "" })}
                placeholder="Выберите счёт"
                amountRoundingScale={amountRoundingScale}
                ariaLabel="Счёт"
                disabled={locked}
              />
            )}
          </Field>

          <FieldAction
            label="Создать статью"
            show={!locked && permissions.manageCategories}
            onClick={() => setCategorySheetOpen(true)}
          >
            <Field label="Статья">
              {() => (
                <CategoryPicker
                  categories={withSelected(categories, form.category_id)}
                  value={form.category_id}
                  onChange={(category_id) => patch({ category_id })}
                  type={form.type}
                  placeholder="Без статьи"
                  allowClear
                  ariaLabel="Статья"
                  disabled={locked}
                />
              )}
            </Field>
          </FieldAction>

          <FieldAction
            label="Создать контрагента"
            show={!locked && permissions.manageCounterparties}
            onClick={() => setCounterpartySheetOpen(true)}
          >
            <Field label="Контрагент">
              {() => (
                <CounterpartyPicker
                  counterparties={withSelected(counterparties, form.counterparty_id)}
                  value={form.counterparty_id}
                  onChange={(counterparty_id) => patch({ counterparty_id })}
                  placeholder="Без контрагента"
                  allowClear
                  ariaLabel="Контрагент"
                  disabled={locked}
                />
              )}
            </Field>
          </FieldAction>

          {allVenues.length > 0 ? (
            <Field label="Заведение">
              {(control) => (
                <OptionSelect
                  {...control}
                  value={form.venue_id ?? ""}
                  onValueChange={(v) => patch({ venue_id: v || null })}
                  options={[
                    { value: "", label: "Без заведения" },
                    ...venueChoices.map((v) => ({ value: v.id, label: v.name })),
                  ]}
                  disabled={locked}
                />
              )}
            </Field>
          ) : null}

          <Field label="Описание">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Например: аренда помещения, договор №12"
                readOnly={locked}
              />
            )}
          </Field>
        </DrawerSection>

        <ScheduleFields
          value={form.schedule}
          onChange={(schedule) => patch({ schedule })}
          disabled={locked}
          errors={{ starts_on: errors.starts_on, ends_on: errors.ends_on }}
        />

        {template && editable && pendingCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Изменения применятся к следующим платежам. {pendingText(pendingCount)}
          </p>
        ) : null}

        {serverError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
          >
            {serverError}
          </p>
        ) : null}
      </EditDrawer>

      {/* Создание справочника из формы — исключение из «панель поверх панели»:
          правка образца из формы, которая его использует. */}
      <CategoryDrawer
        open={categorySheetOpen}
        onOpenChange={setCategorySheetOpen}
        category={null}
        createType={form.type}
        lockType
        canManage={permissions.manageCategories}
        onSaved={(id) => {
          patch({ category_id: id });
          setCategorySheetOpen(false);
          router.refresh();
        }}
      />
      <CounterpartyCreateDrawer
        open={counterpartySheetOpen}
        onOpenChange={setCounterpartySheetOpen}
        dadataEnabled={dadataEnabled}
        onCreated={(id) => {
          patch({ counterparty_id: id });
          setCounterpartySheetOpen(false);
          router.refresh();
        }}
      />

      <ConfirmDialog
        icon={Save}
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="Сохранить изменения?"
        description={`${pendingText(pendingCount)}. Изменения применятся к следующим платежам.`}
        confirmLabel="Сохранить"
        onConfirm={() => {
          setConfirmSave(false);
          void handleSave(true);
        }}
      />

      <ConfirmDialog
        icon={Undo2}
        cancelLabel="Продолжить редактирование"
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Не сохранять изменения?"
        description="Внесённые правки пропадут."
        confirmLabel="Не сохранять"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          setDirty(false);
          onClose();
        }}
      />
    </>
  );
}

// ─── Помощники ──────────────────────────────────────────────────────────────

/** «3 платежа уже ждут разбора и останутся прежними». */
function pendingText(n: number): string {
  return `${n.toLocaleString("ru-RU")} ${pluralRu(n, "платёж", "платежа", "платежей")} уже ${pluralRu(
    n,
    "ждёт",
    "ждут",
    "ждут",
  )} разбора и ${pluralRu(n, "останется прежним", "останутся прежними", "останутся прежними")}`;
}

/** Сегодня в поясе аккаунта — как его считает сервер. */
function today(timeZone: string): string {
  return calendarDateInZone(new Date().toISOString(), timeZone);
}

function emptyForm(accounts: BankAccountRow[], preferredId: string | undefined, day: string): FormState {
  return {
    name: "",
    type: "expense",
    amount: null,
    amount_varies: false,
    bank_account_id: accounts.find((a) => a.id === preferredId)?.id ?? accounts[0]?.id ?? "",
    category_id: null,
    counterparty_id: null,
    venue_id: null,
    description: "",
    schedule: { schedule: defaultScheduleFromDate(day), starts_on: day, ends_on: null },
  };
}

/**
 * Шаблон из операции: поля — из операции; название — контрагент, иначе
 * статья, иначе «Платёж»; число месяца — день операции в поясе аккаунта;
 * начало — сегодня.
 */
function formFromTransaction(
  tx: TransactionRow,
  ctx: {
    categories: FinanceCategoryRow[];
    counterparties: CounterpartyRow[];
    timeZone: string;
    today: string;
  },
): FormState {
  const counterparty = ctx.counterparties.find((c) => c.id === tx.counterparty_id);
  const category = ctx.categories.find((c) => c.id === tx.category_id);
  return {
    name: counterparty?.name ?? category?.name ?? FALLBACK_NAME,
    type: tx.type === "income" ? "income" : "expense",
    amount: Number(tx.amount),
    amount_varies: false,
    bank_account_id: tx.bank_account_id,
    category_id: tx.category_id ?? null,
    counterparty_id: tx.counterparty_id ?? null,
    venue_id: tx.venue_id ?? null,
    description: tx.description ?? "",
    schedule: {
      schedule: defaultScheduleFromDate(calendarDateInZone(tx.date, ctx.timeZone)),
      starts_on: ctx.today,
      ends_on: null,
    },
  };
}

function formFromTemplate(t: RecurringTemplateRow): FormState {
  return {
    name: t.name,
    type: t.type === "income" ? "income" : "expense",
    amount: Number(t.amount),
    amount_varies: t.amount_varies,
    bank_account_id: t.bank_account_id,
    category_id: t.category_id ?? null,
    counterparty_id: t.counterparty_id ?? null,
    venue_id: t.venue_id ?? null,
    description: t.description ?? "",
    schedule: {
      schedule: scheduleFromTemplate(t),
      starts_on: t.starts_on,
      ends_on: t.ends_on ?? null,
    },
  };
}
