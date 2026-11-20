"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { InnInput } from "@/components/org/inn-input";
import type { ResolvedParty } from "@/lib/dadata/party";
import {
  createLegalEntity,
  type LegalEntityFormInput,
} from "@/lib/org/legal-entities";
import { LEGAL_FORM_OPTIONS } from "@/lib/org/legal-entity-labels";
import type { LegalForm } from "@/types/database";

const EMPTY: LegalEntityFormInput = {
  name: "",
  short_name: "",
  legal_form: "OOO",
  inn: "",
};

/**
 * Панель «Новое юрлицо»: ИНН с заполнением из DaData, название и форма.
 * Остальные реквизиты (налоги, адреса, банк) заполняются в карточке, куда
 * панель переводит после создания. Всё, что пришло из DaData (КПП, ОГРН,
 * адрес, руководитель), сохраняется сразу — второй раз вводить не нужно.
 */
export function LegalEntityCreateDrawer({
  open,
  onOpenChange,
  dadataEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dadataEnabled: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<LegalEntityFormInput>(EMPTY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setForm(EMPTY);
    setNameError(null);
    setServerError(null);
  };

  const applyParty = (party: ResolvedParty) => {
    setNameError(null);
    setForm((prev) => ({
      ...prev,
      name: party.name,
      short_name: party.shortName ?? prev.short_name,
      legal_form: party.legalForm,
      inn: party.inn,
      kpp: party.kpp ?? prev.kpp,
      ogrn: party.ogrn ?? prev.ogrn,
      okpo: party.okpo ?? prev.okpo,
      okved: party.okved ?? prev.okved,
      legal_address: party.legalAddress ?? prev.legal_address,
      director_name: party.directorName ?? prev.director_name,
      director_position: party.directorPosition ?? prev.director_position,
    }));
  };

  const submit = () => {
    if (!form.name.trim()) {
      setNameError("Укажите полное наименование");
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const { id, error } = await createLegalEntity({
        ...form,
        name: form.name.trim(),
        short_name: form.short_name?.trim() || null,
        inn: form.inn?.trim() || null,
        director_position: form.director_position ?? "Директор",
        signature_basis: "Устав",
      });
      if (error || !id) {
        setServerError(error ?? "Не удалось создать юрлицо. Повторите попытку");
        return;
      }
      toast.success(`Юрлицо «${form.short_name?.trim() || form.name.trim()}» создано`);
      onOpenChange(false);
      reset();
      router.push(`/org/legal-entities/${id}`);
    });
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Новое юрлицо"
      description={
        dadataEnabled
          ? "По ИНН реквизиты подтянутся из ЕГРЮЛ. Налоги, адреса и банк заполните в карточке"
          : "Налоги, адреса и банк заполните в карточке после создания"
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={isPending} className="min-w-32">
            {isPending ? "Создаём…" : "Создать юрлицо"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
        <Field id="new-le-inn" label="ИНН">
          {(control) => (
            <InnInput
              {...control}
              value={form.inn ?? ""}
              onChange={(inn) => setForm((prev) => ({ ...prev, inn }))}
              onParty={applyParty}
              hideLookupButton={!dadataEnabled}
            />
          )}
        </Field>
        <Field id="new-le-name" label="Полное наименование" required error={nameError}>
          {(control) => (
            <Input
              {...control}
              value={form.name}
              onChange={(e) => {
                setNameError(null);
                setForm((prev) => ({ ...prev, name: e.target.value }));
              }}
              placeholder="ООО «Хорошее»"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="new-le-short" label="Краткое наименование">
            {(control) => (
              <Input
                {...control}
                value={form.short_name ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, short_name: e.target.value }))
                }
              />
            )}
          </Field>
          <Field id="new-le-form" label="Форма" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.legal_form}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, legal_form: v as LegalForm }))
                }
                options={LEGAL_FORM_OPTIONS}
              />
            )}
          </Field>
        </div>
        {serverError ? (
          <p role="alert" className="text-xs text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </EditDrawer>
  );
}
