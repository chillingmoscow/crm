"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { createCounterparty } from "@/lib/finance/counterparties";
import type { CounterpartyRow } from "@/types/finance";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
};

const LEGAL_FORMS: { value: CounterpartyRow["legal_form"]; label: string }[] = [
  { value: "OOO", label: "ООО" },
  { value: "IP", label: "ИП" },
  { value: "AO", label: "АО" },
  { value: "PAO", label: "ПАО" },
  { value: "NKO", label: "НКО" },
  { value: "OTHER", label: "Другое" },
];

type Errors = Partial<Record<"name" | "inn" | "email", string>>;

/** Новый контрагент прямо из формы операции; после создания форма его выбирает. */
export function CounterpartyFormSheet({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [legalForm, setLegalForm] = useState<CounterpartyRow["legal_form"]>("OOO");
  const [inn, setInn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setLegalForm("OOO");
    setInn("");
    setPhone("");
    setEmail("");
    setDescription("");
    setErrors({});
    setServerError(null);
  }, [open]);

  const handleSave = async () => {
    const found: Errors = {};
    if (!name.trim()) found.name = "Укажите название контрагента";
    if (inn.trim() && !/^(\d{10}|\d{12})$/.test(inn.trim())) found.inn = "ИНН — 10 или 12 цифр";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      found.email = "Проверьте адрес почты";
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setServerError(null);
    const { id, error } = await createCounterparty({
      name: name.trim(),
      legal_form: legalForm,
      inn: inn.trim() || null,
      phone: phone || null,
      email: email.trim() || null,
      description: description.trim() || null,
    }).catch(() => ({ id: null, error: "Нет связи с сервером. Проверьте соединение и повторите" }));
    setSaving(false);
    if (error || !id) {
      setServerError(error ?? "Не удалось создать контрагента");
      return;
    }
    toast.success("Контрагент создан");
    onCreated(id);
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      title="Новый контрагент"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} className="min-w-44">
            {saving ? "Создаём…" : "Создать контрагента"}
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
              placeholder="Например: Овощная база"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              autoFocus
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Правовая форма">
            {(control) => (
              <OptionSelect
                {...control}
                value={legalForm}
                onValueChange={(v) => setLegalForm(v as CounterpartyRow["legal_form"])}
                options={LEGAL_FORMS}
              />
            )}
          </Field>
          <Field label="ИНН" error={errors.inn}>
            {(control) => (
              <Input
                {...control}
                placeholder="10 или 12 цифр"
                value={inn}
                onChange={(e) => {
                  setInn(e.target.value.replace(/\D/g, "").slice(0, 12));
                  setErrors((x) => ({ ...x, inn: undefined }));
                }}
                inputMode="numeric"
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Телефон">
            {(control) => <PhoneInput {...control} value={phone} onChange={setPhone} />}
          </Field>
          <Field label="Почта" error={errors.email}>
            {(control) => (
              <Input
                {...control}
                type="email"
                placeholder="info@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((x) => ({ ...x, email: undefined }));
                }}
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
              placeholder="Например: контакт менеджера"
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
