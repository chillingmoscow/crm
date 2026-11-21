"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDayMonthTime } from "@/lib/format/date";
import { salesErrorText } from "@/lib/sales/errors";
import {
  loadFinanceExecutionDay,
  retryNativeFinance,
  type FinanceExecutionRun,
} from "../native-finance-actions";
import type { NativeFinanceKind } from "@/lib/finance/native-plan";

const kindLabel = (kind: NativeFinanceKind) =>
  kind === "settlement"
    ? "Поступления и личное потребление"
    : "Инкассации, такси и чаевые";
const states: Record<string, { label: string; tone: StatusTone }> = {
  committed: { label: "Проведено", tone: "success" },
  done: { label: "Проведено", tone: "success" },
  pending: { label: "Ожидает", tone: "neutral" },
  running: { label: "Проводим", tone: "info" },
  review: { label: "Проверить", tone: "warning" },
  error: { label: "Ошибка", tone: "danger" },
};
const message = (s: string | null) =>
  salesErrorText(s, "Не удалось провести операции. Нужна проверка");

function Status({ state }: { state: string }) {
  const s = states[state] ?? states.review;
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

function counts(run: FinanceExecutionRun) {
  return `Создано ${run.created_count} · исправлено ${run.corrected_count} · связано ${run.linked_count} · отменено ${run.cancelled_count}`;
}

/** Проведение финансовых операций по смене: текущее состояние или история запусков. */
export function NativeFinancePanel({
  venueId,
  date,
  history = false,
}: {
  venueId: string;
  date: string;
  history?: boolean;
}) {
  const key = venueId + date;
  const [data, setData] = useState<{
    key: string;
    value: NonNullable<Awaited<ReturnType<typeof loadFinanceExecutionDay>>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError(null);
    const read = async () => {
      let pending = false;
      try {
        const v = await loadFinanceExecutionDay(venueId, date);
        if (live) {
          setData(v ? { key, value: v } : null);
          setError(null);
          pending = !!v?.jobs.some(
            (j) => j.state === "running" || j.state === "pending",
          );
        }
      } catch (e) {
        if (live)
          setError(
            salesErrorText(
              e instanceof Error ? e.message : null,
              "Не удалось загрузить операции",
            ),
          );
      } finally {
        if (live && !history)
          timer = setTimeout(() => {
            if (document.visibilityState === "visible") void read();
            else timer = setTimeout(() => void read(), 30000);
          }, pending ? 5000 : 30000);
      }
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [venueId, date, key, history]);
  const current = data?.key === key ? data.value : null;
  if (!current && !error) return null;
  if (!current?.jobs.length && !current?.runs.length && !error) return null;

  const retry = async (kind: NativeFinanceKind) => {
    setBusy(true);
    try {
      await retryNativeFinance(venueId, date, kind);
      const v = await loadFinanceExecutionDay(venueId, date);
      if (v) setData({ key, value: v });
      setError(null);
    } catch (e) {
      setError(
        salesErrorText(
          e instanceof Error ? e.message : null,
          "Не удалось повторить проведение",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const more = async () => {
    if (!current?.runs.length) return;
    setBusy(true);
    try {
      const v = await loadFinanceExecutionDay(
        venueId,
        date,
        current.runs[current.runs.length - 1].id,
      );
      if (v)
        setData({ key, value: { ...v, runs: [...current.runs, ...v.runs] } });
    } catch {
      setError("Не удалось загрузить историю");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DrawerSection title={history ? "Проведение операций" : "Операции по смене"}>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {history ? (
        <>
          {!!current?.runs.length && (
            <DrawerTimeline>
              {current.runs.map((r, index) => (
                <DrawerTimelineItem
                  key={r.id}
                  last={index === current.runs.length - 1}
                  avatar={<DrawerAvatar name="Sheerly" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {kindLabel(r.kind)}
                      <Status state={r.state} />
                    </span>
                  }
                  meta={formatDayMonthTime(r.created_at) ?? undefined}
                >
                  <p className="text-muted-foreground">{counts(r)}</p>
                  {r.message && (
                    <p className="text-muted-foreground">{message(r.message)}</p>
                  )}
                </DrawerTimelineItem>
              ))}
            </DrawerTimeline>
          )}
          {current?.more && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void more()}
            >
              {busy ? "Загружаем…" : "Показать ещё"}
            </Button>
          )}
        </>
      ) : (
        <ul className="divide-y">
          {current?.jobs.map((j) => (
            <li key={j.kind} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{kindLabel(j.kind)}</p>
                <Status state={j.state} />
              </div>
              {j.message && (
                <p className="text-xs text-muted-foreground">
                  {message(j.message)}
                </p>
              )}
              {(j.state === "review" || j.state === "error") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void retry(j.kind)}
                >
                  Повторить после проверки
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </DrawerSection>
  );
}
