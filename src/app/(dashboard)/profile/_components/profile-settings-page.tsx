/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  Camera,
  FileText,
  Loader2,
  PartyPopper,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { translateError } from "@/lib/i18n/translate-error";
import { updateOwnProfile, type OwnProfile } from "../actions";
import { requestEmailChange } from "../email-change-actions";

const schema = z.object({
  first_name:  z.string().min(1, "Обязательное поле"),
  last_name:   z.string().min(1, "Обязательное поле"),
  phone:       z.string().optional(),
  telegram_id: z.string().optional(),
  gender:      z.enum(["male", "female", ""]).optional(),
  birth_date:  z.string().optional(),
  address:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  profile:        OwnProfile;
  email:          string;
  emailConfirmed: boolean;
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold text-foreground leading-tight">
          {title}
        </h2>
        {description && (
          <p className="text-[13px] text-muted-foreground leading-snug">
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

// Поля, которые считаем для метрики заполненности профиля + friendly
// микро-онбординг под прогресс-баром («следующие шаги»). Текст
// формулируется приветливо — мы НЕ говорим юзеру «ты обязан», мы
// объясняем зачем это нам и ему.
const COMPLETION_FIELDS = [
  {
    key: "avatar",
    label: "Фото",
    hint: "Добавьте фото — коллеги будут узнавать вас в списке и в чатах",
  },
  {
    key: "first_name",
    label: "Имя",
    hint: "Заполните имя — это первое, что увидят коллеги",
  },
  {
    key: "last_name",
    label: "Фамилия",
    hint: "Укажите фамилию — пригодится для документов и сводок",
  },
  {
    key: "phone",
    label: "Телефон",
    hint: "Оставьте телефон — чтобы быть на связи во время смены и по срочным вопросам",
  },
  {
    key: "telegram_id",
    label: "Telegram",
    hint: (
      <>
        Добавьте Telegram ID — вас пригласят в рабочие чаты команды. Узнать
        свой ID можно через бота{" "}
        <a
          href="https://t.me/WhatChatIDBot"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline"
        >
          @WhatChatIDBot
        </a>
      </>
    ),
  },
  {
    key: "gender",
    label: "Пол",
    hint: "Укажите пол — используем для статистики и опросов команды",
  },
  {
    key: "birth_date",
    label: "Дата рождения",
    hint: "Поделитесь датой рождения — поздравим и приготовим подарок 🎂",
  },
  {
    key: "address",
    label: "Адрес",
    hint: "Укажите адрес — посчитаем стоимость такси после поздней смены",
  },
] as const;

const TOTAL_WEIGHT = COMPLETION_FIELDS.length;

function fireConfetti() {
  // Конфетти из двух точек с боков экрана + центральный outburst — типичный
  // canvas-confetti success preset. Длительность ~2.5с.
  const end = Date.now() + 2500;
  const colors = ["#1570EF", "#3b82f6", "#16a34a", "#f59e0b", "#ec4899"];
  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.6 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({
    particleCount: 80,
    spread: 100,
    origin: { y: 0.4 },
    colors,
  });
}

export function ProfileSettingsPage({
  profile,
  email,
  emailConfirmed,
}: Props) {
  const searchParams = useSearchParams();
  const welcomeMode = searchParams.get("welcome") === "1";

  const [avatarUrl, setAvatarUrl]                 = useState<string | null>(profile.avatar_url);
  const [contactEmail, setContactEmail]           = useState(email);
  const [isPending, startTransition]              = useTransition();
  const [photoModalOpen, setPhotoModalOpen]      = useState(false);
  const [photoFile, setPhotoFile]                = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar]    = useState(false);
  const [pendingEmailChange, setPendingEmailChange] = useState(false);
  // После того как юзер сохранил 100% профиль — карточка-онбординг исчезает.
  // Если он вернётся и опустошит поле — карточка вернётся с этим пустым шагом.
  const [meterHidden, setMeterHidden] = useState(false);
  // Какое значение % было перед сейв-кликом — нужно чтобы триггерить
  // confetti ТОЛЬКО при переходе с <100% на 100%.
  const prevCompletionRef = useRef<number>(0);

  const photoInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, setValue, control, formState: { errors } } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: {
        first_name:  profile.first_name ?? "",
        last_name:   profile.last_name ?? "",
        phone:       profile.phone ?? "",
        telegram_id: profile.telegram_id ?? "",
        gender:      (profile.gender as "male" | "female" | "") ?? "",
        birth_date:  profile.birth_date ?? "",
        address:     profile.address ?? "",
      },
    });

  // Live-следим за полями, чтобы прогресс-бар двигался по мере ввода.
  const watchedValues = useWatch({ control });

  const completion = useMemo(() => {
    const isFilled: Record<string, boolean> = {
      avatar:      Boolean(avatarUrl),
      first_name:  Boolean(watchedValues.first_name?.trim()),
      last_name:   Boolean(watchedValues.last_name?.trim()),
      phone:       Boolean(watchedValues.phone?.trim()),
      telegram_id: Boolean(watchedValues.telegram_id?.trim()),
      gender:      Boolean(watchedValues.gender),
      birth_date:  Boolean(watchedValues.birth_date),
      address:     Boolean(watchedValues.address?.trim()),
    };
    const filledCount = COMPLETION_FIELDS.reduce(
      (acc, f) => acc + (isFilled[f.key] ? 1 : 0),
      0,
    );
    const pct = Math.round((filledCount / TOTAL_WEIGHT) * 100);
    const missingSteps = COMPLETION_FIELDS.filter((f) => !isFilled[f.key]);
    return { pct, missingSteps, isFilled };
  }, [watchedValues, avatarUrl]);

  // Инициализируем prevCompletion при первом рендере, чтобы не пускать
  // конфетти у уже-100% юзера сразу после открытия страницы. Заодно
  // скрываем onboarding-карточку, если профиль и так заполнен.
  useEffect(() => {
    prevCompletionRef.current = completion.pct;
    if (completion.pct === 100) setMeterHidden(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") || email;

  const onSave = (values: FormValues) => {
    startTransition(async () => {
      const result = await updateOwnProfile({
        first_name:  values.first_name,
        last_name:   values.last_name,
        phone:       values.phone || null,
        telegram_id: values.telegram_id || null,
        gender:      values.gender || null,
        birth_date:  values.birth_date || null,
        address:     values.address || null,
      });
      if (result.error) { toast.error(result.error); return; }
      // Один тост: либо праздничный (с конфетти) если только что достигли 100%,
      // либо обычный «обновлено».
      if (completion.pct === 100 && prevCompletionRef.current < 100) {
        fireConfetti();
        toast.success("Профиль полностью заполнен!", { duration: 4000 });
        setMeterHidden(true);
      } else {
        toast.success("Профиль обновлён");
        // Если пользователь когда-то скрыл meter (был 100%) и теперь снова
        // что-то опустошил — показываем onboarding-карточку обратно.
        if (completion.pct < 100 && meterHidden) setMeterHidden(false);
      }
      prevCompletionRef.current = completion.pct;
    });
  };

  const submitAvatarModal = async () => {
    if (!photoFile) return;
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const path = `${profile.id}/avatar`;
      // 60s timeout — если Supabase storage не отвечает (типичный
      // симптом «зависает на загрузке файла»), показываем понятную
      // ошибку вместо вечного спиннера.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let uploadError: Error | null = null;
      try {
        const { error } = await supabase.storage
          .from("avatars")
          .upload(path, photoFile, {
            upsert: true,
            contentType: photoFile.type,
            // @ts-expect-error — supabase-js v2 поддерживает signal через
            // fetch-init; типы пока не покрывают это поле.
            signal: ctrl.signal,
          });
        if (error) uploadError = new Error(error.message);
      } catch (e) {
        uploadError = e instanceof Error ? e : new Error(String(e));
      } finally {
        clearTimeout(timer);
      }
      if (uploadError) {
        toast.error(
          ctrl.signal.aborted
            ? "Загрузка заняла больше минуты. Проверьте подключение и попробуйте снова."
            : translateError(uploadError.message),
        );
        return;
      }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const result = await updateOwnProfile({ avatar_url: newUrl });
      if (result.error) {
        toast.error(translateError(result.error));
        return;
      }
      setAvatarUrl(newUrl);
      setPhotoModalOpen(false);
      setPhotoFile(null);
      toast.success("Фото обновлено");
    } finally {
      // Гарантия: спиннер всегда снимается, даже если что-то выше throw'нуло.
      setUploadingAvatar(false);
    }
  };

  const handleEmailChange = async () => {
    const next = contactEmail.trim().toLowerCase();
    if (!next || next === email.toLowerCase()) return;
    setPendingEmailChange(true);
    // Custom flow вместо supabase.auth.updateUser({ email }) — GoTrue
    // emails у нас не настроены, поэтому шлём через свой mailer
    // (см. requestEmailChange + /auth/confirm-email-change).
    const result = await requestEmailChange(next);
    setPendingEmailChange(false);
    if (result.error) {
      toast.error(translateError(result.error));
      return;
    }
    toast.success(
      `На ${next} отправлено письмо с подтверждением. Перейдите по ссылке в письме, чтобы завершить смену.`,
      { duration: 7000 },
    );
  };

  return (
    <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
      {/* Welcome banner — показывается приглашённым сотрудникам, у которых
          ещё не заполнен профиль. Контролируется query param ?welcome=1 */}
      {welcomeMode && (
        <div className="rounded-[14px] border border-brand/20 bg-brand/5 p-5 flex items-start gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-brand/15 shrink-0">
            <PartyPopper className="w-5 h-5 text-brand" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground leading-tight">
              Добро пожаловать в команду!
            </h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Заполните профиль, чтобы коллеги могли вас узнать,
              а руководство — поздравить с днём рождения и быстро связаться.
              Это займёт минуту.
            </p>
          </div>
        </div>
      )}

      {/* Header — без аватара слева. Большое фото есть в первой секции формы. */}
      <div className="flex flex-col gap-1 min-w-0">
        <h1 className="text-[28px] font-bold tracking-tight leading-tight">
          Настройки профиля
        </h1>
        <p className="text-sm text-muted-foreground">
          Эти данные видят все работодатели в системе
        </p>
      </div>

      {/* Completion meter + friendly onboarding steps. Скрывается, как
          только юзер сохранил профиль на 100% — карточка-онбординг своё
          дело сделала и больше отвлекать не должна. */}
      {!meterHidden && (
        <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground leading-tight">
              Заполненность профиля
            </h2>
            <span
              className={`text-[15px] font-bold leading-none ${
                completion.pct === 100 ? "text-emerald-600" : "text-brand"
              }`}
            >
              {completion.pct}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                completion.pct === 100 ? "bg-emerald-500" : "bg-brand"
              }`}
              style={{ width: `${completion.pct}%` }}
            />
          </div>
          {completion.missingSteps.length > 0 && (
            <p className="text-[13px] text-muted-foreground leading-snug pt-1">
              {completion.missingSteps[0].hint}
            </p>
          )}
        </section>
      )}

      <form
        onSubmit={handleSubmit(onSave)}
        className="mx-auto w-full max-w-[720px] flex flex-col gap-5"
      >
        {/* Личные данные с фото */}
        <FormSection
          title="Личные данные"
          description="Фото, имя, фамилия, пол и дата рождения"
        >
          {/* Photo block */}
          <div className="flex flex-col items-center gap-3 pb-2">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-28 h-28 rounded-full object-cover bg-muted ring-1 ring-border"
                />
              ) : (
                <div className="w-28 h-28 rounded-full bg-muted flex items-center justify-center text-3xl font-semibold text-muted-foreground ring-1 ring-border">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                aria-label={avatarUrl ? "Изменить фото" : "Загрузить фото"}
              >
                <Camera className="w-5 h-5 text-white" />
              </button>
            </div>
            <div className="flex items-center gap-3 text-[12px] font-medium">
              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                className="text-brand hover:underline"
              >
                {avatarUrl ? "Изменить фото" : "Загрузить фото"}
              </button>
              {avatarUrl && (
                <>
                  <span className="text-border" aria-hidden>·</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await updateOwnProfile({ avatar_url: null });
                      if (result.error) { toast.error(result.error); return; }
                      setAvatarUrl(null);
                      toast.success("Фото удалено");
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Удалить
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name" className="text-[13px] font-medium">Имя</Label>
              <Input id="first_name" {...register("first_name")} />
              {errors.first_name && (
                <p className="text-xs text-destructive">{errors.first_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name" className="text-[13px] font-medium">Фамилия</Label>
              <Input id="last_name" {...register("last_name")} />
              {errors.last_name && (
                <p className="text-xs text-destructive">{errors.last_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium">Пол</Label>
              <Select
                defaultValue={profile.gender ?? ""}
                onValueChange={(v) => setValue("gender", v as "male" | "female" | "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Не указан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Мужской</SelectItem>
                  <SelectItem value="female">Женский</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birth_date" className="text-[13px] font-medium">
                Дата рождения
              </Label>
              <Input id="birth_date" type="date" {...register("birth_date")} />
            </div>
          </div>
        </FormSection>

        {/* Контакты */}
        <FormSection
          title="Контакты"
          description="Телефон, мессенджер, email и адрес проживания"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-[13px] font-medium">Телефон</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+7 (999) 000-00-00"
                {...register("phone")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium inline-flex items-center gap-2">
                Email
                {!emailConfirmed && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-[10px] font-medium text-amber-700 dark:text-amber-300 leading-none">
                    Не подтверждён
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="employee@example.com"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleEmailChange}
                  disabled={
                    pendingEmailChange ||
                    !contactEmail.trim() ||
                    contactEmail.trim().toLowerCase() === email.toLowerCase()
                  }
                  className="shrink-0"
                >
                  {pendingEmailChange && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Сменить
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telegram_id" className="text-[13px] font-medium">Telegram ID</Label>
              <Input
                id="telegram_id"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="123456789"
                {...register("telegram_id")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address" className="text-[13px] font-medium">Адрес проживания</Label>
              <Input
                id="address"
                placeholder="г. Москва, ул. Примерная, 1"
                {...register("address")}
              />
            </div>
          </div>
        </FormSection>

        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </form>

      {/* Photo upload modal */}
      <Dialog
        open={photoModalOpen}
        onOpenChange={(open) => {
          setPhotoModalOpen(open);
          if (!open) setPhotoFile(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Фото профиля</DialogTitle>
            <DialogDescription>
              JPG или PNG. Максимальный размер — 5 МБ.
            </DialogDescription>
          </DialogHeader>

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setPhotoFile(f);
            }}
            className="flex flex-col items-center justify-center gap-2 h-44 rounded-xl border border-dashed bg-muted/30 hover:bg-muted/60 transition-colors px-4 text-center"
          >
            {photoFile ? (
              <>
                <FileText className="w-8 h-8 text-brand" />
                <p className="text-[13px] font-medium text-foreground truncate max-w-full">
                  {photoFile.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {(photoFile.size / 1024 / 1024).toFixed(2)} МБ — нажмите, чтобы выбрать другой файл
                </p>
              </>
            ) : (
              <>
                <Upload className="w-7 h-7 text-muted-foreground/60" />
                <p className="text-[13px] text-muted-foreground">
                  Перетащите файл сюда или нажмите для выбора
                </p>
                <p className="text-[11px] text-muted-foreground/70">JPG, PNG до 5 МБ</p>
              </>
            )}
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPhotoFile(f);
              e.target.value = "";
            }}
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPhotoModalOpen(false)}
              disabled={uploadingAvatar}
            >
              Отмена
            </Button>
            <Button
              onClick={submitAvatarModal}
              disabled={!photoFile || uploadingAvatar}
            >
              {uploadingAvatar && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Загрузить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
