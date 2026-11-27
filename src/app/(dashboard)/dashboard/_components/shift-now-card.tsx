"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

import { PersonAvatar } from "@/components/people/person-avatar";
import { AnimatedMoney } from "@/components/shared/animated-money";
import { unwrapAction } from "@/lib/actions/result";
import { countRu } from "@/lib/format/plural";
import type { ShiftNow, ShiftPerson } from "@/lib/home/shift-now";
import { cn } from "@/lib/utils";

import { RefreshFailedNotice, useAutoRefresh } from "@/app/(dashboard)/people/payroll/_components/auto-refresh";

import { refreshShiftNow } from "../actions";
import { HomeSection, SectionLink } from "./section";

/** Раз в минуту — как «Смены» продаж и уведомление об отметках. */
const REFRESH_MS = 60_000;
/** Сколько аватаров в стопке; остальные — «+N». */
const STACK = 6;

/**
 * «Смена сейчас»: оборот открытой смены (досчитывается и тихо обновляется,
 * пока вкладка видна), кто сегодня на смене — аватары стопкой, и кто из уже
 * начавших смену не отметился в Quick Resto. Фоновое обновление не
 * перерисовывает блок заново: меняются только числа и строки.
 */
export function ShiftNowCard({ initial, canOpenStaff }: { initial: ShiftNow; canOpenStaff: boolean }) {
  const [data, setData] = useState(initial);
  const reload = useCallback(async () => {
    setData(unwrapAction(await refreshShiftNow()));
  }, []);
  const { failed, updatedAt, retry, retrying } = useAutoRefresh(reload, REFRESH_MS);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: data.timezone });

  return (
    <HomeSection
      title="Смена сейчас"
      action={data.team ? <SectionLink href="/schedule" label="Расписание" /> : null}
    >
      <div className="space-y-5">
        {failed ? <RefreshFailedNotice updatedAt={updatedAt} retry={retry} retrying={retrying} /> : null}

        {data.turnover ? (
          <div>
            <p className="text-xs text-muted-foreground">Оборот смены</p>
            <p className="mt-2 text-[28px] font-semibold leading-[1.2] tracking-[-0.6px] tabular-nums">
              <AnimatedMoney value={data.turnover.value} />
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{turnoverHint(data.turnover, time)}</p>
          </div>
        ) : null}

        {data.team ? (
          <TeamToday
            team={data.team}
            marks={data.attendance}
            time={time}
            canOpenStaff={canOpenStaff}
            divided={!!data.turnover}
          />
        ) : null}
      </div>
    </HomeSection>
  );
}

function turnoverHint(t: NonNullable<ShiftNow["turnover"]>, time: (iso: string) => string): string {
  if (!t.status) return "Смена в Quick Resto ещё не открыта";
  if (t.value === null) return "Оборот ещё считается";
  if (t.status === "preliminary")
    return t.syncedAt ? `Предварительно · на ${time(t.syncedAt)}` : "Предварительно";
  if (t.status === "complete") return "Смена закрыта";
  return "Перенесено из архива";
}

function TeamToday({
  team,
  marks,
  time,
  canOpenStaff,
  divided,
}: {
  team: ShiftPerson[];
  marks: ShiftNow["attendance"];
  time: (iso: string) => string;
  canOpenStaff: boolean;
  divided: boolean;
}) {
  const wrap = cn(divided && "border-t pt-5");
  if (!team.length) return <p className={cn(wrap, "text-sm text-muted-foreground")}>Сегодня смен в графике нет</p>;

  // Один человек может стоять в графике на две смены — в стопке он один раз.
  const people = [...new Map(team.map((p) => [p.userId ?? p.casualId ?? p.shiftId, p])).values()];
  const missing = team.filter((p) => p.checkedIn === false);
  const shown = people.slice(0, STACK);
  const rest = people.length - shown.length;
  const names = people.slice(0, 3).map((p) => p.name.split(" ")[0]);

  return (
    <div className={cn(wrap, "space-y-4")}>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 -space-x-2">
          {shown.map((p) => (
            <span key={p.userId ?? p.casualId ?? p.shiftId} className="rounded-full ring-2 ring-card" data-tip={`${p.name} · ${time(p.startsAt)}–${time(p.endsAt)}`}>
              <PersonAvatar src={p.avatarUrl} name={p.name} />
            </span>
          ))}
          {rest > 0 ? (
            <span className="relative flex size-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-card tabular-nums">
              +{rest}
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {countRu(people.length, "человек", "человека", "человек")} на смене
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {names.join(", ")}
            {people.length > names.length ? ` и ещё ${people.length - names.length}` : ""}
          </p>
        </div>
      </div>

      {marks ? (
        missing.length ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {missing.length === 1 ? "Не отметился в Quick Resto" : `Не отметились в Quick Resto · ${missing.length}`}
            </p>
            <ul className="-mx-2">
              {missing.map((p, i) => (
                <li
                  key={p.shiftId}
                  className="table-row-in flex items-center gap-3 rounded-md px-2 py-1.5"
                  style={{ animationDelay: `${Math.min(i, 15) * 40}ms` }}
                >
                  <PersonAvatar src={p.avatarUrl} name={p.name} />
                  <span className="min-w-0 flex-1">
                    {canOpenStaff && p.userId ? (
                      <Link
                        href={`/people/staff/${p.userId}`}
                        className="block truncate text-[13px] font-medium transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.role, `смена с ${time(p.startsAt)}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{marksHint(team, marks, time)}</p>
        )
      ) : null}
    </div>
  );
}

function marksHint(team: ShiftPerson[], marks: NonNullable<ShiftNow["attendance"]>, time: (iso: string) => string) {
  const started = team.filter((p) => Date.parse(p.startsAt) <= Date.now()).length;
  if (!started) return "Смены ещё не начались";
  if (!marks.syncedAt) return "Отметки Quick Resto за сегодня ещё не получены";
  const checked = team.filter((p) => p.checkedIn === true).length;
  return `${checked === started ? "Все отметились" : `Отметились ${checked} из ${started}`} · на ${time(marks.syncedAt)}`;
}
