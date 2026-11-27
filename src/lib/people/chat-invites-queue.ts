import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";

/**
 * Ставит задание «пригласить в Telegram-чаты должности» (candidate_jobs,
 * kind chat_invites) — то же, что при найме кандидата и восстановлении:
 * бот присылает в чат приглашений одноразовые ссылки. Повтор с тем же
 * eventKey задание не дублирует. Сбой не роняет вызывающее действие —
 * возвращает текст для предупреждения.
 */
export async function queueStaffChatInvites(input: {
  venueId: string;
  userId: string;
  roleId: string | null;
  name: string;
  eventKey: string;
}): Promise<string | null> {
  try {
    const db = asLooseDb(createAdminClient());
    const venue = await db.from<{ account_id: string }>("venues").select("account_id").eq("id", input.venueId).single();
    if (venue.error || !venue.data) throw new Error(venue.error?.message ?? "Заведение не найдено");
    const existing = await db
      .from<{ id: string }[]>("candidate_jobs")
      .select("id")
      .eq("account_id", venue.data.account_id)
      .eq("kind", "chat_invites")
      .eq("payload->>event_key", input.eventKey)
      .limit(1);
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.length) return null;
    const queued = await db.from("candidate_jobs").insert({
      account_id: venue.data.account_id,
      kind: "chat_invites",
      payload: { user_id: input.userId, role_id: input.roleId, name: input.name, event_key: input.eventKey },
    });
    if (queued.error) throw new Error(queued.error.message);
    return null;
  } catch (e) {
    console.error("[queueStaffChatInvites] not queued:", e);
    return "Приглашения в чаты Telegram не отправлены — пригласите сотрудника вручную";
  }
}

/** Убрать ещё не выполненное задание приглашений (откат созданного сотрудника). */
export async function dropStaffChatInvites(userId: string) {
  await asLooseDb(createAdminClient())
    .from("candidate_jobs")
    .delete()
    .eq("kind", "chat_invites")
    .eq("payload->>user_id", userId)
    .in("state", ["pending", "error"]);
}

/**
 * Приглашения в чаты для принятых приглашений по email. Приглашение принимают
 * три пути (ссылка /invite/accept, страница /invite у вошедшего, синхронизация
 * в layout) — все зовут эту функцию, чтобы чаты не зависели от пути.
 */
export async function queueAcceptedInvitationChats(input: {
  userId: string;
  email: string;
  invitations: { id: string; venue_id: string; role_id: string }[];
}) {
  if (!input.invitations.length) return;
  const { data: who } = await createAdminClient()
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", input.userId)
    .maybeSingle();
  const name = [who?.first_name, who?.last_name].filter(Boolean).join(" ") || input.email;
  await Promise.all(
    input.invitations.map((inv) =>
      queueStaffChatInvites({
        venueId: inv.venue_id,
        userId: input.userId,
        roleId: inv.role_id,
        name,
        eventKey: `invite:${inv.id}`,
      }),
    ),
  );
}
