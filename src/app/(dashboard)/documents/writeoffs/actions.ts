"use server";
import { z } from "zod";
import {
  createClient,
  getCachedUser,
  getCachedPermissions,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import type {
  StoredWriteoff,
  WriteoffArchive,
  WriteoffRules,
} from "@/lib/stock/writeoffs";
export type WriteoffJobStatus = {
  id: string;
  month: string;
  state: "pending" | "running" | "ready" | "error";
  cursor: number;
  total: number | null;
  last_error: string | null;
  completed_at: string | null;
};
export type WriteoffData = {
  venueId: string;
  permissions: string[];
  documents: StoredWriteoff[];
  archives: WriteoffArchive[];
  jobs: WriteoffJobStatus[];
  rules: WriteoffRules | null;
  origin: Record<string, unknown>;
  providerOrigin: string | null;
  connected: boolean;
  currentMonth: string;
  timezone: string;
};
async function scope(expected?: string) {
  const [client, user, permissions, accountId] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
  ]);
  const db = asLooseDb(client),
    venue = await db.rpc("get_active_venue_id");
  if (
    !user ||
    !accountId ||
    venue.error ||
    !venue.data ||
    !permissions.includes("inventory.view_results")
  )
    throw new Error("Нет доступа к списаниям");
  if (expected && venue.data !== z.string().uuid().parse(expected))
    throw new Error("Заведение изменилось. Обновите страницу");
  return {
    client,
    db,
    user,
    accountId,
    permissions,
    venueId: String(venue.data),
  };
}
export async function loadWriteoffs(expected?: string): Promise<WriteoffData> {
  const s = await scope(expected);
  async function rows<T>(table: string, cols: string, order: string) {
    const result: T[] = [];
    for (let start = 0; start < 100000; start += 1000) {
      const r = await s.db
        .from<T[]>(table)
        .select(cols)
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .order(order, { ascending: false })
        .order("id")
        .range(start, start + 999);
      if (r.error) throw new Error("Не удалось загрузить журнал списаний");
      result.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) return result;
    }
    throw new Error("Не удалось загрузить журнал целиком");
  }
  const [documents, archives, source, jobs, connection] = await Promise.all([
    rows<StoredWriteoff>(
      "stock_writeoff_documents",
      "id,venue_id,business_date,external_id,payload,source_hash,captured_at,version,missing_at",
      "business_date",
    ),
    rows<WriteoffArchive>(
      "stock_writeoff_archive",
      "id,venue_id,business_date,legacy_ref,name,quantity,total,correspondent,kind,document_number,document_url,category,deleted,delete_reason,period_total_raw,issues,origin,captured_at",
      "captured_at",
    ),
    s.db
      .from<{
        enabled: boolean;
        config: WriteoffRules;
        origin: Record<string, unknown>;
      }>("stock_writeoff_sources")
      .select("enabled,config,origin")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .maybeSingle(),
    s.db.rpc("stock_writeoff_job_status", { p_expected_venue: s.venueId }),
    asLooseDb(createAdminClient())
      .from<{ login: string }>("integration_connections")
      .select("login")
      .eq("account_id", s.accountId)
      .eq("provider", "quickresto")
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (source.error || jobs.error || connection.error)
    throw new Error("Не удалось загрузить состояние списаний");
  const check = await s.db.rpc("get_active_venue_id");
  if (check.error || check.data !== s.venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  const timezone = source.data?.config.timezone ?? "Europe/Moscow";
  return {
    venueId: s.venueId,
    permissions: s.permissions,
    documents,
    archives,
    jobs: (jobs.data ?? []) as WriteoffJobStatus[],
    rules: source.data?.config ?? null,
    origin: source.data?.origin ?? {},
    providerOrigin:
      connection.data && /^[-a-z0-9]+$/.test(connection.data.login)
        ? `https://${connection.data.login}.quickresto.ru`
        : null,
    connected: !!source.data?.enabled && !!connection.data,
    currentMonth: new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7),
    timezone,
  };
}
export async function requestWriteoffs(venueId: string, month: string) {
  const s = await scope(venueId);
  z.string()
    .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
    .parse(month);
  if (!s.permissions.includes("inventory.sync_quickresto"))
    throw new Error("Нет доступа к обновлению Quick Resto");
  const r = await s.db.rpc("stock_request_writeoff_month", {
    p_expected_venue: s.venueId,
    p_month: month + "-01",
  });
  if (r.error) throw new Error(r.error.message);
  return loadWriteoffs(venueId);
}
export type WriteoffHistory = {
  id: string;
  action: string;
  created_at: string;
  before_payload: StoredWriteoff["payload"] | null;
  after_payload: StoredWriteoff["payload"] | null;
  actor_id: string | null;
  actor_name?: string;
};
export async function loadWriteoffHistory(
  venueId: string,
  id: string,
): Promise<WriteoffHistory[]> {
  const s = await scope(venueId);
  z.string().uuid().parse(id);
  const result: WriteoffHistory[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const r = await s.db
      .from<WriteoffHistory[]>("stock_writeoff_history")
      .select("id,action,created_at,before_payload,after_payload,actor_id")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить историю акта");
    result.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) {
      const ids = [
        ...new Set(result.flatMap((h) => (h.actor_id ? [h.actor_id] : []))),
      ];
      const profiles = ids.length
        ? await s.client
            .from("profiles")
            .select("id,first_name,last_name")
            .in("id", ids)
        : null;
      if (profiles?.error)
        throw new Error("Не удалось загрузить авторов истории");
      const people = new Map(
        (profiles?.data ?? []).map((p) => [
          p.id,
          [p.first_name, p.last_name].filter(Boolean).join(" "),
        ]),
      );
      return result.map((h) => ({
        ...h,
        actor_name: h.actor_id
          ? people.get(h.actor_id) || "Пользователь"
          : "Система",
      }));
    }
  }
  throw new Error("Не удалось загрузить историю целиком");
}
