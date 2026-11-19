"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { isStaffPlaceholderEmail } from "@/lib/people/staff-identity";
import { isGender } from "@/lib/people/gender";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  UserPlus,
  Calendar,
  Clock,
  Archive,
  Lock,
  HeartPulse,
  Cake,
  CalendarClock,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { formatPhoneDisplay } from "@/lib/format/phone";
import { Badge } from "@/components/ui/badge";
import { restoreStaff, cancelInvitation } from "../actions";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  StaffMember,
  PendingInvitation,
  FiredStaffMember,
} from "../actions";

import { PageFrame } from "@/components/shared/page-frame";
import { usePeopleOverview } from "@/components/people/people-overview";
import { PersonAvatar } from "@/components/people/person-avatar";
import { StaffTable, type StaffColKey as ColKey } from "./staff-table";
import type { CasualStaffRow } from "@/lib/payroll/casual-list";
import { AddStaffDrawer } from "./add-staff-drawer";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

// ── Helpers ──────────────────────────────────────────────────
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
  /** Право people.edit_staff у текущего пользователя. */
  canEditStaff: boolean;
  /** null when casual workers are unavailable (e.g. before the database update). */
  casual: { employees: CasualStaffRow[]; roles: { id: string; name: string }[] } | null;
  /** Opened from the schedule: «Добавить → Разовый» is shown right away. */
  openAddCasual?: boolean;
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
  return "Не указан";
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
  canEditStaff,
  casual,
  openAddCasual = false,
}: Props) {
  const router = useRouter();

  const [staff, setStaff] = useState(initialStaff);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [fired, setFired] = useState(initialFired);
  const [inviteOpen, setInviteOpen] = useState(openAddCasual);
  const [addKey, setAddKey] = useState(0);
  const openAdd = () => {
    setAddKey((key) => key + 1);
    setInviteOpen(true);
  };
  const [isPending, startTransition] = useTransition();
  const [firedOpen, setFiredOpen] = useState(false);
  const overview = usePeopleOverview(
    "staff",
    venueId,
    `${staff.length}:${fired.length}`,
  );

  // Право, а не код должности: своя должность с people.edit_staff тоже
  // добавляет сотрудников, а менеджер без права — нет. Считает страница.
  const canEdit = canEditStaff;

  // Оба действия трудно откатить (восстановление создаёт записи в Quick Resto
  // и выдаёт код замка), поэтому сначала подтверждение.
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "restore"; id: string; label: string }
    | { kind: "cancelInvitation"; id: string; label: string }
    | null
  >(null);
  const onRestore = (uvrId: string) => {
    startTransition(async () => {
      const result = await restoreStaff(uvrId);
      setConfirmAction(null);
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
      setConfirmAction(null);
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
        const isPlaceholder = isStaffPlaceholderEmail(member.email);
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
              data-tip={displayName(member)}
              data-tip-overflow
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
                className="inline-flex shrink-0"
                data-tip="Сотрудник без аккаунта. Когда понадобится дать ему доступ — впишите email в карточке и отправьте приглашение."
              >
                <StatusBadge icon={<Lock />}>Без аккаунта</StatusBadge>
              </span>
            )}
            {isPendingInvite && (
              <span
                className="inline-flex shrink-0"
                data-tip="Приглашение отправлено, но сотрудник ещё не подтвердил email."
              >
                <StatusBadge tone="warning" icon={<Clock />}>
                  Ожидает
                </StatusBadge>
              </span>
            )}
            {medbook && (
              <span className="inline-flex shrink-0" data-tip={medbook.title}>
                <StatusBadge
                  tone={medbook.kind === "expired" ? "danger" : "warning"}
                  icon={<HeartPulse />}
                >
                  {medbook.label}
                </StatusBadge>
              </span>
            )}
            {bday && (
              <span className="inline-flex shrink-0" data-tip={bday.title}>
                <StatusBadge
                  tone={bday.kind === "today" ? "accent" : "info"}
                  icon={<Cake />}
                >
                  {bday.label}
                </StatusBadge>
              </span>
            )}
            {/* Пол обязателен; у сотрудников, заведённых до этого (импорт
                из Quick Resto, ранние карточки), его может не быть. Пока
                сотрудник не вошёл в Sheerly, пол указывает админ в карточке,
                потом — сам сотрудник в профиле. Бейдж последний и, в отличие
                от остальных, сжимается (до иконки с подсказкой): рядом с
                «Без аккаунта» иначе от имени остаётся одна буква. */}
            {!isGender(member.gender) && (
              <span
                className="inline-flex min-w-0"
                data-tip={
                  isPlaceholder || isPendingInvite
                    ? "Укажите пол в карточке сотрудника"
                    : "Сотрудник указывает пол сам, в своём профиле"
                }
              >
                <StatusBadge tone="warning" icon={<UserRound />}>
                  Не указан пол
                </StatusBadge>
              </span>
            )}
          </div>
        );
      }
      case "email":
        return (
          <div className="text-sm text-muted-foreground min-w-0 truncate">
            {isStaffPlaceholderEmail(member.email)
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
      case "pin":
        return member.terminal_pin ? (
          <span className="font-mono text-sm tabular-nums">{member.terminal_pin}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
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
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
        );
      case "name":
        return (
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm truncate text-foreground/70">
              {inv.email}
            </span>
            <StatusBadge tone="warning" icon={<Clock />} className="shrink-0">
              Ожидает
            </StatusBadge>
          </div>
        );
      case "role":
        return (
          <Badge variant="secondary" className="text-xs cursor-default">
            {inv.role_name}
          </Badge>
        );
      case "pin":
        return <span className="text-sm text-muted-foreground">—</span>;
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

  const renderFiredCell = (key: ColKey, member: FiredStaffMember) => {
    switch (key) {
      case "avatar":
        return <StaffAvatar member={member} faded />;
      case "name":
        return (
          <Link
            href={`/people/staff/${member.user_id}`}
            data-tip={displayName(member)}
              data-tip-overflow
            className="block truncate text-sm font-medium hover:text-brand"
          >
            {displayName(member)}
          </Link>
        );
      case "email":
        return (
          <span className="block truncate text-muted-foreground">
            {isStaffPlaceholderEmail(member.email)
              ? "Email не указан"
              : member.email}
          </span>
        );
      case "role":
        return (
          <Badge variant="secondary" className="max-w-full truncate text-xs">
            {member.role_name}
          </Badge>
        );
      case "fired_at":
        return (
          <span className="whitespace-nowrap">
            {formatDate(member.fired_at)}
          </span>
        );
      case "fired_reason":
        return (
          <span
            className="block truncate text-muted-foreground"
            data-tip={member.fired_reason ?? undefined}
            data-tip-overflow
          >
            {member.fired_reason || "Не указана"}
          </span>
        );
      default:
        return null;
    }
  };

  // Casual workers: payroll card instead of a staff profile, no account.
  const renderCasualCell = (key: ColKey, c: CasualStaffRow) => {
    switch (key) {
      case "avatar":
        return (
          <div className="flex items-center justify-center">
            <PersonAvatar name={c.name} />
          </div>
        );
      case "name":
        return (
          <div className="min-w-0 flex items-center gap-2">
            <Link
              href={`/people/payroll/${c.id}`}
              title={c.name}
              className="font-medium text-sm truncate min-w-0 hover:text-brand"
            >
              {c.name}
            </Link>
            <span
              className="inline-flex shrink-0"
              data-tip="Выходит на смены по графику без входа в Sheerly. Отмечается в кассе своим PIN."
            >
              <StatusBadge icon={<CalendarClock />}>Разовый</StatusBadge>
            </span>
          </div>
        );
      case "role":
        return (
          <Badge variant="secondary" className="max-w-full truncate whitespace-nowrap text-xs">
            {c.roleName}
          </Badge>
        );
      case "department":
        return c.departmentName ? (
          <Badge variant="secondary" className="max-w-full truncate whitespace-nowrap text-xs">
            {c.departmentName}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      case "pin":
        return <span className="font-mono text-sm tabular-nums">{c.pin}</span>;
      default:
        return <span className="text-sm text-muted-foreground">—</span>;
    }
  };

  // ── Render ─────────────────────────────────────────────────
  const addButton = canEdit ? (
    <Button onClick={openAdd} size="sm" className="h-9 gap-2">
      <UserPlus className="size-4" />
      Добавить
    </Button>
  ) : null;

  return (
    <PageFrame className="space-y-4">
      <StaffTable
        key={`${venueId}:${currentUserId}:${firedOpen}`}
        preferenceKey={`${venueId}.${currentUserId}`}
        staff={staff}
        casual={casual?.employees ?? []}
        renderCasualCell={renderCasualCell}
        fired={fired}
        showFired={firedOpen}
        invitations={invitations}
        roles={roles}
        departments={departments}
        renderCell={renderCell}
        renderInvCell={renderInvCell}
        renderFiredCell={renderFiredCell}
        onRestore={(uvrId) => {
          const member = fired.find((m) => m.uvr_id === uvrId);
          setConfirmAction({
            kind: "restore",
            id: uvrId,
            label:
              [member?.first_name, member?.last_name].filter(Boolean).join(" ") ||
              member?.email ||
              "сотрудника",
          });
        }}
        overviewPanel={overview.panel}
        secondaryActions={
          <>
            <IconTooltip
              label={
                firedOpen
                  ? "Вернуться к действующим сотрудникам"
                  : `Уволенные сотрудники (${fired.length})`
              }
            >
              <Button
                variant="outline"
                size="icon"
                aria-label={
                  firedOpen
                    ? "Показать действующих сотрудников"
                    : `Показать уволенных сотрудников (${fired.length})`
                }
                aria-pressed={firedOpen}
                onClick={() => setFiredOpen((value) => !value)}
                className={`size-8 sm:size-9 text-muted-foreground ${firedOpen ? "border-brand bg-brand/5 text-brand" : ""}`}
              >
                <Archive className="size-4" />
              </Button>
            </IconTooltip>
            {overview.button}
          </>
        }
        canEdit={canEdit}
        isPending={isPending}
        onCancelInvitation={(invId) =>
          setConfirmAction({
            kind: "cancelInvitation",
            id: invId,
            label:
              invitations.find((inv) => inv.inv_id === invId)?.email ?? "",
          })
        }
        primaryAction={addButton}
      />

      {/* «Новый сотрудник»: без входа, по email или разовый. Ключ пересоздаёт
          панель при каждом открытии — форма открывается пустой. */}
      <AddStaffDrawer
        key={addKey}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
        casualRoles={casual?.roles ?? null}
        venueId={venueId}
        defaultMode={openAddCasual ? "casual" : "manual"}
        onInvited={(invitation) =>
          setInvitations((prev) => [
            invitation,
            ...prev.filter((inv) => inv.inv_id !== invitation.inv_id),
          ])
        }
        onCreated={(member) => setStaff((prev) => [...prev, member])}
      />
      <ConfirmDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.kind === "restore"
            ? `Восстановить «${confirmAction.label}»?`
            : `Отменить приглашение ${confirmAction?.label ?? ""}?`
        }
        description={
          confirmAction?.kind === "restore"
            ? "Сотрудник вернётся в список действующих и снова получит доступ к заведению. Для него будут созданы записи в Quick Resto и выдан код замка."
            : "Ссылка из письма перестанет работать. Чтобы пригласить человека снова, приглашение нужно будет отправить заново."
        }
        confirmLabel={
          confirmAction?.kind === "restore"
            ? "Восстановить сотрудника"
            : "Отменить приглашение"
        }
        pendingLabel={
          confirmAction?.kind === "restore" ? "Восстанавливаем…" : "Отменяем…"
        }
        destructive={confirmAction?.kind === "cancelInvitation"}
        busy={isPending}
        onConfirm={() => {
          if (confirmAction?.kind === "restore") onRestore(confirmAction.id);
          else if (confirmAction) onCancelInvitation(confirmAction.id);
        }}
      />
    </PageFrame>
  );
}
