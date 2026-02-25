/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Camera, FileImage, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { createClient } from "@/lib/supabase/client";
import { getStaffProfile, updateStaffProfile } from "../actions";
import type { StaffMember, FullStaffProfile } from "../actions";

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
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  staff:          StaffMember;
  email:          string;
  venueId:        string;
  canEdit:        boolean;
  isMe:           boolean;
  onFire:         (uvrId: string) => void;
}

function Avatar({
  url,
  name,
  size = 80,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (url) {
    return <img src={url} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="rounded-full bg-muted flex items-center justify-center text-muted-foreground font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-3">
      {children}
    </p>
  );
}

export function StaffDetailSheet({
  open,
  onOpenChange,
  staff,
  email,
  venueId,
  canEdit,
  isMe,
  onFire,
}: Props) {
  const [profile, setProfile]             = useState<FullStaffProfile | null>(null);
  const [loading, setLoading]             = useState(false);
  const [avatarUrl, setAvatarUrl]         = useState<string | null>(null);
  const [passportPhotos, setPassportPhotos] = useState<string[]>([]);
  const [signedUrls, setSignedUrls]       = useState<Record<string, string>>({});
  const [uploadingAvatar, setUploadingAvatar]   = useState(false);
  const [uploadingDocs, setUploadingDocs]       = useState(false);
  const [confirmFire, setConfirmFire]           = useState(false);
  const [isPending, startTransition]      = useTransition();

  const avatarInputRef    = useRef<HTMLInputElement>(null);
  const passportInputRef  = useRef<HTMLInputElement>(null);

  const displayName = [staff.first_name, staff.last_name].filter(Boolean).join(" ") || email;

  const { register, handleSubmit, reset, setValue, formState: { errors } } =
    useForm<FormValues>({ resolver: zodResolver(schema) });

  // Fetch full profile when sheet opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getStaffProfile(staff.user_id).then((data) => {
      setLoading(false);
      if (!data) return;
      setProfile(data);
      setAvatarUrl(data.avatar_url);
      setPassportPhotos(data.passport_photos ?? []);
      reset({
        first_name:          data.first_name ?? "",
        last_name:           data.last_name ?? "",
        phone:               data.phone ?? "",
        telegram_id:         data.telegram_id ?? "",
        gender:              (data.gender as "male" | "female" | "") ?? "",
        birth_date:          data.birth_date ?? "",
        address:             data.address ?? "",
        employment_date:     data.employment_date ?? "",
        medical_book_number: data.medical_book_number ?? "",
        medical_book_date:   data.medical_book_date ?? "",
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff.user_id]);

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
      const result = await updateStaffProfile(staff.user_id, {
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
    const path = `${staff.user_id}/avatar`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) { toast.error(error.message); setUploadingAvatar(false); return; }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    // Add cache-busting so the browser shows the new image
    const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await updateStaffProfile(staff.user_id, { avatar_url: newUrl });
    setAvatarUrl(newUrl);
    setUploadingAvatar(false);
    toast.success("Фото обновлено");
    // Reset input
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const handlePassportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploadingDocs(true);
    const supabase = createClient();
    const newPaths: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${venueId}/${staff.user_id}/passport/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage
        .from("staff-documents")
        .upload(path, file, { contentType: file.type });
      if (!error) newPaths.push(path);
      else toast.error(`Ошибка загрузки ${file.name}: ${error.message}`);
    }
    const updated = [...passportPhotos, ...newPaths];
    await updateStaffProfile(staff.user_id, { passport_photos: updated });
    setPassportPhotos(updated);
    setUploadingDocs(false);
    if (passportInputRef.current) passportInputRef.current.value = "";
    if (newPaths.length) toast.success("Фото добавлено");
  };

  const handleDeletePassportPhoto = async (path: string) => {
    const supabase = createClient();
    await supabase.storage.from("staff-documents").remove([path]);
    const updated = passportPhotos.filter((p) => p !== path);
    await updateStaffProfile(staff.user_id, { passport_photos: updated });
    setPassportPhotos(updated);
    toast.success("Фото удалено");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Карточка сотрудника</SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && (
          <form onSubmit={handleSubmit(onSave)} className="space-y-6 pb-8">
            {/* ── Avatar ── */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar url={avatarUrl} name={displayName} size={72} />
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
                <p className="font-semibold text-base">{displayName}</p>
                <p className="text-sm text-muted-foreground">{staff.role_name}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>
            </div>

            <Separator />

            {/* ── Личные данные ── */}
            <div>
              <SectionTitle>Личные данные</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
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
                      defaultValue={profile?.gender ?? ""}
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
                      value={profile?.gender === "male" ? "Мужской" : profile?.gender === "female" ? "Женский" : ""}
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
              <div className="space-y-3">
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
              <div className="space-y-3">
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
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Медицинская книжка</p>
                <div className="grid grid-cols-2 gap-3">
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
                <p className="text-sm font-medium mb-2">Фото паспорта</p>
                <div className="grid grid-cols-3 gap-2">
                  {passportPhotos.map((path) => (
                    <div key={path} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
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
                      className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-xs"
                    >
                      {uploadingDocs
                        ? <Loader2 className="w-5 h-5 animate-spin" />
                        : <>
                            <FileImage className="w-5 h-5" />
                            <span>Добавить</span>
                          </>
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

            {/* ── Footer ── */}
            <Separator />

            {canEdit && (
              <div className="space-y-3">
                {/* Save / Close */}
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => onOpenChange(false)}
                  >
                    Закрыть
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isPending}>
                    {isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Сохранить
                  </Button>
                </div>

                {/* Fire action — not shown for yourself */}
                {!isMe && (
                  confirmFire ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        className="flex-1 text-sm"
                        disabled={isPending}
                        onClick={() => { setConfirmFire(false); onFire(staff.uvr_id); }}
                      >
                        Подтвердить увольнение
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 text-sm"
                        onClick={() => setConfirmFire(false)}
                      >
                        Отмена
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 text-sm"
                      onClick={() => setConfirmFire(true)}
                    >
                      Уволить сотрудника
                    </Button>
                  )
                )}
              </div>
            )}

            {!canEdit && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                Закрыть
              </Button>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
