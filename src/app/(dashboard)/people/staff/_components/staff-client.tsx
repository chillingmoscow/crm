/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  UserPlus, Calendar, Clock, X, Check, Settings2,
  ChevronDown, ChevronRight, RotateCcw, Search, Filter, Lock,
  HeartPulse, MessageSquareQuote, Cake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
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
import type { StaffMember, PendingInvitation, FiredStaffMember } from "../actions";

// ── Column definitions ───────────────────────────────────────
type ColKey =
  | "avatar" | "name" | "email" | "phone" | "telegram"
  | "gender" | "birth_date" | "role" | "department"
  | "qr_import" | "employment_date";

const COL_DEFS: {
  key: ColKey; label: string; width: string; required?: boolean;
  /** "center" centers both header label and cell content */
  align?: "center";
}[] = [
  // Точно по дизайну u16dak/NQk5c (frame WcQJN):
  // avatar 40, name 1fr, email 1fr, role 180, qr_import 140 center,
  // employment_date 180. Trailing chevron — 24px колонка после визибл-сета.
  { key: "avatar",          label: "Фото",                 width: "40px" },
  { key: "name",            label: "Имя",                  width: "minmax(180px, 1fr)", required: true },
  { key: "email",           label: "Email",                width: "minmax(180px, 1fr)" },
  { key: "phone",           label: "Телефон",              width: "140px" },
  { key: "telegram",        label: "Telegram",             width: "120px" },
  { key: "gender",          label: "Пол",                  width: "60px" },
  { key: "birth_date",      label: "Дата рождения",        width: "120px" },
  { key: "role",            label: "Должность",            width: "180px" },
  { key: "department",      label: "Подразделение",        width: "160px" },
  { key: "qr_import",       label: "Импорт из QR",         width: "140px", align: "center" },
  { key: "employment_date", label: "Трудоустройство",      width: "180px" },
];

const DEFAULT_COLS: ColKey[] = ["avatar", "name", "email", "role", "department", "qr_import", "employment_date"];

function buildGrid(visible: Set<ColKey>) {
  const cols = COL_DEFS.filter((c) => visible.has(c.key)).map((c) => c.width);
  // Trailing 24px col for chevron-right (design AAgr3) / cancel × on pending rows.
  return [...cols, "24px"].join(" ");
}

// ── Helpers ──────────────────────────────────────────────────
const inviteSchema = z.object({
  email:  z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите должность"),
});
type InviteForm = z.infer<typeof inviteSchema>;

const createSchema = z.object({
  firstName: z.string().min(1, "Укажите имя"),
  lastName:  z.string().min(1, "Укажите фамилию"),
  phone:     z.string().optional(),
  roleId:    z.string().min(1, "Выберите должность"),
});
type CreateForm = z.infer<typeof createSchema>;

type Role = { id: string; name: string; code: string };

type DepartmentLite = { id: string; name: string };

type Props = {
  staff:          StaffMember[];
  invitations:    PendingInvitation[];
  firedStaff:     FiredStaffMember[];
  roles:          Role[];
  departments:    DepartmentLite[];
  venueId:        string;
  currentUserId:  string;
  activeRoleCode: string | null;
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function displayName(m: { first_name: string | null; last_name: string | null; email: string }): string {
  const n = [m.first_name, m.last_name].filter(Boolean).join(" ");
  return n || m.email.split("@")[0];
}

function genderShort(g: string | null) {
  if (g === "male")   return "М";
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
      label: diffDays === 0 ? "Истекает сегодня" : `Истекает через ${diffDays} дн.`,
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

function StaffAvatar({ member, faded }: {
  member: { avatar_url: string | null; first_name: string | null; last_name: string | null; email: string };
  faded?: boolean;
}) {
  const name = displayName(member);
  if (member.avatar_url) {
    return (
      <img
        src={member.avatar_url}
        alt={name}
        className={`w-8 h-8 rounded-full object-cover shrink-0${faded ? " opacity-50" : ""}`}
      />
    );
  }
  return (
    <div className={`w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0${faded ? " opacity-50" : ""}`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Column settings dropdown ─────────────────────────────────
function ColumnSettings({ visible, onChange }: {
  visible: Set<ColKey>;
  onChange: (key: ColKey, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <IconTooltip label="Столбцы таблицы">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOpen((v) => !v)}>
          <Settings2 className="w-4 h-4" />
        </Button>
      </IconTooltip>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-2 min-w-[200px]">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-2 pb-1.5">
            Столбцы таблицы
          </p>
          {COL_DEFS.filter((c) => !c.required).map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm select-none"
            >
              <input
                type="checkbox"
                checked={visible.has(col.key)}
                onChange={(e) => onChange(col.key, e.target.checked)}
                className="accent-primary"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter dropdown ──────────────────────────────────────────
type Filter = {
  roleId: string | null;
  /** id подразделения, "__none__" — без подразделения, null — без фильтра. */
  departmentId: string | null;
  gender: string | null;
  importedFromQr: "all" | "yes" | "no";
};

function FilterPanel({ filter, onChange, roles, departments }: {
  filter: Filter;
  onChange: (f: Filter) => void;
  roles: Role[];
  departments: DepartmentLite[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const isActive =
    filter.roleId !== null ||
    filter.departmentId !== null ||
    filter.gender !== null ||
    filter.importedFromQr !== "all";

  return (
    <div className="relative" ref={ref}>
      <IconTooltip label={isActive ? "Фильтры (активны)" : "Фильтры"}>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 ${isActive ? "border-primary text-primary" : ""}`}
          onClick={() => setOpen((v) => !v)}
        >
          <Filter className="w-4 h-4" />
        </Button>
      </IconTooltip>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-3 min-w-[220px] space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Фильтры
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">Должность</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.roleId ?? ""}
              onChange={(e) => onChange({ ...filter, roleId: e.target.value || null })}
            >
              <option value="">Все должности</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Подразделение</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.departmentId ?? ""}
              onChange={(e) =>
                onChange({ ...filter, departmentId: e.target.value || null })
              }
            >
              <option value="">Все</option>
              <option value="__none__">Без подразделения</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Пол</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.gender ?? ""}
              onChange={(e) => onChange({ ...filter, gender: e.target.value || null })}
            >
              <option value="">Все</option>
              <option value="male">Мужской</option>
              <option value="female">Женский</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Импорт из QR</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.importedFromQr}
              onChange={(e) =>
                onChange({
                  ...filter,
                  importedFromQr: e.target.value as Filter["importedFromQr"],
                })
              }
            >
              <option value="all">Все</option>
              <option value="yes">Только импортированные</option>
              <option value="no">Только созданные вручную</option>
            </select>
          </div>

          {isActive && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() =>
                onChange({
                  roleId: null,
                  departmentId: null,
                  gender: null,
                  importedFromQr: "all",
                })
              }
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
    </div>
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

  const [staff, setStaff]             = useState(initialStaff);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [fired, setFired]             = useState(initialFired);
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [addMode, setAddMode]         = useState<"email" | "manual">("manual");
  const [isPending, startTransition]  = useTransition();
  const [firedOpen, setFiredOpen]     = useState(false);

  // Column visibility — persisted in localStorage
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_COLS);
    try {
      const saved = localStorage.getItem("crm-staff-visible-cols");
      if (saved) return new Set(JSON.parse(saved) as ColKey[]);
    } catch {}
    return new Set(DEFAULT_COLS);
  });
  const toggleCol = (key: ColKey, on: boolean) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      try { localStorage.setItem("crm-staff-visible-cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const template = buildGrid(visibleCols);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Filter
  const [filter, setFilter] = useState<Filter>({
    roleId: null,
    departmentId: null,
    gender: null,
    importedFromQr: "all",
  });

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

  // ── Filtering logic ────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();

  const filteredStaff = staff.filter((m) => {
    if (q && !displayName(m).toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
    if (filter.roleId  && m.role_id !== filter.roleId)   return false;
    if (filter.gender  && m.gender  !== filter.gender)   return false;
    if (filter.importedFromQr === "yes" && !m.imported_from_quickresto) return false;
    if (filter.importedFromQr === "no" && m.imported_from_quickresto) return false;
    if (filter.departmentId === "__none__" && m.department_id) return false;
    if (
      filter.departmentId &&
      filter.departmentId !== "__none__" &&
      m.department_id !== filter.departmentId
    )
      return false;
    return true;
  });

  const filteredInvitations = invitations.filter((inv) => {
    if (q && !inv.email.toLowerCase().includes(q)) return false;
    if (filter.roleId && inv.role_id !== filter.roleId) return false;
    if (filter.importedFromQr !== "all") return false;
    // Приглашения скрываем, как только включён фильтр по подразделению
    // (у invite ещё нет department — он появится при принятии).
    if (filter.departmentId) return false;
    return true;
  });

  const onInvite = (values: InviteForm) => {
    startTransition(async () => {
      const result = await inviteStaff({ email: values.email, roleId: values.roleId, venueId });
      if (result.error) { toast.error(result.error); return; }
      if (result.invitation) {
        const invitation = result.invitation;
        setInvitations((prev) => {
          const withoutDuplicate = prev.filter((inv) => inv.inv_id !== invitation.inv_id);
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
        lastName:  values.lastName,
        phone:     values.phone || null,
        roleId:    values.roleId,
        venueId,
      });
      if (result.error) { toast.error(result.error); return; }
      // Оптимистично добавляем нового сотрудника в список, чтобы не ждать
      // полного refresh от сервера.
      if (result.member) {
        const member = { ...result.member, imported_from_quickresto: false };
        setStaff((prev) => [...prev, member]);
      }
      toast.success(`Сотрудник «${values.firstName} ${values.lastName}» добавлен`);
      createFormHook.reset();
      setInviteOpen(false);
    });
  };

  const onRestore = (uvrId: string) => {
    startTransition(async () => {
      const result = await restoreStaff(uvrId);
      if (result.error) { toast.error(result.error); return; }
      const member = fired.find((m) => m.uvr_id === uvrId);
      if (member) {
        setStaff((prev) => [...prev, {
          uvr_id:          member.uvr_id,
          user_id:         member.user_id,
          role_id:         member.role_id,
          role_name:       member.role_name,
          role_code:       member.role_code,
          department_id:   null,
          department_name: null,
          first_name:      member.first_name,
          last_name:       member.last_name,
          email:           member.email,
          // Восстановленный сотрудник — статус подтверждения email с сервера
          // подтянется при следующем refresh; пока считаем true (он уже был
          // подтверждённым раньше, иначе не смогли бы fire).
          email_confirmed: true,
          avatar_url:      member.avatar_url,
          phone:             null,
          telegram_id:       null,
          gender:            null,
          birth_date:        null,
          employment_date:   null,
          medical_book_date: null,
          joined_at:         new Date().toISOString(),
        }]);
      }
      setFired((prev) => prev.filter((m) => m.uvr_id !== uvrId));
      toast.success("Сотрудник восстановлен");
    });
  };

  const onCancelInvitation = (invId: string) => {
    startTransition(async () => {
      const result = await cancelInvitation(invId);
      if (result.error) { toast.error(result.error); return; }
      setInvitations((prev) => prev.filter((inv) => inv.inv_id !== invId));
      toast.success("Приглашение отменено");
    });
  };

  const totalCount = staff.length + invitations.length;
  const isFiltered =
    q.length > 0 ||
    filter.roleId !== null ||
    filter.departmentId !== null ||
    filter.gender !== null ||
    filter.importedFromQr !== "all";

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
        const isPlaceholder = member.email.toLowerCase().endsWith("@import.local");
        const isPendingInvite = !isPlaceholder && !member.email_confirmed;
        const medbook = medbookStatus(member.medical_book_date);
        const bday = birthdayStatus(member.birth_date);
        return (
          <div className="min-w-0 flex items-center gap-2">
            <p className="font-medium text-sm truncate min-w-0">
              {displayName(member)}
              {isMe && <span className="ml-2 text-xs text-muted-foreground font-normal">(вы)</span>}
            </p>
            {isPlaceholder && (
              <span
                className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground"
                title="Сотрудник без аккаунта. Когда понадобится дать ему доступ — впишите email в карточке и отправьте приглашение."
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
                title="Приглашение отправлено, но сотрудник ещё не подтвердил email."
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
                title={medbook.title}
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
                title={bday.title}
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
          <div className="text-[13px] text-muted-foreground min-w-0 truncate">
            {member.email.toLowerCase().endsWith("@import.local") ? "Email не указан" : member.email}
          </div>
        );
      case "phone":
        return <div className="text-sm text-muted-foreground truncate">{member.phone || "—"}</div>;
      case "telegram":
        return <div className="text-sm text-muted-foreground truncate">{member.telegram_id || "—"}</div>;
      case "gender":
        return <div className="text-sm text-muted-foreground">{genderShort(member.gender)}</div>;
      case "birth_date":
        return <div className="text-sm text-muted-foreground">{formatDate(member.birth_date)}</div>;
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
              className={`text-xs cursor-pointer hover:bg-accent ${
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
              if (departmentId) router.push(`/people/departments/${departmentId}`);
            }}
            className="text-left text-[13px] text-foreground hover:text-primary truncate"
          >
            {member.department_name}
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
            className="flex items-center gap-1.5 text-[13px] text-foreground"
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
            <span className="text-sm truncate text-foreground/70">{inv.email}</span>
            <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
              <Clock className="w-2.5 h-2.5" />
              <span className="text-[10px] font-medium leading-none">
                Ожидает
              </span>
            </span>
          </div>
        );
      case "role":
        return <Badge variant="secondary" className="text-xs cursor-default">{inv.role_name}</Badge>;
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
    <div className="p-6 md:p-8 w-full">
      {/* Header — типографика и spacing совпадают с roles-client (DS «Page header») */}
      <div className="flex items-end justify-between mb-6 gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight">Сотрудники</h1>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-[12px] font-medium text-muted-foreground/80 tabular-nums">
              {totalCount}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Состав команды, приглашения и список уволенных
            {isFiltered && ` · показано ${filteredStaff.length + filteredInvitations.length}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Expandable search */}
          <div className="flex items-center gap-1">
            {searchOpen && (
              <div className="relative">
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск"
                  className="h-8 w-52 text-sm pr-7"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <IconTooltip label={searchOpen ? "Скрыть поиск" : "Поиск по сотрудникам"}>
              <Button
                variant="outline"
                size="icon"
                className={`h-8 w-8 ${searchOpen ? "border-primary text-primary" : ""}`}
                onClick={() => {
                  if (searchOpen) { setSearchQuery(""); }
                  setSearchOpen((v) => !v);
                }}
              >
                <Search className="w-4 h-4" />
              </Button>
            </IconTooltip>
          </div>

          <FilterPanel filter={filter} onChange={setFilter} roles={roles} departments={departments} />
          <ColumnSettings visible={visibleCols} onChange={toggleCol} />

          {canEdit && (
            <Button onClick={() => setInviteOpen(true)} size="sm">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Добавить
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {staff.length === 0 && invitations.length === 0 && (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <UserPlus className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет сотрудников</p>
          <p className="text-sm text-muted-foreground mt-1">Добавьте первого сотрудника</p>
          {canEdit && (
            <Button onClick={() => setInviteOpen(true)} size="sm" className="mt-4">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Добавить
            </Button>
          )}
        </div>
      )}

      {/* Staff table — карточка по дизайну NQk5c (frame SolGg):
          rounded-xl, border, header bg-muted/60, row padding [14, 20] */}
      {(staff.length > 0 || invitations.length > 0) && (
        <div className="rounded-xl border bg-card overflow-hidden">
          {/* Table header */}
          <div
            className="grid gap-4 px-5 py-3 bg-muted/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b"
            style={{ gridTemplateColumns: template }}
          >
            {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
              <span
                key={col.key}
                className={col.align === "center" ? "text-center" : ""}
              >
                {col.label}
              </span>
            ))}
            <span aria-hidden />
          </div>

          {/* Active staff rows */}
          {filteredStaff.map((member) => (
            <div
              key={member.uvr_id}
              className="grid gap-4 items-center px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
              style={{ gridTemplateColumns: template }}
              onClick={() => router.push(`/people/staff/${member.user_id}`)}
            >
              {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                <div
                  key={col.key}
                  className={`min-w-0 ${col.align === "center" ? "flex items-center justify-center" : ""}`}
                >
                  {renderCell(col.key, member)}
                </div>
              ))}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          ))}

          {/* Pending invitation rows */}
          {filteredInvitations.map((inv) => (
            <div
              key={inv.inv_id}
              className="grid gap-4 items-center px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors"
              style={{ gridTemplateColumns: template }}
            >
              {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                <div
                  key={col.key}
                  className={`min-w-0 ${col.align === "center" ? "flex items-center justify-center" : ""}`}
                >
                  {renderInvCell(col.key, inv)}
                </div>
              ))}
              <div className="flex justify-end">
                {canEdit && (
                  <IconTooltip label="Отменить приглашение">
                    <Button
                      size="icon" variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      onClick={() => onCancelInvitation(inv.inv_id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </IconTooltip>
                )}
              </div>
            </div>
          ))}

          {/* No results from filter */}
          {isFiltered && filteredStaff.length === 0 && filteredInvitations.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              Нет сотрудников, соответствующих фильтрам
            </div>
          )}
        </div>
      )}

      {/* ── Fired staff section ── */}
      {fired.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setFiredOpen((v) => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${firedOpen ? "" : "-rotate-90"}`} />
            Уволенные сотрудники ({fired.length})
          </button>
          {firedOpen && (
            <div className="rounded-xl border bg-card overflow-hidden">
              {fired.map((member) => (
                <div
                  key={member.uvr_id}
                  className="grid grid-cols-[40px_1fr_auto] gap-4 items-center px-5 py-3.5 border-b last:border-b-0"
                >
                  <div className="flex items-center justify-center">
                    <StaffAvatar member={member} faded />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-muted-foreground">{displayName(member)}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {member.role_name} · уволен {formatDate(member.fired_at)}
                    </p>
                    {member.fired_reason && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-secondary/60 px-2.5 py-1.5 text-[13px] text-foreground/80 leading-snug">
                        <MessageSquareQuote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 line-clamp-3">{member.fired_reason}</span>
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <Button
                      size="sm" variant="outline"
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
                    <Label htmlFor="create-first" className="text-[13px] font-medium">
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
                    <Label htmlFor="create-last" className="text-[13px] font-medium">
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
                  <Label htmlFor="create-phone" className="text-[13px] font-medium">Телефон</Label>
                  <Input
                    id="create-phone"
                    type="tel"
                    placeholder="+7 (999) 000-00-00"
                    {...createFormHook.register("phone")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium">
                    Должность <span className="text-destructive">*</span>
                  </Label>
                  <Select onValueChange={(v) => createFormHook.setValue("roleId", v)}>
                    <SelectTrigger><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {createFormHook.formState.errors.roleId && (
                    <p className="text-xs text-destructive">
                      {createFormHook.formState.errors.roleId.message}
                    </p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Вы создаёте карточку сотрудника и ведёте её сами. Когда понадобится дать ему доступ к системе — впишите email на карточке и отправьте приглашение. После этого сотрудник возьмёт управление профилем в свои руки.
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
                    Создать
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="email" className="mt-5">
              <form onSubmit={handleSubmit(onInvite)} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-email" className="text-[13px] font-medium">
                    Email сотрудника <span className="text-destructive">*</span>
                  </Label>
                  <Input id="inv-email" type="email" placeholder="employee@example.com" {...register("email")} />
                  {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium">
                    Должность <span className="text-destructive">*</span>
                  </Label>
                  <Select onValueChange={(v) => setValue("roleId", v)}>
                    <SelectTrigger><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.roleId && <p className="text-sm text-destructive">{errors.roleId.message}</p>}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Сотрудник получит приглашение на указанный email, зарегистрируется сам и будет вести свой профиль самостоятельно.
                </p>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setInviteOpen(false)}>Отмена</Button>
                  <Button type="submit" className="flex-1" disabled={isPending}>Отправить приглашение</Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}
