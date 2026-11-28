"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { EmploymentSettings, IntegrationVenue } from "@/lib/integrations/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { OptionSelect } from "@/components/ui/option-select";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { candidateError } from "@/lib/candidates/errors";
import { countRu } from "@/lib/format/plural";
import { unwrapAction } from "@/lib/actions/result";
import { getEmploymentSettings, readDoorPool, saveDoorPool, type DoorPool } from "../actions";
import { IntegrationFacts, IntegrationLayout, IntegrationNotice, IntegrationSection, IntegrationStatus } from "../_components/integration-layout";

const CONTEXT = "Коды доступа новым сотрудникам без повторов";

export function DoorCodesOwnerOnly() {
  return <IntegrationLayout provider="office-codes" title="Коды замка" context={CONTEXT}>
    <IntegrationNotice>Настройки кодов доступны владельцу организации</IntegrationNotice>
  </IntegrationLayout>;
}

export function DoorCodesSettings({ venues, activeVenue, initialPool, initialSettings }: {
  venues: IntegrationVenue[]; activeVenue: string; initialPool: DoorPool;
  /** Настройки активного заведения с сервера: статус и факты приходят в первой разметке. */
  initialSettings?: EmploymentSettings | null;
}) {
  const served = initialSettings !== undefined;
  const [venue, setVenue] = useState(activeVenue), [ready, setReady] = useState(initialSettings?.office_pool_initialized ?? false), [loaded, setLoaded] = useState(served);
  const [pool, setPool] = useState(initialPool), [adding, setAdding] = useState(false), [codes, setCodes] = useState("");
  const [empty, setEmpty] = useState(false), [error, setError] = useState(""), [saveError, setSaveError] = useState(""), [attempt, setAttempt] = useState(0), [busy, start] = useTransition();
  // Настройки активного заведения прислал сервер — запрос не нужен, пока
  // заведение ни разу не меняли и не нажали «Повторить». После первой смены
  // читаем всегда, и при возврате к исходному (условие по состоянию —
  // двойной запуск эффектов в StrictMode его не ломает).
  const venueTouched = useRef(false);
  useEffect(() => {
    if (served && !venueTouched.current && venue === activeVenue && attempt === 0) return;
    venueTouched.current = true;
    let active = true; setLoaded(false); setError("");
    if (!venue) return;
    getEmploymentSettings(venue).then(unwrapAction).then(value => { if (active) { setReady(value?.office_pool_initialized ?? false); setLoaded(true); } }).catch(e => { if (active) setError(candidateError(e, "Не удалось загрузить настройки кодов")); });
    return () => { active = false; };
  }, [venue, attempt, served, activeVenue]);
  const hasPool = pool.reservedNumbers > 0 || pool.reservedPasswords > 0;
  const close = () => { if (!busy) { setAdding(false); setCodes(""); setEmpty(false); setSaveError(""); } };

  if (!venues.length) return <IntegrationLayout provider="office-codes" title="Коды замка" context={CONTEXT}>
    <IntegrationNotice>Сначала <Link href="/org/venues" className="text-brand hover:underline">добавьте заведение</Link>, для которого будут выдаваться коды</IntegrationNotice>
  </IntegrationLayout>;
  return <IntegrationLayout provider="office-codes" title="Коды замка" context={CONTEXT}
    status={loaded ? <IntegrationStatus tone={ready ? "success" : "warning"}>{ready ? "Работает" : "Требует настройки"}</IntegrationStatus> : undefined}>
    {venues.length > 1 ? <Field id="codes-venue" label="Заведение" className="max-w-sm">
      {control => <OptionSelect id={control.id} aria-label="Заведение" value={venue} onValueChange={setVenue} disabled={busy} options={venues.map(v => ({ value: v.id, label: v.name }))} />}
    </Field> : null}
    <IntegrationSection title="Учёт доступа" description="Занятые номера и коды, чтобы не выдавать их повторно. В сам замок коды добавляют отдельно"
      actions={loaded ? <Button variant="outline" size="sm" onClick={() => { setSaveError(""); setAdding(true); }}><Plus className="size-4" />{ready || hasPool ? "Добавить занятые коды" : "Настроить"}</Button> : null}>
      {!loaded && !error ? <Skeleton className="h-24 w-full" /> : null}
      {loaded ? <IntegrationFacts items={[
        { label: "Занятые номера", value: <span className="tabular-nums">{pool.reservedNumbers}</span> },
        { label: "Зарезервированные коды", value: <span className="tabular-nums">{pool.reservedPasswords}</span> },
        { label: "Действующие доступы", value: <span className="tabular-nums">{pool.issued}</span> },
      ]} /> : null}
      {loaded && !ready && hasPool ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <span>Занятые коды организации уже учтены. Их можно использовать и для этого заведения</span>
        <Button size="sm" disabled={busy} onClick={() => start(async () => {
          setError(""); try { unwrapAction(await saveDoorPool(venue, { codes: "", confirm_empty_pool: false, use_existing_pool: true })); setReady(true); toast.success("Учёт кодов включён для заведения"); }
          catch (e) { setError(candidateError(e, "Не удалось включить учёт кодов")); }
        })}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{busy ? "Сохраняем…" : "Использовать резерв"}</Button>
      </div> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-destructive">{error}</p>{!loaded ? <Button size="sm" variant="outline" onClick={() => setAttempt(v => v + 1)}>Повторить</Button> : null}</div> : null}
      <IntegrationNotice>Резерв общий для организации. Номер и код сотрудника видны владельцу в карточке сотрудника</IntegrationNotice>
    </IntegrationSection>

    <EditDrawer open={adding} onOpenChange={o => { if (!o) close(); }} title="Занятые коды" description="Уже выданные номера и коды: Sheerly не будет выдавать их новым сотрудникам"
      footer={<><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button>
        <Button disabled={busy || (!codes.trim() && !empty)} onClick={() => start(async () => {
          setSaveError("");
          try { const saved = unwrapAction(await saveDoorPool(venue, { codes, confirm_empty_pool: empty })); setPool(unwrapAction(await readDoorPool())); setReady(true); setAdding(false); setCodes(""); setEmpty(false);
            toast.success(saved.imported ? `Добавлено: ${countRu(saved.imported, "строка", "строки", "строк")}` : "Учёт кодов настроен"); }
          catch (e) { setSaveError(candidateError(e, "Не удалось сохранить коды")); }
        })}>{busy ? "Сохраняем…" : "Сохранить"}</Button></>}>
      <div className="flex flex-col gap-5">
        <Field label="Номера и коды" hint="Трёхзначный номер и шестизначный код через пробел, одна пара в строке. Можно вставить два столбца из таблицы" error={saveError || undefined}>
          {control => <Textarea {...control} rows={8} autoComplete="off" spellCheck={false} value={codes} disabled={busy} onChange={e => setCodes(e.target.value)} placeholder={"101 123456\n102 654321"} />}
        </Field>
        {!ready && !hasPool ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={empty} onCheckedChange={v => setEmpty(v === true)} disabled={busy} />Коды ранее не выдавались</label> : null}
      </div>
    </EditDrawer>
  </IntegrationLayout>;
}
