"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBarSection } from "@/components/shared/save-bar";
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS, VENUE_TYPE_OPTIONS } from "@/lib/org/venue-labels";
import type { VenueType, WorkingHours } from "@/types/database";
import { updateVenue } from "../../actions";
import {
  DEFAULT_WORKING_HOURS,
  WorkingHoursEditor,
  sameWorkingHours,
} from "../../_components/working-hours-editor";
import type { VenueDetail } from "./venue-detail-page";

type FormState = {
  name: string;
  type: string;
  address: string;
  phone: string;
  comment: string;
  currency: string;
  timezone: string;
  legalEntityId: string;
  hours: WorkingHours;
};

function fromVenue(venue: VenueDetail): FormState {
  return {
    name: venue.name,
    type: venue.type,
    address: venue.address ?? "",
    phone: venue.phone ?? "",
    comment: venue.comment ?? "",
    currency: venue.currency,
    timezone: venue.timezone,
    legalEntityId: venue.default_legal_entity_id ?? "",
    hours: venue.working_hours ?? DEFAULT_WORKING_HOURS,
  };
}

/**
 * Вкладка «Основное» карточки заведения: правка на месте, сохранение общей
 * полосой. Монтируется заново после сохранения (ключ у родителя).
 */
export function VenueMainSections({
  venue,
  legalEntities,
  readOnly,
  lockMessage,
}: {
  venue: VenueDetail;
  legalEntities: { id: string; name: string }[];
  readOnly: boolean;
  lockMessage: string | null;
}) {
  const router = useRouter();
  const initial = fromVenue(venue);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const dirty =
    form.name.trim() !== initial.name ||
    form.type !== initial.type ||
    form.address.trim() !== initial.address ||
    form.phone !== initial.phone ||
    form.comment.trim() !== initial.comment ||
    form.currency !== initial.currency ||
    form.timezone !== initial.timezone ||
    form.legalEntityId !== initial.legalEntityId ||
    !sameWorkingHours(form.hours, initial.hours);
  const nameError = !form.name.trim() ? "Укажите название" : null;

  async function save(): Promise<boolean> {
    if (nameError) return false;
    setSaving(true);
    try {
      const { error } = await updateVenue(venue.id, {
        name: form.name.trim(),
        type: form.type as VenueType,
        address: form.address.trim() || undefined,
        phone: form.phone || undefined,
        currency: form.currency,
        timezone: form.timezone,
        workingHours: form.hours,
        comment: form.comment.trim() || null,
        // Юрлицо меняем, только если его тронули: без права видеть
        // юрлица список пуст, и прежнее значение не должно стереться.
        ...(form.legalEntityId !== initial.legalEntityId
          ? { defaultLegalEntityId: form.legalEntityId || null }
          : {}),
      });
      if (error) {
        toast.error(`Не удалось сохранить заведение: ${error}`);
        return false;
      }
      toast.success("Изменения сохранены");
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("Не удалось сохранить заведение. Проверьте подключение и повторите");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const locked = lockMessage ? { tone: "locked" as const, message: lockMessage } : undefined;
  const legalEntityKnown =
    !initial.legalEntityId || legalEntities.some((le) => le.id === initial.legalEntityId);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly && dirty && !saving && !nameError) void save();
      }}
    >
      <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      <SaveBarSection
        dirty={!readOnly && dirty}
        saving={saving || refreshing}
        save={save}
        reset={() => setForm(initial)}
        blocked={!readOnly && dirty ? nameError : null}
      />

      <ProfileSection title="Основное" locked={locked}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="venue-name" label="Название" required error={dirty ? nameError : null}>
            {(control) => (
              <Input
                {...control}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ресторан «Берёзка»"
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="venue-type" label="Тип" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.type}
                onValueChange={(v) => set("type", v)}
                options={VENUE_TYPE_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="venue-address" label="Адрес">
            {(control) => (
              <Input
                {...control}
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="г. Москва, ул. Пушкина, 1"
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="venue-phone" label="Телефон">
            {(control) => (
              <PhoneInput
                {...control}
                value={form.phone}
                onChange={(v) => set("phone", v)}
                disabled={readOnly}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field id="venue-comment" label="Заметки">
              {(control) => (
                <Textarea
                  {...control}
                  value={form.comment}
                  onChange={(e) => set("comment", e.target.value)}
                  placeholder="Что важно знать о заведении"
                  rows={3}
                  disabled={readOnly}
                />
              )}
            </Field>
          </div>
        </div>
      </ProfileSection>

      <ProfileSection title="Учёт" locked={locked}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="venue-currency" label="Валюта" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.currency}
                onValueChange={(v) => set("currency", v)}
                options={CURRENCY_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="venue-tz" label="Часовой пояс" required>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.timezone}
                onValueChange={(v) => set("timezone", v)}
                options={TIMEZONE_OPTIONS}
                disabled={readOnly}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="venue-legal-entity"
              label="Юрлицо по умолчанию"
              hint={
                legalEntities.length === 0 ? (
                  <>
                    Юрлиц пока нет.{" "}
                    <Link href="/org/legal-entities" className="text-brand hover:underline">
                      Добавить юрлицо
                    </Link>
                  </>
                ) : (
                  "Подставляется в финансовые документы заведения"
                )
              }
            >
              {(control) => (
                <OptionSelect
                  {...control}
                  value={legalEntityKnown ? form.legalEntityId : ""}
                  onValueChange={(v) => set("legalEntityId", v)}
                  options={[
                    { value: "", label: "Не выбрано" },
                    ...legalEntities.map((le) => ({ value: le.id, label: le.name })),
                  ]}
                  disabled={readOnly || legalEntities.length === 0}
                />
              )}
            </Field>
          </div>
        </div>
      </ProfileSection>

      <ProfileSection title="Часы работы" locked={locked}>
        <WorkingHoursEditor
          value={form.hours}
          onChange={(v) => set("hours", v)}
          disabled={readOnly}
        />
      </ProfileSection>
    </form>
  );
}
