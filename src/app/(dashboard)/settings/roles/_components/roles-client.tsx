"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Lock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createRole, deleteRole, setRolePermission } from "../actions";

type Role = {
  id: string;
  account_id: string | null;
  name: string;
  code: string;
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
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  accountId: string | null;
};

const MODULE_LABELS: Record<string, string> = {
  platform: "Платформа",
};

export function RolesClient({
  roles: initialRoles,
  permissions,
  rolePermissions: initialRolePermissions,
  accountId,
}: Props) {
  const [roles, setRoles] = useState(initialRoles);
  const [rolePermissions, setRolePermissions] = useState(initialRolePermissions);
  const [selectedId, setSelectedId] = useState(initialRoles[0]?.id ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;
  const isSystem = (role: Role) => role.account_id === null;

  const permissionsByModule = permissions.reduce<Record<string, Permission[]>>(
    (acc, p) => {
      if (!acc[p.module]) acc[p.module] = [];
      acc[p.module].push(p);
      return acc;
    },
    {}
  );

  function hasPermission(roleId: string, permissionId: string): boolean {
    return rolePermissions.some(
      (rp) =>
        rp.role_id === roleId &&
        rp.permission_id === permissionId &&
        rp.granted
    );
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createRole(name);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Должность создана");
        setNewName("");
        setShowCreate(false);
        // New role will appear after server revalidation
        if (result.id) {
          const created: Role = {
            id: result.id,
            account_id: accountId,
            name,
            code: `custom_${name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").substring(0, 40)}`,
          };
          setRoles((prev) => [...prev, created]);
          setSelectedId(result.id);
        }
      }
    });
  }

  function handleDelete(roleId: string) {
    startTransition(async () => {
      const result = await deleteRole(roleId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Должность удалена");
        setRoles((prev) => prev.filter((r) => r.id !== roleId));
        if (selectedId === roleId) {
          const remaining = roles.filter((r) => r.id !== roleId);
          setSelectedId(remaining[0]?.id ?? null);
        }
      }
    });
  }

  function handleToggle(roleId: string, permissionId: string) {
    const current = hasPermission(roleId, permissionId);
    // Optimistic update
    setRolePermissions((prev) => {
      const existing = prev.find(
        (rp) => rp.role_id === roleId && rp.permission_id === permissionId
      );
      if (existing) {
        return prev.map((rp) =>
          rp.role_id === roleId && rp.permission_id === permissionId
            ? { ...rp, granted: !current }
            : rp
        );
      }
      return [
        ...prev,
        { role_id: roleId, permission_id: permissionId, granted: !current },
      ];
    });

    startTransition(async () => {
      const result = await setRolePermission(roleId, permissionId, !current);
      if (result.error) {
        toast.error(result.error);
        // Revert
        setRolePermissions((prev) => {
          const existing = prev.find(
            (rp) => rp.role_id === roleId && rp.permission_id === permissionId
          );
          if (existing) {
            return prev.map((rp) =>
              rp.role_id === roleId && rp.permission_id === permissionId
                ? { ...rp, granted: current }
                : rp
            );
          }
          return prev.filter(
            (rp) =>
              !(rp.role_id === roleId && rp.permission_id === permissionId)
          );
        });
      }
    });
  }

  return (
    <div className="p-6 md:p-8 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Должности и права доступа</h1>
        <p className="text-muted-foreground mt-1">
          Управляйте должностями и настраивайте их права доступа
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Left: role list */}
        <div className="w-60 shrink-0 space-y-0.5">
          {roles.map((role) => {
            const active = selectedId === role.id;
            return (
              <button
                key={role.id}
                onClick={() => setSelectedId(role.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isSystem(role) ? (
                    <Lock className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  ) : (
                    <Shield className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  )}
                  <span className="truncate">{role.name}</span>
                </span>
                {isSystem(role) && (
                  <Badge
                    variant={active ? "outline" : "secondary"}
                    className={`ml-2 text-[10px] h-4 px-1.5 shrink-0 ${
                      active
                        ? "border-primary-foreground/40 text-primary-foreground bg-transparent"
                        : ""
                    }`}
                  >
                    Сист.
                  </Badge>
                )}
              </button>
            );
          })}

          {accountId && (
            <>
              <Separator className="my-2" />
              {showCreate ? (
                <div className="space-y-2 px-1 pt-1">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Название должности"
                    className="h-8 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setShowCreate(false);
                        setNewName("");
                      }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={handleCreate}
                      disabled={isPending || !newName.trim()}
                    >
                      Создать
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        setShowCreate(false);
                        setNewName("");
                      }}
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Новая должность
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: permissions panel */}
        {selectedRole ? (
          <div className="flex-1 min-w-0 rounded-lg border p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-semibold text-lg">{selectedRole.name}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isSystem(selectedRole)
                    ? "Системная должность — права доступны только для просмотра"
                    : "Настройте права доступа для этой должности"}
                </p>
              </div>
              {!isSystem(selectedRole) && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleDelete(selectedRole.id)}
                  disabled={isPending}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Удалить
                </Button>
              )}
            </div>

            <Separator className="mb-5" />

            <div className="space-y-6">
              {Object.entries(permissionsByModule).map(([module, perms]) => (
                <div key={module}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {MODULE_LABELS[module] ?? module}
                  </h3>
                  <div className="space-y-3">
                    {perms.map((permission) => {
                      const granted = hasPermission(
                        selectedRole.id,
                        permission.id
                      );
                      const disabled = isSystem(selectedRole);
                      return (
                        <div
                          key={permission.id}
                          className="flex items-center gap-3"
                        >
                          <Checkbox
                            id={`${selectedRole.id}-${permission.id}`}
                            checked={granted}
                            disabled={disabled}
                            onCheckedChange={() =>
                              !disabled &&
                              handleToggle(selectedRole.id, permission.id)
                            }
                          />
                          <label
                            htmlFor={`${selectedRole.id}-${permission.id}`}
                            className={`text-sm leading-none select-none ${
                              disabled
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
          </div>
        ) : (
          <div className="flex-1 rounded-lg border flex items-center justify-center h-48 text-muted-foreground text-sm">
            Выберите должность
          </div>
        )}
      </div>
    </div>
  );
}
