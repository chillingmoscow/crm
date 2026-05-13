"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Lock, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { deleteRole, setRolePermission, updateRole } from "../../actions";
import { setRoleDepartment } from "../../../departments/actions";
import { metaForModule, sortModuleKeys } from "./permission-modules";
import { IconPicker } from "../../_components/icon-picker";
import { iconForRole } from "../../_components/role-icons";
import { paletteText, type PaletteColor } from "@/lib/palette";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import type { AuditEvent } from "@/lib/audit/list";

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
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

type DepartmentOption = {
  id: string;
  name: string;
};

type Permission = {
  id: string;
  code: string;
  description: string;
  module: string;
};

type RolePermission = {
  role_id: string;
  permission_id: string;
  granted: boolean;
};

type Props = {
  role: Role;
  permissions: Permission[];
  rolePermissions: RolePermission[];
  accountId: string | null;
  importedFromQuickResto: boolean;
  /** Display name «Имя Ф.» of role.created_by (null if unavailable) */
  createdByName: string | null;
  updatedByName: string | null;
  /** Список подразделений активного аккаунта (для селекта в «Основном»). */
  departments: DepartmentOption[];
  canViewAudit: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
};

type TabKey = "main" | "permissions" | "compensation" | "history" | "danger";

// ── Component ────────────────────────────────────────────────

export function RoleDetailPage({
  role,
  permissions,
  rolePermissions: initialRolePerms,
  accountId,
  createdByName,
  updatedByName,
  departments,
  canViewAudit,
  initialAuditEvents,
  initialAuditHasMore,
}: Props) {
  const router = useRouter();
  const [rolePermissions, setRolePerms] = useState(initialRolePerms);
  // «Основное» — first tab + default by design RbRH4.
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Settings tab state
  const [nameValue, setNameValue] = useState(role.name);
  const [commentValue, setCommentValue] = useState(role.comment ?? "");
  const [iconValue, setIconValue] = useState<string | null>(role.icon);
  const [iconColorValue, setIconColorValue] = useState<string | null>(
    role.icon_color ?? null,
  );
  const [departmentId, setDepartmentId] = useState<string | null>(
    role.department_id,
  );
  const dirty =
    nameValue.trim() !== role.name ||
    (commentValue || null) !== role.comment ||
    iconValue !== role.icon ||
    iconColorValue !== (role.icon_color ?? null) ||
    departmentId !== role.department_id;

  // Permissions search
  const [permQuery, setPermQuery] = useState("");

  const isOwner = role.code === "owner";
  // После миграции 138 единственная системная роль — owner. Все остальные
  // (Управляющий/Администратор/Бухгалтер/…) — кастомные per-account.
  const isSystem = role.account_id === null;
  const canEdit = !isOwner;
  // Owner и системные роли (после миграции — только owner) не удаляются.
  // Кастомка — физический DELETE.
  const canDelete = !isOwner && !isSystem && accountId !== null;

  // ── Helpers ────────────────────────────────────────────────

  function hasPermission(permId: string): boolean {
    return rolePermissions.some(
      (rp) =>
        rp.role_id === role.id && rp.permission_id === permId && rp.granted,
    );
  }

  function applyPermissionLocal(permissionId: string, granted: boolean) {
    setRolePerms((prev) => {
      const existing = prev.find((rp) => rp.permission_id === permissionId);
      if (existing) {
        return prev.map((rp) =>
          rp.permission_id === permissionId ? { ...rp, granted } : rp,
        );
      }
      return [...prev, { role_id: role.id, permission_id: permissionId, granted }];
    });
  }

  function handleToggle(permissionId: string) {
    if (!canEdit) return;
    const next = !hasPermission(permissionId);
    const previous = !next;
    applyPermissionLocal(permissionId, next);

    startTransition(async () => {
      const result = await setRolePermission(role.id, permissionId, next);
      if (result.error) {
        toast.error(result.error);
        applyPermissionLocal(permissionId, previous);
      }
    });
  }

  function handleBulkSet(perms: Permission[], target: boolean) {
    if (!canEdit) return;
    // Optimistic UI: set all locally, then fire requests in parallel.
    const toToggle = perms.filter((p) => hasPermission(p.id) !== target);
    if (toToggle.length === 0) return;
    toToggle.forEach((p) => applyPermissionLocal(p.id, target));

    startTransition(async () => {
      const results = await Promise.all(
        toToggle.map((p) => setRolePermission(role.id, p.id, target)),
      );
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) {
        toast.error(`Не удалось обновить ${failed} из ${toToggle.length} прав`);
        // Roll back failed ones — keep simple: re-fetch best left to caller refresh.
        router.refresh();
      }
    });
  }

  function handleSave() {
    startTransition(async () => {
      // Codex P1 на #299: если updateRole удачно сохранил поля, а
      // setRoleDepartment упал (RLS/trigger/RPC) — оставался partial
      // write без refresh'а, UI расходился с БД.
      //
      // Реордер: сначала меняем привязку к подразделению (отдельная
      // транзакция в Postgres через RPC), потом — основные поля.
      // Подразделение валится чаще (триггеры на department_id,
      // dep_select_member RLS), поэтому ставим его первым: если упало
      // — основные поля даже не трогали, БД консистентна, ничего
      // refresh'ить не надо. Если повалился второй UPDATE (роль)
      // после успешного первого — делаем router.refresh(), чтобы UI
      // увидел уже изменённый department_id.
      if (departmentId !== role.department_id) {
        const depResult = await setRoleDepartment(role.id, departmentId);
        if (depResult.error) {
          toast.error(depResult.error);
          setDepartmentId(role.department_id);
          return;
        }
      }

      const result = await updateRole(role.id, {
        name: nameValue,
        comment: commentValue || null,
        icon: iconValue,
        iconColor: iconColorValue,
      });
      if (result.error) {
        toast.error(result.error);
        router.refresh(); // sync UI с уже применённым изменением department
        return;
      }
      toast.success("Изменения сохранены");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteRole(role.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Должность удалена");
      router.push("/people/roles");
    });
  }

  // ── Derived ────────────────────────────────────────────────

  // Group permissions by module, filtered by search
  const groupedPermissions = useMemo(() => {
    const q = permQuery.toLowerCase().trim();
    const filtered = q
      ? permissions.filter((p) => p.description.toLowerCase().includes(q))
      : permissions;
    const byModule: Record<string, Permission[]> = {};
    for (const p of filtered) {
      (byModule[p.module] ??= []).push(p);
    }
    return sortModuleKeys(Object.keys(byModule)).map((key) => ({
      key,
      meta: metaForModule(key),
      perms: byModule[key],
    }));
  }, [permissions, permQuery]);

  // Total permissions per module (for "X из Y" display, ignoring search filter)
  const totalsByModule = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of permissions) {
      t[p.module] = (t[p.module] ?? 0) + 1;
    }
    return t;
  }, [permissions]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col">
      {/* Breadcrumb in layout's top bar (left side) */}
      <PageBreadcrumb>
        <Link
          href="/people/roles"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Должности
        </Link>
      </PageBreadcrumb>

      {/* Info popover in layout's top bar (right side, next to bell) */}
      <PageHeaderActions>
        <EntityInfoPopover
          title="О должности"
          id={role.id}
          createdAt={role.created_at}
          createdByName={createdByName}
          updatedAt={role.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      {/* Page body */}
      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        {/* Header — без CTA. Save живёт в футере формы на табе «Основное»
            и появляется только когда есть что сохранять. Это убирает
            «висящую» disabled-кнопку и микро-shift при переключении табов. */}
        <div className="flex items-center gap-4 min-w-0">
          {/* 56px icon-плашка слева от H1 — по аналогии с хедером
              карточки сотрудника (см. staff-detail-page.tsx). Иконка
              рендерится через iconForRole (резолвит role.icon из
              ICON_REGISTRY либо fallback по системному code'у); цвет
              тинта — из palette по role.icon_color. */}
          {(() => {
            const HeaderIcon = iconForRole(role.code, iconValue);
            const isOwner = role.code === "owner";
            const tintClass = paletteText(iconColorValue as PaletteColor | null);
            return (
              <div
                className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${
                  isOwner
                    ? "bg-brand/10 text-brand"
                    : `bg-muted ${tintClass || "text-muted-foreground"}`
                }`}
              >
                <HeaderIcon className="w-7 h-7" />
              </div>
            );
          })()}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {/* h1 size matches design (yU4hW/RbRH4: 28px / -0.5 letter-spacing) */}
              <h1 className="text-[28px] font-bold tracking-tight leading-tight">
                {role.name}
              </h1>
              {role.account_id === null && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  <Lock className="w-2.5 h-2.5" />
                  <span className="text-[10px] font-medium leading-none">
                    Системная
                  </span>
                </span>
              )}
            </div>
            {role.comment && (
              <p className="text-sm text-muted-foreground leading-snug">
                {role.comment}
              </p>
            )}
          </div>
        </div>

        {/* Tabs — «Основное» first per design RbRH4 */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
        >
          {/* Centered tabs per design D6IWjE (justify-content: center) */}
          <TabsList className="justify-center">
            <TabsTrigger value="main">Основное</TabsTrigger>
            <TabsTrigger value="permissions">Права доступа</TabsTrigger>
            <TabsTrigger value="compensation">Оплата труда</TabsTrigger>
            {canViewAudit && (
              <TabsTrigger value="history">Журнал</TabsTrigger>
            )}
            {canDelete && (
              <TabsTrigger
                value="danger"
                className="data-[state=active]:text-destructive data-[state=active]:border-destructive"
              >
                Опасная зона
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Permissions ───────────────────────────────────── */}
          <TabsContent value="permissions" className="space-y-4">
            {isOwner && (
              <p className="text-sm text-muted-foreground rounded-lg bg-muted px-4 py-3">
                Системная должность — права нельзя изменить
              </p>
            )}

            {/* Toolbar: search + bulk */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative w-full max-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={permQuery}
                  onChange={(e) => setPermQuery(e.target.value)}
                  placeholder="Найти право…"
                  className="pl-9 h-9 text-[13px]"
                />
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBulkSet(permissions, true)}
                    disabled={isPending}
                  >
                    Выделить всё
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBulkSet(permissions, false)}
                    disabled={isPending}
                  >
                    Сбросить
                  </Button>
                </div>
              )}
            </div>

            {/* Module group cards */}
            {groupedPermissions.length === 0 && (
              <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-8 text-center">
                По запросу «{permQuery}» ничего не найдено
              </div>
            )}
            {groupedPermissions.map(({ key, meta, perms }) => {
              const Icon = meta.icon;
              // Master state must reflect the WHOLE module, not the
              // search-filtered subset — otherwise a fully-granted module
              // can render the switch as off whenever a query hides some
              // rows, and toggling would issue spurious bulk writes.
              const allModulePerms = permissions.filter((p) => p.module === key);
              const grantedInGroup = allModulePerms.filter((p) =>
                hasPermission(p.id),
              ).length;
              const totalInGroup = totalsByModule[key];
              const allGranted =
                totalInGroup > 0 && grantedInGroup === totalInGroup;
              return (
                <div
                  key={key}
                  className="rounded-[14px] border bg-card overflow-hidden"
                >
                  {/* Group header */}
                  <div className="flex items-center gap-3 bg-muted px-5 py-3.5 border-b">
                    <div className="flex items-center justify-center size-7 rounded-lg bg-brand/10 shrink-0">
                      <Icon className="w-4 h-4 text-brand" />
                    </div>
                    <span className="text-sm font-semibold">{meta.label}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-muted-foreground bg-secondary border">
                      {grantedInGroup} из {totalInGroup}
                    </span>
                    <div className="flex-1" />
                    {canEdit && (
                      <Switch
                        checked={allGranted}
                        onCheckedChange={(checked) =>
                          handleBulkSet(allModulePerms, checked)
                        }
                        disabled={isPending}
                        aria-label={`${meta.label} — переключить все права`}
                      />
                    )}
                  </div>

                  {/* Rows */}
                  <div>
                    {perms.map((perm, i) => {
                      const granted = hasPermission(perm.id);
                      return (
                        <div
                          key={perm.id}
                          className={`flex items-center gap-3 px-5 py-3 ${
                            i < perms.length - 1 ? "border-b" : ""
                          }`}
                        >
                          <Checkbox
                            id={`perm-${perm.id}`}
                            checked={granted}
                            disabled={!canEdit}
                            onCheckedChange={() => handleToggle(perm.id)}
                          />
                          <label
                            htmlFor={`perm-${perm.id}`}
                            className={`text-[13px] leading-tight select-none ${
                              !canEdit
                                ? "cursor-default text-muted-foreground"
                                : "cursor-pointer text-foreground"
                            }`}
                          >
                            {perm.description}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* ── Compensation (stub) ───────────────────────────── */}
          <TabsContent value="compensation">
            <div className="rounded-lg border border-dashed p-16 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                Оплата труда
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Раздел в разработке
              </p>
            </div>
          </TabsContent>

          {/* ── Main (Основное) — centered form per design c0jKNc.
                Info card вынесен в popover в header'е (см. PageHeaderActions) */}
          <TabsContent value="main">
            <div className="flex justify-center">
              <div className="w-full max-w-[720px] flex flex-col gap-5">
                {isSystem && (
                  <div className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-3 border border-amber-200 bg-amber-50 text-amber-800">
                    <Lock className="w-4 h-4 shrink-0" />
                    <p className="text-[13px] font-medium leading-snug">
                      Это системная должность. Некоторые права и название изменить нельзя.
                    </p>
                  </div>
                )}

                {/* Name (left, flex-1) + Icon picker (right, compact) — matches J0qwQg */}
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <Label htmlFor="role-name" className="text-[13px] font-medium">
                      Название
                    </Label>
                    <Input
                      id="role-name"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      readOnly={!canEdit}
                      className={!canEdit ? "bg-muted/50" : ""}
                      placeholder="Название должности"
                    />
                  </div>
                  <IconPicker
                    value={iconValue}
                    color={iconColorValue}
                    roleCode={role.code}
                    onChange={({ icon, color }) => {
                      setIconValue(icon);
                      setIconColorValue(color);
                    }}
                    disabled={!canEdit}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="role-department" className="text-[13px] font-medium">
                    Подразделение
                  </Label>
                  <Select
                    value={departmentId ?? "__none__"}
                    onValueChange={(v) => {
                      if (!canEdit || isSystem) return;
                      setDepartmentId(v === "__none__" ? null : v);
                    }}
                    disabled={!canEdit || isSystem || isPending}
                  >
                    <SelectTrigger id="role-department">
                      <SelectValue placeholder="Без подразделения" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Без подразделения</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isSystem && (
                    <p className="text-xs text-muted-foreground">
                      Системные должности нельзя относить к подразделению.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="role-comment" className="text-[13px] font-medium">
                    Описание
                  </Label>
                  <Textarea
                    id="role-comment"
                    value={commentValue}
                    onChange={(e) => setCommentValue(e.target.value)}
                    readOnly={!canEdit}
                    className={!canEdit ? "bg-muted/50" : ""}
                    placeholder="Для чего используется роль, кому назначается…"
                    rows={4}
                  />
                </div>

                {/* Form footer — Save виден всегда, статус меняется:
                    активен (brand) когда есть что сохранять, иначе secondary
                    (#f5f5f5) с приглушённым текстом и без hover. */}
                {(() => {
                  const isSaveActive =
                    canEdit && dirty && nameValue.trim().length > 0;
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

          {/* ── Журнал ─────────────────────────────────────────── */}
          {canViewAudit && (
            <TabsContent value="history">
              <EntityAuditTab
                mode="entity"
                entityType="role"
                entityId={role.id}
                canView={canViewAudit}
                initialEvents={initialAuditEvents}
                initialHasMore={initialAuditHasMore}
              />
            </TabsContent>
          )}

          {/* ── Danger zone ───────────────────────────────────── */}
          {canDelete && (
            <TabsContent value="danger">
              <div className="max-w-[720px] mx-auto rounded-[14px] border bg-card p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-foreground">
                    Удалить должность
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Должность «{nameValue || role.name}» будет удалена
                    безвозвратно. Сотрудники с этой ролью потеряют доступ —
                    переназначьте их перед удалением.
                  </p>
                </div>
                <div>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить должность
                  </Button>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Delete confirmation modal */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить должность?</DialogTitle>
            <DialogDescription>
              Должность «{nameValue || role.name}» будет удалена. Действие
              нельзя отменить.
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
              <Trash2 className="w-4 h-4" />
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// (RoleInfoCard переехал в общий <EntityInfoPopover> в header — см.
// PageHeaderActions выше и src/components/shared/entity-info-popover.tsx)
