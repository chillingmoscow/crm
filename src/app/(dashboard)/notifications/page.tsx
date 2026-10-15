import type { Metadata } from "next";
import appearance from "@/components/shared/workspace-appearance.module.css";
import { NotificationBell } from "@/components/shared/notification-bell";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";

export const metadata: Metadata = { title: "Уведомления — Sheerly" };
export default function NotificationsPage() {
  return (
    <div
      className={`${appearance.notificationsPage} mx-auto w-full max-w-[1580px] space-y-6 p-5 md:px-9 md:py-9`}
    >
      <PageBreadcrumb>
        <span className="text-sm text-muted-foreground">Уведомления</span>
      </PageBreadcrumb>
      <h1 className="text-3xl font-semibold tracking-tight">Уведомления</h1>
      <NotificationBell mode="inbox" />
    </div>
  );
}
