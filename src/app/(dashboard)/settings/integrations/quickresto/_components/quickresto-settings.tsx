"use client";
import { useState, type ReactNode } from "react";
import { Download, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileTabsList, Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { LocalDateTime } from "@/components/shared/local-date-time";
import type { IntegrationVenue } from "@/lib/integrations/settings";
import { IntegrationFacts, IntegrationLayout, IntegrationNotice, IntegrationSection, IntegrationStatus } from "../../_components/integration-layout";
import { HiringSettings } from "./hiring-settings";
import { QuickRestoIntegrationFlow } from "./quickresto-integration-flow";

export type QuickRestoConnection = {
  id: string; login: string; backoffice_login: string | null; status: string | null; last_tested_at: string | null; backoffice_last_tested_at: string | null;
};

export function QuickRestoSettings({ accountId, connection, bot, sync, venues, activeVenue, editable, initialTab }: {
  accountId: string; connection: QuickRestoConnection | null; bot: { role: number | null; employee: number | null }; sync: ReactNode;
  venues: IntegrationVenue[]; activeVenue: string; editable: boolean; initialTab: string;
}) {
  const working = connection?.status === "active" && !!connection.last_tested_at;
  const [mode, setMode] = useState<"view" | "connect" | "import">(working ? "view" : "connect");
  const status = working ? "Работает" : connection?.status === "disabled" ? "Выключено" : connection ? "Требует внимания" : "Не настроено";
  const flow = <div className="flex justify-center"><QuickRestoIntegrationFlow key={mode} accountId={accountId}
    initialLogin={connection?.login ?? ""} initialConnectionId={connection?.id ?? null} initialBackOfficeLogin={connection?.backoffice_login ?? ""}
    initialBotRoleExternalId={bot.role} initialBotEmployeeExternalId={bot.employee}
    initialStep={mode === "import" ? 5 : 1} onExit={working ? () => setMode("view") : undefined} /></div>;

  return <IntegrationLayout provider="quickresto" title="Quick Resto"
    status={<IntegrationStatus tone={working ? "success" : connection && connection.status !== "disabled" ? "warning" : "neutral"}>{status}</IntegrationStatus>}
    context={connection?.login ? `Учётная запись ${connection.login}` : "Касса и склад"}
    actions={mode === "view" ? sync : null}>
    <Tabs defaultValue={initialTab}>
      <ProfileTabsList><TabsTrigger value="connection">Подключение</TabsTrigger><TabsTrigger value="employees">Новые сотрудники</TabsTrigger></ProfileTabsList>
      <TabsContent value="connection" className="mt-6 flex flex-col gap-5">
        {mode === "view" && connection ? <>
          <IntegrationSection title="Учётные записи" actions={<Button variant="outline" size="sm" onClick={() => setMode("connect")}><RefreshCcw className="size-4" />Переподключить</Button>}>
            <IntegrationFacts items={[
              { label: "Чтение данных", value: <>{connection.login}<span className="text-muted-foreground"> · проверено <LocalDateTime value={connection.last_tested_at} /></span></> },
              { label: "Бэк-офис (проведение актов)", value: connection.backoffice_login
                ? <>{connection.backoffice_login}{connection.backoffice_last_tested_at ? <span className="text-muted-foreground"> · проверено <LocalDateTime value={connection.backoffice_last_tested_at} /></span> : null}</>
                : <span className="text-muted-foreground">Не настроен</span> },
            ]} />
          </IntegrationSection>
          <IntegrationSection title="Данные" description="Заведения, должности, сотрудники, склады и номенклатура"
            actions={<Button variant="outline" size="sm" onClick={() => setMode("import")}><Download className="size-4" />Загрузить из Quick Resto</Button>}>
            <IntegrationNotice>Остатки и акты обновляет «Синхронизировать» в шапке. Новые заведения и сотрудников добавляет «Загрузить из Quick Resto»</IntegrationNotice>
          </IntegrationSection>
        </> : flow}
      </TabsContent>
      <TabsContent value="employees" className="mt-6"><HiringSettings venues={venues} activeVenue={activeVenue} editable={editable} /></TabsContent>
    </Tabs>
  </IntegrationLayout>;
}
