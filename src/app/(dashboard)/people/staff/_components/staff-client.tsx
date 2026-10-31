"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  UserPlus,
  Calendar,
  Clock,
  X,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Lock,
  HeartPulse,
  Cake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatPhoneDisplay } from "@/lib/format/phone";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  inviteStaff,
  restoreStaff,
  cancelInvitation,
  createStaffWithoutEmail,
} from "../actions";
import type {
  StaffMember,
  PendingInvitation,
  FiredStaffMember,
} from "../actions";

import { PageFrame } from "@/components/shared/page-frame";
import { PersonAvatar } from "@/components/people/person-avatar";
import { StaffTable, type StaffColKey as ColKey } from "./staff-table";

// ── Helpers ──────────────────────────────────────────────────
const inviteSchema = z.object({
  email: z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите должность"),
});
type InviteForm = z.infer<typeof inviteSchema>;

const createSchema = z.object({
  firstName: z.string().min(1, "Укажите имя"),
  lastName: z.string().min(1, "Укажите фамилию"),
  phone: z.string().optional(),
  roleId: z.string().min(1, "Выберите должность"),
});
type CreateForm = z.infer<typeof createSchema>;

type Role = { id: string; name: string; code: string };

type DepartmentLite = { id: string; name: string };

type Props = {
  staff: StaffMember[];
  invitations: PendingInvitation[];
  firedStaff: FiredStaffMember[];
  roles: Role[];
  departments: DepartmentLite[];
  venueId: string;
  currentUserId: string;
  activeRoleCode: string | null;
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function displayName(m: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  const n = [m.first_name, m.last_name].filter(Boolean).join(" ");
  return n || m.email.split("@")[0];
}

function genderShort(g: string | null) {
  if (g === "male") return "М";
  if (g === "female") return "Ж";
  return "—";
}

/**
 * Возвращает статус медкнижки для бейджа в списке. null — поле пустое
 * или срок > 30 дней (никакой бейдж не нужен).
 *
 * Дата сравнивается по локальному календарному дню (без UTC-сдвига),
 * чтобы «истекает сегодня» считалось одинаково в Москве и Калининграде.
 */
function medbookStatus(
  medicalBookDate: string | null,
): { kind: "expired" | "soon"; label: string; title: string } | null {
  if (!medicalBookDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(medicalBookDate + "T00:00:00");
  if (Number.isNaN(expiry.getTime())) return null;
  const diffDays = Math.round(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const dateStr = expiry.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (diffDays < 0) {
    return {
      kind: "expired",
      label: "Медкнижка просрочена",
      title: `Срок действия медкнижки истёк ${dateStr}.`,
    };
  }
  if (diffDays <= 30) {
    return {
      kind: "soon",
      label:
        diffDays === 0 ? "Истекает сегодня" : `Истекает через ${diffDays} дн.`,
      title: `Срок действия медкнижки заканчивается ${dateStr}.`,
    };
  }
  return null;
}

/**
 * Статус ДР сотрудника для бейджа в списке. Сравниваем только день+месяц
 * (год — реальный год рождения, его не учитываем). null — если поле пустое
 * или ближайший ДР больше чем через 7 дней.
 *
 * Логика:
 *   • Сегодня день в день → kind: "today", «С днём рождения!»
 *   • В ближайшие 7 дней → kind: "soon», «Через N дн.» (включая 1..7)
 *   • Иначе — null.
 *
 * 29 февраля в не-високосный год считаем как 1 марта.
 */
function birthdayStatus(
  birthDate: string | null,
): { kind: "today" | "soon"; label: string; title: string } | null {
  if (!birthDate) return null;
  // birthDate в формате YYYY-MM-DD; парсим без UTC-сдвига.
  const parts = birthDate.split("-");
  if (parts.length !== 3) return null;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!month || !day) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  // Следующий ДР: в этом году или, если уже прошёл, в следующем.
  let next = new Date(thisYear, month - 1, day);
  next.setHours(0, 0, 0, 0);
  // 29 февраля в не-високосный → JS превращает в 1 марта; ок, поведение
  // совпадает с тем, как ДР отмечают de-facto.
  if (next.getTime() < today.getTime()) {
    next = new Date(thisYear + 1, month - 1, day);
    next.setHours(0, 0, 0, 0);
  }
  const diffDays = Math.round(
    (next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const dateStr = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
  if (diffDays === 0) {
    return {
      kind: "today",
      label: "С днём рождения!",
      title: `Сегодня день рождения (${dateStr}).`,
    };
  }
  if (diffDays >= 1 && diffDays <= 7) {
    return {
      kind: "soon",
      label: `ДР через ${diffDays} дн.`,
      title: `День рождения ${dateStr} — через ${diffDays} дн.`,
    };
  }
  return null;
}

function StaffAvatar({
  member,
  faded,
}: {
  member: {
    avatar_url: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
  faded?: boolean;
}) {
  return (
    <PersonAvatar
      src={member.avatar_url}
      name={displayName(member)}
      faded={faded}
    />
  );
}

// ── Main component ───────────────────────────────────────────
export function StaffClient({
  staff: initialStaff,
  invitations: initialInvitations,
  firedStaff: initialFired,
  roles,
  departments,
  venueId,
  currentUserId,
  activeRoleCode,
}: Props) {
  const router = useRouter();

  const [staff, setStaff] = useState(initialStaff);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [fired, setFired] = useState(initialFired);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addMode, setAddMode] = useState<"email" | "manual">("manual");
  const [isPending, startTransition] = useTransition();
  const [firedOpen, setFiredOpen] = useState(false);

  const canEdit = ["owner", "manager", "admin"].includes(activeRoleCode ?? "");

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({ resolver: zodResolver(inviteSchema) });

  // Отдельная форма для «Добавить без email».
  const createFormHook = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { firstName: "", lastName: "", phone: "", roleId: "" },
  });

  const onInvite = (values: InviteForm) => {
    startTransition(async () => {
      const result = await inviteStaff({
        email: values.email,
        roleId: values.roleId,
        venueId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.invitation) {
        const invitation = result.invitation;
        setInvitations((prev) => {
          const withoutDuplicate = prev.filter(
            (inv) => inv.inv_id !== invitation.inv_id,
          );
          return [invitation, ...withoutDuplicate];
        });
      }
      toast.success(`Приглашение отправлено на ${values.email}`);
      reset();
      setInviteOpen(false);
      router.refresh();
    });
  };

  const onCreateWithoutEmail = (values: CreateForm) => {
    startTransition(async () => {
      const result = await createStaffWithoutEmail({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || null,
        roleId: values.roleId,
        venueId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      // Оптимистично добавляем нового сотрудника в список, чтобы не ждать
      // полного refresh от сервера.
      if (result.member) {
        const member = { ...result.member, imported_from_quickresto: false };
        setStaff((prev) => [...prev, member]);
      }
      toast.success(
        `Сотрудник «${values.firstName} ${values.lastName}» добавлен`,
      );
      createFormHook.reset();
      setInviteOpen(false);
    });
  };

  const onRestore = (uvrId: string) => {
    startTransition(async () => {
      const result = await restoreStaff(uvrId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const member = fired.find((m) => m.uvr_id === uvrId);
      if (member) {
        setStaff((prev) => [
          ...prev,
          {
            uvr_id: member.uvr_id,
            user_id: member.user_id,
            role_id: member.role_id,
            role_name: member.role_name,
            role_code: member.role_code,
            department_id: null,
            department_name: null,
            first_name: member.first_name,
            last_name: member.last_name,
            email: member.email,
            // Восстановленный сотрудник — статус подтверждения email с сервера
            // подтянется при следующем refresh; пока считаем true (он уже был
            // подтверждённым раньше, иначе не смогли бы fire).
            email_confirmed: true,
            avatar_url: member.avatar_url,
            phone: null,
            telegram_id: null,
            gender: null,
            birth_date: null,
            employment_date: null,
            medical_book_date: null,
            joined_at: new Date().toISOString(),
          },
        ]);
      }
      setFired((prev) => prev.filter((m) => m.uvr_id !== uvrId));
      toast.success("Сотрудник восстановлен");
    });
  };

  const onCancelInvitation = (invId: string) => {
    startTransition(async () => {
      const result = await cancelInvitation(invId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setInvitations((prev) => prev.filter((inv) => inv.inv_id !== invId));
      toast.success("Приглашение отменено");
    });
  };

  // ── Cell renderers ─────────────────────────────────────────
  const renderCell = (key: ColKey, member: StaffMember) => {
    const isMe = member.user_id === currentUserId;

    switch (key) {
      case "avatar":
        return (
          <div className="flex items-center justify-center">
            <StaffAvatar member={member} />
          </div>
        );
      case "name": {
        const isPlaceholder = member.email
          .toLowerCase()
          .endsWith("@import.local");
        // has_pending_invite / needs_password_setup надёжнее email_confirmed:
        // у импортированного сотрудника после смены email подтверждение может
        // остаться true, хотя активацию (создание пароля) он не прошёл.
        // needs_password_setup переживает потерю строки-инвайта (см. page.tsx
        // и миграцию 213). См. карточку [userId] — там та же логика.
        const isPendingInvite =
          !isPlaceholder &&
          (Boolean(member.has_pending_invite) ||
            Boolean(member.needs_password_setup) ||
            !member.email_confirmed);
        const medbook = medbookStatus(member.medical_book_date);
        const bday = birthdayStatus(member.birth_date);
        return (
          <div className="min-w-0 flex items-center gap-2">
            <Link
              href={`/people/staff/${member.user_id}`}
              title={displayName(member)}
              className="font-medium text-sm truncate min-w-0 hover:text-brand"
            >
              {displayName(member)}
              {isMe && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (вы)
                </span>
              )}
            </Link>
            {isPlaceholder && (
              <span
                className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground"
                data-tip="Сотрудник без аккаунта. Когда понадобится дать ему доступ — впишите email в карточке и отправьте приглашение."
              >
                <Lock className="w-2.5 h-2.5" />
                <span className="text-[10px] font-medium leading-none">
                  Без аккаунта
                </span>
              </span>
            )}
            {isPendingInvite && (
              <span
                className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground"
                data-tip="Приглашение отправлено, но сотрудник ещё не подтвердил email."
              >
                <Clock className="w-2.5 h-2.5" />
                <span className="text-[10px] font-medium leading-none">
                  Ожидает
                </span>
              </span>
            )}
            {medbook && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full ${
                  medbook.kind === "expired"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                }`}
                data-tip={medbook.title}
              >
                <HeartPulse className="w-2.5 h-2.5" />
                <span className="text-[10px] font-medium leading-none">
                  {medbook.label}
                </span>
              </span>
            )}
            {bday && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full ${
                  bday.kind === "today"
                    ? "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300"
                    : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                }`}
                data-tip={bday.title}
              >
                <Cake className="w-2.5 h-2.5" />
                <span className="text-[10px] font-medium leading-none">
                  {bday.label}
                </span>
              </span>
            )}
          </div>
        );
      }
      case "email":
        return (
          <div className="text-sm text-muted-foreground min-w-0 truncate">
            {member.email.toLowerCase().endsWith("@import.local")
              ? "Email не указан"
              : member.email}
          </div>
        );
      case "phone":
        return (
          <div className="text-sm text-muted-foreground truncate">
            {member.phone ? formatPhoneDisplay(member.phone) : "—"}
          </div>
        );
      case "telegram":
        return (
          <div className="text-sm text-muted-foreground truncate">
            {member.telegram_id || "—"}
          </div>
        );
      case "gender":
        return (
          <div className="text-sm text-muted-foreground">
            {genderShort(member.gender)}
          </div>
        );
      case "birth_date":
        return (
          <div className="text-sm text-muted-foreground">
            {formatDate(member.birth_date)}
          </div>
        );
      case "role": {
        // Owner — brand-tinted badge per design (descendants override на zHpCv: fill #1570EF).
        // Остальные — стандартный secondary.
        const isOwner = member.role_code === "owner";
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/people/roles/${member.role_id}`);
            }}
            className="text-left"
          >
            <Badge
              variant="secondary"
              className={`max-w-full truncate whitespace-nowrap text-xs cursor-pointer hover:bg-accent ${
                isOwner ? "text-brand" : ""
              }`}
            >
              {member.role_name}
            </Badge>
          </button>
        );
      }
      case "department": {
        if (!member.department_name) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        const departmentId = member.department_id;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (departmentId)
                router.push(`/people/departments/${departmentId}`);
            }}
            className="text-left"
          >
            <Badge
              variant="secondary"
              className="max-w-full truncate whitespace-nowrap text-xs cursor-pointer hover:bg-accent"
            >
              {member.department_name}
            </Badge>
          </button>
        );
      }
      case "qr_import":
        return (
          <div
            className="flex items-center justify-center"
            aria-label={member.imported_from_quickresto ? "Да" : "Нет"}
          >
            {member.imported_from_quickresto ? (
              <Check className="w-4 h-4 text-brand" />
            ) : (
              <X className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        );
      case "employment_date":
        return (
          <div
            className="flex items-center gap-1.5 text-sm text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            {formatDate(member.employment_date ?? member.joined_at)}
          </div>
        );
    }
  };

  const renderInvCell = (key: ColKey, inv: PendingInvitation) => {
    switch (key) {
      case "avatar":
        return (
          <div className="flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
          </div>
        );
      case "name":
        return (
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm truncate text-foreground/70">
              {inv.email}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
              <Clock className="w-2.5 h-2.5" />
              <span className="text-[10px] font-medium leading-none">
                Ожидает
              </span>
            </span>
          </div>
        );
      case "role":
        return (
          <Badge variant="secondary" className="text-xs cursor-default">
            {inv.role_name}
          </Badge>
        );
      case "qr_import":
        return (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        );
      case "employment_date":
        return (
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            {formatDate(inv.invited_at)}
          </div>
        );
      default:
        return <div />;
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <PageFrame className="space-y-4">
      <StaffTable
        key={`${venueId}:${currentUserId}`}
        preferenceKey={`${venueId}.${currentUserId}`}
        staff={staff}
        invitations={invitations}
        roles={roles}
        departments={departments}
        renderCell={renderCell}
        renderInvCell={renderInvCell}
        canEdit={canEdit}
        isPending={isPending}
        onCancelInvitation={onCancelInvitation}
        primaryAction={
          canEdit ? (
            <Button
              onClick={() => setInviteOpen(true)}
              size="sm"
              className="h-9 gap-2"
            >
              <UserPlus className="size-4" />
              Добавить
            </Button>
          ) : null
        }
      />

      {/* ── Fired staff section ── */}
      {fired.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setFiredOpen((v) => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${firedOpen ? "" : "-rotate-90"}`}
            />
            Уволенные сотрудники ({fired.length})
          </button>
          {firedOpen && (
            <div className="rounded-lg border bg-card overflow-hidden">
              {fired.map((member) => (
                <div
                  key={member.uvr_id}
                  className="grid grid-cols-[40px_1fr_auto] gap-4 items-center px-5 py-3.5 border-b last:border-b-0"
                >
                  <div className="flex items-center justify-center">
                    <StaffAvatar member={member} faded />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-muted-foreground">
                      {displayName(member)}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {member.role_name} · уволен {formatDate(member.fired_at)}
                    </p>
                    {member.fired_reason && (
                      <p className="mt-1.5 text-[13px] text-muted-foreground leading-snug line-clamp-3">
                        {member.fired_reason}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={isPending}
                      onClick={() => onRestore(member.uvr_id)}
                    >
                      <RotateCcw className="w-3 h-3" />
                      Восстановить
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add staff sheet — два режима: «По email» (отсылает invite, юзер
          логинится сам) и «Без email» (placeholder-аккаунт, админ ведёт карточку). */}
      <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Добавить сотрудника</SheetTitle>
          </SheetHeader>

          <Tabs
            value={addMode}
            onValueChange={(v) => setAddMode(v as "email" | "manual")}
            className="mt-6"
          >
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="manual">Создать</TabsTrigger>
              <TabsTrigger value="email">Пригласить</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="mt-5">
              <form
                onSubmit={createFormHook.handleSubmit(onCreateWithoutEmail)}
                className="space-y-5"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="create-first"
                      className="text-[13px] font-medium"
                    >
                      Имя <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="create-first"
                      placeholder="Иван"
                      {...createFormHook.register("firstName")}
                    />
                    {createFormHook.formState.errors.firstName && (
                      <p className="text-xs text-destructive">
                        {createFormHook.formState.errors.firstName.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="create-last"
                      className="text-[13px] font-medium"
                    >
                      Фамилия <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="create-last"
                      placeholder="Иванов"
                      {...createFormHook.register("lastName")}
                    />
                    {createFormHook.formState.errors.lastName && (
                      <p className="text-xs text-destructive">
                        {createFormHook.formState.errors.lastName.message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="create-phone"
                    className="text-[13px] font-medium"
                  >
                    Телефон
                  </Label>
                  <Controller
                    control={createFormHook.control}
                    name="phone"
                    render={({ field }) => (
                      <PhoneInput
                        id="create-phone"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium">
                    Должность <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    onValueChange={(v) => createFormHook.setValue("roleId", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите должность" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {createFormHook.formState.errors.roleId && (
                    <p className="text-xs text-destructive">
                      {createFormHook.formState.errors.roleId.message}
                    </p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Вы создаёте карточку сотрудника и ведёте её сами. Когда
                  понадобится дать ему доступ к системе — впишите email на
                  карточке и отправьте приглашение. После этого сотрудник
                  возьмёт управление профилем в свои руки.
                </p>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setInviteOpen(false)}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isPending}>
                    {isPending && <Loader2 className="size-4 animate-spin" />}
                    Создать
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="email" className="mt-5">
              <form onSubmit={handleSubmit(onInvite)} className="space-y-5">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="inv-email"
                    className="text-[13px] font-medium"
                  >
                    Email сотрудника <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="inv-email"
                    type="email"
                    placeholder="employee@example.com"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium">
                    Должность <span className="text-destructive">*</span>
                  </Label>
                  <Select onValueChange={(v) => setValue("roleId", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите должность" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.roleId && (
                    <p className="text-sm text-destructive">
                      {errors.roleId.message}
                    </p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Сотрудник получит приглашение на указанный email,
                  зарегистрируется сам и будет вести свой профиль
                  самостоятельно.
                </p>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setInviteOpen(false)}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isPending}>
                    {isPending && <Loader2 className="size-4 animate-spin" />}
                    Отправить приглашение
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </PageFrame>
  );
}
