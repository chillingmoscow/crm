"use client";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { loadFinanceExecutionConfiguration, saveFinanceExecutionRules, type FinanceExecutionConfiguration } from "@/app/(dashboard)/sales/shifts/native-finance-actions";
function Form({ data, onClose, onSaved }: {
    data: FinanceExecutionConfiguration;
    onClose: () => void;
    onSaved: (v: FinanceExecutionConfiguration) => void;
}) {
    const previous = data.versions[0];
    const [enabled, setEnabled] = useState(previous?.enabled ?? false), [from, setFrom] = useState(previous?.from_date ?? data.suggestedFrom), [settlement, setSettlement] = useState(previous?.settlement ?? true), [movements, setMovements] = useState(previous?.movements ?? true), [stopped, setStopped] = useState(previous?.legacy_stopped ?? false), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const next = await saveFinanceExecutionRules({ venueId: data.venueId, version: previous?.version ?? 0, enabled, from: enabled ? from : previous?.from_date ?? null, settlement, movements, legacyStopped: stopped, reason });
            if (next) {
                onSaved(next);
                toast.success("Режим проведения сохранён");
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Не удалось сохранить режим");
        }
        finally {
            setBusy(false);
        }
    };
    return <EditDrawer open onOpenChange={v => { if (!v && !busy)
        onClose(); }} title="Финансовые операции" description="Поступления и движения денег по сменам" footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button disabled={busy || !reason.trim() || (enabled && (!from || !stopped || (!settlement && !movements)))} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить правила"}</Button></>}>
  <fieldset disabled={busy} className="min-w-0 space-y-6">
   <div className="flex items-center justify-between gap-4"><div><Label htmlFor="finance-auto">Автоматическое проведение</Label><p className="mt-1 text-xs text-muted-foreground">Создавать и корректировать связанные операции в финансах.</p></div><Switch id="finance-auto" checked={enabled} onCheckedChange={setEnabled}/></div>
   <div className="space-y-4 border-t pt-5">
    <label className="flex items-start gap-3"><Checkbox checked={settlement} onCheckedChange={v => setSettlement(v === true)}/><span className="text-sm">Выручка и личное потребление</span></label>
    <label className="flex items-start gap-3"><Checkbox checked={movements} onCheckedChange={v => setMovements(v === true)}/><span className="text-sm">Инкассации, внесения, такси и выдача чаевых</span></label>
   </div>
   {enabled && <>
    <div className="space-y-2"><Label htmlFor="finance-from">Начиная с рабочего дня</Label><DatePicker id="finance-from" value={from} onChange={setFrom} clearable={false}/></div>
    <label className="flex items-start gap-3 rounded-xl border p-4"><Checkbox checked={stopped} onCheckedChange={v => setStopped(v === true)}/><span className="text-sm">Подтверждаю: прежняя автоматика этих денежных операций остановлена, остатки и связи проверены.</span></label>
   </>}
   <p className="border-t pt-5 text-xs text-muted-foreground">Изменённые чеки корректируют связанные операции с историей. Ручные правки сохраняются и требуют проверки.</p>
   <div className="space-y-2"><Label htmlFor="finance-mode-reason">Основание изменения</Label><Textarea id="finance-mode-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Что изменили и почему"/></div>
   {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </fieldset>
 </EditDrawer>;
}
export function FinanceExecutionSettingsSection({ venueId }: {
    venueId: string;
}) {
    const [data, setData] = useState<FinanceExecutionConfiguration | null>(null), [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
    useEffect(() => { let live = true; setData(null); setOpen(false); setError(null); loadFinanceExecutionConfiguration(venueId).then(v => { if (live)
        setData(v); }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, [venueId]);
    if ((data && data.venueId !== venueId) || (!data && !error))
        return null;
    const current = data?.versions[0];
    return <section className="space-y-4 rounded-lg border p-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Проведение финансовых операций</h2><p className="mt-1 text-sm text-muted-foreground">{current?.enabled ? `Автоматически с ${new Date(current.from_date + "T12:00:00").toLocaleDateString("ru-RU")}` : "Режим сверки: денежные операции остаются в прежней системе."}</p></div><Button variant="outline" size="sm" disabled={!data} onClick={() => setOpen(true)}><Settings2 className="mr-2 size-4"/>Настроить</Button></div>
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  {!!data?.versions.length && <details className="border-t pt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">История правил</summary><ol className="mt-3 divide-y">{data.versions.map(v => <li key={v.id} className="space-y-1 py-3"><p>Версия {v.version} · {v.actor_name}</p><p className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString("ru-RU")} · {v.enabled ? `проведение с ${v.from_date}` : "режим сверки"}</p><p className="text-muted-foreground">{v.reason}</p></li>)}</ol></details>}
  {open && data && <Form key={venueId} data={data} onClose={() => setOpen(false)} onSaved={v => { setData(v); setOpen(false); }}/>}
 </section>;
}
