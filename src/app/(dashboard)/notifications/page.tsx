import type { Metadata } from "next";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { getNotificationActors, getNotifications } from "./actions";
import { createClient, getCachedActiveAccountId } from "@/lib/supabase/server";

/** Пояс активного аккаунта; без него — московский. */
async function accountTimeZone(): Promise<string> {
  const [accountId, supabase] = await Promise.all([getCachedActiveAccountId(), createClient()]);
  if (!accountId) return "Europe/Moscow";
  const { data } = await supabase.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  return data?.timezone || "Europe/Moscow";
}

export const metadata: Metadata = { title: "Уведомления" };
export default async function NotificationsPage() {
  // Первая страница входящих — с сервера (столько же, сколько грузит
  // колокольчик): список приходит готовым, без скелетона другой высоты.
  // Пояс аккаунта и время сервера — чтобы группы «Сегодня» и «… назад»
  // совпали в разметке и в браузере (сервер живёт в UTC).
  const now = Date.now();
  const [notifications, timeZone] = await Promise.all([
    getNotifications({ scope: "active", limit: 50 }).catch(() => null),
    accountTimeZone(),
  ]);
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
        initial={notifications ? { notifications, actors, now, timeZone } : undefined}
      />
    </PageFrame>
  );
}
