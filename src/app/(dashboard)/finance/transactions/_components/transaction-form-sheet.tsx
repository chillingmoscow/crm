"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  CalendarPlus2,
  Loader2,
  Minus,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BankAccountPicker } from "@/components/finance/bank-account-picker";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import {
  createTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "@/lib/finance/transactions";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionFormInput,
  TransactionRow,
} from "@/types/finance";
import type { LegalEntityRow } from "@/lib/org/legal-entities";

import { useRouter } from "next/navigation";

import { CategoryFormSheet } from "./category-form-sheet";
import { CounterpartyFormSheet } from "./counterparty-form-sheet";
import { BankAccountFormSheet, type CreatedBankAccount } from "./bank-account-form-sheet";
import { formatDateTime, todayIso } from "../_lib/utils";
import type { AmountRoundingScale } from "@/lib/format/amount";

export type FormMode =
  | { kind: "closed" }
  | { kind: "create"; type: TransactionRow["type"] }
  | { kind: "edit"; transaction: TransactionRow };

type Props = {
  mode: FormMode;
  prefill: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
  onTypeChange: (next: TransactionRow["type"]) => void;
  legalEntities: LegalEntityRow[];
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  canDelete: boolean;
  amountRoundingScale: AmountRoundingScale;
};

type FormState = {
  type: TransactionRow["type"];
  amount: string;
  bank_account_id: string;
  to_bank_account_id: string;
  category_id: string | null;
  counterparty_id: string | null;
  date: string;
  description: string;
};

const INITIAL_FORM: FormState = {
  type: "expense",
  amount: "",
  bank_account_id: "",
  to_bank_account_id: "",
  category_id: null,
  counterparty_id: null,
  date: todayIso(),
  description: "",
};

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  income: "Приход",
  expense: "Расход",
  transfer: "Перевод",
};

export function TransactionFormSheet({
  mode,
  prefill,
  onClose,
  onSaved,
  onTypeChange,
  legalEntities,
  bankAccounts: bankAccountsProp,
  categories,
  counterparties,
  canDelete,
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const open = mode.kind !== "closed";
  const isEditing = mode.kind === "edit";

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [counterpartySheetOpen, setCounterpartySheetOpen] = useState(false);
  const [bankAccountSheetOpen, setBankAccountSheetOpen] = useState(false);

  // Accounts created via inline-create within the current drawer session.
  // We can't rely on the parent's `bankAccounts` prop being refreshed in
  // time — user may pick the new account and submit before parent's
  // router.refresh() round-trip completes. So we keep our own bridge
  // list and merge it with props; the rest of the component then reads
  // from the merged `bankAccounts` (no other usages need to change).
  const [localAccounts, setLocalAccounts] = useState<CreatedBankAccount[]>([]);
  const bankAccounts = useMemo<BankAccountRow[]>(() => {
    const ids = new Set(bankAccountsProp.map((b) => b.id));
    const extras = localAccounts.filter((a) => !ids.has(a.id));
    if (extras.length === 0) return bankAccountsProp;
    // Cast: BankAccountPicker reads only id/name/legal_entity_id from
    // the array; the synthetic rows pad the rest with null/defaults
    // and are never rendered outside the picker label.
    return [
      ...bankAccountsProp,
      ...extras.map(
        (a) =>
          ({
            ...a,
            account_id: "",
            balance: 0,
            description: null,
            group_id: null,
            bank_name: null,
            bik: null,
            account_number: null,
            correspondent_account: null,
            acquiring_percentage: null,
            card_holder: null,
            card_number_last4: null,
            is_active: true,
            venue_id: null,
            created_at: new Date().toISOString(),
            created_by: null,
            updated_at: null,
            updated_by: null,
            deleted_at: null,
            deleted_by: null,
          }) as BankAccountRow,
      ),
    ];
  }, [bankAccountsProp, localAccounts]);

  // Reset the inline-create bridge whenever the drawer closes — once
  // closed, props will eventually be refreshed by the parent's
  // router.refresh() and the synthetic copies become redundant (or
  // conflict with the real ones if names changed server-side).
  useEffect(() => {
    if (mode.kind === "closed") setLocalAccounts([]);
  }, [mode.kind]);

  useEffect(() => {
    if (mode.kind === "closed") return;
    if (mode.kind === "create") {
      const seed = prefill
        ? formFromTransaction(prefill, mode.type)
        : {
            ...INITIAL_FORM,
            type: mode.type,
            bank_account_id: bankAccounts[0]?.id ?? "",
            to_bank_account_id:
              mode.type === "transfer" && bankAccounts.length >= 2
                ? bankAccounts[1].id
                : "",
          };
      setForm(seed);
    } else {
      setForm(formFromTransaction(mode.transaction, mode.transaction.type));
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, isEditing && (mode as { transaction?: TransactionRow }).transaction?.id, prefill?.id]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const onSelectType = (next: TransactionRow["type"]) => {
    if (isEditing) return;
    if (next === "transfer" && bankAccounts.length < 2) {
      toast.error("Для перевода нужно как минимум два счёта");
      return;
    }
    setForm((f) => ({
      ...f,
      type: next,
      category_id: next === "transfer" ? null : f.category_id,
      counterparty_id: next === "transfer" ? null : f.counterparty_id,
      to_bank_account_id:
        next === "transfer" && !f.to_bank_account_id
          ? bankAccounts.find((b) => b.id !== f.bank_account_id)?.id ?? ""
          : f.to_bank_account_id,
    }));
    setDirty(true);
    onTypeChange(next);
  };

  const onPickPrimaryAccount = (id: string | null) => {
    if (!id) {
      update("bank_account_id", "");
      return;
    }
    if (form.type === "transfer" && id === form.to_bank_account_id) {
      const other = bankAccounts.find((b) => b.id !== id)?.id ?? "";
      setForm((f) => ({ ...f, bank_account_id: id, to_bank_account_id: other }));
      setDirty(true);
    } else {
      update("bank_account_id", id);
    }
  };

  const onPickToAccount = (id: string | null) => {
    if (!id) {
      update("to_bank_account_id", "");
      return;
    }
    if (id === form.bank_account_id) {
      const other = bankAccounts.find((b) => b.id !== id)?.id ?? "";
      setForm((f) => ({ ...f, to_bank_account_id: id, bank_account_id: other }));
      setDirty(true);
    } else {
      update("to_bank_account_id", id);
    }
  };

  const handleSave = async () => {
    if (saving) return;

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Сумма должна быть больше нуля");
      return;
    }
    if (!form.bank_account_id) {
      toast.error("Выберите счёт");
      return;
    }
    if (!form.date) {
      toast.error("Укажите дату");
      return;
    }

    const sourceAccount = bankAccounts.find((b) => b.id === form.bank_account_id);
    if (!sourceAccount) {
      toast.error("Выбранный счёт не найден");
      return;
    }

    if (form.type === "transfer") {
      if (!form.to_bank_account_id) {
        toast.error("Выберите счёт получателя");
        return;
      }
      if (form.bank_account_id === form.to_bank_account_id) {
        toast.error("Исходный и целевой счета должны быть разными");
        return;
      }
    }

    const targetAccount = form.to_bank_account_id
      ? bankAccounts.find((b) => b.id === form.to_bank_account_id)
      : null;

    const common = {
      legal_entity_id: sourceAccount.legal_entity_id,
      venue_id: null,
      bank_account_id: form.bank_account_id,
      amount,
      currency: sourceAccount.currency,
      date: form.date,
      description: form.description.trim() || null,
    };

    let payload: TransactionFormInput;
    if (form.type === "transfer") {
      if (!targetAccount) {
        toast.error("Целевой счёт не найден");
        return;
      }
      payload = {
        ...common,
        type: "transfer",
        to_bank_account_id: targetAccount.id,
        to_legal_entity_id: targetAccount.legal_entity_id,
      };
    } else {
      payload = {
        ...common,
        type: form.type,
        category_id: form.category_id,
        counterparty_id: form.counterparty_id,
      };
    }

    setSaving(true);
    try {
      if (isEditing) {
        const id = (mode as { transaction: TransactionRow }).transaction.id;
        const { error } = await updateTransaction(id, payload);
        if (error) {
          toast.error(error);
          return;
        }
        toast.success("Транзакция сохранена");
      } else {
        const { id, error } = await createTransaction(payload);
        if (error || !id) {
          toast.error(error ?? "Не удалось создать транзакцию");
          return;
        }
        toast.success("Транзакция создана");
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEditing) return;
    const id = (mode as { transaction: TransactionRow }).transaction.id;
    setConfirmDelete(false);
    const { error } = await softDeleteTransaction(id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Транзакция удалена");
    onSaved();
  };

  const requestClose = () => {
    if (dirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const filteredCategoryType = form.type === "transfer" ? undefined : form.type;
  const tx = mode.kind === "edit" ? mode.transaction : null;

  const sourceLegalEntityId = useMemo(
    () =>
      bankAccounts.find((b) => b.id === form.bank_account_id)?.legal_entity_id ?? null,
    [bankAccounts, form.bank_account_id]
  );

  const sourceCurrency =
    bankAccounts.find((b) => b.id === form.bank_account_id)?.currency ?? "RUB";
  const targetCurrency =
    bankAccounts.find((b) => b.id === form.to_bank_account_id)?.currency ?? null;

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(o) => {
          if (o) return; // open transitions are driven by `mode`, not user
          // Outside-click / ESC / X-button: guard on dirty.
          if (dirty && !saving) {
            setConfirmDiscard(true);
            return; // don't propagate close — `open` prop stays true, drawer stays
          }
          onClose();
        }}
        title={isEditing ? "Редактировать операцию" : "Добавить операцию"}
        description={
          isEditing
            ? undefined
            : "Заполните поля и сохраните, чтобы добавить новую операцию в журнал."
        }
        footer={
          <>
            {isEditing && canDelete && (
              <Button
                variant="destructive"
                className="mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 />
                Удалить
              </Button>
            )}
            <Button variant="outline" onClick={requestClose} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Сохранить
            </Button>
          </>
        }
      >
        {/* Type pill — disabled on edit */}
        <TypePill
          type={form.type}
          disabled={isEditing}
          onChange={onSelectType}
          transferDisabled={bankAccounts.length < 2}
        />

        {form.type === "transfer" ? (
          <TransferFields
            form={form}
            bankAccounts={bankAccounts}
            sourceCurrency={sourceCurrency}
            targetCurrency={targetCurrency}
            amountRoundingScale={amountRoundingScale}
            onChange={(next) => {
              setForm(next);
              setDirty(true);
            }}
            onPickPrimary={onPickPrimaryAccount}
            onPickTarget={onPickToAccount}
            onAddBankAccount={() => setBankAccountSheetOpen(true)}
          />
        ) : (
          <IncomeExpenseFields
            form={form}
            bankAccounts={bankAccounts}
            categories={categories}
            counterparties={counterparties}
            filteredCategoryType={filteredCategoryType}
            amountRoundingScale={amountRoundingScale}
            onChange={(next) => {
              setForm(next);
              setDirty(true);
            }}
            onPickPrimary={onPickPrimaryAccount}
            onAddBankAccount={() => setBankAccountSheetOpen(true)}
            onAddCategory={() => setCategorySheetOpen(true)}
            onAddCounterparty={() => setCounterpartySheetOpen(true)}
          />
        )}

        {/* Audit history (edit only) */}
        {isEditing && tx && (tx.created_at || tx.updated_at) && (
          <div className="pt-2 mt-2 border-t">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              История изменений
            </p>
            <ul className="space-y-2">
              {tx.created_at && (
                <li className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                    <CalendarPlus2 className="h-4 w-4" />
                  </div>
                  <div className="text-sm">
                    <div>Создано</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(tx.created_at)}
                    </div>
                  </div>
                </li>
              )}
              {tx.updated_at && tx.updated_at !== tx.created_at && (
                <li className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <PenLine className="h-4 w-4" />
                  </div>
                  <div className="text-sm">
                    <div>Изменено</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(tx.updated_at)}
                    </div>
                  </div>
                </li>
              )}
            </ul>
          </div>
        )}
      </EditDrawer>

      {/* Inline-create sheets — nested on top of the form */}
      <CategoryFormSheet
        open={categorySheetOpen}
        defaultType={form.type === "income" ? "income" : "expense"}
        onClose={() => setCategorySheetOpen(false)}
        onCreated={(id) => {
          update("category_id", id);
          setCategorySheetOpen(false);
        }}
      />
      <CounterpartyFormSheet
        open={counterpartySheetOpen}
        onClose={() => setCounterpartySheetOpen(false)}
        onCreated={(id) => {
          update("counterparty_id", id);
          setCounterpartySheetOpen(false);
        }}
      />
      <BankAccountFormSheet
        open={bankAccountSheetOpen}
        legalEntities={legalEntities}
        defaultLegalEntityId={sourceLegalEntityId}
        onClose={() => setBankAccountSheetOpen(false)}
        onCreated={(account) => {
          // Stash a synthetic record so the merged `bankAccounts` list
          // already contains this id when the user clicks Save —
          // otherwise validation in handleSave wouldn't find it.
          setLocalAccounts((prev) => [...prev, account]);
          if (!form.bank_account_id) {
            update("bank_account_id", account.id);
          } else if (form.type === "transfer" && !form.to_bank_account_id) {
            update("to_bank_account_id", account.id);
          } else {
            update("bank_account_id", account.id);
          }
          setBankAccountSheetOpen(false);
          // Kick a background refresh so the list page (and the
          // bank-accounts page when the user navigates) sees the new
          // account from the server. Form state is preserved through
          // refresh because TransactionFormSheet stays mounted.
          router.refresh();
        }}
      />

      {/* Delete confirmation — AlertDialog primitive: правильная
          семантика role="alertdialog" + блокирует закрытие по
          overlay/Esc. Копи «30 дней» снят — реального retention
          через 30 дней в БД нет, запись соft-удалена и видна
          в журнале изменений всегда. */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-4 w-4" />
              </span>
              Удалить операцию
            </AlertDialogTitle>
            <AlertDialogDescription>
              Операция будет удалена из текущего журнала. Восстановить её можно из истории изменений.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className={buttonVariants({ variant: "destructive" })}
            >
              <Trash2 />
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard-changes confirmation — without redundant X-close in the
          corner (two explicit buttons), neutral copy without "нельзя
          отменить" (это in-memory изменения, не destructive). */}
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="sm:max-w-md" hideClose>
          <DialogHeader>
            <DialogTitle>Не сохранять изменения?</DialogTitle>
            <DialogDescription>
              Внесённые правки будут потеряны.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmDiscard(false);
                setDirty(false);
                onClose();
              }}
            >
              Не сохранять
            </Button>
            <Button
              autoFocus
              onClick={() => setConfirmDiscard(false)}
            >
              Продолжить редактирование
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Type pill ───────────────────────────────────────────────────────────────

function TypePill({
  type,
  disabled,
  onChange,
  transferDisabled,
}: {
  type: TransactionRow["type"];
  disabled: boolean;
  onChange: (next: TransactionRow["type"]) => void;
  transferDisabled: boolean;
}) {
  const colorClasses =
    type === "income"
      ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900/50"
      : type === "expense"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900/50"
        : "bg-brand/10 text-brand border-brand/20";

  const Icon =
    type === "income" ? Plus : type === "expense" ? Minus : ArrowLeftRight;

  return (
    <Select
      value={type}
      onValueChange={(v) => onChange(v as TransactionRow["type"])}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          "h-7 w-fit gap-1.5 rounded-full border px-2.5 py-0 text-xs font-medium",
          colorClasses,
          disabled && "opacity-60"
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{TYPE_LABEL[type]}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="income">
          <span className="inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            Приход
          </span>
        </SelectItem>
        <SelectItem value="expense">
          <span className="inline-flex items-center gap-1.5">
            <Minus className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            Расход
          </span>
        </SelectItem>
        <SelectItem value="transfer" disabled={transferDisabled}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5 text-brand" />
            Перевод
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── Field groups ────────────────────────────────────────────────────────────

function IncomeExpenseFields({
  form,
  bankAccounts,
  categories,
  counterparties,
  filteredCategoryType,
  amountRoundingScale,
  onChange,
  onPickPrimary,
  onAddBankAccount,
  onAddCategory,
  onAddCounterparty,
}: {
  form: FormState;
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  filteredCategoryType: "income" | "expense" | undefined;
  amountRoundingScale: AmountRoundingScale;
  onChange: (next: FormState) => void;
  onPickPrimary: (id: string | null) => void;
  onAddBankAccount: () => void;
  onAddCategory: () => void;
  onAddCounterparty: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="amt">Сумма</Label>
          <Input
            id="amt"
            inputMode="decimal"
            placeholder="0,00"
            value={form.amount}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (v === "" || /^[0-9]*\.?[0-9]*$/.test(v)) {
                onChange({ ...form, amount: v });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center justify-between">
            Счёт
            <CreateLink onClick={onAddBankAccount} label="+ Создать счёт" />
          </Label>
          <BankAccountPicker
            bankAccounts={bankAccounts}
            value={form.bank_account_id || null}
            onChange={onPickPrimary}
            placeholder="Выберите счёт"
            amountRoundingScale={amountRoundingScale}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="flex items-center justify-between">
            Статья
            <CreateLink onClick={onAddCategory} label="+ Создать новую статью" />
          </Label>
          <CategoryPicker
            categories={categories}
            value={form.category_id}
            onChange={(v) => onChange({ ...form, category_id: v })}
            type={filteredCategoryType}
            placeholder="Без статьи"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dt">Дата</Label>
          <DatePicker
            id="dt"
            value={form.date}
            onChange={(date) => onChange({ ...form, date })}
            placeholder="Выберите дату"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center justify-between">
          Контрагент
          <CreateLink onClick={onAddCounterparty} label="+ Создать контрагента" />
        </Label>
        <CounterpartyPicker
          counterparties={counterparties}
          value={form.counterparty_id}
          onChange={(v) => onChange({ ...form, counterparty_id: v })}
          placeholder="Без контрагента"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dsc">Описание</Label>
        <Textarea
          id="dsc"
          rows={3}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="Например: оплата за аренду, ссылки на счёт-фактуры…"
        />
      </div>
    </>
  );
}

function TransferFields({
  form,
  bankAccounts,
  sourceCurrency,
  targetCurrency,
  amountRoundingScale,
  onChange,
  onPickPrimary,
  onPickTarget,
  onAddBankAccount,
}: {
  form: FormState;
  bankAccounts: BankAccountRow[];
  sourceCurrency: string;
  targetCurrency: string | null;
  amountRoundingScale: AmountRoundingScale;
  onChange: (next: FormState) => void;
  onPickPrimary: (id: string | null) => void;
  onPickTarget: (id: string | null) => void;
  onAddBankAccount: () => void;
}) {
  const differentCurrencies =
    targetCurrency !== null && targetCurrency !== sourceCurrency;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="t-amt">Сумма перевода</Label>
        <Input
          id="t-amt"
          inputMode="decimal"
          placeholder="0,00"
          value={form.amount}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (v === "" || /^[0-9]*\.?[0-9]*$/.test(v)) {
              onChange({ ...form, amount: v });
            }
          }}
        />
      </div>

      {differentCurrencies && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="t-amt-target">
              Сумма поступления ({targetCurrency})
            </Label>
            <span className="text-xs text-muted-foreground">
              Расчёт по валюте счёта
            </span>
          </div>
          <Input
            id="t-amt-target"
            inputMode="decimal"
            placeholder="0,00"
            disabled
            value=""
            // Cross-currency target amount is not yet stored in the
            // schema (TransactionRow has no to_amount/to_currency).
            // The legacy build supported it; field is shown for design
            // parity but disabled until the schema migration lands.
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="flex items-center justify-between">
          Счёт списания
          <CreateLink onClick={onAddBankAccount} label="+ Создать счёт" />
        </Label>
        <BankAccountPicker
          bankAccounts={bankAccounts}
          value={form.bank_account_id || null}
          onChange={onPickPrimary}
          placeholder="Выберите счёт"
          amountRoundingScale={amountRoundingScale}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Счёт поступления</Label>
          <span className="text-xs text-muted-foreground">
            Счёт списания исключается
          </span>
        </div>
        <BankAccountPicker
          bankAccounts={bankAccounts}
          value={form.to_bank_account_id || null}
          onChange={onPickTarget}
          excludeId={form.bank_account_id || null}
          placeholder="Выберите счёт"
          amountRoundingScale={amountRoundingScale}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="t-dt">Дата</Label>
        <DatePicker
          id="t-dt"
          value={form.date}
          onChange={(date) => onChange({ ...form, date })}
          placeholder="Выберите дату"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="t-dsc">Описание</Label>
        <Textarea
          id="t-dsc"
          rows={2}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="Например: пополнение валютного счёта"
        />
      </div>
    </>
  );
}

function CreateLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-brand hover:underline"
    >
      {label}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formFromTransaction(
  tx: TransactionRow,
  type: TransactionRow["type"]
): FormState {
  return {
    type,
    amount: String(tx.amount),
    bank_account_id: tx.bank_account_id,
    to_bank_account_id: tx.to_bank_account_id ?? "",
    category_id: tx.category_id ?? null,
    counterparty_id: tx.counterparty_id ?? null,
    date: tx.date.slice(0, 10),
    description: tx.description ?? "",
  };
}
