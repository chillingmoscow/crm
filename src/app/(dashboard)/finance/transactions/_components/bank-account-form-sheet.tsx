"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { createBankAccount } from "@/lib/finance/bank-accounts";
import type { BankAccountRow } from "@/types/finance";
import type { LegalEntityRow } from "@/lib/org/legal-entities";

type AccountType = BankAccountRow["type"];

const TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: "checking",   label: "Расчётный" },
  { value: "debit_card", label: "Дебетовая карта" },
  { value: "cash",       label: "Касса" },
];

const CURRENCY_OPTIONS = ["RUB", "USD", "EUR"];
const CURRENCY_LABEL: Record<string, string> = { RUB: "Рубли, ₽", USD: "Доллары, $", EUR: "Евро, €" };

/**
 * Subset of BankAccountRow needed by the transaction form-sheet to
 * complete its save flow without waiting for `router.refresh()` to
 * re-fetch props. Includes the fields read by transaction `handleSave`:
 * `id`, `legal_entity_id`, `currency` — plus `name` and `type` so the
 * BankAccountPicker can render the freshly-created entry immediately.
 */
export type CreatedBankAccount = {
  id: string;
  legal_entity_id: string;
  name: string;
  type: BankAccountRow["type"];
  currency: string;
};

type Props = {
  open: boolean;
  legalEntities: LegalEntityRow[];
  defaultLegalEntityId: string | null;
  onClose: () => void;
  onCreated: (account: CreatedBankAccount) => void;
};

export function BankAccountFormSheet({
  open,
  legalEntities,
  defaultLegalEntityId,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [legalEntityId, setLegalEntityId] = useState<string>("");
  const [type, setType] = useState<AccountType>("checking");
  const [currency, setCurrency] = useState<string>("RUB");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"name" | "legalEntity", string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setLegalEntityId(defaultLegalEntityId ?? legalEntities[0]?.id ?? "");
    setType("checking");
    setCurrency("RUB");
    setDescription("");
    setErrors({});
    setServerError(null);
  }, [open, defaultLegalEntityId, legalEntities]);

  const handleSave = async () => {
    const found: Partial<Record<"name" | "legalEntity", string>> = {};
    if (!name.trim()) found.name = "Укажите название счёта";
    if (!legalEntityId) found.legalEntity = "Выберите юрлицо";
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setServerError(null);
    const { id, error } = await createBankAccount({
      legal_entity_id: legalEntityId,
      name: name.trim(),
      type,
      currency,
      description: description.trim() || null,
    }).catch(() => ({ id: null, error: "Нет связи с сервером. Проверьте соединение и повторите" }));
    setSaving(false);
    if (error || !id) {
      setServerError(error ?? "Не удалось создать счёт");
      return;
    }
    toast.success("Счёт создан");
    // Отдаём счёт целиком, а не только id: форме операции нужны юрлицо и
    // валюта для сохранения раньше, чем router.refresh() обновит список.
    onCreated({
      id,
      legal_entity_id: legalEntityId,
      name: name.trim(),
      type,
      currency,
    });
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      title="Новый счёт"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} className="min-w-36">
            {saving ? "Создаём…" : "Создать счёт"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <Field label="Название" required error={errors.name}>
          {(control) => (
            <Input
              {...control}
              placeholder="Например: расчётный счёт в Сбере"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              autoFocus
            />
          )}
        </Field>

        <Field label="Юрлицо" required error={errors.legalEntity}>
          {(control) => (
            <OptionSelect
              {...control}
              value={legalEntityId}
              onValueChange={(v) => {
                setLegalEntityId(v);
                setErrors((x) => ({ ...x, legalEntity: undefined }));
              }}
              placeholder="Выберите юрлицо"
              options={legalEntities.map((le) => ({ value: le.id, label: le.short_name ?? le.name }))}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Тип счёта">
            {(control) => (
              <OptionSelect
                {...control}
                value={type}
                onValueChange={(v) => setType(v as AccountType)}
                options={TYPE_OPTIONS}
              />
            )}
          </Field>
          <Field label="Валюта">
            {(control) => (
              <OptionSelect
                {...control}
                value={currency}
                onValueChange={setCurrency}
                options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: CURRENCY_LABEL[c] ?? c }))}
              />
            )}
          </Field>
        </div>

        <Field label="Описание">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: последние 4 цифры карты"
            />
          )}
        </Field>

        {serverError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {serverError}
          </p>
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </EditDrawer>
  );
}
