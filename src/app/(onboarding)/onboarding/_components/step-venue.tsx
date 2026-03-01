"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { VENUE_TYPES, CURRENCIES, TIMEZONES, DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import { createAccountAndVenue } from "../actions";
import type { WizardData } from "./wizard";
import type { WorkingHours } from "@/types/database";

const ALL_VENUE_TYPE_VALUES = [
  "bar", "snack_bar", "hookah", "cafe", "pastry_shop",
  "coffee_shop", "pub", "pizzeria", "restaurant", "canteen", "fast_food",
] as const;

const schema = z.object({
  venueName:    z.string().min(1, "Введите название"),
  venueType:    z.enum(ALL_VENUE_TYPE_VALUES),
  venueAddress: z.string().min(1, "Укажите адрес"),
  venuePhone:   z.string().min(1, "Укажите телефон"),
  venueWebsite: z.string().optional(),
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

const inputCls = (hasError: boolean) =>
  [
    "h-12 w-full rounded-xl border px-4 text-sm placeholder:text-gray-400",
    "outline-none transition-colors duration-150",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
  ].join(" ");

export function StepVenue({ data, onUpdate, onNext, onBack }: Props) {
  const [workingHours, setWorkingHours] = useState<WorkingHours>(data.workingHours);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      venueName:    data.venueName,
      venueType:    (ALL_VENUE_TYPE_VALUES as readonly string[]).includes(data.venueType)
                      ? (data.venueType as Form["venueType"])
                      : "restaurant",
      venueAddress: data.venueAddress,
      venuePhone:   data.venuePhone,
      venueWebsite: data.venueWebsite,
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
      venueAddress:   values.venueAddress,
      venuePhone:     values.venuePhone,
      venueWebsite:   values.venueWebsite ?? "",
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <MapPin className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            Шаг 3 из 5
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Первое заведение</h1>
        <p className="text-sm text-gray-500">Расскажите о вашем заведении</p>
      </div>

      {/* Body */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="px-8 py-6 space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="venueName" className="text-sm font-medium text-gray-700">
              Название <span className="text-gray-400 font-normal">*</span>
            </label>
            <input
              id="venueName"
              placeholder="Ресторан «Берёзка»"
              className={inputCls(!!errors.venueName)}
              {...register("venueName")}
            />
            {errors.venueName && (
              <p className="text-xs text-red-600">{errors.venueName.message}</p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Тип заведения <span className="text-gray-400 font-normal">*</span>
            </label>
            <Select
              defaultValue={
                (ALL_VENUE_TYPE_VALUES as readonly string[]).includes(data.venueType)
                  ? data.venueType
                  : "restaurant"
              }
              onValueChange={(v) => setValue("venueType", v as Form["venueType"])}
            >
              <SelectTrigger className="h-12 rounded-xl border-gray-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-gray-100 shadow-lg">
                {VENUE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Address + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="venueAddress" className="text-sm font-medium text-gray-700">
                Адрес <span className="text-gray-400 font-normal">*</span>
              </label>
              <input
                id="venueAddress"
                placeholder="г. Москва, ул. Пушкина, 1"
                className={inputCls(!!errors.venueAddress)}
                {...register("venueAddress")}
              />
              {errors.venueAddress && (
                <p className="text-xs text-red-600">{errors.venueAddress.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="venuePhone" className="text-sm font-medium text-gray-700">
                Телефон <span className="text-gray-400 font-normal">*</span>
              </label>
              <input
                id="venuePhone"
                type="tel"
                placeholder="+7 (999) 000-00-00"
                className={inputCls(!!errors.venuePhone)}
                {...register("venuePhone")}
              />
              {errors.venuePhone && (
                <p className="text-xs text-red-600">{errors.venuePhone.message}</p>
              )}
            </div>
          </div>

          {/* Website */}
          <div className="space-y-1.5">
            <label htmlFor="venueWebsite" className="text-sm font-medium text-gray-700">
              Веб-сайт
              <span className="ml-1.5 text-xs font-normal text-gray-400">(необязательно)</span>
            </label>
            <input
              id="venueWebsite"
              type="url"
              placeholder="https://myrestaurant.ru"
              className={inputCls(false)}
              {...register("venueWebsite")}
            />
          </div>

          {/* Currency + Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                Валюта <span className="text-gray-400 font-normal">*</span>
              </label>
              <Select
                defaultValue={data.currency}
                onValueChange={(v) => setValue("currency", v)}
              >
                <SelectTrigger className="h-12 rounded-xl border-gray-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-gray-100 shadow-lg">
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                Часовой пояс <span className="text-gray-400 font-normal">*</span>
              </label>
              <Select
                defaultValue={data.timezone}
                onValueChange={(v) => setValue("timezone", v)}
              >
                <SelectTrigger className="h-12 rounded-xl border-gray-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-gray-100 shadow-lg">
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-100" />

          {/* Working hours */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Часы работы</label>
            <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-3">
              {DAYS_OF_WEEK.map(({ key, label }) => {
                const day = workingHours[key];
                const isClosed = day?.closed ?? false;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-7 text-sm font-medium text-gray-500 shrink-0">{label}</span>
                    <Switch
                      checked={!isClosed}
                      onCheckedChange={() => toggleDay(key)}
                    />
                    {isClosed ? (
                      <span className="text-sm text-gray-400">Выходной</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={day?.open ?? "10:00"}
                          onChange={(e) => setTime(key, "open", e.target.value)}
                          className="h-9 w-[100px] rounded-lg border border-gray-200 px-2 text-sm
                                     outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                     transition-colors duration-150 text-gray-700"
                        />
                        <span className="text-gray-400 text-sm">—</span>
                        <input
                          type="time"
                          value={day?.close ?? "22:00"}
                          onChange={(e) => setTime(key, "close", e.target.value)}
                          className="h-9 w-[100px] rounded-lg border border-gray-200 px-2 text-sm
                                     outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                                     transition-colors duration-150 text-gray-700"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="h-12 px-6 rounded-xl border border-gray-200 bg-white hover:bg-gray-50
                       text-gray-700 text-sm font-medium transition-colors duration-150"
          >
            Назад
          </button>
          <button
            type="submit"
            disabled={loading}
            className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm
                       font-medium transition-colors duration-150 flex items-center justify-center
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Создать
          </button>
        </div>
      </form>
    </div>
  );
}
