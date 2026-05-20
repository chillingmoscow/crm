"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VENUE_TYPES, CURRENCIES, TIMEZONES, DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import { updateVenue, type VenueArchiveImpact } from "../../actions";
import type { VenueType, WorkingHours } from "@/types/database";
import { FloorPlanTab } from "./floor-plan-tab";
import { VenueDangerZone } from "./venue-danger-zone";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import type { AuditEvent } from "@/lib/audit/list";

const INITIAL_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

// `type` was a tight enum mirroring the original 5-value venue_type
// from migration 001. Migration 026 added 8 more (snack_bar, hookah,
// pastry_shop, coffee_shop, pub, pizzeria, canteen, fast_food) but
// this schema wasn't updated — saves silently failed on zod validation
// for every venue with one of the new types. The DB enum is the source
// of truth; the Select dropdown is bound to VENUE_TYPES already, so we
// just accept any non-empty string here and let the DB catch nonsense.
const schema = z.object({
  name:                    z.string().min(1, "Введите название"),
  type:                    z.string().min(1),
  address:                 z.string().optional(),
  phone:                   z.string().optional(),
  currency:                z.string().min(1),
  timezone:                z.string().min(1),
  comment:                 z.string().optional(),
  default_legal_entity_id: z.string().nullable().optional(),
});

type Form = z.infer<typeof schema>;

type Venue = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  working_hours: WorkingHours | null;
  comment: string | null;
  default_legal_entity_id: string | null;
};

export type LegalEntityOption = {
  id: string;
  name: string;
  legal_form: string;
};

const BASE_TABS = ["Основное", "Карта залов"] as const;
type Tab = "Основное" | "Карта залов" | "Журнал";

export function VenueDetailPage({
  venue,
  importedFromQuickResto,
  legalEntities,
  canViewAudit,
  canArchive,
  canHardDelete,
  archiveImpact,
  initialAuditEvents,
  initialAuditHasMore,
}: {
  venue: Venue;
  importedFromQuickResto: boolean;
  legalEntities: LegalEntityOption[];
  canViewAudit: boolean;
  /** Owner-check — archive/restore/delete actions гейтятся им на сервере
      (assertVenueOwner). */
  canArchive: boolean;
  canHardDelete: boolean;
  archiveImpact: VenueArchiveImpact;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workingHours, setWorkingHours] = useState<WorkingHours>(
    venue.working_hours ?? INITIAL_WORKING_HOURS
  );
  const [activeTab, setActiveTab] = useState<Tab>("Основное");
  const TABS: Tab[] = canViewAudit
    ? [...BASE_TABS, "Журнал"]
    : [...BASE_TABS];

  const { register, handleSubmit, setValue, watch, control, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                    venue.name,
      type:                    venue.type as Form["type"],
      address:                 venue.address ?? "",
      phone:                   venue.phone ?? "",
      currency:                venue.currency,
      timezone:                venue.timezone,
      comment:                 venue.comment ?? "",
      default_legal_entity_id: venue.default_legal_entity_id,
    },
  });
  const selectedLegalEntityId = watch("default_legal_entity_id") ?? null;

  const toggleDay = (day: DayKey) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        closed: !prev[day]?.closed,
        open:   prev[day]?.open  ?? "10:00",
        close:  prev[day]?.close ?? "22:00",
      },
    }));
  };

  const setTime = (day: DayKey, field: "open" | "close", value: string) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const onSubmit = (values: Form) => {
    startTransition(async () => {
      const result = await updateVenue(venue.id, {
        name: values.name, type: values.type as VenueType,
        address: values.address, phone: values.phone,
        currency: values.currency, timezone: values.timezone,
        workingHours,
        comment: values.comment || null,
        defaultLegalEntityId: values.default_legal_entity_id ?? null,
      });
      if (result.error) { toast.error(result.error); return; }
      toast.success("Изменения сохранены");
    });
  };

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header + title + tabs — full width */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
            onClick={() => router.push("/org/venues")}
          >
            <ArrowLeft className="w-4 h-4" />
            Заведения
          </Button>
          {activeTab === "Основное" && (
            <Button onClick={handleSubmit(onSubmit)} disabled={isPending} size="sm">
              Сохранить
            </Button>
          )}
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold">{venue.name}</h1>
          {importedFromQuickResto ? (
            <Badge variant="outline" className="mt-2 text-xs border-blue-200 text-blue-700">
              Импортировано из QuickResto
            </Badge>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="border-b mb-6">
          <div className="flex">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab: Основное ─────────────────────────────────────── */}
      {activeTab === "Основное" && (
        <div className="max-w-2xl mx-auto">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Row 1: Name + Type */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="name">Название *</Label>
              <Input id="name" placeholder="Ресторан «Берёзка»" {...register("name")} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Тип заведения *</Label>
              <Select
                defaultValue={venue.type}
                onValueChange={(v) => setValue("type", v as Form["type"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENUE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Address + Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="address">Адрес</Label>
              <Input id="address" placeholder="г. Москва, ул. Пушкина, 1" {...register("address")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <PhoneInput
                    id="phone"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
          </div>

          {/* Row 3: Currency + Timezone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Валюта *</Label>
              <Select defaultValue={venue.currency} onValueChange={(v) => setValue("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Часовой пояс *</Label>
              <Select defaultValue={venue.timezone} onValueChange={(v) => setValue("timezone", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 4: Legal entity picker. Each venue runs under a "default"
               legal entity used for finance documents. Stage 2B feature. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Юрлицо по умолчанию</Label>
              {legalEntities.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Сначала создайте юрлицо в разделе{" "}
                  <Link href="/org/legal-entities" className="underline underline-offset-2">
                    Юрлица
                  </Link>
                  .
                </p>
              ) : (
                <Select
                  value={selectedLegalEntityId ?? "__none__"}
                  onValueChange={(v) =>
                    setValue("default_legal_entity_id", v === "__none__" ? null : v, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Не выбрано" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не выбрано</SelectItem>
                    {legalEntities.map((le) => (
                      <SelectItem key={le.id} value={le.id}>
                        {le.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label>Часы работы</Label>
            <div className="space-y-2">
              {DAYS_OF_WEEK.map(({ key, label }) => {
                const day = workingHours[key];
                const isClosed = day?.closed ?? false;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-7 text-sm font-medium text-muted-foreground">{label}</span>
                    <Switch checked={!isClosed} onCheckedChange={() => toggleDay(key)} />
                    {isClosed ? (
                      <span className="text-sm text-muted-foreground">Выходной</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={day?.open ?? "10:00"}
                          onChange={(e) => setTime(key, "open", e.target.value)}
                          className="w-28 h-8 text-sm"
                        />
                        <span className="text-muted-foreground text-sm">—</span>
                        <Input
                          type="time"
                          value={day?.close ?? "22:00"}
                          onChange={(e) => setTime(key, "close", e.target.value)}
                          className="w-28 h-8 text-sm"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="comment">Комментарий</Label>
            <Textarea
              id="comment"
              placeholder="Дополнительные заметки о заведении..."
              {...register("comment")}
              rows={3}
            />
          </div>

          {canArchive ? (
            <VenueDangerZone
              venueId={venue.id}
              venueName={venue.name}
              impact={archiveImpact}
              canHardDelete={canHardDelete}
            />
          ) : null}
        </form>
        </div>
      )}

      {/* ── Tab: Карта залов ──────────────────────────────────── */}
      {activeTab === "Карта залов" && (
        <FloorPlanTab venueId={venue.id} />
      )}

      {/* ── Tab: Журнал ───────────────────────────────────────── */}
      {activeTab === "Журнал" && (
        <EntityAuditTab
          mode="entity"
          entityType="venue"
          entityId={venue.id}
          canView={canViewAudit}
          initialEvents={initialAuditEvents}
          initialHasMore={initialAuditHasMore}
        />
      )}
    </div>
  );
}
