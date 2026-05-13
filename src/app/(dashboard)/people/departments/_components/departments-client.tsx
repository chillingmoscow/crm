"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Crown,
  Filter,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { paletteText, type PaletteColor } from "@/lib/palette";

import { ICON_REGISTRY } from "../../roles/_components/role-icons";
import { createDepartment, type DepartmentSummary } from "../actions";
import { DepartmentIconPicker } from "./department-icon-picker";

// ── Column definitions ────────────────────────────────────────

type ColKey = "name" | "head" | "roles" | "staff";

const COL_DEFS: {
  key: ColKey;
  label: string;
  width: string;
  align?: "center";
  required?: boolean;
}[] = [
  // По аналогии с roles list (MlKFD/RuvhI): name = 1fr, остальные —
  // фиксированные. Gap 16 (gap-4).
  { key: "name",  label: "Подразделение", width: "minmax(220px, 1fr)", required: true },
  { key: "head",  label: "Руководитель",  width: "180px" },
  { key: "roles", label: "Должности",     width: "140px" },
  { key: "staff", label: "Сотрудники",    width: "140px" },
];

const DEFAULT_COLS: ColKey[] = ["name", "head", "roles", "staff"];

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

// ── Filter dropdown ────────────────────────────────────────────

type DepartmentFilter = {
  head: "all" | "assigned" | "missing";
};

function DepartmentFilterPanel({
  filter,
  onChange,
}: {
  filter: DepartmentFilter;
  onChange: (next: DepartmentFilter) => void;
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

  const isActive = filter.head !== "all";

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
            <Label className="text-xs">Руководящая должность</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.head}
              onChange={(e) =>
                onChange({ head: e.target.value as DepartmentFilter["head"] })
              }
            >
              <option value="all">Все</option>
              <option value="assigned">Назначена</option>
              <option value="missing">Не назначена</option>
            </select>
          </div>
          {isActive && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() => onChange({ head: "all" })}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

interface Props {
  initialDepartments: DepartmentSummary[];
  accountId: string | null;
  canManage: boolean;
}

export function DepartmentsClient({
  initialDepartments,
  accountId,
  canManage,
}: Props) {
  const router = useRouter();
  const [departments, setDepartments] = useState(initialDepartments);
  const [isPending, startTransition] = useTransition();

  // Column visibility — persisted в localStorage по аналогии с roles list.
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_COLS);
    try {
      const saved = localStorage.getItem("crm-departments-visible-cols");
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
        localStorage.setItem(
          "crm-departments-visible-cols",
          JSON.stringify([...next]),
        );
      } catch {}
      return next;
    });
  };

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Filter
  const [filter, setFilter] = useState<DepartmentFilter>({ head: "all" });

  // Create drawer
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  function resetForm() {
    setName("");
    setIcon(null);
    setIconColor(null);
    setDescription("");
  }

  // Filtering
  const q = searchQuery.toLowerCase().trim();
  const filteredDepartments = useMemo(
    () =>
      departments.filter((d) => {
        if (q && !d.name.toLowerCase().includes(q)) return false;
        if (filter.head === "assigned" && !d.head_role_id) return false;
        if (filter.head === "missing" && d.head_role_id) return false;
        return true;
      }),
    [departments, q, filter.head],
  );
  const isFiltered = q.length > 0 || filter.head !== "all";

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createDepartment({
        name: trimmed,
        icon,
        iconColor,
        description: description.trim() || null,
      });
      // `{ id: null, error: null }` — недопустимое состояние контракта,
      // но было прецедент. Guard оставляем, см. #291.
      if (result.error || !result.id) {
        toast.error(result.error ?? "Не удалось создать подразделение");
        return;
      }
      toast.success("Подразделение создано");
      const created: DepartmentSummary = {
        id: result.id,
        name: trimmed,
        icon,
        icon_color: iconColor,
        description: description.trim() || null,
        head_role_id: null,
        head_role_name: null,
        roles_count: 0,
        staff_count: 0,
      };
      setDepartments((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      );
      setSheetOpen(false);
      resetForm();
      router.push(`/people/departments/${result.id}`);
    });
  }

  // Cell renderers
  const renderCell = (key: ColKey, d: DepartmentSummary) => {
    switch (key) {
      case "name": {
        const desc = d.description?.trim();
        return (
          <div className="min-w-0">
            <span className="font-medium text-sm truncate block">{d.name}</span>
            {desc && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {desc}
              </div>
            )}
          </div>
        );
      }
      case "head": {
        if (!d.head_role_name) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="font-medium truncate">{d.head_role_name}</span>
          </div>
        );
      }
      case "roles": {
        if (d.roles_count === 0) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        const label =
          d.roles_count === 1
            ? "должность"
            : d.roles_count < 5
              ? "должности"
              : "должностей";
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex items-center justify-center size-6 rounded-full bg-violet-400 text-white text-[11px] font-semibold">
              {d.roles_count}
            </span>
            <span className="text-muted-foreground">{label}</span>
          </div>
        );
      }
      case "staff": {
        if (d.staff_count === 0) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        const label =
          d.staff_count === 1
            ? "сотрудник"
            : d.staff_count < 5
              ? "сотрудника"
              : "сотрудников";
        return (
          <div className="flex items-center gap-2 text-sm">
            <span className="flex items-center justify-center size-6 rounded-full bg-emerald-400 text-white text-[11px] font-semibold">
              {d.staff_count}
            </span>
            <span className="text-muted-foreground">{label}</span>
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
            <h1 className="text-3xl font-bold tracking-tight">Подразделения</h1>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-[12px] font-medium text-muted-foreground/80 tabular-nums">
              {departments.length}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Группировка должностей в орг-структуре и руководители подразделений
            {isFiltered && ` · показано ${filteredDepartments.length}`}
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
            <IconTooltip
              label={searchOpen ? "Скрыть поиск" : "Поиск по подразделениям"}
            >
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

          <DepartmentFilterPanel filter={filter} onChange={setFilter} />
          <ColumnSettings visible={visibleCols} onChange={toggleCol} />

          {accountId && canManage && (
            <Button
              size="sm"
              onClick={() => {
                resetForm();
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
      {departments.length === 0 && (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <Boxes className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет подразделений</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Объедините похожие должности (например «Бармен», «Помощник бармена»,
            «Старший бармен») в подразделение «Бар» и назначьте руководителя.
          </p>
          {accountId && canManage && (
            <Button
              size="sm"
              className="mt-4"
              onClick={() => {
                resetForm();
                setSheetOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Создать подразделение
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      {departments.length > 0 &&
        (() => {
          const visibleColDefs = COL_DEFS.filter((c) => visibleCols.has(c.key));
          // 36px icon + видимые колонки.
          const gridTemplate = `36px ${visibleColDefs.map((c) => c.width).join(" ")}`;

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
              {filteredDepartments.map((d) => {
                const Icon = (d.icon && ICON_REGISTRY[d.icon]) || Boxes;
                const tintClass = paletteText(d.icon_color as PaletteColor | null);
                return (
                  <div
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    className="grid gap-4 items-center px-5 py-3.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-muted/50"
                    style={{ gridTemplateColumns: gridTemplate }}
                    onClick={() => router.push(`/people/departments/${d.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/people/departments/${d.id}`);
                      }
                    }}
                  >
                    <div
                      className={`flex items-center justify-center size-9 rounded-lg bg-muted ${tintClass || "text-muted-foreground"}`}
                    >
                      <Icon className="w-4 h-4" />
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
                        {renderCell(col.key, d)}
                      </div>
                    ))}
                  </div>
                );
              })}

              {isFiltered && filteredDepartments.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Нет подразделений, соответствующих поиску
                </div>
              )}
            </div>
          );
        })()}

      {/* Create drawer */}
      <EditDrawer
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) resetForm();
        }}
        title="Новое подразделение"
        description="Дайте подразделению имя и иконку. Должности и руководителя можно настроить после создания."
        footer={
          <>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreate} disabled={isPending || !name.trim()}>
              Создать
            </Button>
          </>
        }
      >
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <Label htmlFor="new-dep-name" className="text-[13px] font-medium">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-dep-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Бар"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <DepartmentIconPicker
            value={icon}
            color={iconColor}
            onChange={({ icon: nextIcon, color }) => {
              setIcon(nextIcon);
              setIconColor(color);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-dep-desc" className="text-[13px] font-medium">
            Описание
          </Label>
          <Textarea
            id="new-dep-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Кто входит, чем занимается"
            rows={3}
          />
        </div>

        {/* Hint card в стиле roles drawer (Sparkles + совет). */}
        <div className="flex items-start gap-2.5 rounded-[10px] bg-secondary border border-border p-3.5">
          <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="text-[12px] font-semibold text-secondary-foreground leading-tight">
              Совет
            </p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              После создания зайдите в карточку подразделения, добавьте
              должности на вкладке «Должности» и выберите руководящую —
              например, «Бар-менеджер» для «Бара».
            </p>
          </div>
        </div>
      </EditDrawer>
    </div>
  );
}
