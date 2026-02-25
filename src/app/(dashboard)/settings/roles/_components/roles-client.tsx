"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Shield, Search, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createRole } from "../actions";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  account_id: string | null;
  name: string;
  code: string;
};

type Permission = {
  id: string;
};

type RolePermission = {
  role_id: string;
  permission_id: string;
  granted: boolean;
};

type Props = {
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  accountId: string | null;
  staffCountByRole: Record<string, number>;
};

// ── Column definitions ────────────────────────────────────────

type ColKey = "name" | "staff" | "permissions";

const COL_DEFS: { key: ColKey; label: string; width: string; required?: boolean }[] = [
  { key: "name",        label: "Название",   width: "1fr",   required: true },
  { key: "staff",       label: "Сотрудники", width: "120px" },
  { key: "permissions", label: "Права",      width: "80px"  },
];

const DEFAULT_COLS: ColKey[] = ["name", "staff", "permissions"];

function buildGrid(visible: Set<ColKey>) {
  return COL_DEFS.filter((c) => visible.has(c.key)).map((c) => c.width).join(" ");
}

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
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 className="w-4 h-4" />
      </Button>
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

// ── Main component ─────────────────────────────────────────────

export function RolesClient({
  roles: initialRoles,
  permissions,
  rolePermissions,
  accountId,
  staffCountByRole,
}: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
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
  const template = buildGrid(visibleCols);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Create sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  function getGrantedCount(roleId: string): number {
    return rolePermissions.filter((rp) => rp.role_id === roleId && rp.granted).length;
  }

  // Filtering
  const q = searchQuery.toLowerCase().trim();
  const filteredRoles = roles.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const isFiltered = q.length > 0;

  function handleCreate() {
    const name = newRoleName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createRole(name);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Должность создана");
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
        };
        setRoles((prev) => [...prev, created]);
        setSheetOpen(false);
        setNewRoleName("");
        router.push(`/settings/roles/${result.id}`);
      }
    });
  }

  // Cell renderers
  const renderCell = (key: ColKey, role: Role) => {
    switch (key) {
      case "name":
        return <div className="font-medium text-sm truncate">{role.name}</div>;
      case "staff":
        return (
          <div className="text-sm text-muted-foreground">
            {staffCountByRole[role.id] ?? 0}
          </div>
        );
      case "permissions":
        return (
          <div className="text-sm text-muted-foreground">
            {getGrantedCount(role.id)}/{permissions.length}
          </div>
        );
    }
  };

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Должности</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {roles.length > 0
              ? `${roles.length} ${
                  roles.length === 1
                    ? "должность"
                    : roles.length < 5
                    ? "должности"
                    : "должностей"
                }`
              : "Нет должностей"}
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
          </div>

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
      {roles.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Header row */}
          <div
            className="grid gap-3 px-4 py-3 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b"
            style={{ gridTemplateColumns: template }}
          >
            {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
              <span key={col.key}>{col.label}</span>
            ))}
          </div>

          {/* Data rows */}
          {filteredRoles.map((role, i) => (
            <div key={role.id}>
              {i > 0 && <Separator />}
              <div
                className="grid gap-3 items-center px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: template }}
                onClick={() => router.push(`/settings/roles/${role.id}`)}
              >
                {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                  <div key={col.key}>{renderCell(col.key, role)}</div>
                ))}
              </div>
            </div>
          ))}

          {isFiltered && filteredRoles.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Нет должностей, соответствующих поиску
            </div>
          )}
        </div>
      )}

      {/* Create sheet */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setNewRoleName("");
        }}
      >
        <SheetContent className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Новая должность</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-role-name">Название</Label>
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
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSheetOpen(false)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreate}
                disabled={isPending || !newRoleName.trim()}
              >
                Создать
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
