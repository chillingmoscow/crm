"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { candidateError } from "@/lib/candidates/errors";
import { pluralRu } from "@/lib/format/plural";
import type { ConnectionView } from "@/lib/candidates/types";
import { readTildaConnection, saveTildaConnection } from "../actions";
import { IntegrationCallout, IntegrationLayout, IntegrationSection, IntegrationStatus } from "../_components/integration-layout";
import { CopyValue } from "../_components/copy-value";

export function TildaSettings({ initial, recent, notifyChat, siteUrl }: { initial: ConnectionView; recent: number; notifyChat: string | null; siteUrl: string }) {
  const [connection, setConnection] = useState(initial), [editingForm, setEditingForm] = useState(!initial);
  const [form, setForm] = useState(initial?.form_id ?? ""), [secret, setSecret] = useState("");
  const [rotate, setRotate] = useState(false), [error, setError] = useState(""), [busy, start] = useTransition();
  const [origin, setOrigin] = useState(siteUrl);
  useEffect(() => { if (!siteUrl) setOrigin(window.location.origin); }, [siteUrl]);
  const url = connection ? `${origin.replace(/\/$/, "")}/api/webhooks/tilda/candidates/${connection.id}` : "";

  const save = (patch: { enabled?: boolean; form_id?: string; rotate?: boolean }, done: string) => start(async () => {
    setError("");
    try {
      const saved = await saveTildaConnection({ enabled: patch.enabled ?? connection?.enabled ?? false, form_id: patch.form_id ?? connection?.form_id ?? form, rotate: patch.rotate });
      if (saved.secret) setSecret(saved.secret);
      setConnection(await readTildaConnection()); setEditingForm(false); setRotate(false);
      toast.success(done);
    } catch (e) {
      const message = candidateError(e, "Не удалось сохранить подключение Tilda");
      if (patch.form_id !== undefined) setError(message); else toast.error(message);
    }
  });

  const failed = connection?.failed_jobs ?? 0;
  const status = !connection ? "Не настроено" : connection.enabled ? "Работает" : "Выключено";
  return <IntegrationLayout provider="tilda" title="Tilda" description="Анкеты с формы на сайте попадают в «Кандидаты»."
    status={<IntegrationStatus tone={connection?.enabled ? "success" : "neutral"}>{status}</IntegrationStatus>}
    actions={connection ? <label className="flex items-center gap-3 text-sm font-medium">Принимать анкеты
      <Switch checked={connection.enabled} disabled={busy} onCheckedChange={enabled => save({ enabled }, enabled ? "Приём анкет включён" : "Приём анкет выключен")} /></label> : null}>
    <div className="space-y-5">
      {failed ? <IntegrationCallout action={<Link href="/settings/integrations/telegram#undelivered" className="shrink-0 text-sm font-medium text-brand hover:underline">Открыть журнал</Link>}>
        Анкеты пришли, но {failed} {pluralRu(failed, "уведомление", "уведомления", "уведомлений")} о них не {failed === 1 ? "дошло" : "дошли"} в Telegram.
      </IntegrationCallout> : null}

      {connection ? <div className="grid grid-cols-1 divide-y rounded-[14px] border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Последняя анкета">{connection.last_received_at ? <LocalDateTime value={connection.last_received_at} /> : "Ещё не было"}</Stat>
        <Stat label="За 30 дней">{recent} {pluralRu(recent, "анкета", "анкеты", "анкет")}</Stat>
        <Stat label="Уведомления">{notifyChat ? <Link href="/settings/integrations/telegram" className="hover:underline">{notifyChat}</Link>
          : <Link href="/settings/integrations/telegram" className="text-brand hover:underline">Настроить Telegram</Link>}</Stat>
      </div> : null}

      <IntegrationSection title="Подключение формы" description={connection ? "Делается один раз в настройках сайта в Tilda." : "Укажите форму, с которой принимать анкеты."}>
        <ol className="space-y-6">
          <Step n={1} title="ID формы" hint={editingForm ? "Например, form356864639" : undefined}
            action={!editingForm && connection ? <button type="button" className="text-[13px] text-brand hover:underline" onClick={() => setEditingForm(true)}>Изменить</button> : null}>
            {editingForm ? <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); save({ form_id: form }, connection ? "ID формы сохранён" : "Подключение создано"); }}>
              <Label htmlFor="tilda-form" className="sr-only">ID формы</Label>
              <Input id="tilda-form" value={form} onChange={e => setForm(e.target.value)} placeholder="form356864639" disabled={busy} autoComplete="off" className="max-w-xs" />
              <Button disabled={busy || !form.trim()}>{busy ? "Сохраняем…" : connection ? "Сохранить" : "Создать подключение"}</Button>
              {connection ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setForm(connection.form_id); setError(""); setEditingForm(false); }}>Отмена</Button> : null}
            </form> : <p className="font-mono text-sm">{connection?.form_id}</p>}
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          </Step>
          {connection ? <>
            <Step n={2} title="Адрес приёмщика" hint="Tilda → Настройки сайта → Формы → Webhook: вставьте этот адрес.">
              <CopyValue value={url} label="адрес приёмщика" />
            </Step>
            <Step n={3} title="Ключ доступа" hint={<>Пароль, по которому мы узнаём ваш сайт. В приёмщике Tilda передавайте его в заголовке <code className="text-foreground">x-tilda-key</code>.</>}
              action={!secret ? <button type="button" className="text-[13px] text-brand hover:underline" onClick={() => setRotate(true)}>Выпустить новый ключ</button> : null}>
              {secret ? <div className="space-y-2"><CopyValue value={secret} label="ключ доступа" /><p className="text-xs text-amber-700 dark:text-amber-400">Ключ показывается один раз. Вставьте его в Tilda сейчас.</p></div>
                : <p className="text-sm text-muted-foreground">Ключ уже выдан и здесь не показывается.</p>}
            </Step>
            <Step n={4} title="Подключите приёмщик к форме" hint="В настройках блока формы отметьте этот приёмщик и опубликуйте страницу. Если раньше был другой приёмщик, отключите его у этой формы." />
          </> : null}
        </ol>
      </IntegrationSection>
    </div>
    <AlertDialog open={rotate} onOpenChange={v => { if (!busy) setRotate(v); }}><AlertDialogContent className="w-[calc(100%-2rem)] rounded-2xl">
      <AlertDialogHeader><AlertDialogTitle>Выпустить новый ключ?</AlertDialogTitle>
        <AlertDialogDescription>Нужно, только если старый ключ потерян или попал к посторонним. Старый перестанет работать сразу — пока новый не вставлен в Tilda, анкеты приходить не будут.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
        <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); save({ rotate: true }, "Новый ключ выпущен. Вставьте его в Tilda."); }}>Выпустить ключ</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </IntegrationLayout>;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1 px-4 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-sm font-medium">{children}</p></div>;
}

function Step({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <li className="flex gap-3">
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{n}</span>
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-medium">{title}</h3>{action}</div>
      {hint ? <p className="text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  </li>;
}
