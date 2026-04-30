"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LegalEntityPicker } from "@/components/finance/legal-entity-picker";
import { VenuePicker } from "@/components/finance/venue-picker";
import {
  createBankAccount,
  updateBankAccount,
} from "@/lib/finance/bank-accounts";
import type {
  BankAccountFormInput,
  BankAccountGroupRow,
} from "@/types/finance";
import type { BankAccountType } from "@/types/database";

const TYPE_OPTIONS: { value: BankAccountType; label: string }[] = [
  { value: "cash",       label: "Касса" },
  { value: "checking",   label: "Расчётный счёт" },
  { value: "debit_card", label: "Дебетовая карта" },
  { value: "fund",       label: "Денежный фонд" },
  { value: "safe",       label: "Сейф" },
];

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type VenueOption = {
  id: string;
  name: string;
};

const NO_GROUP = "__none__";

type Props = {
  mode: "create" | "edit";
  bankAccountId?: string;
  initial?: Partial<BankAccountFormInput>;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  groups: BankAccountGroupRow[];
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
};

export function BankAccountForm({
  mode,
  bankAccountId,
  initial,
  legalEntities,
  venues,
  groups,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<BankAccountFormInput>({
    legal_entity_id:       initial?.legal_entity_id ?? "",
    venue_id:              initial?.venue_id ?? null,
    name:                  initial?.name ?? "",
    type:                  initial?.type ?? "cash",
    currency:              initial?.currency ?? "RUB",
    description:           initial?.description ?? "",
    group_id:              initial?.group_id ?? null,
    bank_name:             initial?.bank_name ?? "",
    bik:                   initial?.bik ?? "",
    account_number:        initial?.account_number ?? "",
    correspondent_account: initial?.correspondent_account ?? "",
    acquiring_percentage:  initial?.acquiring_percentage ?? null,
    card_holder:           initial?.card_holder ?? "",
    card_number_last4:     initial?.card_number_last4 ?? "",
  });

  const isBankType = form.type === "checking" || form.type === "debit_card";
  const isCheckingType = form.type === "checking";
  const isCardType = form.type === "debit_card";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!form.name.trim()) {
      toast.error("Укажите название");
      return;
    }
    if (!form.legal_entity_id) {
      toast.error("Выберите юрлицо");
      return;
    }
    setSaving(true);

    // Drop empty optional strings → null. Type-irrelevant fields are
    // also nulled — switching the type from checking to cash should
    // wipe bank_name / bik / etc. so they don't linger in the row.
    const payload: BankAccountFormInput = {
      legal_entity_id: form.legal_entity_id,
      venue_id:        form.venue_id ?? null,
      name:            form.name.trim(),
      type:            form.type,
      currency:        form.currency ?? "RUB",
      description:     emptyToNull(form.description),
      group_id:        form.group_id ?? null,
      // bank fields — keep only when the type uses them
      bank_name:             isBankType ? emptyToNull(form.bank_name) : null,
      bik:                   isCheckingType ? emptyToNull(form.bik) : null,
      account_number:        isCheckingType ? emptyToNull(form.account_number) : null,
      correspondent_account: isCheckingType ? emptyToNull(form.correspondent_account) : null,
      acquiring_percentage:  isCheckingType ? form.acquiring_percentage ?? null : null,
      card_holder:           isCardType ? emptyToNull(form.card_holder) : null,
      card_number_last4:     isCardType ? emptyToNull(form.card_number_last4) : null,
    };

    if (mode === "create") {
      const { id, error } = await createBankAccount(payload);
      setSaving(false);
      if (error || !id) {
        toast.error(error ?? "Не удалось создать счёт");
        return;
      }
      toast.success("Счёт создан");
      router.push(`/finance/accounts/${id}`);
      return;
    }

    if (!bankAccountId) {
      setSaving(false);
      toast.error("Не задан id счёта");
      return;
    }
    const { error } = await updateBankAccount(bankAccountId, payload);
    setSaving(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Счёт сохранён");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={readOnly} className="contents">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ba-type">Тип</Label>
            <Select
              value={form.type}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, type: v as BankAccountType }))
              }
              disabled={mode === "edit"}
            >
              <SelectTrigger id="ba-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === "edit" && (
              <p className="text-xs text-muted-foreground">
                Тип счёта нельзя менять — это поломало бы исторические транзакции.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ba-currency">Валюта</Label>
            <Input
              id="ba-currency"
              value={form.currency ?? "RUB"}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              maxLength={3}
              placeholder="RUB"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ba-name">Название</Label>
            <Input
              id="ba-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Касса №1 / Расчётный Тинькофф / …"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Юрлицо</Label>
            <LegalEntityPicker
              legalEntities={legalEntities}
              value={form.legal_entity_id || null}
              onChange={(v) => setForm((f) => ({ ...f, legal_entity_id: v ?? "" }))}
              placeholder="Выберите юрлицо"
              disabled={readOnly}
              ariaLabel="Юрлицо"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Точка</Label>
            <VenuePicker
              venues={venues}
              value={form.venue_id ?? null}
              onChange={(v) => setForm((f) => ({ ...f, venue_id: v }))}
              placeholder="Без точки"
              allowClear
              disabled={readOnly}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ba-group">Группа</Label>
            <Select
              value={form.group_id ?? NO_GROUP}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, group_id: v === NO_GROUP ? null : v }))
              }
              disabled={groups.length === 0}
            >
              <SelectTrigger id="ba-group">
                <SelectValue placeholder="Без группы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bank-name shown for checking and debit_card. */}
          {isBankType && (
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="ba-bank-name">Банк</Label>
              <Input
                id="ba-bank-name"
                value={form.bank_name ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bank_name: e.target.value }))
                }
                placeholder="Тинькофф"
              />
            </div>
          )}

          {/* Расчётный счёт fields. */}
          {isCheckingType && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ba-bik">БИК</Label>
                <Input
                  id="ba-bik"
                  value={form.bik ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, bik: e.target.value }))}
                  maxLength={9}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-acquiring">Эквайринг, %</Label>
                <Input
                  id="ba-acquiring"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={form.acquiring_percentage ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({
                      ...f,
                      acquiring_percentage: v === "" ? null : Number(v),
                    }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-account-number">Расчётный счёт</Label>
                <Input
                  id="ba-account-number"
                  value={form.account_number ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, account_number: e.target.value }))
                  }
                  maxLength={20}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-corr">Корр. счёт</Label>
                <Input
                  id="ba-corr"
                  value={form.correspondent_account ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, correspondent_account: e.target.value }))
                  }
                  maxLength={20}
                />
              </div>
            </>
          )}

          {/* Debit card fields. */}
          {isCardType && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ba-card-holder">Держатель карты</Label>
                <Input
                  id="ba-card-holder"
                  value={form.card_holder ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, card_holder: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-card-last4">Последние 4 цифры</Label>
                <Input
                  id="ba-card-last4"
                  value={form.card_number_last4 ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      card_number_last4: e.target.value.replace(/\D/g, "").slice(0, 4),
                    }))
                  }
                  maxLength={4}
                  placeholder="1234"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ba-description">Описание</Label>
            <Textarea
              id="ba-description"
              value={form.description ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
            />
          </div>
        </div>
      </fieldset>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Создать" : "Сохранить"}
          </Button>
        </div>
      )}
    </form>
  );
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
