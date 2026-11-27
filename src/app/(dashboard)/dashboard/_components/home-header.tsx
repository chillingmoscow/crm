"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CompareSwitch } from "@/components/shared/compare-switch";
import type { CompareMode } from "@/lib/finance/dashboard-compare";

/**
 * Шапка главной: приветствие по времени суток и дата одной строкой
 * («Доброе утро, Павел · пятница, 27 ноября»), справа — с чем сравнивать
 * показатели недели. Выбор живёт в адресе (`?compare=year`), как на
 * финансовом дашборде; по умолчанию — прошлая неделя.
 */
export function HomeHeader({
  greeting,
  date,
  compare,
}: {
  greeting: string;
  date: string;
  /** `null` — показателей недели нет, переключатель не нужен. */
  compare: CompareMode | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const change = (mode: CompareMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "year") params.set("compare", "year");
    else params.delete("compare");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <h1 className="min-w-0 text-[28px] font-bold leading-[1.2] tracking-[-0.5px] sm:text-[36px]">
        {greeting}
        <span className="text-muted-foreground"> · </span>
        {/* На телефоне дата уходит на вторую строку целиком, а не рвётся посередине. */}
        <span className="whitespace-nowrap text-muted-foreground">{date}</span>
      </h1>
      {compare ? (
        <div className="shrink-0" aria-busy={pending}>
          <CompareSwitch value={compare} previousLabel="Прошлая неделя" onChange={change} disabled={pending} />
        </div>
      ) : null}
    </div>
  );
}
