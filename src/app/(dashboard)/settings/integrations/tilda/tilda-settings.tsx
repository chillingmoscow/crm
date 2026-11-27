"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { candidateError } from "@/lib/candidates/errors";
import { countRu, pluralRu } from "@/lib/format/plural";
import type { ConnectionView } from "@/lib/candidates/types";
import { unwrapAction } from "@/lib/actions/result";
import { readTildaConnection, saveTildaConnection } from "../actions";
import { IntegrationLayout, IntegrationSection, IntegrationStatus, IntegrationWarning } from "../_components/integration-layout";
import { CopyValue } from "../_components/copy-value";

/** «17 ноября» and «в 20:01» in the viewer's zone; the first render uses a fixed zone to match the server. */
function useDayAndTime(iso: string | null) {
  const format = (zone?: string) => iso ? {
    day: new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(zone ? { timeZone: zone } : {}) }),
    time: new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }),
  } : null;
  const [value, setValue] = useState(() => format("Europe/Moscow"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValue(format()), [iso]);
  return value;
}

export function TildaSettings({ initial, recent, notifyChat, siteUrl }: { initial: ConnectionView; recent: number; notifyChat: string | null; siteUrl: string }) {
  const [connection, setConnection] = useState(initial), [secret, setSecret] = useState("");
  const [drawer, setDrawer] = useState(false), [form, setForm] = useState(initial?.form_id ?? ""), [created, setCreated] = useState("");
  const [rotate, setRotate] = useState(false), [error, setError] = useState(""), [busy, start] = useTransition();
  const [origin, setOrigin] = useState(siteUrl);
  useEffect(() => { if (!siteUrl) setOrigin(window.location.origin); }, [siteUrl]);
  const last = useDayAndTime(connection?.last_received_at ?? null);
  const url = connection ? `${origin.replace(/\/$/, "")}/api/webhooks/tilda/candidates/${connection.id}` : "";

  const save = (patch: { enabled?: boolean; form_id?: string; rotate?: boolean }, onDone: (secret: string | null) => void) => start(async () => {
    setError("");
    try {
      const saved = unwrapAction(await saveTildaConnection({ enabled: patch.enabled ?? connection?.enabled ?? false, form_id: patch.form_id ?? connection?.form_id, rotate: patch.rotate }));
      setConnection(unwrapAction(await readTildaConnection()));
      onDone(saved.secret);
    } catch (e) {
      const message = candidateError(e, "Не удалось сохранить подключение Tilda");
      if (patch.enabled !== undefined) toast.error(message); else setError(message);
    }
  });
  const openDrawer = () => { setForm(connection?.form_id ?? ""); setError(""); setCreated(""); setDrawer(true); };
  const closeDrawer = () => { if (!busy) { setDrawer(false); setCreated(""); } };

  const failed = connection?.failed_jobs ?? 0;
  return <IntegrationLayout provider="tilda" title="Tilda"
    status={<IntegrationStatus tone={connection?.enabled ? "success" : "neutral"}>{!connection ? "Не настроено" : connection.enabled ? "Работает" : "Выключено"}</IntegrationStatus>}
    context={connection ? <>Уведомления: {notifyChat ? <Link href="/settings/integrations/telegram" className="text-foreground hover:underline">{notifyChat}</Link> : <Link href="/settings/integrations/telegram" className="text-brand hover:underline">настроить Telegram</Link>}</> : "Анкеты с сайта попадают в «Кандидаты»"}
    actions={connection ? <label className="flex h-9 items-center gap-3 text-sm font-medium">Принимать анкеты
      <Switch checked={connection.enabled} disabled={busy} onCheckedChange={enabled => save({ enabled }, () => toast.success(enabled ? "Приём анкет включён" : "Приём анкет выключен"))} /></label> : null}>

    {failed ? <IntegrationWarning action={<Link href="/settings/integrations/telegram#undelivered" className="shrink-0 text-sm font-medium text-brand hover:underline">Открыть журнал</Link>}>
      {countRu(failed, "уведомление", "уведомления", "уведомлений")} о новых анкетах не {failed === 1 ? "дошло" : "дошли"} в Telegram. Сами анкеты сохранены
    </IntegrationWarning> : null}

    {connection ? <MetricStrip label="Анкеты с сайта">
      <Metric label="Анкеты за 30 дней" value={recent} hint={pluralRu(recent, "анкета", "анкеты", "анкет")} />
      <Metric label="Последняя анкета" value={last?.day ?? "—"} hint={last ? `в ${last.time}` : "Анкет ещё не было"} />
    </MetricStrip> : null}

    {connection ? <IntegrationSection title="Подключение формы" description="Делается один раз в настройках сайта в Tilda">
      <ol className="flex flex-col gap-5">
        <Step n={1} title="ID формы" action={<Button variant="outline" size="sm" onClick={openDrawer}><Pencil className="size-4" />Изменить</Button>}>
          <p className="font-mono text-sm">{connection.form_id}</p>
        </Step>
        <Step n={2} title="Адрес приёмщика" hint="Tilda: Настройки сайта → Формы → Webhook. Вставьте этот адрес">
          <CopyValue value={url} label="адрес приёмщика" />
        </Step>
        <Step n={3} title="Ключ доступа" hint={<>Пароль, по которому мы узнаём ваш сайт. В приёмщике Tilda передавайте его в заголовке <code className="text-foreground">x-tilda-key</code></>}
          action={!secret ? <Button variant="outline" size="sm" onClick={() => { setError(""); setRotate(true); }}><KeyRound className="size-4" />Выпустить новый ключ</Button> : null}>
          {secret ? <div className="flex flex-col gap-2"><CopyValue value={secret} label="ключ доступа" /><p className="text-xs text-amber-700 dark:text-amber-400">Ключ показывается один раз. Вставьте его в Tilda сейчас</p></div>
            : <p className="text-[13px] text-muted-foreground">Ключ уже выдан и здесь не показывается</p>}
        </Step>
        <Step n={4} title="Подключите приёмщик к форме" hint="В настройках блока формы отметьте этот приёмщик и опубликуйте страницу. Если раньше был другой приёмщик, отключите его у этой формы" />
      </ol>
    </IntegrationSection> : <IntegrationSection title="Форма не подключена" description="Укажите форму сайта, с которой принимать анкеты"
      actions={<Button size="sm" onClick={openDrawer}><Plus className="size-4" />Подключить форму</Button>}>
      <p className="text-[13px] text-muted-foreground">После подключения здесь появятся адрес приёмщика и ключ доступа для настроек Tilda</p>
    </IntegrationSection>}

    <EditDrawer open={drawer} onOpenChange={o => { if (!o) closeDrawer(); }} title={created ? "Форма подключена" : connection ? "ID формы" : "Подключение формы"}
      description={created ? "Скопируйте ключ: он показывается один раз" : undefined}
      footer={created ? <Button onClick={closeDrawer}>Готово</Button> : <><Button variant="outline" disabled={busy} onClick={closeDrawer}>Отмена</Button>
        <Button disabled={busy || !form.trim()} onClick={() => save({ form_id: form.trim() }, newSecret => {
          if (newSecret) { setSecret(newSecret); setCreated(newSecret); toast.success("Форма подключена"); }
          else { setDrawer(false); toast.success("ID формы сохранён"); }
        })}>{busy ? "Сохраняем…" : connection ? "Сохранить" : "Подключить форму"}</Button></>}>
      {created ? <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2"><p className="text-sm font-medium">Адрес приёмщика</p><CopyValue value={url} label="адрес приёмщика" />
          <p className="text-xs text-muted-foreground">Tilda: Настройки сайта → Формы → Webhook</p></div>
        <div className="flex flex-col gap-2"><p className="text-sm font-medium">Ключ доступа</p><CopyValue value={created} label="ключ доступа" />
          <p className="text-xs text-muted-foreground">В приёмщике Tilda передавайте его в заголовке x-tilda-key</p></div>
      </div> : <Field label="ID формы" required hint="Например, form356864639" error={error || undefined}>
        {control => <Input {...control} value={form} onChange={e => setForm(e.target.value)} placeholder="form356864639" disabled={busy} autoComplete="off"
          onKeyDown={e => { if (e.key === "Enter" && form.trim() && !busy) save({ form_id: form.trim() }, s => { if (s) { setSecret(s); setCreated(s); } else setDrawer(false); }); }} />}
      </Field>}
    </EditDrawer>

    <ConfirmDialog
      tone="warning"
      icon={KeyRound}
      open={rotate} onOpenChange={setRotate} busy={busy} error={error || undefined}
      title="Выпустить новый ключ Tilda?" confirmLabel="Выпустить ключ" pendingLabel="Выпускаем…"
      description="Нужно, только если ключ потерян или попал к посторонним."
      consequences={[
        { kind: "remove", text: "Старый ключ перестанет работать сразу" },
        { kind: "info", text: "Пока новый не вставлен в Tilda, анкеты приходить не будут" },
      ]}
      onConfirm={() => save({ rotate: true }, s => { if (s) setSecret(s); setRotate(false); toast.success("Новый ключ выпущен. Вставьте его в Tilda"); })} />
  </IntegrationLayout>;
}

function Step({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <li className="flex gap-3">
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{n}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{title}</h3>{action}</div>
      {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  </li>;
}
