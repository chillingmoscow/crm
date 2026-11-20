"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { candidateError } from "@/lib/candidates/errors";
import { IntegrationSection } from "../_components/integration-layout";
import { dismissDeliveries, retryDeliveries, type DeliveryKind, type UndeliveredItem } from "./delivery-actions";

const KIND: Record<DeliveryKind, string> = { notify: "Новая анкета", hired: "Приём сотрудника", chat_invites: "Приглашения в чаты" };

export function Undelivered({ initial }: { initial: UndeliveredItem[] }) {
  const [items, setItems] = useState(initial), [busy, start] = useTransition();
  if (!items.length) return null;
  const run = (ids: string[], retry: boolean) => start(async () => {
    try {
      if (retry) await retryDeliveries(ids); else await dismissDeliveries(ids);
      setItems(list => list.filter(i => !ids.includes(i.id)));
      toast.success(retry ? "Отправим в течение минуты" : "Больше не отправляем");
    } catch (e) { toast.error(candidateError(e, "Не удалось выполнить действие")); }
  });
  return <IntegrationSection id="undelivered" title={`Не доставлено · ${items.length}`}
    description="Обычно бот удалён из чата или не может в нём писать. Исправьте это и отправьте снова."
    actions={items.length > 1 ? <Button variant="outline" size="sm" disabled={busy} onClick={() => run(items.map(i => i.id), true)}>Отправить все снова</Button> : null}>
    <ul className="divide-y">{items.map(item => <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm"><span className="font-medium">{KIND[item.kind]}</span>{item.name ? ` · ${item.name}` : ""}</p>
        <p className="truncate text-xs text-muted-foreground"><LocalDateTime value={item.created_at} />{item.error ? ` · ${item.error}` : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run([item.id], true)}>Отправить снова</Button>
        <Button variant="ghost" size="sm" disabled={busy} className="text-muted-foreground" onClick={() => run([item.id], false)}>Не отправлять</Button>
      </div>
    </li>)}</ul>
  </IntegrationSection>;
}
