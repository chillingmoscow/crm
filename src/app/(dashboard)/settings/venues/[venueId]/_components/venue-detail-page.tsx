"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { updateVenue, deleteVenue } from "../../actions";
import type { VenueType, WorkingHours } from "@/types/database";
import { FloorPlanTab } from "./floor-plan-tab";

const INITIAL_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

const schema = z.object({
  name:     z.string().min(1, "Введите название"),
  type:     z.enum(["restaurant", "bar", "cafe", "club", "other"]),
  address:  z.string().optional(),
  phone:    z.string().optional(),
  currency: z.string().min(1),
  timezone: z.string().min(1),
  comment:  z.string().optional(),
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
};

const TABS = ["Основное", "Карта залов"] as const;
type Tab = (typeof TABS)[number];

export function VenueDetailPage({ venue }: { venue: Venue }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workingHours, setWorkingHours] = useState<WorkingHours>(
    venue.working_hours ?? INITIAL_WORKING_HOURS
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("Основное");

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:     venue.name,
      type:     venue.type as Form["type"],
      address:  venue.address ?? "",
      phone:    venue.phone ?? "",
      currency: venue.currency,
      timezone: venue.timezone,
      comment:  venue.comment ?? "",
    },
  });

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
      });
      if (result.error) { toast.error(result.error); return; }
      toast.success("Изменения сохранены");
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteVenue(venue.id);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Заведение удалено");
      router.push("/settings/venues");
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
            onClick={() => router.push("/settings/venues")}
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

        <h1 className="text-2xl font-semibold mb-6">{venue.name}</h1>

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
              <Input id="phone" placeholder="+7 (999) 000-00-00" {...register("phone")} />
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

          {/* Danger zone */}
          <div className="pt-8 border-t mt-10">
            <h2 className="text-base font-medium text-destructive mb-1">Удалить заведение</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Это действие необратимо. Все данные заведения будут удалены.
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={handleDelete}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Да, удалить
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                  Отмена
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Удалить заведение
              </Button>
            )}
          </div>
        </form>
        </div>
      )}

      {/* ── Tab: Карта залов ──────────────────────────────────── */}
      {activeTab === "Карта залов" && (
        <FloorPlanTab venueId={venue.id} />
      )}
    </div>
  );
}
