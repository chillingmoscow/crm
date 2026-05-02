"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setLegalEntityId(defaultLegalEntityId ?? legalEntities[0]?.id ?? "");
      setType("checking");
      setCurrency("RUB");
      setDescription("");
    }
  }, [open, defaultLegalEntityId, legalEntities]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название счёта");
      return;
    }
    if (!legalEntityId) {
      toast.error("Выберите юрлицо");
      return;
    }
    setSaving(true);
    const { id, error } = await createBankAccount({
      legal_entity_id: legalEntityId,
      name: name.trim(),
      type,
      currency,
      description: description.trim() || null,
    });
    setSaving(false);
    if (error || !id) {
      toast.error(error ?? "Не удалось создать счёт");
      return;
    }
    toast.success("Счёт создан");
    // Hand the full account info back, not just the id — transaction
    // form needs `legal_entity_id` and `currency` for its save payload
    // BEFORE the parent's router.refresh() repopulates `bankAccounts`
    // (otherwise the just-created id is in form state but absent from
    // the lookup array, and validation rejects with «Счёт не найден»).
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
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Новый счёт"
      description="Расчётный счёт, дебетовая карта или касса."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="ba-name">
          Название <span className="text-destructive">*</span>
        </Label>
        <Input
          id="ba-name"
          placeholder="Например: Основной"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Юрлицо <span className="text-destructive">*</span>
        </Label>
        <Select value={legalEntityId} onValueChange={setLegalEntityId}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите юрлицо" />
          </SelectTrigger>
          <SelectContent>
            {legalEntities.map((le) => (
              <SelectItem key={le.id} value={le.id}>
                {le.short_name ?? le.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Тип счёта</Label>
        <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Валюта</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCY_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ba-desc">Описание</Label>
        <Textarea
          id="ba-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Необязательно — например, последние 4 цифры или банк"
        />
      </div>
    </EditDrawer>
  );
}
