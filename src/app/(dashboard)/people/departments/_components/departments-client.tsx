"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Crown, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { paletteText, type PaletteColor } from "@/lib/palette";

import { ICON_REGISTRY } from "../../roles/_components/role-icons";
import { createDepartment, type DepartmentSummary } from "../actions";
import { DepartmentIconPicker } from "./department-icon-picker";

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
      if (result.error || !result.id) {
        // Включая edge-case «server вернул { id: null, error: null }» —
        // раньше показывали зелёный toast при пустом id, юзер думал
        // что всё ок, а строка не появлялась. Теперь action возвращает
        // явный error для этой ветки (см. actions.ts), а UI здесь
        // подстраховывается на случай будущих регрессий.
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
          </p>
        </div>

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

      {/* List */}
      {departments.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => {
            const Icon = (d.icon && ICON_REGISTRY[d.icon]) || Boxes;
            const tint = paletteText(d.icon_color as PaletteColor | null);
            return (
              <button
                key={d.id}
                onClick={() => router.push(`/people/departments/${d.id}`)}
                className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex items-center justify-center size-10 rounded-lg bg-muted shrink-0 ${
                      tint || "text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm truncate">{d.name}</h3>
                    {d.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {d.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {d.roles_count} {pluralRoles(d.roles_count)} ·{" "}
                    {d.staff_count} {pluralStaff(d.staff_count)}
                  </span>
                </div>

                {d.head_role_name ? (
                  <div className="flex items-center gap-1.5 mt-2 text-xs">
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-muted-foreground">Руководитель:</span>
                    <span className="font-medium truncate">
                      {d.head_role_name}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Руководитель не назначен
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

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
      </EditDrawer>
    </div>
  );
}

function pluralRoles(n: number): string {
  if (n === 1) return "должность";
  if (n >= 2 && n <= 4) return "должности";
  return "должностей";
}

function pluralStaff(n: number): string {
  if (n === 1) return "сотрудник";
  if (n >= 2 && n <= 4) return "сотрудника";
  return "сотрудников";
}
