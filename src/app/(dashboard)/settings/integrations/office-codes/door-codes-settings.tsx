"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { IntegrationVenue } from "@/lib/integrations/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { candidateError } from "@/lib/candidates/errors";
import { FieldSelect } from "@/app/(dashboard)/people/candidates/_components/fields";
import { getEmploymentSettings, readDoorPool, saveDoorPool } from "../actions";
import { IntegrationLayout, IntegrationSection, IntegrationStatus, IntegrationNotice } from "../_components/integration-layout";
export function DoorCodesSettings({ venues, activeVenue, initialPool }: { venues: IntegrationVenue[]; activeVenue: string; initialPool: Awaited<ReturnType<typeof readDoorPool>> }) {
  const [venue, setVenue] = useState(activeVenue), [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false);
  const [pool, setPool] = useState(initialPool), [adding, setAdding] = useState(false), [codes, setCodes] = useState("");
  const [empty, setEmpty] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [busy, start] = useTransition();
  useEffect(() => {
    let active = true; setLoaded(false); setError("");
    if (!venue) return;
    getEmploymentSettings(venue).then(value => { if (active) { setReady(value?.office_pool_initialized ?? false); setLoaded(true); } }).catch(e => { if (active) setError(candidateError(e, "Не удалось загрузить настройки кодов")); });
    return () => { active = false; };
  }, [venue, attempt]);
  if (!venues.length) return <IntegrationLayout title="Коды замка" description="Учёт кодов доступа сотрудников."><IntegrationNotice>Сначала <Link href="/org/venues" className="text-brand hover:underline">добавьте заведение</Link>, для которого будут выдаваться коды.</IntegrationNotice></IntegrationLayout>;
  return <IntegrationLayout title="Коды замка" description="Учитывайте занятые номера и коды, чтобы Sheerly не выдавала их повторно. В физический замок коды добавляют отдельно."
    status={loaded ? <IntegrationStatus tone={ready ? "success" : "warning"}>{ready ? "Настроено" : "Нужна настройка"}</IntegrationStatus> : undefined}>
    <div className="max-w-3xl space-y-5">
      <div className="max-w-sm"><FieldSelect label="Заведение" value={venue} onChange={setVenue} disabled={busy || adding} options={venues.map(v => ({ value: v.id, label: v.name }))} /></div>
      <IntegrationSection title="Учёт доступа" actions={loaded && !adding ? <Button variant="outline" size="sm" onClick={() => { setAdding(true); setError(""); }}><Plus className="mr-2 size-4" />{ready || pool.reservedNumbers || pool.reservedPasswords ? "Добавить занятые коды" : "Настроить"}</Button> : null}>
        {!loaded && !error ? <Skeleton className="h-14 w-full" /> : <dl className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-3">{[{ label: "Занятые номера", value: pool.reservedNumbers }, { label: "Зарезервированные коды", value: pool.reservedPasswords }, { label: "Действующие доступы", value: pool.issued }].map(item => <div key={item.label}><dt className="leading-5 text-muted-foreground">{item.label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{item.value}</dd></div>)}</dl>}
        <IntegrationNotice>Резерв номеров и кодов общий для организации. Выдача доступов при найме включается для выбранного заведения.</IntegrationNotice>
        {loaded && !ready && !adding && (pool.reservedNumbers > 0 || pool.reservedPasswords > 0) ? <div className="space-y-3 border-t pt-4"><IntegrationNotice>Занятые коды уже учтены. Для этого заведения можно использовать существующий резерв.</IntegrationNotice><Button size="sm" disabled={busy} onClick={() => start(async () => {
          setError(""); try { await saveDoorPool(venue, { codes: "", confirm_empty_pool: false, use_existing_pool: true }); setReady(true); toast.success("Учёт кодов включён для заведения"); }
          catch (e) { setError(candidateError(e, "Не удалось включить учёт кодов")); }
        })}>{busy ? "Сохраняем…" : "Использовать резерв организации"}</Button></div> : null}
        {adding ? <form className="space-y-4 border-t pt-5" onSubmit={e => { e.preventDefault(); start(async () => {
          setError(""); try { const saved = await saveDoorPool(venue, { codes, confirm_empty_pool: empty }); setPool(await readDoorPool()); setReady(true); setCodes(""); setEmpty(false); setAdding(false); toast.success(saved.imported ? `Добавлено строк: ${saved.imported}` : "Учёт кодов настроен"); }
          catch (e) { setError(candidateError(e, "Не удалось сохранить коды")); }
        }); }}>
          <div className="space-y-2"><Label htmlFor="office-codes">Занятые номера и коды</Label><Textarea id="office-codes" rows={5} autoComplete="off" spellCheck={false} value={codes} disabled={busy} onChange={e => setCodes(e.target.value)} placeholder="Номер пользователя и код через пробел, одна пара в строке" /><IntegrationNotice>Можно вставить два столбца. Имеющиеся записи сохранятся; повторяющиеся значения добавлять заново не нужно.</IntegrationNotice></div>
          {!ready && !pool.reservedNumbers && !pool.reservedPasswords ? <label className="flex items-start gap-2 text-sm"><Checkbox checked={empty} onCheckedChange={v => setEmpty(v === true)} disabled={busy} className="mt-0.5" />Коды ранее не выдавались</label> : null}
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || (!codes.trim() && !empty)}>{busy ? "Сохраняем…" : "Сохранить"}</Button><Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setAdding(false); setCodes(""); setEmpty(false); setError(""); }}>Отмена</Button></div>
        </form> : null}
        {error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p>{!loaded ? <Button size="sm" variant="outline" onClick={() => setAttempt(v => v + 1)}>Повторить</Button> : null}</div> : null}
      </IntegrationSection>
      <IntegrationNotice>Выданные сотруднику номер и код доступны владельцу в карточке сотрудника. Список паролей здесь не отображается.</IntegrationNotice>
    </div>
  </IntegrationLayout>;
}
