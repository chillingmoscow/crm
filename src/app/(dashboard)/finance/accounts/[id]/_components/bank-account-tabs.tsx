"use client";

import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** Tab-обёртка для страницы счёта: «Основное» (форма) и опционально
 *  «Журнал». Аналогично legal-entity-tabs.tsx: page.tsx остаётся
 *  server-component, client-state Tabs изолирована тут. */
export function BankAccountDetailTabs({
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
