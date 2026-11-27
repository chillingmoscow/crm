import type { Metadata } from "next";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";

export const metadata: Metadata = { title: "Уведомления" };
export default function NotificationsPage() {
  return (
    <PageFrame>
      {/* В боковом меню «Уведомлений» нет: страница личная и открывается из
          колокольчика, поэтому раздел — «Профиль», как у личных настроек. */}
      <Breadcrumbs
        items={[{ label: "Профиль", href: "/profile" }, { label: "Уведомления" }]}
      />
      {/* Шапка, вкладки «Все / Непрочитанные / Архив» и список — внутри:
          действия шапки зависят от состояния списка. */}
      <NotificationBell mode="inbox" />
    </PageFrame>
  );
}
