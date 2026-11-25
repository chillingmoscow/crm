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
  getAssignmentConflictReason,
  ineligibleAssigneeMessage,
  isEligibleForRole,
  type InventoryAssignRole,
  type InventoryAssignmentEligibility,
} from "@/lib/inventory/act-assignment";
import { loadAssignmentEligibility } from "@/lib/inventory/assignment-eligibility-server";
import {
  DOCUMENT_CHANGED_ERROR,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Назначать акт можно только сотруднику этого аккаунта, у которого есть право
 * на роль в заведении акта (см. @/lib/inventory/act-assignment).
 *
 * Раньше проверялось одно членство: в пикерах был любой сотрудник любого
 * заведения, и акт уходил человеку, который потом не мог открыть форму
 * (нет «Заполнять назначенные акты») или итоги. А до членства — любой uuid
 * платформы: человек из чужого аккаунта получал уведомление со ссылкой на акт.
 */
function assertEligible(input: {
  eligibility: InventoryAssignmentEligibility;
  role: InventoryAssignRole;
  venueId: string | null;
  userId: string | null;
}) {
  if (!input.userId) return; // снятие назначения
  if (!UUID_RE.test(input.userId) || !isEligibleForRole({ ...input, userId: input.userId })) {
    throw new Error(ineligibleAssigneeMessage(input.role));
  }
}

/**
 * Фильтр «вторая роль акта — не этот человек» для UPDATE: страхует инвариант
 * «исполнитель ≠ проверяющий» от гонки двух параллельных назначений (оба
 * прошли проверку по прочитанной строке, а в итоге один человек на обеих
 * ролях). userId к этому моменту проверен как uuid (assertEligible).
 */
function otherRoleIsNot(column: "assigned_to" | "reviewer_id", userId: string) {
  return `${column}.is.null,${column}.neq.${userId}`;
}

/**
 * Назначить (или снять) проверяющего акт. Зеркало assignInventoryDocument:
 * право inventory.manage_documents, гард на существование акта, право
 * проверять акты у назначаемого, исполнитель ≠ проверяющий, best-effort
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

    const { data: before, error: beforeError } = await admin
      .from<{
        reviewer_id: string | null;
        assigned_to: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("reviewer_id, assigned_to, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryReviewer] before query failed:", beforeError);
      return { error: actionErrorMessage(beforeError, "Не удалось прочитать акт. Попробуйте ещё раз") };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: проверяющего нельзя менять у проведённого акта.
    const reviewerLock = getReviewerLockReason(before.status);
    if (reviewerLock) return { error: reviewerLock };
    if (before.reviewer_id === input.reviewerId) return { error: null };

    // Право проверять — в заведении именно этого акта.
    if (input.reviewerId) {
      const eligibility = await loadAssignmentEligibility({ admin, accountId: ctx.accountId });
      assertEligible({ eligibility, role: "reviewer", venueId: before.venue_id, userId: input.reviewerId });
    }
    const conflict = getAssignmentConflictReason({
      role: "reviewer",
      userId: input.reviewerId,
      assignedTo: before.assigned_to,
      reviewerId: before.reviewer_id,
    });
    if (conflict) return { error: conflict };

    // Проведённый за это время акт не трогаем, и исполнитель не должен был
    // за это время стать этим же человеком.
    let update = admin
      .from<Array<{ id: string }>>("documents")
      .update({ reviewer_id: input.reviewerId })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .neq("status", "processed");
    if (input.reviewerId) update = update.or(otherRoleIsNot("assigned_to", input.reviewerId));
    const { data: updatedRows, error } = await update.select("id");
    if (error) {
      console.error("[assignInventoryReviewer] update failed:", error);
      return { error: actionErrorMessage(error, "Не удалось назначить проверяющего. Попробуйте ещё раз") };
    }
    if ((updatedRows ?? []).length === 0) return { error: DOCUMENT_CHANGED_ERROR };

    if (ctx.user) {
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

    if (input.reviewerId) {
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
    return { error: actionErrorMessage(e, "Не удалось назначить проверяющего. Подробности в логах.") };
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
        reviewer_id: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("assigned_to, reviewer_id, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryDocument] before query failed:", beforeError);
      return { error: "Не удалось прочитать акт. Попробуйте ещё раз" };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: исполнителя нельзя менять после ухода акта на проверку /
    // проведения. Передать другому — через «Отправить на пересчёт».
    const assigneeLock = getAssigneeLockReason(before.status);
    if (assigneeLock) return { error: assigneeLock };

    // Право заполнять — в заведении именно этого акта. Того же человека
    // повторно не проверяем: повторное назначение — no-op по исполнителю, а
    // право могли отозвать уже после назначения.
    if (input.assignedTo && input.assignedTo !== before.assigned_to) {
      const eligibility = await loadAssignmentEligibility({ admin, accountId: ctx.accountId });
      assertEligible({ eligibility, role: "assignee", venueId: before.venue_id, userId: input.assignedTo });
    }
    const conflict = getAssignmentConflictReason({
      role: "assignee",
      userId: input.assignedTo,
      assignedTo: before.assigned_to,
      reviewerId: before.reviewer_id,
    });
    if (conflict) return { error: conflict };

    // Обновляем, только если статус не сменился с момента чтения: иначе
    // переназначение во время сдачи акта откатывало «Готов к проверке» в
    // «Назначен» (статус считается от прочитанного значения).
    let update = admin
      .from<Array<{ id: string }>>("documents")
      .update({
        assigned_to: input.assignedTo,
        // Сохраняем recount_pending при смене исполнителя на пересчёте, иначе
        // assigned (или synced при снятии) — см. nextStatusAfterAssign.
        status: nextStatusAfterAssign(before.status, input.assignedTo),
      })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .eq("status", before.status);
    if (input.assignedTo) update = update.or(otherRoleIsNot("reviewer_id", input.assignedTo));
    const { data: updatedRows, error } = await update.select("id");

    if (error) {
      console.error("[assignInventoryDocument] update failed:", error);
      return { error: "Не удалось назначить исполнителя. Попробуйте ещё раз" };
    }
    if ((updatedRows ?? []).length === 0) {
      return { error: DOCUMENT_CHANGED_ERROR };
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
    return { error: actionErrorMessage(e, "Не удалось назначить акт. Подробности в логах.") };
  }
}

/**
 * Массовое назначение исполнителя или проверяющего на несколько актов сразу
 * (из плавающего bulk-бара в списке). Право inventory.manage_documents.
 * Пропускаются (считаются в `skipped`): акты, где роль менять нельзя по
 * статусу; где назначаемому не хватает права в заведении акта (выбранные акты
 * бывают из разных заведений); где он уже стоит на второй роли; и акты,
 * которые изменились между чтением и записью. Журнал пишется по каждому
 * обновлённому акту; уведомление назначенному — одно суммарное (не N штук).
 */
export async function bulkAssignInventoryDocuments(input: {
  documentIds: string[];
  role: InventoryAssignRole;
  userId: string | null;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.user || !ctx.accountId) {
      return { updated: 0, skipped: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одного акта" };
    const userId = input.userId;
    if (userId && !UUID_RE.test(userId)) {
      return { updated: 0, skipped: ids.length, error: ineligibleAssigneeMessage(input.role) };
    }

    const admin = asLooseDb(createAdminClient());
    // Массиву id с клиента не доверяем: работаем только с актами, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { updated: 0, skipped: ids.length, error: "Акты не найдены" };

    const [{ data: docsRaw, error: readError }, eligibility] = await Promise.all([
      admin
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
        .in("id", visibleIds),
      userId ? loadAssignmentEligibility({ admin, accountId: ctx.accountId }) : Promise.resolve(null),
    ]);
    // Codex P1 #407: read-ошибку нельзя глотать — иначе ложный успех.
    if (readError) throw new Error(readError.message);
    const docs = docsRaw ?? [];
    // Пропускаем залоченные по статусу для соответствующей роли (исполнитель
    // строже: лок уже на ready_for_review/results_blocked; проверяющий — лишь
    // на processed) и no-op'ы, где значение уже стоит — чтобы не
    // плодить лог/уведомления на пустом месте (как single-action).
    let noPermission = 0;
    let conflicts = 0;
    const eligible = docs.filter((d) => {
      const lock =
        input.role === "assignee"
          ? getAssigneeLockReason(d.status)
          : getReviewerLockReason(d.status);
      if (lock !== null) return false;
      const current = input.role === "assignee" ? d.assigned_to : d.reviewer_id;
      if (current === userId) return false;
      if (userId && eligibility && !isEligibleForRole({ eligibility, role: input.role, venueId: d.venue_id, userId })) {
        noPermission += 1;
        return false;
      }
      if (
        getAssignmentConflictReason({
          role: input.role,
          userId,
          assignedTo: d.assigned_to,
          reviewerId: d.reviewer_id,
        })
      ) {
        conflicts += 1;
        return false;
      }
      return true;
    });
    if (eligible.length === 0) {
      // Всё отсеялось по людям, а не по статусам — скажем почему, иначе
      // «Обновлено: 0» выглядит как сбой.
      const reason =
        noPermission > 0
          ? ineligibleAssigneeMessage(input.role)
          : conflicts > 0
            ? getAssignmentConflictReason({
                role: input.role,
                userId,
                assignedTo: input.role === "reviewer" ? userId : null,
                reviewerId: input.role === "assignee" ? userId : null,
              })
            : null;
      return { updated: 0, skipped: ids.length, error: reason };
    }

    const appliedIds = new Set<string>();
    const eligibleIds = eligible.map((d) => d.id);
    if (input.role === "reviewer") {
      let update = admin
        .from<Array<{ id: string }>>("documents")
        .update({ reviewer_id: userId })
        .eq("account_id", ctx.accountId)
        .in("id", eligibleIds)
        // Проведённый за это время акт не трогаем (замок проверяющего).
        .neq("status", "processed");
      if (userId) update = update.or(otherRoleIsNot("assigned_to", userId));
      const { data, error } = await update.select("id");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) appliedIds.add(row.id);
    } else {
      // Исполнитель: статус зависит от текущего (на пересчёте — сохраняем
      // recount_pending). Группируем по целевому статусу и обновляем пачками.
      const byStatus = new Map<string, string[]>();
      for (const d of eligible) {
        const next = nextStatusAfterAssign(d.status, userId);
        const arr = byStatus.get(next) ?? [];
        arr.push(d.id);
        byStatus.set(next, arr);
      }
      for (const [next, idsForStatus] of byStatus) {
        // Обновляем только акты, чей статус всё ещё допускает смену
        // исполнителя и даёт тот же целевой статус: акт, который успели сдать
        // на проверку между чтением и записью, не откатываем.
        const sourceStatuses =
          next === "recount_pending" ? ["recount_pending"] : ["synced", "assigned", "in_progress"];
        let update = admin
          .from<Array<{ id: string }>>("documents")
          .update({ assigned_to: userId, status: next })
          .eq("account_id", ctx.accountId)
          .in("id", idsForStatus)
          .in("status", sourceStatuses);
        if (userId) update = update.or(otherRoleIsNot("reviewer_id", userId));
        const { data, error } = await update.select("id");
        if (error) throw new Error(error.message);
        for (const row of data ?? []) appliedIds.add(row.id);
      }
    }
    const applied = eligible.filter((d) => appliedIds.has(d.id));
    const skipped = ids.length - applied.length;
    if (applied.length === 0) return { updated: 0, skipped, error: DOCUMENT_CHANGED_ERROR };

    const name = await loadProfileFullName(admin, userId);
    const eventType = input.role === "assignee" ? "assignee_changed" : "reviewer_changed";
    const setMsg =
      input.role === "assignee"
        ? `Назначил исполнителя: ${name ?? "сотрудник"}`
        : `Назначил проверяющего: ${name ?? "сотрудник"}`;
    const clearMsg = input.role === "assignee" ? "Снял исполнителя" : "Снял проверяющего";
    for (const d of applied) {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: d.id,
        eventType,
        message: userId ? setMsg : clearMsg,
        payload: {
          bulk: true,
          ...(input.role === "assignee" ? { assignedTo: userId } : { reviewerId: userId }),
        },
      });
    }

    // Одно суммарное уведомление назначенному (ссылка на список, не на акт).
    if (userId && userId !== ctx.user.id) {
      try {
        await admin.from("notifications").insert({
          user_id: userId,
          venue_id: applied[0]?.venue_id ?? null,
          type:
            input.role === "assignee"
              ? "inventory.document.assigned"
              : "inventory.document.review_assigned",
          category: "inventory",
          title:
            input.role === "assignee"
              ? `Вам назначено актов: ${applied.length}`
              : `Вы назначены проверяющим по актам: ${applied.length}`,
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
    return { updated: applied.length, skipped, error: null };
  } catch (e) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(e, "Не удалось применить массовое действие") };
  }
}
