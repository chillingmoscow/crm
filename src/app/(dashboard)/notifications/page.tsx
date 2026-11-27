import type { Metadata } from "next";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { getNotificationActors, getNotifications } from "./actions";

export const metadata: Metadata = { title: "Уведомления" };
export default async function NotificationsPage() {
  // Первая страница входящих — с сервера (столько же, сколько грузит
  // колокольчик): список приходит готовым, без скелетона другой высоты.
  const notifications = await getNotifications({ scope: "active", limit: 50 }).catch(() => null);
  const actorIds = [
    ...new Set((notifications ?? []).map((n) => n.actor_user_id).filter((id): id is string => !!id)),
  ];
  const actors = notifications ? await getNotificationActors(actorIds).catch(() => []) : [];
  return (
    <PageFrame>
      {/* В боковом меню «Уведомлений» нет: страница личная и открывается из
          колокольчика, поэтому раздел — «Профиль», как у личных настроек. */}
      <Breadcrumbs
        items={[{ label: "Профиль", href: "/profile" }, { label: "Уведомления" }]}
      />
      {/* Шапка, вкладки «Все / Непрочитанные / Архив» и список — внутри:
          действия шапки зависят от состояния списка. */}
      <NotificationBell
        mode="inbox"
        initial={notifications ? { notifications, actors } : undefined}
      />
    </PageFrame>
  );
}
