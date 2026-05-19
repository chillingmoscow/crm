"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type VenueRow = { id: string; name: string };

// Фильтр списка актов по заведению. RLS (миграция 195) уже ограничивает
// видимое множество по venue/праву view_all_venues — это выбор внутри
// разрешённого: конкретное заведение / Все / Не распределённые.
export function VenueFilter({
  venues,
  value,
}: {
  venues: VenueRow[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("venue");
    else params.set("venue", next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="mb-4 flex items-center gap-2">
      <label className="text-sm text-muted-foreground" htmlFor="venue-filter">
        Заведение
      </label>
      <select
        id="venue-filter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="all">Все</option>
        <option value="unassigned">Не распределённые</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}
