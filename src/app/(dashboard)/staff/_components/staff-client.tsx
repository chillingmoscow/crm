/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  UserPlus, Calendar, Clock, X, Settings2,
  ChevronDown, RotateCcw, Search, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  inviteStaff,
  restoreStaff,
  cancelInvitation,
} from "../actions";
import type { StaffMember, PendingInvitation, FiredStaffMember } from "../actions";

// ── Column definitions ───────────────────────────────────────
type ColKey =
  | "avatar" | "name" | "email" | "phone" | "telegram"
  | "gender" | "birth_date" | "role" | "employment_date";

const COL_DEFS: {
  key: ColKey; label: string; width: string; required?: boolean;
  headerClass?: string;
}[] = [
  { key: "avatar",          label: "Фото",                 width: "44px" },
  { key: "name",            label: "Имя",                  width: "1fr",   required: true },
  { key: "email",           label: "Email",                width: "1fr" },
  { key: "phone",           label: "Телефон",              width: "140px" },
  { key: "telegram",        label: "Telegram",             width: "120px" },
  { key: "gender",          label: "Пол",                  width: "60px" },
  { key: "birth_date",      label: "Дата рождения",        width: "120px" },
  { key: "role",            label: "Должность",            width: "140px" },
  { key: "employment_date", label: "Трудоустройство",      width: "160px", headerClass: "text-right" },
];

const DEFAULT_COLS: ColKey[] = ["avatar", "name", "email", "role", "employment_date"];

function buildGrid(visible: Set<ColKey>) {
  const cols = COL_DEFS.filter((c) => visible.has(c.key)).map((c) => c.width);
  return [...cols, "40px"].join(" ");
}

// ── Helpers ──────────────────────────────────────────────────
const inviteSchema = z.object({
  email:  z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите должность"),
});
type InviteForm = z.infer<typeof inviteSchema>;

type Role = { id: string; name: string; code: string };

type Props = {
  staff:          StaffMember[];
  invitations:    PendingInvitation[];
  firedStaff:     FiredStaffMember[];
  roles:          Role[];
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
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOpen((v) => !v)}>
        <Settings2 className="w-4 h-4" />
      </Button>
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
type Filter = { roleId: string | null; gender: string | null };

function FilterPanel({ filter, onChange, roles }: {
  filter: Filter;
  onChange: (f: Filter) => void;
  roles: Role[];
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

  const isActive = filter.roleId !== null || filter.gender !== null;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="icon"
        className={`h-8 w-8 ${isActive ? "border-primary text-primary" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="w-4 h-4" />
      </Button>
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

          {isActive && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() => onChange({ roleId: null, gender: null })}
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
  venueId,
  currentUserId,
  activeRoleCode,
}: Props) {
  const router = useRouter();

  const [staff, setStaff]             = useState(initialStaff);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [fired, setFired]             = useState(initialFired);
  const [inviteOpen, setInviteOpen]   = useState(false);
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
  const [filter, setFilter] = useState<Filter>({ roleId: null, gender: null });

  const canEdit = ["owner", "manager", "admin"].includes(activeRoleCode ?? "");

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({ resolver: zodResolver(inviteSchema) });

  // ── Filtering logic ────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();

  const filteredStaff = staff.filter((m) => {
    if (q && !displayName(m).toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
    if (filter.roleId  && m.role_id !== filter.roleId)   return false;
    if (filter.gender  && m.gender  !== filter.gender)   return false;
    return true;
  });

  const filteredInvitations = invitations.filter((inv) => {
    if (q && !inv.email.toLowerCase().includes(q)) return false;
    if (filter.roleId && inv.role_id !== filter.roleId) return false;
    return true;
  });

  const onInvite = (values: InviteForm) => {
    startTransition(async () => {
      const result = await inviteStaff({ email: values.email, roleId: values.roleId, venueId });
      if (result.error) { toast.error(result.error); return; }
      toast.success(`Приглашение отправлено на ${values.email}`);
      reset();
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
          first_name:      member.first_name,
          last_name:       member.last_name,
          email:           member.email,
          avatar_url:      member.avatar_url,
          phone:           null,
          telegram_id:     null,
          gender:          null,
          birth_date:      null,
          employment_date: null,
          joined_at:       new Date().toISOString(),
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
  const isFiltered = q.length > 0 || filter.roleId !== null || filter.gender !== null;

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
      case "name":
        return (
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {displayName(member)}
              {isMe && <span className="ml-2 text-xs text-muted-foreground font-normal">(вы)</span>}
            </p>
          </div>
        );
      case "email":
        return <div className="text-sm text-muted-foreground min-w-0 truncate">{member.email}</div>;
      case "phone":
        return <div className="text-sm text-muted-foreground truncate">{member.phone || "—"}</div>;
      case "telegram":
        return <div className="text-sm text-muted-foreground truncate">{member.telegram_id || "—"}</div>;
      case "gender":
        return <div className="text-sm text-muted-foreground">{genderShort(member.gender)}</div>;
      case "birth_date":
        return <div className="text-sm text-muted-foreground">{formatDate(member.birth_date)}</div>;
      case "role":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/settings/roles/${member.role_id}`);
            }}
            className="text-left"
          >
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer hover:bg-accent"
            >
              {member.role_name}
            </Badge>
          </button>
        );
      case "employment_date":
        return (
          <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
            <Calendar className="w-3 h-3 shrink-0" />
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
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 shrink-0">
              Ожидает
            </Badge>
          </div>
        );
      case "role":
        return <Badge variant="secondary" className="text-xs cursor-default">{inv.role_name}</Badge>;
      case "employment_date":
        return (
          <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
            <Calendar className="w-3 h-3 shrink-0" />
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
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Сотрудники</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalCount > 0
              ? `${totalCount} ${totalCount === 1 ? "сотрудник" : totalCount < 5 ? "сотрудника" : "сотрудников"}`
              : "Нет сотрудников"}
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
          </div>

          <FilterPanel filter={filter} onChange={setFilter} roles={roles} />
          <ColumnSettings visible={visibleCols} onChange={toggleCol} />

          {canEdit && (
            <Button onClick={() => setInviteOpen(true)} size="sm">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Пригласить
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {staff.length === 0 && invitations.length === 0 && (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <UserPlus className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет сотрудников</p>
          <p className="text-sm text-muted-foreground mt-1">Пригласите первого сотрудника в заведение</p>
          {canEdit && (
            <Button onClick={() => setInviteOpen(true)} size="sm" className="mt-4">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Пригласить
            </Button>
          )}
        </div>
      )}

      {/* Staff table */}
      {(staff.length > 0 || invitations.length > 0) && (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div
            className="grid gap-3 px-4 py-3 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b"
            style={{ gridTemplateColumns: template }}
          >
            {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
              <span key={col.key} className={col.headerClass ?? ""}>{col.label}</span>
            ))}
            <span />
          </div>

          {/* Active staff rows */}
          {filteredStaff.map((member, i) => (
            <div key={member.uvr_id}>
              {i > 0 && <Separator />}
              <div
                className="grid gap-3 items-center px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: template }}
                onClick={() => router.push(`/staff/${member.user_id}`)}
              >
                {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                  <div key={col.key}>{renderCell(col.key, member)}</div>
                ))}
                <div />
              </div>
            </div>
          ))}

          {/* Pending invitation rows */}
          {filteredInvitations.map((inv) => (
            <div key={inv.inv_id}>
              <Separator />
              <div
                className="grid gap-3 items-center px-4 py-3 hover:bg-muted/30 transition-colors"
                style={{ gridTemplateColumns: template }}
              >
                {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                  <div key={col.key}>{renderInvCell(col.key, inv)}</div>
                ))}
                <div className="flex justify-end">
                  {canEdit && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      onClick={() => onCancelInvitation(inv.inv_id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* No results from filter */}
          {isFiltered && filteredStaff.length === 0 && filteredInvitations.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
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
            <div className="rounded-lg border overflow-hidden">
              {fired.map((member, i) => (
                <div key={member.uvr_id}>
                  {i > 0 && <Separator />}
                  <div className="grid grid-cols-[44px_1fr_auto] gap-3 items-center px-4 py-3">
                    <div className="flex items-center justify-center">
                      <StaffAvatar member={member} faded />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate text-muted-foreground">{displayName(member)}</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        {member.role_name} · уволен {formatDate(member.fired_at)}
                      </p>
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite sheet */}
      <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Пригласить сотрудника</SheetTitle></SheetHeader>
          <form onSubmit={handleSubmit(onInvite)} className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="inv-email">Email сотрудника *</Label>
              <Input id="inv-email" type="email" placeholder="employee@example.com" {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Должность *</Label>
              <Select onValueChange={(v) => setValue("roleId", v)}>
                <SelectTrigger><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.roleId && <p className="text-sm text-destructive">{errors.roleId.message}</p>}
            </div>
            <p className="text-sm text-muted-foreground">
              Сотруднику будет отправлено приглашение на указанный email.
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setInviteOpen(false)}>Отмена</Button>
              <Button type="submit" className="flex-1" disabled={isPending}>Отправить приглашение</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
