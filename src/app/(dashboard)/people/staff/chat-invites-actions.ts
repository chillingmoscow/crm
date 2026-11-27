"use server";

import { revalidatePath } from "next/cache";
import { actionResult } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { queueStaffChatInvites } from "@/lib/people/chat-invites-queue";
import { revokeStaffChatInvites } from "@/lib/people/chat-invites-revoke";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";

/**
 * «Отправить новые приглашения» в карточке сотрудника: старые ссылки в чаты
 * должности отзываются (по ним больше не вступить), бот присылает в чат
 * приглашений новые — тем же заданием, что при найме. Нужно, когда сотрудник
 * не успел вступить, ссылку открыл кто-то другой или он сменил аккаунт.
 */
export async function reissueStaffChatInvites(userId: string) {
  return actionResult(async () => {
    const [user, can, accountId, supabase] = await Promise.all([
      getCachedUser(),
      getCachedPermissionChecker(),
      getCachedActiveAccountId(),
      createClient(),
    ]);
    if (!user) throw new Error("Войдите в систему");
    if (!can("people.edit_staff")) throw new Error("Нет права менять сотрудников");
    const venue = await supabase.rpc("get_active_venue_id");
    const venueId = venue.data as string | null;
    if (!venueId || !accountId) throw new Error("Выберите заведение");

    const db = asLooseDb(createAdminClient());
    const [member, profile] = await Promise.all([
      db
        .from<{ role_id: string | null }>("user_venue_roles")
        .select("role_id")
        .eq("user_id", userId)
        .eq("venue_id", venueId)
        .eq("status", "active")
        .maybeSingle(),
      db
        .from<{ first_name: string | null; last_name: string | null }>("profiles")
        .select("first_name,last_name")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (member.error || profile.error) throw new Error("Не удалось загрузить сотрудника");
    if (!member.data) throw new Error("Сотрудник не работает в этом заведении");

    const bot = await loadTelegramBot(db, accountId);
    if (!bot?.invitesChatId)
      throw new Error("Подключите Telegram-бота и чат для приглашений в «Настройки → Интеграции»");

    // Пока прежняя отправка в очереди, новую не ставим: она пришлёт ссылки
    // уже после отзыва. Задание найма к тому же не удаляем — страховка найма
    // создала бы его заново, и бот прислал бы второе сообщение.
    const active = await db
      .from<{ id: string }[]>("candidate_jobs")
      .select("id")
      .eq("account_id", accountId)
      .eq("kind", "chat_invites")
      .eq("payload->>user_id", userId)
      .in("state", ["pending", "working", "error"])
      .lt("attempts", 10)
      .limit(1);
    if (active.error) throw new Error("Не удалось проверить очередь приглашений");
    if (active.data?.length)
      throw new Error("Бот ещё готовит прежние приглашения — дождитесь их и повторите");
    const { revoked, failed } = await revokeStaffChatInvites(db, bot, accountId, userId);
    const name =
      [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ") || "Сотрудник";
    const notQueued = await queueStaffChatInvites({
      venueId,
      userId,
      roleId: member.data.role_id,
      name,
      eventKey: `reissue:${userId}:${Date.now()}`,
    });
    if (notQueued) throw new Error("Не удалось поставить отправку приглашений. Попробуйте ещё раз");

    await writeAuditEvent({
      accountId,
      venueId,
      userId: user.id,
      actionCode: "staff.chat_invites.sent",
      entityType: "staff",
      entityId: userId,
      details: { revoked, not_revoked: failed },
    });
    revalidatePath(`/people/staff/${userId}`);
    return { revoked, failed };
  }, "Не удалось отправить новые приглашения");
}
