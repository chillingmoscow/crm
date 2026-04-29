"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InnInput } from "@/components/org/inn-input";
import { AddressInput } from "@/components/org/address-input";
import {
  createLegalEntity,
  updateLegalEntity,
  type LegalEntityFormInput,
} from "@/lib/org/legal-entities";
import type { LegalForm, TaxSystem } from "@/types/database";

const LEGAL_FORM_OPTIONS: { value: LegalForm; label: string }[] = [
  { value: "IP",    label: "ИП" },
  { value: "OOO",   label: "ООО" },
  { value: "AO",    label: "АО (закрытое)" },
  { value: "PAO",   label: "ПАО" },
  { value: "NKO",   label: "НКО" },
  { value: "OTHER", label: "Иное" },
];

const TAX_SYSTEM_OPTIONS: { value: TaxSystem; label: string }[] = [
  { value: "OSN",                label: "Общая система (ОСН)" },
  { value: "USN_INCOME",         label: "УСН «Доходы»" },
  { value: "USN_INCOME_EXPENSE", label: "УСН «Доходы минус расходы»" },
  { value: "PSN",                label: "Патент (ПСН)" },
  { value: "NPD",                label: "Самозанятый (НПД)" },
  { value: "AUSN",               label: "АУСН" },
];

type Props = {
  mode: "create" | "edit";
  legalEntityId?: string;
  initial?: Partial<LegalEntityFormInput>;
  /**
   * When true, all inputs are disabled and the save button is hidden.
   * Use for users with org.view_legal_entities but without
   * org.manage_legal_entities — they should see the data, not edit it.
   */
  readOnly?: boolean;
};

export function LegalEntityForm({ mode, legalEntityId, initial, readOnly = false }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<LegalEntityFormInput>({
    name:                   initial?.name ?? "",
    short_name:             initial?.short_name ?? "",
    legal_form:             initial?.legal_form ?? "OOO",
    inn:                    initial?.inn ?? "",
    kpp:                    initial?.kpp ?? "",
    ogrn:                   initial?.ogrn ?? "",
    okpo:                   initial?.okpo ?? "",
    okved:                  initial?.okved ?? "",
    tax_system:             initial?.tax_system ?? null,
    vat_payer:              initial?.vat_payer ?? false,
    legal_address:          initial?.legal_address ?? "",
    actual_address:         initial?.actual_address ?? "",
    postal_address:         initial?.postal_address ?? "",
    director_name:          initial?.director_name ?? "",
    director_position:      initial?.director_position ?? "Директор",
    accountant_name:        initial?.accountant_name ?? "",
    signature_basis:        initial?.signature_basis ?? "Устав",
    phone:                  initial?.phone ?? "",
    email:                  initial?.email ?? "",
    website:                initial?.website ?? "",
    default_bank_name:      initial?.default_bank_name ?? "",
    default_bik:            initial?.default_bik ?? "",
    default_account_number: initial?.default_account_number ?? "",
    default_corr_account:   initial?.default_corr_account ?? "",
  });

  const update = <K extends keyof LegalEntityFormInput>(
    key: K,
    val: LegalEntityFormInput[K]
  ) => setForm((prev) => ({ ...prev, [key]: val }));

  // Auto-fill fields from DaData lookup result.
  const applyDadataParty = (party: {
    name: string;
    shortName: string | null;
    legalForm: LegalForm;
    inn: string;
    kpp: string | null;
    ogrn: string | null;
    okpo: string | null;
    okved: string | null;
    legalAddress: string | null;
    directorName: string | null;
    directorPosition: string | null;
  }) => {
    setForm((prev) => ({
      ...prev,
      name:              party.name,
      short_name:        party.shortName ?? prev.short_name,
      legal_form:        party.legalForm,
      inn:               party.inn,
      kpp:               party.kpp ?? prev.kpp,
      ogrn:              party.ogrn ?? prev.ogrn,
      okpo:              party.okpo ?? prev.okpo,
      okved:             party.okved ?? prev.okved,
      legal_address:     party.legalAddress ?? prev.legal_address,
      director_name:     party.directorName ?? prev.director_name,
      director_position: party.directorPosition ?? prev.director_position,
    }));
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название юрлица");
      return;
    }
    setSaving(true);
    if (mode === "create") {
      const { id, error } = await createLegalEntity(form);
      setSaving(false);
      if (error || !id) {
        toast.error(error ?? "Не удалось создать юрлицо");
        return;
      }
      toast.success("Юрлицо создано");
      router.push(`/org/legal-entities/${id}`);
    } else {
      const { error } = await updateLegalEntity(legalEntityId!, form);
      setSaving(false);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Сохранено");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          У вас нет права <code>org.manage_legal_entities</code>. Карточка
          доступна только для просмотра.
        </div>
      )}
      {/* Wrap only the editable cards in the fieldset so the action
          bar below (with the Close button) stays interactive even when
          readOnly is true. */}
      <fieldset disabled={readOnly} className="contents">
      <Card>
        <CardHeader>
          <CardTitle>Реквизиты</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="inn">ИНН</Label>
            <InnInput
              id="inn"
              value={form.inn ?? ""}
              onChange={(v) => update("inn", v)}
              onParty={applyDadataParty}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">Полное наименование</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder='ООО "Хорошее"'
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="short_name">Краткое наименование</Label>
            <Input
              id="short_name"
              value={form.short_name ?? ""}
              onChange={(e) => update("short_name", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="legal_form">Форма</Label>
            <Select
              value={form.legal_form}
              onValueChange={(v) => update("legal_form", v as LegalForm)}
              disabled={readOnly}
            >
              <SelectTrigger id="legal_form">
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

          <div className="space-y-2">
            <Label htmlFor="kpp">КПП</Label>
            <Input
              id="kpp"
              value={form.kpp ?? ""}
              onChange={(e) => update("kpp", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ogrn">ОГРН</Label>
            <Input
              id="ogrn"
              value={form.ogrn ?? ""}
              onChange={(e) => update("ogrn", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="okpo">ОКПО</Label>
            <Input
              id="okpo"
              value={form.okpo ?? ""}
              onChange={(e) => update("okpo", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="okved">ОКВЭД</Label>
            <Input
              id="okved"
              value={form.okved ?? ""}
              onChange={(e) => update("okved", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Налоги</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tax_system">Налоговая система</Label>
            <Select
              value={form.tax_system ?? "__none__"}
              onValueChange={(v) =>
                update("tax_system", v === "__none__" ? null : (v as TaxSystem))
              }
              disabled={readOnly}
            >
              <SelectTrigger id="tax_system">
                <SelectValue placeholder="Не выбрано" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Не выбрано</SelectItem>
                {TAX_SYSTEM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pt-6 md:pt-0 md:self-end md:pb-2">
            <Switch
              id="vat_payer"
              checked={form.vat_payer ?? false}
              onCheckedChange={(v) => update("vat_payer", v)}
              disabled={readOnly}
            />
            <Label htmlFor="vat_payer">Плательщик НДС</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Адреса</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="legal_address">Юридический адрес</Label>
            <AddressInput
              id="legal_address"
              value={form.legal_address ?? ""}
              onChange={(v) => update("legal_address", v)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="actual_address">Фактический адрес</Label>
            <AddressInput
              id="actual_address"
              value={form.actual_address ?? ""}
              onChange={(v) => update("actual_address", v)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postal_address">Почтовый адрес</Label>
            <AddressInput
              id="postal_address"
              value={form.postal_address ?? ""}
              onChange={(v) => update("postal_address", v)}
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Контакты</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="phone">Телефон</Label>
            <Input
              id="phone"
              value={form.phone ?? ""}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Сайт</Label>
            <Input
              id="website"
              value={form.website ?? ""}
              onChange={(e) => update("website", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Банковские реквизиты по умолчанию</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="default_bank_name">Название банка</Label>
            <Input
              id="default_bank_name"
              value={form.default_bank_name ?? ""}
              onChange={(e) => update("default_bank_name", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default_bik">БИК</Label>
            <Input
              id="default_bik"
              value={form.default_bik ?? ""}
              onChange={(e) => update("default_bik", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default_account_number">Расчётный счёт</Label>
            <Input
              id="default_account_number"
              value={form.default_account_number ?? ""}
              onChange={(e) => update("default_account_number", e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="default_corr_account">Корр. счёт</Label>
            <Input
              id="default_corr_account"
              value={form.default_corr_account ?? ""}
              onChange={(e) => update("default_corr_account", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={saving}
        >
          {readOnly ? "Закрыть" : "Отмена"}
        </Button>
        {!readOnly && (
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Создать" : "Сохранить"}
          </Button>
        )}
      </div>
    </div>
  );
}
