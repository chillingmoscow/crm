"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { CounterpartyGroupSelect } from "@/components/finance/counterparty-group-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import { InnInput } from "@/components/org/inn-input";
import type { ResolvedParty } from "@/lib/dadata/party";
import { createCounterparty } from "@/lib/finance/counterparties";
import { LEGAL_FORM_OPTIONS } from "@/lib/org/legal-entity-labels";
import type { CounterpartyFormInput } from "@/types/finance";
import type { LegalForm } from "@/types/database";

type Form = {
  inn: string;
  name: string;
  legal_form: LegalForm;
  group_id: string;
  is_supplier: boolean;
  contact_person: string;
  phone: string;
  email: string;
  telegram: string;
  // Пришло из DaData — сохраняем сразу, чтобы не вводить второй раз в карточке.
  kpp: string | null;
  ogrn: string | null;
  address: string | null;
};

const EMPTY: Form = {
  inn: "",
  name: "",
  legal_form: "OOO",
  group_id: "",
  is_supplier: false,
  contact_person: "",
  phone: "",
  email: "",
  telegram: "",
  kpp: null,
  ogrn: null,
  address: null,
};

/**
 * Панель «Новый контрагент»: ИНН с заполнением из ЕГРЮЛ, название, форма,
 * группа и контакт. КПП, ОГРН и адрес из DaData сохраняются сразу; остальное
 * дописывают в карточке. Из списка панель переводит в карточку нового
 * контрагента, из формы операции — отдаёт его id через `onCreated`.
 */
export function CounterpartyCreateDrawer({
  open,
  onOpenChange,
  dadataEnabled,
  groups,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dadataEnabled: boolean;
  /** Без списка групп поле «Группа» не показывается. */
  groups?: { id: string; name: string }[];
  onCreated: (id: string, name: string) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setNameError(null);
    setServerError(null);
  }, [open]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setServerError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const applyParty = (party: ResolvedParty) => {
    setNameError(null);
    setServerError(null);
    setForm((prev) => ({
      ...prev,
      inn: party.inn,
      name: party.name,
      legal_form: party.legalForm,
      kpp: party.kpp,
      ogrn: party.ogrn,
      address: party.legalAddress,
    }));
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setNameError("Укажите название контрагента");
      return;
    }
    setSaving(true);
    setServerError(null);
    const input: CounterpartyFormInput = {
      name,
      legal_form: form.legal_form,
      inn: form.inn,
      kpp: form.kpp,
      ogrn: form.ogrn,
      address: form.address,
      group_id: form.group_id || null,
      is_supplier: form.is_supplier,
      // Один контакт из панели; остальные добавляют в карточке.
      contacts: [{ name: form.contact_person, phone: form.phone, email: form.email, telegram: form.telegram }],
    };
    try {
      const { id, error } = await createCounterparty(input);
      if (error || !id) {
        setServerError(error ?? "Не удалось создать контрагента. Повторите попытку");
        return;
      }
      toast.success(`Контрагент «${name}» создан`);
      onOpenChange(false);
      onCreated(id, name);
    } catch {
      setServerError("Не удалось создать контрагента. Проверьте соединение и повторите");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Новый контрагент"
      description={
        dadataEnabled
          ? "По ИНН название, форма и реквизиты подтянутся из ЕГРЮЛ"
          : "Поставщик, покупатель или подрядчик. Реквизиты можно дописать в карточке"
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={saving} className="min-w-44">
            {saving ? "Создаём…" : "Создать контрагента"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DrawerSection title="Кто это">
          <Field id="new-cp-inn" label="ИНН">
            {(control) => (
              <InnInput
                {...control}
                value={form.inn}
                onChange={(inn) => set("inn", inn)}
                onParty={applyParty}
                hideLookupButton={!dadataEnabled}
                placeholder="10 или 12 цифр"
              />
            )}
          </Field>
          <Field id="new-cp-name" label="Название" required error={nameError}>
            {(control) => (
              <Input
                {...control}
                value={form.name}
                maxLength={300}
                placeholder="ООО «Поставщик»"
                onChange={(event) => {
                  setNameError(null);
                  set("name", event.target.value);
                }}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="new-cp-form" label="Форма">
              {(control) => (
                <OptionSelect
                  {...control}
                  value={form.legal_form}
                  onValueChange={(value) => set("legal_form", value as LegalForm)}
                  options={LEGAL_FORM_OPTIONS}
                />
              )}
            </Field>
            {groups ? (
              <Field id="new-cp-group" label="Группа">
                {(control) => (
                  <CounterpartyGroupSelect
                    {...control}
                    value={form.group_id}
                    onValueChange={(value) => set("group_id", value)}
                    groups={groups}
                    canCreate
                  />
                )}
              </Field>
            ) : null}
          </div>
          <label htmlFor="new-cp-supplier" className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Поставщик</span>
            <Switch
              id="new-cp-supplier"
              checked={form.is_supplier}
              onCheckedChange={(checked) => set("is_supplier", checked)}
            />
          </label>
        </DrawerSection>

        <DrawerSection title="Контакт">
          <Field id="new-cp-contact" label="Имя">
            {(control) => (
              <Input
                {...control}
                value={form.contact_person}
                maxLength={200}
                placeholder="Иван Петров, менеджер"
                onChange={(event) => set("contact_person", event.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="new-cp-phone" label="Телефон">
              {(control) => (
                <PhoneInput {...control} value={form.phone} onChange={(phone) => set("phone", phone)} />
              )}
            </Field>
            <Field id="new-cp-email" label="Почта">
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  inputMode="email"
                  value={form.email}
                  maxLength={200}
                  placeholder="info@example.ru"
                  onChange={(event) => set("email", event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field id="new-cp-telegram" label="Telegram">
            {(control) => (
              <Input
                {...control}
                value={form.telegram}
                maxLength={100}
                placeholder="@ник или ссылка t.me"
                onChange={(event) => set("telegram", event.target.value)}
              />
            )}
          </Field>
        </DrawerSection>

        {serverError ? (
          <p role="alert" className="text-xs text-destructive">
            {serverError}
          </p>
        ) : null}
        {/* Enter в поле создаёт контрагента; видимая кнопка — в подвале. */}
        <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      </form>
    </EditDrawer>
  );
}
