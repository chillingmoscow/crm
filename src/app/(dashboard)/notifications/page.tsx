import type { Metadata } from "next";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";

export const metadata: Metadata = { title: "Уведомления" };
export default function NotificationsPage() {
  return (
    <PageFrame className="space-y-4">
      <Breadcrumbs items={[{ label: "Уведомления" }]} />
      <TablePageHeader title="Уведомления" />
      <NotificationBell mode="inbox" />
    </PageFrame>
  );
}
