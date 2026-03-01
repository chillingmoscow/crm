"use client";

import { useState, useRef, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, UserRound, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadLogo, saveProfile } from "../actions";

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  firstName:  z.string().min(1, "Введите имя"),
  lastName:   z.string().min(1, "Введите фамилию"),
  gender:     z.enum(["male", "female"], { required_error: "Выберите пол" }),
  birthDay:   z.string().min(1, "Укажите день"),
  birthMonth: z.string().min(1, "Укажите месяц"),
  birthYear:  z.string().min(1, "Укажите год"),
  phone:      z.string().min(1, "Укажите телефон"),
  telegramId: z.string().min(1, "Укажите ID Telegram").regex(/^\d+$/, "ID Telegram — только цифры"),
  address:    z.string().optional(),
});

type Form = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProfileInitialData {
  firstName:  string;
  lastName:   string;
  photoUrl:   string | null;
  gender:     string | null;
  birthDate:  string | null;
  phone:      string | null;
  telegramId: string | null;
  address:    string | null;
}

interface Props {
  initial:   ProfileInitialData;
  stepLabel: string;
  onNext:    () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GENDERS = [
  { value: "male",   label: "Мужской" },
  { value: "female", label: "Женский" },
] as const;

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function daysInMonth(month: string, year: string): number {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!m || !y) return 31;
  return new Date(y, m, 0).getDate();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StepProfile({ initial, stepLabel, onNext }: Props) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial.photoUrl);
  const [uploading, setUploading]       = useState(false);
  const [photoUrl, setPhotoUrl]         = useState<string | null>(initial.photoUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  // Parse initial birth date if present
  const [initYear, initMonth, initDay] = initial.birthDate?.split("-") ?? ["", "", ""];

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 100;
  const maxYear = currentYear - 14;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName:  initial.firstName,
      lastName:   initial.lastName,
      gender:     (initial.gender === "male" || initial.gender === "female")
                    ? initial.gender
                    : undefined,
      birthDay:   initDay  ?? "",
      birthMonth: initMonth ?? "",
      birthYear:  initYear  ?? "",
      phone:      initial.phone ?? "",
      telegramId: initial.telegramId ?? "",
      address:    initial.address ?? "",
    },
  });

  const selectedGender = watch("gender");
  const watchMonth     = watch("birthMonth");
  const watchYear      = watch("birthYear");

  const maxDay = useMemo(
    () => daysInMonth(watchMonth, watchYear),
    [watchMonth, watchYear],
  );

  const dayOptions = Array.from({ length: maxDay }, (_, i) =>
    String(i + 1).padStart(2, "0"),
  );

  const yearOptions = Array.from(
    { length: maxYear - minYear + 1 },
    (_, i) => String(maxYear - i),
  );

  // ── Photo upload ────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoPreview(URL.createObjectURL(file));
    setUploading(true);

    const fd = new FormData();
    fd.append("file", file);
    const { url, error } = await uploadLogo(fd);

    setUploading(false);
    if (error) {
      toast.error(error);
      setPhotoPreview(initial.photoUrl);
      return;
    }
    setPhotoUrl(url);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const onSubmit = async (values: Form) => {
    const birthDate = values.birthYear && values.birthMonth && values.birthDay
      ? `${values.birthYear}-${values.birthMonth.padStart(2, "0")}-${values.birthDay.padStart(2, "0")}`
      : "";

    const { error } = await saveProfile({
      firstName:  values.firstName,
      lastName:   values.lastName,
      gender:     values.gender,
      birthDate,
      phone:      values.phone,
      telegramId: values.telegramId,
      address:    values.address ?? "",
      photoUrl,
    });

    if (error) {
      toast.error(error);
      return;
    }

    onNext();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-100">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <UserRound className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            Шаг {stepLabel}
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Ваш профиль</h1>
        <p className="text-sm text-gray-500">Расскажите немного о себе</p>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="px-8 py-6 space-y-6">

          {/* ── Фото ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-full border-2 border-dashed border-gray-200
                         hover:border-blue-400 transition-colors duration-150 overflow-hidden
                         flex items-center justify-center bg-gray-50 shrink-0"
            >
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="Фото" className="w-full h-full object-cover" />
              ) : (
                <Upload className="w-5 h-5 text-gray-400" />
              )}
              {uploading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                </div>
              )}
            </button>
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50
                           text-gray-700 text-sm font-medium transition-colors duration-150
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {photoPreview ? "Заменить фото" : "Загрузить фото"}
              </button>
              <p className="text-xs text-gray-400 mt-1.5">PNG, JPG до 5 МБ</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* ── Личные данные ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Личные данные
            </p>

            {/* Имя + Фамилия */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="firstName" className="text-sm font-medium text-gray-700">Имя</label>
                <input
                  id="firstName"
                  placeholder="Иван"
                  className={inputCls(!!errors.firstName)}
                  {...register("firstName")}
                />
                {errors.firstName && (
                  <p className="text-xs text-red-500">{errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="lastName" className="text-sm font-medium text-gray-700">Фамилия</label>
                <input
                  id="lastName"
                  placeholder="Иванов"
                  className={inputCls(!!errors.lastName)}
                  {...register("lastName")}
                />
                {errors.lastName && (
                  <p className="text-xs text-red-500">{errors.lastName.message}</p>
                )}
              </div>
            </div>

            {/* Пол — только 2 варианта */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Пол</label>
              <div className="flex gap-2">
                {GENDERS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setValue("gender", value, { shouldValidate: true })}
                    className={[
                      "flex-1 h-11 rounded-xl border text-sm transition-colors duration-150 font-medium",
                      selectedGender === value
                        ? "bg-blue-50 border-blue-500 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {errors.gender && (
                <p className="text-xs text-red-500">{errors.gender.message}</p>
              )}
            </div>

            {/* Дата рождения — 3 селекта */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Дата рождения</label>
              <div className="grid grid-cols-3 gap-2">
                {/* День */}
                <Controller
                  name="birthDay"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className={selectTriggerCls(!!errors.birthDay)}>
                        <SelectValue placeholder="День" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-xl border-gray-100 shadow-lg">
                        {dayOptions.map((d) => (
                          <SelectItem key={d} value={d}>{parseInt(d, 10)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {/* Месяц */}
                <Controller
                  name="birthMonth"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className={selectTriggerCls(!!errors.birthMonth)}>
                        <SelectValue placeholder="Месяц" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-xl border-gray-100 shadow-lg">
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {/* Год */}
                <Controller
                  name="birthYear"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className={selectTriggerCls(!!errors.birthYear)}>
                        <SelectValue placeholder="Год" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-xl border-gray-100 shadow-lg">
                        {yearOptions.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {(errors.birthDay || errors.birthMonth || errors.birthYear) && (
                <p className="text-xs text-red-500">Укажите дату рождения</p>
              )}
            </div>
          </div>

          {/* ── Контакты ──────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Контакты
            </p>

            {/* Телефон */}
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-sm font-medium text-gray-700">Телефон</label>
              <input
                id="phone"
                type="tel"
                placeholder="+7 (999) 000-00-00"
                className={inputCls(!!errors.phone)}
                {...register("phone")}
              />
              {errors.phone && (
                <p className="text-xs text-red-500">{errors.phone.message}</p>
              )}
            </div>

            {/* Telegram ID */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="telegramId" className="text-sm font-medium text-gray-700">
                  ID Telegram
                </label>
                <div className="group relative inline-flex">
                  <HelpCircle className="w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600 transition-colors" />
                  <div
                    className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                               w-64 rounded-xl bg-gray-900 px-3 py-2.5 text-xs text-white shadow-lg
                               opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
                  >
                    Чтобы узнать свой числовой ID, напишите боту{" "}
                    <span className="font-semibold text-blue-300">@userinfobot</span>{" "}
                    в Telegram — он пришлёт ваш ID в ответ.
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px
                                    border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
              </div>
              <input
                id="telegramId"
                inputMode="numeric"
                placeholder="123456789"
                className={inputCls(!!errors.telegramId)}
                {...register("telegramId")}
              />
              {errors.telegramId && (
                <p className="text-xs text-red-500">{errors.telegramId.message}</p>
              )}
            </div>

            {/* Адрес */}
            <div className="space-y-1.5">
              <label htmlFor="address" className="text-sm font-medium text-gray-700">
                Адрес проживания
                <span className="ml-1.5 text-xs font-normal text-gray-400">(необязательно)</span>
              </label>
              <input
                id="address"
                placeholder="г. Москва, ул. Пушкина, д. 1, кв. 1"
                className={inputCls(false)}
                {...register("address")}
              />
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-8 pb-8">
          <button
            type="submit"
            disabled={isSubmitting || uploading}
            className="h-12 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm
                       font-medium transition-colors duration-150 flex items-center justify-center
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Далее
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return [
    "h-12 w-full rounded-xl border px-4 text-sm bg-white placeholder:text-gray-400",
    "outline-none transition-colors duration-150",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
  ].join(" ");
}

function selectTriggerCls(hasError: boolean) {
  return [
    "h-12 rounded-xl text-sm bg-white transition-colors duration-150",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
  ].join(" ");
}
