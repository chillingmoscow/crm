"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { candidateError } from "@/lib/candidates/errors";
import type { ConnectionView } from "@/lib/candidates/types";
import { readTildaConnection, saveTildaConnection } from "../actions";
import { IntegrationLayout, IntegrationSection, IntegrationStatus } from "../_components/integration-layout";
import { CopyValue } from "../_components/copy-value";

export function TildaSettings({ initial, siteUrl }: { initial: ConnectionView; siteUrl: string }) {
  const [connection, setConnection] = useState(initial), [editing, setEditing] = useState(!initial);
  const [form, setForm] = useState(initial?.form_id ?? ""), [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [secret, setSecret] = useState(""), [rotate, setRotate] = useState(false), [error, setError] = useState("");
  const [busy, start] = useTransition();
  const [origin, setOrigin] = useState(siteUrl);
  useEffect(() => { if (!siteUrl) setOrigin(window.location.origin); }, [siteUrl]);
  const url = connection ? `${origin.replace(/\/$/, "")}/api/webhooks/tilda/candidates/${connection.id}` : "";
  const save = (replaceKey = false) => start(async () => {
    setError("");
    try {
      const saved = await saveTildaConnection({ enabled: replaceKey ? connection!.enabled : enabled, form_id: replaceKey ? connection!.form_id : form, rotate: replaceKey });
      if (saved.secret) setSecret(saved.secret);
      setConnection(await readTildaConnection()); setEditing(false); setRotate(false);
      toast.success(replaceKey ? "Ключ обновлён. Укажите его в Тильде." : "Настройки Тильды сохранены");
    } catch (e) { setError(candidateError(e, "Не удалось сохранить подключение Тильды")); }
  });
  return <IntegrationLayout title="Тильда" description="Анкеты с сайта поступают прямо в список кандидатов."
    status={<IntegrationStatus tone={connection?.enabled ? "success" : "neutral"}>{connection ? connection.enabled ? "Приём включён" : "Приём выключен" : "Не настроено"}</IntegrationStatus>}>
    <div className="max-w-3xl space-y-5">
      <IntegrationSection title="Приём анкет" actions={!editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-2 size-4" />Изменить</Button> : null}>
        {editing ? <form className="space-y-5" onSubmit={e => { e.preventDefault(); save(); }}>
          <div className="max-w-md space-y-2"><Label htmlFor="tilda-form">ID формы</Label><Input id="tilda-form" value={form} onChange={e => setForm(e.target.value)} placeholder="form356864639" disabled={busy} autoComplete="off" /></div>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="tilda-enabled">Принимать новые анкеты</Label><Switch id="tilda-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={busy} /></div>
          <div className="flex gap-2"><Button size="sm" disabled={busy || !form.trim()}>{busy ? "Сохраняем…" : "Сохранить"}</Button>{connection ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setForm(connection.form_id); setEnabled(connection.enabled); setError(""); setEditing(false); }}>Отмена</Button> : null}</div>
        </form> : <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Форма</dt><dd className="mt-1 font-medium">{connection?.form_id}</dd></div><div><dt className="text-muted-foreground">Последняя анкета</dt><dd className="mt-1">{connection?.last_received_at ? <LocalDateTime value={connection.last_received_at} /> : "Пока не поступала"}</dd></div></dl>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {connection?.failed_jobs ? <p className="text-sm text-destructive">Требуют проверки: {connection.failed_jobs}.</p> : null}
      </IntegrationSection>
      {url ? <IntegrationSection title="Подключение формы">
        <div className="space-y-2"><Label>Адрес webhook</Label><CopyValue value={url} label="адрес webhook" /></div>
        {secret ? <div className="space-y-2"><Label>Новый ключ доступа</Label><CopyValue value={secret} label="ключ доступа" /><p className="text-sm text-muted-foreground">Скопируйте ключ в Тильду. После ухода со страницы он больше не показывается.</p></div> : null}
        <details className="group border-t pt-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">Как подключить форму<ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground"><li>В Тильде откройте настройки сайта → Формы → Webhook и укажите адрес выше.</li><li>В настройках API выберите передачу ключа в заголовке <code className="text-foreground">x-tilda-key</code>. Вставьте ключ подключения.</li><li>Выберите приёмщик в анкете кандидата и опубликуйте страницу. Если раньше использовался другой приёмщик, отключите его только у этой формы.</li></ol>
        </details>
        {!secret ? <div className="border-t pt-4"><Button variant="outline" size="sm" disabled={busy} onClick={() => setRotate(true)}><KeyRound className="mr-2 size-4" />Заменить ключ</Button></div> : null}
      </IntegrationSection> : null}
      <p className="text-sm leading-6 text-muted-foreground">Уведомления внутри CRM включены автоматически. Чаты настраиваются в <Link className="text-brand hover:underline" href="/settings/integrations/telegram">Telegram</Link>.</p>
    </div>
    <AlertDialog open={rotate} onOpenChange={v => { if (!busy) setRotate(v); }}><AlertDialogContent className="w-[calc(100%-2rem)] rounded-xl"><AlertDialogHeader><AlertDialogTitle>Заменить ключ Тильды?</AlertDialogTitle><AlertDialogDescription>Старый ключ перестанет работать. После замены нужно указать новый ключ в Тильде, иначе анкеты не будут поступать.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); save(true); }}>Заменить ключ</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </IntegrationLayout>;
}
