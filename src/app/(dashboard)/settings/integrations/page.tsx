import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { checked, integrationPageScope } from "@/lib/integrations/settings";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { pluralRu } from "@/lib/format/plural";
import { IntegrationCallout, IntegrationLayout, IntegrationStatus, type IntegrationTone } from "./_components/integration-layout";
import { IntegrationLogo, type IntegrationProvider } from "./_components/integration-logo";

type Card = { title: string; provider: IntegrationProvider; href: string; description: string; status: string; tone: IntegrationTone; detail: ReactNode };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ quickresto?: string }> }) {
  const [s, params] = await Promise.all([integrationPageScope(), searchParams]);
  const [tilda, telegram, quickresto, venues, pools, undelivered] = await Promise.all([
    s.db.from<{ enabled: boolean; last_received_at: string | null }>("candidate_connections").select("enabled,last_received_at").eq("account_id", s.accountId).maybeSingle(),
    s.db.from<{ bot_username: string | null }>("organization_telegram_settings").select("bot_username").eq("account_id", s.accountId).maybeSingle(),
    s.db.from<{ login: string | null; status: string | null; last_tested_at: string | null }>("integration_connections").select("login,status,last_tested_at").eq("account_id", s.accountId).eq("provider", "quickresto").maybeSingle(),
    s.db.from<{ id: string }[]>("venues").select("id").eq("account_id", s.accountId).is("archived_at", null),
    s.db.from<{ venue_id: string; office_pool_initialized: boolean }[]>("candidate_employment_settings").select("venue_id,office_pool_initialized").eq("account_id", s.accountId),
    s.db.from("candidate_jobs").select("id", { count: "exact", head: true }).eq("account_id", s.accountId).eq("state", "error").in("kind", ["notify", "hired", "chat_invites"]),
  ]);
  const t = checked(tilda), tg = checked(telegram), qr = checked(quickresto), venueRows = checked(venues) ?? [], poolRows = checked(pools) ?? [];
  checked(undelivered);
  const failed = undelivered.count ?? 0;
  const ready = venueRows.filter(v => poolRows.some(p => p.venue_id === v.id && p.office_pool_initialized)).length;
  const qrReady = !!qr?.last_tested_at && qr.status !== "disabled";

  const hiring: Card[] = [
    { title: "Tilda", provider: "tilda", href: "/settings/integrations/tilda", description: "Анкеты с сайта попадают в кандидатов",
      status: !t ? "Не настроено" : t.enabled ? "Работает" : "Выключено", tone: t?.enabled ? "success" : "neutral",
      detail: t?.last_received_at ? <>Последняя анкета <LocalDateTime value={t.last_received_at} /></> : t ? "Анкет пока не было" : "Подключите форму сайта" },
    { title: "Telegram", provider: "telegram", href: "/settings/integrations/telegram", description: "Уведомления и чаты сотрудников",
      status: !tg ? "Не настроено" : failed ? "Требует внимания" : "Работает", tone: !tg ? "neutral" : failed ? "warning" : "success",
      detail: failed ? `Не доставлено сообщений: ${failed}` : tg?.bot_username ? `@${tg.bot_username}` : tg ? "Бот подключён" : "Подключите бота организации" },
    { title: "Коды замка", provider: "office-codes", href: "/settings/integrations/office-codes", description: "Коды доступа для новых сотрудников",
      status: ready && ready === venueRows.length ? "Работает" : ready ? "Частично" : "Не настроено", tone: ready && ready === venueRows.length ? "success" : ready ? "warning" : "neutral",
      detail: venueRows.length ? `Настроено заведений: ${ready} из ${venueRows.length}` : "Нет заведений" },
  ];
  const pos: Card[] = [
    { title: "Quick Resto", provider: "quickresto", href: "/settings/integrations/quickresto", description: "Касса, склад и создание сотрудников",
      status: qrReady ? "Работает" : qr?.status === "disabled" ? "Выключено" : qr ? "Требует внимания" : "Не настроено",
      tone: qrReady ? "success" : qr && qr.status !== "disabled" ? "warning" : "neutral",
      detail: qrReady && qr?.last_tested_at ? <>Проверено <LocalDateTime value={qr.last_tested_at} /></> : qr ? "Подключение не проверено" : "Подключите учётную запись" },
  ];

  return <IntegrationLayout root title="Интеграции" description="Сервисы, подключённые к вашей организации.">
    {params.quickresto === "done" ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Импорт из Quick Resto завершён.</p> : null}
    {failed ? <IntegrationCallout action={<Link href="/settings/integrations/telegram#undelivered" className="shrink-0 text-sm font-medium text-brand hover:underline">Разобраться</Link>}>
      Telegram не доставил {failed} {pluralRu(failed, "сообщение", "сообщения", "сообщений")}.
    </IntegrationCallout> : null}
    <Group title="Найм" cards={hiring} />
    <Group title="Касса и склад" cards={pos} />
  </IntegrationLayout>;
}

function Group({ title, cards }: { title: string; cards: Card[] }) {
  return <section aria-label={title} className="space-y-3">
    <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
    <div className="grid gap-3 md:grid-cols-2">{cards.map(card => <Link key={card.title} href={card.href}
      className="group flex min-w-0 items-center gap-4 rounded-[14px] border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none">
      <IntegrationLogo provider={card.provider} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold">{card.title}</h3><IntegrationStatus tone={card.tone}>{card.status}</IntegrationStatus></div>
        <p className="truncate text-[13px] text-muted-foreground">{card.description}</p>
        <p className="truncate text-xs text-muted-foreground">{card.detail}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </Link>)}</div>
  </section>;
}

