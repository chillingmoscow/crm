"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { VENUE_TYPES, CURRENCIES, TIMEZONES, DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import { createAccountAndVenue } from "../actions";
import type { WizardData } from "./wizard";
import type { WorkingHours } from "@/types/database";

const schema = z.object({
  venueName:    z.string().min(1, "Введите название"),
  venueType:    z.enum(["restaurant", "bar", "cafe", "club", "other"]),
  venueAddress: z.string().optional(),
  venuePhone:   z.string().optional(),
  currency:     z.string().min(1),
  timezone:     z.string().min(1),
});

type Form = z.infer<typeof schema>;

interface Props {
  data: WizardData;
  onUpdate: (patch: Partial<WizardData>) => void;
  onNext: (venueId: string) => void;
  onBack: () => void;
}

export function StepVenue({ data, onUpdate, onNext, onBack }: Props) {
  const [workingHours, setWorkingHours] = useState<WorkingHours>(data.workingHours);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      venueName:    data.venueName,
      venueType:    data.venueType,
      venueAddress: data.venueAddress,
      venuePhone:   data.venuePhone,
      currency:     data.currency,
      timezone:     data.timezone,
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
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const onSubmit = async (values: Form) => {
    setLoading(true);
    onUpdate({ ...values, workingHours });

    const result = await createAccountAndVenue({
      accountName:    data.accountName,
      accountLogoUrl: data.accountLogoUrl,
      venueName:      values.venueName,
      venueType:      values.venueType,
      venueAddress:   values.venueAddress ?? "",
      venuePhone:     values.venuePhone   ?? "",
      currency:       values.currency,
      timezone:       values.timezone,
      workingHours,
    });

    setLoading(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    onNext(result.venueId!);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Первое заведение</CardTitle>
        <CardDescription>Расскажите о вашем заведении</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-5">
          {/* Название */}
          <div className="space-y-2">
            <Label htmlFor="venueName">Название *</Label>
            <Input id="venueName" placeholder="Ресторан «Берёзка»" {...register("venueName")} />
            {errors.venueName && <p className="text-sm text-destructive">{errors.venueName.message}</p>}
          </div>

          {/* Тип */}
          <div className="space-y-2">
            <Label>Тип заведения *</Label>
            <Select
              defaultValue={data.venueType}
              onValueChange={(v) => setValue("venueType", v as Form["venueType"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENUE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Адрес и телефон */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="venueAddress">Адрес</Label>
              <Input id="venueAddress" placeholder="г. Москва, ул. Пушкина, 1" {...register("venueAddress")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venuePhone">Телефон</Label>
              <Input id="venuePhone" placeholder="+7 (999) 000-00-00" {...register("venuePhone")} />
            </div>
          </div>

          {/* Валюта и Часовой пояс */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Валюта *</Label>
              <Select
                defaultValue={data.currency}
                onValueChange={(v) => setValue("currency", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Часовой пояс *</Label>
              <Select
                defaultValue={data.timezone}
                onValueChange={(v) => setValue("timezone", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
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
                    <span className="w-7 text-sm font-medium text-muted-foreground">{label}</span>
                    <Switch
                      checked={!isClosed}
                      onCheckedChange={() => toggleDay(key)}
                    />
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
        </CardContent>

        <div className="px-6 pb-6 flex gap-3">
          <Button type="button" variant="outline" onClick={onBack} className="flex-1">
            Назад
          </Button>
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </div>
      </form>
    </Card>
  );
}
