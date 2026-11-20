import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";

/** Событие общего журнала из server action.
 *
 *  Пишем service-role клиентом с явными аккаунтом, заведением и автором:
 *  многие действия меняют данные admin-клиентом, и триггер с `log_audit()`
 *  там не сработал бы (у service-role нет активного аккаунта и `auth.uid()`).
 *  Вызывать ПОСЛЕ успешной записи самих данных.
 *
 *  Сбой записи в журнал не отменяет действие пользователя: данные уже
 *  сохранены, а повторять операцию ради журнала хуже, чем потерять одну
 *  строку. Ошибку пишем в лог сервера.
 *
 *  Код действия — `<раздел>.<объект>.<глагол>` или `<объект>.<глагол>`;
 *  префикс определяет раздел журнала (см. `modules.ts`), суффикс —
 *  категорию действия (см. `action-categories.ts`). */
export type AuditEventInput = {
  accountId: string;
  venueId?: string | null;
  userId: string;
  actionCode: string;
  entityType: string;
  entityId: string | null;
  details?: Record<string, unknown>;
};

export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  await writeAuditEvents([input]);
}

/** Несколько событий одним insert'ом (массовое удаление и т.п.). */
export async function writeAuditEvents(inputs: AuditEventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const admin = asLooseDb(createAdminClient());
  const { error } = await admin.from("audit_logs").insert(
    inputs.map((input) => ({
      account_id: input.accountId,
      venue_id: input.venueId ?? null,
      user_id: input.userId,
      action_code: input.actionCode,
      entity_type: input.entityType,
      entity_id: input.entityId,
      details: input.details ?? {},
    })),
  );
  if (error) {
    console.error(
      `[audit] не удалось записать ${inputs[0].actionCode}: ${error.message}`,
    );
  }
}
