import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatDayMonthTime } from "@/lib/format/date";

import { getCachedStoreTitle, getCachedVenueTimezone } from "../layout";
import { ActCommentEditor } from "../_components/act-comment-editor";
import { ActDateEditor } from "../_components/act-date-editor";
import { getInventoryDateLockReason, invoiceDayInZone, invoiceTimeInZone } from "@/lib/inventory/act-date";
import { hasCountedResults } from "@/lib/inventory/act-status";

type DocumentOverviewRow = {
  id: string;
  document_number: string;
  status: string;
  note: string | null;
  comment: string | null;
  invoice_date: string | null;
  processed: boolean | null;
  results_finalized_at: string | null;
  external_id: string | null;
  last_qr_update_date: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  store_id: string | null;
  venue_id: string | null;
  archived_at: string | null;
};

/**
 * Вкладка «Основное» карточки акта: сводка в режиме чтения и комментарий
 * команды с правкой на месте (сохраняет `SaveBar`). Доступ к самой странице
 * уже отфильтрован layout'ом; здесь только право РЕДАКТИРОВАТЬ комментарий.
 */
export default async function InventoryDocumentOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, accountId, can] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  const canManage = can("inventory.manage_documents");
  const canRecount = can("inventory.recount_documents");
  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const admin = asLooseDb(createAdminClient());
  const { data: document } = await admin
    .from<DocumentOverviewRow>("documents")
    .select(
      "id, document_number, status, note, comment, invoice_date, processed, results_finalized_at, external_id, last_qr_update_date, assigned_to, reviewer_id, store_id, venue_id, archived_at",
    )
    .eq("id", id)
    .eq("account_id", accountId as string)
    .maybeSingle();
  if (!document) notFound();

  const [storeTitle, timeZone] = await Promise.all([
    document.store_id ? getCachedStoreTitle(document.store_id) : Promise.resolve(null),
    document.venue_id ? getCachedVenueTimezone(document.venue_id) : Promise.resolve(null),
  ]);
  const canEdit =
    !document.archived_at &&
    (Boolean(canManage) ||
      document.assigned_to === user.id ||
      (document.reviewer_id === user.id && Boolean(canRecount)));

  // Дата акта: менять может управляющий актами, пока акт не проведён.
  // Проведённый (и удалённый в QR) акт — только чтение; у зафиксированных
  // итогов кнопка есть, а диалог объясняет, что сначала их переоткрывают.
  const dateLockReason = getInventoryDateLockReason(document);
  const dateReadOnly =
    !canManage ||
    !document.external_id ||
    Boolean(document.archived_at) ||
    Boolean(document.processed) ||
    document.status === "processed";
  const venueTimeZone = timeZone ?? "Europe/Moscow";
  let hasEnteredAmounts = false;
  if (!dateReadOnly) {
    const { count } = await admin
      .from("document_items")
      .select("id", { count: "exact", head: true })
      .eq("document_id", document.id)
      .not("submitted_amount", "is", null);
    hasEnteredAmounts = (count ?? 0) > 0;
  }

  const now = new Date();
  const qrComment = document.comment?.trim() ?? "";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[720px] flex-col gap-6">
      <ProfileSection
        title="Сведения"
        actions={
          dateReadOnly ? null : (
            <ActDateEditor
              documentId={document.id}
              documentNumber={document.document_number}
              currentDay={invoiceDayInZone(document.invoice_date, venueTimeZone)}
              currentTime={invoiceTimeInZone(document.invoice_date, venueTimeZone)}
              hasEnteredAmounts={hasEnteredAmounts}
              hasResults={hasCountedResults(document.status)}
              restriction={dateLockReason}
            />
          )
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Склад" value={storeTitle} />
          {/* Время акта важно: Quick Resto считает расчётный остаток на этот момент. */}
          <Item label="Дата акта" value={formatDayMonthTime(document.invoice_date, now, timeZone ?? undefined)} />
          {/* Когда акт последний раз сохраняли в Quick Resto (`lastUpdateDate`) —
              не дата акта: прежняя подпись «Изменён в Quick Resto» читалась как она. */}
          <Item
            label="Последнее изменение в Quick Resto"
            value={formatDayMonthTime(document.last_qr_update_date, now, timeZone ?? undefined)}
          />
          {qrComment ? (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-[13px] text-muted-foreground">Комментарий из Quick Resto</dt>
              <dd className="whitespace-pre-wrap text-sm">{qrComment}</dd>
            </div>
          ) : null}
        </dl>
      </ProfileSection>

      <ProfileSection title="Для команды">
        <ActCommentEditor documentId={document.id} note={document.note} canEdit={canEdit} />
      </ProfileSection>
    </div>
  );
}

/** Строка сводки в режиме чтения: подпись 13px серая, значение 14px, пустое — «Не указано». */
function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">Не указано</span>}</dd>
    </div>
  );
}
