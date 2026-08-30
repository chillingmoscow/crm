"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type GroupOption = {
  id: string;
  path: string;
  depth: number;
};

type Props = {
  query: string;
  selectedGroupId: string;
  pageSize: number;
  defaultPageSize: number;
  groups: GroupOption[];
};

function buildHref(input: {
  query: string;
  groupId: string;
  pageSize: number;
  defaultPageSize: number;
}) {
  const params = new URLSearchParams();
  const query = input.query.trim();
  if (query) params.set("q", query);
  if (input.groupId) params.set("group", input.groupId);
  if (input.pageSize !== input.defaultPageSize) params.set("size", String(input.pageSize));
  const qs = params.toString();
  return qs ? `/catalog/ingredients?${qs}` : "/catalog/ingredients";
}

export function ProductsToolbar({
  query,
  selectedGroupId,
  pageSize,
  defaultPageSize,
  groups,
}: Props) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftGroupId, setDraftGroupId] = useState(selectedGroupId);

  const apply = (next?: Partial<{ query: string; groupId: string }>) => {
    const href = buildHref({
      query: next?.query ?? draftQuery,
      groupId: next?.groupId ?? draftGroupId,
      pageSize,
      defaultPageSize,
    });
    router.push(href);
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
      {searchOpen ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2 md:w-[420px] md:flex-none"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <Input
            autoFocus
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Поиск"
            className="min-w-0"
          />
          <Button type="submit" size="icon" variant="outline" aria-label="Искать">
            <Search className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Скрыть поиск"
            onClick={() => {
              setDraftQuery("");
              setSearchOpen(false);
              apply({ query: "" });
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <Button type="button" size="icon" variant="outline" aria-label="Поиск" onClick={() => setSearchOpen(true)}>
          <Search className="h-4 w-4" />
        </Button>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={draftGroupId ? "default" : "outline"}
            aria-label="Фильтры"
          >
            <Filter className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Фильтры
          </div>
          <label className="text-sm font-medium" htmlFor="products-group-filter">
            Группа ингредиентов
          </label>
          <select
            id="products-group-filter"
            value={draftGroupId}
            onChange={(event) => setDraftGroupId(event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Все группы ингредиентов</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {"\u00A0".repeat(Math.min(group.depth, 8) * 2)}
                {group.path}
              </option>
            ))}
          </select>
          <div className="mt-3 flex gap-2">
            <Button type="button" className="flex-1" onClick={() => apply()}>
              Применить
            </Button>
            <Button
              type="button"
              className="flex-1"
              variant="outline"
              onClick={() => {
                setDraftGroupId("");
                apply({ groupId: "" });
              }}
            >
              Сбросить
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
