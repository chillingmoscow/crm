"use server";
import { z } from "zod";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { validDate } from "@/lib/sales/time";
import {
  nativeDayMembers,
  type DayTeam,
  type DayMember,
  type DayComment,
  type CommentEvent,
  type DayDiscussion,
  type DayArchive,
} from "@/lib/sales/day-context";
import type { Accrual, PayEmployee } from "@/lib/payroll/types";
async function scope(venueId: string, date: string) {
  z.string().uuid().parse(venueId);
  if (!validDate(date)) throw new Error("Проверьте дату смены");
  const client = await createClient(),
    {
      data: { user },
    } = await client.auth.getUser();
  const permissions = await getCachedPermissions(),
    accountId = await getCachedActiveAccountId();
  const db = asLooseDb(client),
    venue = await db.rpc("get_active_venue_id");
  if (!user || !accountId || !permissions.includes("sales.view_shifts"))
    throw new Error("Нет доступа к смене");
  if (venue.error || venue.data !== venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  return { db, client, permissions, accountId, user, venueId };
}
export async function loadDayArchive(
  venueId: string,
  date: string,
): Promise<DayArchive | null> {
  const s = await scope(venueId, date);
  const r = await s.db
    .from<DayArchive[]>("sales_day_archive")
    .select(
      "id,venue_id,business_date,legacy_ref,metrics,captured_at,imported_at,origin",
    )
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .eq("business_date", date)
    .order("captured_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (r.error) throw new Error("Не удалось загрузить архив смены");
  return r.data?.[0] ?? null;
}
export async function loadDayTeam(
  venueId: string,
  date: string,
  source: "native" | "archive",
  archiveId?: string,
): Promise<DayTeam> {
  const s = await scope(venueId, date);
  z.enum(["native", "archive"]).parse(source);
  if (!s.permissions.includes("payroll.view"))
    return { allowed: false, source, members: [] };
  if (source === "archive") {
    if (!archiveId) throw new Error("Архив общей смены пока не перенесён");
    z.string().uuid().parse(archiveId);
    const parent = await s.db
      .from<DayArchive>("sales_day_archive")
      .select("id,venue_id,business_date,captured_at")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("id", archiveId)
      .eq("business_date", date)
      .maybeSingle();
    if (parent.error || !parent.data) throw new Error("Архив смены недоступен");
    const rows: DayMember[] = [];
    for (let start = 0; start < 10000; start += 1000) {
      const r = await s.db
        .from<
          {
            id: string;
            name: string;
            position: string;
            salary: number | null;
            tips: number | null;
            extras: number | null;
            origin: DayMember["origin"];
          }[]
        >("payroll_day_archive_members")
        .select("id,name,position,salary,tips,extras,origin")
        .eq("account_id", s.accountId)
        .eq("venue_id", venueId)
        .eq("day_archive_id", archiveId)
        .order("id")
        .range(start, start + 999);
      if (r.error) throw new Error("Не удалось загрузить команду смены");
      rows.push(
        ...(r.data ?? []).map((m) => ({
          ...m,
          role: m.position,
          issues: [],
          components: [],
        })),
      );
      if ((r.data ?? []).length < 1000)
        return {
          allowed: true,
          source,
          members: rows,
          capturedAt: parent.data.captured_at,
        };
    }
    throw new Error("Не удалось загрузить весь состав смены");
  }
  const accruals: Accrual[] = [];
  for (let start = 0; start < 10000; start += 1000) {
    const r = await s.db
      .from<Accrual[]>("payroll_accruals")
      .select(
        "id,employee_id,business_date,components,salary,tips,status,issues,calculation_snapshot,updated_at",
      )
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить расчёт смены");
    accruals.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
    if (start === 9000)
      throw new Error("Не удалось загрузить весь расчёт смены");
  }
  const ids = [...new Set(accruals.map((a) => a.employee_id))];
  if (!ids.length) return { allowed: true, source, members: [] };
  const employees = await s.db
    .from<PayEmployee[]>("payroll_employees")
    .select("id,name,role_name,local_user_id")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .in("id", ids);
  if (employees.error)
    throw new Error("Не удалось загрузить сотрудников смены");
  const profileIds = (employees.data ?? []).flatMap((e) =>
    e.local_user_id ? [e.local_user_id] : [],
  );
  const photos = profileIds.length
    ? await s.client
        .from("profiles")
        .select("id,avatar_url")
        .in("id", profileIds)
    : null;
  return {
    allowed: true,
    source,
    members: nativeDayMembers(
      accruals,
      employees.data ?? [],
      Object.fromEntries((photos?.data ?? []).map((p) => [p.id, p.avatar_url])),
    ),
  };
}
export async function loadDayDiscussion(
  venueId: string,
  date: string,
): Promise<DayDiscussion> {
  const s = await scope(venueId, date);
  const comments: DayComment[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const r = await s.db
      .from<DayComment[]>("sales_day_comments")
      .select(
        "id,business_date,author_id,author_name,body,origin,created_at,updated_at,deleted_at,version,source_snapshot",
      )
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .order("created_at")
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить обсуждение");
    comments.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
    if (start === 99000)
      throw new Error("Не удалось загрузить все комментарии");
  }
  const history: CommentEvent[] = [];
  const ids = comments.map((c) => c.id);
  for (let batch = 0; batch < ids.length; batch += 100)
    for (let start = 0; start < 100000; start += 1000) {
      const r = await s.db
        .from<CommentEvent[]>("sales_day_comment_history")
        .select("id,comment_id,actor_name,action,details,created_at")
        .eq("account_id", s.accountId)
        .eq("venue_id", venueId)
        .in("comment_id", ids.slice(batch, batch + 100))
        .order("created_at")
        .order("id")
        .range(start, start + 999);
      if (r.error) throw new Error("Не удалось загрузить историю обсуждения");
      history.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) break;
      if (start === 99000)
        throw new Error("Не удалось загрузить всю историю обсуждения");
    }
  const setting = await s.db
    .from<{ timezone: string }>("sales_settings")
    .select("timezone")
    .eq("account_id", s.accountId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (setting.error) throw new Error("Не удалось загрузить настройки смены");
  return {
    venueId,
    currentUserId: s.user.id,
    moderator: s.permissions.includes("sales.configure_shifts"),
    timezone: setting.data?.timezone ?? "Europe/Moscow",
    comments,
    history,
  };
}
export async function dayCommentCommand(
  venueId: string,
  date: string,
  action: "create" | "edit" | "delete" | "restore",
  input: { id?: string; body?: string; request_key?: string; version?: number },
) {
  const s = await scope(venueId, date);
  z.enum(["create", "edit", "delete", "restore"]).parse(action);
  const payload =
    action === "create"
      ? {
          date,
          body: z.string().trim().min(1).max(4000).parse(input.body),
          request_key: z.string().uuid().parse(input.request_key),
        }
      : {
          date,
          id: z.string().uuid().parse(input.id),
          version: z.number().int().positive().parse(input.version),
          ...(action === "edit"
            ? { body: z.string().trim().min(1).max(4000).parse(input.body) }
            : {}),
        };
  const r = await s.db.rpc("sales_day_comment_command", {
    p_expected_venue: venueId,
    p_action: action,
    p_input: payload,
  });
  if (r.error) throw new Error(r.error.message);
  return loadDayDiscussion(venueId, date);
}
