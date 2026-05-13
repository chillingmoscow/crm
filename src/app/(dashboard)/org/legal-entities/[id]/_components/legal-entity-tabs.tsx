"use client";

import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** Tab-обёртка для страницы юрлица: «Основное» (форма + venue-список) и
 *  опционально «Журнал». Server-page рендерит обе панели как ReactNode
 *  и прокидывает сюда — тогда client-state Tabs остаётся изолированной
 *  в этом компоненте, а page.tsx остаётся server-component. */
export function LegalEntityDetailTabs({
  main,
  history,
  canViewAudit,
}: {
  main: ReactNode;
  history: ReactNode;
  canViewAudit: boolean;
}) {
  return (
    <Tabs defaultValue="main">
      <TabsList className="justify-center">
        <TabsTrigger value="main">Основное</TabsTrigger>
        {canViewAudit && <TabsTrigger value="history">Журнал</TabsTrigger>}
      </TabsList>
      <TabsContent value="main" className="mt-4">
        {main}
      </TabsContent>
      {canViewAudit && (
        <TabsContent value="history" className="mt-4">
          {history}
        </TabsContent>
      )}
    </Tabs>
  );
}
