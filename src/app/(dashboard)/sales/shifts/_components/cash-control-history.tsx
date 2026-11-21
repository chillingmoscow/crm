"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { formatRub } from "@/components/shared/money";
import { formatDayMonthTime } from "@/lib/format/date";
import { loadCashHistory, type CashHistoryEntry } from "../cash-control-actions";

const amount = (v: number | null) =>
  formatRub(v === null ? null : v / 100, { fraction: "auto" });

/** История кассовых остатков: каждая версия — что прочитали из кассовых отчётов. */
export function CashControlHistory({
  venueId,
  date,
}: {
  venueId: string;
  date: string;
}) {
  const [rows, setRows] = useState<CashHistoryEntry[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    loadCashHistory(venueId, date)
      .then((d) => {
        if (live) {
          setAllowed(d !== null);
          setRows(d?.rows ?? []);
          setMore(d?.more ?? false);
        }
      })
      .catch(() => {
        if (live) setError("Не удалось загрузить историю кассы");
      });
    return () => {
      live = false;
    };
  }, [venueId, date]);
  const next = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const d = await loadCashHistory(venueId, date, rows[rows.length - 1].version);
      setRows((old) => [...(old ?? []), ...(d?.rows ?? [])]);
      setMore(d?.more ?? false);
      setError(null);
    } catch {
      setError("Не удалось загрузить историю кассы");
    } finally {
      setBusy(false);
    }
  };
  if (!allowed && !error) return null;
  return (
    <DrawerSection title="Кассовые остатки">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовые отчёты за этот день ещё не загружены
        </p>
      )}
      {!!rows?.length && (
        <DrawerTimeline>
          {rows.map((entry, index) => (
            <DrawerTimelineItem
              key={entry.id}
              last={index === rows.length - 1}
              avatar={<DrawerAvatar name={entry.actor_name} />}
              title={`Версия ${entry.version}`}
              meta={`${entry.actor_name} · ${formatDayMonthTime(entry.created_at)}`}
            >
              {entry.reports.map((r) => (
                <div key={r.id}>
                  <p>
                    {r.terminal} · смена №{r.shiftNumber ?? r.id}
                  </p>
                  <p className="text-muted-foreground">
                    Открытие: расчёт {amount(r.openExpected)}, указано{" "}
                    {amount(r.openDeclared)}
                  </p>
                  {r.status === "CLOSED" && (
                    <p className="text-muted-foreground">
                      Закрытие: расчёт {amount(r.closeExpected)}, указано{" "}
                      {amount(r.closeDeclared)}
                    </p>
                  )}
                </div>
              ))}
              {entry.reports.length === 0 && (
                <p className="text-muted-foreground">Кассовых смен не было</p>
              )}
            </DrawerTimelineItem>
          ))}
        </DrawerTimeline>
      )}
      {more && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void next()}
        >
          {busy ? "Загружаем…" : "Показать ещё"}
        </Button>
      )}
    </DrawerSection>
  );
}
