"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS, VENUE_TYPE_OPTIONS } from "@/lib/org/venue-labels";
import type { VenueType, WorkingHours } from "@/types/database";
import { createVenue } from "../actions";
import { DEFAULT_WORKING_HOURS, WorkingHoursEditor } from "./working-hours-editor";

type Draft = {
  name: string;
  type: string;
  address: string;
  phone: string;
  currency: string;
  timezone: string;
  hours: WorkingHours;
};

const EMPTY: Draft = {
  name: "",
  type: "restaurant",
  address: "",
  phone: "",
  currency: "RUB",
  timezone: "Europe/Moscow",
  hours: DEFAULT_WORKING_HOURS,
};

/**
 * Панель «Новое заведение». После создания открывается карточка: там
 * юрлицо, продажи, оплата труда и инвентаризация.
 */
export function VenueCreateDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const reset = () => {
    setDraft(EMPTY);
    setNameError(null);
    setServerError(null);
  };

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError("Укажите название");
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await createVenue({
        name,
        type: draft.type as VenueType,
        address: draft.address.trim() || undefined,
        phone: draft.phone || undefined,
        currency: draft.currency,
        timezone: draft.timezone,
        workingHours: draft.hours,
      });
      if (result.error || !result.id) {
        setServerError(result.error ?? "Не удалось создать заведение. Повторите попытку");
        return;
      }
      toast.success(`Заведение «${name}» создано`);
      onOpenChange(false);
      reset();
      router.push(`/org/venues/${result.id}`);
    });
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Новое заведение"
      description="Юрлицо, продажи и оплату труда настроите в карточке после создания"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={isPending} className="min-w-32">
            {isPending ? "Создаём…" : "Создать заведение"}
          </Button>
        </>
      }
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
        <DrawerSection title="Основное">
          <Field id="new-venue-name" label="Название" required error={nameError}>
            {(control) => (
              <Input
                {...control}
                value={draft.name}
                onChange={(e) => {
                  setNameError(null);
                  set("name", e.target.value);
                }}
                placeholder="Ресторан «Берёзка»"
                autoFocus
              />
            )}
          </Field>
          <Field id="new-venue-type" label="Тип" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={draft.type}
                onValueChange={(v) => set("type", v)}
                options={VENUE_TYPE_OPTIONS}
              />
            )}
          </Field>
          <Field id="new-venue-address" label="Адрес">
            {(control) => (
              <Input
                {...control}
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="г. Москва, ул. Пушкина, 1"
              />
            )}
          </Field>
          <Field id="new-venue-phone" label="Телефон">
            {(control) => (
              <PhoneInput
                {...control}
                value={draft.phone}
                onChange={(v) => set("phone", v)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="new-venue-currency" label="Валюта" required>
              {(control) => (
                <OptionSelect
                  {...control}
                  value={draft.currency}
                  onValueChange={(v) => set("currency", v)}
                  options={CURRENCY_OPTIONS}
                />
              )}
            </Field>
            <Field id="new-venue-tz" label="Часовой пояс" required>
              {(control) => (
                <OptionSelect
                  {...control}
                  value={draft.timezone}
                  onValueChange={(v) => set("timezone", v)}
                  options={TIMEZONE_OPTIONS}
                />
              )}
            </Field>
          </div>
        </DrawerSection>
        <DrawerSection title="Часы работы">
          <WorkingHoursEditor value={draft.hours} onChange={(v) => set("hours", v)} />
        </DrawerSection>
        {serverError ? (
          <p role="alert" className="text-xs text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </EditDrawer>
  );
}
