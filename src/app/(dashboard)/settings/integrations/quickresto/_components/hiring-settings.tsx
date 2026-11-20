"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { OptionSelect } from "@/components/ui/option-select";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { candidateError } from "@/lib/candidates/errors";
import type { EmploymentSettings, IntegrationVenue } from "@/lib/integrations/settings";
import { getEmploymentSettings, getHiringDictionaries, saveHiringSettings } from "../../actions";
import { IntegrationFacts, IntegrationNotice, IntegrationSection } from "../../_components/integration-layout";
import { StorePicker, type DictionaryOption } from "../../_components/store-picker";

const defaults: EmploymentSettings = { store_ids: [1], master_store_ids: [16], staff_group_id: 8, bonus_account_type_id: 1, tips_uri: null, office_pool_initialized: false };

export function HiringSettings({ venues, activeVenue, editable }: { venues: IntegrationVenue[]; activeVenue: string; editable: boolean }) {
  const [venue, setVenue] = useState(activeVenue), [saved, setSaved] = useState(defaults), [draft, setDraft] = useState<EmploymentSettings | null>(null);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [saveError, setSaveError] = useState(""), [attempt, setAttempt] = useState(0);
  const [dictionaries, setDictionaries] = useState<Awaited<ReturnType<typeof getHiringDictionaries>>>({ stores: [], groups: [], accountTypes: [] });
  const [dictionaryError, setDictionaryError] = useState(""), [dictionaryAttempt, setDictionaryAttempt] = useState(0), [busy, start] = useTransition();
  useEffect(() => {
    let active = true; setLoaded(false); setError("");
    if (!venue) return;
    getEmploymentSettings(venue).then(next => { if (active) { setSaved(next ?? defaults); setLoaded(true); } }).catch(e => { if (active) setError(candidateError(e, "Не удалось загрузить настройки сотрудников")); });
    return () => { active = false; };
  }, [venue, attempt]);
  useEffect(() => {
    let active = true; setDictionaryError("");
    if (!venues.length) return;
    getHiringDictionaries().then(next => { if (active) setDictionaries(next); }).catch(() => { if (active) setDictionaryError("Не удалось получить названия из Quick Resto. Сохранённые значения доступны"); });
    return () => { active = false; };
  }, [dictionaryAttempt, venues.length]);

  const title = (list: DictionaryOption[], id: number, fallback: string) => list.find(x => x.value === id)?.label ?? `${fallback} № ${id}`;
  const options = (list: DictionaryOption[], id: number, fallback: string) => [...list, ...(!list.some(x => x.value === id) ? [{ value: id, label: `${fallback} № ${id}` }] : [])].map(x => ({ value: String(x.value), label: x.label }));
  const set = <K extends keyof EmploymentSettings>(key: K, next: EmploymentSettings[K]) => setDraft(current => current && ({ ...current, [key]: next }));
  const close = () => { if (!busy) { setDraft(null); setSaveError(""); } };
  const save = () => draft && start(async () => {
    setSaveError("");
    try { await saveHiringSettings(venue, draft); setSaved(draft); setDraft(null); toast.success("Настройки создания сотрудника сохранены"); }
    catch (e) { setSaveError(candidateError(e, "Не удалось сохранить настройки сотрудников")); }
  });

  if (!venues.length) return <IntegrationNotice>Сначала <Link href="/org/venues" className="text-brand hover:underline">добавьте заведение</Link>, для которого будут создаваться сотрудники</IntegrationNotice>;
  return <div className="flex flex-col gap-5">
    {venues.length > 1 ? <Field id="hiring-venue" label="Заведение" className="max-w-sm">
      {control => <OptionSelect id={control.id} aria-label="Заведение" value={venue} onValueChange={setVenue} options={venues.map(v => ({ value: v.id, label: v.name }))} />}
    </Field> : null}
    <IntegrationSection title="Создание сотрудника в Quick Resto" description="Что получает сотрудник после «Принять на работу»"
      actions={editable && loaded ? <Button variant="outline" size="sm" onClick={() => { setSaveError(""); setDraft(saved); }}><Pencil className="size-4" />Изменить</Button> : null}>
      {!loaded && !error ? <div className="flex flex-col gap-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div> : null}
      {loaded ? <IntegrationFacts items={[
        { label: "Склады для всех", value: saved.store_ids.map(id => title(dictionaries.stores, id, "Склад")).join(", ") },
        { label: "Дополнительно кальянным мастерам", value: saved.master_store_ids.map(id => title(dictionaries.stores, id, "Склад")).join(", ") || <span className="text-muted-foreground">Не указано</span> },
        { label: "Группа гостей", value: title(dictionaries.groups, saved.staff_group_id, "Группа") },
        { label: "Бонусный счёт", value: title(dictionaries.accountTypes, saved.bonus_account_type_id, "Тип счёта") },
        { label: "Ссылка на чаевые", value: saved.tips_uri || <span className="text-muted-foreground">Не указано</span> },
      ]} /> : null}
      {dictionaryError ? <div className="flex flex-wrap items-center justify-between gap-3"><IntegrationNotice>{dictionaryError}</IntegrationNotice><Button variant="outline" size="sm" onClick={() => setDictionaryAttempt(v => v + 1)}>Повторить</Button></div> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(v => v + 1)}>Повторить</Button></div> : null}
      {!editable ? <IntegrationNotice>Изменять параметры может владелец организации</IntegrationNotice> : null}
    </IntegrationSection>

    <EditDrawer open={!!draft} onOpenChange={o => { if (!o) close(); }} title="Создание сотрудника"
      description={venues.find(v => v.id === venue)?.name}
      footer={<><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button><Button disabled={busy || !draft?.store_ids.length} onClick={save}>{busy ? "Сохраняем…" : "Сохранить"}</Button></>}>
      {draft ? <>
        <DrawerSection title="Склады">
          <Field label="Для всех сотрудников" required>{() => <StorePicker label="Склады для всех сотрудников" value={draft.store_ids} onChange={v => set("store_ids", v)} options={dictionaries.stores} disabled={busy} />}</Field>
          <Field label="Дополнительно кальянным мастерам">{() => <StorePicker label="Дополнительные склады для кальянных мастеров" value={draft.master_store_ids} onChange={v => set("master_store_ids", v)} options={dictionaries.stores} disabled={busy} />}</Field>
        </DrawerSection>
        <DrawerSection title="Гость и бонусы">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hiring-group" label="Группа гостей">{control => <OptionSelect id={control.id} aria-label="Группа гостей" value={String(draft.staff_group_id)} onValueChange={v => set("staff_group_id", Number(v))} options={options(dictionaries.groups, draft.staff_group_id, "Группа")} disabled={busy} />}</Field>
            <Field id="hiring-bonus" label="Бонусный счёт">{control => <OptionSelect id={control.id} aria-label="Бонусный счёт" value={String(draft.bonus_account_type_id)} onValueChange={v => set("bonus_account_type_id", Number(v))} options={options(dictionaries.accountTypes, draft.bonus_account_type_id, "Тип счёта")} disabled={busy} />}</Field>
          </div>
          <Field label="Ссылка на чаевые">{control => <Input {...control} type="url" value={draft.tips_uri ?? ""} onChange={e => set("tips_uri", e.target.value || null)} placeholder="https://…" maxLength={1000} disabled={busy} />}</Field>
        </DrawerSection>
        {saveError ? <p role="alert" className="mt-4 text-xs text-destructive">{saveError}</p> : null}
      </> : null}
    </EditDrawer>
  </div>;
}
