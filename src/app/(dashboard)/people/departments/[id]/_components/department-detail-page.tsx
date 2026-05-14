"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Boxes,
  ChevronLeft,
  Crown,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import type { AuditEvent } from "@/lib/audit/list";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";

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
  venue_id: string | null;
  department_id: string | null;
};

type TabKey = "main" | "roles" | "history" | "danger";

interface Props {
  department: Department;
  initialRoles: DepartmentRole[];
  initialHeads: DepartmentHead[];
  allRoles: AllRole[];
  canManage: boolean;
  canViewAudit: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  /** Display name «Имя Ф.» для created_by / updated_by (для info popover). */
  createdByName: string | null;
  updatedByName: string | null;
}

export function DepartmentDetailPage({
  department,
  initialRoles,
  initialHeads,
  allRoles,
  canManage,
  canViewAudit,
  initialAuditEvents,
  initialAuditHasMore,
  createdByName,
  updatedByName,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Editable «Основное» state
  const [nameValue, setNameValue] = useState(department.name);
  const [commentValue, setCommentValue] = useState(department.description ?? "");
  const [iconValue, setIconValue] = useState<string | null>(department.icon);
  const [iconColorValue, setIconColorValue] = useState<string | null>(
    department.icon_color,
  );
  const [headRoleId, setHeadRoleId] = useState<string | null>(
    department.head_role_id,
  );

  const [roles, setRoles] = useState(initialRoles);
  const [heads] = useState(initialHeads);
  const [attachOpen, setAttachOpen] = useState(false);

  // Сравниваем trimmed-значения — иначе trailing space в description
  // делает форму permanently dirty: handleSave всё равно отправит
  // commentValue.trim(), сервер сохранит «нет изменений», но в UI
  // commentValue остаётся с пробелом → dirty не сбрасывается.
  const dirty =
    nameValue.trim() !== department.name ||
    commentValue.trim() !== (department.description ?? "") ||
    iconValue !== department.icon ||
    iconColorValue !== department.icon_color ||
    headRoleId !== department.head_role_id;

  // Должности этого подразделения по id
  const departmentRoleIds = useMemo(
    () => new Set(roles.map((r) => r.id)),
    [roles],
  );

  // Кандидаты для прикрепления — account-scoped роли, не входящие в подразделение.
  const attachableRoles = useMemo(
    () =>
      allRoles.filter(
        (r) => r.venue_id !== null && !departmentRoleIds.has(r.id),
      ),
    [allRoles, departmentRoleIds],
  );

  // ── Mutations ──────────────────────────────────────────────

  function handleSave() {
    const trimmedName = nameValue.trim();
    if (!trimmedName) {
      toast.error("Название не может быть пустым");
      return;
    }
    // `head_role_id` шлём только если поменялся: триггер
    // `trg_departments_check_head_role` срабатывает на UPDATE OF
    // head_role_id ВСЕГДА, когда колонка в SET — даже если значение
    // то же. Если в БД уже неконсистентное состояние (head_role был
    // детачнут из подразделения через /people/roles flow), любой
    // save с присутствующим head_role_id отвалится. Отправляем
    // только реально dirty-поля.
    const patch: Parameters<typeof updateDepartment>[1] = {
      name: trimmedName,
      description: commentValue.trim() || null,
      icon: iconValue,
      iconColor: iconColorValue,
    };
    if (headRoleId !== department.head_role_id) {
      patch.headRoleId = headRoleId;
    }
    startTransition(async () => {
      const result = await updateDepartment(department.id, patch);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Изменения сохранены");
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

  // ── Render ─────────────────────────────────────────────────

  const HeaderIcon = (iconValue && ICON_REGISTRY[iconValue]) || Boxes;
  const headerTint = paletteText(iconColorValue as PaletteColor | null);

  return (
    <div className="flex-1 flex flex-col">
      {/* Breadcrumb in layout's top bar (left side) — паттерн из role detail */}
      <PageBreadcrumb>
        <Link
          href="/people/departments"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Подразделения
        </Link>
      </PageBreadcrumb>

      {/* Info popover в top bar справа от bell */}
      <PageHeaderActions>
        <EntityInfoPopover
          title="О подразделении"
          id={department.id}
          createdAt={department.created_at}
          createdByName={createdByName}
          updatedAt={department.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        {/* Header — 56px icon + h1 + description */}
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center bg-muted ${
              headerTint || "text-muted-foreground"
            }`}
          >
            <HeaderIcon className="w-7 h-7" />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight leading-tight">
              {department.name}
            </h1>
            {department.description && (
              <p className="text-sm text-muted-foreground leading-snug">
                {department.description}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList className="justify-center">
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="roles">Должности</TabsTrigger>
            {canViewAudit && (
              <TabsTrigger value="history">Журнал</TabsTrigger>
            )}
            {canManage && (
              <TabsTrigger
                value="danger"
                className="data-[state=active]:text-destructive data-[state=active]:border-destructive"
              >
                Опасная зона
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Main ─────────────────────────────────────────── */}
          <TabsContent value="main">
            <div className="flex justify-center">
              <div className="w-full max-w-[720px] flex flex-col gap-5">
                {/* Name + icon */}
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <Label htmlFor="dep-name" className="text-[13px] font-medium">
                      Название
                    </Label>
                    <Input
                      id="dep-name"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      readOnly={!canManage}
                      className={!canManage ? "bg-muted/50" : ""}
                      placeholder="Название подразделения"
                    />
                  </div>
                  <DepartmentIconPicker
                    value={iconValue}
                    color={iconColorValue}
                    onChange={({ icon, color }) => {
                      setIconValue(icon);
                      setIconColorValue(color);
                    }}
                    disabled={!canManage}
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label htmlFor="dep-desc" className="text-[13px] font-medium">
                    Описание
                  </Label>
                  <Textarea
                    id="dep-desc"
                    value={commentValue}
                    onChange={(e) => setCommentValue(e.target.value)}
                    readOnly={!canManage}
                    className={!canManage ? "bg-muted/50" : ""}
                    placeholder="Кто входит, чем занимается"
                    rows={4}
                  />
                </div>

                {/* Head role — instant change. Под select'ом — фактические
                    руководители по venues (read-only справка). */}
                <div className="space-y-1.5">
                  <Label htmlFor="dep-head" className="text-[13px] font-medium">
                    Руководящая должность
                  </Label>
                  <Select
                    value={headRoleId ?? "__none__"}
                    onValueChange={(v) => {
                      if (!canManage) return;
                      setHeadRoleId(v === "__none__" ? null : v);
                    }}
                    disabled={!canManage || isPending || roles.length === 0}
                  >
                    <SelectTrigger id="dep-head">
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
                      Сначала добавьте хотя бы одну должность во вкладке «Должности».
                    </p>
                  )}

                  {heads.length > 0 && (
                    <div className="border-t pt-3 mt-3 space-y-2">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
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
                            {[h.first_name, h.last_name]
                              .filter(Boolean)
                              .join(" ") || "—"}
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

                {/* Save button — паттерн из role detail */}
                {(() => {
                  const isSaveActive =
                    canManage && dirty && nameValue.trim().length > 0;
                  return (
                    <div className="flex justify-end pt-1">
                      <Button
                        onClick={handleSave}
                        variant={isSaveActive ? "default" : "secondary"}
                        disabled={!isSaveActive || isPending}
                        className={
                          isSaveActive
                            ? ""
                            : "disabled:opacity-100 text-muted-foreground hover:bg-secondary cursor-default"
                        }
                      >
                        {isPending && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        Сохранить
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </TabsContent>

          {/* ── Roles tab ────────────────────────────────────── */}
          <TabsContent value="roles" className="space-y-4">
            <div className="flex justify-center">
              <div className="w-full max-w-[720px] flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Должности в подразделении
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        {roles.length}
                      </span>
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Объедините похожие должности в этот блок.
                    </p>
                  </div>
                  {canManage && attachableRoles.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAttachOpen(true)}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" />
                      Добавить
                    </Button>
                  )}
                </div>

                {roles.length === 0 ? (
                  <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      В подразделении пока нет должностей.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-card divide-y">
                    {roles.map((r) => {
                      const RoleIcon = iconForRole(r.code, r.icon);
                      const roleTint = paletteText(
                        r.icon_color as PaletteColor | null,
                      );
                      const isHead = r.id === headRoleId;
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-3 px-4 py-3"
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
              </div>
            </div>
          </TabsContent>

          {/* ── Журнал ──────────────────────────────────────── */}
          {canViewAudit && (
            <TabsContent value="history">
              <EntityAuditTab
                mode="entity"
                entityType="department"
                entityId={department.id}
                canView={canViewAudit}
                initialEvents={initialAuditEvents}
                initialHasMore={initialAuditHasMore}
              />
            </TabsContent>
          )}

          {/* ── Опасная зона ────────────────────────────────── */}
          {canManage && (
            <TabsContent value="danger">
              <div className="max-w-[720px] mx-auto rounded-[14px] border bg-card p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-foreground">
                    Удалить подразделение
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Подразделение «{nameValue || department.name}» будет
                    удалено. Должности останутся, но потеряют привязку
                    к этому подразделению.
                  </p>
                </div>
                <div>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить подразделение
                  </Button>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

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
              Должности останутся, но потеряют привязку. Это действие нельзя
              отменить.
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
