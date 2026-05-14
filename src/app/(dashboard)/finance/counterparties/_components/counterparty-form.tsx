"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InnInput } from "@/components/org/inn-input";
import { AddressInput } from "@/components/org/address-input";
import {
  createCounterparty,
  updateCounterparty,
} from "@/lib/finance/counterparties";
import type {
  CounterpartyFormInput,
  CounterpartyGroupRow,
} from "@/types/finance";
import type { LegalForm } from "@/types/database";

const LEGAL_FORM_OPTIONS: { value: LegalForm; label: string }[] = [
  { value: "IP",    label: "ИП" },
  { value: "OOO",   label: "ООО" },
  { value: "AO",    label: "АО" },
  { value: "PAO",   label: "ПАО" },
  { value: "NKO",   label: "НКО" },
  { value: "OTHER", label: "Иное" },
];

const NO_GROUP = "__none__";

type Props = {
  mode: "create" | "edit";
  counterpartyId?: string;
  initial?: Partial<CounterpartyFormInput>;
  groups: CounterpartyGroupRow[];
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
  /**
   * When false, hides the «Из DaData» lookup button on the ИНН field
   * and disables the address autocomplete. Server pages call
   * isDadataConfigured() and pass the result down so users don't see
   * actions that are guaranteed to fail when the API key isn't set.
   */
  dadataEnabled?: boolean;
};

export function CounterpartyForm({
  mode,
  counterpartyId,
  initial,
  groups,
  readOnly = false,
  dadataEnabled = true,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<CounterpartyFormInput>({
    name:           initial?.name ?? "",
    legal_form:     initial?.legal_form ?? "OOO",
    inn:            initial?.inn ?? "",
    kpp:            initial?.kpp ?? "",
    ogrn:           initial?.ogrn ?? "",
    contact_person: initial?.contact_person ?? "",
    phone:          initial?.phone ?? "",
    email:          initial?.email ?? "",
    address:        initial?.address ?? "",
    description:    initial?.description ?? "",
    group_id:       initial?.group_id ?? null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!form.name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);

    // Trim empty strings → null for nullable columns so we don't store
    // empty placeholders and break uniqueness checks down the line.
    const payload: CounterpartyFormInput = {
      ...form,
      name:           form.name.trim(),
      inn:            emptyToNull(form.inn),
      kpp:            emptyToNull(form.kpp),
      ogrn:           emptyToNull(form.ogrn),
      contact_person: emptyToNull(form.contact_person),
      phone:          emptyToNull(form.phone),
      email:          emptyToNull(form.email),
      address:        emptyToNull(form.address),
      description:    emptyToNull(form.description),
    };

    if (mode === "create") {
      const { id, error } = await createCounterparty(payload);
      setSaving(false);
      if (error || !id) {
        toast.error(error ?? "Не удалось создать контрагента");
        return;
      }
      toast.success("Контрагент создан");
      router.push(`/finance/counterparties/${id}`);
      return;
    }

    if (!counterpartyId) {
      setSaving(false);
      toast.error("Не задан id контрагента");
      return;
    }
    const { error } = await updateCounterparty(counterpartyId, payload);
    setSaving(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Контрагент сохранён");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* DaData lookup at the top — fills name/legal_form/kpp/ogrn/address. */}
      <fieldset disabled={readOnly} className="contents">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cp-inn">ИНН</Label>
            <InnInput
              id="cp-inn"
              value={form.inn ?? ""}
              onChange={(next) => setForm((f) => ({ ...f, inn: next }))}
              onParty={(party) =>
                setForm((f) => ({
                  ...f,
                  name:       party.name,
                  legal_form: party.legalForm,
                  inn:        party.inn,
                  kpp:        party.kpp,
                  ogrn:       party.ogrn,
                  address:    party.legalAddress,
                }))
              }
              placeholder="10 или 12 цифр"
              hideLookupButton={readOnly || !dadataEnabled}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cp-name">Название</Label>
            <Input
              id="cp-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-legal-form">Форма</Label>
            <Select
              value={form.legal_form ?? "OOO"}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, legal_form: v as LegalForm }))
              }
            >
              <SelectTrigger id="cp-legal-form">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEGAL_FORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-group">Группа</Label>
            <Select
              value={form.group_id ?? NO_GROUP}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, group_id: v === NO_GROUP ? null : v }))
              }
              disabled={groups.length === 0}
            >
              <SelectTrigger id="cp-group">
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

          <div className="space-y-1.5">
            <Label htmlFor="cp-kpp">КПП</Label>
            <Input
              id="cp-kpp"
              value={form.kpp ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, kpp: e.target.value }))}
              maxLength={9}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-ogrn">ОГРН / ОГРНИП</Label>
            <Input
              id="cp-ogrn"
              value={form.ogrn ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, ogrn: e.target.value }))}
              maxLength={15}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cp-address">Адрес</Label>
            <AddressInput
              id="cp-address"
              value={form.address ?? ""}
              onChange={(next) => setForm((f) => ({ ...f, address: next }))}
              suggestionsEnabled={dadataEnabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-contact">Контактное лицо</Label>
            <Input
              id="cp-contact"
              value={form.contact_person ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, contact_person: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-phone">Телефон</Label>
            <PhoneInput
              id="cp-phone"
              value={form.phone ?? ""}
              onChange={(e164) => setForm((f) => ({ ...f, phone: e164 }))}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cp-email">E-mail</Label>
            <Input
              id="cp-email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              type="email"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cp-description">Описание</Label>
            <Textarea
              id="cp-description"
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
