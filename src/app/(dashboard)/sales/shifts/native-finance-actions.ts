"use server";
import { z } from "zod";
import { createClient, getCachedUser, getCachedActiveAccountId, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { validDate, businessDate, addDays } from "@/lib/sales/time";
import type { NativeFinanceKind } from "@/lib/finance/native-plan";
export type FinanceExecutionVersion = {
    id: string;
    version: number;
    enabled: boolean;
    from_date: string | null;
    settlement: boolean;
    movements: boolean;
    legacy_stopped: boolean;
    reason: string;
    actor_name: string;
    created_at: string;
};
export type FinanceExecutionConfiguration = {
    venueId: string;
    versions: FinanceExecutionVersion[];
    suggestedFrom: string;
};
export type FinanceExecutionRun = {
    id: string;
    kind: NativeFinanceKind;
    state: string;
    message: string | null;
    created_at: string;
    created_count: number;
    corrected_count: number;
    linked_count: number;
    cancelled_count: number;
};
type Job = {
    kind: NativeFinanceKind;
    state: string;
    message: string | null;
    updatedAt: string;
};
async function scope(venueId: string) {
    z.string().uuid().parse(venueId);
    const [client, user, accountId, permissions] = await Promise.all([createClient(), getCachedUser(), getCachedActiveAccountId(), getCachedPermissions()]);
    if (!user || !accountId || !permissions.includes("finance.view_transactions") || !permissions.includes("sales.view_shifts"))
        return null;
    const db = asLooseDb(client), [active, owner] = await Promise.all([db.rpc("get_active_venue_id"), client.from("accounts").select("owner_id").eq("id", accountId).single()]);
    if (active.error || owner.error)
        throw new Error("Не удалось проверить доступ к финансовым правилам");
    return active.data === venueId && owner.data?.owner_id === user.id ? { db, accountId } : null;
}
export async function loadFinanceExecutionConfiguration(venueId: string): Promise<FinanceExecutionConfiguration | null> {
    const s = await scope(venueId);
    if (!s)
        return null;
    const versions: FinanceExecutionVersion[] = [];
    let before = 2147483648;
    for (let count = 0; count < 10000; count += 500) {
        const r = await s.db.from<FinanceExecutionVersion[]>("finance_execution_rules").select("id,version,enabled,from_date,settlement,movements,legacy_stopped,reason,actor_name,created_at").eq("account_id", s.accountId).eq("venue_id", venueId).lte("version", before - 1).order("version", { ascending: false }).limit(500);
        if (r.error)
            throw new Error("Не удалось загрузить историю финансовых правил");
        const rows = r.data ?? [];
        versions.push(...rows);
        if (rows.length < 500) {
            const settings = await s.db.from<{
                timezone: string;
                day_start_hour: number;
            }>("sales_settings").select("timezone,day_start_hour").eq("account_id", s.accountId).eq("venue_id", venueId).single();
            if (settings.error || !settings.data)
                throw new Error("Сначала настройте источники продаж");
            if (!(await scope(venueId)))
                return null;
            return { venueId, versions, suggestedFrom: addDays(businessDate(new Date(), settings.data.timezone, settings.data.day_start_hour), 1) };
        }
        before = rows[rows.length - 1].version;
    }
    throw new Error("Не удалось прочитать полную историю финансовых правил");
}
export async function saveFinanceExecutionRules(input: {
    venueId: string;
    version: number;
    enabled: boolean;
    from: string | null;
    settlement: boolean;
    movements: boolean;
    legacyStopped: boolean;
    reason: string;
}) {
    const x = z.object({ venueId: z.string().uuid(), version: z.number().int().nonnegative(), enabled: z.boolean(), from: z.string().refine(validDate).nullable(), settlement: z.boolean(), movements: z.boolean(), legacyStopped: z.boolean(), reason: z.string().trim().min(1).max(1000) }).strict().parse(input);
    const s = await scope(x.venueId);
    if (!s)
        throw new Error("Режим проведения изменяет владелец");
    const r = await s.db.rpc("finance_save_execution_rules", { p_venue: x.venueId, p_version: x.version, p_enabled: x.enabled, p_from: x.from, p_settlement: x.settlement, p_movements: x.movements, p_legacy_stopped: x.legacyStopped, p_reason: x.reason });
    if (r.error)
        throw new Error(r.error.message);
    return loadFinanceExecutionConfiguration(x.venueId);
}
export async function loadFinanceExecutionDay(venueId: string, date: string, before?: string): Promise<{
    jobs: Job[];
    runs: FinanceExecutionRun[];
    more: boolean;
} | null> {
    if (!validDate(date))
        throw new Error("Выберите рабочий день");
    const s = await scope(venueId);
    if (!s)
        return null;
    let q = s.db.from<FinanceExecutionRun[]>("finance_execution_runs").select("id,kind,state,message,created_at,created_count,corrected_count,linked_count,cancelled_count").eq("account_id", s.accountId).eq("venue_id", venueId).eq("business_date", date).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
    // Cursor is the immutable run ID plus its timestamp, both checked in scope.
    if (before) {
        z.string().uuid().parse(before);
        const row = await s.db.from<{
            created_at: string;
        }>("finance_execution_runs").select("created_at").eq("id", before).eq("account_id", s.accountId).eq("venue_id", venueId).eq("business_date", date).single();
        if (row.error || !row.data)
            throw new Error("История изменилась. Обновите страницу");
        q = q.or(`created_at.lt.${row.data.created_at},and(created_at.eq.${row.data.created_at},id.lt.${before})`);
    }
    const [runs, jobs] = await Promise.all([q, s.db.rpc("finance_execution_status", { p_venue: venueId, p_date: date })]);
    if (runs.error || jobs.error)
        throw new Error("Не удалось загрузить проведение операций");
    if (!(await scope(venueId)))
        return null;
    return { jobs: (jobs.data ?? []) as Job[], runs: (runs.data ?? []).slice(0, 20), more: (runs.data?.length ?? 0) > 20 };
}
export async function retryNativeFinance(venueId: string, date: string, kind: NativeFinanceKind) {
    const s = await scope(venueId);
    if (!s)
        throw new Error("Повтор запускает владелец");
    z.enum(["settlement", "movements"]).parse(kind);
    if (!validDate(date))
        throw new Error("Выберите рабочий день");
    const r = await s.db.rpc("finance_retry_execution", { p_venue: venueId, p_date: date, p_kind: kind });
    if (r.error)
        throw new Error(r.error.message);
}
