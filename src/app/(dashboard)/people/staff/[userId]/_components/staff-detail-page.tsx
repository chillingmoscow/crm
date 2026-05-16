/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Camera,
  ChevronLeft,
  FileText,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { createClient } from "@/lib/supabase/client";
import { translateError } from "@/lib/i18n/translate-error";
import type { AuditEvent } from "@/lib/audit/list";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import {
  fireStaff,
  restoreStaff,
  setImportedStaffEmailAndInvite,
  updateStaffProfile,
  updateStaffAccountDetails,
  updateStaffTerminalPin,
} from "../../actions";
import type { StaffProfile, StaffAccountDetails } from "../../actions";

const schema = z.object({
  // Тир 1+2 — personal (profiles)
  first_name:  z.string().min(1, "Обязательное поле"),
  last_name:   z.string().min(1, "Обязательное поле"),
  phone:       z.string().optional(),
  telegram_id: z.string().optional(),
  gender:      z.enum(["male", "female", ""]).optional(),
  birth_date:  z.string().optional(),
  address:     z.string().optional(),

  // Тир 3 — account-scoped (staff_account_details)
  employment_date:     z.string().min(1, "Укажите дату трудоустройства"),
  medical_book_number: z.string().optional(),
  medical_book_date:   z.string().optional(),
  comment:             z.string().optional(),

  // UVR (venue-specific)
  terminal_pin: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Role = { id: string; name: string; code: string };

type TabKey = "main" | "documents" | "history" | "activity" | "danger";

interface Props {
  profile:        StaffProfile;
  accountDetails: StaffAccountDetails;
  accountId:      string;
  email:          string;
  uvrId:          string;
  roleId:         string;
  roleName:       string;
  departmentId:   string | null;
  departmentName: string | null;
  terminalPin:    string | null;
  venueId:        string;
  roles:          Role[];
  canEdit:        boolean;
  isFired:        boolean;
  firedAt:        string | null;
  firedReason:    string | null;
  isMe:           boolean;
  importedFromQuickResto: boolean;
  joinedAt:       string | null;
  userCreatedAt:  string | null;
  /** auth.users.email_confirmed_at !== null. Если false — приглашение
   *  отправлено, но юзер ещё не подтвердил email. Админ может перепослать
   *  на другой адрес, если ошибся. */
  emailConfirmed: boolean;
  /** Видит ли текущий юзер табы «Журнал» / «Активность». Проверка
   *  `org.view_audit` выполняется на сервере; здесь — флаг для
   *  conditional render'а. */
  canViewAudit: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  initialActivityEvents: AuditEvent[];
  initialActivityHasMore: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

function FormSection({
  title,
  description,
  locked,
  children,
}: {
  title: string;
  description?: string;
  /** Если задан — рядом с заголовком секции рисуется иконка-замочек
   * с tooltip'ом. tone:
   *   - "locked" — данными управляет сотрудник, для админа read-only
   *   - "info"   — placeholder-юзер, админ временно может править */
  locked?: { tone: "locked" | "info" };
  children: React.ReactNode;
}) {
  const lockMessage = locked?.tone === "locked"
    ? "Этими данными управляет сотрудник через свой профиль. Чтобы поменять — попросите его обновить."
    : "Сотрудник пока не зарегистрирован. Заполните за него — позже он сможет обновлять сам.";
  return (
    <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground leading-tight">
            {title}
          </h2>
          {locked && (
            <TooltipProvider delayDuration={500} skipDelayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center text-muted-foreground/70 hover:text-muted-foreground cursor-help">
                    <Lock className="w-3 h-3" aria-label="Раздел с ограничением" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px] text-[12px]">
                  {lockMessage}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
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

// ── Component ─────────────────────────────────────────────────

export function StaffDetailPage({
  profile,
  accountDetails,
  accountId,
  email,
  uvrId,
  roleId,
  roleName,
  departmentId,
  departmentName,
  terminalPin,
  venueId,
  canEdit: canEditProp,
  isFired,
  firedAt,
  firedReason,
  isMe,
  importedFromQuickResto,
  joinedAt,
  userCreatedAt,
  emailConfirmed,
  canViewAudit,
  initialAuditEvents,
  initialAuditHasMore,
  initialActivityEvents,
  initialActivityHasMore,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [avatarUrl, setAvatarUrl]             = useState<string | null>(profile.avatar_url);
  const [passportPhotos, setPassportPhotos]   = useState<string[]>(accountDetails.passport_photos ?? []);
  const [signedUrls, setSignedUrls]           = useState<Record<string, string>>({});
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingDocs, setUploadingDocs]     = useState(false);
  const [confirmFire, setConfirmFire]         = useState(false);
  const [fireReason, setFireReason]           = useState("");
  const [isPending, startTransition]          = useTransition();
  const [isInvitePending, startInviteTransition] = useTransition();
  // Если у юзера technical placeholder email — показываем пустое поле,
  // админ впишет реальный для invite. Иначе — реальный email юзера.
  const [contactEmail, setContactEmail]       = useState(
    email.toLowerCase().endsWith("@import.local") ? "" : email,
  );

  // Modals
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoFile, setPhotoFile]           = useState<File | null>(null);
  const [docModalOpen, setDocModalOpen]     = useState(false);
  const [docName, setDocName]               = useState("");
  const [docFile, setDocFile]               = useState<File | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);

  // Статус юзера определяет, кто ведёт его данные:
  //   placeholder — сотрудник без аккаунта (QR-импорт или ручное создание),
  //                 email = *@import.local. Админ ведёт всё за него.
  //   pending     — приглашение отправлено, email реальный, но юзер ещё
  //                 не подтвердил его (auth.users.email_confirmed_at = null).
  //                 Админ ещё может поменять email и переслать — на случай
  //                 опечатки.
  //   registered  — юзер подтвердил email хотя бы раз. С этого момента
  //                 он сам управляет своим профилем.
  const isPlaceholderUser = email.toLowerCase().endsWith("@import.local");
  const isPendingInvite   = !isPlaceholderUser && !emailConfirmed;
  const isRegisteredUser  = !isPlaceholderUser && emailConfirmed;

  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    (isPlaceholderUser ? "Без имени" : contactEmail);

  // Уволенный сотрудник — карточку можно открыть и просмотреть, но
  // редактировать поля нельзя (кроме явных действий типа «Восстановить»).
  // Поэтому маскируем canEdit для всей формы; восстановление и просмотр
  // используют canManageStaff (исходный prop).
  const canManageStaff = canEditProp;
  const canEdit = canEditProp && !isFired;

  // Email-поле и кнопку «Пригласить»/«Изменить и переслать» админ видит,
  // пока сотрудник не подтвердил email. После — read-only.
  const canManageImportedInvite =
    (isPlaceholderUser || isPendingInvite) && canEdit && !isMe;

  // Личные поля редактируются админом только пока юзер не зарегистрирован
  // (placeholder ИЛИ pending invite). Как только сотрудник подтвердил email
  // и вошёл в систему — он сам управляет профилем.
  const canEditPersonal = canEdit && !isRegisteredUser;

  const { register, handleSubmit, setValue, control, reset, formState: { errors } } =
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
        employment_date:     accountDetails.employment_date ?? "",
        medical_book_number: accountDetails.medical_book_number ?? "",
        medical_book_date:   accountDetails.medical_book_date ?? "",
        comment:             accountDetails.comment ?? "",
        terminal_pin:        terminalPin ?? "",
      },
    });

  // Синхронизация формы с сервером после router.refresh() / window.reload.
  // Без этого useForm защёлкивается на defaultValues из первого рендера, и
  // когда parent server-component возвращает свежие props после save —
  // форма продолжает показывать старые значения. Зависимости — те же
  // primitive-поля, которые мы кладём в defaultValues; ref-ы (registers)
  // не нужны.
  useEffect(() => {
    reset({
      first_name:          profile.first_name ?? "",
      last_name:           profile.last_name ?? "",
      phone:               profile.phone ?? "",
      telegram_id:         profile.telegram_id ?? "",
      gender:              (profile.gender as "male" | "female" | "") ?? "",
      birth_date:          profile.birth_date ?? "",
      address:             profile.address ?? "",
      employment_date:     accountDetails.employment_date ?? "",
      medical_book_number: accountDetails.medical_book_number ?? "",
      medical_book_date:   accountDetails.medical_book_date ?? "",
      comment:             accountDetails.comment ?? "",
      terminal_pin:        terminalPin ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile.first_name,
    profile.last_name,
    profile.phone,
    profile.telegram_id,
    profile.gender,
    profile.birth_date,
    profile.address,
    accountDetails.employment_date,
    accountDetails.medical_book_number,
    accountDetails.medical_book_date,
    accountDetails.comment,
    terminalPin,
  ]);

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

  // Какие schema-поля лежат на каком табе. Используется в onValidationError
  // чтобы переключить юзера на нужный таб, если zod-валидация упала на
  // полях невидимого таба (раньше клик «Сохранить» просто не давал
  // никакого фидбэка — silent failure).
  const FIELD_TAB: Record<keyof FormValues, TabKey> = {
    first_name:           "main",
    last_name:            "main",
    phone:                "main",
    telegram_id:          "main",
    gender:               "main",
    birth_date:           "main",
    address:              "main",
    employment_date:      "main",
    terminal_pin:         "main",
    medical_book_number:  "documents",
    medical_book_date:    "documents",
    comment:              "main",
  };

  const onValidationError = (formErrors: typeof errors) => {
    const firstField = Object.keys(formErrors)[0] as keyof FormValues | undefined;
    if (!firstField) return;
    const targetTab = FIELD_TAB[firstField] ?? "main";
    if (targetTab !== activeTab) setActiveTab(targetTab);
    const message =
      (formErrors[firstField] as { message?: string } | undefined)?.message ??
      "Заполните обязательные поля";
    toast.error(message);
  };

  // Save: три параллельных action'а.
  // - updateStaffProfile — личные поля (тир 1+2)
  // - updateStaffAccountDetails — HR-данные аккаунта (тир 3)
  // - updateStaffTerminalPin — UVR (venue-specific)
  // Если упал хоть один, показываем toast и не делаем общий «Сохранено».
  const onSave = (values: FormValues) => {
    startTransition(async () => {
      // Личные поля пишем только если у нас на это есть право (placeholder-юзер).
      // Иначе их обновляет сам сотрудник через свой профиль.
      const profilePromise = canEditPersonal
        ? updateStaffProfile(profile.id, {
            first_name:  values.first_name,
            last_name:   values.last_name,
            phone:       values.phone || null,
            telegram_id: values.telegram_id || null,
            gender:      values.gender || null,
            birth_date:  values.birth_date || null,
            address:     values.address || null,
          })
        : Promise.resolve({ error: null });

      const [profileResult, detailsResult, pinResult] = await Promise.all([
        profilePromise,
        updateStaffAccountDetails(profile.id, accountId, {
          employment_date:     values.employment_date,
          medical_book_number: values.medical_book_number || null,
          medical_book_date:   values.medical_book_date || null,
          comment:             values.comment || null,
        }),
        updateStaffTerminalPin(uvrId, values.terminal_pin || null),
      ]);

      const errors = [profileResult.error, detailsResult.error, pinResult.error]
        .filter(Boolean) as string[];
      if (errors.length > 0) {
        toast.error(errors.join(" · "));
        return;
      }
      toast.success("Данные сохранены");
      router.refresh();
    });
  };

  const submitAvatarModal = async () => {
    if (!photoFile) return;
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const path = `${profile.id}/avatar`;
      // 60s timeout — защита от «зависает на загрузке» (Supabase storage
      // не отвечает): юзер получит понятный тост вместо вечного спиннера.
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
      const result = await updateStaffProfile(profile.id, { avatar_url: newUrl });
      if (result.error) {
        toast.error(translateError(result.error));
        return;
      }
      setAvatarUrl(newUrl);
      setPhotoModalOpen(false);
      setPhotoFile(null);
      toast.success("Фото обновлено");
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Имя документа кодируется в filename: ${ts}__${encName}__${origFile}.
  const submitDocModal = async () => {
    if (!docFile) return;
    const trimmedName = docName.trim();
    if (!trimmedName) {
      toast.error("Укажите название документа");
      return;
    }
    setUploadingDocs(true);
    const supabase = createClient();
    const ts = Date.now();
    const safeName = encodeURIComponent(trimmedName);
    const filename = `${ts}__${safeName}__${docFile.name}`;
    const path = `${venueId}/${profile.id}/passport/${filename}`;
    const { error } = await supabase.storage
      .from("staff-documents")
      .upload(path, docFile, { contentType: docFile.type });
    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
      setUploadingDocs(false);
      return;
    }
    const updated = [...passportPhotos, path];
    const result = await updateStaffAccountDetails(profile.id, accountId, {
      passport_photos: updated,
    });
    if (result.error) {
      toast.error(result.error);
      setUploadingDocs(false);
      return;
    }
    setPassportPhotos(updated);
    setUploadingDocs(false);
    setDocModalOpen(false);
    setDocName("");
    setDocFile(null);
    toast.success("Документ добавлен");
  };

  const handleDeletePassportPhoto = async (path: string) => {
    const supabase = createClient();
    await supabase.storage.from("staff-documents").remove([path]);
    const updated = passportPhotos.filter((p) => p !== path);
    const result = await updateStaffAccountDetails(profile.id, accountId, {
      passport_photos: updated,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setPassportPhotos(updated);
    toast.success("Документ удалён");
  };

  const handleFire = () => {
    const reason = fireReason.trim();
    if (!reason) {
      toast.error("Укажите причину увольнения");
      return;
    }
    startTransition(async () => {
      const result = await fireStaff(uvrId, reason);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Сотрудник уволен");
      router.push("/people/staff");
    });
  };

  const handleInviteImported = () => {
    if (!canManageImportedInvite) return;

    startInviteTransition(async () => {
      // Для placeholder-юзеров всегда нужно установить реальный email + invite.
      // (Старый ветка с inviteImportedStaffByCurrentEmail работала с
      // QR-импортированными у которых был «случайно» реальный email — но в
      // новой модели это редкий кейс, флоу одинаковый.)
      const result = await setImportedStaffEmailAndInvite({
        userId: profile.id,
        email: contactEmail,
        roleId,
        venueId,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Приглашение отправлено на ${contactEmail}`);
      router.refresh();
    });
  };

  // Парсит filename storage-пути:
  //   `${ts}__${encName}__${origFilename}` → user-introduced name (новый формат)
  //   `${ts}_${origFilename}` или `origFilename` → fallback на имя файла
  const parseDocPath = (path: string): { name: string; uploadedAt: string | null } => {
    const last = path.split("/").pop() ?? path;
    const newFormat = last.match(/^(\d+)__([^_]+)__(.+)$/);
    if (newFormat) {
      const ts = Number(newFormat[1]);
      let displayName = "";
      try { displayName = decodeURIComponent(newFormat[2]); } catch { displayName = newFormat[3]; }
      return {
        name: displayName || newFormat[3],
        uploadedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      };
    }
    const legacy = last.match(/^(\d+)_(.+)$/);
    if (legacy) {
      const ts = Number(legacy[1]);
      return {
        name: legacy[2],
        uploadedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      };
    }
    return { name: last, uploadedAt: null };
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <Link
          href="/people/staff"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Сотрудники
        </Link>
      </PageBreadcrumb>

      <PageHeaderActions>
        {isFired && canManageStaff && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              startTransition(async () => {
                const result = await restoreStaff(uvrId);
                if (result.error) {
                  toast.error(translateError(result.error));
                  return;
                }
                toast.success("Сотрудник восстановлен");
                router.refresh();
              });
            }}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Восстановить
          </Button>
        )}
        <EntityInfoPopover
          title="О сотруднике"
          id={profile.id}
          createdAt={userCreatedAt}
          createdByName={null}
          updatedAt={joinedAt}
          updatedByName={null}
        />
      </PageHeaderActions>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        {/* Header — мини-аватар 56px + имя + бейджи. Крупное фото вынесено в
            первую секцию таба «Основное» (см. ниже), чтобы было видно. */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-14 h-14 rounded-full object-cover bg-muted"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-xl font-semibold text-muted-foreground">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight leading-tight truncate">
              {displayName}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {roleName}
                {departmentName && (
                  <>
                    {" · "}
                    {departmentId ? (
                      <Link
                        href={`/people/departments/${departmentId}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {departmentName}
                      </Link>
                    ) : (
                      departmentName
                    )}
                  </>
                )}
              </span>
              {isFired ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-secondary">
                  <span className="text-[12px] font-medium text-muted-foreground leading-none">
                    Уволен{firedAt ? ` · ${formatDate(firedAt)}` : ""}
                  </span>
                </span>
              ) : isPlaceholderUser ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-secondary">
                  <span className="text-[12px] font-medium text-muted-foreground leading-none">
                    Без аккаунта
                  </span>
                </span>
              ) : isPendingInvite ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15">
                  <span className="text-[12px] font-medium text-amber-700 dark:text-amber-300 leading-none">
                    Ожидает подтверждения
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15">
                  <span className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400 leading-none">
                    Активен
                  </span>
                </span>
              )}
              {importedFromQuickResto && (
                <Badge
                  variant="outline"
                  className="text-[11px] border-blue-200 text-blue-700 dark:text-blue-300 dark:border-blue-500/30"
                >
                  Из QuickResto
                </Badge>
              )}
            </div>
          </div>
        </div>

        {isFired && firedReason && (
          <div className="rounded-[14px] border bg-card px-5 py-4">
            <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
              Причина увольнения
            </p>
            <p className="mt-1.5 text-sm text-foreground leading-snug whitespace-pre-wrap">
              {firedReason}
            </p>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
        >
          <TabsList className="justify-center">
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="documents">Документы</TabsTrigger>
            {canViewAudit && (
              <>
                <TabsTrigger value="history">Журнал</TabsTrigger>
                <TabsTrigger value="activity">Активность</TabsTrigger>
              </>
            )}
            <TabsTrigger
              value="danger"
              className="data-[state=active]:text-destructive data-[state=active]:border-destructive"
            >
              Опасная зона
            </TabsTrigger>
          </TabsList>

          {/* ── Основное ─────────────────────────────────────── */}
          <TabsContent value="main">
            <form
              onSubmit={handleSubmit(onSave, onValidationError)}
              className="mx-auto w-full max-w-[720px] flex flex-col gap-5"
            >
              {/* Личные данные — фото сверху по центру + поля ниже,
                  в одной карточке. */}
              <FormSection
                title="Личные данные"
                description="Фото, имя, фамилия, пол и дата рождения"
                locked={{ tone: canEditPersonal ? "info" : "locked" }}
              >
                {/* Фото-блок */}
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
                    {canEditPersonal && (
                      <button
                        type="button"
                        onClick={() => setPhotoModalOpen(true)}
                        className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                        aria-label={avatarUrl ? "Изменить фото" : "Загрузить фото"}
                      >
                        <Camera className="w-5 h-5 text-white" />
                      </button>
                    )}
                  </div>
                  {canEditPersonal && (
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
                              await updateStaffProfile(profile.id, { avatar_url: null });
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
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="first_name" className="text-[13px] font-medium">Имя</Label>
                    <Input
                      id="first_name"
                      {...register("first_name")}
                      readOnly={!canEditPersonal}
                      className={!canEditPersonal ? "bg-muted/50" : ""}
                    />
                    {errors.first_name && (
                      <p className="text-xs text-destructive">{errors.first_name.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="last_name" className="text-[13px] font-medium">Фамилия</Label>
                    <Input
                      id="last_name"
                      {...register("last_name")}
                      readOnly={!canEditPersonal}
                      className={!canEditPersonal ? "bg-muted/50" : ""}
                    />
                    {errors.last_name && (
                      <p className="text-xs text-destructive">{errors.last_name.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium">Пол</Label>
                    {canEditPersonal ? (
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
                          : "—"
                        }
                        readOnly
                        className="bg-muted/50"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="birth_date" className="text-[13px] font-medium">
                      Дата рождения
                    </Label>
                    <Controller
                      control={control}
                      name="birth_date"
                      render={({ field }) => (
                        <DatePicker
                          id="birth_date"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Выберите дату"
                          readOnly={!canEditPersonal}
                          toDate={new Date()}
                        />
                      )}
                    />
                    {/* Подпись «когда был последний раз изменён» — видна всем.
                        Социальный гард от фрода с ДР: если кто-то перевыставил
                        дату чтобы получить поздравление повторно, остальные
                        сотрудники видят, что дата свежая. Сам limit (раз в год)
                        живёт в trigger'е tg_profiles_birth_date_yearly_limit
                        (миграция 142) — это про UX, не про защиту. */}
                    {profile.birth_date_set_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Изменено{" "}
                        {new Date(profile.birth_date_set_at).toLocaleDateString(
                          "ru-RU",
                          { day: "2-digit", month: "2-digit", year: "numeric" },
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </FormSection>

              {/* Контакты — phone/telegram/email/адрес (всё user-owned) */}
              <FormSection
                title="Контакты"
                description="Телефон, мессенджер, email и адрес проживания"
                locked={{ tone: canEditPersonal ? "info" : "locked" }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-[13px] font-medium">Телефон</Label>
                    <Controller
                      control={control}
                      name="phone"
                      render={({ field }) => (
                        <PhoneInput
                          id="phone"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          readOnly={!canEditPersonal}
                          className={!canEditPersonal ? "bg-muted/50" : ""}
                        />
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium">
                      Email
                      {isPendingInvite && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-[10px] font-medium text-amber-700 dark:text-amber-300 leading-none">
                          Ожидает подтверждения
                        </span>
                      )}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={contactEmail}
                        onChange={(event) => setContactEmail(event.target.value)}
                        readOnly={!canManageImportedInvite}
                        className={!canManageImportedInvite ? "bg-muted/50 text-muted-foreground" : ""}
                        placeholder={isPlaceholderUser ? "Не указан" : "employee@example.com"}
                      />
                      {canManageImportedInvite && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleInviteImported}
                          disabled={
                            isInvitePending ||
                            !contactEmail.trim() ||
                            // в pending состоянии разрешаем переотправку только если email
                            // действительно отличается от уже существующего (чтобы случайно
                            // не дёргать второй раз тот же invite).
                            (isPendingInvite && contactEmail.trim().toLowerCase() === email.toLowerCase())
                          }
                          className="shrink-0"
                        >
                          {isInvitePending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                          {isPlaceholderUser ? "Пригласить" : "Изменить и переслать"}
                        </Button>
                      )}
                    </div>
                    {canManageImportedInvite && (
                      <p className="text-xs text-muted-foreground">
                        {isPendingInvite
                          ? "Приглашение уже отправлено на текущий email, но сотрудник его пока не подтвердил. Если ошиблись — впишите правильный и переотправьте."
                          : "Введите email и отправьте приглашение, когда понадобится дать сотруднику доступ к системе."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="telegram_id" className="text-[13px] font-medium">Telegram ID</Label>
                    <Controller
                      control={control}
                      name="telegram_id"
                      render={({ field }) => (
                        <Input
                          id="telegram_id"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="123456789"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D+/g, ""))}
                          onBlur={field.onBlur}
                          readOnly={!canEditPersonal}
                          className={!canEditPersonal ? "bg-muted/50" : ""}
                        />
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-[13px] font-medium">Адрес проживания</Label>
                    <Input
                      id="address"
                      placeholder="г. Москва, ул. Примерная, 1"
                      {...register("address")}
                      readOnly={!canEditPersonal}
                      className={!canEditPersonal ? "bg-muted/50" : ""}
                    />
                  </div>
                </div>
              </FormSection>

              {/* Трудоустройство + PIN — тир 3 (account) + UVR (venue) */}
              <FormSection
                title="Трудоустройство"
                description="Дата начала работы и PIN терминала для этого заведения"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="employment_date" className="text-[13px] font-medium">
                      Дата трудоустройства <span className="text-destructive">*</span>
                    </Label>
                    <Controller
                      control={control}
                      name="employment_date"
                      render={({ field }) => (
                        <DatePicker
                          id="employment_date"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Выберите дату"
                          readOnly={!canEdit}
                          toDate={new Date()}
                        />
                      )}
                    />
                    {errors.employment_date && (
                      <p className="text-xs text-destructive">{errors.employment_date.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="terminal_pin" className="text-[13px] font-medium">
                      PIN терминала
                    </Label>
                    <Input
                      id="terminal_pin"
                      placeholder="Не задан"
                      {...register("terminal_pin")}
                      readOnly={!canEdit}
                      className={!canEdit ? "bg-muted/50" : ""}
                    />
                  </div>
                </div>
              </FormSection>

              {/* Заметка — тир 3, видна только админам */}
              <FormSection
                title="Заметка о сотруднике"
                description="Видна только админам этого аккаунта"
              >
                <Textarea
                  {...register("comment")}
                  readOnly={!canEdit}
                  className={!canEdit ? "bg-muted/50" : ""}
                  placeholder="Заметки о сменах, характере, особенностях."
                  rows={4}
                />
              </FormSection>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  disabled={!canEdit || isPending}
                  variant={canEdit ? "default" : "secondary"}
                  className={
                    canEdit
                      ? ""
                      : "disabled:opacity-100 text-muted-foreground hover:bg-secondary cursor-default"
                  }
                >
                  {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Сохранить
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* ── Документы ────────────────────────────────────── */}
          <TabsContent value="documents">
            <form
              onSubmit={handleSubmit(onSave, onValidationError)}
              className="mx-auto w-full max-w-[720px] flex flex-col gap-5"
            >
              <FormSection
                title="Медицинская книжка"
                description="Номер и срок действия медкнижки"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="medical_book_number" className="text-[13px] font-medium">Номер</Label>
                    <Input
                      id="medical_book_number"
                      placeholder="МК-0000000"
                      {...register("medical_book_number")}
                      readOnly={!canEdit}
                      className={!canEdit ? "bg-muted/50" : ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="medical_book_date" className="text-[13px] font-medium">Аттестован до</Label>
                    <Controller
                      control={control}
                      name="medical_book_date"
                      render={({ field }) => (
                        <DatePicker
                          id="medical_book_date"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Выберите дату"
                          readOnly={!canEdit}
                        />
                      )}
                    />
                  </div>
                </div>
              </FormSection>

              <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-4">
                <header className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <h2 className="text-base font-semibold text-foreground leading-tight">
                      Документы
                    </h2>
                    <p className="text-[13px] text-muted-foreground leading-snug">
                      Паспорт, трудовой договор, NDA и другие документы сотрудника
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDocName("");
                        setDocFile(null);
                        setDocModalOpen(true);
                      }}
                      className="shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Добавить
                    </Button>
                  )}
                </header>

                {passportPhotos.length === 0 ? (
                  <div className="rounded-xl border border-dashed flex flex-col items-center justify-center gap-1.5 py-8 px-4 text-muted-foreground">
                    <FileText className="w-5 h-5" />
                    <p className="text-[13px]">Документов пока нет</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {passportPhotos.map((path) => {
                      const url = signedUrls[path];
                      const { name, uploadedAt } = parseDocPath(path);
                      const last = path.split("/").pop() ?? "";
                      const isImage = /\.(jpe?g|png|webp|gif)$/i.test(last);
                      return (
                        <div
                          key={path}
                          className="relative group rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-foreground/20 transition-colors"
                        >
                          <div className="flex items-center justify-center h-20 rounded-lg bg-muted overflow-hidden">
                            {isImage && url ? (
                              <img
                                src={url}
                                alt={name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <FileText className="w-7 h-7 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">
                              {name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {uploadedAt ? `Загружен ${formatDate(uploadedAt)}` : "Файл"}
                            </p>
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleDeletePassportPhoto(path)}
                              className="absolute top-2 right-2 size-6 rounded-md bg-background/90 border border-border text-muted-foreground hover:text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Удалить документ"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  disabled={!canEdit || isPending}
                  variant={canEdit ? "default" : "secondary"}
                  className={
                    canEdit
                      ? ""
                      : "disabled:opacity-100 text-muted-foreground hover:bg-secondary cursor-default"
                  }
                >
                  {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Сохранить
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* ── Журнал (что делали с этим сотрудником) ──────── */}
          {canViewAudit && (
            <TabsContent value="history">
              <EntityAuditTab
                mode="entity"
                entityType="staff"
                entityId={profile.id}
                canView={canViewAudit}
                initialEvents={initialAuditEvents}
                initialHasMore={initialAuditHasMore}
              />
            </TabsContent>
          )}

          {/* ── Активность (что этот сотрудник делал сам) ────── */}
          {canViewAudit && (
            <TabsContent value="activity">
              <EntityAuditTab
                mode="actor"
                actorId={profile.id}
                canView={canViewAudit}
                initialEvents={initialActivityEvents}
                initialHasMore={initialActivityHasMore}
              />
            </TabsContent>
          )}

          {/* ── Опасная зона ────────────────────────────────── */}
          <TabsContent value="danger">
            <div className="mx-auto w-full max-w-[780px]">
              {canEdit && !isMe ? (
                <div className="rounded-[14px] border bg-card overflow-hidden flex flex-col">
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="flex items-center justify-center size-9 rounded-lg bg-destructive/10 shrink-0">
                      <Lock className="w-4 h-4 text-destructive" />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-destructive leading-tight">
                        Уволить сотрудника
                      </p>
                      <p className="text-[13px] text-muted-foreground leading-snug">
                        Сотрудник потеряет доступ к этому заведению. Профиль и
                        история сохраняются — восстановить можно из списка
                        уволенных.
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Button
                        variant="destructive"
                        onClick={() => setConfirmFire(true)}
                        disabled={isPending}
                      >
                        Уволить
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[14px] border border-dashed p-10 text-center">
                  <p className="text-sm font-medium">Опасная зона недоступна</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isMe
                      ? "Себя нельзя уволить."
                      : "Нужны права администратора."}
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm fire dialog */}
      <Dialog
        open={confirmFire}
        onOpenChange={(open) => {
          setConfirmFire(open);
          if (!open) setFireReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Уволить сотрудника?</DialogTitle>
            <DialogDescription>
              «{displayName}» потеряет доступ к этому заведению. Профиль и
              история сохраняются — восстановить можно из списка уволенных.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="fire_reason" className="text-[13px] font-medium">
              Причина увольнения <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="fire_reason"
              value={fireReason}
              onChange={(e) => setFireReason(e.target.value)}
              placeholder="Например: ушёл на другое место, нарушения дисциплины, окончание сезона"
              rows={3}
              className="resize-none"
              required
            />
            <p className="text-[12px] text-muted-foreground">
              Будет видна в списке уволенных — помогает вспомнить контекст
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFire(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => { setConfirmFire(false); handleFire(); }}
              disabled={isPending || fireReason.trim().length === 0}
            >
              Уволить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>Фото сотрудника</DialogTitle>
            <DialogDescription>
              Загрузите фото в формате JPG или PNG. Максимальный размер — 5 МБ.
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

      {/* Document upload modal */}
      <Dialog
        open={docModalOpen}
        onOpenChange={(open) => {
          setDocModalOpen(open);
          if (!open) {
            setDocName("");
            setDocFile(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить документ</DialogTitle>
            <DialogDescription>
              Укажите название и загрузите файл в формате JPG, PNG или PDF.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-name" className="text-[13px] font-medium">
                Название
              </Label>
              <Input
                id="doc-name"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Паспорт · Разворот 1"
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={() => docInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setDocFile(f);
              }}
              className="flex flex-col items-center justify-center gap-2 h-40 rounded-xl border border-dashed bg-muted/30 hover:bg-muted/60 transition-colors px-4 text-center"
            >
              {docFile ? (
                <>
                  <FileText className="w-7 h-7 text-brand" />
                  <p className="text-[13px] font-medium text-foreground truncate max-w-full">
                    {docFile.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {(docFile.size / 1024 / 1024).toFixed(2)} МБ — нажмите, чтобы выбрать другой
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">
                    Перетащите файл или нажмите для выбора
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">JPG, PNG, PDF до 10 МБ</p>
                </>
              )}
            </button>
            <input
              ref={docInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setDocFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDocModalOpen(false)}
              disabled={uploadingDocs}
            >
              Отмена
            </Button>
            <Button
              onClick={submitDocModal}
              disabled={!docFile || !docName.trim() || uploadingDocs}
            >
              {uploadingDocs && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Загрузить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
