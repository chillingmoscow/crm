"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  type DateRangeValue,
} from "@/components/finance/date-range-picker";
import { VenuePicker } from "@/components/finance/venue-picker";

type VenueOption = { id: string; name: string };

type Props = {
  initialDateFrom: string | null;
  initialDateTo: string | null;
  initialVenueId: string | null;
  venues: VenueOption[];
};

const PRESETS: Array<{ label: string; range: () => DateRangeValue }> = [
  { label: "Сегодня",       range: () => sameDay(0) },
  { label: "Последние 7 дней", range: () => lastNDays(6) },
  { label: "Этот месяц",    range: () => currentMonth() },
  { label: "Прошлый месяц", range: () => previousMonth() },
  { label: "Этот год",      range: () => currentYear() },
];

/**
 * Period + venue filter for the finance dashboard. Keeps state in the
 * URL so deep-link / refresh preserves the view; preset buttons just
 * shortcut to common ranges. Legal-entity scoping is handled by the
 * cookie-driven LegalEntitySwitcher in /finance/layout.tsx.
 */
export function DashboardPeriodFilter({
  initialDateFrom,
  initialDateTo,
  initialVenueId,
  venues,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [range, setRange] = useState<DateRangeValue>({
    from: initialDateFrom,
    to:   initialDateTo,
  });
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);

  const apply = (nextRange?: DateRangeValue, nextVenue?: string | null) => {
    const r = nextRange ?? range;
    const v = nextVenue !== undefined ? nextVenue : venueId;
    const params = new URLSearchParams();
    if (r.from)  params.set("date_from", r.from);
    if (r.to)    params.set("date_to",   r.to);
    if (v)       params.set("venue_id",  v);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/finance?${qs}` : "/finance");
    });
  };

  const reset = () => {
    setRange({ from: null, to: null });
    setVenueId(null);
    startTransition(() => router.push("/finance"));
  };

  const hasActive = !!range.from || !!range.to || !!venueId;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Quick presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const r = p.range();
              setRange(r);
              apply(r);
            }}
            disabled={isPending}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="w-64">
        <DateRangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            apply(next);
          }}
        />
      </div>

      {venues.length > 0 && (
        <div className="w-56">
          <VenuePicker
            venues={venues}
            value={venueId}
            onChange={(next) => {
              setVenueId(next);
              apply(undefined, next);
            }}
            placeholder="Все точки"
            allowClear
          />
        </div>
      )}

      {hasActive && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={isPending}
        >
          <X className="mr-1.5 h-4 w-4" />
          Сбросить
        </Button>
      )}
    </div>
  );
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sameDay(offset: number): DateRangeValue {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const iso = toIso(d);
  return { from: iso, to: iso };
}

function lastNDays(n: number): DateRangeValue {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - n);
  return { from: toIso(from), to: toIso(to) };
}

function currentMonth(): DateRangeValue {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: toIso(first), to: toIso(last) };
}

function previousMonth(): DateRangeValue {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last  = new Date(d.getFullYear(), d.getMonth(), 0);
  return { from: toIso(first), to: toIso(last) };
}

function currentYear(): DateRangeValue {
  const d = new Date();
  return {
    from: toIso(new Date(d.getFullYear(), 0, 1)),
    to:   toIso(new Date(d.getFullYear(), 11, 31)),
  };
}
