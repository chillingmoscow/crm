import { Lock } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { EmptyState } from "@/components/ui/empty-state";

/** Страница раздела «Продажи» без права просмотра: та же рамка и путь. */
export function SalesNoAccess({ page }: { page: string }) {
  return (
    <PageFrame>
      <Breadcrumbs items={[{ label: "Продажи" }, { label: page }]} />
      <EmptyState
        icon={Lock}
        title="Нет доступа к продажам"
        description="Попросите владельца аккаунта открыть доступ к разделу"
      />
    </PageFrame>
  );
}
