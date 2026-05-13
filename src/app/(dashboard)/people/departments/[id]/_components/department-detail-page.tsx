"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  Crown,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { paletteText, type PaletteColor } from "@/lib/palette";

import { ICON_REGISTRY, iconForRole } from "../../../roles/_components/role-icons";
import { DepartmentIconPicker } from "../../_components/department-icon-picker";
import {
  deleteDepartment,
  setRoleDepartment,
  updateDepartment,
  type Department,
  type DepartmentHead,
  type DepartmentRole,
} from "../../actions";

type AllRole = {
  id: string;
  name: string;
  code: string;
  icon: string | null;
  icon_color: string | null;
  account_id: string | null;
  department_id: string | null;
};

interface Props {
  department: Department;
  initialRoles: DepartmentRole[];
  initialHeads: DepartmentHead[];
  allRoles: AllRole[];
  canManage: boolean;
}

export function DepartmentDetailPage({
  department,
  initialRoles,
  initialHeads,
  allRoles,
  canManage,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description ?? "");
  const [icon, setIcon] = useState<string | null>(department.icon);
  const [iconColor, setIconColor] = useState<string | null>(
    department.icon_color,
  );
  const [headRoleId, setHeadRoleId] = useState<string | null>(
    department.head_role_id,
  );
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState(initialRoles);
  const [heads] = useState(initialHeads);
  const [attachOpen, setAttachOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const Icon = (icon && ICON_REGISTRY[icon]) || Boxes;
  const tintClass = paletteText(iconColor as PaletteColor | null);

  const headerDirty =
    name.trim() !== department.name ||
    (description ?? "").trim() !== (department.description ?? "") ||
    icon !== department.icon ||
    iconColor !== department.icon_color;

  // Должности этого подразделения по id
  const departmentRoleIds = useMemo(
    () => new Set(roles.map((r) => r.id)),
    [roles],
  );

  // Кандидаты для прикрепления — account-scoped роли, не входящие в подразделение.
  const attachableRoles = useMemo(
    () =>
      allRoles.filter(
        (r) => r.account_id !== null && !departmentRoleIds.has(r.id),
      ),
    [allRoles, departmentRoleIds],
  );

  function commitHeader() {
    if (!headerDirty) {
      setEditing(false);
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Название не может быть пустым");
      return;
    }
    startTransition(async () => {
      const result = await updateDepartment(department.id, {
        name: trimmedName,
        description: description.trim() || null,
        icon,
        iconColor,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Сохранено");
      setEditing(false);
      router.refresh();
    });
  }

  function cancelHeaderEdit() {
    setName(department.name);
    setDescription(department.description ?? "");
    setIcon(department.icon);
    setIconColor(department.icon_color);
    setEditing(false);
  }

  function commitHeadRole(nextValue: string | null) {
    setHeadRoleId(nextValue);
    startTransition(async () => {
      const result = await updateDepartment(department.id, {
        headRoleId: nextValue,
      });
      if (result.error) {
        toast.error(result.error);
        setHeadRoleId(department.head_role_id);
        return;
      }
      toast.success(
        nextValue ? "Руководитель назначен" : "Руководитель снят",
      );
      router.refresh();
    });
  }

  function detachRole(roleId: string) {
    startTransition(async () => {
      const result = await setRoleDepartment(roleId, null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      // Если убрали ту, что была руководителем — снимем head.
      if (roleId === headRoleId) setHeadRoleId(null);
      toast.success("Должность откреплена");
      router.refresh();
    });
  }

  function attachRole(role: AllRole) {
    startTransition(async () => {
      const result = await setRoleDepartment(role.id, department.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRoles((prev) =>
        [
          ...prev,
          {
            id: role.id,
            name: role.name,
            code: role.code,
            icon: role.icon,
            icon_color: role.icon_color,
          },
        ].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      );
      toast.success(`«${role.name}» в подразделении`);
      setAttachOpen(false);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDepartment(department.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Подразделение удалено");
      router.push("/people/departments");
    });
  }

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      {/* Back */}
      <div className="mb-4">
        <Link
          href="/people/departments"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Подразделения
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-xl border bg-card p-5 mb-6">
        {!editing ? (
          <div className="flex items-start gap-4">
            <span
              className={`flex items-center justify-center size-12 rounded-lg bg-muted shrink-0 ${
                tintClass || "text-muted-foreground"
              }`}
            >
              <Icon className="w-6 h-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight">
                {department.name}
              </h1>
              {department.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {department.description}
                </p>
              )}
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Изменить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label htmlFor="dep-name" className="text-[13px] font-medium">
                  Название <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dep-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
              <Label htmlFor="dep-desc" className="text-[13px] font-medium">
                Описание
              </Label>
              <Textarea
                id="dep-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={cancelHeaderEdit}>
                Отмена
              </Button>
              <Button
                size="sm"
                onClick={commitHeader}
                disabled={isPending || !name.trim()}
              >
                Сохранить
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Head role */}
      <section className="rounded-xl border bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Crown className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Руководящая должность</h2>
        </div>

        <div className="space-y-3">
          <Select
            value={headRoleId ?? "__none__"}
            onValueChange={(v) =>
              canManage && commitHeadRole(v === "__none__" ? null : v)
            }
            disabled={!canManage || isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Не назначена" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не назначена</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {roles.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Сначала добавьте хотя бы одну должность в подразделение.
            </p>
          )}

          {/* Текущие фактические руководители по venues */}
          {heads.length > 0 && (
            <div className="border-t pt-3 mt-2 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Сейчас руководят
              </p>
              {heads.map((h) => (
                <div
                  key={`${h.venue_id}-${h.user_id}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="text-muted-foreground min-w-[140px] truncate">
                    {h.venue_name}
                  </span>
                  <span className="font-medium truncate">
                    {[h.first_name, h.last_name].filter(Boolean).join(" ") ||
                      "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {headRoleId && heads.length === 0 && (
            <p className="text-xs text-muted-foreground">
              В ваших заведениях нет активных сотрудников с этой должностью.
            </p>
          )}
        </div>
      </section>

      {/* Roles */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            Должности в подразделении
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {roles.length}
            </span>
          </h2>
          {canManage && attachableRoles.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAttachOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Добавить должность
            </Button>
          )}
        </div>

        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            В подразделении пока нет должностей.
          </p>
        ) : (
          <div className="divide-y">
            {roles.map((r) => {
              const RoleIcon = iconForRole(r.code, r.icon);
              const roleTint = paletteText(r.icon_color as PaletteColor | null);
              const isHead = r.id === headRoleId;
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    className={`flex items-center justify-center size-8 rounded-md bg-muted shrink-0 ${
                      roleTint || "text-muted-foreground"
                    }`}
                  >
                    <RoleIcon className="w-4 h-4" />
                  </span>
                  <Link
                    href={`/people/roles/${r.id}`}
                    className="font-medium text-sm hover:underline flex-1 min-w-0 truncate"
                  >
                    {r.name}
                  </Link>
                  {isHead && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                      <Crown className="w-3 h-3" />
                      Руководитель
                    </span>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => detachRole(r.id)}
                      disabled={isPending}
                      aria-label="Открепить должность"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Attach role dialog */}
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить должность в подразделение</DialogTitle>
            <DialogDescription>
              Выберите должность, которую нужно отнести к «{department.name}».
              Системные должности недоступны.
            </DialogDescription>
          </DialogHeader>
          {attachableRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Все ваши должности уже распределены.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {attachableRoles.map((r) => {
                const RoleIcon = iconForRole(r.code, r.icon);
                const roleTint = paletteText(
                  r.icon_color as PaletteColor | null,
                );
                return (
                  <button
                    key={r.id}
                    onClick={() => attachRole(r)}
                    disabled={isPending}
                    className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/50 px-2 -mx-2 rounded-md transition-colors"
                  >
                    <span
                      className={`flex items-center justify-center size-8 rounded-md bg-muted shrink-0 ${
                        roleTint || "text-muted-foreground"
                      }`}
                    >
                      <RoleIcon className="w-4 h-4" />
                    </span>
                    <span className="font-medium text-sm flex-1 min-w-0 truncate">
                      {r.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить подразделение?</DialogTitle>
            <DialogDescription>
              Должности останутся, но потеряют привязку к этому подразделению.
              Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
