/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Camera, FileImage, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { updateStaffProfile, fireStaff } from "../../actions";
import type { FullStaffProfile } from "../../actions";

const schema = z.object({
  first_name:          z.string().min(1, "Обязательное поле"),
  last_name:           z.string().min(1, "Обязательное поле"),
  phone:               z.string().optional(),
  telegram_id:         z.string().optional(),
  gender:              z.enum(["male", "female", ""]).optional(),
  birth_date:          z.string().optional(),
  address:             z.string().optional(),
  employment_date:     z.string().min(1, "Укажите дату трудоустройства"),
  medical_book_number: z.string().optional(),
  medical_book_date:   z.string().optional(),
  comment:             z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Role = { id: string; name: string; code: string };

interface Props {
  profile:  FullStaffProfile;
  email:    string;
  uvrId:    string;
  roleName: string;
  venueId:  string;
  roles:    Role[];
  canEdit:  boolean;
  isMe:     boolean;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
      {children}
    </p>
  );
}

export function StaffDetailPage({
  profile,
  email,
  uvrId,
  roleName,
  venueId,
  canEdit,
  isMe,
}: Props) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl]           = useState<string | null>(profile.avatar_url);
  const [passportPhotos, setPassportPhotos] = useState<string[]>(profile.passport_photos ?? []);
  const [signedUrls, setSignedUrls]         = useState<Record<string, string>>({});
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingDocs, setUploadingDocs]     = useState(false);
  const [confirmFire, setConfirmFire]         = useState(false);
  const [isPending, startTransition]        = useTransition();

  const avatarInputRef   = useRef<HTMLInputElement>(null);
  const passportInputRef = useRef<HTMLInputElement>(null);

  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") || email;

  const { register, handleSubmit, setValue, formState: { errors } } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: {
        first_name:          profile.first_name ?? "",
        last_name:           profile.last_name ?? "",
        phone:               profile.phone ?? "",
        telegram_id:         profile.telegram_id ?? "",
        gender:              (profile.gender as "male" | "female" | "") ?? "",
        birth_date:          profile.birth_date ?? "",
        address:             profile.address ?? "",
        employment_date:     profile.employment_date ?? "",
        medical_book_number: profile.medical_book_number ?? "",
        medical_book_date:   profile.medical_book_date ?? "",
        comment:             profile.comment ?? "",
      },
    });

  // Generate signed URLs for passport photos
  useEffect(() => {
    if (!passportPhotos.length) { setSignedUrls({}); return; }
    const supabase = createClient();
    Promise.all(
      passportPhotos.map(async (path) => {
        const { data } = await supabase.storage
          .from("staff-documents")
          .createSignedUrl(path, 3600);
        return { path, url: data?.signedUrl ?? "" };
      })
    ).then((results) =>
      setSignedUrls(Object.fromEntries(results.map((r) => [r.path, r.url])))
    );
  }, [passportPhotos]);

  const onSave = (values: FormValues) => {
    startTransition(async () => {
      const result = await updateStaffProfile(profile.id, {
        first_name:          values.first_name,
        last_name:           values.last_name,
        phone:               values.phone || null,
        telegram_id:         values.telegram_id || null,
        gender:              values.gender || null,
        birth_date:          values.birth_date || null,
        address:             values.address || null,
        employment_date:     values.employment_date,
        medical_book_number: values.medical_book_number || null,
        medical_book_date:   values.medical_book_date || null,
        comment:             values.comment || null,
      });
      if (result.error) { toast.error(result.error); return; }
      toast.success("Данные сохранены");
    });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const supabase = createClient();
    const path = `${profile.id}/avatar`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) { toast.error(error.message); setUploadingAvatar(false); return; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await updateStaffProfile(profile.id, { avatar_url: newUrl });
    setAvatarUrl(newUrl);
    setUploadingAvatar(false);
    toast.success("Фото обновлено");
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const handlePassportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploadingDocs(true);
    const supabase = createClient();
    const newPaths: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${venueId}/${profile.id}/passport/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage
        .from("staff-documents")
        .upload(path, file, { contentType: file.type });
      if (!error) newPaths.push(path);
      else toast.error(`Ошибка загрузки ${file.name}: ${error.message}`);
    }
    const updated = [...passportPhotos, ...newPaths];
    await updateStaffProfile(profile.id, { passport_photos: updated });
    setPassportPhotos(updated);
    setUploadingDocs(false);
    if (passportInputRef.current) passportInputRef.current.value = "";
    if (newPaths.length) toast.success("Фото добавлено");
  };

  const handleDeletePassportPhoto = async (path: string) => {
    const supabase = createClient();
    await supabase.storage.from("staff-documents").remove([path]);
    const updated = passportPhotos.filter((p) => p !== path);
    await updateStaffProfile(profile.id, { passport_photos: updated });
    setPassportPhotos(updated);
    toast.success("Фото удалено");
  };

  const handleFire = () => {
    startTransition(async () => {
      const result = await fireStaff(uvrId);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Сотрудник уволен");
      router.push("/staff");
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 w-full">
      {/* ── Sticky header ── */}
      <div className="flex items-center justify-between mb-8">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/staff")}
        >
          <ArrowLeft className="w-4 h-4" />
          Сотрудники
        </Button>
        {canEdit && (
          <Button size="sm" disabled={isPending} onClick={handleSubmit(onSave)}>
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Сохранить
          </Button>
        )}
      </div>

      {/* ── Avatar + name ── */}
      <div className="flex items-center gap-5 mb-8">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-2xl font-semibold text-muted-foreground">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
              >
                {uploadingAvatar
                  ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                  : <Camera className="w-5 h-5 text-white" />
                }
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          <p className="text-muted-foreground">{roleName}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSave)} className="space-y-8">
        {/* ── Личные данные ── */}
        <div>
          <SectionTitle>Личные данные</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Имя</Label>
              <Input
                id="first_name"
                {...register("first_name")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
              {errors.first_name && (
                <p className="text-xs text-destructive">{errors.first_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Фамилия</Label>
              <Input
                id="last_name"
                {...register("last_name")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
              {errors.last_name && (
                <p className="text-xs text-destructive">{errors.last_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Пол</Label>
              {canEdit ? (
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
              ) : (
                <Input
                  value={
                    profile.gender === "male" ? "Мужской"
                    : profile.gender === "female" ? "Женский"
                    : ""
                  }
                  readOnly
                  className="bg-muted/50"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">Дата рождения</Label>
              <Input
                id="birth_date"
                type="date"
                {...register("birth_date")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── Контакты ── */}
        <div>
          <SectionTitle>Контакты</SectionTitle>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Телефон</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+7 (999) 000-00-00"
                {...register("phone")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} readOnly className="bg-muted/50 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telegram_id">Telegram</Label>
              <Input
                id="telegram_id"
                placeholder="@username"
                {...register("telegram_id")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── Адрес и трудоустройство ── */}
        <div>
          <SectionTitle>Адрес и трудоустройство</SectionTitle>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="address">Адрес проживания</Label>
              <Input
                id="address"
                placeholder="г. Москва, ул. Примерная, 1"
                {...register("address")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employment_date">Дата трудоустройства *</Label>
              <Input
                id="employment_date"
                type="date"
                {...register("employment_date")}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
              />
              {errors.employment_date && (
                <p className="text-xs text-destructive">{errors.employment_date.message}</p>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* ── Документы ── */}
        <div>
          <SectionTitle>Документы</SectionTitle>

          {/* Medical book */}
          <div className="mb-6">
            <p className="text-sm font-medium mb-3">Медицинская книжка</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="medical_book_number">Номер</Label>
                <Input
                  id="medical_book_number"
                  placeholder="МК-0000000"
                  {...register("medical_book_number")}
                  readOnly={!canEdit}
                  className={!canEdit ? "bg-muted/50" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="medical_book_date">Дата осмотра</Label>
                <Input
                  id="medical_book_date"
                  type="date"
                  {...register("medical_book_date")}
                  readOnly={!canEdit}
                  className={!canEdit ? "bg-muted/50" : ""}
                />
              </div>
            </div>
          </div>

          {/* Passport photos */}
          <div>
            <p className="text-sm font-medium mb-3">Фото паспорта</p>
            <div className="grid grid-cols-4 gap-3">
              {passportPhotos.map((path) => (
                <div
                  key={path}
                  className="relative group aspect-square rounded-lg overflow-hidden border bg-muted"
                >
                  {signedUrls[path] ? (
                    <img
                      src={signedUrls[path]}
                      alt="Паспорт"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full">
                      <FileImage className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDeletePassportPhoto(path)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => passportInputRef.current?.click()}
                  disabled={uploadingDocs}
                  className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-xs"
                >
                  {uploadingDocs
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <><FileImage className="w-5 h-5" /><span>Добавить</span></>
                  }
                </button>
              )}
            </div>
            {canEdit && (
              <input
                ref={passportInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                multiple
                className="hidden"
                onChange={handlePassportUpload}
              />
            )}
          </div>
        </div>

        {/* ── Комментарий ── */}
        <Separator />
        <div>
          <SectionTitle>Комментарий</SectionTitle>
          <Textarea
            {...register("comment")}
            readOnly={!canEdit}
            className={!canEdit ? "bg-muted/50" : ""}
            placeholder="Заметки о сотруднике..."
            rows={3}
          />
        </div>

        {/* ── Fire action ── */}
        {canEdit && !isMe && (
          <>
            <Separator />
            <div>
              {confirmFire ? (
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    disabled={isPending}
                    onClick={() => { setConfirmFire(false); handleFire(); }}
                  >
                    Подтвердить увольнение
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setConfirmFire(false)}
                  >
                    Отмена
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmFire(true)}
                >
                  Уволить сотрудника
                </Button>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
