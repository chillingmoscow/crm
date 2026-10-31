"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldSelect } from "@/app/(dashboard)/people/candidates/_components/fields";
import { candidateError } from "@/lib/candidates/errors";
import type { EmploymentSettings, IntegrationVenue } from "@/lib/integrations/settings";
import { getEmploymentSettings, getHiringDictionaries, saveHiringSettings } from "../../actions";
import { IntegrationSection, IntegrationNotice } from "../../_components/integration-layout";
import { StorePicker, type DictionaryOption } from "../../_components/store-picker";
const defaults: EmploymentSettings = { store_ids: [1], master_store_ids: [16], staff_group_id: 8, bonus_account_type_id: 1, tips_uri: null, office_pool_initialized: false };
export function HiringSettings({ venues, activeVenue, editable }: { venues: IntegrationVenue[]; activeVenue: string; editable: boolean }) {
  const [venue, setVenue] = useState(activeVenue), [value, setValue] = useState(defaults), [saved, setSaved] = useState(defaults);
  const [loaded, setLoaded] = useState(false), [editing, setEditing] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [dictionaries, setDictionaries] = useState<Awaited<ReturnType<typeof getHiringDictionaries>>>({ stores: [], groups: [], accountTypes: [] });
  const [dictionaryError, setDictionaryError] = useState(""), [dictionaryAttempt, setDictionaryAttempt] = useState(0), [busy, start] = useTransition();
  useEffect(() => {
    let active = true; setLoaded(false); setError("");
    if (!venue) return;
    getEmploymentSettings(venue).then(next => { if (active) { setValue(next ?? defaults); setSaved(next ?? defaults); setLoaded(true); } }).catch(e => { if (active) setError(candidateError(e, "Не удалось загрузить настройки сотрудников")); });
    return () => { active = false; };
  }, [venue, attempt]);
  useEffect(() => {
    let active = true; setDictionaryError("");
    if (!venues.length) return;
    getHiringDictionaries().then(next => { if (active) setDictionaries(next); }).catch(() => { if (active) setDictionaryError("Не удалось обновить названия из Quick Resto. Сохранённые значения доступны."); });
    return () => { active = false; };
  }, [dictionaryAttempt, venues.length]);
  const title = (list: DictionaryOption[], id: number, fallback: string) => list.find(x => x.value === id)?.label ?? `${fallback} № ${id}`;
  const selectOptions = (list: DictionaryOption[], id: number, fallback: string) => [...list, ...(!list.some(x => x.value === id) ? [{ value: id, label: `${fallback} № ${id}` }] : [])].map(x => ({ value: String(x.value), label: x.label }));
  const set = <K extends keyof EmploymentSettings>(key: K, next: EmploymentSettings[K]) => setValue(current => ({ ...current, [key]: next }));
  if (!venues.length) return <IntegrationNotice>Сначала <Link href="/org/venues" className="text-brand hover:underline">добавьте заведение</Link>, для которого будут создаваться сотрудники.</IntegrationNotice>;
  return <div className="max-w-3xl space-y-5">
    <div className="max-w-sm"><FieldSelect label="Заведение" value={venue} onChange={setVenue} disabled={busy || editing} options={venues.map(v => ({ value: v.id, label: v.name }))} /></div>
    <IntegrationSection title="Создание сотрудника" description="Эти параметры применяются после нажатия «Принять на работу»."
      actions={editable && loaded && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-2 size-4" />Изменить</Button> : null}>
      {!loaded && !error ? <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></div> : loaded ? editing ? <form className="space-y-5" onSubmit={e => { e.preventDefault(); start(async () => {
        setError(""); try { await saveHiringSettings(venue, value); setSaved(value); setEditing(false); toast.success("Настройки создания сотрудника сохранены"); }
        catch (e) { setError(candidateError(e, "Не удалось сохранить настройки сотрудников")); }
      }); }}>
        <Field label="Склады для всех сотрудников"><StorePicker label="Склады для всех сотрудников" value={value.store_ids} onChange={v => set("store_ids", v)} options={dictionaries.stores} disabled={busy} /></Field>
        <Field label="Дополнительные склады для кальянных мастеров"><StorePicker label="Дополнительные склады для кальянных мастеров" value={value.master_store_ids} onChange={v => set("master_store_ids", v)} options={dictionaries.stores} disabled={busy} /></Field>
        <div className="grid gap-5 sm:grid-cols-2"><FieldSelect label="Группа гостей для сотрудников" value={String(value.staff_group_id)} onChange={v => set("staff_group_id", Number(v))} options={selectOptions(dictionaries.groups, value.staff_group_id, "Группа")} disabled={busy} />
          <FieldSelect label="Тип бонусного счёта" value={String(value.bonus_account_type_id)} onChange={v => set("bonus_account_type_id", Number(v))} options={selectOptions(dictionaries.accountTypes, value.bonus_account_type_id, "Тип счёта")} disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor="hiring-tips">Ссылка на чаевые</Label><Input id="hiring-tips" type="url" value={value.tips_uri ?? ""} onChange={e => set("tips_uri", e.target.value || null)} placeholder="https://…" maxLength={1000} disabled={busy} /></div>
        <div className="flex gap-2"><Button size="sm" disabled={busy || !value.store_ids.length}>{busy ? "Сохраняем…" : "Сохранить"}</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setValue(saved); setEditing(false); setError(""); }}>Отмена</Button></div>
      </form> : <dl className="divide-y text-sm">{[
        ["Склады для всех", value.store_ids.map(id => title(dictionaries.stores, id, "Склад")).join(", ")],
        ["Дополнительно для кальянных мастеров", value.master_store_ids.map(id => title(dictionaries.stores, id, "Склад")).join(", ") || "Не выбрано"],
        ["Группа гостей", title(dictionaries.groups, value.staff_group_id, "Группа")],
        ["Бонусный счёт", title(dictionaries.accountTypes, value.bonus_account_type_id, "Тип счёта")],
        ["Чаевые", value.tips_uri || "Не настроены"],
      ].map(([label, text]) => <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-5" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{text}</dd></div>)}</dl> : null}
      {dictionaryError ? <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="max-w-lg text-sm leading-6 text-muted-foreground">{dictionaryError}</p><Button variant="outline" size="sm" onClick={() => setDictionaryAttempt(v => v + 1)}>Повторить</Button></div> : null}
      {error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p>{!loaded ? <Button variant="outline" size="sm" onClick={() => setAttempt(v => v + 1)}>Повторить</Button> : null}</div> : null}
    </IntegrationSection>
    {!editable ? <IntegrationNotice>Изменять параметры создания сотрудников может владелец организации.</IntegrationNotice> : null}
  </div>;
}
