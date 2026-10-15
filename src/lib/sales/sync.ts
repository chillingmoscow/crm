import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection, salesSource } from "./quickresto";
import {
  calculateOrders,
  normalizeOrder,
  normalizeDetail,
  number,
  zMetrics,
  type Order,
  type OrderDetail,
} from "./calculate";
import { businessDate, addDays, zonedParts, dayWindow } from "./time";
import type { SalesJob, SalesSettings, Metrics } from "./types";
import { SalesRateLimitError } from "./rate-limit";
import { salesSettingsColumns } from "./types";

const db = () => asLooseDb(createAdminClient());
export async function enqueueDay(
  accountId: string,
  venueId: string,
  date: string,
  actor?: string,
  priority = 0,
) {
  const q = db();
  const { data: venue, error: ve } = await q
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (ve || !venue) throw new Error("Заведение недоступно");
  const { data, error } = await q
    .from<{ id: string }>("sales_sync_jobs")
    .insert({
      account_id: accountId,
      venue_id: venueId,
      business_date: date,
      created_by: actor ?? null,
      priority,
    })
    .select("id")
    .single();
  if (error) {
    if (!/duplicate|unique/i.test(error.message))
      throw new Error(error.message);
    const existing = await q
      .from<{ id: string }>("sales_sync_jobs")
      .select("id")
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (existing.error || !existing.data)
      throw new Error("Не удалось получить запуск");
    if (priority > 0) {
      const promoted = await q
        .from("sales_sync_jobs")
        .update({ priority })
        .eq("id", existing.data.id);
      if (promoted.error) throw new Error(promoted.error.message);
    }
    return existing.data.id;
  }
  if (!data) throw new Error("Не удалось создать запуск");
  return data.id;
}
export async function scheduleDueDays(now = new Date()) {
  const q = db();
  const configs = await q
    .from<SalesSettings[]>("sales_settings")
    .select(salesSettingsColumns)
    .eq("enabled", true);
  if (configs.error) throw new Error(configs.error.message);
  let queued = 0;
  for (const s of configs.data ?? []) {
    const current = businessDate(now, s.timezone, s.day_start_hour);
    const p = zonedParts(now, s.timezone);
    const jobs = await q
      .from<
        { business_date: string; created_at: string; status: string }[]
      >("sales_sync_jobs")
      .select("business_date,created_at,status")
      .eq("venue_id", s.venue_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (jobs.error) throw new Error(jobs.error.message);
    const latest = (date: string) =>
      jobs.data?.find((j) => j.business_date === date);
    const dates = [current];
    // Final daily verification after 09:45 for the last seven business days.
    if (
      p.hour > s.day_start_hour ||
      (p.hour === s.day_start_hour && p.minute >= 45)
    ) {
      for (let n = 1; n <= 7; n++) dates.push(addDays(current, -n));
    }
    const dayRows = await q
      .from<{ business_date: string; status: string }[]>("sales_days")
      .select("business_date,status")
      .eq("venue_id", s.venue_id)
      .in("business_date", dates);
    if (dayRows.error) throw new Error(dayRows.error.message);
    for (const date of dates) {
      const last = latest(date);
      const age = last ? now.getTime() - Date.parse(last.created_at) : Infinity;
      if (last && ["queued", "running"].includes(last.status)) {
        if (date === current) {
          const promoted = await q
            .from("sales_sync_jobs")
            .update({ priority: 10 })
            .eq("venue_id", s.venue_id)
            .eq("business_date", date)
            .in("status", ["queued", "running"])
            .eq("priority", 0);
          if (promoted.error) throw new Error(promoted.error.message);
        }
        continue;
      }
      if (last?.status === "failed" && age < 15 * 60000) continue;
      const needsFinal =
        date !== current &&
        dayRows.data?.some(
          (d) => d.business_date === date && d.status === "preliminary",
        );
      if (!needsFinal && age < (date === current ? 15 * 60000 : 24 * 3600000))
        continue;
      await enqueueDay(
        s.account_id,
        s.venue_id,
        date,
        undefined,
        date === current ? 10 : 5,
      );
      queued++;
    }
  }
  return queued;
}
function rows(
  raw: Record<string, unknown>,
  name: string,
): Record<string, unknown>[] {
  if (!Array.isArray(raw.ds))
    throw new Error(`Quick Resto: отсутствует список ${name}`);
  return raw.ds as Record<string, unknown>[];
}
async function checkedWrite(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
export async function runOneSlice() {
  const q = db();
  const claim = await q.rpc("sales_claim_job");
  if (claim.error) throw new Error(claim.error.message);
  const job = claim.data as SalesJob | null;
  if (!job) return { idle: true };
  const save = async (
    patch: Record<string, unknown>,
    receipts: unknown[] = [],
  ) => {
    const r = await q.rpc("sales_save_slice", {
      p_job_id: job.id,
      p_token: job.lease_token,
      p_patch: patch,
      p_receipts: receipts,
    });
    if (r.error) throw new Error(r.error.message);
  };
  try {
    const config = await q
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("venue_id", job.venue_id)
      .eq("account_id", job.account_id)
      .single();
    if (config.error || !config.data)
      throw new Error("Настройте источники смен");
    const s = config.data;
    if (s.quickresto_venue_id)
      throw new Error(
        "Для нескольких заведений сначала подтвердите привязку касс и отчёта Quick Resto. Сейчас поддерживается одно заведение на подключение",
      );
    const connection = await getConnection(job.account_id);
    if (!connection)
      throw new Error("Подключите Quick Resto в настройках интеграций");
    if (!s.quickresto_venue_id) {
      const venues = await q
        .from<{ id: string }[]>("external_entity_links")
        .select("id")
        .eq("account_id", job.account_id)
        .eq("provider", "quickresto")
        .eq("entity_type", "venue");
      if (venues.error) throw new Error(venues.error.message);
      if ((venues.data?.length ?? 0) > 1)
        throw new Error(
          "Подключение содержит несколько заведений. Нужна проверенная привязка чеков и кассовых отчётов к заведению",
        );
    }
    const other = await q
      .from<{ venue_id: string }[]>("sales_settings")
      .select("venue_id")
      .eq("account_id", job.account_id)
      .eq("enabled", true)
      .neq("venue_id", job.venue_id);
    if (other.error) throw new Error(other.error.message);
    if (other.data?.length)
      throw new Error(
        "Это подключение уже используется для смен другого заведения",
      );
    const source = salesSource(
      connection,
      s,
      job.business_date,
      job.created_at,
    );
    if (job.phase === "orders") {
      const response = await source.orders(job.cursor);
      const raw = rows(response, "чеков");
      const window = dayWindow(job.business_date, s.timezone, s.day_start_hour);
      if (
        raw.some((r) => {
          const timestamp = number(
            (r.object as Record<string, unknown>)?.createDate,
            "дата чека",
          );
          return timestamp < window.start || timestamp >= window.end;
        })
      )
        throw new Error(
          "Quick Resto вернул чеки за пределами рабочего дня. Итоги не опубликованы",
        );
      if (
        job.cursor === 0 &&
        raw.length &&
        !raw.some((r) => "payer" in (r.object as Record<string, unknown>))
      )
        throw new Error(
          "В списке чеков нет информации о клиентах. Проверьте адрес бэк-офиса Quick Resto для расчёта Staff",
        );
      const page = raw.map(normalizeOrder);
      if (page.length) {
        const existing = await q
          .from<{ order_id: number }[]>("sales_sync_receipts")
          .select("order_id")
          .eq("job_id", job.id)
          .in(
            "order_id",
            page.map((o) => o.id),
          );
        if (existing.error) throw new Error(existing.error.message);
        if (
          existing.data?.length ||
          new Set(page.map((o) => o.id)).size !== page.length
        )
          throw new Error("Quick Resto повторяет страницу чеков");
        await save(
          { cursor: job.cursor + page.length },
          page.map((order) => ({ order_id: order.id, order_data: order })),
        );
      } else
        await save({
          phase: "details",
          cursor: 0,
          payload: { ...job.payload, orders_count: job.cursor },
        });
    } else if (job.phase === "details") {
      const result = await q
        .from<{ order_id: number; order_data: Order }[]>("sales_sync_receipts")
        .select("order_id,order_data")
        .eq("job_id", job.id)
        .order("order_id")
        .range(job.cursor, job.cursor + 3);
      if (result.error) throw new Error(result.error.message);
      const page = result.data ?? [];
      if (!page.length)
        await save({
          phase: "reports",
          cursor: 0,
          payload: { ...job.payload, report_step: "staff", staff_ids: [] },
        });
      else {
        const details = await Promise.all(
          page.map(async (r) => ({
            id: r.order_id,
            detail: normalizeDetail(
              await source.detail(r.order_id),
              r.order_id,
            ),
          })),
        );
        await save(
          { cursor: job.cursor + page.length },
          details.map((d) => ({
            order_id: d.id,
            order_data: page.find((r) => r.order_id === d.id)!.order_data,
            detail_data: d.detail,
          })),
        );
      }
    } else if (job.phase === "reports") {
      const step = job.payload.report_step ?? "staff";
      if (step === "staff") {
        if (job.cursor === 0) {
          const cached = await q
            .from<{ source_summary: Record<string, unknown> }>("sales_days")
            .select("source_summary")
            .eq("account_id", job.account_id)
            .eq("venue_id", job.venue_id)
            .order("synced_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          if (cached.error) throw new Error(cached.error.message);
          const summary = cached.data?.source_summary;
          const stamp = String(summary?.staff_snapshot_at ?? "");
          const ids = summary?.staff_ids;
          if (
            summary &&
            (summary.settings as SalesSettings | undefined)?.staff_group_id ===
              s.staff_group_id &&
            Date.now() - Date.parse(stamp) < 10 * 60000 &&
            Array.isArray(ids) &&
            ids.every((id) => Number.isInteger(id) && id > 0)
          ) {
            await save({
              cursor: 0,
              payload: {
                ...job.payload,
                staff_ids: ids,
                staff_snapshot_at: stamp,
                report_step: "zlist",
              },
            });
            return { id: job.id, phase: job.phase };
          }
        }
        const response = await source.staff(job.cursor);
        const page = rows(response, "групп гостей");
        const ids = page
          .filter(
            (r) =>
              Number(
                (r.object as { customerGroup?: { id: number } })?.customerGroup
                  ?.id,
              ) === s.staff_group_id,
          )
          .map((r) =>
            number(
              (r.object as { customer?: { id: number } })?.customer?.id,
              "id Staff",
            ),
          );
        const all = [
          ...new Set([...((job.payload.staff_ids as number[]) ?? []), ...ids]),
        ];
        if (page.length) {
          const signature = JSON.stringify(
            page.map((r) => (r.object as { id?: number })?.id ?? r),
          );
          if (signature === job.payload.staff_page_signature)
            throw new Error("Quick Resto повторяет страницу групп гостей");
          await save({
            cursor: job.cursor + page.length,
            payload: {
              ...job.payload,
              staff_ids: all,
              staff_page_signature: signature,
            },
          });
        } else
          await save({
            cursor: 0,
            payload: {
              ...job.payload,
              staff_ids: all,
              staff_snapshot_at: new Date().toISOString(),
              report_step: "zlist",
            },
          });
      } else if (step === "zlist") {
        const list = await source.zList();
        if (!Array.isArray(list))
          throw new Error("Нет списка кассовых отчётов");
        await save({
          cursor: 0,
          payload: {
            ...job.payload,
            report_step: "zdetails",
            z_ids: list.map((r) => number(r.id, "id кассового отчёта")),
            z_reports: [],
          },
        });
      } else if (step === "zdetails") {
        const ids = job.payload.z_ids as number[];
        if (job.cursor >= ids.length)
          await save({
            cursor: 0,
            payload: { ...job.payload, report_step: "hookah" },
          });
        else {
          const report = await source.zDetail(ids[job.cursor]);
          // Retain only calculation fields, no personal/financial account details.
          const d = (report.data ?? report) as Record<string, unknown>;
          await save({
            cursor: job.cursor + 1,
            payload: {
              ...job.payload,
              z_reports: [
                ...(job.payload.z_reports as unknown[]),
                {
                  id: d.id,
                  closed: d.closed,
                  productOutgoing: d.productOutgoing,
                },
              ],
            },
          });
        }
      } else if (step === "hookah") {
        const report = await source.hookah();
        const total = (
          report.utilityData as { aggregates?: { totalSum: unknown } }
        )?.aggregates?.totalSum;
        await save({
          payload: {
            ...job.payload,
            report_step: "taxi",
            hookah: Math.round(number(total, "отчёт по кальянам")),
          },
        });
      } else {
        const cash = await source.taxi();
        if (!Array.isArray(cash))
          throw new Error("Нет списка расходных операций");
        const taxi = cash.filter(
          (r) =>
            r.typeTransaction === "cashOut" &&
            /такси/i.test(String(r.comment ?? "")),
        );
        const amount = taxi.reduce(
          (sum, r) => sum + number(r.amount, "расходы на такси"),
          0,
        );
        await save({
          phase: "commit",
          cursor: 0,
          payload: {
            ...job.payload,
            taxi: Math.round(amount),
            taxi_ids: taxi.map((r) => r.id),
          },
        });
      }
    } else {
      const all: { order_data: Order; detail_data: OrderDetail }[] = [];
      for (let start = 0; ; start += 1000) {
        const r = await q
          .from<typeof all>("sales_sync_receipts")
          .select("order_data,detail_data")
          .eq("job_id", job.id)
          .order("order_id")
          .range(start, start + 999);
        if (r.error) throw new Error(r.error.message);
        all.push(...(r.data ?? []));
        if ((r.data?.length ?? 0) < 1000) break;
      }
      if (
        all.length !== job.payload.orders_count ||
        all.some((r) => !r.detail_data)
      )
        throw new Error("Не все чеки загружены");
      const orders = all.map((r) => r.order_data),
        details = all.map((r) => r.detail_data);
      const metrics = calculateOrders(
        orders,
        details,
        job.payload.staff_ids as number[],
        s,
      );
      const complete =
        job.business_date <
        businessDate(new Date(), s.timezone, s.day_start_hour);
      const reports = job.payload.z_reports as Record<string, unknown>[];
      if (complete && !reports.length && orders.length)
        throw new Error("Нет кассовых отчётов завершённого дня");
      if (complete && reports.some((r) => !r.closed))
        throw new Error("Кассовая смена ещё не закрыта");
      const special =
        reports.length || complete
          ? zMetrics(reports, s)
          : { tips: null, deposits: null };
      Object.assign(metrics, special, {
        hookah: job.payload.hookah,
        taxi: job.payload.taxi,
      });
      metrics.bar = metrics.turnover! - metrics.hookah!;
      metrics.tips_total =
        metrics.tips === null ? null : metrics.tips + metrics.service!;
      const r = await q.rpc("sales_commit_job", {
        p_job_id: job.id,
        p_token: job.lease_token,
        p_metrics: metrics as Metrics,
        p_summary: {
          orders_count: orders.length,
          staff_ids: job.payload.staff_ids,
          staff_snapshot_at: job.payload.staff_snapshot_at,
          z_ids: job.payload.z_ids,
          taxi_ids: job.payload.taxi_ids,
          settings: s,
        },
        p_complete: complete,
      });
      if (r.error) throw new Error(r.error.message);
    }
    return { id: job.id, phase: job.phase };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Не удалось обновить смену";
    // Retrying read-only slices is safe; keep progress. After three errors require explicit retry.
    const rateLimited =
      e instanceof SalesRateLimitError || /\b429\b/.test(message);
    if (rateLimited) {
      await checkedWrite(
        await q
          .from("sales_settings")
          .update({
            provider_retry_at: new Date(
              Date.now() +
                (e instanceof SalesRateLimitError ? e.retryAfterMs : 60000),
            ).toISOString(),
          })
          .eq("account_id", job.account_id),
      );
    }
    const failures = Number(job.payload.failures ?? 0) + (rateLimited ? 0 : 1);
    const r = await q
      .from<{ id: string }[]>("sales_sync_jobs")
      .update({
        status: !rateLimited && failures >= 3 ? "failed" : "queued",
        error: message,
        payload: { ...job.payload, failures },
        lease_token: null,
        leased_until: null,
        finished_at:
          !rateLimited && failures >= 3 ? new Date().toISOString() : null,
      })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token)
      .select("id");
    if (r.error) throw new Error(r.error.message);
    if (r.data?.length) {
      const previous = await q
        .from<{ id: string }>("sales_days")
        .select("id")
        .eq("venue_id", job.venue_id)
        .eq("business_date", job.business_date)
        .maybeSingle();
      if (previous.error) throw new Error(previous.error.message);
      if (previous.data)
        await checkedWrite(
          await q
            .from("sales_days")
            .update({ sync_error: message })
            .eq("id", previous.data.id),
        );
      else
        await checkedWrite(
          await q.from("sales_days").upsert(
            {
              account_id: job.account_id,
              venue_id: job.venue_id,
              business_date: job.business_date,
              sync_error: message,
            },
            { onConflict: "venue_id,business_date", ignoreDuplicates: true },
          ),
        );
    }
    return { id: job.id, error: message };
  }
}
