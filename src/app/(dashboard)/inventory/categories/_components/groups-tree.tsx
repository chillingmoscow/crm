"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ImageOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GroupImageUpload } from "./group-image-upload";

export type IngredientGroupTreeRow = {
  id: string;
  externalId: string;
  name: string;
  parentGroupId: string | null;
  path: string;
  productCount: number;
  imageUrl: string | null;
};

type Props = {
  groups: IngredientGroupTreeRow[];
  canManage: boolean;
};

export function GroupsTree({ groups, canManage }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lookups = useMemo(() => {
    const byParentId = new Map<string | null, IngredientGroupTreeRow[]>();
    const groupIds = new Set(groups.map((group) => group.id));
    for (const group of groups) {
      const parentId = group.parentGroupId && groupIds.has(group.parentGroupId)
        ? group.parentGroupId
        : null;
      const children = byParentId.get(parentId) ?? [];
      children.push(group);
      byParentId.set(parentId, children);
    }
    for (const children of byParentId.values()) {
      children.sort((left, right) => left.name.localeCompare(right.name, "ru"));
    }
    return { byParentId };
  }, [groups]);

  const visibleRows = useMemo(() => {
    const rows: Array<{ group: IngredientGroupTreeRow; depth: number; hasChildren: boolean }> = [];
    const visited = new Set<string>();

    function walk(parentId: string | null, depth: number) {
      for (const group of lookups.byParentId.get(parentId) ?? []) {
        if (visited.has(group.id)) continue;
        visited.add(group.id);
        const hasChildren = (lookups.byParentId.get(group.id) ?? []).length > 0;
        rows.push({ group, depth, hasChildren });
        if (hasChildren && expanded.has(group.id)) {
          walk(group.id, depth + 1);
        }
      }
    }

    walk(null, 0);
    for (const group of [...groups].sort((left, right) => left.name.localeCompare(right.name, "ru"))) {
      if (visited.has(group.id)) continue;
      visited.add(group.id);
      const hasChildren = (lookups.byParentId.get(group.id) ?? []).length > 0;
      rows.push({ group, depth: 0, hasChildren });
      if (hasChildren && expanded.has(group.id)) {
        walk(group.id, 1);
      }
    }
    return rows;
  }, [expanded, groups, lookups]);

  const toggle = (groupId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="grid grid-cols-[64px_1fr_96px_132px] items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[72px_1fr_120px_150px]">
        <div>Фото</div>
        <div>Группа ингредиентов</div>
        <div>Ингредиенты</div>
        <div className="text-right">Действие</div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          Группы ингредиентов не найдены. Запустите синхронизацию Quick Resto на странице актов.
        </div>
      ) : (
        visibleRows.map(({ group, depth, hasChildren }) => {
          return (
            <div
              key={group.id}
              className="grid grid-cols-[64px_1fr_96px_132px] items-center gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[72px_1fr_120px_150px]"
            >
              <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border bg-muted">
                {group.imageUrl ? (
                  <img src={group.imageUrl} alt={group.name} className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0" style={{ paddingLeft: `${Math.min(depth, 8) * 20}px` }}>
                <div className="flex min-w-0 items-center gap-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                      onClick={() => toggle(group.id)}
                      aria-label={expanded.has(group.id) ? "Свернуть группу" : "Развернуть группу"}
                    >
                      {expanded.has(group.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="h-7 w-7 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{group.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">QR #{group.externalId}</div>
                  </div>
                </div>
              </div>
              <div className="text-sm">{group.productCount}</div>
              <div className="flex justify-end gap-2">
                {canManage ? <GroupImageUpload groupId={group.id} /> : null}
                <Button asChild size="sm" variant="outline">
                  <Link href={`/catalog/ingredients?group=${group.id}`}>Открыть</Link>
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
