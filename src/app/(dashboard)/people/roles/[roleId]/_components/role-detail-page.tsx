"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteRole, setRolePermission, updateRole } from "../../actions";
import { metaForModule, sortModuleKeys } from "./permission-modules";
import { IconPicker } from "../../_components/icon-picker";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  account_id: string | null;
  name: string;
  code: string;
  comment: string | null;
  icon: string | null;
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
  staffCount: number;
  importedFromQuickResto: boolean;
};

type TabKey = "permissions" | "compensation" | "settings" | "danger";

// ── Component ────────────────────────────────────────────────

export function RoleDetailPage({
  role,
  permissions,
  rolePermissions: initialRolePerms,
  accountId,
  staffCount,
}: Props) {
  const router = useRouter();
  const [rolePermissions, setRolePerms] = useState(initialRolePerms);
  const [activeTab, setActiveTab] = useState<TabKey>("permissions");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Settings tab state
  const [nameValue, setNameValue] = useState(role.name);
  const [commentValue, setCommentValue] = useState(role.comment ?? "");
  const [iconValue, setIconValue] = useState<string | null>(role.icon);
  const dirty =
    nameValue.trim() !== role.name ||
    (commentValue || null) !== role.comment ||
    iconValue !== role.icon;

  // Permissions search
  const [permQuery, setPermQuery] = useState("");

  const isOwner = role.code === "owner";
  const isSystem = role.account_id === null;
  const canEdit = !isOwner;
  // Any non-owner role can be removed: custom → physical delete, system →
  // per-account hide overlay (account_hidden_roles).
  const canDelete = !isOwner && accountId !== null;

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
      const result = await updateRole(role.id, {
        name: nameValue,
        comment: commentValue || null,
        icon: iconValue,
      });
      if (result.error) {
        toast.error(result.error);
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
      toast.success(isSystem ? "Должность скрыта" : "Должность удалена");
      router.push("/people/roles");
    });
  }

  // ── Derived ────────────────────────────────────────────────

  const grantedCount = useMemo(
    () =>
      permissions.filter((p) =>
        rolePermissions.some(
          (rp) =>
            rp.role_id === role.id && rp.permission_id === p.id && rp.granted,
        ),
      ).length,
    [permissions, rolePermissions, role.id],
  );

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
      {/* Top breadcrumb bar */}
      <div className="flex items-center px-6 md:px-8 pt-4 w-full">
        <Link
          href="/people/roles"
          className="inline-flex items-center gap-1 px-2 py-1.5 -ml-2 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Должности
        </Link>
      </div>

      {/* Page body */}
      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">
                {nameValue || role.name}
              </h1>
              {role.account_id === null && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary border">
                  Системная
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {staffCount}{" "}
              {staffCount === 1
                ? "сотрудник"
                : staffCount < 5
                ? "сотрудника"
                : "сотрудников"}
              {" · "}
              {grantedCount} из {permissions.length} прав
            </div>
          </div>
          {activeTab === "settings" && canEdit && (
            <Button onClick={handleSave} disabled={isPending || !dirty || !nameValue.trim()}>
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Сохранить
            </Button>
          )}
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
        >
          <TabsList>
            <TabsTrigger value="permissions">Права доступа</TabsTrigger>
            <TabsTrigger value="compensation">Оплата труда</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
            {canDelete && (
              <TabsTrigger value="danger">Опасная зона</TabsTrigger>
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

          {/* ── Settings ──────────────────────────────────────── */}
          <TabsContent value="settings">
            <div className="max-w-[720px] flex flex-col gap-5">
              {/* Icon + Name on one row */}
              <div className="flex items-end gap-3">
                <div className="space-y-1.5 shrink-0">
                  <Label className="text-[13px] font-medium">Иконка</Label>
                  <IconPicker
                    value={iconValue}
                    roleCode={role.code}
                    onChange={setIconValue}
                    disabled={!canEdit}
                  />
                </div>
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
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="role-comment"
                  className="text-[13px] font-medium"
                >
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
            </div>
          </TabsContent>

          {/* ── Danger zone ───────────────────────────────────── */}
          {canDelete && (
            <TabsContent value="danger">
              <div className="max-w-[720px] rounded-[14px] border border-destructive/40 bg-card p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-foreground">
                    {isSystem ? "Скрыть должность" : "Удалить должность"}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {isSystem ? (
                      <>
                        Системная должность «{nameValue || role.name}» исчезнет
                        из списка вашего аккаунта. Сотрудники с этой ролью
                        потеряют доступ — переназначьте их заранее. Скрытие
                        можно отменить через системного администратора.
                      </>
                    ) : (
                      <>
                        Должность «{nameValue || role.name}» будет удалена
                        безвозвратно. Сотрудники с этой ролью потеряют доступ —
                        переназначьте их перед удалением.
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    {isSystem ? "Скрыть должность" : "Удалить должность"}
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
            <DialogTitle>
              {isSystem ? "Скрыть должность?" : "Удалить должность?"}
            </DialogTitle>
            <DialogDescription>
              {isSystem
                ? `Системная должность «${nameValue || role.name}» исчезнет из вашего списка. Сотрудники с этой ролью потеряют доступ.`
                : `Должность «${nameValue || role.name}» будет удалена. Действие нельзя отменить.`}
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
              {isSystem ? "Скрыть" : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
