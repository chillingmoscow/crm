"use client";

import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { ProfileSection } from "@/components/shared/profile-section";
import { Input } from "@/components/ui/input";
import { setRolePermissions } from "../../actions";
import {
  OTHER_GROUP_LABEL,
  PERMISSION_GROUPS,
  codeOrder,
  fallbackSection,
  type PermissionSectionDef,
} from "./permission-modules";
import { PermissionSection } from "./permission-section";

type Permission = { id: string; code: string; description: string; module: string };
type RolePermission = { role_id: string; permission_id: string; granted: boolean };

type ResolvedSection = { def: PermissionSectionDef; perms: Permission[] };
type ResolvedGroup = { id: string; label: string; sections: ResolvedSection[] };

/**
 * Вкладка «Права доступа» карточки должности. Разделы сгруппированы
 * крупно (permission-modules.ts), в каждом — выбор уровня и раскрывашка
 * с отдельными правами. Изменения сохраняются сразу, с откатом при ошибке.
 *
 * Состояние прав живёт в карточке (`rolePermissions`): Radix размонтирует
 * неактивную вкладку, и локальное состояние здесь потерялось бы.
 */
export function RolePermissionsTab({
  roleId,
  permissions,
  rolePermissions,
  onRolePermissionsChange,
  readOnly,
}: {
  roleId: string;
  permissions: Permission[];
  rolePermissions: RolePermission[];
  onRolePermissionsChange: Dispatch<SetStateAction<RolePermission[]>>;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  // Раскрытые вручную разделы и отдельно — переопределения на время поиска
  // (поиск сам раскрывает разделы с совпадениями; сбрасываются при новом запросе).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchOverride, setSearchOverride] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  const grantedIds = useMemo(
    () =>
      new Set(
        rolePermissions
          .filter((rp) => rp.role_id === roleId && rp.granted)
          .map((rp) => rp.permission_id),
      ),
    [rolePermissions, roleId],
  );
  const isGranted = (permId: string) => grantedIds.has(permId);

  const groups = useMemo<ResolvedGroup[]>(() => {
    const byModule = new Map<string, Permission[]>();
    for (const p of permissions) {
      const list = byModule.get(p.module) ?? [];
      list.push(p);
      byModule.set(p.module, list);
    }
    const used = new Set<string>();
    const resolve = (def: PermissionSectionDef): ResolvedSection => {
      const order = codeOrder(def);
      const perms = def.modules
        .flatMap((m) => {
          used.add(m);
          return byModule.get(m) ?? [];
        })
        .sort(
          (a, b) =>
            (order.get(a.code) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(b.code) ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code),
        );
      return { def, perms };
    };
    const result: ResolvedGroup[] = PERMISSION_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      sections: g.sections.map(resolve).filter((s) => s.perms.length > 0),
    }));
    // Модуль из новой миграции, ещё не разложенный по уровням, — не теряем.
    const rest = [...byModule.keys()].filter((m) => !used.has(m)).sort();
    if (rest.length > 0) {
      result.push({
        id: "other",
        label: OTHER_GROUP_LABEL,
        sections: rest.map((m) =>
          resolve(fallbackSection(m, (byModule.get(m) ?? []).map((p) => p.code))),
        ),
      });
    }
    return result.filter((g) => g.sections.length > 0);
  }, [permissions]);

  const q = query.trim().toLocaleLowerCase("ru");
  const searching = q.length > 0;

  const visibleGroups = useMemo(() => {
    if (!searching) {
      return groups.map((g) => ({
        ...g,
        sections: g.sections.map((s) => ({ ...s, matches: [] as Permission[], labelMatch: false })),
      }));
    }
    const has = (text: string) => text.toLocaleLowerCase("ru").includes(q);
    return groups
      .map((g) => {
        const groupMatch = has(g.label);
        return {
          ...g,
          sections: g.sections
            .map((s) => ({
              ...s,
              matches: s.perms.filter((p) => has(p.description)),
              labelMatch: groupMatch || has(s.def.label),
            }))
            .filter((s) => s.labelMatch || s.matches.length > 0),
        };
      })
      .filter((g) => g.sections.length > 0);
  }, [groups, q, searching]);

  const allSections = groups.flatMap((g) => g.sections);
  const sectionsWithAccess = allSections.filter((s) => s.perms.some((p) => isGranted(p.id))).length;

  // ── Запись ───────────────────────────────────────────────────

  function applyLocal(changes: { permissionId: string; granted: boolean }[]) {
    if (changes.length === 0) return;
    const next = new Map(changes.map((c) => [c.permissionId, c.granted]));
    onRolePermissionsChange((prev) => {
      const seen = new Set<string>();
      const updated = prev.map((rp) => {
        if (rp.role_id !== roleId || !next.has(rp.permission_id)) return rp;
        seen.add(rp.permission_id);
        return { ...rp, granted: next.get(rp.permission_id)! };
      });
      for (const [permission_id, granted] of next) {
        if (!seen.has(permission_id)) updated.push({ role_id: roleId, permission_id, granted });
      }
      return updated;
    });
  }

  function commit(changes: { permissionId: string; granted: boolean }[]) {
    if (readOnly || changes.length === 0) return;
    applyLocal(changes);
    const rollback = (ids: Set<string>) =>
      applyLocal(
        changes
          .filter((c) => ids.has(c.permissionId))
          .map((c) => ({ permissionId: c.permissionId, granted: !c.granted })),
      );
    startTransition(async () => {
      try {
        const result = await setRolePermissions(roleId, changes);
        if (result.failed.length > 0) {
          rollback(new Set(result.failed));
          toast.error(
            changes.length === 1
              ? (result.error ?? "Не удалось изменить право")
              : `Не удалось изменить ${result.failed.length} из ${changes.length} прав`,
          );
        }
      } catch {
        rollback(new Set(changes.map((c) => c.permissionId)));
        toast.error("Не удалось сохранить права. Проверьте подключение и повторите");
      }
    });
  }

  function applyCodes(perms: Permission[], codes: ReadonlySet<string>) {
    commit(
      perms
        .filter((p) => codes.has(p.code) !== isGranted(p.id))
        .map((p) => ({ permissionId: p.id, granted: codes.has(p.code) })),
    );
  }

  function toggle(permId: string) {
    commit([{ permissionId: permId, granted: !isGranted(permId) }]);
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      {readOnly && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Системная должность: права нельзя изменить
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOverride({});
            }}
            placeholder="Найти право…"
            aria-label="Найти право"
            className="h-9 pl-9"
          />
        </div>
        <span className="ml-auto text-[13px] text-muted-foreground">
          Разделов с доступом: {sectionsWithAccess} из {allSections.length}
        </span>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          По запросу «{query.trim()}» ничего не найдено
        </div>
      ) : null}

      {visibleGroups.map((group) => (
        <ProfileSection key={group.id} title={group.label}>
          <div className="divide-y">
            {group.sections.map(({ def, perms, matches }) => {
              const autoOpen = searching && matches.length > 0;
              const open = searching
                ? (searchOverride[def.id] ?? autoOpen)
                : (expanded[def.id] ?? false);
              return (
                <PermissionSection
                  key={def.id}
                  section={def}
                  perms={perms}
                  visiblePerms={matches.length > 0 ? matches : perms}
                  isGranted={isGranted}
                  open={open}
                  onOpenChange={(next) =>
                    searching
                      ? setSearchOverride((s) => ({ ...s, [def.id]: next }))
                      : setExpanded((s) => ({ ...s, [def.id]: next }))
                  }
                  readOnly={readOnly}
                  busy={isPending}
                  onApplyCodes={(codes) => applyCodes(perms, codes)}
                  onToggle={toggle}
                />
              );
            })}
          </div>
        </ProfileSection>
      ))}
    </div>
  );
}
