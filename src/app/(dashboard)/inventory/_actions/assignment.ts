"use server";

// Назначение исполнителя и проверяющего акта.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  getAssigneeLockReason,
  getReviewerLockReason,
  nextStatusAfterAssign
} from "@/lib/inventory/act-status";
import {
  actionErrorMessage,
  assertDocumentVisible,
  filterVisibleDocumentIds,
  getActiveContext,
  notifyInventoryDocumentEvent,
  writeInventoryResultEvent
} from "../actions-shared";

/** Полное имя профиля (для сообщений журнала). null если нет. */
async function loadProfileFullName(admin: LooseDb, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from<{ first_name: string | null; last_name: string | null }>("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Назначать акт можно только сотруднику этого аккаунта.
 *
 * Без проверки любой uuid из платформы принимался как исполнитель или
 * проверяющий: человек из чужого аккаунта получал уведомление со ссылкой на
 * акт, а его имя вставало в карточку.
 */
async function assertAssignableUser(input: {
  admin: LooseDb;
  accountId: string;
  userId: string | null;
}) {
  if (!input.userId) return; // снятие назначения
  const { data: account } = await input.admin
    .from<{ owner_id: string | null }>("accounts")
    .select("owner_id")
    .eq("id", input.accountId)
    .maybeSingle();
  if (account?.owner_id === input.userId) return;

  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId);
  const venueIds = (venues ?? []).map((venue) => venue.id);
  if (venueIds.length > 0) {
    const { data: membership } = await input.admin
      .from<Array<{ user_id: string }>>("user_venue_roles")
      .select("user_id")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .in("venue_id", venueIds);
    if ((membership ?? []).length > 0) return;
  }
  throw new Error("Пользователь не найден в этом аккаунте");
}

/**
 * Назначить (или снять) проверяющего акт. Зеркало assignInventoryDocument:
 * право inventory.manage_documents, гард на существование акта, best-effort
 * уведомление назначенному проверяющему.
 */
export async function assignInventoryReviewer(input: {
  documentId: string;
  reviewerId: string | null;
}): Promise<{ error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить контекст" };

    const admin = asLooseDb(createAdminClient());
    // Акт чужого заведения недоступен, даже если знать его uuid.
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.reviewerId });

    const { data: before, error: beforeError } = await admin
      .from<{
        reviewer_id: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("reviewer_id, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryReviewer] before query failed:", beforeError);
      return { error: beforeError.message };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: проверяющего нельзя менять у проведённого / sync_error акта.
    const reviewerLock = getReviewerLockReason(before.status);
    if (reviewerLock) return { error: reviewerLock };

    const { error } = await admin
      .from("documents")
      .update({ reviewer_id: input.reviewerId })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[assignInventoryReviewer] update failed:", error);
      return { error: error.message };
    }

    const reviewerChanged = before.reviewer_id !== input.reviewerId;
    if (reviewerChanged && ctx.user) {
      const reviewerName = await loadProfileFullName(admin, input.reviewerId);
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        eventType: "reviewer_changed",
        message: input.reviewerId
          ? `Назначил проверяющего: ${reviewerName ?? "сотрудник"}`
          : "Снял проверяющего",
        payload: { reviewerId: input.reviewerId },
      });
    }

    if (input.reviewerId && reviewerChanged) {
      await notifyInventoryDocumentEvent({
        admin,
        recipientId: input.reviewerId,
        actorId: ctx.user?.id ?? null,
        venueId: before.venue_id ?? null,
        documentId: input.documentId,
        type: "inventory.document.review_assigned",
        title: `Вы назначены проверяющим по акту № ${before.document_number}`,
        body: "Когда исполнитель завершит акт, проверьте итоги и при необходимости верните на пересчёт.",
      });
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${input.documentId}`);
    return { error: null };
  } catch (e) {
    console.error("[assignInventoryReviewer] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось назначить проверяющего. Подробности в логах.",
    };
  }
}

export async function assignInventoryDocument(input: {
  documentId: string;
  assignedTo: string | null;
}): Promise<{ error: string | null }> {
  // Outer try/catch: предотвращает «An unexpected response was received
  // from the server» (Next.js error при unhandled throw в server action).
  // Любая ошибка возвращается как { error: message } для понятного toast.
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить контекст" };

    const admin = asLooseDb(createAdminClient());
    // Акт чужого заведения недоступен, даже если знать его uuid.
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.assignedTo });

    // Читаем предыдущее значение assigned_to + метаданные акта.
    // Codex P1 #383: если документа нет (id не существует или принадлежит
    // другому аккаунту) — before = null. Без этого гарда:
    //  - UPDATE становится no-op (фильтры eq не совпадают), error = null.
    //  - Notification шлётся с пустым номером и dead /documents/{id} link.
    //  - Abuse-vector: spammер с manage_documents в своём аккаунте
    //    может рассылать spam любому user-id через arbitrary documentId.
    // Гард: если документа нет — return error до UPDATE и notification.
    const { data: before, error: beforeError } = await admin
      .from<{
        assigned_to: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("assigned_to, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryDocument] before query failed:", beforeError);
      return { error: beforeError.message };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: исполнителя нельзя менять после ухода акта на проверку /
    // проведения. Передать другому — через «Отправить на пересчёт».
    const assigneeLock = getAssigneeLockReason(before.status);
    if (assigneeLock) return { error: assigneeLock };

    const { error } = await admin
      .from("documents")
      .update({
        assigned_to: input.assignedTo,
        // Сохраняем recount_pending при смене исполнителя на пересчёте, иначе
        // assigned (или synced при снятии) — см. nextStatusAfterAssign.
        status: nextStatusAfterAssign(before.status, input.assignedTo),
      })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[assignInventoryDocument] update failed:", error);
      return { error: error.message };
    }

    // Notification назначенному, best-effort (не блокируем основной flow).
    // Шлём только при реальной смене на нового assignee (не на unassign,
    // не на повторный assign того же).
    if (
      input.assignedTo
      && before.assigned_to !== input.assignedTo
    ) {
      try {
        const { error: notifError } = await admin.from("notifications").insert({
          user_id: input.assignedTo,
          venue_id: before.venue_id ?? null,
          type: "inventory.document.assigned",
          category: "inventory",
          title: `Вам назначен акт инвентаризации № ${before.document_number}`,
          body: "Откройте акт, проверьте позиции и заполните фактические остатки.",
          link: `/documents/inventory/${input.documentId}`,
          actor_user_id: ctx.user?.id ?? null,
          entity_type: "inventory_document",
          entity_id: input.documentId,
        });
        if (notifError) {
          console.error("[assignInventoryDocument] notification insert returned error:", notifError);
        }
      } catch (e) {
        // Уведомление — bonus, не critical. Не валим основной flow.
        console.error("[assignInventoryDocument] notification threw:", e);
      }
    }

    // Журнал: фиксируем смену исполнителя (назначение и снятие).
    if (before.assigned_to !== input.assignedTo && ctx.user) {
      const assigneeName = await loadProfileFullName(admin, input.assignedTo);
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        eventType: "assignee_changed",
        message: input.assignedTo
          ? `Назначил исполнителя: ${assigneeName ?? "сотрудник"}`
          : "Снял исполнителя",
        payload: { assignedTo: input.assignedTo },
      });
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${input.documentId}`);
    return { error: null };
  } catch (e) {
    // Любая необработанная ошибка → пользователь видит понятный текст
    // вместо «An unexpected response was received from the server».
    console.error("[assignInventoryDocument] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось назначить акт. Подробности в логах.",
    };
  }
}

/**
 * Массовое назначение исполнителя или проверяющего на несколько актов сразу
 * (из плавающего bulk-бара в списке). Право inventory.manage_documents.
 * Заблокированные для назначения акты (проведён / ошибка синка) пропускаются.
 * Журнал пишется по каждому акту; уведомление назначенному — одно суммарное
 * (не N штук).
 */
export async function bulkAssignInventoryDocuments(input: {
  documentIds: string[];
  role: "assignee" | "reviewer";
  userId: string | null;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.user || !ctx.accountId) {
      return { updated: 0, skipped: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одного акта" };

    const admin = asLooseDb(createAdminClient());
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.userId });
    // Массиву id с клиента не доверяем: работаем только с актами, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { updated: 0, skipped: ids.length, error: "Акты не найдены" };

    const { data: docsRaw, error: readError } = await admin
      .from<
        Array<{
          id: string;
          status: string;
          assigned_to: string | null;
          reviewer_id: string | null;
          document_number: string;
          venue_id: string | null;
        }>
      >("documents")
      .select("id, status, assigned_to, reviewer_id, document_number, venue_id")
      .eq("account_id", ctx.accountId)
      .in("id", visibleIds);
    // Codex P1 #407: read-ошибку нельзя глотать — иначе ложный успех.
    if (readError) throw new Error(readError.message);
    const docs = docsRaw ?? [];
    // Пропускаем залоченные по статусу для соответствующей роли (исполнитель
    // строже: лок уже на ready_for_review/results_blocked; проверяющий — лишь
    // на processed/sync_error) и no-op'ы, где значение уже стоит — чтобы не
    // плодить лог/уведомления на пустом месте (как single-action).
    const eligible = docs.filter((d) => {
      const lock =
        input.role === "assignee"
          ? getAssigneeLockReason(d.status)
          : getReviewerLockReason(d.status);
      if (lock !== null) return false;
      return input.role === "assignee"
        ? d.assigned_to !== input.userId
        : d.reviewer_id !== input.userId;
    });
    const skipped = ids.length - eligible.length;
    if (eligible.length === 0) return { updated: 0, skipped, error: null };

    const eligibleIds = eligible.map((d) => d.id);
    if (input.role === "reviewer") {
      const { error } = await admin
        .from("documents")
        .update({ reviewer_id: input.userId })
        .eq("account_id", ctx.accountId)
        .in("id", eligibleIds);
      if (error) throw new Error(error.message);
    } else {
      // Исполнитель: статус зависит от текущего (на пересчёте — сохраняем
      // recount_pending). Группируем по целевому статусу и обновляем пачками.
      const byStatus = new Map<string, string[]>();
      for (const d of eligible) {
        const next = nextStatusAfterAssign(d.status, input.userId);
        const arr = byStatus.get(next) ?? [];
        arr.push(d.id);
        byStatus.set(next, arr);
      }
      for (const [next, idsForStatus] of byStatus) {
        const { error } = await admin
          .from("documents")
          .update({ assigned_to: input.userId, status: next })
          .eq("account_id", ctx.accountId)
          .in("id", idsForStatus);
        if (error) throw new Error(error.message);
      }
    }

    const name = await loadProfileFullName(admin, input.userId);
    const eventType = input.role === "assignee" ? "assignee_changed" : "reviewer_changed";
    const setMsg =
      input.role === "assignee"
        ? `Назначил исполнителя: ${name ?? "сотрудник"}`
        : `Назначил проверяющего: ${name ?? "сотрудник"}`;
    const clearMsg = input.role === "assignee" ? "Снял исполнителя" : "Снял проверяющего";
    for (const d of eligible) {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: d.id,
        eventType,
        message: input.userId ? setMsg : clearMsg,
        payload: {
          bulk: true,
          ...(input.role === "assignee" ? { assignedTo: input.userId } : { reviewerId: input.userId }),
        },
      });
    }

    // Одно суммарное уведомление назначенному (ссылка на список, не на акт).
    if (input.userId && input.userId !== ctx.user.id) {
      try {
        await admin.from("notifications").insert({
          user_id: input.userId,
          venue_id: eligible[0]?.venue_id ?? null,
          type:
            input.role === "assignee"
              ? "inventory.document.assigned"
              : "inventory.document.review_assigned",
          category: "inventory",
          title:
            input.role === "assignee"
              ? `Вам назначено актов: ${eligible.length}`
              : `Вы назначены проверяющим по актам: ${eligible.length}`,
          body: "Откройте раздел «Акты инвентаризации».",
          link: "/documents/inventory",
          actor_user_id: ctx.user.id,
          entity_type: "inventory_document",
          entity_id: null,
        });
      } catch (e) {
        console.error("[bulkAssignInventoryDocuments] notification threw:", e);
      }
    }

    revalidatePath("/documents/inventory");
    return { updated: eligible.length, skipped, error: null };
  } catch (e) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(e, "Не удалось применить массовое действие") };
  }
}
