"use server";

import { revalidatePath } from "next/cache";

import { errorText } from "@/lib/actions/error-text";
import { writeAuditEvent } from "@/lib/audit/write";
import {
  CERTIFICATE_ALERT_DAYS,
  certificateKindLabel,
  isCertificateKind,
  type CertificateKind,
} from "@/lib/finance/certificates";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient, getCachedActiveAccountId, getCachedUser } from "@/lib/supabase/server";

export type CounterpartyCertificate = {
  id: string;
  kind: CertificateKind;
  number: string | null;
  product: string | null;
  validFrom: string | null;
  validUntil: string | null;
  fileId: string | null;
  note: string | null;
};

type CertificateRow = {
  id: string;
  account_id: string;
  counterparty_id: string;
  kind: CertificateKind;
  number: string | null;
  product: string | null;
  valid_from: string | null;
  valid_until: string | null;
  file_id: string | null;
  note: string | null;
};

const NO_ROW = "Не удалось сохранить: нет прав или запись уже удалена. Обновите страницу";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Сегодня по Москве (`ГГГГ-ММ-ДД`) — для статуса срока и счётчика. */
export async function todayIso(): Promise<string> {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

function fromRow(row: CertificateRow): CounterpartyCertificate {
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    product: row.product,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    fileId: row.file_id,
    note: row.note,
  };
}

/** Короткое имя записи для журнала: «Сертификат соответствия № 123». */
function journalName(kind: string, number: string | null): string {
  return `${certificateKindLabel(kind)}${number ? ` № ${number}` : ""}`;
}

export async function listCounterpartyCertificates(counterpartyId: string): Promise<CounterpartyCertificate[]> {
  const supabase = asLooseDb(await createClient());
  const { data, error } = await supabase
    .from<CertificateRow[]>("counterparty_certificates")
    .select("id, account_id, counterparty_id, kind, number, product, valid_from, valid_until, file_id, note")
    .eq("counterparty_id", counterpartyId)
    .order("valid_until", { ascending: true, nullsFirst: false });
  if (error) throw new Error(errorText(error, "Не удалось загрузить сертификаты"));
  return (data ?? []).map(fromRow);
}

export type CertificateInput = {
  /** Нет — новая запись. */
  id?: string | null;
  counterpartyId: string;
  kind: string;
  number?: string | null;
  product?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  fileId?: string | null;
  note?: string | null;
};

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
const date = (value: unknown): string | null | "invalid" => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : "invalid";
};

export async function saveCertificate(input: CertificateInput): Promise<{ error: string | null }> {
  try {
    if (!isCertificateKind(input.kind)) return { error: "Выберите вид документа" };
    const validFrom = date(input.validFrom);
    const validUntil = date(input.validUntil);
    if (validFrom === "invalid" || validUntil === "invalid") return { error: "Проверьте даты" };
    if (validFrom && validUntil && validFrom > validUntil) {
      return { error: "Дата начала позже даты окончания" };
    }

    const [user, accountId, client] = await Promise.all([getCachedUser(), getCachedActiveAccountId(), createClient()]);
    if (!user || !accountId) return { error: "Не авторизован" };
    const supabase = asLooseDb(client);

    // Скан — только один из документов этого же контрагента.
    const fileId = input.fileId || null;
    if (fileId) {
      const { data: link } = await supabase
        .from<{ file_id: string }>("counterparty_attachments")
        .select("file_id")
        .eq("file_id", fileId)
        .eq("counterparty_id", input.counterpartyId)
        .maybeSingle();
      if (!link) return { error: "Файл не найден среди документов контрагента" };
    }

    const values = {
      kind: input.kind,
      number: text(input.number, 100),
      product: text(input.product, 500),
      valid_from: validFrom,
      valid_until: validUntil,
      file_id: fileId,
      note: text(input.note, 2000),
    };

    let id = input.id ?? null;
    let previous: CertificateRow | null = null;
    if (id) {
      const { data: before } = await supabase
        .from<CertificateRow>("counterparty_certificates")
        .select("id, account_id, counterparty_id, kind, number, product, valid_from, valid_until, file_id, note")
        .eq("id", id)
        .eq("counterparty_id", input.counterpartyId)
        .maybeSingle();
      if (!before) return { error: "Запись не найдена. Обновите страницу" };
      previous = before;
      const { data: changed, error } = await supabase
        .from<{ id: string }[]>("counterparty_certificates")
        .update({ ...values, updated_at: new Date().toISOString(), updated_by: user.id })
        .eq("id", id)
        .select("id");
      if (error) return { error: errorText(error, "Не удалось сохранить") };
      if (!changed?.length) return { error: NO_ROW };
    } else {
      const { data: created, error } = await supabase
        .from<{ id: string }>("counterparty_certificates")
        .insert({ ...values, account_id: accountId, counterparty_id: input.counterpartyId, created_by: user.id })
        .select("id")
        .single();
      if (error || !created) return { error: errorText(error, "Не удалось сохранить") };
      id = created.id;
    }

    const changes = previous
      ? (
          [
            ["kind", previous.kind, values.kind],
            ["number", previous.number, values.number],
            ["product", previous.product, values.product],
            ["valid_from", previous.valid_from, values.valid_from],
            ["valid_until", previous.valid_until, values.valid_until],
            ["note", previous.note, values.note],
          ] as const
        )
          .filter(([, before, after]) => (before ?? null) !== (after ?? null))
          .map(([field, before, after]) => ({
            field: field === "kind" ? "certificate_kind" : field,
            old: field === "kind" && before ? certificateKindLabel(before) : before,
            new: field === "kind" && after ? certificateKindLabel(after) : after,
          }))
      : [];
    if (!previous || changes.length > 0 || previous.file_id !== values.file_id) {
      await writeAuditEvent({
        accountId,
        userId: user.id,
        actionCode: previous ? "finance.counterparty_certificate.updated" : "finance.counterparty_certificate.created",
        entityType: "counterparty",
        entityId: input.counterpartyId,
        details: {
          name: journalName(values.kind, values.number),
          certificate_id: id,
          valid_until: values.valid_until,
          ...(previous ? { changes } : {}),
        },
      });
    }

    revalidatePath(`/finance/counterparties/${input.counterpartyId}`);
    revalidatePath("/finance/counterparties");
    return { error: null };
  } catch (error) {
    return { error: errorText(error, "Не удалось сохранить") };
  }
}

export async function deleteCertificate(id: string): Promise<{ error: string | null }> {
  try {
    const [user, accountId, client] = await Promise.all([getCachedUser(), getCachedActiveAccountId(), createClient()]);
    if (!user || !accountId) return { error: "Не авторизован" };
    const supabase = asLooseDb(client);
    const { data: deleted, error } = await supabase
      .from<CertificateRow[]>("counterparty_certificates")
      .delete()
      .eq("id", id)
      .select("id, account_id, counterparty_id, kind, number, product, valid_from, valid_until, file_id, note");
    if (error) return { error: errorText(error, "Не удалось удалить") };
    const row = deleted?.[0];
    if (!row) return { error: NO_ROW };
    await writeAuditEvent({
      accountId,
      userId: user.id,
      actionCode: "finance.counterparty_certificate.deleted",
      entityType: "counterparty",
      entityId: row.counterparty_id,
      details: { name: journalName(row.kind, row.number), certificate_id: row.id },
    });
    revalidatePath(`/finance/counterparties/${row.counterparty_id}`);
    revalidatePath("/finance/counterparties");
    return { error: null };
  } catch (error) {
    return { error: errorText(error, "Не удалось удалить") };
  }
}

/**
 * Сколько сертификатов живых контрагентов истекают в ближайшие 30 дней или
 * уже просрочены — цифра у пункта «Контрагенты». 0 при любой ошибке и без
 * права (RLS не отдаст строки).
 */
export async function countCertificateAlerts(): Promise<number> {
  try {
    const supabase = asLooseDb(await createClient());
    const today = await todayIso();
    const limit = new Date(Date.parse(`${today}T00:00:00Z`) + CERTIFICATE_ALERT_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { count } = await supabase
      .from("counterparty_certificates")
      .select("id, counterparty:counterparties!counterparty_certificates_counterparty_fkey!inner(deleted_at)", {
        count: "exact",
        head: true,
      })
      .is("counterparty.deleted_at", null)
      .lte("valid_until", limit);
    return count ?? 0;
  } catch {
    return 0;
  }
}
