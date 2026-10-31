import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  getConnection,
  getBackOfficeAuth,
  withBackOfficeSession,
} from "@/app/(dashboard)/inventory/actions-shared";
import { callQuickRestoBackOfficeData } from "@/lib/integrations/quickresto/client";
import { executeBonusOperation, type BonusOperation } from "./bonus-executor";

export async function processPayrollBonus() {
  // Independent infrastructure gate. Default is safe even if a venue policy was changed.
  if (process.env.PAYROLL_BONUS_WRITES_ENABLED !== "true")
    return { idle: true, disabled: true };
  const db = asLooseDb(createAdminClient());
  const prepared = await db.rpc("payroll_prepare_bonus_operations");
  if (prepared.error) throw new Error(prepared.error.message);
  const claimed = await db.rpc("payroll_claim_bonus_operation");
  if (claimed.error) throw new Error(claimed.error.message);
  const job = claimed.data as BonusOperation | null;
  if (!job) return { idle: true };
  const connection = await getConnection(job.account_id);
  // Even before POST, an unreadable/missing mapping is visible for manual review.
  let sendAuthorization: string | null = null;
  const provider = {
    async read() {
      if (!connection) throw new Error("Подключение Quick Resto не настроено");
      const result = await withBackOfficeSession({
        connection,
        admin: db,
        run: (authorization) =>
          callQuickRestoBackOfficeData<{
            id?: number;
            available?: number;
            deleted?: boolean;
            accountState?: string;
          }>({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            path: "crm.accounting.account/read",
            query: {
              id: job.bonus_account_id,
              mode: "bonuses",
              timeZone: -180,
            },
          }),
      });
      if (
        result.id !== Number(job.bonus_account_id) ||
        result.deleted ||
        result.accountState !== "open" ||
        typeof result.available !== "number" ||
        !Number.isFinite(result.available)
      )
        throw new Error("Бонусный счёт не подтверждён");
      sendAuthorization = await getBackOfficeAuth({ connection, admin: db });
      return result.available;
    },
    async send() {
      if (!connection) throw new Error("Подключение Quick Resto не настроено");
      if (!sendAuthorization) throw new Error("Сессия не подтверждена");
      const authorization = sendAuthorization;
      const credit = job.direction === "credit";
      const result = await callQuickRestoBackOfficeData<unknown>({
        layerName: connection.login,
        baseUrl: connection.backoffice_base_url,
        authorization,
        path: "crm.accounting.account/action",
        query: {
          businessDayOffsetInMs: 32400000,
          mode: "bonuses",
          timeZone: -180,
        },
        body: {
          actionName: credit ? "accountCredit" : "accountDebit",
          data: {
            className: credit ? "accountCreditModal" : "accountDebitModal",
            ownerContextIds: [Number(job.bonus_account_id)],
            amount: Number(job.amount),
            timeZone: -180,
          },
          ids: [Number(job.bonus_account_id)],
          owner: {
            ownerContextId: Number(job.guest_id),
            ownerContextClassName:
              "ru.edgex.quickresto.modules.crm.customer.CrmCustomer",
          },
        },
      });
      if (
        typeof result !== "object" ||
        result === null ||
        "error" in result ||
        "errors" in result ||
        ("success" in result && result.success === false)
      )
        throw new Error("Результат Quick Resto требует сверки");
      return "id" in result &&
        (typeof result.id === "number" || typeof result.id === "string")
        ? String(result.id)
        : null;
    },
  };
  return { idle: false, ...(await executeBonusOperation(db, job, provider)) };
}
