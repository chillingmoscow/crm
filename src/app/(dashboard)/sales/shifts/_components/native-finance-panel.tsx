"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadFinanceExecutionDay, retryNativeFinance, type FinanceExecutionRun } from "../native-finance-actions";
import type { NativeFinanceKind } from "@/lib/finance/native-plan";
const label = (kind: NativeFinanceKind) => kind === "settlement" ? "Поступления и личное потребление" : "Инкассации, такси и чаевые";
const states: Record<string, string> = { committed: "Проведено", done: "Проведено", pending: "Ожидает", running: "Проводим", review: "Проверить", error: "Ошибка" };
const message = (s: string | null) => s && /[А-Яа-яЁё]/.test(s) ? s : s ? "Не удалось провести операции. Требуется проверка." : null;
function Status({ state }: {
    state: string;
}) { return <Badge variant="outline" className={state === "error" ? "text-destructive" : state === "review" ? "text-amber-600" : state === "done" || state === "committed" ? "text-emerald-600" : "text-muted-foreground"}>{states[state] ?? "Проверить"}</Badge>; }
function Counts({ run }: {
    run: FinanceExecutionRun;
}) { return <p className="mt-2 text-xs text-muted-foreground">Создано {run.created_count} · исправлено {run.corrected_count} · связано {run.linked_count} · отменено {run.cancelled_count}</p>; }
export function NativeFinancePanel({ venueId, date, history = false }: {
    venueId: string;
    date: string;
    history?: boolean;
}) {
    const key = venueId + date;
    const [data, setData] = useState<{
        key: string;
        value: NonNullable<Awaited<ReturnType<typeof loadFinanceExecutionDay>>>;
    } | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
    useEffect(() => {
        let live = true;
        let timer: ReturnType<typeof setTimeout>;
        setData(null);
        setError(null);
        const read = async () => { let pending = false; try {
            const v = await loadFinanceExecutionDay(venueId, date);
            if (live) {
                setData(v ? { key, value: v } : null);
                setError(null);
                pending = !!v?.jobs.some(j => j.state === "running" || j.state === "pending");
            }
        }
        catch (e) {
            if (live)
                setError(e instanceof Error ? message(e.message) : "Не удалось загрузить операции");
        }
        finally {
            if (live && !history)
                timer = setTimeout(() => void read(), pending ? 5000 : 30000);
        } };
        void read();
        return () => { live = false; clearTimeout(timer); };
    }, [venueId, date, key, history]);
    const current = data?.key === key ? data.value : null;
    if (!current && !error)
        return null;
    if (!current?.jobs.length && !current?.runs.length && !error)
        return null;
    const retry = async (kind: NativeFinanceKind) => { setBusy(true); try {
        await retryNativeFinance(venueId, date, kind);
        const v = await loadFinanceExecutionDay(venueId, date);
        if (v)
            setData({ key, value: v });
        setError(null);
    }
    catch (e) {
        setError(e instanceof Error ? message(e.message) : "Не удалось повторить проведение");
    }
    finally {
        setBusy(false);
    } };
    const more = async () => { if (!current?.runs.length)
        return; setBusy(true); try {
        const v = await loadFinanceExecutionDay(venueId, date, current.runs[current.runs.length - 1].id);
        if (v)
            setData({ key, value: { ...v, runs: [...current.runs, ...v.runs] } });
    }
    catch (e) {
        setError(e instanceof Error ? message(e.message) : "Не удалось загрузить историю");
    }
    finally {
        setBusy(false);
    } };
    return <section className="space-y-4 border-t pt-5"><h3 className="text-sm font-semibold">{history ? "История проведения операций" : "Операции по смене"}</h3>
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  {history ? <>
   {current?.runs.map(r => <details key={r.id} className="rounded-xl border p-4 text-sm"><summary className="cursor-pointer"><span className="flex flex-wrap items-center justify-between gap-2"><span>{label(r.kind)}</span><Status state={r.state}/></span><span className="mt-1 block text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("ru-RU")} · Система</span></summary><Counts run={r}/>{message(r.message) && <p className="mt-2 text-xs text-muted-foreground">{message(r.message)}</p>}</details>)}
   {current?.more && <Button variant="outline" size="sm" disabled={busy} onClick={() => void more()}>Показать ещё</Button>}
  </> : current?.jobs.map(j => <div key={j.kind} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{label(j.kind)}</p><Status state={j.state}/></div>{message(j.message) && <p className="mt-2 text-xs text-muted-foreground">{message(j.message)}</p>}{j.state === "review" || j.state === "error" ? <Button variant="outline" size="sm" className="mt-3" disabled={busy} onClick={() => void retry(j.kind)}>Повторить после проверки</Button> : null}</div>)}
 </section>;
}
