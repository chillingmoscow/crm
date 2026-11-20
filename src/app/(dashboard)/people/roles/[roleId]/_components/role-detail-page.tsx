"use client";

import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { ProfileSection } from "@/components/shared/profile-section";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import { SaveBar } from "@/components/shared/save-bar";

import { RoleCompensation } from "../../../payroll/_components/role-compensation";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Tabs, ProfileTabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { deleteRole, setRoleScheduleVisibility, updateRole } from "../../actions";
import { setRoleDepartment } from "../../../departments/actions";
import { RolePermissionsTab } from "./role-permissions-tab";
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
                      ? "bg-brand/10 text-brand"
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
              <TabsTrigger value="danger">Опасная зона</TabsTrigger>
            )}
          </ProfileTabsList>

          {/* ── Permissions ───────────────────────────────────── */}
          <TabsContent value="permissions">
            <RolePermissionsTab
              roleId={role.id}
              permissions={permissions}
              rolePermissions={rolePermissions}
              onRolePermissionsChange={setRolePerms}
              readOnly={!canEdit}
            />
          </TabsContent>

          {/* ── Compensation (stub) ───────────────────────────── */}
          <TabsContent value="compensation">
            {role.venue_id ? <RoleCompensation roleId={role.id}/> : <p className="py-8 text-sm text-muted-foreground">Условия оплаты задаются для должности конкретного заведения.</p>}
          </TabsContent>

          {/* ── Main (Основное). Info card вынесен в popover в топбаре
                (см. PageHeaderActions). Сохраняет полоса внизу колонки. */}
          <TabsContent value="main" className="flex flex-col gap-5">
            <ProfileSection
              title="Основное"
              locked={
                !canEdit
                  ? { tone: "locked", message: "Системную должность владельца изменить нельзя" }
                  : undefined
              }
            >
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSave();
                }}
              >
                {/* Enter в поле сохраняет форму; видимая кнопка — в полосе. */}
                <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
                <div className="flex items-end gap-2">
                  <Field id="role-name" label="Название" required className="flex-1">
                    {(control) => (
                      <Input
                        {...control}
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        disabled={!canEdit}
                        placeholder="Например: Бармен"
                        maxLength={120}
                      />
                    )}
                  </Field>
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

                <Field id="role-comment" label="Описание">
                  {(control) => (
                    <Textarea
                      {...control}
                      value={commentValue}
                      onChange={(e) => setCommentValue(e.target.value)}
                      disabled={!canEdit}
                      placeholder="Для чего должность, кому назначается"
                      rows={3}
                    />
                  )}
                </Field>

                {/* Владельца в подразделение не включают — поле не показываем. */}
                {!isSystem && (
                  <Field
                    id="role-department"
                    label="Подразделение"
                    hint={
                      departments.length === 0
                        ? "Подразделений пока нет — их создают в разделе «Подразделения»"
                        : undefined
                    }
                  >
                    {(control) => (
                      <OptionSelect
                        {...control}
                        value={departmentId ?? ""}
                        onValueChange={(v) => setDepartmentId(v || null)}
                        disabled={!canEdit || saving || departments.length === 0}
                        options={[
                          { value: "", label: "Без подразделения" },
                          ...departments.map((d) => ({ value: d.id, label: d.name })),
                        ]}
                      />
                    )}
                  </Field>
                )}
              </form>
            </ProfileSection>

            <ProfileSection title="Расписание">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label
                    htmlFor="role-show-in-schedule"
                    className="text-sm font-medium"
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
              <ProfileDangerAction
                icon={Trash2}
                title="Удалить должность"
                description="Должность удалится безвозвратно. Сотрудники этой должности потеряют доступ, поэтому переназначьте их перед удалением."
                actionLabel="Удалить"
                onAction={() => setConfirmDeleteOpen(true)}
                disabled={isPending}
              />
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
