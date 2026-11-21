"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Minus, Plus, Trash2 } from "lucide-react";

import { TransactionHistory } from "@/components/audit/transaction-history";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/finance/amount-input";
import { BankAccountPicker } from "@/components/finance/bank-account-picker";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  createTransaction,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "@/lib/finance/transactions";
import { formatDayMonth } from "@/lib/format/date";
import type { AmountRoundingScale } from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionFormInput,
  TransactionRow,
} from "@/types/finance";
import type { AccountVenueRow, LegalEntityRow } from "@/lib/org/legal-entities";
import { uploadTransactionFile } from "@/lib/finance/transaction-files";

import { CategoryFormSheet } from "./category-form-sheet";
import { CounterpartyFormSheet } from "./counterparty-form-sheet";
import { TransactionFiles } from "./transaction-files";
import { BankAccountFormSheet, type CreatedBankAccount } from "./bank-account-form-sheet";
import { todayIso } from "../_lib/utils";
import {
  CREATE_TYPE_LABEL,
  NEW_TYPE_TITLE,
  SOURCE_LABEL,
  TYPE_LABEL,
  canEditTransaction,
  type TransactionPermissions,
} from "../_lib/labels";

export type FormMode =
  | { kind: "closed" }
  | { kind: "create"; type: TransactionRow["type"]; copyOf?: TransactionRow }
  | { kind: "edit"; transaction: TransactionRow };

type Props = {
  mode: FormMode;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (tx: TransactionRow) => void;
  onRestored: () => void;
  onModeChange: (mode: FormMode) => void;
  legalEntities: LegalEntityRow[];
  /** Действующие счета — для выбора. */
  bankAccounts: BankAccountRow[];
  /** Все счета, включая архивные, — для подписи уже выбранного. */
  allBankAccounts: BankAccountRow[];
  /** Счёт новой операции по умолчанию — из условий списка. */
  preferredAccountId?: string;
  /** Заведения, которые можно выбрать (без view_all_venues — только активное). */
  venues: AccountVenueRow[];
  /** Все заведения — для подписи уже выбранного. */
  allVenues: AccountVenueRow[];
  /** Заведение новой операции по умолчанию — из фильтра списка. */
  preferredVenueId?: string;
  /** Файлы операции изменились — обновить значок в списке. */
  onFilesChanged: () => void;
  /** Все статьи и контрагенты, включая архивные: в выборе — действующие и уже выбранный. */
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  permissions: TransactionPermissions;
  currentUserId: string | null;
  amountRoundingScale: AmountRoundingScale;
};

type FormState = {
  type: TransactionRow["type"];
  amount: number | null;
  bank_account_id: string;
  to_bank_account_id: string;
  category_id: string | null;
  counterparty_id: string | null;
  date: string;
  description: string;
  venue_id: string | null;
};

type FieldErrors = Partial<Record<"amount" | "account" | "toAccount" | "date", string>>;

const TYPE_ICON = { income: Plus, expense: Minus, transfer: ArrowLeftRight } as const;

/**
 * Панель операции (design-system «Боковая панель», тип А — форма):
 * создание, копия, правка. Удалённая операция открывается для просмотра и
 * восстановления; операцию без права на правку видно, но поля выключены, и
 * панель пишет почему.
 */
export function TransactionFormSheet({
  mode,
  onClose,
  onSaved,
  onDeleted,
  onRestored,
  onModeChange,
  legalEntities,
  bankAccounts: bankAccountsProp,
  allBankAccounts,
  preferredAccountId,
  venues,
  allVenues,
  preferredVenueId,
  onFilesChanged,
  categories,
  counterparties,
  permissions,
  currentUserId,
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const open = mode.kind !== "closed";
  const tx = mode.kind === "edit" ? mode.transaction : null;
  const isDeleted = !!tx?.deleted_at;
  const editable = mode.kind === "create" || (!!tx && canEditTransaction(tx, permissions, currentUserId));

  const [form, setForm] = useState<FormState>(() => emptyForm("expense", []));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  /** Файлы новой операции: прикрепятся после создания. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [counterpartySheetOpen, setCounterpartySheetOpen] = useState(false);
  const [bankAccountSheetOpen, setBankAccountSheetOpen] = useState(false);

  // Счета, созданные прямо из формы: список страницы обновится позже, а
  // выбрать и сохранить счёт можно сразу.
  const [localAccounts, setLocalAccounts] = useState<CreatedBankAccount[]>([]);
  const bankAccounts = useMemo<BankAccountRow[]>(() => {
    const ids = new Set(bankAccountsProp.map((b) => b.id));
    const extras = localAccounts
      .filter((a) => !ids.has(a.id))
      .map((a) => ({ ...a, balance: 0, deleted_at: null }) as unknown as BankAccountRow);
    return extras.length ? [...bankAccountsProp, ...extras] : bankAccountsProp;
  }, [bankAccountsProp, localAccounts]);

  // Для выбранного архивного счёта в старой операции — показать его имя.
  const pickerAccounts = useMemo(() => {
    const ids = new Set(bankAccounts.map((b) => b.id));
    const archived = allBankAccounts.filter(
      (b) =>
        !ids.has(b.id) &&
        (b.id === form.bank_account_id || b.id === form.to_bank_account_id),
    );
    return archived.length ? [...bankAccounts, ...archived] : bankAccounts;
  }, [allBankAccounts, bankAccounts, form.bank_account_id, form.to_bank_account_id]);

  // Выбранное заведение остаётся в списке, даже если его нельзя выбрать заново.
  const venueChoices = useMemo(() => {
    const current = allVenues.find((v) => v.id === form.venue_id);
    return current && !venues.some((v) => v.id === current.id) ? [...venues, current] : venues;
  }, [allVenues, form.venue_id, venues]);

  const formKey =
    mode.kind === "edit"
      ? `edit:${mode.transaction.id}`
      : mode.kind === "create"
        ? `create:${mode.copyOf?.id ?? ""}`
        : "closed";
  useEffect(() => {
    if (mode.kind === "closed") {
      setLocalAccounts([]);
      return;
    }
    if (mode.kind === "edit") setForm(formFromTransaction(mode.transaction));
    else if (mode.copyOf) setForm({ ...formFromTransaction(mode.copyOf), date: todayIso() });
    else setForm(emptyForm(mode.type, bankAccountsProp, preferredAccountId, preferredVenueId));
    setPendingFiles([]);
    setErrors({});
    setServerError(null);
    setDirty(false);
    // Форма заполняется при открытии, а не при каждом обновлении списков.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const patch = (next: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...next }));
    setDirty(true);
    setServerError(null);
    setErrors((e) => {
      const copy = { ...e };
      if ("amount" in next) delete copy.amount;
      if ("bank_account_id" in next) delete copy.account;
      if ("to_bank_account_id" in next) delete copy.toAccount;
      if ("date" in next) delete copy.date;
      return copy;
    });
  };

  const selectType = (next: TransactionRow["type"]) => {
    if (mode.kind !== "create" || next === form.type) return;
    patch({
      type: next,
      category_id: next === "transfer" ? null : form.category_id,
      counterparty_id: next === "transfer" ? null : form.counterparty_id,
      to_bank_account_id:
        next === "transfer" && !form.to_bank_account_id
          ? (bankAccounts.find((b) => b.id !== form.bank_account_id)?.id ?? "")
          : form.to_bank_account_id,
    });
    onModeChange({ ...mode, type: next });
  };

  /** Счёт списания и поступления не совпадают: выбор того же меняет их местами. */
  const pickAccount = (which: "from" | "to", id: string | null) => {
    const value = id ?? "";
    if (form.type === "transfer" && value) {
      const other = which === "from" ? form.to_bank_account_id : form.bank_account_id;
      if (value === other) {
        const swap = which === "from" ? form.bank_account_id : form.to_bank_account_id;
        patch(
          which === "from"
            ? { bank_account_id: value, to_bank_account_id: swap }
            : { to_bank_account_id: value, bank_account_id: swap },
        );
        return;
      }
    }
    patch(which === "from" ? { bank_account_id: value } : { to_bank_account_id: value });
  };

  const sourceAccount = pickerAccounts.find((b) => b.id === form.bank_account_id);
  const targetAccount = pickerAccounts.find((b) => b.id === form.to_bank_account_id);
  const currency = sourceAccount?.currency ?? "RUB";
  const differentCurrencies =
    form.type === "transfer" && !!targetAccount && !!sourceAccount && targetAccount.currency !== sourceAccount.currency;

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (form.amount === null || !(form.amount > 0)) next.amount = "Укажите сумму больше нуля";
    if (!form.bank_account_id) next.account = "Выберите счёт";
    if (!form.date) next.date = "Укажите дату";
    if (form.type === "transfer") {
      if (!form.to_bank_account_id) next.toAccount = "Выберите счёт поступления";
      else if (form.to_bank_account_id === form.bank_account_id)
        next.toAccount = "Счёт поступления должен отличаться от счёта списания";
    }
    return next;
  };

  const handleSave = async () => {
    if (saving || !editable) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!sourceAccount) {
      setErrors({ account: "Счёт не найден. Обновите страницу" });
      return;
    }

    const common = {
      legal_entity_id: sourceAccount.legal_entity_id,
      venue_id: form.venue_id,
      bank_account_id: form.bank_account_id,
      amount: form.amount as number,
      currency: sourceAccount.currency,
      date: form.date,
      description: form.description.trim() || null,
    };
    let payload: TransactionFormInput;
    if (form.type === "transfer") {
      if (!targetAccount) {
        setErrors({ toAccount: "Счёт не найден. Обновите страницу" });
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
    setServerError(null);
    try {
      if (tx) {
        const { error } = await updateTransaction(tx.id, payload);
        if (error) {
          setServerError(error);
          return;
        }
        toast.success("Операция сохранена");
      } else {
        const { id, error } = await createTransaction(payload);
        if (error || !id) {
          setServerError(error ?? "Не удалось создать операцию");
          return;
        }
        // Файлы — после создания: им нужна операция. Операция уже есть,
        // поэтому сбой файла не отменяет её, а называется в уведомлении.
        const failed: string[] = [];
        for (const file of pendingFiles) {
          const { error: fileError } = await uploadTransactionFile(id, file).catch(() => ({
            error: "network",
          }));
          if (fileError) failed.push(file.name);
        }
        if (failed.length)
          toast.warning(
            `${TYPE_LABEL[form.type]} создан, но не прикрепились файлы: ${failed.map((n) => `«${n}»`).join(", ")}. Откройте операцию и добавьте их ещё раз`,
          );
        else toast.success(`${TYPE_LABEL[form.type]} создан`);
      }
      setDirty(false);
      onSaved();
    } catch {
      setServerError("Нет связи с сервером. Проверьте соединение и повторите");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tx) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const { error } = await softDeleteTransaction(tx.id).catch(() => ({
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    setDeleteBusy(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    setConfirmDelete(false);
    setDirty(false);
    onDeleted(tx);
  };

  const handleRestore = async () => {
    if (!tx) return;
    setRestoring(true);
    setServerError(null);
    const { error } = await restoreTransaction(tx.id).catch(() => ({
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    setRestoring(false);
    if (error) {
      setServerError(error);
      return;
    }
    toast.success("Операция восстановлена");
    onRestored();
  };

  const requestClose = () => {
    if (dirty && !saving && editable) setConfirmDiscard(true);
    else onClose();
  };

  // ─── Шапка ────────────────────────────────────────────────────────────────

  const title = tx
    ? `${TYPE_LABEL[tx.type]} №${tx.public_id}`
    : mode.kind === "create" && mode.copyOf
      ? "Копия операции"
      : NEW_TYPE_TITLE[form.type];
  const description = tx
    ? [
        `Создана ${formatDayMonth(tx.created_at) ?? ""}`.trim(),
        tx.source !== "manual" ? SOURCE_LABEL[tx.source] : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const readOnlyReason = !tx
    ? null
    : isDeleted
      ? `Операция удалена ${formatDayMonth(tx.deleted_at) ?? ""}. Она не входит в список операций и не влияет на остатки счетов`.trim()
      : !editable
        ? permissions.updateOwn && !permissions.updateAny
          ? "Изменять можно только операции, которые вы создали сами"
          : "Нет прав на изменение операций"
        : null;

  // ─── Подвал ───────────────────────────────────────────────────────────────

  const footer = isDeleted ? (
    <>
      <Button variant="outline" onClick={onClose} disabled={restoring}>
        Закрыть
      </Button>
      {permissions.delete ? (
        <Button onClick={() => void handleRestore()} disabled={restoring} className="min-w-36">
          {restoring ? "Восстанавливаем…" : "Восстановить"}
        </Button>
      ) : null}
    </>
  ) : (
    <>
      {tx && permissions.delete ? (
        <Button
          variant="ghost"
          size="icon"
          className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label="Удалить операцию"
          data-tip="Удалить операцию"
          onClick={() => {
            setDeleteError(null);
            setConfirmDelete(true);
          }}
          disabled={saving}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
      {editable ? (
        <>
          <Button variant="outline" onClick={requestClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} className="min-w-36">
            {saving ? "Сохраняем…" : tx ? "Сохранить" : CREATE_TYPE_LABEL[form.type]}
          </Button>
        </>
      ) : (
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      )}
    </>
  );

  const locked = !editable;
  const transferBlocked = bankAccounts.length < 2;

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        title={title}
        description={description}
        footer={footer}
      >
        {readOnlyReason ? (
          <p
            role="status"
            className={cn(
              "rounded-lg border p-3 text-sm",
              isDeleted
                ? "border-destructive/30 bg-destructive/10"
                : "border-amber-500/30 bg-amber-500/10",
            )}
          >
            {readOnlyReason}
          </p>
        ) : null}

        {mode.kind === "create" ? (
          <TypeSwitch value={form.type} onChange={selectType} transferBlocked={transferBlocked} />
        ) : null}

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={form.type === "transfer" ? "Сумма перевода" : "Сумма"} required error={errors.amount}>
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
            <Field label="Дата" required error={errors.date}>
              {(control) => (
                <DatePicker
                  {...control}
                  value={form.date}
                  onChange={(date) => patch({ date })}
                  placeholder="Выберите дату"
                  disabled={locked}
                />
              )}
            </Field>
          </div>

          <FieldAction
            label="Создать счёт"
            show={!locked && permissions.manageBankAccounts}
            onClick={() => setBankAccountSheetOpen(true)}
          >
            <Field label={form.type === "transfer" ? "Счёт списания" : "Счёт"} required error={errors.account}>
              {() => (
                <BankAccountPicker
                  bankAccounts={pickerAccounts}
                  value={form.bank_account_id || null}
                  onChange={(id) => pickAccount("from", id)}
                  placeholder="Выберите счёт"
                  amountRoundingScale={amountRoundingScale}
                  ariaLabel={form.type === "transfer" ? "Счёт списания" : "Счёт"}
                  disabled={locked}
                />
              )}
            </Field>
          </FieldAction>

          {form.type === "transfer" ? (
            <Field
              label="Счёт поступления"
              required
              error={errors.toAccount}
              hint={
                differentCurrencies
                  ? `Счета в разных валютах: на счёт поступления запишется та же сумма в ${targetAccount?.currency}. Отдельную сумму поступления пока не сохранить`
                  : undefined
              }
            >
              {() => (
                <BankAccountPicker
                  bankAccounts={pickerAccounts}
                  value={form.to_bank_account_id || null}
                  onChange={(id) => pickAccount("to", id)}
                  excludeId={form.bank_account_id || null}
                  placeholder="Выберите счёт"
                  amountRoundingScale={amountRoundingScale}
                  ariaLabel="Счёт поступления"
                  disabled={locked}
                />
              )}
            </Field>
          ) : (
            <>
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
                      type={form.type === "income" ? "income" : "expense"}
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
            </>
          )}

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
                placeholder={
                  form.type === "transfer"
                    ? "Например: инкассация выручки"
                    : "Например: аренда за ноябрь, ссылка на счёт"
                }
                readOnly={locked}
              />
            )}
          </Field>

          {serverError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              {serverError}
            </p>
          ) : null}
        </div>

        {permissions.viewAttachments && (tx || permissions.uploadAttachments) ? (
          <TransactionFiles
            key={tx?.id ?? "new"}
            transactionId={tx?.id ?? null}
            pending={pendingFiles}
            onPendingChange={(files) => {
              setPendingFiles(files);
              setDirty(true);
            }}
            canUpload={permissions.uploadAttachments && !isDeleted}
            canDelete={permissions.deleteAttachments && !isDeleted}
            onChanged={onFilesChanged}
          />
        ) : null}

        {tx ? (
          <DrawerSection title="История изменений" className="mt-9">
            <TransactionHistory key={tx.id} transactionId={tx.id} />
          </DrawerSection>
        ) : null}
      </EditDrawer>

      {/* Создание справочника из формы — единственное исключение из «панель
          поверх панели»: правка образца из формы, которая его использует. */}
      <CategoryFormSheet
        open={categorySheetOpen}
        defaultType={form.type === "income" ? "income" : "expense"}
        onClose={() => setCategorySheetOpen(false)}
        onCreated={(id) => {
          patch({ category_id: id });
          setCategorySheetOpen(false);
          router.refresh();
        }}
      />
      <CounterpartyFormSheet
        open={counterpartySheetOpen}
        onClose={() => setCounterpartySheetOpen(false)}
        onCreated={(id) => {
          patch({ counterparty_id: id });
          setCounterpartySheetOpen(false);
          router.refresh();
        }}
      />
      <BankAccountFormSheet
        open={bankAccountSheetOpen}
        legalEntities={legalEntities}
        defaultLegalEntityId={sourceAccount?.legal_entity_id ?? null}
        onClose={() => setBankAccountSheetOpen(false)}
        onCreated={(account) => {
          setLocalAccounts((prev) => [...prev, account]);
          if (form.type === "transfer" && form.bank_account_id && !form.to_bank_account_id)
            patch({ to_bank_account_id: account.id });
          else patch({ bank_account_id: account.id });
          setBankAccountSheetOpen(false);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!next && !deleteBusy) setConfirmDelete(false);
        }}
        title={tx ? `Удалить операцию №${tx.public_id}?` : "Удалить операцию?"}
        description="Операция пропадёт из списка, а остаток счёта пересчитается. Вернуть можно сразу кнопкой «Отменить» или позже из «Удалённых операций»."
        confirmLabel="Удалить операцию"
        pendingLabel="Удаляем…"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
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

// ─── Части формы ─────────────────────────────────────────────────────────────

/** Тип операции — чипы-сегменты; только при создании. */
function TypeSwitch({
  value,
  onChange,
  transferBlocked,
}: {
  value: TransactionRow["type"];
  onChange: (next: TransactionRow["type"]) => void;
  transferBlocked: boolean;
}) {
  const items: TransactionRow["type"][] = ["income", "expense", "transfer"];
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Тип операции"
        className="inline-flex h-10 w-full items-center gap-1 rounded-md bg-muted p-1"
      >
        {items.map((type) => {
          const Icon = TYPE_ICON[type];
          const selected = value === type;
          const disabled = type === "transfer" && transferBlocked;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(type)}
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  selected && type === "income" && "text-green-700 dark:text-green-400",
                  selected && type === "expense" && "text-red-700 dark:text-red-400",
                )}
              />
              {TYPE_LABEL[type]}
            </button>
          );
        })}
      </div>
      {transferBlocked ? (
        <p className="text-xs text-muted-foreground">Для перевода нужно хотя бы два счёта</p>
      ) : null}
    </div>
  );
}

/**
 * Действие над значением поля — текстовая ссылка справа в строке подписи
 * (design-system «Боковая панель → Форма»). Вне `<label>`, чтобы нажатие не
 * уходило в поле.
 */
function FieldAction({
  label,
  show,
  onClick,
  children,
}: {
  label: string;
  show: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      {show ? (
        <button
          type="button"
          onClick={onClick}
          className="absolute right-0 top-0 text-[13px] leading-5 text-brand hover:underline"
        >
          {label}
        </button>
      ) : null}
    </div>
  );
}

// ─── Помощники ──────────────────────────────────────────────────────────────

function emptyForm(
  type: TransactionRow["type"],
  accounts: BankAccountRow[],
  preferredId?: string,
  venueId?: string,
): FormState {
  const from = accounts.find((a) => a.id === preferredId)?.id ?? accounts[0]?.id ?? "";
  return {
    type,
    amount: null,
    bank_account_id: from,
    to_bank_account_id: type === "transfer" ? (accounts.find((a) => a.id !== from)?.id ?? "") : "",
    category_id: null,
    counterparty_id: null,
    date: todayIso(),
    description: "",
    venue_id: venueId ?? null,
  };
}

function formFromTransaction(tx: TransactionRow): FormState {
  return {
    type: tx.type,
    amount: Number(tx.amount),
    bank_account_id: tx.bank_account_id,
    to_bank_account_id: tx.to_bank_account_id ?? "",
    category_id: tx.category_id ?? null,
    counterparty_id: tx.counterparty_id ?? null,
    date: tx.date.slice(0, 10),
    description: tx.description ?? "",
    venue_id: tx.venue_id ?? null,
  };
}

/**
 * В выборе — действующие записи и та, что уже стоит в операции, даже если
 * её отправили в архив: иначе старая операция показала бы «Без статьи».
 */
function withSelected<T extends { id: string; archived_at?: string | null; deleted_at?: string | null }>(
  list: T[],
  selectedId: string | null,
): T[] {
  return list.filter((item) => (!item.archived_at && !item.deleted_at) || item.id === selectedId);
}
