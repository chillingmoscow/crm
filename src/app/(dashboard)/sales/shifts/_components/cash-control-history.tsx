"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  loadCashHistory,
  type CashHistoryEntry,
} from "../cash-control-actions";
import { money } from "@/lib/sales/format";
const amount = (v: number | null) => (v === null ? "—" : `${money(v / 100)} ₽`);
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
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [venueId, date]);
  const next = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const d = await loadCashHistory(
        venueId,
        date,
        rows[rows.length - 1].version,
      );
      setRows((old) => [...(old ?? []), ...(d?.rows ?? [])]);
      setMore(d?.more ?? false);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить историю кассы",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!allowed && !error) return null;
  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="text-sm font-semibold">История кассовых остатков</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows?.map((entry) => (
        <details key={entry.id} className="rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer">
            <span>
              Версия {entry.version} · {entry.actor_name}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {new Date(entry.created_at).toLocaleString("ru-RU")}
            </span>
          </summary>
          <div className="mt-3 space-y-4">
            {entry.reports.map((r) => (
              <div key={r.id}>
                <p className="font-medium">
                  {r.terminal} · смена №{r.shiftNumber ?? r.id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Открытие: расчёт {amount(r.openExpected)}, указано{" "}
                  {amount(r.openDeclared)}
                </p>
                {r.status === "CLOSED" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Закрытие: расчёт {amount(r.closeExpected)}, указано{" "}
                    {amount(r.closeDeclared)}
                  </p>
                )}
              </div>
            ))}
            {entry.reports.length === 0 && (
              <p className="text-muted-foreground">
                Кассовых смен за этот день нет.
              </p>
            )}
          </div>
        </details>
      ))}
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Кассовые отчёты за этот день ещё не загружены.
        </p>
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
    </section>
  );
}
