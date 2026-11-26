import type { Metadata } from "next";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";

export const metadata: Metadata = { title: "Уведомления" };
export default function NotificationsPage() {
  return (
    <PageFrame>
      <Breadcrumbs items={[{ label: "Уведомления" }]} />
      {/* Шапка, вкладки «Все / Непрочитанные / Архив» и список — внутри:
          действия шапки зависят от состояния списка. */}
      <NotificationBell mode="inbox" />
    </PageFrame>
  );
}
