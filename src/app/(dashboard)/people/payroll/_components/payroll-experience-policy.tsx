"use client";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/shared/profile-section";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PaySettings } from "@/lib/payroll/types";
import { saveExperienceStart } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import form from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";

export function PayrollExperiencePolicy({ settings, onChange }: {
  settings: PaySettings | null;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      unwrapAction(await saveExperienceStart({ startsOn: date, version: settings.experience_policy_version ?? 0,
        requestKey, reason, venueId: settings.venue_id }));
      await onChange();
      setOpen(false);
      toast.success("Дата начала начисления сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить дату");
    } finally {
      setBusy(false);
    }
  }
  const starts = settings?.experience_starts_on;
  return <>
    {/* Секция в режиме чтения (DS «Секции карточки»): значение в `dl`,
        правка — в боковой панели по кнопке в заголовке. */}
    <ProfileSection
      title="Надбавка за стаж"
      description="Общая дата для заведения. Размер надбавки за выход задаётся в должности."
      actions={<Button type="button" variant="outline" size="sm" disabled={!settings} onClick={() => {
        setDate(starts ?? ""); setReason(""); setRequestKey(crypto.randomUUID()); setOpen(true);
      }}><CalendarDays />{starts ? "Изменить дату" : "Назначить дату"}</Button>}
    >
      <dl className="space-y-1">
        <dt className="text-[13px] text-muted-foreground">Начислять с</dt>
        <dd className="text-sm">{starts ? starts.split("-").reverse().join(".") : "Не указано"}</dd>
      </dl>
    </ProfileSection>
    <PayrollDetailDialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}
      title="Надбавка за стаж" description="Общая дата начала начисления для заведения"
      footer={<><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={busy || !date || reason.trim().length < 3} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить дату"}</Button></>}>
      <div className={form.form}>
        <div className="space-y-2"><Label htmlFor="experience-start">Начислять с</Label><DatePicker id="experience-start" value={date} onChange={v => { setDate(v); setRequestKey(crypto.randomUUID()); }} clearable={false} disabled={busy}/></div>
        <div className="space-y-2"><Label htmlFor="experience-reason">Причина изменения</Label><Textarea id="experience-reason" value={reason} maxLength={1000} onChange={e => { setReason(e.target.value); setRequestKey(crypto.randomUUID()); }} disabled={busy}/></div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">Стаж считается от даты приёма. Сохранённая история начислений остаётся в журнале.</p>
      </div>
    </PayrollDetailDialog>
  </>;
}
