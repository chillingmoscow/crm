"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { deleteRole, setRolePermission, updateRole } from "../../actions";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  account_id: string | null;
  name: string;
  code: string;
  comment: string | null;
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
};

// ── Constants ────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = { platform: "Платформа" };

const TABS = ["Права доступа", "Оплата труда", "Настройки"] as const;
type Tab = (typeof TABS)[number];

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
  const [activeTab, setActiveTab] = useState<Tab>("Права доступа");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Settings tab state
  const [nameValue, setNameValue] = useState(role.name);
  const [commentValue, setCommentValue] = useState(role.comment ?? "");

  const isOwner = role.code === "owner";
  const canEdit = !isOwner;
  // Delete only for custom (account-specific) non-owner roles
  const canDelete = !isOwner && accountId !== null && role.account_id === accountId;

  function hasPermission(permId: string): boolean {
    return rolePermissions.some(
      (rp) =>
        rp.role_id === role.id && rp.permission_id === permId && rp.granted
    );
  }

  function handleToggle(permissionId: string) {
    const current = hasPermission(permissionId);
    setRolePerms((prev) => {
      const existing = prev.find((rp) => rp.permission_id === permissionId);
      if (existing) {
        return prev.map((rp) =>
          rp.permission_id === permissionId ? { ...rp, granted: !current } : rp
        );
      }
      return [
        ...prev,
        { role_id: role.id, permission_id: permissionId, granted: !current },
      ];
    });

    startTransition(async () => {
      const result = await setRolePermission(role.id, permissionId, !current);
      if (result.error) {
        toast.error(result.error);
        setRolePerms((prev) => {
          const existing = prev.find((rp) => rp.permission_id === permissionId);
          if (existing) {
            return prev.map((rp) =>
              rp.permission_id === permissionId
                ? { ...rp, granted: current }
                : rp
            );
          }
          return prev.filter((rp) => rp.permission_id !== permissionId);
        });
      }
    });
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateRole(role.id, {
        name: nameValue,
        comment: commentValue || null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Изменения сохранены");
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
      router.push("/settings/roles");
    });
  }

  const permissionsByModule = permissions.reduce<Record<string, Permission[]>>(
    (acc, p) => {
      if (!acc[p.module]) acc[p.module] = [];
      acc[p.module].push(p);
      return acc;
    },
    {}
  );

  return (
    <div className="p-6 md:p-8 w-full max-w-2xl">
      {/* Back button */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/settings/roles")}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Должности
        </Button>
      </div>

      {/* Title */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{nameValue || role.name}</h1>
          <div className="flex items-center gap-3 mt-1.5">
            {isOwner && (
              <Badge variant="secondary" className="text-xs">
                Системная
              </Badge>
            )}
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {staffCount}{" "}
              {staffCount === 1
                ? "сотрудник"
                : staffCount < 5
                ? "сотрудника"
                : "сотрудников"}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Права доступа ───────────────────────────────── */}
      {activeTab === "Права доступа" && (
        <div className="space-y-6">
          {isOwner && (
            <p className="text-sm text-muted-foreground rounded-lg bg-muted px-4 py-3">
              Системная должность — права нельзя изменить
            </p>
          )}

          {Object.entries(permissionsByModule).map(([module, perms]) => (
            <div key={module}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {MODULE_LABELS[module] ?? module}
              </h3>
              <div className="space-y-3">
                {perms.map((permission) => {
                  const granted = hasPermission(permission.id);
                  return (
                    <div key={permission.id} className="flex items-center gap-3">
                      <Checkbox
                        id={`perm-${permission.id}`}
                        checked={granted}
                        disabled={!canEdit}
                        onCheckedChange={() =>
                          canEdit && handleToggle(permission.id)
                        }
                      />
                      <label
                        htmlFor={`perm-${permission.id}`}
                        className={`text-sm leading-none select-none ${
                          !canEdit
                            ? "cursor-default text-muted-foreground"
                            : "cursor-pointer"
                        }`}
                      >
                        {permission.description}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Оплата труда (stub) ─────────────────────────── */}
      {activeTab === "Оплата труда" && (
        <div className="rounded-lg border border-dashed p-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Оплата труда
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Раздел в разработке
          </p>
        </div>
      )}

      {/* ── Tab: Настройки ───────────────────────────────────── */}
      {activeTab === "Настройки" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Название</Label>
              <Input
                id="role-name"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
                placeholder="Название должности"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-comment">Комментарий</Label>
              <Textarea
                id="role-comment"
                value={commentValue}
                onChange={(e) => setCommentValue(e.target.value)}
                readOnly={!canEdit}
                className={!canEdit ? "bg-muted/50" : ""}
                placeholder="Дополнительные заметки о должности..."
                rows={4}
              />
            </div>

            {canEdit && (
              <Button
                onClick={handleSave}
                disabled={isPending || !nameValue.trim()}
                size="sm"
              >
                {isPending && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                )}
                Сохранить
              </Button>
            )}
          </div>

          {/* Danger zone — only for custom non-owner roles */}
          {canDelete && (
            <>
              <Separator className="mt-8" />
              <div className="space-y-3 pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Опасная зона
                </p>
                {confirmDelete ? (
                  <div className="rounded-lg border border-destructive p-4 space-y-3">
                    <p className="text-sm">
                      Удалить должность{" "}
                      <strong>&laquo;{nameValue || role.name}&raquo;</strong>?
                      Это действие нельзя отменить.
                    </p>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Отмена
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDelete}
                        disabled={isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        Удалить
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/40 hover:bg-destructive/5 hover:border-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Удалить должность
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
