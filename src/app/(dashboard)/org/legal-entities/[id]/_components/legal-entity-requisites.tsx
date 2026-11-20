"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { AddressInput } from "@/components/org/address-input";
import { InnInput } from "@/components/org/inn-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBarSection } from "@/components/shared/save-bar";
import { formatDayMonth } from "@/lib/format/date";
import {
  syncLegalEntityFromDadata,
  updateLegalEntity,
  type LegalEntityFormInput,
  type LegalEntityRow,
} from "@/lib/org/legal-entities";
import { LEGAL_FORM_OPTIONS, TAX_SYSTEM_LABELS } from "@/lib/org/legal-entity-labels";
import type { LegalForm, TaxSystem } from "@/types/database";

type FormState = Required<{
  [K in keyof LegalEntityFormInput]: NonNullable<LegalEntityFormInput[K]>;
}>;

function fromRow(row: LegalEntityRow): FormState {
  return {
    name: row.name,
    short_name: row.short_name ?? "",
    legal_form: row.legal_form,
    inn: row.inn ?? "",
    kpp: row.kpp ?? "",
    ogrn: row.ogrn ?? "",
    okpo: row.okpo ?? "",
    okved: row.okved ?? "",
    // "" — не выбрано (контракт OptionSelect).
    tax_system: (row.tax_system ?? "") as TaxSystem,
    vat_payer: row.vat_payer ?? false,
    legal_address: row.legal_address ?? "",
    actual_address: row.actual_address ?? "",
    postal_address: row.postal_address ?? "",
    director_name: row.director_name ?? "",
    director_position: row.director_position ?? "",
    accountant_name: row.accountant_name ?? "",
    signature_basis: row.signature_basis ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    default_bank_name: row.default_bank_name ?? "",
    default_bik: row.default_bik ?? "",
    default_account_number: row.default_account_number ?? "",
    default_corr_account: row.default_corr_account ?? "",
  };
}

/** Пустые строки уходят в базу как null, текст — без пробелов по краям. */
function toPatch(form: FormState): LegalEntityFormInput {
  const text = (v: string) => v.trim() || null;
  return {
    name: form.name.trim(),
    short_name: text(form.short_name),
    legal_form: form.legal_form,
    inn: text(form.inn),
    kpp: text(form.kpp),
    ogrn: text(form.ogrn),
    okpo: text(form.okpo),
    okved: text(form.okved),
    tax_system: (form.tax_system || null) as TaxSystem | null,
    vat_payer: form.vat_payer,
    legal_address: text(form.legal_address),
    actual_address: text(form.actual_address),
    postal_address: text(form.postal_address),
    director_name: text(form.director_name),
    director_position: text(form.director_position),
    accountant_name: text(form.accountant_name),
    signature_basis: text(form.signature_basis),
    phone: text(form.phone),
    email: text(form.email),
    website: text(form.website),
    default_bank_name: text(form.default_bank_name),
    default_bik: text(form.default_bik),
    default_account_number: text(form.default_account_number),
    default_corr_account: text(form.default_corr_account),
  };
}

const TAX_OPTIONS = [
  { value: "", label: "Не выбрана" },
  ...(Object.entries(TAX_SYSTEM_LABELS) as [TaxSystem, string][]).map(([value, label]) => ({
    value,
    label,
  })),
];

/**
 * Реквизиты юрлица — правка на месте, сохранение общей полосой карточки.
 * Компонент монтируется заново после сохранения (ключ по `updated_at` у
 * родителя), поэтому исходные значения всегда свежие.
 */
export function LegalEntityRequisites({
  row,
  readOnly,
  lockMessage,
  dadataEnabled,
}: {
  row: LegalEntityRow;
  readOnly: boolean;
  lockMessage: string | null;
  /** DaData настроена: кнопка «Обновить по ИНН» и подсказки адресов. */
  dadataEnabled: boolean;
}) {
  const router = useRouter();
  const initial = fromRow(row);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [syncing, setSyncing] = useState(false);

  const dirty = (Object.keys(initial) as (keyof FormState)[]).some((key) => {
    const a = form[key];
    const b = initial[key];
    return typeof a === "string" && typeof b === "string" ? a.trim() !== b.trim() : a !== b;
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save(): Promise<boolean> {
    if (!form.name.trim()) return false;
    setSaving(true);
    try {
      const { error } = await updateLegalEntity(row.id, toPatch(form));
      if (error) {
        toast.error(`Не удалось сохранить реквизиты: ${error}`);
        return false;
      }
      toast.success("Реквизиты сохранены");
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("Не удалось сохранить реквизиты. Проверьте подключение и повторите");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const { error } = await syncLegalEntityFromDadata(row.id);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Реквизиты обновлены из ЕГРЮЛ");
      startRefresh(() => router.refresh());
    } finally {
      setSyncing(false);
    }
  }

  const locked = lockMessage ? { tone: "locked" as const, message: lockMessage } : undefined;
  const syncedAt = formatDayMonth(row.dadata_synced_at);
  const text = (
    key: Exclude<keyof FormState, "vat_payer" | "legal_form" | "tax_system">,
    label: string,
    opts: { required?: boolean; placeholder?: string; inputMode?: "numeric" | "email" | "tel" | "url"; error?: string | null } = {},
  ) => (
    <Field id={`le-${key}`} label={label} required={opts.required} error={opts.error}>
      {(control) => (
        <Input
          {...control}
          value={form[key]}
          onChange={(e) => set(key, e.target.value)}
          disabled={readOnly}
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
        />
      )}
    </Field>
  );
  const address = (key: "legal_address" | "actual_address" | "postal_address", label: string) => (
    <Field id={`le-${key}`} label={label}>
      {(control) => (
        <AddressInput
          id={control.id}
          value={form[key]}
          onChange={(v) => set(key, v)}
          disabled={readOnly}
          suggestionsEnabled={dadataEnabled}
        />
      )}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly && dirty && !saving && form.name.trim()) void save();
      }}
    >
      {/* Enter в поле сохраняет форму; видимая кнопка — в полосе. */}
      <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      <SaveBarSection
        dirty={!readOnly && dirty}
        saving={saving || refreshing}
        save={save}
        reset={() => setForm(initial)}
        blocked={!readOnly && dirty && !form.name.trim() ? "Укажите полное наименование" : null}
      />

      <ProfileSection
        title="Реквизиты"
        description={syncedAt ? `Обновлены из ЕГРЮЛ ${syncedAt}` : undefined}
        locked={locked}
        actions={
          dadataEnabled && !readOnly ? (
            <span
              className="inline-flex"
              data-tip={
                !row.inn
                  ? "Сначала укажите и сохраните ИНН"
                  : dirty
                    ? "Сначала сохраните или отмените изменения"
                    : "Подтянуть наименование, КПП, ОГРН, адрес и руководителя из ЕГРЮЛ"
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={sync}
                disabled={syncing || refreshing || dirty || !row.inn}
              >
                <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
                {syncing ? "Обновляем…" : "Обновить по ИНН"}
              </Button>
            </span>
          ) : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text("name", "Полное наименование", {
              required: true,
              placeholder: "ООО «Хорошее»",
              error: dirty && !form.name.trim() ? "Укажите полное наименование" : null,
            })}
          </div>
          {text("short_name", "Краткое наименование")}
          <Field id="le-legal_form" label="Форма" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.legal_form}
                onValueChange={(v) => set("legal_form", v as LegalForm)}
                options={LEGAL_FORM_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="le-inn" label="ИНН">
            {(control) => (
              <InnInput
                {...control}
                value={form.inn}
                onChange={(v) => set("inn", v)}
                disabled={readOnly}
                hideLookupButton
              />
            )}
          </Field>
          {text("kpp", "КПП", { inputMode: "numeric" })}
          {text("ogrn", "ОГРН", { inputMode: "numeric" })}
          {text("okpo", "ОКПО", { inputMode: "numeric" })}
          {text("okved", "ОКВЭД")}
        </div>
      </ProfileSection>

      <ProfileSection title="Налоги" locked={locked}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="le-tax_system" label="Система налогообложения">
            {(control) => (
              <OptionSelect
                {...control}
                value={form.tax_system}
                onValueChange={(v) => set("tax_system", v as TaxSystem)}
                options={TAX_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <div className="flex items-center gap-3 sm:self-end sm:pb-2.5">
            <Switch
              id="le-vat_payer"
              checked={form.vat_payer}
              onCheckedChange={(v) => set("vat_payer", v)}
              disabled={readOnly}
            />
            <Label htmlFor="le-vat_payer">Плательщик НДС</Label>
          </div>
        </div>
      </ProfileSection>

      <ProfileSection
        title="Руководство и подпись"
        description="Подставляются в документы, которые подписывает юрлицо"
        locked={locked}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {text("director_name", "Руководитель", { placeholder: "Иванов Иван Иванович" })}
          {text("director_position", "Должность руководителя", { placeholder: "Генеральный директор" })}
          {text("accountant_name", "Главный бухгалтер")}
          {text("signature_basis", "Действует на основании", { placeholder: "Устава" })}
        </div>
      </ProfileSection>

      <ProfileSection title="Адреса" locked={locked}>
        <div className="flex flex-col gap-4">
          {address("legal_address", "Юридический адрес")}
          {address("actual_address", "Фактический адрес")}
          {address("postal_address", "Почтовый адрес")}
        </div>
      </ProfileSection>

      <ProfileSection title="Контакты" locked={locked}>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("phone", "Телефон", { inputMode: "tel" })}
          {text("email", "Почта", { inputMode: "email" })}
          <div className="sm:col-span-2">{text("website", "Сайт", { inputMode: "url" })}</div>
        </div>
      </ProfileSection>

      <ProfileSection
        title="Банковские реквизиты"
        description="Счёт по умолчанию для документов юрлица"
        locked={locked}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{text("default_bank_name", "Банк")}</div>
          {text("default_bik", "БИК", { inputMode: "numeric" })}
          {text("default_account_number", "Расчётный счёт", { inputMode: "numeric" })}
          <div className="sm:col-span-2">
            {text("default_corr_account", "Корреспондентский счёт", { inputMode: "numeric" })}
          </div>
        </div>
      </ProfileSection>
    </form>
  );
}
