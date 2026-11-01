import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { prepareNativeFinance, type NativeFinanceSnapshot, type NativeFinancePlan } from "./native-plan";
export async function scheduleNativeFinance() {
    const r = await asLooseDb(createAdminClient()).rpc("finance_schedule_execution");
    if (r.error)
        throw new Error("Не удалось запланировать финансовое проведение");
    return Number(r.data ?? 0);
}
/** No external writes. The database additionally requires explicit venue cutover. */
export async function processNativeFinance() {
    const db = asLooseDb(createAdminClient());
    const claimed = await db.rpc("finance_claim_execution");
    if (claimed.error)
        throw new Error("Не удалось получить финансовое проведение");
    const j = claimed.data as {
        id: string;
        lease: string;
    } | null;
    if (!j)
        return { idle: true };
    try {
        const source = await db.rpc("finance_execution_source", { p_job: j.id, p_lease: j.lease });
        if (source.error)
            throw new Error(source.error.message);
        if (!source.data)
            return { id: j.id, state: "disabled" };
        let plan: NativeFinancePlan;
        try {
            plan = prepareNativeFinance(source.data as NativeFinanceSnapshot);
        }
        catch (e) {
            plan = { commands: [], blockers: [e instanceof Error ? e.message : "Не удалось проверить финансовый расчёт"] };
        }
        const request = randomUUID();
        const result = await db.rpc("finance_apply_execution", { p_job: j.id, p_lease: j.lease, p_request: request, p_snapshot: source.data, p_plan: plan });
        let outcome = result.data as {
            state: string;
            message?: string;
        } | null;
        if (result.error) {
            // A timeout is not proof of failure. Read this exact request's outcome;
            // never blindly repeat the financial mutation after an ambiguous response.
            const recovered = await db.rpc("finance_execution_result", { p_request: request });
            if (recovered.error)
                throw new Error("Результат финансового запроса требует проверки: " + request);
            outcome = recovered.data as typeof outcome;
            if (!outcome)
                throw new Error(result.error.message);
        }
        if (!outcome)
            throw new Error("Не получен результат финансового проведения");
        return { id: j.id, state: outcome.state, error: outcome.state === "error" ? outcome.message ?? "Проведение не завершено" : undefined };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Не удалось выполнить финансовое проведение";
        const r = await db.rpc("finance_fail_execution", { p_job: j.id, p_lease: j.lease, p_message: message });
        if (r.error)
            throw new Error("Не удалось сохранить состояние финансового проведения");
        return { id: j.id, error: message };
    }
}
