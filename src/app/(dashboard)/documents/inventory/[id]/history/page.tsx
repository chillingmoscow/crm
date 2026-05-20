import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

/**
 * Заглушка таба «Журнал» страницы акта. Здесь будет история событий
 * по акту: создание/sync из QR, изменения assignee, заполнение,
 * проведение, пересорт, комментарии. См. memory
 * `documents_route_restructure_todo` — следующая итерация unified
 * page добавит реальный список событий из `inventory_result_events`
 * и audit-log'а.
 */
export default function InventoryDocumentHistoryPage() {
  return (
    <div className="w-full px-4 py-6 md:px-8">
      <EmptyState
        icon={History}
        title="Журнал событий пока пуст"
        description="Здесь будет история изменений по акту: создание, назначения, пересорт, проведение, комментарии"
      />
    </div>
  );
}
