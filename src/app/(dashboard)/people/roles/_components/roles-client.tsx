"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Shield,
  Search,
  Settings2,
  X,
  Check,
  Filter,
  Lock,
} from "lucide-react";
import { iconForRole } from "./role-icons";
import { IconPicker } from "./icon-picker";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { createRole } from "../actions";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  account_id: string | null;
  name: string;
  code: string;
  comment: string | null;
  icon: string | null;
  icon_color: string | null;
  department_id: string | null;
};

type Permission = {
  id: string;
};

type RolePermission = {
  role_id: string;
  permission_id: string;
  granted: boolean;
};

type DepartmentLite = {
  id: string;
  name: string;
};

type Props = {
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  accountId: string | null;
  staffCountByRole: Record<string, number>;
  importedRoleIds: string[];
  departments: DepartmentLite[];
};

// ── Column definitions ────────────────────────────────────────

type ColKey = "name" | "department" | "staff" | "permissions" | "qr_import";

const COL_DEFS: {
  key: ColKey;
  label: string;
  width: string;
  /** "center" centers both header label and cell content; default = left */
  align?: "center";
  required?: boolean;
}[] = [
  // Точно по дизайну MlKFD/RuvhI: name = 1fr, staff = 140, perms = 220
  // (фиксированный — прогресс-бар не должен растягиваться на полэкрана),
  // qr_import = 100. Gap между колонками — 16 (gap-4).
  { key: "name",        label: "Должность",    width: "minmax(220px, 1fr)", required: true },
  { key: "department",  label: "Подразделение",width: "160px" },
  { key: "staff",       label: "Сотрудники",   width: "140px" },
  { key: "permissions", label: "Права",        width: "220px" },
  { key: "qr_import",   label: "Импорт из QR", width: "100px", align: "center" },
];

const DEFAULT_COLS: ColKey[] = ["name", "department", "staff", "permissions", "qr_import"];

// ── Column settings dropdown ──────────────────────────────────

function ColumnSettings({
  visible,
  onChange,
}: {
  visible: Set<ColKey>;
  onChange: (k: ColKey, on: boolean) => void;
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
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setOpen((v) => !v)}
        >
          <Settings2 className="w-4 h-4" />
        </Button>
      </IconTooltip>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-2 min-w-[180px]">
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

type RoleFilter = {
  importedFromQr: "all" | "yes" | "no";
  /** id подразделения, "__none__" — без подразделения, "all" — без фильтра. */
  departmentId: string;
};

function RoleFilterPanel({
  filter,
  departments,
  onChange,
}: {
  filter: RoleFilter;
  departments: DepartmentLite[];
  onChange: (next: RoleFilter) => void;
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
    filter.importedFromQr !== "all" || filter.departmentId !== "all";

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
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-3 min-w-[240px] space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Фильтры
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Подразделение</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.departmentId}
              onChange={(e) =>
                onChange({
                  ...filter,
                  departmentId: e.target.value,
                })
              }
            >
              <option value="all">Все</option>
              <option value="__none__">Без подразделения</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
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
                  importedFromQr: e.target.value as RoleFilter["importedFromQr"],
                })
              }
            >
              <option value="all">Все</option>
              <option value="yes">Только импортированные</option>
              <option value="no">Только созданные вручную</option>
            </select>
          </div>
          {isActive ? (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() =>
                onChange({ importedFromQr: "all", departmentId: "all" })
              }
            >
              Сбросить фильтры
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

export function RolesClient({
  roles: initialRoles,
  permissions,
  rolePermissions,
  accountId,
  staffCountByRole,
  importedRoleIds,
  departments,
}: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const importedSet = useMemo(() => new Set(importedRoleIds), [importedRoleIds]);
  const [isPending, startTransition] = useTransition();

  // Column visibility — persisted in localStorage
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_COLS);
    try {
      const saved = localStorage.getItem("crm-roles-visible-cols");
      if (saved) return new Set(JSON.parse(saved) as ColKey[]);
    } catch {}
    return new Set(DEFAULT_COLS);
  });
  const toggleCol = (key: ColKey, on: boolean) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem("crm-roles-visible-cols", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };
  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<RoleFilter>({
    importedFromQr: "all",
    departmentId: "all",
  });
  const departmentNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Create drawer
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleIcon, setNewRoleIcon] = useState<string | null>(null);
  const [newRoleIconColor, setNewRoleIconColor] = useState<string | null>(null);
  // "" = create from scratch; otherwise = source role id to copy permissions from
  const [copyFromRoleId, setCopyFromRoleId] = useState<string>("");

  // Roles available as a "copy from" source — exclude the role being created.
  // Sorted: system roles first, then custom by name.
  const copyableRoles = useMemo(
    () =>
      [...roles].sort((a, b) => {
        if (a.account_id === null && b.account_id !== null) return -1;
        if (a.account_id !== null && b.account_id === null) return 1;
        return a.name.localeCompare(b.name, "ru");
      }),
    [roles],
  );

  function getGrantedCount(roleId: string): number {
    return rolePermissions.filter((rp) => rp.role_id === roleId && rp.granted).length;
  }

  // Filtering
  const q = searchQuery.toLowerCase().trim();
  const filteredRoles = roles.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    const imported = importedSet.has(r.id);
    if (filter.importedFromQr === "yes" && !imported) return false;
    if (filter.importedFromQr === "no" && imported) return false;
    if (filter.departmentId === "__none__" && r.department_id) return false;
    if (
      filter.departmentId !== "all" &&
      filter.departmentId !== "__none__" &&
      r.department_id !== filter.departmentId
    )
      return false;
    return true;
  });
  const isFiltered =
    q.length > 0 ||
    filter.importedFromQr !== "all" ||
    filter.departmentId !== "all";

  function handleCreate() {
    const name = newRoleName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createRole({
        name,
        copyFromRoleId: copyFromRoleId || undefined,
        icon: newRoleIcon,
        iconColor: newRoleIconColor,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Должность создана");
      }
      if (result.id) {
        const created: Role = {
          id: result.id,
          account_id: accountId,
          name,
          code: `custom_${name
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, "")
            .substring(0, 40)}`,
          comment: null,
          icon: newRoleIcon,
          icon_color: newRoleIconColor,
          department_id: null,
        };
        setRoles((prev) => [...prev, created]);
        setSheetOpen(false);
        setNewRoleName("");
        setNewRoleIcon(null);
        setNewRoleIconColor(null);
        setCopyFromRoleId("");
        router.push(`/people/roles/${result.id}`);
      }
    });
  }

  // Cell renderers
  const renderCell = (key: ColKey, role: Role) => {
    switch (key) {
      case "name": {
        const desc = role.comment?.trim();
        const isSystem = role.account_id === null;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-sm truncate">{role.name}</span>
              {isSystem && (
                // Matches iXYPZ in design: lock 10 + 10/500 text muted-foreground,
                // bg-secondary, NO border, NO uppercase, gap 4, padding [2,6].
                <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  <Lock className="w-2.5 h-2.5" />
                  <span className="text-[10px] font-medium leading-none">
                    Системная
                  </span>
                </span>
              )}
            </div>
            {desc && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {desc}
              </div>
            )}
          </div>
        );
      }
      case "department": {
        const name = role.department_id
          ? departmentNameById.get(role.department_id) ?? null
          : null;
        if (!name) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <span className="text-[13px] text-foreground truncate">{name}</span>
        );
      }
      case "staff": {
        const count = staffCountByRole[role.id] ?? 0;
        if (count === 0) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        const label =
          count === 1
            ? "сотрудник"
            : count < 5
            ? "сотрудника"
            : "сотрудников";
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex items-center justify-center size-6 rounded-full bg-violet-400 text-white text-[11px] font-semibold">
              {count}
            </span>
            <span className="text-muted-foreground">{label}</span>
          </div>
        );
      }
      case "permissions": {
        const granted = getGrantedCount(role.id);
        const total = permissions.length;
        const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
        const isFull = pct === 100;
        return (
          // Per design (J6GKvm): width 220 fixed (set in COL_DEFS), text colors
          // per state — count в foreground/600, percent в brand/500 при 100%
          // (highlight) или muted/500 иначе. Bar 6px, brand fill, muted track.
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-foreground">
                {granted} из {total}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  isFull ? "text-brand" : "text-muted-foreground"
                }`}
              >
                {pct}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      }
      case "qr_import": {
        const imported = importedSet.has(role.id);
        return (
          <div className="flex items-center" aria-label={imported ? "Да" : "Нет"}>
            {imported ? (
              <Check className="w-4 h-4 text-brand" />
            ) : (
              <X className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        );
      }
    }
  };

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight">Должности</h1>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-[12px] font-medium text-muted-foreground/80 tabular-nums">
              {roles.length}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Управление должностями и настройка прав доступа
            {isFiltered && ` · показано ${filteredRoles.length}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-1">
            {searchOpen && (
              <div className="relative">
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск"
                  className="h-8 w-48 text-sm pr-7"
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
            <IconTooltip label={searchOpen ? "Скрыть поиск" : "Поиск по должностям"}>
              <Button
                variant="outline"
                size="icon"
                className={`h-8 w-8 ${searchOpen ? "border-primary text-primary" : ""}`}
                onClick={() => {
                  if (searchOpen) setSearchQuery("");
                  setSearchOpen((v) => !v);
                }}
              >
                <Search className="w-4 h-4" />
              </Button>
            </IconTooltip>
          </div>

          <RoleFilterPanel filter={filter} departments={departments} onChange={setFilter} />
          <ColumnSettings visible={visibleCols} onChange={toggleCol} />

          {accountId && (
            <Button
              size="sm"
              onClick={() => {
                setNewRoleName("");
                setSheetOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Добавить
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {roles.length === 0 && (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <Shield className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет должностей</p>
          <p className="text-sm text-muted-foreground mt-1">Создайте первую должность</p>
          {accountId && (
            <Button
              size="sm"
              className="mt-4"
              onClick={() => {
                setNewRoleName("");
                setSheetOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Добавить должность
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      {roles.length > 0 && (() => {
        const visibleColDefs = COL_DEFS.filter((c) => visibleCols.has(c.key));
        // 36px icon + configurable cols (no trailing chevron — design dropped it)
        const gridTemplate = `36px ${visibleColDefs
          .map((c) => c.width)
          .join(" ")}`;

        return (
          <div className="rounded-xl border bg-card overflow-hidden">
            {/* Header row */}
            <div
              className="grid gap-4 px-5 py-3 bg-muted/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span aria-hidden />
              {visibleColDefs.map((col) => (
                <span
                  key={col.key}
                  className={col.align === "center" ? "text-center" : undefined}
                >
                  {col.label}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {filteredRoles.map((role) => {
              const isOwner = role.code === "owner";
              const RoleIcon = iconForRole(role.code, role.icon);
              const tintClass = paletteText(role.icon_color as PaletteColor | null);
              return (
                <div
                  key={role.id}
                  className="grid gap-4 items-center px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  style={{ gridTemplateColumns: gridTemplate }}
                  onClick={() => router.push(`/people/roles/${role.id}`)}
                >
                  {/* Icon — owner всегда brand-tinted (системная роль),
                      остальные — palette tint поверх muted фона (или default). */}
                  <div
                    className={`flex items-center justify-center size-9 rounded-lg ${
                      isOwner
                        ? "bg-brand/10 text-brand"
                        : `bg-muted ${tintClass || "text-muted-foreground"}`
                    }`}
                  >
                    <RoleIcon className="w-4 h-4" />
                  </div>

                  {visibleColDefs.map((col) => (
                    <div
                      key={col.key}
                      className={`min-w-0 ${
                        col.align === "center"
                          ? "flex items-center justify-center"
                          : ""
                      }`}
                    >
                      {renderCell(col.key, role)}
                    </div>
                  ))}
                </div>
              );
            })}

            {isFiltered && filteredRoles.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Нет должностей, соответствующих поиску
              </div>
            )}
          </div>
        );
      })()}

      {/* Create drawer (520px, design-system pattern) */}
      <EditDrawer
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setNewRoleName("");
            setNewRoleIcon(null);
            setNewRoleIconColor(null);
            setCopyFromRoleId("");
          }
        }}
        title="Новая должность"
        description="Создайте роль с нуля или скопируйте права у существующей."
        footer={
          <>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isPending || !newRoleName.trim()}
            >
              Создать
            </Button>
          </>
        }
      >
        {/* Name (left, flex-1) + Icon picker (right, compact) — consistent
            with detail Settings tab; matches design J0qwQg row pattern. */}
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <Label htmlFor="new-role-name" className="text-[13px] font-medium">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-role-name"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Например: Бармен"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <IconPicker
            value={newRoleIcon}
            color={newRoleIconColor}
            roleCode=""
            onChange={({ icon, color }) => {
              setNewRoleIcon(icon);
              setNewRoleIconColor(color);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="copy-from" className="text-[13px] font-medium">
            На основе существующей роли
          </Label>
          <Select
            value={copyFromRoleId || "__none__"}
            onValueChange={(v) => setCopyFromRoleId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="copy-from">
              <SelectValue placeholder="Не копировать — настроить с нуля" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                Не копировать — настроить с нуля
              </SelectItem>
              {copyableRoles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  {r.account_id === null && (
                    <span className="text-muted-foreground"> · системная</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Hint card per design (sparkles + tip) */}
        <div className="flex items-start gap-2.5 rounded-[10px] bg-secondary border border-border p-3.5">
          <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="text-[12px] font-semibold text-secondary-foreground leading-tight">
              Совет
            </p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Скопируйте «Хостес» или «Официант», если новая роль похожа —
              настроить только разницу прав быстрее, чем 48 чекбоксов с нуля.
            </p>
          </div>
        </div>
      </EditDrawer>
    </div>
  );
}
