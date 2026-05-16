"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, ImageOff, Package, Search } from "lucide-react";

import { formatAmount, type AmountRoundingScale } from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import { ProductImageUpload } from "./product-image-upload";
import { GroupImageUpload } from "../../categories/_components/group-image-upload";

export type CatalogGroup = {
  id: string;
  externalId: string;
  name: string;
  parentGroupId: string | null;
  imageUrl: string | null;
};

export type CatalogProduct = {
  id: string;
  externalId: string;
  name: string;
  article: string | null;
  barcode: string | null;
  measureUnitName: string | null;
  currentPrimeCost: number | null;
  storeQuantityKg: number | null;
  groupId: string | null;
  imageUrl: string | null;
};

type Props = {
  groups: CatalogGroup[];
  products: CatalogProduct[];
  canManage: boolean;
  amountRoundingScale: AmountRoundingScale;
};

type VisibleRow =
  | { type: "group"; group: CatalogGroup; depth: number; productCount: number }
  | { type: "product"; product: CatalogProduct; depth: number };

function matchesSearch(value: string | null | undefined, search: string) {
  return Boolean(value && value.toLocaleLowerCase("ru").includes(search));
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export function InventoryCatalogTree({
  groups,
  products,
  canManage,
  amountRoundingScale,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("ru");

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const productsByGroupId = useMemo(() => {
    const map = new Map<string | null, CatalogProduct[]>();
    for (const product of products) {
      const groupId = product.groupId && groupById.has(product.groupId) ? product.groupId : null;
      const list = map.get(groupId) ?? [];
      list.push(product);
      map.set(groupId, list);
    }
    for (const [key, list] of map) map.set(key, sortByName(list));
    return map;
  }, [groupById, products]);

  const groupsByParentId = useMemo(() => {
    const map = new Map<string | null, CatalogGroup[]>();
    for (const group of groups) {
      const parentId = group.parentGroupId && groupById.has(group.parentGroupId) ? group.parentGroupId : null;
      const list = map.get(parentId) ?? [];
      list.push(group);
      map.set(parentId, list);
    }
    for (const [key, list] of map) map.set(key, sortByName(list));
    return map;
  }, [groupById, groups]);

  const productCountByGroupId = useMemo(() => {
    const memo = new Map<string, number>();
    const countGroup = (groupId: string): number => {
      const cached = memo.get(groupId);
      if (typeof cached === "number") return cached;

      let count = productsByGroupId.get(groupId)?.length ?? 0;
      for (const child of groupsByParentId.get(groupId) ?? []) {
        count += countGroup(child.id);
      }
      memo.set(groupId, count);
      return count;
    };

    for (const group of groups) countGroup(group.id);
    return memo;
  }, [groups, groupsByParentId, productsByGroupId]);

  const visibleRows = useMemo(() => {
    const rows: VisibleRow[] = [];
    const groupMatchMemo = new Map<string, boolean>();

    const productMatches = (product: CatalogProduct) => {
      if (!normalizedSearch) return true;
      return (
        matchesSearch(product.name, normalizedSearch) ||
        matchesSearch(product.article, normalizedSearch) ||
        matchesSearch(product.barcode, normalizedSearch) ||
        matchesSearch(product.externalId, normalizedSearch)
      );
    };

    const groupHasMatch = (group: CatalogGroup): boolean => {
      const cached = groupMatchMemo.get(group.id);
      if (typeof cached === "boolean") return cached;

      const selfMatches = !normalizedSearch || matchesSearch(group.name, normalizedSearch) || matchesSearch(group.externalId, normalizedSearch);
      const childMatches = (groupsByParentId.get(group.id) ?? []).some(groupHasMatch);
      const productMatchesInGroup = (productsByGroupId.get(group.id) ?? []).some(productMatches);
      const result = selfMatches || childMatches || productMatchesInGroup;
      groupMatchMemo.set(group.id, result);
      return result;
    };

    const walk = (parentId: string | null, depth: number) => {
      for (const group of groupsByParentId.get(parentId) ?? []) {
        if (normalizedSearch && !groupHasMatch(group)) continue;

        rows.push({
          type: "group",
          group,
          depth,
          productCount: productCountByGroupId.get(group.id) ?? 0,
        });

        const isOpen = normalizedSearch ? true : expanded.has(group.id);
        if (!isOpen) continue;
        walk(group.id, depth + 1);

        for (const product of productsByGroupId.get(group.id) ?? []) {
          if (productMatches(product)) rows.push({ type: "product", product, depth: depth + 1 });
        }
      }
    };

    walk(null, 0);
    for (const product of productsByGroupId.get(null) ?? []) {
      if (productMatches(product)) rows.push({ type: "product", product, depth: 0 });
    }

    return rows;
  }, [expanded, groupsByParentId, normalizedSearch, productCountByGroupId, productsByGroupId]);

  const toggleGroup = (groupId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по названию, артикулу, штрих-коду"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {groups.length} групп · {products.length} ингредиентов
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="grid grid-cols-[72px_1fr_120px] items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[88px_1.8fr_.7fr_.7fr_140px]">
          <div>Фото</div>
          <div>Позиция</div>
          <div className="hidden md:block">Остаток QR</div>
          <div className="hidden md:block">Себестоимость</div>
          <div className="text-right">Действие</div>
        </div>

        {visibleRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Ингредиенты не найдены. Запустите полную синхронизацию на странице актов.
          </div>
        ) : (
          visibleRows.map((row) => {
            if (row.type === "group") {
              const hasChildren =
                (groupsByParentId.get(row.group.id)?.length ?? 0) > 0 ||
                (productsByGroupId.get(row.group.id)?.length ?? 0) > 0;
              const isOpen = normalizedSearch ? true : expanded.has(row.group.id);
              return (
                <div
                  key={`group-${row.group.id}`}
                  className="grid grid-cols-[72px_1fr_120px] items-center gap-3 border-b bg-muted/15 px-3 py-3 last:border-b-0 md:grid-cols-[88px_1.8fr_.7fr_.7fr_140px]"
                >
                  <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {row.group.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.group.imageUrl} alt={row.group.name} className="h-full w-full object-cover" />
                    ) : (
                      <Folder className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0" style={{ paddingLeft: row.depth * 20 }}>
                    <button
                      type="button"
                      disabled={!hasChildren}
                      onClick={() => toggleGroup(row.group.id)}
                      className={cn(
                        "inline-flex max-w-full items-center gap-2 text-left text-sm font-medium",
                        hasChildren ? "cursor-pointer" : "cursor-default",
                      )}
                    >
                      {hasChildren ? (
                        isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />
                      ) : (
                        <span className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">{row.group.name}</span>
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">
                      QR #{row.group.externalId} · {row.productCount} позиций
                    </div>
                  </div>
                  <div className="hidden text-sm text-muted-foreground md:block">—</div>
                  <div className="hidden text-sm text-muted-foreground md:block">—</div>
                  <div className="flex justify-end">
                    {canManage ? <GroupImageUpload groupId={row.group.id} /> : null}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`product-${row.product.id}`}
                className="grid grid-cols-[72px_1fr_120px] items-center gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[88px_1.8fr_.7fr_.7fr_140px]"
              >
                <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
                  {row.product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.product.imageUrl} alt={row.product.name} className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0" style={{ paddingLeft: row.depth * 20 }}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="truncate text-sm font-medium">{row.product.name}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>QR #{row.product.externalId}</span>
                    {row.product.article ? <span>Арт. {row.product.article}</span> : null}
                    {row.product.barcode ? <span>{row.product.barcode}</span> : null}
                    {row.product.measureUnitName ? <span>{row.product.measureUnitName}</span> : null}
                  </div>
                </div>
                <div className="hidden text-sm md:block">
                  {row.product.storeQuantityKg ?? "—"}
                </div>
                <div className="hidden text-sm md:block">
                  {formatAmount(row.product.currentPrimeCost, amountRoundingScale)}
                </div>
                <div className="flex justify-end">
                  {canManage ? <ProductImageUpload productId={row.product.id} /> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
