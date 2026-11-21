"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { AddressInput } from "@/components/org/address-input";
import { InnInput } from "@/components/org/inn-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBarSection } from "@/components/shared/save-bar";
import { formatDayMonth } from "@/lib/format/date";
import { syncCounterpartyFromDadata, updateCounterparty } from "@/lib/finance/counterparties";
import { LEGAL_FORM_OPTIONS } from "@/lib/org/legal-entity-labels";
import type { CounterpartyFormInput, CounterpartyRow } from "@/types/finance";
import type { LegalForm } from "@/types/database";

type FormState = {
  name: string;
  legal_form: LegalForm;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
  contact_person: string;
  phone: string;
  email: string;
  group_id: string;
  description: string;
};

function fromRow(row: CounterpartyRow): FormState {
  return {
    name: row.name,
    legal_form: row.legal_form,
    inn: row.inn ?? "",
    kpp: row.kpp ?? "",
    ogrn: row.ogrn ?? "",
    address: row.address ?? "",
    contact_person: row.contact_person ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    // "" — без группы (контракт OptionSelect).
    group_id: row.group_id ?? "",
    description: row.description ?? "",
  };
}

/** Пустые строки уходят в базу как null; сервер ещё раз чистит пробелы. */
function toPatch(form: FormState): CounterpartyFormInput {
  const text = (value: string) => value.trim() || null;
  return {
    name: form.name.trim(),
    legal_form: form.legal_form,
    inn: text(form.inn),
    kpp: text(form.kpp),
    ogrn: text(form.ogrn),
    address: text(form.address),
    contact_person: text(form.contact_person),
    phone: text(form.phone),
    email: text(form.email),
    group_id: form.group_id || null,
    description: text(form.description),
  };
}

/** Поле, к которому относится ошибка проверки на сервере: её показываем у поля. */
function errorField(error: string | null): "inn" | "kpp" | "ogrn" | "email" | null {
  if (!error) return null;
  if (error.startsWith("ИНН") || error.startsWith("Контрагент с ИНН")) return "inn";
  if (error.startsWith("КПП")) return "kpp";
  if (error.startsWith("ОГРН")) return "ogrn";
  if (error.startsWith("Проверьте адрес почты")) return "email";
  return null;
}

/**
 * Данные контрагента — правка на месте, сохранение общей полосой карточки.
 * Компонент монтируется заново после сохранения (ключ по `updated_at` у
 * родителя), поэтому исходные значения всегда свежие.
 */
export function CounterpartyRequisites({
  row,
  groups,
  readOnly,
  lockMessage,
  dadataEnabled,
}: {
  row: CounterpartyRow;
  groups: { id: string; name: string }[];
  readOnly: boolean;
  lockMessage: string | null;
  /** DaData настроена: «Обновить по ИНН» и подсказки адресов. */
  dadataEnabled: boolean;
}) {
  const router = useRouter();
  const initial = fromRow(row);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as (keyof FormState)[]).some(
    (key) => form[key].trim() !== initial[key].trim(),
  );
  const nameMissing = !form.name.trim();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setServerError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function save(): Promise<boolean> {
    if (nameMissing) return false;
    setSaving(true);
    setServerError(null);
    try {
      const { error } = await updateCounterparty(row.id, toPatch(form));
      if (error) {
        // Ошибка проверки (ИНН, почта) — у полей, а не только во всплывашке.
        setServerError(error);
        toast.error(`Не удалось сохранить: ${error}`);
        return false;
      }
      toast.success("Данные контрагента сохранены");
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("Не удалось сохранить. Проверьте подключение и повторите");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const { error } = await syncCounterpartyFromDadata(row.id);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Реквизиты обновлены из ЕГРЮЛ");
      startRefresh(() => router.refresh());
    } catch {
      toast.error("Не удалось обновить реквизиты. Проверьте подключение и повторите");
    } finally {
      setSyncing(false);
    }
  }

  const fieldError = errorField(serverError);
  const errorOf = (key: string) => (fieldError === key ? serverError : null);
  const locked = lockMessage ? { tone: "locked" as const, message: lockMessage } : undefined;
  const syncedAt = formatDayMonth(row.dadata_synced_at);
  const text = (
    key: "name" | "kpp" | "ogrn" | "contact_person" | "email",
    label: string,
    opts: { required?: boolean; placeholder?: string; inputMode?: "numeric" | "email"; maxLength?: number; error?: string | null } = {},
  ) => (
    <Field id={`cp-${key}`} label={label} required={opts.required} error={opts.error ?? errorOf(key)}>
      {(control) => (
        <Input
          {...control}
          value={form[key]}
          onChange={(event) => set(key, event.target.value)}
          disabled={readOnly}
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
          maxLength={opts.maxLength}
        />
      )}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && dirty && !saving && !nameMissing) void save();
      }}
    >
      {/* Enter в поле сохраняет форму; видимая кнопка — в полосе. */}
      <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      <SaveBarSection
        dirty={!readOnly && dirty}
        saving={saving || refreshing}
        save={save}
        reset={() => {
          setForm(initial);
          setServerError(null);
        }}
        blocked={!readOnly && dirty && nameMissing ? "Укажите название контрагента" : null}
      />

      {serverError && !fieldError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      ) : null}

      <ProfileSection
        title="Реквизиты"
        description={syncedAt ? `Сверены с ЕГРЮЛ ${syncedAt}` : undefined}
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
                    : "Подтянуть название, форму, КПП, ОГРН и адрес из ЕГРЮЛ"
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void sync()}
                disabled={syncing || refreshing || dirty || !row.inn}
              >
                <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
                {syncing ? "Обновляем…" : "Обновить по ИНН"}
              </Button>
            </span>
          ) : undefined
        }
      >
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text("name", "Название", {
              required: true,
              placeholder: "ООО «Поставщик»",
              maxLength: 300,
              error: dirty && nameMissing ? "Укажите название контрагента" : null,
            })}
          </div>
          <Field id="cp-legal_form" label="Форма">
            {(control) => (
              <OptionSelect
                {...control}
                value={form.legal_form}
                onValueChange={(value) => set("legal_form", value as LegalForm)}
                options={LEGAL_FORM_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="cp-inn" label="ИНН" error={errorOf("inn")}>
            {(control) => (
              <InnInput
                {...control}
                value={form.inn}
                onChange={(value) => set("inn", value)}
                disabled={readOnly}
                placeholder="10 или 12 цифр"
                hideLookupButton
              />
            )}
          </Field>
          {text("kpp", "КПП", { inputMode: "numeric", maxLength: 9 })}
          {text("ogrn", form.legal_form === "IP" ? "ОГРНИП" : "ОГРН", { inputMode: "numeric", maxLength: 15 })}
          <div className="sm:col-span-2">
            <Field id="cp-address" label="Юридический адрес">
              {(control) => (
                <AddressInput
                  id={control.id}
                  value={form.address}
                  onChange={(value) => set("address", value)}
                  disabled={readOnly}
                  suggestionsEnabled={dadataEnabled}
                />
              )}
            </Field>
          </div>
        </div>
      </ProfileSection>

      <ProfileSection title="Контакты" locked={locked}>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text("contact_person", "Контактное лицо", { placeholder: "Имя менеджера", maxLength: 200 })}
          </div>
          <Field id="cp-phone" label="Телефон">
            {(control) => (
              <PhoneInput
                {...control}
                value={form.phone}
                onChange={(value) => set("phone", value)}
                disabled={readOnly}
              />
            )}
          </Field>
          {text("email", "Почта", { inputMode: "email", placeholder: "info@example.ru", maxLength: 200 })}
        </div>
      </ProfileSection>

      <ProfileSection title="Учёт" description="Как контрагент выглядит в списке" locked={locked}>
        <div className="grid gap-4">
          <Field id="cp-group" label="Группа">
            {(control) => (
              <OptionSelect
                {...control}
                value={form.group_id}
                onValueChange={(value) => set("group_id", value)}
                options={[
                  { value: "", label: "Без группы" },
                  ...groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="cp-description" label="Заметка">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                disabled={readOnly}
                placeholder={readOnly ? undefined : "Что поставляет, условия оплаты, особенности работы"}
              />
            )}
          </Field>
        </div>
      </ProfileSection>
    </form>
  );
}
