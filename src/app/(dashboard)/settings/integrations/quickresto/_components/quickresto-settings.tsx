"use client";
import type { ReactNode } from "react";
import type { IntegrationVenue } from "@/lib/integrations/settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationLayout } from "../../_components/integration-layout";
import { HiringSettings } from "./hiring-settings";
export function QuickRestoSettings({ connection, venues, activeVenue, editable, initialTab }: { connection: ReactNode; venues: IntegrationVenue[]; activeVenue: string; editable: boolean; initialTab: string }) {
  return <IntegrationLayout title="Quick Resto" description="Подключение кассовой системы, импорт данных и создание сотрудников.">
    <Tabs defaultValue={initialTab}>
      <TabsList><TabsTrigger value="connection">Подключение</TabsTrigger><TabsTrigger value="employees">Сотрудники</TabsTrigger></TabsList>
      <TabsContent value="connection" className="mt-5 space-y-5">{connection}</TabsContent>
      <TabsContent value="employees" className="mt-5"><HiringSettings venues={venues} activeVenue={activeVenue} editable={editable} /></TabsContent>
    </Tabs>
  </IntegrationLayout>;
}
