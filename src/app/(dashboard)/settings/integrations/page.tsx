import Link from "next/link";
import { ArrowRight, KeyRound, PanelsTopLeft, PlugZap, Send } from "lucide-react";
import { checked, integrationPageScope } from "@/lib/integrations/settings";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { IntegrationLayout, IntegrationStatus } from "./_components/integration-layout";
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ quickresto?: string }> }) {
  const [s, params] = await Promise.all([integrationPageScope(), searchParams]);
  const [tilda, telegram, quickresto, venues, pools] = await Promise.all([
    s.db.from<{ enabled: boolean; last_received_at: string | null }>("candidate_connections").select("enabled,last_received_at").eq("account_id", s.accountId).maybeSingle(),
    s.db.from<{ bot_username: string | null }>("organization_telegram_settings").select("bot_username").eq("account_id", s.accountId).maybeSingle(),
    s.db.from<{ login: string | null; status: string | null; last_tested_at: string | null; backoffice_last_tested_at: string | null }>("integration_connections").select("login,status,last_tested_at,backoffice_last_tested_at").eq("account_id", s.accountId).eq("provider", "quickresto").maybeSingle(),
    s.db.from<{ id: string }[]>("venues").select("id").eq("account_id", s.accountId).is("archived_at", null),
    s.db.from<{ venue_id: string; office_pool_initialized: boolean }[]>("candidate_employment_settings").select("venue_id,office_pool_initialized").eq("account_id", s.accountId),
  ]);
  const t = checked(tilda), tg = checked(telegram), qr = checked(quickresto), venueRows = checked(venues) ?? [], poolRows = checked(pools) ?? [];
  const ready = venueRows.filter(v => poolRows.some(p => p.venue_id === v.id && p.office_pool_initialized)).length;
  const qrReady = !!qr?.last_tested_at && qr.status !== "disabled";
  const cards = [
    { title: "Тильда", icon: PanelsTopLeft, href: "/settings/integrations/tilda", description: "Приём анкет с сайта в список кандидатов.",
      status: t ? t.enabled ? "Приём включён" : "Приём выключен" : "Не настроено", tone: t?.enabled ? "success" as const : "neutral" as const,
      detail: t?.last_received_at ? <>Последняя анкета: <LocalDateTime value={t.last_received_at} /></> : <>Анкеты пока не поступали</> },
    { title: "Telegram", icon: Send, href: "/settings/integrations/telegram", description: "Бот и чаты для новых анкет и сообщений о найме.",
      status: tg ? "Подключено" : "Не подключено", tone: tg ? "success" as const : "neutral" as const,
      detail: tg?.bot_username ? <>@{tg.bot_username}</> : <>Подключите бота организации</> },
    { title: "Quick Resto", icon: PlugZap, href: "/settings/integrations/quickresto", description: "Подключение кассы, импорт и создание сотрудников.",
      status: qrReady ? "Подключено" : qr?.status === "disabled" ? "Отключено" : qr ? "Не проверено" : "Не подключено", tone: qrReady ? "success" as const : qr && qr.status !== "disabled" ? "warning" as const : "neutral" as const,
      detail: qr?.login ? <>Учётная запись: {qr.login}</> : <>Подключите учётную запись Quick Resto</> },
    { title: "Коды замка", icon: KeyRound, href: "/settings/integrations/office-codes", description: "Резерв занятых кодов и выдача доступа при найме.",
      status: ready === venueRows.length && ready > 0 ? "Настроено" : ready ? "Частично настроено" : "Не настроено", tone: ready === venueRows.length && ready > 0 ? "success" as const : ready ? "warning" as const : "neutral" as const,
      detail: <>{ready ? `Настроено заведений: ${ready} из ${venueRows.length}` : "Учёт кодов без управления физическим замком"}</> },
  ];
  return <IntegrationLayout root title="Интеграции" description="Подключения и автоматические действия вашей организации.">
    {params.quickresto === "done" ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Импорт Quick Resto завершён.</p> : null}
    <div className="grid gap-4 lg:grid-cols-2">{cards.map(card => <Link key={card.title} href={card.href} className="group flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><card.icon className="size-5 text-muted-foreground" /></div><h2 className="text-base font-semibold">{card.title}</h2></div><IntegrationStatus tone={card.tone}>{card.status}</IntegrationStatus></div>
      <p className="text-sm leading-6 text-muted-foreground">{card.description}</p>
      <p className="mt-auto break-words text-xs leading-5 text-muted-foreground">{card.detail}</p>
      <span className="flex items-center gap-2 border-t pt-4 text-sm font-medium text-brand">Настроить<ArrowRight className="size-4" /></span>
    </Link>)}</div>
  </IntegrationLayout>;
}
