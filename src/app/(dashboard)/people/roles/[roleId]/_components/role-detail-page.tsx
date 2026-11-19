"use client";

import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SaveBar } from "@/components/shared/save-bar";

import { RoleCompensation } from "../../../payroll/_components/role-compensation";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Search, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, ProfileTabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteRole, setRolePermission, setRoleScheduleVisibility, updateRole } from "../../actions";
import { setRoleDepartment } from "../../../departments/actions";
import {
  metaForModule,
  sortModuleKeys,
  INVENTORY_ACTS_MODULES,
  INVENTORY_ACTS_ANCHOR_MODULE,
} from "./permission-modules";
import { InventoryActsPermissionSection } from "./inventory-acts-permission-section";
import { IconPicker } from "../../_components/icon-picker";
import { iconForRole } from "../../_components/role-icons";
import { paletteText, type PaletteColor } from "@/lib/palette";
import {
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import type { AuditEvent } from "@/lib/audit/list";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  venue_id: string | null;
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
  showInSchedule: boolean;
  canEditSchedule: boolean;
  initialCompensation?: boolean;
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
  showInSchedule,
  canEditSchedule,
  initialCompensation,
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
  const [activeTab, setActiveTab] = useState<TabKey>(initialCompensation ? "compensation" : "main");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Обновление данных после сохранения — отдельный переход: общий
  // isPending занят и переключением прав, и откреплением должностей.
  const [refreshing, startRefresh] = useTransition();

  // Settings tab state
  const [nameValue, setNameValue] = useState(role.name);
  const [commentValue, setCommentValue] = useState(role.comment ?? "");
  const [scheduleVisible, setScheduleVisible] = useState(showInSchedule);
  const [iconValue, setIconValue] = useState<string | null>(role.icon);
  const [iconColorValue, setIconColorValue] = useState<string | null>(
    role.icon_color ?? null,
  );
  const [departmentId, setDepartmentId] = useState<string | null>(
    role.department_id,
  );
  const detailsDirty =
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
  const isSystem = role.venue_id === null;
  const canEdit = !isOwner;
  const saveDetails = canEdit && detailsDirty;
  const saveVisibility = canEditSchedule && scheduleVisible !== showInSchedule;
  const isDirty = saveDetails || saveVisibility;
  const saveBlocked =
    saveDetails && nameValue.trim().length === 0
      ? "Укажите название должности"
      : null;
  const [saving, setSaving] = useState(false);

  function resetDetails() {
    setNameValue(role.name);
    setCommentValue(role.comment ?? "");
    setScheduleVisible(showInSchedule);
    setIconValue(role.icon);
    setIconColorValue(role.icon_color ?? null);
    setDepartmentId(role.department_id);
  }
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

  async function handleSave() {
    if (!isDirty || saveBlocked || saving) return;
    setSaving(true);
    try {
      if (saveDetails) {
        if (departmentId !== role.department_id) {
          const result = await setRoleDepartment(role.id, departmentId);
          if (result.error) {
            toast.error(result.error);
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
          router.refresh();
          return;
        }
      }
      if (saveVisibility) {
        const result = await setRoleScheduleVisibility(role.id, scheduleVisible);
        if (result.error) {
          toast.error(result.error);
          router.refresh();
          return;
        }
      }
      toast.success("Изменения сохранены");
      // Полоса пропадёт, когда придут свежие данные: до этого она остаётся
      // в состоянии «Сохраняем…», а не снова предлагает сохранить.
      startRefresh(() => router.refresh());
    } catch {
      toast.error("Не удалось сохранить изменения. Проверьте подключение и повторите");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteRole(role.id);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      toast.success("Должность удалена");
      router.push("/people/roles");
    });
  }

  // ── Derived ────────────────────────────────────────────────

  // Group permissions by module, filtered by search.
  // Модули кластера «Акты инвентаризации» (документы/интеграция/scope) кроме
  // якорного НЕ попадают в обычные группы — они отрисованы единой секцией
  // с уровнями в позиции якоря (см. InventoryActsPermissionSection).
  const absorbedActsModules = INVENTORY_ACTS_MODULES.filter(
    (m) => m !== INVENTORY_ACTS_ANCHOR_MODULE,
  );
  const groupedPermissions = useMemo(() => {
    const q = permQuery.toLowerCase().trim();
    const filtered = q
      ? permissions.filter((p) => p.description.toLowerCase().includes(q))
      : permissions;
    const byModule: Record<string, Permission[]> = {};
    for (const p of filtered) {
      if (absorbedActsModules.includes(p.module)) continue;
      (byModule[p.module] ??= []).push(p);
    }
    // Кластер актов рендерится единой карточкой по якорю. Если поиск совпал
    // ТОЛЬКО с поглощёнными правами (integration/scope, напр. «Quick Resto»),
    // якорь сам в byModule не попадёт — добавляем плейсхолдер, чтобы карточка
    // всё равно показалась и право можно было найти (Codex P2 #409).
    const clusterMatchesQuery =
      !q ||
      permissions.some(
        (p) =>
          INVENTORY_ACTS_MODULES.includes(p.module) &&
          p.description.toLowerCase().includes(q),
      );
    if (clusterMatchesQuery && !byModule[INVENTORY_ACTS_ANCHOR_MODULE]) {
      byModule[INVENTORY_ACTS_ANCHOR_MODULE] = [];
    }
    return sortModuleKeys(Object.keys(byModule)).map((key) => ({
      key,
      meta: metaForModule(key),
      perms: byModule[key],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, permQuery]);

  // Все права кластера «Акты инвентаризации» (без фильтра поиска) — для секции.
  const inventoryActsPerms = useMemo(
    () => permissions.filter((p) => INVENTORY_ACTS_MODULES.includes(p.module)),
    [permissions],
  );

  function applyInventoryActsCodes(grantCodes: Set<string>) {
    if (!canEdit) return;
    const toGrant = inventoryActsPerms.filter(
      (p) => grantCodes.has(p.code) && !hasPermission(p.id),
    );
    const toRevoke = inventoryActsPerms.filter(
      (p) => !grantCodes.has(p.code) && hasPermission(p.id),
    );
    if (toGrant.length === 0 && toRevoke.length === 0) return;
    toGrant.forEach((p) => applyPermissionLocal(p.id, true));
    toRevoke.forEach((p) => applyPermissionLocal(p.id, false));
    startTransition(async () => {
      const results = await Promise.all([
        ...toGrant.map((p) => setRolePermission(role.id, p.id, true)),
        ...toRevoke.map((p) => setRolePermission(role.id, p.id, false)),
      ]);
      if (results.some((r) => r.error)) {
        toast.error("Не удалось обновить часть прав");
        router.refresh();
      }
    });
  }

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
      <Breadcrumbs
        items={[
          { label: "Люди" },
          { label: "Должности", href: "/people/roles" },
          { label: role.name },
        ]}
      />

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
      <ProfilePageFrame>
        {(() => {
          // 56px плитка с иконкой должности вместо фото: сущность не человек.
          const HeaderIcon = iconForRole(role.code, iconValue);
          const tintClass = paletteText(iconColorValue as PaletteColor | null);
          return (
            <ProfileHeader
              name={role.name}
              wrapName
              avatar={
                <div
                  aria-hidden
                  className={`w-14 h-14 rounded-[14px] flex items-center justify-center ${
                    isOwner
                      ? "bg-brand/10 text-brand-tint-foreground"
                      : `bg-muted ${tintClass || "text-muted-foreground"}`
                  }`}
                >
                  <HeaderIcon className="w-7 h-7" />
                </div>
              }
            >
              {role.comment && (
                <span className="text-sm text-muted-foreground">
                  {role.comment}
                </span>
              )}
              {isSystem && (
                <StatusBadge icon={<Lock />}>Системная</StatusBadge>
              )}
            </ProfileHeader>
          );
        })()}

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
        >
          <ProfileTabsList>
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
          </ProfileTabsList>

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
              // Кластер «Акты инвентаризации» — единая секция с уровнями
              // (Исполнитель / Редактор / Полный доступ) вместо простыни галок.
              if (key === INVENTORY_ACTS_ANCHOR_MODULE) {
                return (
                  <InventoryActsPermissionSection
                    key={key}
                    clusterPerms={inventoryActsPerms}
                    isGranted={hasPermission}
                    canEdit={canEdit}
                    isPending={isPending}
                    onToggle={handleToggle}
                    onApplyCodes={applyInventoryActsCodes}
                  />
                );
              }
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold text-muted-foreground bg-secondary border">
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
            {role.venue_id ? <RoleCompensation roleId={role.id}/> : <p className="py-8 text-sm text-muted-foreground">Условия оплаты задаются для должности конкретного заведения.</p>}
          </TabsContent>

          {/* ── Main (Основное). Info card вынесен в popover в топбаре
                (см. PageHeaderActions). Сохраняет полоса внизу колонки. */}
          <TabsContent value="main" className="flex flex-col gap-5">
            {isSystem && (
              <div className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-3 border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                <Lock className="w-4 h-4 shrink-0" />
                <p className="text-[13px] font-medium leading-snug">
                  Это системная должность. Некоторые права и название изменить нельзя.
                </p>
              </div>
            )}

            <ProfileSection title="Основное">
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
                  disabled={!canEdit || isSystem || saving}
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
                  placeholder="Для чего используется должность, кому назначается…"
                  rows={4}
                />
              </div>
            </ProfileSection>

            <ProfileSection title="Расписание">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label
                    htmlFor="role-show-in-schedule"
                    className="text-[13px] font-medium"
                  >
                    Показывать в расписании
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Сотрудники этой должности видны при планировании. Уже назначенные смены остаются в графике.
                  </p>
                </div>
                <Switch
                  id="role-show-in-schedule"
                  checked={scheduleVisible}
                  onCheckedChange={setScheduleVisible}
                  disabled={!canEditSchedule || saving}
                />
              </div>
            </ProfileSection>
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
              <div className="rounded-[14px] border bg-card p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-foreground">
                    Удалить должность
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Должность «{role.name}» будет удалена безвозвратно.
                    Сотрудники этой должности потеряют доступ, поэтому
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

        <SaveBar
          dirty={isDirty}
          saving={saving || refreshing}
          blocked={saveBlocked}
          onSave={() => void handleSave()}
          onReset={resetDetails}
        />
      </ProfilePageFrame>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          setConfirmDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
        title={`Удалить должность «${role.name}»?`}
        description="Действие нельзя отменить. Сотрудники этой должности потеряют доступ."
        confirmLabel="Удалить должность"
        pendingLabel="Удаляем…"
        destructive
        busy={isPending}
        error={deleteError}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// (RoleInfoCard переехал в общий <EntityInfoPopover> в header — см.
// PageHeaderActions выше и src/components/shared/entity-info-popover.tsx)
