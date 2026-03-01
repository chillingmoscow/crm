"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadLogo } from "../actions";
import { saveProfile } from "../actions";

export interface ProfileInitialData {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  gender: string | null;
  birthDate: string | null;
  phone: string | null;
  telegramId: string | null;
  address: string | null;
}

const schema = z.object({
  firstName: z.string().min(1, "Введите имя"),
  lastName: z.string().min(1, "Введите фамилию"),
  phone: z.string().min(1, "Введите телефон"),
  telegramId: z.string().optional(),
  address: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  birthDate: z.string().optional(),
});

type Form = z.infer<typeof schema>;

interface Props {
  initial: ProfileInitialData;
  onNext: () => void;
}

const GENDER_OPTIONS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
  { value: "other", label: "Другой" },
] as const;

export function StepProfile({ initial, onNext }: Props) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial.photoUrl);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial.photoUrl);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      phone: initial.phone ?? "",
      telegramId: initial.telegramId ?? "",
      address: initial.address ?? "",
      gender: (initial.gender as "male" | "female" | "other") ?? undefined,
      birthDate: initial.birthDate ?? "",
    },
  });

  const selectedGender = watch("gender");

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
      setPhotoPreview(photoUrl);
      return;
    }
    setPhotoUrl(url);
  };

  const onSubmit = async (values: Form) => {
    const { error } = await saveProfile({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      telegramId: values.telegramId ?? null,
      address: values.address ?? null,
      gender: values.gender ?? null,
      birthDate: values.birthDate ?? null,
      photoUrl,
    });

    if (error) {
      toast.error(error);
      return;
    }

    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ваш профиль</CardTitle>
        <CardDescription>Заполните информацию о себе</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {/* Фото */}
          <div className="space-y-2">
            <Label>Фото</Label>
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/50 transition-colors relative group"
                onClick={() => fileRef.current?.click()}
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt="photo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  Загрузить
                </Button>
                {photoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPhotoPreview(null);
                      setPhotoUrl(null);
                    }}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Удалить
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">PNG, JPG до 5 МБ</p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Имя и фамилия */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">Имя *</Label>
              <Input
                id="firstName"
                placeholder="Иван"
                {...register("firstName")}
              />
              {errors.firstName && (
                <p className="text-sm text-destructive">{errors.firstName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Фамилия *</Label>
              <Input
                id="lastName"
                placeholder="Иванов"
                {...register("lastName")}
              />
              {errors.lastName && (
                <p className="text-sm text-destructive">{errors.lastName.message}</p>
              )}
            </div>
          </div>

          {/* Пол */}
          <div className="space-y-2">
            <Label>Пол</Label>
            <div className="flex gap-2">
              {GENDER_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  variant={selectedGender === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setValue("gender", opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Дата рождения */}
          <div className="space-y-2">
            <Label htmlFor="birthDate">Дата рождения</Label>
            <Input
              id="birthDate"
              type="date"
              {...register("birthDate")}
            />
          </div>

          {/* Телефон */}
          <div className="space-y-2">
            <Label htmlFor="phone">Телефон *</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+7 999 123 45 67"
              {...register("phone")}
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone.message}</p>
            )}
          </div>

          {/* Telegram */}
          <div className="space-y-2">
            <Label htmlFor="telegramId">Telegram</Label>
            <Input
              id="telegramId"
              placeholder="@username"
              {...register("telegramId")}
            />
          </div>

          {/* Адрес */}
          <div className="space-y-2">
            <Label htmlFor="address">Адрес</Label>
            <Input
              id="address"
              placeholder="Город, улица, дом"
              {...register("address")}
            />
          </div>
        </CardContent>

        <div className="px-6 pb-6">
          <Button type="submit" className="w-full" disabled={isSubmitting || uploading}>
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Готово"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
