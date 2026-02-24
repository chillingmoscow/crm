"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, MapPin, Phone, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VENUE_TYPES, CURRENCIES, TIMEZONES, DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import { createVenue, updateVenue, deleteVenue } from "../actions";
import type { VenueRow } from "../page";
import type { VenueType, WorkingHours } from "@/types/database";

const VENUE_TYPE_LABELS: Record<string, string> = {
  restaurant: "Ресторан",
  bar:        "Бар",
  cafe:       "Кафе",
  club:       "Клуб",
  other:      "Другое",
};

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
});

type Form = z.infer<typeof schema>;

type Props = {
  venues: VenueRow[];
};

export function VenuesClient({ venues: initialVenues }: Props) {
  const [venues, setVenues] = useState(initialVenues);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingVenue, setEditingVenue] = useState<VenueRow | null>(null);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(INITIAL_WORKING_HOURS);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, setValue, reset, formState: { errors } } =
    useForm<Form>({
      resolver: zodResolver(schema),
      defaultValues: {
        type:     "restaurant",
        currency: "RUB",
        timezone: "Europe/Moscow",
      },
    });

  function openCreate() {
    setEditingVenue(null);
    setWorkingHours(INITIAL_WORKING_HOURS);
    reset({
      name:     "",
      type:     "restaurant",
      address:  "",
      phone:    "",
      currency: "RUB",
      timezone: "Europe/Moscow",
    });
    setSheetOpen(true);
  }

  function openEdit(venue: VenueRow) {
    setEditingVenue(venue);
    setWorkingHours(venue.working_hours ?? INITIAL_WORKING_HOURS);
    reset({
      name:     venue.name,
      type:     venue.type as Form["type"],
      address:  venue.address ?? "",
      phone:    venue.phone ?? "",
      currency: venue.currency,
      timezone: venue.timezone,
    });
    setSheetOpen(true);
  }

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
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const onSubmit = (values: Form) => {
    startTransition(async () => {
      const payload = {
        name:         values.name,
        type:         values.type as VenueType,
        address:      values.address,
        phone:        values.phone,
        currency:     values.currency,
        timezone:     values.timezone,
        workingHours: workingHours,
      };

      if (editingVenue) {
        const result = await updateVenue(editingVenue.id, payload);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Заведение обновлено");
        setVenues((prev) =>
          prev.map((v) =>
            v.id === editingVenue.id
              ? {
                  ...v,
                  name:          values.name,
                  type:          values.type,
                  address:       values.address ?? null,
                  phone:         values.phone ?? null,
                  currency:      values.currency,
                  timezone:      values.timezone,
                  working_hours: workingHours,
                }
              : v
          )
        );
      } else {
        const result = await createVenue(payload);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Заведение создано");
        if (result.id) {
          setVenues((prev) => [
            ...prev,
            {
              id:            result.id!,
              name:          values.name,
              type:          values.type,
              address:       values.address ?? null,
              phone:         values.phone ?? null,
              currency:      values.currency,
              timezone:      values.timezone,
              working_hours: workingHours,
            },
          ]);
        }
      }

      setSheetOpen(false);
    });
  };

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteVenue(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Заведение удалено");
        setVenues((prev) => prev.filter((v) => v.id !== id));
      }
      setConfirmDeleteId(null);
    });
  }

  return (
    <div className="p-6 md:p-8 w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Заведения</h1>
          <p className="text-muted-foreground mt-1">
            Управляйте заведениями вашего аккаунта
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" />
          Добавить заведение
        </Button>
      </div>

      {venues.length === 0 ? (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-12 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет заведений</p>
          <p className="text-sm text-muted-foreground mt-1">
            Добавьте первое заведение, чтобы начать работу
          </p>
          <Button onClick={openCreate} size="sm" className="mt-4">
            <Plus className="w-4 h-4 mr-1.5" />
            Добавить заведение
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <div
              key={venue.id}
              className="rounded-lg border bg-card p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{venue.name}</p>
                  <Badge variant="secondary" className="mt-1 text-xs">
                    {VENUE_TYPE_LABELS[venue.type] ?? venue.type}
                  </Badge>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openEdit(venue)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {confirmDeleteId === venue.id ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs px-2"
                        disabled={isPending}
                        onClick={() => handleDelete(venue.id)}
                      >
                        Удалить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmDeleteId(venue.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1 text-sm text-muted-foreground">
                {venue.address && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{venue.address}</span>
                  </div>
                )}
                {venue.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    <span>{venue.phone}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 text-xs text-muted-foreground mt-auto pt-2 border-t">
                <span>{venue.currency}</span>
                <span>·</span>
                <span>{venue.timezone.split("/")[1]?.replace(/_/g, " ") ?? venue.timezone}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingVenue ? "Редактировать заведение" : "Новое заведение"}
            </SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
            {/* Название */}
            <div className="space-y-2">
              <Label htmlFor="name">Название *</Label>
              <Input
                id="name"
                placeholder="Ресторан «Берёзка»"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* Тип */}
            <div className="space-y-2">
              <Label>Тип заведения *</Label>
              <Select
                defaultValue={editingVenue?.type ?? "restaurant"}
                onValueChange={(v) => setValue("type", v as Form["type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VENUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Адрес и телефон */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="address">Адрес</Label>
                <Input
                  id="address"
                  placeholder="г. Москва, ул. Пушкина, 1"
                  {...register("address")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Телефон</Label>
                <Input
                  id="phone"
                  placeholder="+7 (999) 000-00-00"
                  {...register("phone")}
                />
              </div>
            </div>

            {/* Валюта и пояс */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Валюта *</Label>
                <Select
                  defaultValue={editingVenue?.currency ?? "RUB"}
                  onValueChange={(v) => setValue("currency", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Часовой пояс *</Label>
                <Select
                  defaultValue={editingVenue?.timezone ?? "Europe/Moscow"}
                  onValueChange={(v) => setValue("timezone", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Часы работы */}
            <div className="space-y-3">
              <Label>Часы работы</Label>
              <div className="space-y-2">
                {DAYS_OF_WEEK.map(({ key, label }) => {
                  const day = workingHours[key];
                  const isClosed = day?.closed ?? false;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-7 text-sm font-medium text-muted-foreground">
                        {label}
                      </span>
                      <Switch
                        checked={!isClosed}
                        onCheckedChange={() => toggleDay(key)}
                      />
                      {isClosed ? (
                        <span className="text-sm text-muted-foreground">
                          Выходной
                        </span>
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

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setSheetOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                {editingVenue ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
