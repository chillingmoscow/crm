"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { candidateError } from "@/lib/candidates/errors";
import { IntegrationNotice, IntegrationSection } from "../_components/integration-layout";
import { readFinesChat, saveFinesChat, type FinesChatSettings } from "./actions";

const enabledAt = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function FinesChat({ initial }: { initial: FinesChatSettings }) {
  const [saved, setSaved] = useState(initial);
  const [chat, setChat] = useState(initial.chat_id ?? ""), [enabled, setEnabled] = useState(!!initial.notify_from);
  const [error, setError] = useState(""), [busy, start] = useTransition();
  useEffect(() => {
    let active = true;
    if (initial.chat_id) void readFinesChat(true).then(v => { if (active && v) setSaved(v); }).catch(() => {});
    return () => { active = false; };
  }, [initial]);
  const dirty = chat.trim() !== (saved.chat_id ?? "") || enabled !== !!saved.notify_from;
  return <IntegrationSection title="Чат штрафов и премий" description="Штрафы, премии и предупреждения из журнала зарплаты отправляются в этот чат.">
    <div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="fines-chat">Чат штрафов и премий · ID чата</Label>
        <Input id="fines-chat" value={chat} disabled={busy} onChange={e => setChat(e.target.value)} placeholder="-100…" />
        {saved.chat_id && saved.title ? <p className="text-xs text-muted-foreground">{saved.title}</p> : null}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4"><Label htmlFor="fines-enabled">Отправлять в чат</Label><Switch id="fines-enabled" checked={enabled} disabled={busy} onCheckedChange={setEnabled} /></div>
        <IntegrationNotice>Записи, созданные до включения, не отправляются.</IntegrationNotice>
        {saved.notify_from ? <p className="text-xs text-muted-foreground">Включено {enabledAt(saved.notify_from)} (МСК)</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button size="sm" disabled={busy || !dirty} onClick={() => start(async () => {
        setError("");
        try { const next = await saveFinesChat({ chat_id: chat, enabled }); if (next) { setSaved(next); setChat(next.chat_id ?? ""); setEnabled(!!next.notify_from); } toast.success("Чат штрафов и премий сохранён"); }
        catch (e) { setError(candidateError(e, "Не удалось сохранить чат штрафов и премий")); }
      })}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
    </div>
  </IntegrationSection>;
}
